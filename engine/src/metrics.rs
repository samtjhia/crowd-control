//! metrics-v1: half-second history, cell-centre density, one-second portal windows.
use crate::{
    core::{Failure, invalid},
    protocol::*,
    selectors as sel,
    world::World,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub const SAMPLE_SECONDS: f64 = 0.5;
pub const PORTAL_WINDOW: f64 = 1.0;
const MAX_RECORDS: usize = 100_000;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QueueTotal {
    pub target_id: Id,
    pub length: usize,
    pub served: u64,
    pub total_wait: f64,
    pub maximum_wait: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Crossing {
    pub portal_id: Id,
    pub agent_id: Id,
    pub at: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Visit {
    portal_id: Id,
    from_zone: Option<Id>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ZoneSample {
    pub zone_id: Id,
    pub occupancy: usize,
    pub density: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortalSample {
    pub portal_id: Id,
    pub crossed: usize,
    pub flow_rate: f64,
    pub window_seconds: f64,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClearanceTimes {
    pub t50: Option<f64>,
    pub t90: Option<f64>,
    pub t100: Option<f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Sample {
    pub time: f64,
    pub present: usize,
    pub departed: usize,
    pub blocked: usize,
    pub immobile: usize,
    pub removed: u64,
    pub zones: Vec<ZoneSample>,
    pub portals: Vec<PortalSample>,
    pub queues: Vec<QueueTotal>,
    pub clearance: ClearanceTimes,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Metrics {
    pub samples: Vec<Sample>,
    pub portal_crossings: Vec<Crossing>,
    pub queue_totals: BTreeMap<Id, QueueTotal>,
    pub clearance: Option<ClearanceCohort>,
    visits: BTreeMap<Id, Visit>,
    portal_totals: BTreeMap<Id, usize>,
    pub retained_records: usize,
    #[serde(skip)]
    areas: Vec<f64>,
    #[serde(skip)]
    area_topology: Option<u64>,
}
pub struct Checkpoint {
    samples: usize,
    crossings: usize,
    queues: BTreeMap<Id, QueueTotal>,
    visits: BTreeMap<Id, Visit>,
    portal_totals: BTreeMap<Id, usize>,
    retained: usize,
}
impl Metrics {
    pub fn checkpoint(&self) -> Checkpoint {
        Checkpoint {
            samples: self.samples.len(),
            crossings: self.portal_crossings.len(),
            queues: self.queue_totals.clone(),
            visits: self.visits.clone(),
            portal_totals: self.portal_totals.clone(),
            retained: self.retained_records,
        }
    }
    pub fn rollback(&mut self, c: Checkpoint) {
        self.samples.truncate(c.samples);
        self.portal_crossings.truncate(c.crossings);
        self.queue_totals = c.queues;
        self.visits = c.visits;
        self.portal_totals = c.portal_totals;
        self.retained_records = c.retained;
        self.areas.clear();
        self.area_topology = None;
    }
    pub fn forget_agent(&mut self, id: &Id) {
        self.visits.remove(id);
    }
    pub fn admitted(&mut self, id: &Id, wait: f64) -> Result<(), Failure> {
        let q = self
            .queue_totals
            .entry(id.clone())
            .or_insert_with(|| QueueTotal::new(id.clone()));
        q.served = q
            .served
            .checked_add(1)
            .filter(|n| *n <= 9_007_199_254_740_991)
            .ok_or_else(|| invalid("Queue metric counter exhausted"))?;
        q.total_wait += wait.max(0.0);
        q.maximum_wait = q.maximum_wait.max(wait.max(0.0));
        if !q.total_wait.is_finite() {
            return Err(("RESOURCE_LIMIT", "Queue wait sum overflow".into()));
        }
        Ok(())
    }
    pub fn transition(
        &mut self,
        grid: &crate::grid::GridData,
        id: &Id,
        from: usize,
        to: usize,
        at: f64,
    ) -> Result<(), Failure> {
        let old = grid.portal_index[from];
        let new = grid.portal_index[to];
        if old == new {
            return Ok(());
        }
        if old != 0 {
            if let Some(v) = self.visits.remove(id) {
                let end = &grid.zone_ids[grid.zone_index[to] as usize];
                if v.from_zone.is_some()
                    && end.is_some()
                    && v.from_zone != *end
                    && v.portal_id == *grid.portal_ids[old as usize].as_ref().unwrap()
                {
                    if self.retained_records >= MAX_RECORDS {
                        return Err(("RESOURCE_LIMIT", "Metric retention budget exceeded".into()));
                    }
                    *self.portal_totals.entry(v.portal_id.clone()).or_default() += 1;
                    self.portal_crossings.push(Crossing {
                        portal_id: v.portal_id,
                        agent_id: id.clone(),
                        at,
                    });
                    self.retained_records += 1;
                }
            }
        }
        if new != 0 {
            self.visits.insert(
                id.clone(),
                Visit {
                    portal_id: grid.portal_ids[new as usize].clone().unwrap(),
                    from_zone: grid.zone_ids[grid.zone_index[from] as usize].clone(),
                },
            );
        }
        Ok(())
    }
}
fn usable_areas(grid: &crate::grid::GridData) -> Vec<f64> {
    let mut area = vec![0.0; grid.zone_ids.len()];
    let size = grid.cell_size * grid.cell_size;
    for (i, z) in grid.zone_index.iter().enumerate() {
        if grid.blocked[i] == 0 {
            area[*z as usize] += size;
        }
    }
    area
}
impl World {
    pub fn refresh_metric_geometry(&mut self) {
        self.metrics.areas = usable_areas(&self.grid);
        self.metrics.area_topology = Some(self.topology_version);
        self.metrics.visits.retain(|_, v| {
            self.grid
                .portal_ids
                .iter()
                .flatten()
                .any(|id| id == &v.portal_id)
        });
    }
    fn metric_areas(&self) -> std::borrow::Cow<'_, [f64]> {
        if self.metrics.area_topology == Some(self.topology_version)
            && self.metrics.areas.len() == self.grid.zone_ids.len()
        {
            std::borrow::Cow::Borrowed(&self.metrics.areas)
        } else {
            std::borrow::Cow::Owned(usable_areas(&self.grid))
        }
    }
    pub fn zone_metrics(&self) -> Vec<ZoneSample> {
        let areas = self.metric_areas();
        let mut counts = vec![0usize; self.grid.zone_ids.len()];
        for a in self.agents.iter().filter(|a| a.departed_at.is_none()) {
            let cell = crate::navigation::index(&self.grid, &a.position);
            counts[self.grid.zone_index[cell] as usize] += 1;
        }
        self.grid
            .zone_ids
            .iter()
            .enumerate()
            .skip(1)
            .map(|(i, id)| ZoneSample {
                zone_id: id.clone().unwrap(),
                occupancy: counts[i],
                density: if areas[i] > 0.0 {
                    counts[i] as f64 / areas[i]
                } else {
                    0.0
                },
            })
            .collect()
    }
    fn clearance_times(&self) -> ClearanceTimes {
        let Some(c) = &self.metrics.clearance else {
            return Default::default();
        };
        if self.time() < c.started_at.0 {
            return Default::default();
        }
        let ids: BTreeSet<_> = c.cohort_ids.iter().collect();
        let mut at: Vec<f64> = self
            .departures
            .iter()
            .filter_map(|d| {
                let id = sel::id(&d["agentId"]).ok()?;
                ids.contains(&id)
                    .then(|| (d["at"].as_f64().unwrap() - c.started_at.0).max(0.0))
            })
            .collect();
        at.sort_by(f64::total_cmp);
        let threshold = |part: f64| {
            let n = (ids.len() as f64 * part).ceil() as usize;
            at.get(n.saturating_sub(1)).copied()
        };
        ClearanceTimes {
            t50: threshold(0.5),
            t90: threshold(0.9),
            t100: threshold(1.0),
        }
    }
    pub fn metric_sample(&self) -> Sample {
        let mut recent = BTreeMap::<&Id, usize>::new();
        let first = self
            .metrics
            .portal_crossings
            .partition_point(|c| c.at <= self.time() - PORTAL_WINDOW);
        for c in &self.metrics.portal_crossings[first..] {
            if c.at <= self.time() {
                *recent.entry(&c.portal_id).or_default() += 1;
            }
        }
        let portals = self
            .grid
            .portal_ids
            .iter()
            .flatten()
            .map(|id| PortalSample {
                portal_id: id.clone(),
                crossed: *self.metrics.portal_totals.get(id).unwrap_or(&0),
                flow_rate: *recent.get(id).unwrap_or(&0) as f64 / PORTAL_WINDOW,
                window_seconds: PORTAL_WINDOW,
            })
            .collect();
        let mut queues = self.metrics.queue_totals.clone();
        for q in &self.queues {
            queues
                .entry(q.target_id.clone())
                .or_insert_with(|| QueueTotal::new(q.target_id.clone()))
                .length = q.entries.len();
        }
        let present = self.agents.iter().filter(|a| a.departed_at.is_none());
        Sample {
            time: self.time(),
            present: present.clone().count(),
            departed: self.departures.len(),
            blocked: present
                .clone()
                .filter(|a| {
                    a.state == "blocked"
                        || (a.state == "waiting"
                            && a.state_reason.as_deref() == Some("movement-obstructed"))
                })
                .count(),
            immobile: present
                .filter(|a| {
                    a.components.mobility.speed_multiplier.0 == 0.0 || a.state == "immobile"
                })
                .count(),
            removed: self.removed_count,
            zones: self.zone_metrics(),
            portals,
            queues: queues.into_values().collect(),
            clearance: self.clearance_times(),
        }
    }
    pub fn density_grid(&self) -> Value {
        let mut values = vec![0.0; self.grid.blocked.len()];
        let area = self.grid.cell_size * self.grid.cell_size;
        for a in self.agents.iter().filter(|a| a.departed_at.is_none()) {
            let i = crate::navigation::index(&self.grid, &a.position);
            if self.grid.blocked[i] == 0 {
                values[i] += 1.0 / area;
            }
        }
        json!({"width":self.grid.width,"height":self.grid.height,"cellSize":self.grid.cell_size,"origin":{"x":0,"y":0},"units":if self.grid.units==Units::Metres{"people/m2"}else{"people/model-unit2"},"values":values})
    }
    pub fn metric_period(&self) -> u64 {
        (SAMPLE_SECONDS / self.initial.scene.model.dt.0)
            .ceil()
            .max(1.0)
            .min(9_007_199_254_740_991.0) as u64
    }
    pub fn capture_metrics(&mut self) -> Result<(), Failure> {
        if self.tick % self.metric_period() != 0 {
            return Ok(());
        }
        if self
            .metrics
            .samples
            .last()
            .is_some_and(|s| s.time == self.time())
        {
            return Ok(());
        }
        let sample = self.metric_sample();
        let records = 1 + sample.zones.len() + sample.portals.len() + sample.queues.len();
        if self.metrics.retained_records.saturating_add(records) > MAX_RECORDS {
            return Err((
                "RESOURCE_LIMIT",
                "Metric retention budget exceeded; export/reset before continuing".into(),
            ));
        }

        self.metrics.retained_records += records;
        self.metrics.samples.push(sample);
        Ok(())
    }
    pub fn metrics_snapshot(&self) -> Value {
        let queues = self.metric_sample().queues;
        json!({"samples":self.metrics.samples,"departures":self.departures,"removedCount":self.removed_count,"portalCrossings":self.metrics.portal_crossings,"portalVisits":self.metrics.visits.iter().map(|(agent,v)|json!({"agentId":agent,"portalId":v.portal_id,"fromZone":v.from_zone})).collect::<Vec<_>>(),"queueTotals":queues,"clearance":self.metrics.clearance})
    }
    pub fn read_query(&self, q: &Value) -> Result<Value, Failure> {
        let kind = q["kind"]
            .as_str()
            .ok_or_else(|| invalid("Query needs kind"))?;
        let fields: &[&str] = match kind {
            "inventory" | "history" => &["kind"],
            "agents" => &["kind", "targets"],
            "metrics" => &["kind", "from", "to", "zones"],
            "events" => &["kind", "from", "to", "names"],
            _ => return Err(invalid("Unknown query kind")),
        };
        sel::keys(q, fields, &["kind"])?;
        for k in ["from", "to"] {
            if let Some(v) = q.get(k) {
                sel::number(v)?;
            }
        }
        if q.get("from").is_some()
            && q.get("to").is_some()
            && sel::number(&q["from"])? > sel::number(&q["to"])?
        {
            return Err(invalid("Reversed query range"));
        }
        let sample_from = q.get("from").map_or(0, |v| {
            self.metrics
                .samples
                .partition_point(|s| s.time < v.as_f64().unwrap())
        });
        let sample_to = q.get("to").map_or(self.metrics.samples.len(), |v| {
            self.metrics
                .samples
                .partition_point(|s| s.time <= v.as_f64().unwrap())
        });
        let list = |key: &str| -> Result<Option<BTreeSet<Id>>, Failure> {
            q.get(key)
                .map(|v| {
                    let ids: Vec<Id> =
                        serde_json::from_value(v.clone()).map_err(|e| invalid(e.to_string()))?;
                    if ids.len() > 4096 {
                        return Err(("RESOURCE_LIMIT", "Query filter exceeds 4096 IDs".into()));
                    }
                    Ok(ids.into_iter().collect())
                })
                .transpose()
        };
        let in_range = |at: f64| {
            q.get("from").is_none_or(|v| at >= v.as_f64().unwrap())
                && q.get("to").is_none_or(|v| at <= v.as_f64().unwrap())
        };
        let result = match kind {
            "history" => json!({"kind":"history","history":self.history}),
            "inventory" => {
                json!({"kind":"inventory","items":sel::records(self).values().map(|r|{let mut v=json!({"id":r["id"],"kind":r["kind"],"tags":r.get("tags").cloned().unwrap_or(json!([])),"componentNames":r["components"].as_object().map(|c|c.keys().cloned().collect::<Vec<_>>()).unwrap_or_default()});if let Some(l)=r.get("label"){v["label"]=l.clone();}v}).collect::<Vec<_>>()})
            }
            "agents" => {
                let ids = sel::read(
                    self,
                    q.get("targets")
                        .ok_or_else(|| invalid("Agents query needs targets"))?,
                )?;
                json!({"kind":"agents","agents":self.agents.iter().filter(|a|ids.contains(&a.id)).collect::<Vec<_>>()})
            }
            "events" => {
                let names = list("names")?;
                json!({"kind":"events","events":self.events.iter().filter(|e|in_range(e["time"].as_f64().unwrap())&&names.as_ref().is_none_or(|names|names.iter().any(|n|e["name"]==json!(n)))).collect::<Vec<_>>()})
            }
            "metrics" => {
                let zones = list("zones")?;
                let samples: Vec<Sample> = self.metrics.samples[sample_from..sample_to]
                    .iter()
                    .map(|s| {
                        let mut s = s.clone();
                        if let Some(zones) = &zones {
                            s.zones.retain(|z| zones.contains(&z.zone_id));
                        }
                        s
                    })
                    .collect();
                json!({"kind":"metrics","samples":samples})
            }
            _ => unreachable!(),
        };
        reply_budget(&result)?;
        Ok(result)
    }
    pub fn condition_density(
        &mut self,
        selector: &Value,
        key: &str,
        work: &mut usize,
    ) -> Result<Option<f64>, Failure> {
        let ids = sel::resolve(self, selector, key, work)?;
        if ids.is_empty() {
            return Ok(None);
        }
        let zones = self.zone_metrics();
        let mut sum = 0usize;
        let mut area = 0.0;
        let areas = self.metric_areas();
        for id in ids {
            let Some(z) = zones.iter().find(|z| z.zone_id == id) else {
                return Err(invalid("Density targets must be zones"));
            };
            let i = self
                .grid
                .zone_ids
                .iter()
                .position(|z| z.as_ref() == Some(&id))
                .unwrap();
            sum += z.occupancy;
            area += areas[i];
        }
        Ok((area > 0.0).then(|| sum as f64 / area))
    }
}
impl QueueTotal {
    fn new(target_id: Id) -> Self {
        Self {
            target_id,
            length: 0,
            served: 0,
            total_wait: 0.0,
            maximum_wait: 0.0,
        }
    }
}

fn reply_budget(value: &Value) -> Result<(), Failure> {
    let mut stack = vec![value];
    let mut count = 0;
    while let Some(v) = stack.pop() {
        count += 1;
        if count > 900000 {
            return Err((
                "RESOURCE_LIMIT",
                "Query reply exceeds transport budget; narrow the time range or selector".into(),
            ));
        }
        match v {
            Value::Array(a) => stack.extend(a),
            Value::Object(o) => stack.extend(o.values()),
            _ => (),
        }
    }
    if serde_json::to_vec(value).unwrap().len() > 31 * 1024 * 1024 {
        return Err((
            "RESOURCE_LIMIT",
            "Query reply exceeds byte budget; narrow the time range or selector".into(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stopped_agent_does_not_retain_a_blocked_count_from_its_old_reason() {
        let input: Value = serde_json::from_str(include_str!(
            "../../contract/fixtures/engine-static-load.json"
        ))
        .unwrap();
        let mut world = World::load(
            serde_json::from_value(input["compiled"].clone()).unwrap(),
            &Id("engine-demo".into()),
        )
        .unwrap();
        world.agents[0].state = "waiting".into();
        world.agents[0].state_reason = Some("movement-obstructed".into());
        assert_eq!(world.metric_sample().blocked, 1);
        let request = json!({"schemaVersion":1,"simulationId":"engine-demo","requestId":"stop","operations":[{"op":"set","targets":{"ids":["a1"]},"values":{"components":{"mobility":{"speedMultiplier":0}}}}]});
        assert_eq!(world.apply_request(&request).unwrap()["ok"], true);
        assert_eq!(world.metric_sample().immobile, 1);
        assert_eq!(world.metric_sample().blocked, 0);
    }
    #[test]
    fn large_replies_fail_explicitly() {
        let v = json!(vec![0; 900001]);
        assert_eq!(reply_budget(&v).unwrap_err().0, "RESOURCE_LIMIT");
        assert!(reply_budget(&json!({"samples":[]})).is_ok());
    }
}
