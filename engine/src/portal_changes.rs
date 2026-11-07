//! Recorded live batches. Past changes and edit/delete remain unavailable until replay.
use crate::{
    core::{Failure, invalid, unsupported},
    operations,
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
        if self.history.outcomes.len() >= 1000
            || self
                .request_contents
                .values()
                .map(String::len)
                .sum::<usize>()
                + content.len()
                > 2 * 1024 * 1024
        {
            return Err((
                "RESOURCE_LIMIT",
                "Intervention outcome/content budget exceeded".into(),
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
    fn apply_changes(&mut self, r: &PortalRequest) -> Result<Value, Failure> {
        operations::validate_live(&r.operations)?;
        let at = r.at.map_or(self.time(), |t| t.0);
        if at + 1e-12 < self.time() {
            return Err(unsupported("Past interventions require replay"));
        }
        let mut candidate = self.clone();
        candidate.runtime.work = 0;
        let id = Id(format!(
            "intervention-{}",
            candidate.history.records.len() + 1
        ));
        let origin = json!({"interventionId":id,"revision":1});
        if at > self.time() {
            let job_id =
                crate::goals::allocate(&mut candidate.allocations.next_job, "intervention-job")?;
            candidate.schedule(job_id, at, r.operations.clone(), origin.clone())?;
        } else {
            candidate.execute_operations(&r.operations, &origin, &id.0, &mut 0)?;
        }
        candidate.pump()?;
        candidate.prepare_navigation()?;
        // Even a goal-only change advances scene metadata before frames at the new history revision.
        if candidate.scene_version == self.scene_version {
            candidate.metadata_changed(false)?;
        }
        candidate.history.history_revision.0 += 1.0;
        candidate.history.records.push(json!({"id":id,"revision":1,"origin":"followup","label":r.label.as_deref().unwrap_or("Runtime change"),"at":at,"order":candidate.history.records.len(),"operations":r.operations,"deleted":false}));
        let ack = json!({"requestId":r.request_id,"interventionId":id,"revision":1,"at":at,"historyRevision":candidate.history.history_revision});
        *self = candidate;
        Ok(ack)
    }
}
