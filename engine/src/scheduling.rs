//! Fixed-boundary jobs and bounded event cascades, with persistent revision ownership.
use crate::{
    core::{Failure, invalid},
    operations,
    protocol::*,
    selectors as sel,
    world::World,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Job {
    pub id: Id,
    pub due_tick: u64,
    pub order: u64,
    pub origin: Value,
    pub operations: Vec<Value>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Rule {
    pub definition: Value,
    pub origin: Value,
    pub fired: bool,
    pub next_eligible_tick: u64,
    pub subjects: std::collections::BTreeMap<Id, Value>,
}
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Runtime {
    pub jobs: Vec<Job>,
    pub rules: Vec<Rule>,
    pub entity_origins: Vec<Value>,
    pub used_entities: BTreeSet<Id>,
    pub used_jobs: BTreeSet<Id>,
    pub removed_regions: BTreeSet<Id>,
    pub processed_events: usize,
    pub order: u64,
    pub geometry_base: Option<crate::grid::GridData>,
    #[serde(skip)]
    pub work: usize,
}
impl World {
    pub fn has_runtime_work(&self) -> bool {
        !self.runtime.jobs.is_empty()
            || self
                .runtime
                .rules
                .iter()
                .any(|r| !r.fired || r.definition["once"] == false)
    }
    pub fn initialize_runtime(&mut self) -> Result<(), Failure> {
        let origin = json!({"interventionId":"base","revision":1});
        self.runtime.used_entities = sel::records(self).into_keys().collect();
        self.runtime.entity_origins = self
            .runtime
            .used_entities
            .iter()
            .map(|id| json!({"entityId":id,"origin":origin}))
            .collect();
        let mut map = self.map_state.clone();
        for p in &mut map.portals {
            p.open = true;
        }
        if let Some(es) = &mut map.entities {
            for e in es {
                if let Some(p) = e.components.as_mut().and_then(|c| c.portal.as_mut()) {
                    p.open = true;
                }
            }
        }
        let mut base = crate::grid::GridData::decode(&map)?;
        // Source wall cells without zone membership stay permanent. Named floor beneath
        // an initial object is its removable underlay; no raw wall is opened by inference.
        for e in map.entities().iter().filter(|e| e.blocking()) {
            if let Some(s) = &e.shape {
                let (x, y, w, h) = s.extent();
                for row in (y / base.cell_size).floor() as usize
                    ..((y + h) / base.cell_size).ceil() as usize
                {
                    for col in (x / base.cell_size).floor() as usize
                        ..((x + w) / base.cell_size).ceil() as usize
                    {
                        let i = row * base.width + col;
                        if base.zone_index[i] != 0
                            && s.intersects(
                                col as f64 * base.cell_size,
                                row as f64 * base.cell_size,
                                base.cell_size,
                            )
                        {
                            base.blocked[i] = 0;
                            if base.traversal_cost[i] <= 0.0 {
                                base.traversal_cost[i] = 1.0;
                            }
                        }
                    }
                }
            }
        }
        self.runtime.geometry_base = Some(base);
        for raw in self.initial.scene.jobs.clone() {
            sel::keys(
                &raw,
                &["id", "at", "operations"],
                &["id", "at", "operations"],
            )?;
            self.schedule(
                sel::id(&raw["id"])?,
                sel::number(&raw["at"])?,
                operations::array(&raw["operations"])?.clone(),
                origin.clone(),
            )?;
        }
        for raw in self.initial.scene.rules.clone() {
            if raw.get("event").is_some() {
                sel::keys(
                    &raw,
                    &[
                        "id",
                        "event",
                        "match",
                        "controller",
                        "mode",
                        "once",
                        "cooldown",
                    ],
                    &["id", "event", "match", "controller", "mode"],
                )?;
                let controller = sel::id(&raw["controller"])?;
                let g = self
                    .initial
                    .scene
                    .controllers
                    .get(&controller)
                    .ok_or_else(|| invalid("Unknown rule controller"))?;
                let mut op = json!({"op":"define_rule","id":raw["id"],"when":{"kind":"event","name":raw["event"]},"operations":[{"op":"assign_goal","targets":raw["match"],"goal":operations::compiled_goal(g),"mode":raw["mode"]}]});
                for k in ["once", "cooldown"] {
                    if let Some(v) = raw.get(k) {
                        op[k] = v.clone();
                    }
                }
                self.define_rule(op, origin.clone())?;
            } else {
                self.define_rule(raw, origin.clone())?;
            }
        }
        self.pump()
    }
    pub fn due_tick(&self, time: f64) -> Result<u64, Failure> {
        let dt = self.initial.scene.model.dt.0;
        let mut tick = (time / dt).ceil();
        if !tick.is_finite() || tick > 9_007_199_254_740_991.0 {
            return Err(("RESOURCE_LIMIT", "Scheduled time exceeds tick range".into()));
        }
        if tick > 0.0 && (tick - 1.0) * dt >= time {
            tick -= 1.0;
        }
        if tick * dt < time {
            tick += 1.0;
        }
        Ok(tick as u64)
    }
    pub fn schedule(
        &mut self,
        id: Id,
        at: f64,
        ops: Vec<Value>,
        origin: Value,
    ) -> Result<(), Failure> {
        operations::validate(&ops, 0)?;
        if at + 1e-12 < self.time() {
            return Err(invalid("Cannot create a past schedule"));
        }
        if self.runtime.jobs.len() >= 1000 || self.runtime.used_jobs.len() >= 10000 {
            return Err((
                "RESOURCE_LIMIT",
                "Pending/job allocation budget exceeded".into(),
            ));
        }
        if !self.runtime.used_jobs.insert(id.clone()) {
            return Err(invalid("Job ID already allocated"));
        }
        let due_tick = self.due_tick(at)?;
        let order = self.runtime.order;
        self.runtime.order = self
            .runtime
            .order
            .checked_add(1)
            .ok_or_else(|| invalid("Job order exhausted"))?;
        self.allocations.next_job.0 += 1.0;
        self.runtime.jobs.push(Job {
            id,
            due_tick,
            order,
            origin,
            operations: ops,
        });
        self.runtime.jobs.sort_by_key(|j| (j.due_tick, j.order));
        Ok(())
    }
    pub fn define_rule(&mut self, op: Value, origin: Value) -> Result<(), Failure> {
        operations::validate(std::slice::from_ref(&op), 0)?;
        if self.runtime.rules.len() >= 1000 {
            return Err(("RESOURCE_LIMIT", "Rule budget exceeded".into()));
        }
        if self
            .runtime
            .rules
            .iter()
            .any(|r| r.definition["id"] == op["id"])
        {
            return Err(invalid("Rule ID already registered"));
        }
        self.runtime.rules.push(Rule {
            definition: op,
            origin,
            fired: false,
            next_eligible_tick: self.tick,
            subjects: Default::default(),
        });
        self.runtime.rules.sort_by(|a, b| {
            a.definition["id"]
                .as_str()
                .cmp(&b.definition["id"].as_str())
        });
        Ok(())
    }
    pub fn record_event(
        &mut self,
        name: &str,
        source: Option<Value>,
        data: Option<Value>,
        origin: Option<Value>,
    ) -> Result<(), Failure> {
        if self.events.len() >= 10000 {
            return Err(("RESOURCE_LIMIT", "Event retention budget exceeded".into()));
        }
        let id = crate::goals::allocate(&mut self.allocations.next_event, "event")?;
        let mut event = json!({"id":id,"tick":self.tick,"time":self.time(),"name":name});
        if let Some(v) = source {
            event["source"] = v;
        }
        if let Some(v) = data {
            event["data"] = v;
        }
        if let Some(v) = origin {
            event["origin"] = v;
        }
        self.events.push(event);
        Ok(())
    }
    pub fn operation_batch(
        &mut self,
        ops: &[Value],
        origin: &Value,
        key: &str,
    ) -> Result<(), Failure> {
        let mut candidate = self.clone();
        let mut work = 0;
        candidate.execute_operations(ops, origin, key, &mut work)?;
        candidate.prepare_navigation()?;
        *self = candidate;
        Ok(())
    }
    pub fn pump(&mut self) -> Result<(), Failure> {
        self.runtime.work = 0;
        let mut cascades = 0;
        let mut selector_work = 0;
        loop {
            if self.events.len() > 10000 {
                return Err(("RESOURCE_LIMIT", "Event retention budget exceeded".into()));
            }
            if self
                .runtime
                .jobs
                .first()
                .is_some_and(|j| j.due_tick <= self.tick)
            {
                cascades += 1;
                if cascades > 100 {
                    return Err(("RESOURCE_LIMIT", "Rule/job cascade budget exceeded".into()));
                }
                let job = self.runtime.jobs.remove(0);
                let mut origin = job.origin.clone();
                origin["parentJobId"] = json!(job.id);
                if let Err((code, message)) =
                    self.operation_batch(&job.operations, &origin, &format!("job:{}", job.id.0))
                {
                    self.record_event(
                        "job_failed",
                        Some(json!(job.id)),
                        Some(json!({"code":code,"message":message})),
                        Some(origin),
                    )?;
                }
                continue;
            }
            let event = if self.runtime.processed_events < self.events.len() {
                let e = self.events[self.runtime.processed_events].clone();
                self.runtime.processed_events += 1;
                Some(e)
            } else {
                None
            };
            let mut fired = false;
            let rules = self.runtime.rules.clone();
            for r in rules {
                if !self
                    .runtime
                    .rules
                    .iter()
                    .any(|live| live.definition["id"] == r.definition["id"])
                {
                    continue;
                }
                let op = &r.definition;
                let when = &op["when"];
                if r.next_eligible_tick > self.tick || r.fired && op["once"] != false {
                    continue;
                }
                let id = sel::id(&op["id"])?;
                let matched = match when["kind"].as_str().unwrap() {
                    "event" => event.as_ref().is_some_and(|e| e["name"] == when["name"]),
                    "time" => {
                        event.is_none()
                            && sel::compare(
                                &json!(self.time()),
                                when["comparison"].as_str().unwrap(),
                                &when["value"],
                            )
                    }
                    "count" => {
                        event.is_none() && {
                            let n = sel::resolve(
                                self,
                                &when["targets"],
                                &format!("rule:{}", id.0),
                                &mut selector_work,
                            )?
                            .len();
                            sel::compare(
                                &json!(n),
                                when["comparison"].as_str().unwrap(),
                                &when["value"],
                            )
                        }
                    }
                    _ => false,
                };
                if !matched {
                    continue;
                }
                cascades += 1;
                if cascades > 100 {
                    return Err(("RESOURCE_LIMIT", "Rule/job cascade budget exceeded".into()));
                }
                let cooldown = op
                    .get("cooldown")
                    .map(sel::number)
                    .transpose()?
                    .unwrap_or(self.initial.scene.model.dt.0);
                let next = self
                    .tick
                    .checked_add(self.due_tick(cooldown)?.max(1))
                    .filter(|n| *n <= 9_007_199_254_740_991)
                    .ok_or_else(|| invalid("Cooldown exceeds tick range"))?;
                let live = self
                    .runtime
                    .rules
                    .iter_mut()
                    .find(|r| r.definition["id"] == op["id"])
                    .unwrap();
                live.fired = true;
                live.next_eligible_tick = next;
                let mut origin = r.origin.clone();
                origin["parentRuleId"] = json!(id);
                if let Err((code, message)) = self.operation_batch(
                    operations::array(&op["operations"])?,
                    &origin,
                    &format!("rule:{}", id.0),
                ) {
                    self.record_event(
                        "rule_failed",
                        Some(json!(id)),
                        Some(json!({"code":code,"message":message})),
                        Some(origin),
                    )?;
                }
                fired = true;
            }
            if event.is_some()
                || fired
                || self
                    .runtime
                    .jobs
                    .first()
                    .is_some_and(|j| j.due_tick <= self.tick)
            {
                continue;
            }
            break;
        }
        Ok(())
    }
}
