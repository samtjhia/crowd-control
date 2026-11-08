use crate::{protocol::*, world::World};
use serde_json::{Value, json};

pub const ENGINE_VERSION: &str = "contact-engine-v8.13";
pub const ABI_VERSION: u32 = 1;
pub const MAX_TICKS_PER_COMMAND: u64 = 100_000;
const MAX_BYTES: usize = 32 * 1024 * 1024;

#[derive(Default)]
pub struct Engine {
    loaded: Option<World>,
    stream: u64,
    published_events: usize,
    published_density_tick: Option<u64>,
    recorded_requests: Vec<(u64, Value)>,
    request_cursor: usize,
    furthest_tick: u64,
    checkpoints: std::collections::VecDeque<(World, usize)>,
}
pub(crate) type Failure = (&'static str, String);
pub(crate) fn invalid(message: impl Into<String>) -> Failure {
    ("INVALID_SCHEMA", message.into())
}
pub(crate) fn unsupported(message: impl Into<String>) -> Failure {
    ("UNSUPPORTED_CAPABILITY", message.into())
}

impl Engine {
    pub fn dispatch(&mut self, input: &str) -> String {
        if input.len() > MAX_BYTES {
            return "[{\"schemaVersion\":1,\"simulationId\":\"unknown\",\"type\":\"error\",\"error\":{\"code\":\"RESOURCE_LIMIT\",\"message\":\"JSON byte budget exceeded\"}}]".into();
        }
        let raw: Result<Value, _> = serde_json::from_str(input);
        let simulation_id = raw
            .as_ref()
            .ok()
            .and_then(|v| v["simulationId"].as_str())
            .filter(|s| valid_id(s))
            .unwrap_or("unknown");
        let command_id = raw
            .as_ref()
            .ok()
            .and_then(|v| v["commandId"].as_str())
            .filter(|s| valid_id(s));
        let result = raw
            .as_ref()
            .map_err(|e| invalid(e.to_string()))
            .and_then(|v| self.handle(v));
        let messages = match result {
            Ok(messages) => messages,
            Err((code, message)) => {
                let mut error = json!({"schemaVersion":1,"simulationId":simulation_id,"type":"error","error":{"code":code,"message":message}});
                if let Some(id) = command_id {
                    error["commandId"] = json!(id);
                }
                vec![error]
            }
        };
        serde_json::to_string(&messages).expect("Engine output is finite JSON")
    }

    fn handle(&mut self, raw: &Value) -> Result<Vec<Value>, Failure> {
        preflight(raw).map_err(|message| {
            if message == "JSON resource budget exceeded" {
                ("RESOURCE_LIMIT", message.into())
            } else {
                invalid(message)
            }
        })?;
        let c: Command = serde_json::from_value(raw.clone()).map_err(|e| invalid(e.to_string()))?;
        if c.schema_version.0 != 1.0 {
            return Err(invalid("Unsupported schema version"));
        }
        let allowed: &[&str] = match c.r#type.as_str() {
            "load" => &["compiled", "history"],
            "pause" | "reset" | "resume" => &[],
            "step" => &["ticks"],
            "speed" => &["multiplier"],
            "run_to" | "seek" => &["time"],
            "apply_request" => &["request"],
            "query" => &["query"],
            "snapshot" => &["snapshotId"],
            "restore" => &["snapshot"],
            _ => return Err(invalid("Unknown command type")),
        };
        if raw.as_object().unwrap().keys().any(|k| {
            !["schemaVersion", "simulationId", "commandId", "type"].contains(&k.as_str())
                && !allowed.contains(&k.as_str())
        }) {
            return Err(invalid("Fields do not match command type"));
        }
        if allowed.iter().any(|key| raw.get(key).is_none()) {
            return Err(invalid("Missing command field"));
        }
        if c.r#type == "load" {
            let compiled = c.compiled.ok_or_else(|| invalid("Missing compiled"))?;
            let history = c.history.ok_or_else(|| invalid("Missing history"))?;
            if history.history_revision.0 != 0.0
                || !history.records.is_empty()
                || !history.outcomes.is_empty()
            {
                return Err(unsupported("Only empty initial history is supported"));
            }
            let world = World::load(compiled, &c.simulation_id)?;
            let stream = self.next_stream()?;
            self.published_events = 0;
            self.published_density_tick = None;
            self.loaded = Some(world);
            self.clear_recording();
            self.stream = stream;
            return Ok(self.publication(&c.command_id, true));
        }
        let world = self
            .loaded
            .as_ref()
            .ok_or_else(|| ("NOT_FOUND", "No simulation loaded".into()))?;
        if c.simulation_id != world.initial.scene.simulation_id {
            return Err(invalid("Simulation ID mismatch"));
        }
        match c.r#type.as_str() {
            "reset" => {
                let world = World::load(world.initial.clone(), &c.simulation_id)?;
                let stream = self.next_stream()?;
                self.published_events = 0;
                self.published_density_tick = None;
                self.loaded = Some(world);
                self.clear_recording();
                self.stream = stream;
                Ok(self.publication(&c.command_id, true))
            }
            "pause" | "resume" | "speed" => Ok(vec![self.ack(&c.command_id)]),
            "step" => {
                let ticks = c.ticks.unwrap().0 as u64;
                if ticks == 0 {
                    return Err(invalid("Step ticks must be positive"));
                }
                let version = world.scene_version;
                self.advance(ticks)?;
                Ok(self.publication(
                    &c.command_id,
                    self.loaded.as_ref().unwrap().scene_version != version,
                ))
            }
            "run_to" => {
                let target = target_tick(c.time.unwrap().0, world.initial.scene.model.dt.0)?;
                if target < world.tick {
                    return Err(invalid("run_to cannot go backward without a valid restore"));
                }
                let version = world.scene_version;
                self.advance(target - world.tick)?;
                Ok(self.publication(
                    &c.command_id,
                    self.loaded.as_ref().unwrap().scene_version != version,
                ))
            }
            "seek" => {
                let target = target_tick(c.time.unwrap().0, world.initial.scene.model.dt.0)?;
                if target > self.furthest_tick {
                    return Err(invalid("Seek time exceeds the recorded timeline"));
                }
                let stream = self.next_stream()?;
                let (mut candidate, mut cursor) = if let Some((saved, cursor)) = self
                    .checkpoints
                    .iter()
                    .rev()
                    .find(|(w, _)| w.tick <= target)
                {
                    (saved.clone(), *cursor)
                } else {
                    (World::load(world.initial.clone(), &c.simulation_id)?, 0)
                };
                replay_to(&mut candidate, &self.recorded_requests, &mut cursor, target)?;
                self.loaded = Some(candidate);
                self.request_cursor = cursor;
                self.remember_checkpoint();
                self.stream = stream;
                self.published_events = 0;
                self.published_density_tick = None;
                Ok(self.publication(&c.command_id, true))
            }
            "snapshot" => Ok(vec![
                json!({"schemaVersion":1,"simulationId":c.simulation_id,"type":"snapshot","commandId":c.command_id,"snapshot":world.snapshot(c.snapshot_id.as_ref().unwrap())}),
                self.ack(&c.command_id),
            ]),
            "apply_request" => {
                let request = c.request.as_ref().unwrap();
                let duplicate = request["requestId"]
                    .as_str()
                    .is_some_and(|id| world.request_contents.contains_key(&Id(id.into())));
                if world.tick < self.furthest_tick && !duplicate {
                    return Err(unsupported(
                        "Return to the latest recorded time before applying a new change",
                    ));
                }
                let tick = world.tick;
                let outcomes = world.history.outcomes.len();
                let result = self.loaded.as_mut().unwrap().apply_request(request)?;
                if self.loaded.as_ref().unwrap().history.outcomes.len() > outcomes {
                    self.recorded_requests.push((tick, request.clone()));
                    self.request_cursor = self.recorded_requests.len();
                }
                if result["ok"] == true {
                    let mut messages = self.publication(&c.command_id, true);
                    messages[0]["applied"] = result["value"].clone();
                    Ok(messages)
                } else {
                    Ok(vec![
                        json!({"schemaVersion":1,"simulationId":c.simulation_id,"commandId":c.command_id,"type":"error","error":result["error"]}),
                    ])
                }
            }
            "query" => {
                let result = world.read_query(c.query.as_ref().unwrap())?;
                Ok(vec![
                    json!({"schemaVersion":1,"simulationId":c.simulation_id,"type":"query_result","commandId":c.command_id,"stamp":self.stamp(),"result":result}),
                    self.ack(&c.command_id),
                ])
            }
            _ => Err(unsupported(format!(
                "{} is not currently enabled",
                c.r#type
            ))),
        }
    }
    fn next_stream(&self) -> Result<u64, Failure> {
        self.stream
            .checked_add(1)
            .ok_or_else(|| invalid("Stream counter exhausted"))
    }
    fn advance(&mut self, ticks: u64) -> Result<(), Failure> {
        if ticks > MAX_TICKS_PER_COMMAND {
            return Err((
                "RESOURCE_LIMIT",
                format!("Tick batch exceeds {MAX_TICKS_PER_COMMAND}"),
            ));
        }
        let target = self
            .loaded
            .as_ref()
            .unwrap()
            .tick
            .checked_add(ticks)
            .ok_or_else(|| invalid("Tick overflow"))?;
        if self
            .recorded_requests
            .get(self.request_cursor)
            .is_some_and(|(tick, _)| *tick <= target)
        {
            let mut candidate = self.loaded.as_ref().unwrap().clone();
            let mut cursor = self.request_cursor;
            replay_to(&mut candidate, &self.recorded_requests, &mut cursor, target)?;
            self.loaded = Some(candidate);
            self.request_cursor = cursor;
        } else {
            self.loaded.as_mut().unwrap().advance(ticks)?;
        }
        self.furthest_tick = self.furthest_tick.max(target);
        if self
            .checkpoints
            .back()
            .is_none_or(|(saved, _)| self.loaded.as_ref().unwrap().time() - saved.time() >= 2.0)
        {
            self.remember_checkpoint();
        }
        Ok(())
    }
    fn remember_checkpoint(&mut self) {
        let world = self.loaded.as_ref().unwrap();
        if world.grid.blocked.len() > 1_000_000 {
            return;
        }
        let current_tick = world.tick;
        let index = self
            .checkpoints
            .partition_point(|(saved, _)| saved.tick < world.tick);
        if self.checkpoints.get(index).is_some_and(|(saved, cursor)| {
            saved.tick == world.tick && *cursor == self.request_cursor
        }) {
            return;
        }
        if self
            .checkpoints
            .get(index)
            .is_some_and(|(saved, _)| saved.tick == world.tick)
        {
            self.checkpoints.remove(index);
        }
        self.checkpoints
            .insert(index, (world.clone(), self.request_cursor));
        let mut cells: usize = self
            .checkpoints
            .iter()
            .map(|(saved, _)| saved.grid.blocked.len())
            .sum();
        while self.checkpoints.len() > 32 || cells > 1_000_000 {
            // Keep the start and four recent points; thin the most densely covered older interval.
            let end = self.checkpoints.len().saturating_sub(4).max(1);
            let remove = (1..end)
                .filter(|i| self.checkpoints[*i].0.tick != current_tick)
                .min_by_key(|i| self.checkpoints[i + 1].0.tick - self.checkpoints[i - 1].0.tick)
                .unwrap_or_else(|| {
                    (0..self.checkpoints.len())
                        .find(|i| self.checkpoints[*i].0.tick != current_tick)
                        .unwrap_or(0)
                });
            cells -= self
                .checkpoints
                .remove(remove)
                .unwrap()
                .0
                .grid
                .blocked
                .len();
        }
    }
    fn clear_recording(&mut self) {
        self.recorded_requests.clear();
        self.request_cursor = 0;
        self.furthest_tick = 0;
        self.checkpoints.clear();
        self.remember_checkpoint();
    }
    fn stamp(&self) -> Value {
        let world = self.loaded.as_ref().unwrap();
        json!({"streamId":format!("rust-stream-{}",self.stream),"tick":world.tick,"time":world.time(),"topologyVersion":world.topology_version,"sceneVersion":world.scene_version,"historyRevision":world.history.history_revision})
    }
    fn ack(&self, id: &Id) -> Value {
        json!({"schemaVersion":1,"simulationId":self.loaded.as_ref().unwrap().initial.scene.simulation_id,"type":"ack","commandId":id,"stamp":self.stamp()})
    }
    fn publication(&mut self, id: &Id, scene: bool) -> Vec<Value> {
        let world = self.loaded.as_ref().unwrap();
        let simulation = &world.initial.scene.simulation_id;
        let mut out = vec![self.ack(id)];
        if scene {
            out.push(json!({"schemaVersion":1,"simulationId":simulation,"type":"scene","stamp":self.stamp(),"scene":world.render_scene()}));
        }
        let mut frame = self.stamp();
        frame["agents"] = world.frame_agents();
        out.push(json!({"schemaVersion":1,"simulationId":simulation,"type":"frame","frame":frame}));
        let mut metrics = json!({"schemaVersion":1,"simulationId":simulation,"type":"metrics","stamp":self.stamp(),"sample":world.metric_sample(),"completed":world.completed()});
        if scene
            || self
                .published_density_tick
                .is_none_or(|last| world.tick.saturating_sub(last) >= world.metric_period())
        {
            metrics["density"] = world.density_grid();
            self.published_density_tick = Some(world.tick);
        }
        out.push(metrics);
        if self.published_events < world.events.len() {
            out.push(json!({"schemaVersion":1,"simulationId":simulation,"type":"events","stamp":self.stamp(),"events":world.events[self.published_events..]}));
            self.published_events = world.events.len();
        }
        out
    }
}

fn target_tick(requested: f64, dt: f64) -> Result<u64, Failure> {
    let quotient = (requested / dt).ceil();
    if !quotient.is_finite() || quotient > 9_007_199_254_740_991.0 {
        return Err(("RESOURCE_LIMIT", "Requested time exceeds tick range".into()));
    }
    let mut target = quotient as u64;
    if target > 0 && (target - 1) as f64 * dt >= requested {
        target -= 1;
    }
    if target as f64 * dt < requested {
        target = target
            .checked_add(1)
            .ok_or_else(|| invalid("Requested tick overflow"))?;
    }
    Ok(target)
}
fn replay_to(
    world: &mut World,
    requests: &[(u64, Value)],
    cursor: &mut usize,
    target: u64,
) -> Result<(), Failure> {
    if target.saturating_sub(world.tick) > MAX_TICKS_PER_COMMAND {
        return Err(("RESOURCE_LIMIT", "Replay exceeds tick budget".into()));
    }
    while let Some((tick, request)) = requests.get(*cursor).filter(|(tick, _)| *tick <= target) {
        world.advance(*tick - world.tick)?;
        world.apply_request(request)?;
        *cursor += 1;
    }
    world.advance(target - world.tick)
}

#[cfg(test)]
mod seek_cache_tests {
    use super::*;
    #[test]
    fn checkpoints_cover_old_and_recent_time_with_bounded_storage() {
        let mut e = Engine::default();
        let input = include_str!("../../contract/fixtures/engine-navigation-load.json");
        assert_eq!(
            serde_json::from_str::<Value>(&e.dispatch(input)).unwrap()[0]["type"],
            "ack"
        );
        for _ in 0..120 {
            e.advance(40).unwrap();
        }
        assert_eq!(e.checkpoints.front().unwrap().0.tick, 0);
        assert!(e.checkpoints.len() <= 32);
        assert!(
            e.checkpoints
                .iter()
                .map(|(w, _)| w.grid.blocked.len())
                .sum::<usize>()
                <= 1_000_000
        );
        let target = 1200;
        let saved = e
            .checkpoints
            .iter()
            .rev()
            .find(|(w, _)| w.tick <= target)
            .unwrap()
            .0
            .tick;
        assert!(
            target - saved <= 800,
            "old seeks should not replay from load: {saved}"
        );
        let recent: Vec<_> = e
            .checkpoints
            .iter()
            .rev()
            .take(4)
            .map(|(w, _)| w.tick)
            .collect();
        assert!(recent.windows(2).all(|v| v[0] - v[1] == 40));
        let output:Value = serde_json::from_str(&e.dispatch(&json!({"schemaVersion":1,"simulationId":"engine-demo","commandId":"seek","type":"seek","time":60.05}).to_string())).unwrap();
        assert_eq!(output[0]["type"], "ack");
        assert!(
            e.checkpoints.iter().any(|(w, _)| w.tick == 1201),
            "repeated seeks reuse the exact restored point"
        );
    }
}
