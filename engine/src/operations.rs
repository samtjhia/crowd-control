//! Validated operations share one executor for live requests, jobs and rules.
use crate::{
    core::{Failure, invalid, unsupported},
    goals,
    navigation::Navigator,
    protocol::*,
    selectors as sel,
    shapes::{self, Shape},
    world::{World, wire},
};
use serde_json::{Value, json};
use std::collections::BTreeSet;

pub fn validate_live(ops: &[Value]) -> Result<(), Failure> {
    validate(ops, 0)?;
    fn writable(ops: &[Value]) -> Result<(), Failure> {
        for op in ops {
            if op.get("zone").is_some() || op["op"] == "emit" && op["event"].is_string() {
                return Err(invalid("Compiler shorthand is not a writable operation"));
            }
            if let Some(children) = op.get("operations") {
                writable(array(children)?)?;
            }
        }
        Ok(())
    }
    writable(ops)
}
pub fn validate(ops: &[Value], depth: usize) -> Result<(), Failure> {
    validate_scoped(ops, depth, false)
}
fn validate_scoped(ops: &[Value], depth: usize, bound: bool) -> Result<(), Failure> {
    if depth > 8 || ops.is_empty() || ops.len() > 100 {
        return Err((
            "RESOURCE_LIMIT",
            "Operation batch/nesting budget exceeded".into(),
        ));
    }
    for op in ops {
        let (allowed, required): (&[&str], &[&str]) = match op["op"].as_str() {
            Some("add") => (&["op", "entity", "placement"], &["op", "entity"]),
            Some("spawn") if op.get("zone").is_some() => (
                &[
                    "op",
                    "count",
                    "zone",
                    "profile",
                    "tags",
                    "label",
                    "controller",
                    "components",
                    "appearance",
                ],
                &["op", "count", "zone", "profile", "tags"],
            ),
            Some("spawn") => (
                &["op", "count", "template", "placement"],
                &["op", "count", "template", "placement"],
            ),
            Some("remove") => (&["op", "targets"], &["op", "targets"]),
            Some("set") => (&["op", "targets", "values"], &["op", "targets", "values"]),
            Some("assign_goal") => (
                &["op", "targets", "goal", "mode"],
                &["op", "targets", "goal"],
            ),
            Some("clear_goal") => (&["op", "targets", "scope"], &["op", "targets"]),
            Some("schedule") => (
                &["op", "id", "at", "after", "operations"],
                &["op", "id", "operations"],
            ),
            Some("define_rule") => (
                &["op", "id", "when", "operations", "once", "cooldown"],
                &["op", "id", "when", "operations"],
            ),
            Some("remove_rule") => (&["op", "id"], &["op", "id"]),
            Some("emit") => (&["op", "event"], &["op", "event"]),
            _ => return Err(invalid("Unknown operation")),
        };
        sel::keys(op, allowed, required)?;
        if let Some(s) = op.get("targets") {
            selector_binding(s, bound)?;
        }
        match op["op"].as_str().unwrap() {
            "add" => {
                let entity: Entity = serde_json::from_value(op["entity"].clone())
                    .map_err(|e| invalid(e.to_string()))?;
                if matches!(entity.kind, EntityKind::Agent) {
                    return Err(invalid(
                        "Add requires a static entity; use spawn for agents",
                    ));
                }
                if op["entity"].get("shape").is_none() && op.get("placement").is_none() {
                    return Err(invalid("Add needs shape or placement"));
                }
            }
            "spawn" => {
                let n = sel::count(&op["count"])?;
                if n == 0 || n > 2000 {
                    return Err(("RESOURCE_LIMIT", "Spawn count must be 1–2000".into()));
                }
                if op.get("zone").is_some() {
                    let mut template = op.clone();
                    let fields = template.as_object_mut().unwrap();
                    for k in ["op", "count", "zone", "controller"] {
                        fields.remove(k);
                    }
                    fields.insert("kind".into(), json!("agent"));
                    let _: AgentTemplate =
                        serde_json::from_value(template).map_err(|e| invalid(e.to_string()))?;
                    sel::id(&op["zone"])?;
                    sel::id(&op["profile"])?;
                    let _: Vec<Id> = serde_json::from_value(op["tags"].clone())
                        .map_err(|e| invalid(e.to_string()))?;
                    if let Some(c) = op.get("controller") {
                        sel::id(c)?;
                    }
                } else {
                    let t: AgentTemplate = serde_json::from_value(op["template"].clone())
                        .map_err(|e| invalid(e.to_string()))?;
                    if !matches!(t.kind, EntityKind::Agent) {
                        return Err(invalid("Spawn template must be an agent"));
                    }
                }
            }
            "set" => validate_patch(&op["values"])?,
            "assign_goal" => {
                if op
                    .get("mode")
                    .is_some_and(|v| !matches!(v.as_str(), Some("replace" | "enqueue")))
                {
                    return Err(invalid("Invalid goal mode"));
                }
                validate_goal(&op["goal"], 0, bound)?;
            }
            "clear_goal" => {
                if op
                    .get("scope")
                    .is_some_and(|v| !matches!(v.as_str(), Some("current" | "queued" | "all")))
                {
                    return Err(invalid("Invalid clear scope"));
                }
            }
            "schedule" => {
                sel::id(&op["id"])?;
                if op.get("at").is_some() == op.get("after").is_some() {
                    return Err(invalid("Schedule requires at XOR after"));
                }
                sel::number(op.get("at").unwrap_or(&op["after"]))?;
                validate_scoped(array(&op["operations"])?, depth + 1, bound)?;
            }
            "define_rule" => {
                sel::id(&op["id"])?;
                condition(&op["when"])?;
                if op.get("once").is_some_and(|v| !v.is_boolean())
                    || op
                        .get("cooldown")
                        .is_some_and(|v| sel::number(v).is_err() || v.as_f64() == Some(0.0))
                    || op["once"] == false && op.get("cooldown").is_none()
                {
                    return Err(invalid("Repeating rules require a positive cooldown"));
                }
                validate_scoped(
                    array(&op["operations"])?,
                    depth + 1,
                    op["when"]["kind"] == "entity_metric",
                )?;
            }
            "remove_rule" => {
                sel::id(&op["id"])?;
            }
            "emit" => {
                if op["event"].is_string() {
                    sel::id(&op["event"])?;
                } else {
                    sel::keys(&op["event"], &["name", "source", "data"], &["name"])?;
                    sel::id(&op["event"]["name"])?;
                    if let Some(s) = op["event"].get("source") {
                        sel::id(s)?;
                    }
                }
            }
            _ => (),
        }
        if let Some(p) = op.get("placement") {
            validate_placement(p)?;
        }
    }
    Ok(())
}
pub fn array(v: &Value) -> Result<&Vec<Value>, Failure> {
    v.as_array().ok_or_else(|| invalid("Expected array"))
}
fn validate_goal(v: &Value, depth: usize, bound: bool) -> Result<(), Failure> {
    if depth > 8 {
        return Err(("RESOURCE_LIMIT", "Goal depth exceeded".into()));
    }
    let mut compiled = v.clone();
    let o = compiled
        .as_object_mut()
        .ok_or_else(|| invalid("Invalid goal"))?;
    for (src, dest) in [("target", "targetEntityId"), ("inside", "insideZone")] {
        if let Some(s) = o.remove(src) {
            selector_binding(&s, bound)?;
            o.insert(dest.into(), json!("validation-placeholder"));
        }
    }
    if v["kind"] == "sequence" {
        let children = array(&v["goals"])?;
        for c in children {
            validate_goal(c, depth + 1, bound)?;
        }
        o.insert("goals".into(), json!([{"kind":"wait","duration":0}]));
    }
    // Writable goals cannot smuggle compiled destination fields.
    if ["targetZone", "targetEntityId", "targetIds", "insideZone"]
        .iter()
        .any(|k| v.get(k).is_some())
    {
        return Err(invalid("Compiled fields are not writable goal fields"));
    }
    goals::parse(&compiled)?;
    Ok(())
}
pub fn condition(v: &Value) -> Result<(), Failure> {
    match v["kind"].as_str() {
        Some("event") => {
            sel::keys(v, &["kind", "name"], &["kind", "name"])?;
            sel::id(&v["name"])?;
        }
        Some("count") => {
            sel::keys(
                v,
                &["kind", "targets", "comparison", "value"],
                &["kind", "targets", "comparison", "value"],
            )?;
            sel::validate(&v["targets"], 0)?;
            sel::count(&v["value"])?;
        }
        Some("time") => {
            sel::keys(
                v,
                &["kind", "comparison", "value"],
                &["kind", "comparison", "value"],
            )?;
            sel::number(&v["value"])?;
        }
        Some("density") => {
            sel::keys(
                v,
                &["kind", "inside", "comparison", "value"],
                &["kind", "inside", "comparison", "value"],
            )?;
            sel::validate(&v["inside"], 0)?;
            sel::number(&v["value"])?;
        }
        Some("entity_metric") => {
            sel::keys(
                v,
                &["kind", "targets", "metric", "comparison", "value", "for"],
                &["kind", "targets", "metric", "comparison", "value", "for"],
            )?;
            sel::validate(&v["targets"], 0)?;
            if v["metric"] != "contactLoadRatio" {
                return Err(unsupported("Unknown entity metric"));
            }
            sel::number(&v["value"])?;
            sel::number(&v["for"])?;
        }
        _ => return Err(invalid("Unknown rule condition")),
    }
    if v["kind"] != "event"
        && !matches!(
            v["comparison"].as_str(),
            Some("eq" | "neq" | "gt" | "gte" | "lt" | "lte")
        )
    {
        return Err(invalid("Invalid comparison"));
    }
    Ok(())
}
fn validate_placement(v: &Value) -> Result<(), Failure> {
    sel::keys(
        v,
        &["inside", "near", "along", "distance", "edge", "awayFrom"],
        &[],
    )?;
    let mut n = 0;
    for k in ["inside", "near", "along"] {
        if let Some(s) = v.get(k) {
            n += 1;
            sel::validate(s, 0)?;
        }
    }
    if n != 1 {
        return Err(invalid("Placement requires inside, near OR along"));
    }
    if let Some(d) = v.get("distance") {
        sel::number(d)?;
    }
    if v.get("edge")
        .is_some_and(|e| !matches!(e.as_str(), Some("north" | "south" | "east" | "west")))
    {
        return Err(invalid("Invalid placement edge"));
    }
    if let Some(a) = v.get("awayFrom") {
        let a = array(a)?;
        if a.is_empty() || a.len() > 64 {
            return Err(invalid("Invalid awayFrom"));
        }
        for s in a {
            sel::validate(s, 0)?;
        }
    }
    Ok(())
}
fn validate_patch(v: &Value) -> Result<(), Failure> {
    sel::keys(v, &["components", "appearance"], &[])?;
    if v.as_object().unwrap().is_empty() {
        return Err(invalid("Empty patch"));
    }
    if let Some(a) = v.get("appearance") {
        let _: Appearance =
            serde_json::from_value(a.clone()).map_err(|e| invalid(e.to_string()))?;
        if a.as_object().unwrap().is_empty() {
            return Err(invalid("Empty appearance patch"));
        }
    }
    if let Some(c) = v.get("components") {
        sel::keys(
            c,
            &[
                "physical",
                "navigation",
                "behavior",
                "mobility",
                "capacity",
                "portal",
                "interaction",
            ],
            &[],
        )?;
        if c.as_object().unwrap().is_empty() {
            return Err(invalid("Empty component patch"));
        }
        for (name, p) in c.as_object().unwrap() {
            let fields: &[&str] = match name.as_str() {
                "physical" => &["blocksMovement", "movable"],
                "navigation" => &[
                    "preferredSpeed",
                    "maximumSpeed",
                    "acceleration",
                    "personalSpace",
                ],
                "behavior" => &[
                    "reactionDelay",
                    "routeCompliance",
                    "avoidanceStrength",
                    "groupCohesion",
                    "goalPersistence",
                ],
                "mobility" => &["speedMultiplier"],
                "capacity" => &["maximumOccupants", "serviceRate"],
                "portal" => &["open", "traversalTime"],
                "interaction" => &["duration", "slots"],
                _ => unreachable!(),
            };
            sel::keys(p, fields, &[])?;
            if p.as_object().unwrap().is_empty() {
                return Err(invalid("Empty component patch"));
            }
            for (k, v) in p.as_object().unwrap() {
                if ["blocksMovement", "movable", "open"].contains(&k.as_str()) {
                    if !v.is_boolean() {
                        return Err(invalid("Expected boolean"));
                    }
                } else {
                    let n = sel::number(v)?;
                    if ["maximumOccupants", "slots"].contains(&k.as_str()) {
                        sel::count(v)?;
                    }
                    if ["slots", "serviceRate"].contains(&k.as_str()) && n == 0.0
                        || [
                            "routeCompliance",
                            "avoidanceStrength",
                            "groupCohesion",
                            "goalPersistence",
                            "speedMultiplier",
                        ]
                        .contains(&k.as_str())
                            && n > 1.0
                    {
                        return Err(invalid("Invalid component range"));
                    }
                }
            }
        }
    }
    Ok(())
}
fn merge(dest: &mut Value, patch: &Value) {
    for (k, v) in patch.as_object().unwrap() {
        if v.is_object() {
            if dest[k].is_null() {
                dest[k] = json!({});
            }
            merge(&mut dest[k], v)
        } else {
            dest[k] = v.clone()
        }
    }
}
pub fn compiled_goal(v: &Value) -> Value {
    let mut v = v.clone();
    let o = v.as_object_mut().unwrap();
    for (src, dest) in [
        ("targetZone", "target"),
        ("targetEntityId", "target"),
        ("targetIds", "target"),
        ("insideZone", "inside"),
    ] {
        if let Some(ids) = o.remove(src) {
            o.insert(
                dest.into(),
                json!({"ids":if ids.is_array(){ids}else{json!([ids])}}),
            );
        }
    }
    if let Some(a) = o.get_mut("goals").and_then(Value::as_array_mut) {
        for g in a {
            *g = compiled_goal(g)
        }
    }
    v
}
impl World {
    pub fn execute_operations(
        &mut self,
        ops: &[Value],
        origin: &Value,
        key: &str,
        work: &mut usize,
    ) -> Result<(), Failure> {
        validate(ops, 0)?;
        for op in ops {
            self.runtime.work += 1;
            if self.runtime.work > 10000 {
                return Err((
                    "RESOURCE_LIMIT",
                    "Operation dispatch budget exceeded".into(),
                ));
            }
            match op["op"].as_str().unwrap() {
                "schedule" => {
                    let at = if let Some(v) = op.get("at") {
                        sel::number(v)?
                    } else {
                        self.time() + sel::number(&op["after"])?
                    };
                    self.schedule(
                        sel::id(&op["id"])?,
                        at,
                        array(&op["operations"])?.clone(),
                        origin.clone(),
                    )?;
                }
                "define_rule" => self.define_rule(op.clone(), origin.clone())?,
                "remove_rule" => {
                    let id = sel::id(&op["id"])?;
                    let before = self.runtime.rules.len();
                    self.runtime
                        .rules
                        .retain(|r| r.definition["id"] != json!(id));
                    if self.runtime.rules.len() == before {
                        return Err(("NOT_FOUND", "Unknown rule".into()));
                    }
                }
                "emit" => {
                    let e = if op["event"].is_string() {
                        json!({"name":op["event"]})
                    } else {
                        op["event"].clone()
                    };
                    self.record_event(
                        e["name"].as_str().unwrap(),
                        e.get("source").cloned(),
                        e.get("data").cloned(),
                        Some(origin.clone()),
                    )?;
                }
                "spawn" => self.spawn(op, origin, key, work)?,
                "add" => self.add_entity(op, origin, key, work)?,
                _ => {
                    if let Some(explicit) = op["targets"]["ids"].as_array() {
                        let records = sel::records(self);
                        if explicit
                            .iter()
                            .any(|id| !records.contains_key(&sel::id(id).unwrap()))
                        {
                            return Err(("NOT_FOUND", "An explicit target does not exist".into()));
                        }
                    }
                    let ids = sel::resolve(self, &op["targets"], key, work)?;
                    if ids.is_empty() {
                        return Err(("NOT_FOUND", "Operation matched no live targets".into()));
                    }
                    match op["op"].as_str().unwrap() {
                        "remove" => {
                            for id in ids {
                                self.invalidate_target(&id);
                                if self.agents.iter().any(|a| a.id == id) {
                                    self.remove_agents(&[id])?;
                                } else {
                                    self.remove_entity(&id)?;
                                }
                            }
                            self.rebuild_geometry()?;
                            self.metadata_changed(true)?;
                        }
                        "set" => self.patch(&ids, &op["values"])?,
                        "assign_goal" => {
                            let resolved = self.resolve_goal(&op["goal"], key, work)?;
                            goals::validate(
                                &resolved,
                                &self.map_state,
                                &self.grid,
                                &self.agents.iter().map(|a| a.id.clone()).collect(),
                            )?;
                            self.assign(&ids, &resolved, op["mode"] == "enqueue")?;
                        }
                        "clear_goal" => self.clear(&ids, op["scope"].as_str().unwrap_or("all"))?,
                        _ => unreachable!(),
                    }
                }
            }
        }
        Ok(())
    }
    pub fn resolve_goal(
        &mut self,
        raw: &Value,
        key: &str,
        work: &mut usize,
    ) -> Result<GoalSpec, Failure> {
        let mut v = raw.clone();
        let o = v.as_object_mut().ok_or_else(|| invalid("Invalid goal"))?;
        for field in ["target", "inside"] {
            if let Some(s) = o.get(field).cloned() {
                let ids = sel::resolve(self, &s, key, work)?;
                if ids.is_empty() {
                    return Err(("NOT_FOUND", "Goal matched no targets".into()));
                }
                o.insert(field.into(), json!({"ids":ids}));
            }
        }
        if let Some(a) = o.get_mut("goals").and_then(Value::as_array_mut) {
            for g in a {
                *g = compiled_goal(&wire(&self.resolve_goal(g, key, work)?));
            }
        }
        goals::writable(&v, self)
    }
    pub fn metadata_changed(&mut self, topology: bool) -> Result<(), Failure> {
        self.scene_version = self
            .scene_version
            .checked_add(1)
            .filter(|n| *n <= 9_007_199_254_740_991)
            .ok_or_else(|| invalid("Scene version exhausted"))?;
        if topology {
            self.topology_version = self
                .topology_version
                .checked_add(1)
                .filter(|n| *n <= 9_007_199_254_740_991)
                .ok_or_else(|| invalid("Topology version exhausted"))?;
            self.wander_cells.clear();
            self.navigator = Navigator::default();
            self.refresh_metric_geometry();
        }
        Ok(())
    }
    fn patch(&mut self, ids: &[Id], values: &Value) -> Result<(), Failure> {
        let mut topology = false;
        let mut services = false;
        for id in ids {
            if let Some(i) = self.agents.iter().position(|a| &a.id == id) {
                let a = &mut self.agents[i];
                if a.departed_at.is_some() {
                    return Err(invalid("Cannot change a departed agent"));
                }
                let mut c = wire(&a.components);
                if let Some(p) = values.get("components") {
                    merge(&mut c, p)
                }
                let components: Components =
                    serde_json::from_value(c).map_err(|e| invalid(e.to_string()))?;
                if components.navigation.maximum_speed.0 < components.navigation.preferred_speed.0 {
                    return Err(invalid("Invalid resolved speed range"));
                }
                if components.mobility.speed_multiplier.0 == 0.0 {
                    goals::release(a, &mut self.queues, &mut self.slots, true);
                    a.state = "immobile".into();
                    goals::zero(a);
                    if let Some(g) = &mut a.current_goal {
                        if !matches!(g.status.as_str(), "completed" | "failed") {
                            g.status = "suspended".into()
                        }
                    }
                } else if a.components.mobility.speed_multiplier.0 == 0.0 {
                    a.state = "idle".into();
                    if let Some(g) = &mut a.current_goal {
                        if g.status == "suspended" {
                            g.status = "active".into()
                        }
                    }
                }
                topology |= components.physical.blocks_movement
                    != a.components.physical.blocks_movement
                    || components.physical.movable != a.components.physical.movable
                    || (components.mobility.speed_multiplier.0 == 0.0)
                        != (a.components.mobility.speed_multiplier.0 == 0.0);
                a.components = components;
                if let Some(p) = values.get("appearance") {
                    merge(&mut a.appearance, p)
                }
                if values.get("components").is_some() {
                    self.navigator.prepared = false;
                }
            } else if let Some(i) = self.map_state.portals.iter().position(|p| &p.id == id) {
                if values["components"].get("portal").is_none()
                    && values.get("components").is_some()
                {
                    return Err(invalid("Portal patch requires portal component"));
                }
                let mut p = wire(&self.map_state.portals[i]);
                if let Some(v) = values.get("appearance") {
                    merge_field(&mut p, "appearance", v)
                }
                if let Some(v) = values["components"].get("portal") {
                    for (k, v) in v.as_object().unwrap() {
                        p[k] = v.clone();
                    }
                    topology = true;
                }
                self.map_state.portals[i] =
                    serde_json::from_value(p).map_err(|e| invalid(e.to_string()))?;
            } else if let Some(i) = self.map_state.rooms.iter().position(|r| &r.id == id) {
                if values.get("components").is_some() {
                    return Err(invalid("Room components require an entity record"));
                }
                let mut r = wire(&self.map_state.rooms[i]);
                if let Some(v) = values.get("appearance") {
                    merge_field(&mut r, "appearance", v)
                }
                self.map_state.rooms[i] =
                    serde_json::from_value(r).map_err(|e| invalid(e.to_string()))?;
            } else {
                let e = self
                    .map_state
                    .entities
                    .as_mut()
                    .unwrap()
                    .iter_mut()
                    .find(|e| &e.id == id)
                    .ok_or_else(|| invalid("Unknown target"))?;
                let mut v = wire(e);
                merge(&mut v, values);
                let updated: Entity =
                    serde_json::from_value(v).map_err(|e| invalid(e.to_string()))?;
                topology |= e.blocking() != updated.blocking()
                    || values["components"].get("portal").is_some();
                services |= values["components"].get("capacity").is_some()
                    || values["components"].get("interaction").is_some();
                *e = updated;
            }
        }
        shapes::validate(&self.map_state)?;
        if services {
            self.sync_services()?;
        }
        if topology {
            self.rebuild_geometry()?;
            self.validate_bodies()?;
        }
        self.metadata_changed(topology)
    }
    pub fn validate_bodies(&self) -> Result<(), Failure> {
        for (i, a) in self
            .agents
            .iter()
            .enumerate()
            .filter(|(_, a)| a.departed_at.is_none())
        {
            if self
                .grid
                .footprint(
                    a.position.x.0,
                    a.position.y.0,
                    a.components.physical.radius.0,
                )
                .iter()
                .any(|i| self.grid.blocked[*i] != 0)
            {
                return Err((
                    "NO_WALKABLE_SPACE",
                    "Geometry intersects an existing body".into(),
                ));
            }
            if a.components.physical.blocks_movement {
                for b in
                    self.agents.iter().take(i).filter(|b| {
                        b.departed_at.is_none() && b.components.physical.blocks_movement
                    })
                {
                    if crate::geometry::distance(&a.position, &b.position) + 1e-9
                        < a.components.physical.radius.0 + b.components.physical.radius.0
                    {
                        return Err(("NO_WALKABLE_SPACE", "Blocking bodies overlap".into()));
                    }
                }
            }
        }
        Ok(())
    }
    pub fn sync_services(&mut self) -> Result<(), Failure> {
        // Preserve existing tickets/leases; component edits cannot evict an occupied slot.
        let old_q = self.queues.clone();
        let old_s = self.slots.clone();
        self.initialize_services();
        for q in &mut self.queues {
            if let Some(old) = old_q.iter().find(|o| o.target_id == q.target_id) {
                *q = old.clone()
            }
        }
        for s in &mut self.slots {
            if let Some(old) = old_s.iter().find(|o| o.target_id == s.target_id) {
                if old
                    .slots
                    .iter()
                    .skip(s.slots.len())
                    .any(|s| s.agent_id.is_some())
                {
                    return Err(invalid("Cannot remove occupied interaction slots"));
                }
                for (new, old) in s.slots.iter_mut().zip(&old.slots) {
                    *new = old.clone();
                }
            }
        }
        Ok(())
    }
}
fn merge_field(v: &mut Value, key: &str, patch: &Value) {
    if v[key].is_null() {
        v[key] = json!({})
    }
    merge(&mut v[key], patch)
}
impl World {
    fn spawn(
        &mut self,
        op: &Value,
        origin: &Value,
        key: &str,
        work: &mut usize,
    ) -> Result<(), Failure> {
        let count = sel::count(&op["count"])?;
        if self.runtime.used_entities.len() + count > 20000
            || self.allocations.reserved.len() >= 10000
        {
            return Err(("RESOURCE_LIMIT", "Entity allocation budget exceeded".into()));
        }
        if self.agents.len() + count > 2000 {
            return Err(("RESOURCE_LIMIT", "Agent budget exceeded".into()));
        }
        let compact = op.get("zone").is_some();
        let template = if compact {
            let mut v = op.clone();
            let o = v.as_object_mut().unwrap();
            for k in ["op", "count", "zone", "controller"] {
                o.remove(k);
            }
            o.insert("kind".into(), json!("agent"));
            v
        } else {
            op["template"].clone()
        };
        let t: AgentTemplate =
            serde_json::from_value(template).map_err(|e| invalid(e.to_string()))?;
        if !matches!(t.kind, EntityKind::Agent) {
            return Err(invalid("Spawn template kind must be agent"));
        }
        let profile = t.profile.unwrap_or(Id("person".into()));
        let p = self
            .initial
            .scene
            .profiles
            .get(&profile)
            .ok_or_else(|| ("NOT_FOUND", "Unknown spawn profile".into()))?
            .clone();
        let c = crate::world::resolve_components(
            &self.initial.resolved_model.default_agent,
            &p,
            t.components.as_ref(),
        );
        if c.navigation.maximum_speed.0 < c.navigation.preferred_speed.0 {
            return Err(invalid("Invalid spawn speed range"));
        }
        let placement = if compact {
            json!({"inside":{"ids":[op["zone"].clone()]}})
        } else {
            op["placement"].clone()
        };
        let positions = self.place(&placement, c.physical.radius.0, count, key, work)?;
        let mut appearance = json!({"symbol":"circle","fill":"#2563EB","opacity":1});
        for layer in [&p.appearance, &t.appearance].into_iter().flatten() {
            merge(&mut appearance, &wire(layer));
        }
        let mut spawned = vec![];
        for point in positions {
            let id = loop {
                let id = goals::allocate(&mut self.allocations.next_entity, "a")?;
                if !self.runtime.used_entities.contains(&id) {
                    break id;
                }
            };
            self.runtime.used_entities.insert(id.clone());
            self.runtime
                .entity_origins
                .push(json!({"entityId":id,"origin":origin}));
            let immobile = c.mobility.speed_multiplier.0 == 0.0;
            let a = AgentRuntime {
                id: id.clone(),
                kind: "agent".into(),
                label: t.label.clone(),
                tags: t.tags.clone().unwrap_or_default(),
                profile: profile.clone(),
                components: c.clone(),
                appearance: appearance.clone(),
                sensors: None,
                state: if immobile { "immobile" } else { "idle" }.into(),
                state_reason: None,
                position: point.clone(),
                velocity: Point {
                    x: Number(0.0),
                    y: Number(0.0),
                },
                zone_id: self.grid.zone_at(point.x.0, point.y.0),
                controller: None,
                current_goal: None,
                goal_queue: vec![],
                navigation: AgentNavigation {
                    target_entity_id: None,
                    target_point: None,
                    flow_field_id: None,
                    map_version: Counter(self.topology_version as f64),
                },
                timers: Timers {
                    reaction_remaining: Nonnegative(0.0),
                    wait_remaining: Nonnegative(0.0),
                    wander_refresh_remaining: None,
                },
                queue_ref: None,
                interaction_ref: None,
                random_state: crate::random::stream_seed(
                    self.initial.scene.seed.0 as u32,
                    &format!("agent:{}", id.0),
                ),
                departed_at: None,
            };
            self.agents.push(a);
            spawned.push(id);
        }
        self.agents.sort_by(|a, b| a.id.cmp(&b.id));
        if let Some(controller) = op.get("controller") {
            let id = sel::id(controller)?;
            let raw = self
                .initial
                .scene
                .controllers
                .get(&id)
                .ok_or_else(|| ("NOT_FOUND", "Unknown spawn controller".into()))?;
            let g = goals::parse(raw)?;
            goals::validate(
                &g,
                &self.map_state,
                &self.grid,
                &self.agents.iter().map(|a| a.id.clone()).collect(),
            )?;
            self.assign(&spawned, &g, false)?;
            for a in &mut self.agents {
                if spawned.contains(&a.id) {
                    a.controller = Some(id.clone())
                }
            }
        }
        self.allocations.reserved.push(Reservation {
            key: Id(format!("spawn:{}", self.allocations.next_entity.0)),
            ids: spawned,
        });
        self.metadata_changed(true)?;
        Ok(())
    }
    fn place(
        &mut self,
        v: &Value,
        r: f64,
        count: usize,
        key: &str,
        work: &mut usize,
    ) -> Result<Vec<Point>, Failure> {
        let mode = ["inside", "near", "along"]
            .into_iter()
            .find(|k| v.get(*k).is_some())
            .unwrap();
        let targets = sel::resolve(self, &v[mode], key, work)?;
        if targets.is_empty() {
            return Err(("NOT_FOUND", "Placement matched no targets".into()));
        }
        let mut away = vec![];
        if let Some(a) = v.get("awayFrom") {
            for s in array(a)? {
                let ids = sel::resolve(self, s, key, work)?;
                if ids.is_empty() {
                    return Err(("NOT_FOUND", "awayFrom matched no targets".into()));
                }
                away.extend(ids)
            }
        }
        let pitch = self.initial.resolved_model.layout.body_diameter.0
            * self.initial.resolved_model.layout.spacing_diameters.0;
        let distance = v
            .get("distance")
            .map(sel::number)
            .transpose()?
            .unwrap_or(pitch);
        let geometry_cost = targets
            .iter()
            .filter(|_| mode != "inside")
            .chain(&away)
            .map(|id| self.grid.target_cells.get(id).map_or(1, Vec::len))
            .sum::<usize>()
            .saturating_mul(self.grid.blocked.len());
        if geometry_cost > 64_000_000 {
            return Err((
                "RESOURCE_LIMIT",
                "Placement geometry work exceeds budget".into(),
            ));
        }
        let mut candidates = vec![];
        let grid = &self.grid;
        // A versioned grid-cell-centre policy respects reviewed masks and never invents room sizes.
        let mut placement_work = 0usize;
        for i in 0..grid.blocked.len() {
            placement_work += 1;
            if placement_work > 64_000_000 {
                return Err(("RESOURCE_LIMIT", "Placement work exceeded".into()));
            }
            if grid.blocked[i] != 0 {
                continue;
            }
            let p = Point {
                x: Number((i % grid.width) as f64 * grid.cell_size + grid.cell_size / 2.0),
                y: Number((i / grid.width) as f64 * grid.cell_size + grid.cell_size / 2.0),
            };
            if p.x.0 - r < 0.0
                || p.y.0 - r < 0.0
                || p.x.0 + r > self.map_state.width.0
                || p.y.0 + r > self.map_state.height.0
            {
                continue;
            }
            let cells = grid.footprint(p.x.0, p.y.0, r);
            placement_work += cells.len();
            if cells.iter().any(|i| grid.blocked[*i] != 0) {
                continue;
            }
            let inset = if mode == "inside" {
                v.get("distance")
                    .map(sel::number)
                    .transpose()?
                    .unwrap_or(0.0)
            } else {
                0.0
            };
            if p.x.0 - r - inset < 0.0
                || p.y.0 - r - inset < 0.0
                || p.x.0 + r + inset > self.map_state.width.0
                || p.y.0 + r + inset > self.map_state.height.0
            {
                continue;
            }
            let inside_cells = if inset > 0.0 {
                grid.footprint(p.x.0, p.y.0, r + inset)
            } else {
                cells.clone()
            };
            placement_work += inside_cells.len();
            let fits = targets.iter().any(|id| {
                if mode == "inside" {
                    inside_cells
                        .iter()
                        .all(|i| grid.zone_ids[grid.zone_index[*i] as usize].as_ref() == Some(id))
                } else {
                    sel::distance(self, id, &p) <= distance
                        && if mode == "along" {
                            sel::distance(self, id, &p) + 1e-9 >= r
                        } else {
                            true
                        }
                }
            });
            if !fits
                || away
                    .iter()
                    .any(|id| sel::distance(self, id, &p) < distance + r)
            {
                continue;
            }
            let score = match v["edge"].as_str() {
                Some("north") => p.y.0,
                Some("south") => -p.y.0,
                Some("west") => p.x.0,
                Some("east") => -p.x.0,
                _ => 0.0,
            };
            candidates.push((score, p));
        }
        // Randomize equal-policy choices using the placement stream, independent of selection/agents.
        for i in (1..candidates.len()).rev() {
            let j = (u64::from(crate::random::next(&mut self.random.placement)) * (i + 1) as u64
                / (u64::from(u32::MAX) + 1)) as usize;
            candidates.swap(i, j)
        }
        candidates.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut placed: Vec<Point> = vec![];
        for (_, p) in candidates {
            placement_work += self.agents.len() + placed.len();
            if placement_work > 64_000_000 {
                return Err((
                    "RESOURCE_LIMIT",
                    "Placement occupancy budget exceeded".into(),
                ));
            }
            if self
                .agents
                .iter()
                .filter(|a| a.departed_at.is_none())
                .any(|a| {
                    crate::geometry::distance(&p, &a.position) + 1e-9
                        < r + a.components.physical.radius.0
                })
                || placed
                    .iter()
                    .any(|a| crate::geometry::distance(&p, a) + 1e-9 < (2.0 * r).max(pitch))
            {
                continue;
            }
            placed.push(p);
            if placed.len() == count {
                break;
            }
        }
        if placed.len() != count {
            return Err((
                "NO_WALKABLE_SPACE",
                "Placement cannot fit the entire population".into(),
            ));
        }
        Ok(placed)
    }
    fn add_entity(
        &mut self,
        op: &Value,
        origin: &Value,
        key: &str,
        work: &mut usize,
    ) -> Result<(), Failure> {
        let mut e: Entity =
            serde_json::from_value(op["entity"].clone()).map_err(|e| invalid(e.to_string()))?;
        if self.runtime.used_entities.contains(&e.id) || sel::records(self).contains_key(&e.id) {
            return Err(invalid("Entity ID already allocated"));
        }
        if matches!(e.kind, EntityKind::Agent) {
            return Err(invalid("Use spawn for agents"));
        }
        if e.shape.is_none() {
            let size = self
                .initial
                .resolved_model
                .layout
                .body_diameter
                .0
                .max(self.grid.cell_size);
            let p = self
                .place(&op["placement"], size / 2.0, 1, key, work)?
                .remove(0);
            e.shape = Some(Shape::Rectangle {
                x: Number(p.x.0 - size / 2.0),
                y: Number(p.y.0 - size / 2.0),
                width: Positive(size),
                height: Positive(size),
            });
        } else if op.get("placement").is_some() {
            self.check_shape_placement(&e, &op["placement"], key, work)?;
        }
        if op["entity"].get("shape").is_none() {
            let mut p = op["placement"].clone();
            p.as_object_mut().unwrap().remove("edge");
            self.check_shape_placement(&e, &p, key, work)?;
        }
        self.runtime.used_entities.insert(e.id.clone());
        self.runtime
            .entity_origins
            .push(json!({"entityId":e.id,"origin":origin}));
        self.map_state.entities.get_or_insert_default().push(e);
        self.rebuild_geometry()?;
        self.validate_bodies()?;
        self.sync_services()?;
        self.metadata_changed(true)
    }
    fn check_shape_placement(
        &mut self,
        e: &Entity,
        v: &Value,
        key: &str,
        work: &mut usize,
    ) -> Result<(), Failure> {
        let s = e.shape.as_ref().unwrap();
        let (x, y, w, h) = s.extent();
        let p = Point {
            x: Number(x + w / 2.0),
            y: Number(y + h / 2.0),
        };
        let mode = ["inside", "near", "along"]
            .into_iter()
            .find(|k| v.get(*k).is_some())
            .unwrap();
        let targets = sel::resolve(self, &v[mode], key, work)?;
        let d = v.get("distance").map(sel::number).transpose()?.unwrap_or(
            self.initial.resolved_model.layout.body_diameter.0
                * self.initial.resolved_model.layout.spacing_diameters.0,
        );
        if mode == "inside" {
            let inset = v
                .get("distance")
                .map(sel::number)
                .transpose()?
                .unwrap_or(0.0);
            let padding = Shape::Rectangle {
                x: Number(x - inset),
                y: Number(y - inset),
                width: Positive(w + 2.0 * inset),
                height: Positive(h + 2.0 * inset),
            };
            let cells = shape_cells(if inset > 0.0 { &padding } else { s }, &self.grid)?;
            if !targets.iter().any(|id| {
                cells.iter().all(|i| {
                    self.grid.zone_ids[self.grid.zone_index[*i] as usize].as_ref() == Some(id)
                })
            }) {
                return Err((
                    "NO_WALKABLE_SPACE",
                    "Shape is not inside selected region".into(),
                ));
            }
        } else if !targets.iter().any(|id| sel::distance(self, id, &p) <= d) {
            return Err((
                "NO_WALKABLE_SPACE",
                "Shape is outside placement distance".into(),
            ));
        }
        if let Some(a) = v.get("awayFrom") {
            for s in array(a)? {
                let ids = sel::resolve(self, s, key, work)?;
                if ids.is_empty()
                    || ids
                        .iter()
                        .any(|id| sel::distance(self, id, &p) < d + w.max(h) / 2.0)
                {
                    return Err(("NO_WALKABLE_SPACE", "Shape violates awayFrom".into()));
                }
            }
        }
        if let Some(edge) = v["edge"].as_str() {
            let mut region = vec![];
            for id in &targets {
                if let Some(cells) = self.grid.target_cells.get(id) {
                    region.extend(cells.iter().copied());
                }
            }
            if region.is_empty() {
                return Err(invalid("Edge placement requires a region mask"));
            }
            let g = &self.grid;
            let target = region
                .iter()
                .map(|i| match edge {
                    "north" => (*i / g.width) as f64 * g.cell_size,
                    "south" => (*i / g.width + 1) as f64 * g.cell_size,
                    "west" => (*i % g.width) as f64 * g.cell_size,
                    _ => (*i % g.width + 1) as f64 * g.cell_size,
                })
                .reduce(|a, b| {
                    if matches!(edge, "north" | "west") {
                        a.min(b)
                    } else {
                        a.max(b)
                    }
                })
                .unwrap();
            let shape_edge = match edge {
                "north" => y,
                "south" => y + h,
                "west" => x,
                _ => x + w,
            };
            let pitch = self.initial.resolved_model.layout.body_diameter.0
                * self.initial.resolved_model.layout.spacing_diameters.0;
            if (shape_edge - target).abs() > pitch {
                return Err((
                    "NO_WALKABLE_SPACE",
                    "Exact shape is away from the requested edge".into(),
                ));
            }
        }
        Ok(())
    }
    fn remove_entity(&mut self, id: &Id) -> Result<(), Failure> {
        if self
            .map_state
            .all_portals()?
            .iter()
            .any(|p| p.connects.contains(id))
        {
            return Err(invalid("Remove connected portals before their zone"));
        }
        if self
            .queues
            .iter()
            .any(|q| &q.target_id == id && !q.entries.is_empty())
            || self
                .slots
                .iter()
                .any(|s| &s.target_id == id && s.slots.iter().any(|s| s.agent_id.is_some()))
        {
            for a in &mut self.agents {
                if a.queue_ref.as_ref().is_some_and(|q| &q.target_id == id)
                    || a.interaction_ref
                        .as_ref()
                        .is_some_and(|s| &s.target_id == id)
                {
                    goals::release(a, &mut self.queues, &mut self.slots, false);
                }
            }
        }
        self.runtime.removed_regions.insert(id.clone());
        self.map_state.rooms.retain(|r| &r.id != id);
        self.map_state.portals.retain(|p| &p.id != id);
        if let Some(e) = &mut self.map_state.entities {
            e.retain(|e| &e.id != id)
        }
        self.sync_services()?;
        Ok(())
    }
    pub fn rebuild_geometry(&mut self) -> Result<(), Failure> {
        let mut base = self
            .runtime
            .geometry_base
            .clone()
            .ok_or_else(|| invalid("Missing geometry underlay"))?;
        // Keep source cells; add/remove only repaints explicitly owned masks.
        let live: BTreeSet<_> = base
            .zone_ids
            .iter()
            .flatten()
            .filter(|id| !self.runtime.removed_regions.contains(*id))
            .cloned()
            .chain(
                self.map_state
                    .entities()
                    .iter()
                    .filter(|e| matches!(e.kind, EntityKind::Zone))
                    .map(|e| e.id.clone()),
            )
            .collect();
        for (i, id) in base.zone_ids.iter().enumerate().skip(1) {
            if id.as_ref().is_some_and(|id| !live.contains(id)) {
                for z in &mut base.zone_index {
                    if *z == i as u32 {
                        *z = 0
                    }
                }
            }
        }
        base.zone_ids
            .retain(|id| id.is_none() || id.as_ref().is_some_and(|id| live.contains(id)));
        // Compact dictionaries after removals using IDs, not stale indices.
        for z in &mut base.zone_index {
            let old = &self.runtime.geometry_base.as_ref().unwrap().zone_ids[*z as usize];
            *z = base.zone_ids.iter().position(|id| id == old).unwrap_or(0) as u32;
        }
        let portals = self.map_state.all_portals()?;
        base.portal_index.fill(0);
        base.portal_ids = std::iter::once(None)
            .chain(portals.iter().map(|p| Some(p.id.clone())))
            .collect();
        for (n, p) in portals.iter().enumerate() {
            let s = Shape::Rectangle {
                x: p.x,
                y: p.y,
                width: p.width,
                height: p.height,
            };
            for i in shape_cells(&s, &base)? {
                base.portal_index[i] = (n + 1) as u32;
                base.blocked[i] = if p.open { 0 } else { 1 };
                if base.traversal_cost[i] <= 0.0 {
                    base.traversal_cost[i] = 1.0;
                }
            }
        }
        for e in self.map_state.entities() {
            if matches!(e.kind, EntityKind::Portal) {
                continue;
            }
            if let Some(s) = &e.shape {
                let cells = shape_cells(s, &base)?;
                if matches!(e.kind, EntityKind::Zone) {
                    let n = if let Some(n) = base
                        .zone_ids
                        .iter()
                        .position(|id| id.as_ref() == Some(&e.id))
                    {
                        n
                    } else {
                        base.zone_ids.push(Some(e.id.clone()));
                        base.zone_ids.len() - 1
                    };
                    for i in &cells {
                        if base.blocked[*i] == 0 && shape_contains_cell(s, *i, &base) {
                            base.zone_index[*i] = n as u32;
                        }
                    }
                }
                if e.blocking() {
                    for i in cells {
                        base.blocked[i] = 1;
                    }
                }
            }
        }
        let mut v = serde_json::to_value(&base).unwrap();
        v.as_object_mut().unwrap().remove("targetCells");
        let grid: Grid = serde_json::from_value(v).map_err(|e| invalid(e.to_string()))?;
        let mut map = self.map_state.clone();
        map.rows = None;
        map.legend = None;
        map.grid = Some(grid);
        self.grid = crate::grid::GridData::decode(&map)?;
        self.map_state = map;
        self.wander_cells.clear();
        self.navigator = Navigator::default();
        for a in &mut self.agents {
            a.zone_id = self.grid.zone_at(a.position.x.0, a.position.y.0);
        }
        Ok(())
    }
}
fn shape_cells(s: &Shape, g: &crate::grid::GridData) -> Result<Vec<usize>, Failure> {
    let (x, y, w, h) = s.extent();
    if x < 0.0
        || y < 0.0
        || x + w > g.width as f64 * g.cell_size
        || y + h > g.height as f64 * g.cell_size
    {
        return Err(invalid("Shape outside map"));
    }
    let mut cells = vec![];
    let mut work = 0;
    for row in (y / g.cell_size).floor() as usize..((y + h) / g.cell_size).ceil() as usize {
        for col in (x / g.cell_size).floor() as usize..((x + w) / g.cell_size).ceil() as usize {
            work += match s {
                Shape::Polygon { points } | Shape::ThickLine { points, .. } => points.len(),
                _ => 1,
            };
            if work > 4_000_000 {
                return Err(("RESOURCE_LIMIT", "Shape raster work exceeded".into()));
            }
            if s.intersects(
                col as f64 * g.cell_size,
                row as f64 * g.cell_size,
                g.cell_size,
            ) {
                cells.push(row * g.width + col)
            }
        }
    }
    if cells.is_empty() {
        return Err(invalid("Shape lost at grid resolution"));
    }
    Ok(cells)
}
fn shape_contains_cell(s: &Shape, i: usize, g: &crate::grid::GridData) -> bool {
    let x = (i % g.width) as f64 * g.cell_size;
    let y = (i / g.width) as f64 * g.cell_size;
    let e = g.cell_size * 1e-9;
    let corners = [
        (x + e, y + e),
        (x + g.cell_size - e, y + e),
        (x + e, y + g.cell_size - e),
        (x + g.cell_size - e, y + g.cell_size - e),
    ];
    if !corners.into_iter().all(|(x, y)| {
        s.distance(&Point {
            x: Number(x),
            y: Number(y),
        }) == 0.0
    }) {
        return false;
    }
    if let Shape::ThickLine { points, width } = s {
        return points.windows(2).any(|segment| {
            corners.into_iter().all(|(x, y)| {
                crate::geometry::point_segment(x, y, &segment[0], &segment[1]) <= width.0 / 2.0
            })
        });
    }
    if let Shape::Polygon { points } = s {
        for (a, b) in points
            .iter()
            .zip(points.iter().cycle().skip(1))
            .take(points.len())
        {
            if crate::geometry::segment_rect(
                a,
                b,
                x + e,
                y + e,
                x + g.cell_size - e,
                y + g.cell_size - e,
            ) == 0.0
            {
                return false;
            }
        }
    }
    true
}

impl World {
    fn invalidate_target(&mut self, id: &Id) {
        fn references(g: &GoalSpec, id: &Id) -> bool {
            g.target_zone.as_ref() == Some(id)
                || g.target_entity_id.as_ref() == Some(id)
                || g.inside_zone.as_ref() == Some(id)
                || g.target_ids.as_ref().is_some_and(|ids| ids.contains(id))
                || g.goals
                    .as_ref()
                    .is_some_and(|gs| gs.iter().any(|g| references(g, id)))
        }
        for a in &mut self.agents {
            if a.current_goal
                .as_ref()
                .is_some_and(|g| g.status != "completed" && references(&g.spec, id))
            {
                goals::release(a, &mut self.queues, &mut self.slots, false);
                goals::fail(a, "NOT_FOUND", "Goal target was removed");
            }
            for g in &mut a.goal_queue {
                if references(&g.spec, id) {
                    g.status = "failed".into();
                    g.failure = Some(GoalFailure {
                        code: "NOT_FOUND".into(),
                        message: "Queued goal target was removed".into(),
                    });
                }
            }
        }
    }
}

fn selector_binding(v: &Value, bound: bool) -> Result<(), Failure> {
    if v.get("binding").is_some() {
        sel::keys(v, &["binding"], &["binding"])?;
        if !bound || v["binding"] != "subject" {
            return Err(invalid(
                "subject is only bound inside entity_metric actions",
            ));
        }
        Ok(())
    } else {
        sel::validate(v, 0)
    }
}
pub fn bind_subject(ops: &[Value], id: &Id, scope: &Id) -> Vec<Value> {
    fn selector(v: &mut Value, id: &Id) {
        if v["binding"] == "subject" {
            *v = json!({"ids":[id]});
        }
    }
    fn goal(v: &mut Value, id: &Id) {
        for k in ["target", "inside"] {
            if let Some(s) = v.get_mut(k) {
                selector(s, id);
            }
        }
        if let Some(gs) = v.get_mut("goals").and_then(Value::as_array_mut) {
            for g in gs {
                goal(g, id);
            }
        }
    }
    ops.iter()
        .map(|op| {
            let mut op = op.clone();
            if let Some(s) = op.get_mut("targets") {
                selector(s, id);
            }
            if let Some(g) = op.get_mut("goal") {
                goal(g, id);
            }
            if op["op"] == "schedule" {
                let child = Id(format!(
                    "scoped-schedule-{}",
                    crate::world::fingerprint(&(scope, &op["id"]))
                ));
                op["operations"] = json!(bind_subject(
                    op["operations"].as_array().unwrap(),
                    id,
                    &child
                ));
                op["id"] = json!(child);
            }
            op
        })
        .collect()
}
