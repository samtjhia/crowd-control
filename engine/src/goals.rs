//! Per-agent goal progress and authoritative FIFO/interaction claims.
use crate::{
    core::{Failure, invalid, unsupported},
    geometry,
    grid::GridData,
    navigation::{self, Intent},
    protocol::*,
    random, shapes,
    world::World,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

pub fn parse(raw: &Value) -> Result<GoalSpec, Failure> {
    fn check(v: &Value, depth: usize, count: &mut usize) -> Result<(), Failure> {
        *count += 1;
        if depth > 8 || *count > 1024 {
            return Err(("RESOURCE_LIMIT", "Goal nesting/node budget exceeded".into()));
        }
        let fields: &[&str] = match v["kind"].as_str() {
            Some("reach") => &[
                "targetZone",
                "targetEntityId",
                "targetIds",
                "selection",
                "stopDistance",
                "urgency",
                "departOnArrival",
            ],
            Some("avoid") => &[
                "targetZone",
                "targetEntityId",
                "targetIds",
                "distance",
                "urgency",
            ],
            Some("wait") => &["duration", "insideZone"],
            Some("wander") => &["insideZone", "duration", "changeTargetEvery"],
            Some("follow") => &["targetEntityId", "distance"],
            Some("queue") => &["targetEntityId", "maximumWait"],
            Some("interact") => &["targetEntityId"],
            Some("sequence") => &["goals", "repeat"],
            _ => return Err(unsupported("Unknown goal kind")),
        };
        if v.as_object().is_none_or(|o| {
            o.keys()
                .any(|k| k != "kind" && !fields.contains(&k.as_str()))
        }) {
            return Err(invalid("Unexpected goal fields"));
        }
        let g: GoalSpec = serde_json::from_value(v.clone()).map_err(|e| invalid(e.to_string()))?;
        match g.kind {
            GoalKind::Reach | GoalKind::Avoid => {
                if usize::from(g.target_zone.is_some())
                    + usize::from(g.target_entity_id.is_some())
                    + usize::from(g.target_ids.is_some())
                    != 1
                {
                    return Err(invalid("Goal needs exactly one destination form"));
                }
                if g.target_ids
                    .as_ref()
                    .is_some_and(|v| v.is_empty() || v.len() > 64)
                {
                    return Err(("RESOURCE_LIMIT", "Goal requires 1–64 targets".into()));
                }
                if matches!(g.kind, GoalKind::Avoid) && g.distance.is_none() {
                    return Err(invalid("Avoid requires distance"));
                }
            }
            GoalKind::Wait => {
                if g.duration.is_none() {
                    return Err(invalid("Wait requires duration"));
                }
            }
            GoalKind::Wander => {
                if g.inside_zone.is_none() {
                    return Err(invalid("Wander requires insideZone"));
                }
            }
            GoalKind::Follow | GoalKind::Queue | GoalKind::Interact => {
                if g.target_entity_id.is_none()
                    || (matches!(g.kind, GoalKind::Follow) && g.distance.is_none())
                {
                    return Err(invalid("Missing goal destination/distance"));
                }
            }
            GoalKind::Sequence => {
                if g.goals.as_ref().is_none_or(Vec::is_empty)
                    || g.repeat.is_some_and(|r| r.0 < 1.0 || r.0 > 10000.0)
                {
                    return Err(invalid("Sequence needs children and repeat in 1–10000"));
                }
                for child in v["goals"].as_array().unwrap() {
                    check(child, depth + 1, count)?;
                }
            }
        }
        Ok(())
    }
    check(raw, 0, &mut 0)?;
    serde_json::from_value(raw.clone()).map_err(|e| invalid(e.to_string()))
}
pub fn validate(
    g: &GoalSpec,
    map: &Map,
    grid: &GridData,
    agents: &BTreeSet<Id>,
) -> Result<(), Failure> {
    if let Some(children) = &g.goals {
        for child in children {
            validate(child, map, grid, agents)?;
        }
        return Ok(());
    }
    if g.inside_zone
        .as_ref()
        .is_some_and(|id| !grid.zone_ids.contains(&Some(id.clone())))
    {
        return Err(("NOT_FOUND", "Unknown inside zone".into()));
    }
    let portals = map.all_portals()?;
    if g.target_zone.is_some() || g.target_entity_id.is_some() || g.target_ids.is_some() {
        for id in navigation::candidates(g) {
            let is_agent = agents.contains(&id);
            if !is_agent
                && !grid.zone_ids.contains(&Some(id.clone()))
                && !portals.iter().any(|p| p.id == id)
                && !map.entities().iter().any(|e| e.id == id)
            {
                return Err(("NOT_FOUND", format!("Unknown goal target {}", id.0)));
            }
            if g.target_zone.is_some() && !grid.zone_ids.contains(&Some(id.clone())) {
                return Err(invalid("targetZone must be a zone"));
            }
            if g.depart_on_arrival == Some(true) && is_agent {
                return Err(invalid("Departure requires a static destination"));
            }
            let e = map.entities().iter().find(|e| e.id == id);
            if matches!(g.kind, GoalKind::Queue)
                && !portals.iter().any(|p| p.id == id)
                && e.and_then(Entity::capacity).is_none()
            {
                return Err(invalid("Queue target needs capacity or portal components"));
            }
            if matches!(g.kind, GoalKind::Interact) && e.and_then(Entity::interaction).is_none() {
                return Err(invalid("Interact target needs interaction components"));
            }
        }
    }
    Ok(())
}
pub fn leaf(a: &AgentRuntime) -> Option<&GoalSpec> {
    let runtime = a.current_goal.as_ref()?;
    let mut g = &runtime.spec;
    for frame in &runtime.cursor {
        g = g.goals.as_ref()?.get(frame.child_index.0 as usize)?;
    }
    if matches!(g.kind, GoalKind::Sequence) {
        None
    } else {
        Some(g)
    }
}
pub fn fresh() -> GoalExecution {
    GoalExecution {
        phase: "new".into(),
        elapsed: Nonnegative(0.0),
        target_point: None,
    }
}
pub fn nodes(g: &GoalSpec) -> usize {
    1 + g.goals.as_ref().map_or(0, |v| v.iter().map(nodes).sum())
}
pub fn zero(a: &mut AgentRuntime) {
    a.velocity = Point {
        x: Number(0.0),
        y: Number(0.0),
    };
}
pub fn reset_route(a: &mut AgentRuntime) {
    a.navigation.target_entity_id = None;
    a.navigation.target_point = None;
    a.navigation.flow_field_id = None;
    a.timers.wait_remaining = Nonnegative(0.0);
}
fn descend(r: &mut GoalRuntime) {
    loop {
        let mut g = &r.spec;
        for f in &r.cursor {
            g = &g.goals.as_ref().unwrap()[f.child_index.0 as usize];
        }
        if !matches!(g.kind, GoalKind::Sequence) {
            break;
        }
        r.cursor.push(GoalCursor {
            child_index: Counter(0.0),
            repeats_remaining: g.repeat.unwrap_or(Counter(1.0)),
        });
    }
}
pub fn install(spec: GoalSpec, id: Id, now: f64, pending: bool) -> GoalRuntime {
    let mut r = GoalRuntime {
        id,
        spec,
        status: if pending { "pending" } else { "active" }.into(),
        cursor: vec![],
        started_at: (!pending).then_some(Nonnegative(now)),
        failure: None,
        execution: Some(fresh()),
    };
    descend(&mut r);
    r
}
fn activate(a: &mut AgentRuntime, now: f64) {
    if let Some(failure) = a.current_goal.as_ref().and_then(|g| g.failure.clone()) {
        fail(a, &failure.code, &failure.message);
        return;
    }
    if let Some(r) = &mut a.current_goal {
        r.status = if a.components.mobility.speed_multiplier.0 == 0.0 {
            "suspended"
        } else {
            "active"
        }
        .into();
        r.started_at = Some(Nonnegative(now));
    }
    a.state_reason = None;
    a.state = if a.components.mobility.speed_multiplier.0 == 0.0 {
        "immobile"
    } else if a.components.behavior.reaction_delay.0 > 0.0 {
        "reacting"
    } else {
        "waiting"
    }
    .into();
    a.timers.reaction_remaining = a.components.behavior.reaction_delay;
    a.timers.wander_refresh_remaining = None;
    reset_route(a);
    zero(a);
}
pub fn release(
    a: &mut AgentRuntime,
    queues: &mut [QueueRuntime],
    slots: &mut [SlotsRuntime],
    restart: bool,
) {
    let service = a.queue_ref.is_some() || a.interaction_ref.is_some();
    for q in queues {
        q.entries.retain(|e| e.agent_id != a.id);
        if q.entries.is_empty() {
            q.service_credit = Nonnegative(0.0);
        }
    }
    for s in slots {
        for slot in &mut s.slots {
            if slot.agent_id.as_ref() == Some(&a.id) {
                slot.agent_id = None;
                slot.ends_at = None;
            }
        }
    }
    a.queue_ref = None;
    a.interaction_ref = None;
    if restart && service {
        if let Some(r) = &mut a.current_goal {
            r.execution = Some(fresh());
        }
        reset_route(a);
    }
}
pub fn fail(a: &mut AgentRuntime, code: &str, message: &str) {
    if let Some(r) = &mut a.current_goal {
        r.status = "failed".into();
        r.failure = Some(GoalFailure {
            code: code.into(),
            message: message.into(),
        });
    }
    a.state = "failed".into();
    a.state_reason = Some(message.into());
    zero(a);
    reset_route(a);
}
fn next_leaf(a: &mut AgentRuntime, now: f64) -> bool {
    let selected = a.navigation.target_entity_id.clone();
    reset_route(a);
    a.timers.wander_refresh_remaining = None;
    let r = a.current_goal.as_mut().unwrap();
    let finished_execution = r.execution.replace(fresh());
    while !r.cursor.is_empty() {
        let level = r.cursor.len() - 1;
        let mut node = &r.spec;
        for f in r.cursor.iter().take(level) {
            node = &node.goals.as_ref().unwrap()[f.child_index.0 as usize];
        }
        let count = node.goals.as_ref().unwrap().len();
        let f = &mut r.cursor[level];
        if f.child_index.0 + 1.0 < count as f64 {
            f.child_index.0 += 1.0;
            descend(r);
            return true;
        }
        if f.repeats_remaining.0 > 1.0 {
            f.repeats_remaining.0 -= 1.0;
            f.child_index = Counter(0.0);
            descend(r);
            return true;
        }
        r.cursor.pop();
    }
    r.execution = finished_execution;
    r.status = "completed".into();
    a.navigation.target_entity_id = selected;
    a.state = "idle".into();
    zero(a);
    if !a.goal_queue.is_empty() {
        a.current_goal = Some(a.goal_queue.remove(0));
        a.controller = None;
        activate(a, now);
        return true;
    }
    false
}
struct Context<'a> {
    grid: &'a GridData,
    work: &'a mut usize,
    zone_cells: &'a [Vec<usize>],
    map: &'a Map,
    before: &'a [AgentRuntime],
    after: &'a [AgentRuntime],
    queues: &'a mut Vec<QueueRuntime>,
    slots: &'a mut Vec<SlotsRuntime>,
    allocations: &'a mut Allocation,
    metrics: &'a mut crate::metrics::Metrics,
    now: f64,
    dt: f64,
    admitted: &'a mut BTreeMap<Id, usize>,
    admitted_agents: &'a mut BTreeSet<Id>,
}
impl Context<'_> {
    fn other(&self, id: &Id) -> Option<&AgentRuntime> {
        self.before
            .iter()
            .chain(self.after)
            .find(|a| &a.id == id && a.departed_at.is_none())
    }
    fn distance(&self, id: &Id, p: &Point) -> f64 {
        if let Some(a) = self.other(id) {
            return geometry::distance(p, &a.position);
        }
        if let Some(e) = self.map.entities().iter().find(|e| &e.id == id) {
            if e.shape.is_some() {
                return shapes::distance(e, p);
            }
        }
        let zone = self
            .grid
            .zone_ids
            .iter()
            .position(|x| x.as_ref() == Some(id));
        let portal = self
            .grid
            .portal_ids
            .iter()
            .position(|x| x.as_ref() == Some(id));
        (0..self.grid.blocked.len())
            .filter(|i| {
                zone.is_some_and(|z| self.grid.zone_index[*i] as usize == z)
                    || portal.is_some_and(|z| self.grid.portal_index[*i] as usize == z)
            })
            .map(|i| geometry::distance(p, &navigation::center(self.grid, i)))
            .fold(f64::INFINITY, f64::min)
    }
    fn near(&mut self, a: &AgentRuntime, id: &Id) -> Result<bool, Failure> {
        if let Some(p) = self.map.all_portals()?.iter().find(|p| &p.id == id) {
            if p.one_way == Some(true) && a.zone_id.as_ref() != Some(&p.connects[0]) {
                return Ok(false);
            }
        }
        shapes::approachable(
            self.grid,
            self.map,
            id,
            &a.position,
            a.components.physical.radius.0,
            self.work,
        )
    }
    fn capacity(&self, id: &Id) -> usize {
        self.map
            .entities()
            .iter()
            .find(|e| &e.id == id)
            .and_then(Entity::capacity)
            .map_or(1, |c| c.maximum_occupants.0 as usize)
    }
    fn occupied(&self, id: &Id) -> usize {
        let leases = self
            .slots
            .iter()
            .find(|s| &s.target_id == id)
            .map_or(0, |s| {
                s.slots.iter().filter(|s| s.agent_id.is_some()).count()
            });
        leases
            + self
                .before
                .iter()
                .chain(self.after)
                .filter(|a| {
                    a.departed_at.is_none()
                        && a.zone_id.as_ref() == Some(id)
                        && a.interaction_ref
                            .as_ref()
                            .is_none_or(|r| &r.target_id != id)
                })
                .count()
    }
    fn queue(&mut self, a: &mut AgentRuntime, g: &GoalSpec) -> Result<bool, Failure> {
        let id = g.target_entity_id.as_ref().unwrap();
        if a.queue_ref.is_none() {
            let ticket = allocate(&mut self.allocations.next_ticket, "ticket")?;
            let entry = QueueEntry {
                ticket_id: ticket.clone(),
                agent_id: a.id.clone(),
                joined_at: Nonnegative(self.now),
            };
            let q = self.queues.iter_mut().find(|q| &q.target_id == id).unwrap();
            q.entries.push(entry);
            a.queue_ref = Some(QueueRef {
                target_id: id.clone(),
                ticket_id: ticket,
                joined_at: Nonnegative(self.now),
            });
            a.current_goal
                .as_mut()
                .unwrap()
                .execution
                .as_mut()
                .unwrap()
                .elapsed = Nonnegative(0.0);
        }
        a.state = "queueing".into();
        zero(a);
        let elapsed = a
            .current_goal
            .as_ref()
            .unwrap()
            .execution
            .as_ref()
            .unwrap()
            .elapsed
            .0;
        let portal = self.map.all_portals()?.into_iter().find(|p| &p.id == id);
        let open = portal.is_none_or(|p| p.open);
        let cap = self.capacity(id);
        let occupied = self.occupied(id);
        let free_slot = self
            .slots
            .iter()
            .find(|s| &s.target_id == id)
            .is_none_or(|s| s.slots.iter().any(|s| s.agent_id.is_none()));
        let q = self.queues.iter_mut().find(|q| &q.target_id == id).unwrap();
        let rate = self
            .map
            .entities()
            .iter()
            .find(|e| &e.id == id)
            .and_then(Entity::capacity)
            .and_then(|c| c.service_rate);
        if q.entries.first().is_some_and(|e| e.agent_id == a.id)
            && open
            && occupied < cap
            && *self.admitted.get(id).unwrap_or(&0) < cap
            && free_slot
            && rate.is_none_or(|_| q.service_credit.0 + 1e-9 >= 1.0)
        {
            let joined = q.entries.remove(0).joined_at.0;
            self.metrics.admitted(id, self.now - joined)?;
            if rate.is_some() {
                q.service_credit.0 = (q.service_credit.0 - 1.0).max(0.0);
            }
            a.queue_ref = None;
            *self.admitted.entry(id.clone()).or_default() += 1;
            self.admitted_agents.insert(a.id.clone());
            return Ok(true);
        }
        if g.maximum_wait
            .is_some_and(|w| elapsed + self.dt * 1e-9 >= w.0)
        {
            release(a, self.queues, self.slots, false);
            fail(a, "QUEUE_TIMEOUT", "Queue maximumWait expired");
            return Ok(false);
        }
        Ok(false)
    }
    fn interact(&mut self, a: &mut AgentRuntime, g: &GoalSpec) -> Result<bool, Failure> {
        let id = g.target_entity_id.as_ref().unwrap();
        a.state = "waiting".into();
        zero(a);
        if a.interaction_ref.is_none() {
            let occupied = self.occupied(id);
            let cap = self
                .map
                .entities()
                .iter()
                .find(|e| &e.id == id)
                .and_then(Entity::capacity)
                .map_or(usize::MAX, |c| c.maximum_occupants.0 as usize);
            if occupied >= cap
                || (!self.admitted_agents.contains(&a.id)
                    && self
                        .queues
                        .iter()
                        .any(|q| &q.target_id == id && !q.entries.is_empty()))
            {
                return Ok(false);
            }
            let duration = self
                .map
                .entities()
                .iter()
                .find(|e| &e.id == id)
                .unwrap()
                .interaction()
                .unwrap()
                .duration
                .0;
            let end = self.now + duration;
            if !end.is_finite() {
                return Err(("RESOURCE_LIMIT", "Interaction time range exceeded".into()));
            }
            if let Some(slot) = self
                .slots
                .iter_mut()
                .find(|s| &s.target_id == id)
                .unwrap()
                .slots
                .iter_mut()
                .find(|s| s.agent_id.is_none())
            {
                slot.agent_id = Some(a.id.clone());
                slot.ends_at = Some(Nonnegative(end));
                a.interaction_ref = Some(InteractionRef {
                    target_id: id.clone(),
                    slot_id: slot.id.clone(),
                    ends_at: Nonnegative(end),
                });
                a.current_goal
                    .as_mut()
                    .unwrap()
                    .execution
                    .as_mut()
                    .unwrap()
                    .elapsed = Nonnegative(0.0);
            } else {
                return Ok(false);
            }
        }
        a.state = "interacting".into();
        Ok(a.interaction_ref.as_ref().unwrap().ends_at.0 <= self.now + self.dt * 1e-9)
    }
}
pub fn allocate(counter: &mut Counter, prefix: &str) -> Result<Id, Failure> {
    let n = counter.0;
    if n >= 9_007_199_254_740_991.0 {
        return Err(("RESOURCE_LIMIT", "Allocation counter exhausted".into()));
    }
    counter.0 += 1.0;
    Ok(Id(format!("{prefix}-{n:.0}")))
}
impl World {
    pub fn initialize_services(&mut self) {
        self.queues = self
            .map_state
            .entities()
            .iter()
            .filter(|e| e.capacity().is_some())
            .map(|e| QueueRuntime {
                target_id: e.id.clone(),
                service_credit: Nonnegative(0.0),
                entries: vec![],
            })
            .collect();
        for p in self.map_state.all_portals().unwrap() {
            if !self.queues.iter().any(|q| q.target_id == p.id) {
                self.queues.push(QueueRuntime {
                    target_id: p.id,
                    service_credit: Nonnegative(0.0),
                    entries: vec![],
                });
            }
        }
        self.slots = self
            .map_state
            .entities()
            .iter()
            .enumerate()
            .filter_map(|(i, e)| {
                e.interaction().map(|n| SlotsRuntime {
                    target_id: e.id.clone(),
                    slots: (0..n.slots.0 as usize)
                        .map(|j| InteractionSlot {
                            id: Id(format!("slot-{i}-{j}")),
                            agent_id: None,
                            ends_at: None,
                        })
                        .collect(),
                })
            })
            .collect();
    }
    pub fn goal_intents(&self) -> Vec<Option<Intent>> {
        self.agents
            .iter()
            .map(|a| {
                if a.departed_at.is_some()
                    || a.components.mobility.speed_multiplier.0 == 0.0
                    || a.current_goal.as_ref().is_none_or(|r| r.status != "active")
                {
                    return None;
                }
                let g = leaf(a)?;
                let exec = a.current_goal.as_ref()?.execution.as_ref()?;
                if exec.phase == "arrived" || exec.phase == "active" {
                    return None;
                }
                let mut intent = Intent {
                    goal: g.clone(),
                    point: None,
                    local: false,
                };
                match g.kind {
                    GoalKind::Reach | GoalKind::Avoid => {}
                    GoalKind::Wait | GoalKind::Wander => {
                        let zone = g.inside_zone.as_ref()?;
                        if a.zone_id.as_ref() != Some(zone)
                            || (exec.phase == "travel" && exec.target_point.is_none())
                        {
                            intent.goal = reach(zone.clone());
                        } else if matches!(g.kind, GoalKind::Wander) {
                            intent.point = exec.target_point.clone();
                            intent.local = true;
                            if intent.point.is_none() {
                                return None;
                            }
                        } else {
                            return None;
                        }
                    }
                    GoalKind::Follow => {
                        intent.point = exec.target_point.clone();
                        if intent.point.is_none() {
                            return None;
                        }
                    }
                    GoalKind::Queue | GoalKind::Interact => {}
                    GoalKind::Sequence => return None,
                }
                Some(intent)
            })
            .collect()
    }
    pub fn before_goals(&mut self) -> Result<(), Failure> {
        let now = self.time();
        let dt = self.initial.scene.model.dt.0;
        if self.wander_cells.is_empty() {
            self.wander_cells = vec![vec![]; self.grid.zone_ids.len()];
            for (i, z) in self.grid.zone_index.iter().enumerate() {
                if *z != 0 && self.grid.blocked[i] == 0 {
                    self.wander_cells[*z as usize].push(i);
                }
            }
        }
        for q in &mut self.queues {
            if q.entries.is_empty() {
                q.service_credit = Nonnegative(0.0);
            } else if let Some(cap) = self
                .map_state
                .entities()
                .iter()
                .find(|e| e.id == q.target_id)
                .and_then(Entity::capacity)
            {
                if let Some(rate) = cap.service_rate {
                    q.service_credit.0 =
                        (q.service_credit.0 + rate.0 * dt).min(cap.maximum_occupants.0.max(1.0));
                }
            }
        }
        if self.grid.target_cells.is_empty() {
            self.grid.target_cells = shapes::validate_masks(&self.map_state, &self.grid)?;
        }
        let mut goal_work = 0;
        let mut admitted = BTreeMap::new();
        let mut admitted_agents = BTreeSet::new();
        for i in 0..self.agents.len() {
            let route = self.navigator.has_route(i);
            let (before, tail) = self.agents.split_at_mut(i);
            let (a, after) = tail.split_first_mut().unwrap();
            if a.departed_at.is_some() {
                continue;
            }
            if a.components.mobility.speed_multiplier.0 == 0.0 {
                release(a, &mut self.queues, &mut self.slots, true);
                continue;
            }
            if a.current_goal
                .as_ref()
                .is_none_or(|g| g.status == "completed")
                && !a.goal_queue.is_empty()
            {
                a.current_goal = Some(a.goal_queue.remove(0));
                a.controller = None;
                activate(a, now);
                self.navigator.prepared = false;
            }
            if a.current_goal
                .as_ref()
                .is_none_or(|g| g.status == "completed" || g.status == "failed")
            {
                continue;
            }
            if a.timers.reaction_remaining.0 > 0.0 {
                if !route {
                    a.timers.reaction_remaining.0 = countdown(a.timers.reaction_remaining.0, dt);
                    a.state = "reacting".into();
                    zero(a);
                }
                continue;
            }
            let mut ctx = Context {
                grid: &self.grid,
                work: &mut goal_work,
                zone_cells: &self.wander_cells,
                map: &self.map_state,
                before,
                after,
                queues: &mut self.queues,
                slots: &mut self.slots,
                allocations: &mut self.allocations,
                metrics: &mut self.metrics,
                now,
                dt,
                admitted: &mut admitted,
                admitted_agents: &mut admitted_agents,
            };
            for transition in 0..64 {
                if transition == 63 {
                    return Err((
                        "RESOURCE_LIMIT",
                        "Immediate goal transition budget exceeded".into(),
                    ));
                }
                if let Some(g) = leaf(a) {
                    if matches!(g.kind, GoalKind::Reach) && static_targets(g, ctx.grid, ctx.map) {
                        break;
                    }
                }
                let Some(g) = leaf(a).cloned() else {
                    return Err(invalid("Invalid goal cursor"));
                };
                if a.current_goal.as_ref().unwrap().execution.is_none() {
                    a.current_goal.as_mut().unwrap().execution = Some(fresh());
                }
                let phase = a
                    .current_goal
                    .as_ref()
                    .unwrap()
                    .execution
                    .as_ref()
                    .unwrap()
                    .phase
                    .clone();
                let mut done = false;
                match g.kind {
                    GoalKind::Reach => {
                        if navigation::candidates(&g)
                            .iter()
                            .any(|id| ctx.other(id).is_some())
                        {
                            self.navigator.prepared = false;
                        }
                    }
                    GoalKind::Wait => {
                        if g.inside_zone
                            .as_ref()
                            .is_some_and(|id| a.zone_id.as_ref() != Some(id))
                            && phase != "travel"
                        {
                            a.current_goal
                                .as_mut()
                                .unwrap()
                                .execution
                                .as_mut()
                                .unwrap()
                                .phase = "travel".into();
                            self.navigator.prepared = false;
                        }
                        if g.inside_zone
                            .as_ref()
                            .is_none_or(|id| a.zone_id.as_ref() == Some(id))
                            && phase != "travel"
                        {
                            if phase != "active" {
                                a.current_goal
                                    .as_mut()
                                    .unwrap()
                                    .execution
                                    .as_mut()
                                    .unwrap()
                                    .phase = "active".into();
                                self.navigator.prepared = false;
                            }
                            a.state = "waiting".into();
                            zero(a);
                            a.timers.wait_remaining = Nonnegative(
                                (g.duration.unwrap().0
                                    - a.current_goal
                                        .as_ref()
                                        .unwrap()
                                        .execution
                                        .as_ref()
                                        .unwrap()
                                        .elapsed
                                        .0)
                                    .max(0.0),
                            );
                            done = g.duration.unwrap().0
                                <= a.current_goal
                                    .as_ref()
                                    .unwrap()
                                    .execution
                                    .as_ref()
                                    .unwrap()
                                    .elapsed
                                    .0
                                    + dt * 1e-9;
                        }
                    }
                    GoalKind::Wander => {
                        if a.zone_id.as_ref() != g.inside_zone.as_ref() {
                            if phase != "travel" {
                                a.current_goal
                                    .as_mut()
                                    .unwrap()
                                    .execution
                                    .as_mut()
                                    .unwrap()
                                    .phase = "travel".into();
                                self.navigator.prepared = false;
                            }
                            break;
                        }
                        if phase == "travel"
                            && a.current_goal
                                .as_ref()
                                .unwrap()
                                .execution
                                .as_ref()
                                .unwrap()
                                .target_point
                                .is_none()
                        {
                            break;
                        }
                        let e = a.current_goal.as_mut().unwrap().execution.as_mut().unwrap();
                        if g.duration.is_some_and(|d| e.elapsed.0 + dt * 1e-9 >= d.0) {
                            done = true;
                        } else if a.zone_id.as_ref() == g.inside_zone.as_ref() {
                            if a.timers
                                .wander_refresh_remaining
                                .is_some_and(|t| t.0 == 0.0)
                            {
                                e.target_point = None;
                            }
                            if e.target_point.is_none() {
                                let zone = ctx
                                    .grid
                                    .zone_ids
                                    .iter()
                                    .position(|id| id.as_ref() == g.inside_zone.as_ref())
                                    .unwrap();
                                let mut selected = None;
                                let mut work = 0;
                                for _ in 0..32 {
                                    let pool = &ctx.zone_cells[zone];
                                    if pool.is_empty() {
                                        break;
                                    }
                                    let cell = pool[(u64::from(random::next(&mut a.random_state))
                                        * pool.len() as u64
                                        / 4_294_967_296)
                                        as usize];
                                    let p = navigation::center(ctx.grid, cell);
                                    if ctx.grid.zone_index[cell] as usize == zone
                                        && ctx.grid.blocked[cell] == 0
                                        && navigation::line_in_zone(ctx.grid, &a.position, &p, zone)
                                        && geometry::distance(&a.position, &p)
                                            > ctx.grid.cell_size * 0.1
                                        && geometry::clear(
                                            ctx.grid,
                                            &[],
                                            &a.position,
                                            &p,
                                            a.components.physical.radius.0,
                                            &mut work,
                                        )?
                                    {
                                        selected = Some(p);
                                        break;
                                    }
                                }
                                e.target_point = selected;
                                e.phase = if e.target_point.is_some() {
                                    "travel"
                                } else {
                                    "new"
                                }
                                .into();
                                a.timers.wander_refresh_remaining =
                                    g.change_target_every.map(|d| Nonnegative(d.0));
                                reset_route(a);
                                self.navigator.prepared = false;
                                if a.current_goal
                                    .as_ref()
                                    .unwrap()
                                    .execution
                                    .as_ref()
                                    .unwrap()
                                    .target_point
                                    .is_none()
                                {
                                    a.state = "blocked".into();
                                    zero(a);
                                }
                            }
                        }
                    }
                    GoalKind::Follow => {
                        let id = g.target_entity_id.as_ref().unwrap();
                        let point = ctx
                            .other(id)
                            .map(|a| a.position.clone())
                            .or_else(|| {
                                ctx.map
                                    .entities()
                                    .iter()
                                    .find(|e| &e.id == id)
                                    .and_then(|e| crate::shapes::center(e))
                            })
                            .or_else(|| {
                                let z = ctx
                                    .grid
                                    .zone_ids
                                    .iter()
                                    .position(|v| v.as_ref() == Some(id));
                                let p = ctx
                                    .grid
                                    .portal_ids
                                    .iter()
                                    .position(|v| v.as_ref() == Some(id));
                                (0..ctx.grid.blocked.len())
                                    .filter(|i| {
                                        ctx.grid.blocked[*i] == 0
                                            && (z.is_some_and(|z| {
                                                ctx.grid.zone_index[*i] as usize == z
                                            }) || p.is_some_and(|p| {
                                                ctx.grid.portal_index[*i] as usize == p
                                            }))
                                    })
                                    .map(|i| navigation::center(ctx.grid, i))
                                    .min_by(|x, y| {
                                        geometry::distance(&a.position, x)
                                            .total_cmp(&geometry::distance(&a.position, y))
                                    })
                            });
                        if let Some(p) = point {
                            let e = a.current_goal.as_mut().unwrap().execution.as_mut().unwrap();
                            if geometry::distance(&a.position, &p) <= g.distance.unwrap().0 + 1e-7 {
                                if e.phase != "active" {
                                    e.phase = "active".into();
                                    self.navigator.prepared = false;
                                }
                                a.state = "waiting".into();
                                zero(a);
                            } else {
                                let p =
                                    navigation::center(ctx.grid, navigation::index(ctx.grid, &p));
                                if e.target_point
                                    .as_ref()
                                    .is_none_or(|old| geometry::distance(old, &p) > 1e-8)
                                    || e.phase != "travel"
                                {
                                    e.target_point = Some(p);
                                    e.phase = "travel".into();
                                    self.navigator.prepared = false;
                                }
                            }
                        } else {
                            release(a, ctx.queues, ctx.slots, false);
                            fail(a, "NOT_FOUND", "Follow target is unavailable");
                            self.navigator.prepared = false;
                        }
                    }
                    GoalKind::Avoid => {
                        let safe = navigation::candidates(&g).iter().all(|id| {
                            ctx.distance(id, &a.position) + 1e-7 >= g.distance.unwrap().0
                        });
                        let e = a.current_goal.as_mut().unwrap().execution.as_mut().unwrap();
                        let next = if safe { "active" } else { "travel" };
                        if e.phase != next {
                            e.phase = next.into();
                            self.navigator.prepared = false;
                        }
                        if safe {
                            a.state = "waiting".into();
                            zero(a);
                        } else if navigation::candidates(&g)
                            .iter()
                            .any(|id| ctx.other(id).is_some())
                        {
                            self.navigator.prepared = false;
                        }
                    }
                    GoalKind::Queue | GoalKind::Interact => {
                        let id = g.target_entity_id.as_ref().unwrap();
                        if phase == "active" || ctx.near(a, id)? {
                            a.current_goal
                                .as_mut()
                                .unwrap()
                                .execution
                                .as_mut()
                                .unwrap()
                                .phase = "active".into();
                            if phase != "active" {
                                self.navigator.prepared = false;
                            }
                            done = if matches!(g.kind, GoalKind::Queue) {
                                ctx.queue(a, &g)?
                            } else {
                                ctx.interact(a, &g)?
                            };
                        }
                    }
                    GoalKind::Sequence => unreachable!(),
                }
                if !done {
                    break;
                }
                release(a, ctx.queues, ctx.slots, false);
                self.navigator.prepared = false;
                if !next_leaf(a, now) {
                    break;
                }
                if a.timers.reaction_remaining.0 > 0.0 {
                    break;
                }
            }
        }
        Ok(())
    }
    pub fn after_goals(&mut self) -> Result<(), Failure> {
        let dt = self.initial.scene.model.dt.0;
        let now = (self.tick + 1) as f64 * dt;
        for a in &mut self.agents {
            if a.departed_at.is_some()
                || a.components.mobility.speed_multiplier.0 == 0.0
                || a.state == "reacting"
                || a.current_goal.as_ref().is_none_or(|g| g.status != "active")
            {
                continue;
            }
            if leaf(a).is_some_and(|g| {
                matches!(g.kind, GoalKind::Reach)
                    && (g.depart_on_arrival != Some(true)
                        || a.zone_id != a.navigation.target_entity_id)
            }) && a
                .current_goal
                .as_ref()
                .unwrap()
                .execution
                .as_ref()
                .unwrap()
                .phase
                != "arrived"
            {
                a.current_goal
                    .as_mut()
                    .unwrap()
                    .execution
                    .as_mut()
                    .unwrap()
                    .elapsed
                    .0 += dt;
                continue;
            }
            let g = leaf(a).unwrap().clone();
            let e = a.current_goal.as_mut().unwrap().execution.as_mut().unwrap();
            let entered_departure = g.depart_on_arrival == Some(true)
                && a.navigation.target_entity_id.as_ref().is_some_and(|id| {
                    let zone = self
                        .grid
                        .zone_ids
                        .iter()
                        .position(|v| v.as_ref() == Some(id));
                    let cells = self.grid.footprint(
                        a.position.x.0,
                        a.position.y.0,
                        a.components.physical.radius.0,
                    );
                    zone.is_some_and(|z| {
                        !cells.is_empty()
                            && cells.iter().all(|i| self.grid.zone_index[*i] as usize == z)
                    })
                });
            let arrived = e.phase == "arrived" || entered_departure;
            let wandering = matches!(g.kind, GoalKind::Wander)
                && a.zone_id.as_ref() == g.inside_zone.as_ref()
                && (e.target_point.is_some() || e.phase == "new");
            if matches!(g.kind, GoalKind::Reach | GoalKind::Follow | GoalKind::Avoid)
                || wandering
                || (matches!(g.kind, GoalKind::Wait | GoalKind::Queue) && e.phase == "active")
                || (matches!(g.kind, GoalKind::Interact) && a.interaction_ref.is_some())
            {
                e.elapsed.0 += dt;
            }
            if let Some(t) = &mut a.timers.wander_refresh_remaining {
                t.0 = countdown(t.0, dt);
            }
            let done = match g.kind {
                GoalKind::Reach => arrived,
                GoalKind::Wait => {
                    e.phase == "active" && e.elapsed.0 + dt * 1e-9 >= g.duration.unwrap().0
                }
                GoalKind::Wander => {
                    (wandering || e.phase == "arrived" && e.target_point.is_some())
                        && g.duration.is_some_and(|d| e.elapsed.0 + dt * 1e-9 >= d.0)
                }
                GoalKind::Interact => a
                    .interaction_ref
                    .as_ref()
                    .is_some_and(|r| r.ends_at.0 <= now + dt * 1e-9),
                _ => false,
            };
            if arrived && !matches!(g.kind, GoalKind::Reach) {
                e.phase = if matches!(g.kind, GoalKind::Wander) {
                    "new"
                } else {
                    "active"
                }
                .into();
                if matches!(g.kind, GoalKind::Wander) {
                    e.target_point = None;
                }
            }
            if matches!(g.kind, GoalKind::Wait) && e.phase == "active" {
                a.timers.wait_remaining =
                    Nonnegative((g.duration.unwrap().0 - e.elapsed.0).max(0.0));
            }
            if arrived && !matches!(g.kind, GoalKind::Reach) {
                a.state = if matches!(g.kind, GoalKind::Wander) {
                    "moving"
                } else {
                    "waiting"
                }
                .into();
            }
            if arrived {
                self.navigator.prepared = false;
            }
            if done {
                release(a, &mut self.queues, &mut self.slots, false);
                self.navigator.prepared = false;
                if matches!(g.kind, GoalKind::Reach) && g.depart_on_arrival == Some(true) {
                    self.metrics.forget_agent(&a.id);
                    a.departed_at = Some(Nonnegative(now));
                    a.state = "departed".into();
                    a.current_goal.as_mut().unwrap().status = "completed".into();
                    a.goal_queue.clear();
                    zero(a);
                    reset_route(a);
                    self.departures.push(json!({"agentId":a.id,"at":now,"travelTime":now-a.current_goal.as_ref().unwrap().started_at.unwrap().0}));
                    let id = allocate(&mut self.allocations.next_event, "event")?;
                    self.events.push(json!({"id":id,"tick":self.tick+1,"time":now,"name":"departure","source":a.id}));
                } else {
                    next_leaf(a, now);
                }
            }
        }
        Ok(())
    }
    pub fn assign(&mut self, ids: &[Id], spec: &GoalSpec, enqueue: bool) -> Result<(), Failure> {
        let old_size = |a: &AgentRuntime| {
            a.current_goal.as_ref().map_or(0, |g| nodes(&g.spec))
                + a.goal_queue.iter().map(|g| nodes(&g.spec)).sum::<usize>()
        };
        let mut total = self.agents.iter().map(old_size).sum::<usize>();
        for id in ids {
            if let Some(a) = self.agents.iter().find(|a| &a.id == id) {
                if !enqueue
                    || a.current_goal
                        .as_ref()
                        .is_none_or(|g| g.status == "completed")
                {
                    total -= old_size(a);
                }
            }
            total += nodes(spec);
        }
        if total > 64000 {
            return Err(("RESOURCE_LIMIT", "Runtime goal node budget exceeded".into()));
        }
        let pending: usize = self.agents.iter().map(|a| a.goal_queue.len()).sum();
        if pending + ids.len() > 10000 {
            return Err(("RESOURCE_LIMIT", "Pending goal budget exceeded".into()));
        }
        let now = self.time();
        for id in ids {
            let a = self
                .agents
                .iter_mut()
                .find(|a| &a.id == id)
                .ok_or_else(|| ("NOT_FOUND", format!("Unknown agent {}", id.0)))?;
            if a.departed_at.is_some() {
                return Err(invalid("Departed agents cannot be assigned goals"));
            }
            let goal = install(
                spec.clone(),
                allocate(&mut self.allocations.next_goal, "goal")?,
                now,
                enqueue,
            );
            if enqueue
                && a.current_goal
                    .as_ref()
                    .is_some_and(|g| g.status != "completed")
            {
                if a.goal_queue.len() >= 1000 {
                    return Err(("RESOURCE_LIMIT", "Agent goal queue exceeded".into()));
                }
                a.goal_queue.push(goal);
            } else {
                release(a, &mut self.queues, &mut self.slots, false);
                a.goal_queue.clear();
                a.current_goal = Some(goal);
                a.controller = None;
                activate(a, now);
            }
        }
        self.navigator.prepared = false;
        Ok(())
    }
    pub fn remove_agents(&mut self, ids: &[Id]) -> Result<(), Failure> {
        for id in ids {
            let i = self
                .agents
                .iter()
                .position(|a| &a.id == id)
                .ok_or_else(|| ("NOT_FOUND", format!("Unknown agent {}", id.0)))?;
            let mut a = self.agents.remove(i);
            self.metrics.forget_agent(&a.id);
            release(&mut a, &mut self.queues, &mut self.slots, false);
            self.removed_count += 1;
            let event = allocate(&mut self.allocations.next_event, "event")?;
            self.events.push(json!({"id":event,"tick":self.tick,"time":self.time(),"name":"removed","source":a.id}));
        }
        self.navigator.prepared = false;
        Ok(())
    }
    pub fn clear(&mut self, ids: &[Id], scope: &str) -> Result<(), Failure> {
        let now = self.time();
        for id in ids {
            let a = self
                .agents
                .iter_mut()
                .find(|a| &a.id == id)
                .ok_or_else(|| ("NOT_FOUND", format!("Unknown agent {}", id.0)))?;
            if scope != "current" {
                a.goal_queue.clear();
            }
            if scope != "queued" {
                release(a, &mut self.queues, &mut self.slots, false);
                a.current_goal = None;
                a.controller = None;
                reset_route(a);
                zero(a);
                a.timers.reaction_remaining = Nonnegative(0.0);
                a.timers.wander_refresh_remaining = None;
                if a.departed_at.is_none() {
                    a.state = if a.components.mobility.speed_multiplier.0 == 0.0 {
                        "immobile"
                    } else {
                        "idle"
                    }
                    .into();
                    a.state_reason = None;
                }
                if !a.goal_queue.is_empty() && a.departed_at.is_none() {
                    a.current_goal = Some(a.goal_queue.remove(0));
                    activate(a, now);
                }
            }
        }
        self.navigator.prepared = false;
        Ok(())
    }
}
pub fn reach(id: Id) -> GoalSpec {
    serde_json::from_value(json!({"kind":"reach","targetEntityId":id})).unwrap()
}
fn countdown(t: f64, dt: f64) -> f64 {
    if t <= dt * (1.0 + 1e-9) { 0.0 } else { t - dt }
}
pub fn writable(raw: &Value, world: &World) -> Result<GoalSpec, Failure> {
    let allowed: &[&str] = match raw["kind"].as_str() {
        Some("reach") => &[
            "kind",
            "target",
            "selection",
            "stopDistance",
            "urgency",
            "departOnArrival",
        ],
        Some("avoid") => &["kind", "target", "distance", "urgency"],
        Some("wait") => &["kind", "duration", "inside"],
        Some("wander") => &["kind", "inside", "duration", "changeTargetEvery"],
        Some("follow") => &["kind", "target", "distance"],
        Some("queue") => &["kind", "target", "maximumWait"],
        Some("interact") => &["kind", "target"],
        Some("sequence") => &["kind", "goals", "repeat"],
        _ => return Err(unsupported("Unknown writable goal")),
    };
    if raw
        .as_object()
        .is_none_or(|v| v.keys().any(|k| !allowed.contains(&k.as_str())))
    {
        return Err(invalid("Unknown writable goal fields"));
    }
    let mut v = raw.clone();
    let o = v
        .as_object_mut()
        .ok_or_else(|| invalid("Goal must be an object"))?;
    for (field, dest) in [("target", "targetIds"), ("inside", "insideZone")] {
        if let Some(selector) = o.remove(field) {
            let s: PortalSelector = serde_json::from_value(selector)
                .map_err(|_| unsupported("Goal selectors currently require explicit IDs"))?;
            if let Some(kind) = &s.kind {
                for id in &s.ids {
                    let valid = match kind {
                        EntityKind::Agent => world.agents.iter().any(|a| &a.id == id),
                        EntityKind::Zone => world.grid.zone_ids.contains(&Some(id.clone())),
                        EntityKind::Portal => world.grid.portal_ids.contains(&Some(id.clone())),
                        _ => world.map_state.entities().iter().any(|e| {
                            &e.id == id
                                && std::mem::discriminant(&e.kind) == std::mem::discriminant(kind)
                        }),
                    };
                    if !valid {
                        return Err(invalid("Goal selector kind does not match IDs"));
                    }
                }
            }
            if s.ids.is_empty() || s.ids.len() > 64 {
                return Err(invalid("Goal selector requires 1–64 IDs"));
            }
            let single = dest == "insideZone"
                || matches!(
                    o.get("kind").and_then(Value::as_str),
                    Some("follow" | "queue" | "interact")
                );
            if single {
                if s.ids.len() != 1 {
                    return Err(invalid("Goal requires one resolved target"));
                }
                o.insert(
                    if dest == "insideZone" {
                        "insideZone"
                    } else {
                        "targetEntityId"
                    }
                    .into(),
                    json!(s.ids[0]),
                );
            } else {
                o.insert(dest.into(), json!(s.ids));
            }
        }
    }
    if let Some(children) = o.get_mut("goals").and_then(Value::as_array_mut) {
        for c in children {
            *c = crate::world::wire(&writable(c, world)?);
        }
    }
    parse(&v)
}

fn static_targets(g: &GoalSpec, grid: &GridData, map: &Map) -> bool {
    let is_static = |id: &Id| {
        grid.zone_ids.iter().flatten().any(|v| v == id)
            || grid.portal_ids.iter().flatten().any(|v| v == id)
            || map.entities().iter().any(|e| &e.id == id)
    };
    if let Some(id) = &g.target_zone {
        return is_static(id);
    }
    if let Some(id) = &g.target_entity_id {
        return is_static(id);
    }
    g.target_ids
        .as_ref()
        .is_some_and(|ids| ids.iter().all(is_static))
}
