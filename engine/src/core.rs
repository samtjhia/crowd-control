use crate::protocol::*;
use serde_json::{Value, json};
use std::collections::BTreeSet;

pub const ENGINE_VERSION: &str = "static-engine-v1";
pub const ABI_VERSION: u32 = 1;
const MAX_BYTES: usize = 32 * 1024 * 1024;

#[derive(Default)]
pub struct Engine {
    loaded: Option<(Compiled, Value)>,
    stream: u64,
}
type Failure = (&'static str, String);
fn invalid(message: impl Into<String>) -> Failure {
    ("INVALID_SCHEMA", message.into())
}
fn unsupported(message: impl Into<String>) -> Failure {
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
        preflight(raw).map_err(invalid)?;
        let command: Command =
            serde_json::from_value(raw.clone()).map_err(|e| invalid(e.to_string()))?;
        if command.schema_version.0 != 1.0 {
            return Err(invalid("Unsupported schema version"));
        }
        let allowed: &[&str] = match command.r#type.as_str() {
            "load" => &["compiled", "history"],
            "pause" | "reset" | "resume" => &[],
            "step" => &["ticks"],
            "speed" => &["multiplier"],
            "run_to" => &["time"],
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
        if command.r#type == "step" && command.ticks.is_some_and(|t| t.0 == 0.0) {
            return Err(invalid("Step ticks must be positive"));
        }
        if command.r#type == "load" {
            let compiled = command
                .compiled
                .ok_or_else(|| invalid("Missing compiled"))?;
            let history = command.history.ok_or_else(|| invalid("Missing history"))?;
            validate(&compiled, &command.simulation_id)?;
            if history.history_revision.0 != 0.0
                || !history.records.is_empty()
                || !history.outcomes.is_empty()
            {
                return Err(unsupported("Part one only accepts empty initial history"));
            }
            self.stream = self
                .stream
                .checked_add(1)
                .ok_or_else(|| invalid("Stream counter exhausted"))?;
            self.loaded = Some((compiled, raw["compiled"]["scene"]["map"].clone()));
            return Ok(self.publication(&command.command_id));
        }
        let (compiled, _) = self
            .loaded
            .as_ref()
            .ok_or_else(|| ("NOT_FOUND", "No simulation loaded".into()))?;
        if command.simulation_id != compiled.scene.simulation_id {
            return Err(invalid("Simulation ID mismatch"));
        }
        match command.r#type.as_str() {
            "reset" => {
                self.stream = self
                    .stream
                    .checked_add(1)
                    .ok_or_else(|| invalid("Stream counter exhausted"))?;
                Ok(self.publication(&command.command_id))
            }
            "pause" => Ok(vec![self.ack(&command.command_id)]),
            _ => Err(unsupported(format!(
                "{} is not implemented in part one",
                command.r#type
            ))),
        }
    }

    fn stamp(&self) -> Value {
        json!({"streamId":format!("rust-stream-{}",self.stream),"tick":0,"time":0,"topologyVersion":0,"sceneVersion":1,"historyRevision":0})
    }
    fn ack(&self, command_id: &Id) -> Value {
        json!({"schemaVersion":1,"simulationId":self.loaded.as_ref().unwrap().0.scene.simulation_id,"type":"ack","commandId":command_id,"stamp":self.stamp()})
    }
    fn publication(&self, command_id: &Id) -> Vec<Value> {
        let (compiled, map) = self.loaded.as_ref().unwrap();
        let scene = &compiled.scene;
        let metadata: Vec<Value> = scene
            .agents
            .iter()
            .map(|a| {
                let profile = &scene.profiles[&a.profile];
                let radius = a
                    .components
                    .as_ref()
                    .and_then(|c| c.physical.as_ref())
                    .and_then(|p| p.radius)
                    .unwrap_or(profile.radius)
                    .0;
                let mut appearance = json!({"symbol":"circle","fill":"#2563EB","opacity":1});
                for layer in [&profile.appearance, &a.appearance].into_iter().flatten() {
                    for (k, v) in serde_json::to_value(layer).unwrap().as_object().unwrap() {
                        if !v.is_null() {
                            appearance[k] = v.clone();
                        }
                    }
                }
                let mut item = json!({"id":a.id,"radius":radius,"appearance":appearance});
                if let Some(label) = &a.label {
                    item["label"] = json!(label);
                }
                item
            })
            .collect();
        let agents: Vec<Value> = scene.agents.iter().map(|a| {
            let speed = a.components.as_ref().and_then(|c|c.mobility.as_ref()).and_then(|m|m.speed_multiplier).or_else(||scene.profiles[&a.profile].mobility.as_ref().and_then(|m|m.speed_multiplier)).unwrap_or(compiled.resolved_model.default_agent.mobility.speed_multiplier).0;
            json!({"id":a.id,"x":a.x,"y":a.y,"profile":a.profile,"controller":null,"state":if speed==0.0 {"immobile"} else {"idle"}})
        }).collect();
        let mut frame = self.stamp();
        frame["agents"] = json!(agents);
        vec![
            self.ack(command_id),
            json!({"schemaVersion":1,"simulationId":scene.simulation_id,"type":"scene","stamp":self.stamp(),"scene":{"map":map,"entities":[],"agents":metadata}}),
            json!({"schemaVersion":1,"simulationId":scene.simulation_id,"type":"frame","frame":frame}),
        ]
    }
}

fn validate(c: &Compiled, simulation_id: &Id) -> Result<(), Failure> {
    let s = &c.scene;
    let m = &s.map;
    let model = &c.resolved_model;
    if s.schema_version.0 != 1.0 || &s.simulation_id != simulation_id || s.seed.0 > u32::MAX as f64
    {
        return Err(invalid("Invalid scene header or seed"));
    }
    if s.versions.model != model.version
        || s.model.units != model.units
        || m.units != model.units
        || s.model.dt.0 != model.dt.0
    {
        return Err(invalid("Model version, units or timestep mismatch"));
    }
    if s.versions.random.0 != "lcg32-v1"
        || s.versions
            .engine
            .as_ref()
            .is_some_and(|v| v.0 != ENGINE_VERSION)
    {
        return Err(unsupported("Unsupported random or engine version"));
    }
    if !s.controllers.is_empty()
        || !s.jobs.is_empty()
        || !s.rules.is_empty()
        || s.agents.iter().any(|a| a.controller.is_some())
        || model.contact.is_some()
    {
        return Err(unsupported(
            "Static scenes only: goals, jobs, rules and contact physics are not implemented",
        ));
    }
    if m.grid.is_some() || m.entities.as_ref().is_some_and(|e| !e.is_empty()) {
        return Err(unsupported(
            "Part one supports rectangular rooms/portals with rows/legend",
        ));
    }
    if let Some(source) = &m.source {
        if source != &json!({"mode":"generate","accuracy":"approximate"}) {
            return Err(unsupported("Part one supports generated example maps only"));
        }
    }
    let cols = m.width.0 / m.cell_size.0;
    let height = m.height.0 / m.cell_size.0;
    if cols.fract() != 0.0
        || height.fract() != 0.0
        || cols * height > 1_000_000.0
        || s.agents.len() > 2000
    {
        return Err(("RESOURCE_LIMIT", "Map or agent budget exceeded".into()));
    }
    let rows = m.rows.as_ref().ok_or_else(|| invalid("Missing rows"))?;
    let legend = m.legend.as_ref().ok_or_else(|| invalid("Missing legend"))?;
    if rows.len() != height as usize
        || rows.iter().any(|r| r.chars().count() != cols as usize)
        || legend.keys().any(|k| k.chars().count() != 1)
    {
        return Err(invalid("Invalid row dimensions or legend keys"));
    }
    let mut ids = BTreeSet::new();
    let mut zones = BTreeSet::new();
    for room in &m.rooms {
        if !ids.insert(&room.id) {
            return Err(invalid("Duplicate map ID"));
        }
        zones.insert(&room.id);
        bounds(room.x.0, room.y.0, room.width.0, room.height.0, m)?;
    }
    for p in &m.portals {
        if !ids.insert(&p.id)
            || p.connects[0] == p.connects[1]
            || p.connects.iter().any(|id| !zones.contains(id))
        {
            return Err(invalid("Duplicate portal or invalid connections"));
        }
        bounds(p.x.0, p.y.0, p.width.0, p.height.0, m)?;
    }
    if legend.values().any(|id| !ids.contains(id))
        || rows
            .iter()
            .flat_map(|r| r.chars())
            .any(|ch| ch != '#' && !legend.contains_key(&ch.to_string()))
    {
        return Err(invalid("Unknown legend glyph or ID"));
    }
    let base = &model.default_agent.navigation;
    if base.maximum_speed.0 < base.preferred_speed.0 {
        return Err(invalid("Invalid default speed range"));
    }
    for p in s.profiles.values() {
        if p.maximum_speed.is_some_and(|v| v.0 < p.preferred_speed.0) {
            return Err(invalid("Invalid profile speed range"));
        }
    }
    for a in &s.agents {
        if !ids.insert(&a.id) {
            return Err(invalid("Duplicate entity ID"));
        }
        let p = s
            .profiles
            .get(&a.profile)
            .ok_or_else(|| invalid("Unknown agent profile"))?;
        let radius = a
            .components
            .as_ref()
            .and_then(|c| c.physical.as_ref())
            .and_then(|p| p.radius)
            .unwrap_or(p.radius)
            .0;
        bounds(
            a.x.0 - radius,
            a.y.0 - radius,
            radius * 2.0,
            radius * 2.0,
            m,
        )?;
        let nav = a.components.as_ref().and_then(|c| c.navigation.as_ref());
        let preferred = nav
            .and_then(|n| n.preferred_speed)
            .unwrap_or(p.preferred_speed)
            .0;
        let maximum = nav
            .and_then(|n| n.maximum_speed)
            .or(p.maximum_speed)
            .unwrap_or(base.maximum_speed)
            .0;
        if maximum < preferred {
            return Err(invalid("Invalid resolved speed range"));
        }
    }
    Ok(())
}
fn bounds(x: f64, y: f64, w: f64, h: f64, m: &Map) -> Result<(), Failure> {
    if x < 0.0 || y < 0.0 || x + w > m.width.0 || y + h > m.height.0 {
        Err(invalid("Geometry outside map bounds"))
    } else {
        Ok(())
    }
}
