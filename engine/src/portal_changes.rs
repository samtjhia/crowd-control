//! Narrow, recorded topology and mobility interventions. General operations/replay remain disabled.
use crate::{
    core::{Failure, invalid, unsupported},
    grid::GridData,
    navigation::Navigator,
    protocol::*,
    world::{World, fingerprint},
};
use serde_json::{Value, json};

impl World {
    pub fn apply_request(&mut self, raw: &Value) -> Result<Value, Failure> {
        if matches!(
            raw["action"].as_str(),
            Some("edit_intervention" | "delete_intervention")
        ) {
            return Err(unsupported(
                "Editing/deleting interventions requires replay",
            ));
        }
        let request: PortalRequest =
            serde_json::from_value(raw.clone()).map_err(|e| invalid(e.to_string()))?;
        if request.schema_version.0 != 1.0
            || request.simulation_id != self.initial.scene.simulation_id
        {
            return Err(invalid("Intervention header mismatch"));
        }
        let content = raw.to_string();
        if let Some(old) = self.request_contents.get(&request.request_id) {
            if old != &content {
                return Err(invalid("requestId was already used with different content"));
            }
            return Ok(self
                .history
                .outcomes
                .iter()
                .find(|o| o["requestId"] == json!(request.request_id))
                .unwrap()["result"]
                .clone());
        }
        if self.history.outcomes.len() >= 1000 {
            return Err((
                "RESOURCE_LIMIT",
                "Intervention outcome budget exceeded".into(),
            ));
        }
        if self
            .request_contents
            .values()
            .map(String::len)
            .sum::<usize>()
            + content.len()
            > 2 * 1024 * 1024
        {
            return Err((
                "RESOURCE_LIMIT",
                "Recorded request content exceeds 2 MiB".into(),
            ));
        }
        let result=self.apply_changes(&request).map(|value|json!({"ok":true,"value":value})).unwrap_or_else(|(code,message)|json!({"ok":false,"error":{"code":code,"message":message,"requestId":request.request_id}}));
        self.request_contents
            .insert(request.request_id.clone(), content);
        self.history.outcomes.push(
            json!({"requestId":request.request_id,"contentHash":fingerprint(raw),"result":result}),
        );
        Ok(result)
    }
    fn apply_changes(&mut self, request: &PortalRequest) -> Result<Value, Failure> {
        if request
            .at
            .is_some_and(|at| (at.0 - self.time()).abs() > self.initial.scene.model.dt.0 * 1e-9)
        {
            return Err(unsupported(
                "Only immediate portal/mobility changes are enabled; scheduled/past work needs the later scheduler/replay",
            ));
        }
        if request.operations.is_empty() {
            return Err(invalid("Empty operation batch"));
        }
        if request.operations.len() > 100 {
            return Err((
                "RESOURCE_LIMIT",
                "Portal operation batch exceeds budget".into(),
            ));
        }
        let mut parsed = vec![];
        for value in &request.operations {
            if value["op"] != "set" {
                return Err(unsupported(
                    "Only portal.open and agent mobility set operations are enabled",
                ));
            }
            if value["targets"]
                .as_object()
                .is_some_and(|fields| fields.keys().any(|key| key != "ids" && key != "kind"))
            {
                return Err(unsupported(
                    "Changes currently require explicit ID selectors",
                ));
            }
            let op: ChangeOperation =
                serde_json::from_value(value.clone()).map_err(|e| invalid(e.to_string()))?;
            let portal = op.values.components.portal.is_some();
            if portal == op.values.components.mobility.is_some()
                || (portal && op.values.appearance.is_some())
            {
                return Err(invalid(
                    "Set exactly one of portal.open or agent mobility; pose may accompany mobility",
                ));
            }
            if op.targets.kind.as_ref().is_some_and(|kind| {
                !matches!(
                    (portal, kind),
                    (true, EntityKind::Portal) | (false, EntityKind::Agent)
                )
            }) {
                return Err(invalid(
                    "Selector kind does not match the changed component",
                ));
            }
            if op.targets.ids.is_empty() || op.targets.ids.len() > 1000 {
                return Err(invalid("ID selector must contain 1–1000 IDs"));
            }
            for id in &op.targets.ids {
                let found = if portal {
                    self.map_state.portals.iter().any(|p| &p.id == id)
                } else {
                    self.agents.iter().any(|a| &a.id == id)
                };
                if !found {
                    return Err(("NOT_FOUND", format!("Unknown target {}", id.0)));
                }
            }
            parsed.push(op);
        }
        let mut candidate = self.clone();
        for op in parsed {
            for id in &op.targets.ids {
                if let Some(portal) = &op.values.components.portal {
                    candidate
                        .map_state
                        .portals
                        .iter_mut()
                        .find(|p| &p.id == id)
                        .unwrap()
                        .open = portal.open;
                } else {
                    let a = candidate.agents.iter_mut().find(|a| &a.id == id).unwrap();
                    a.components.mobility = op.values.components.mobility.as_ref().unwrap().clone();
                    if let Some(appearance) = &op.values.appearance {
                        a.appearance["pose"] = json!(appearance.pose);
                    }
                    if a.components.mobility.speed_multiplier.0 == 0.0 {
                        a.state = "immobile".into();
                        a.state_reason = None;
                        a.velocity = Point {
                            x: Number(0.0),
                            y: Number(0.0),
                        };
                        if let Some(g) = &mut a.current_goal {
                            if g.status != "completed" && g.status != "failed" {
                                g.status = "suspended".into();
                            }
                        }
                    } else {
                        a.state = "idle".into();
                        a.state_reason = None;
                        if let Some(g) = &mut a.current_goal {
                            if g.status == "suspended" {
                                g.status = "active".into();
                            }
                        }
                    }
                }
            }
        }
        let changed = candidate
            .map_state
            .portals
            .iter()
            .zip(&self.map_state.portals)
            .any(|(a, b)| a.open != b.open)
            || candidate.agents.iter().zip(&self.agents).any(|(a, b)| {
                a.components.physical.blocks_movement
                    && a.components.physical.movable
                    && (a.components.mobility.speed_multiplier.0 == 0.0)
                        != (b.components.mobility.speed_multiplier.0 == 0.0)
            });
        if changed {
            candidate.grid = GridData::decode(&candidate.map_state)?;
            for a in &candidate.agents {
                if candidate
                    .grid
                    .footprint(
                        a.position.x.0,
                        a.position.y.0,
                        a.components.physical.radius.0,
                    )
                    .iter()
                    .any(|i| candidate.grid.blocked[*i] != 0)
                {
                    return Err((
                        "NO_WALKABLE_SPACE",
                        "A portal closure would intersect an existing body".into(),
                    ));
                }
            }
            candidate.topology_version = candidate
                .topology_version
                .checked_add(1)
                .filter(|v| *v <= 9_007_199_254_740_991)
                .ok_or_else(|| invalid("Topology counter exhausted"))?;
            candidate.navigator = Navigator::default();
        }
        candidate.scene_version += 1;
        candidate.prepare_navigation()?;
        candidate.history.history_revision.0 += 1.0;
        let id = Id(format!(
            "intervention-{}",
            candidate.history.records.len() + 1
        ));
        let at = request.at.map_or(candidate.time(), |v| v.0);
        candidate.history.records.push(json!({"id":id,"revision":1,"origin":"followup","label":request.label.as_deref().unwrap_or("Runtime change"),"at":at,"order":candidate.history.records.len(),"operations":request.operations,"deleted":false}));
        let ack = json!({"requestId":request.request_id,"interventionId":id,"revision":1,"at":at,"historyRevision":candidate.history.history_revision});
        *self = candidate;
        Ok(ack)
    }
}
