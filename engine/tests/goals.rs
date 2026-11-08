use crowd_control_engine::Engine;
use serde_json::{Value, json};
fn command(kind: &str) -> Value {
    json!({"schemaVersion":1,"simulationId":"engine-demo","commandId":kind,"type":kind})
}
fn send(e: &mut Engine, c: Value) -> Vec<Value> {
    serde_json::from_str(&e.dispatch(&c.to_string())).unwrap()
}
fn step(e: &mut Engine, n: u64) {
    let mut c = command("step");
    c["ticks"] = json!(n);
    let out = send(e, c);
    assert_eq!(out[0]["type"], "ack", "{out:?}");
}
fn state(e: &mut Engine) -> Value {
    let mut c = command("snapshot");
    c["snapshotId"] = json!("state");
    send(e, c)[0]["snapshot"].clone()
}
fn base(goals: Value) -> Value {
    let mut v: Value = serde_json::from_str(include_str!(
        "../../contract/fixtures/engine-navigation-load.json"
    ))
    .unwrap();
    let (w, h) = (12, 8);
    let mut blocked = vec![0; w * h];
    let mut zones = vec![1; w * h];
    for y in 0..h {
        for x in 0..w {
            if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                blocked[y * w + x] = 1;
                zones[y * w + x] = 0;
            } else if x == w - 2 {
                zones[y * w + x] = 2;
            }
        }
    }
    v["compiled"]["scene"]["map"] = json!({"width":w,"height":h,"cellSize":1,"units":"model","rooms":[],"portals":[],"grid":{"width":w,"height":h,"cellSize":1,"units":"model","blocked":blocked,"traversalCost":vec![1;w*h],"zoneIndex":zones,"portalIndex":vec![0;w*h],"zoneIds":[null,"hall","outside"],"portalIds":[null]}});
    v["compiled"]["scene"]["controllers"] = json!({"test":goals});
    v["compiled"]["scene"]["agents"] = json!([{"id":"a1","tags":["attendee"],"profile":"person","x":3.5,"y":3.5,"controller":"test"}]);
    v
}
fn init(v: Value) -> Engine {
    let mut e = Engine::default();
    let out = send(&mut e, v);
    assert_eq!(out[0]["type"], "ack", "{out:?}");
    e
}
fn request(e: &mut Engine, id: &str, operations: Value) -> Vec<Value> {
    let mut c = command("apply_request");
    c["request"] = json!({"schemaVersion":1,"simulationId":"engine-demo","requestId":id,"operations":operations});
    send(e, c)
}
fn apply(e: &mut Engine, id: &str, operations: Value) {
    let out = request(e, id, operations);
    assert_eq!(out[0]["type"], "ack", "{out:?}");
}
fn mobility(e: &mut Engine, id: &str, target: &str, n: f64) {
    apply(
        e,
        id,
        json!([{"op":"set","targets":{"ids":[target]},"values":{"components":{"mobility":{"speedMultiplier":n}}}}]),
    );
}
fn desk_goal() -> Value {
    json!({"kind":"sequence","goals":[{"kind":"queue","targetEntityId":"desk","maximumWait":10},{"kind":"interact","targetEntityId":"desk"}]})
}
fn desk(v: &mut Value) {
    v["compiled"]["scene"]["map"]["entities"] = json!([{"id":"desk","kind":"object","label":"Check-in desk","tags":["desk"],"shape":{"kind":"rectangle","x":6,"y":3,"width":1,"height":1},"appearance":{"fill":"#92400E"},"components":{"physical":{"blocksMovement":true,"movable":false},"capacity":{"maximumOccupants":1,"serviceRate":2},"interaction":{"duration":1,"slots":1}}}]);
    v["compiled"]["scene"]["map"]["grid"]["blocked"][3 * 12 + 6] = json!(1);
}
#[test]
fn nested_sequences_preserve_repetitions_and_wait_progress() {
    let goal = json!({"kind":"sequence","goals":[{"kind":"sequence","repeat":2,"goals":[{"kind":"wait","duration":0.2},{"kind":"wait","duration":0.1}]},{"kind":"wait","duration":0.2}]});
    let mut a = init(base(goal.clone()));
    let mut b = init(base(goal));
    step(&mut a, 5);
    let mid = state(&mut a);
    assert_eq!(
        mid["agents"][0]["currentGoal"]["cursor"][1]["childIndex"],
        1.0
    );
    assert_eq!(
        mid["agents"][0]["currentGoal"]["cursor"][1]["repeatsRemaining"],
        2.0
    );
    assert_eq!(mid["agents"][0]["state"], "waiting");
    step(&mut a, 11);
    for _ in 0..16 {
        step(&mut b, 1);
    }
    assert_eq!(state(&mut a), state(&mut b));
    assert_eq!(
        state(&mut a)["agents"][0]["currentGoal"]["status"],
        "completed"
    );
}
#[test]
fn wait_travels_to_zone_before_dwell_and_departure_is_explicit_once() {
    let mut e = init(base(
        json!({"kind":"wait","insideZone":"outside","duration":0.3}),
    ));
    step(&mut e, 10);
    assert_eq!(
        state(&mut e)["agents"][0]["currentGoal"]["execution"]["elapsed"],
        0.0
    );
    step(&mut e, 220);
    let s = state(&mut e);
    assert_eq!(s["agents"][0]["zoneId"], "outside");
    assert_eq!(s["agents"][0]["currentGoal"]["status"], "completed");
    assert!(s["agents"][0]["departedAt"].is_null());
    apply(
        &mut e,
        "leave",
        json!([{"op":"assign_goal","targets":{"ids":["a1"]},"goal":{"kind":"reach","target":{"ids":["outside"]},"departOnArrival":true}}]),
    );
    step(&mut e, 20);
    let s = state(&mut e);
    assert_eq!(s["agents"][0]["state"], "departed");
    assert_eq!(s["metrics"]["departures"].as_array().unwrap().len(), 1);
    assert_eq!(s["events"][0]["name"], "departure");
    step(&mut e, 20);
    assert_eq!(
        state(&mut e)["metrics"]["departures"],
        s["metrics"]["departures"]
    );
    apply(
        &mut e,
        "clear-departed",
        json!([{"op":"clear_goal","targets":{"ids":["a1"]}}]),
    );
    assert_eq!(state(&mut e)["agents"][0]["state"], "departed");
}
#[test]
fn wander_is_seeded_bounded_to_zone_and_duration_pauses_during_immobility() {
    let input =
        base(json!({"kind":"wander","insideZone":"hall","duration":1,"changeTargetEvery":0.2}));
    let mut a = init(input.clone());
    let mut b = init(input);
    step(&mut a, 5);
    for _ in 0..5 {
        step(&mut b, 1);
    }
    assert_eq!(state(&mut a), state(&mut b));
    let before = state(&mut a);
    assert_ne!(
        before["agents"][0]["randomState"],
        state(&mut init(base(json!({"kind":"wait","duration":1}))))["agents"][0]["randomState"]
    );
    mobility(&mut a, "stop", "a1", 0.0);
    step(&mut a, 40);
    let frozen = state(&mut a);
    assert_eq!(
        frozen["agents"][0]["position"],
        before["agents"][0]["position"]
    );
    assert_eq!(
        frozen["agents"][0]["currentGoal"]["execution"],
        before["agents"][0]["currentGoal"]["execution"]
    );
    mobility(&mut a, "recover", "a1", 1.0);
    step(&mut a, 15);
    let done = state(&mut a);
    assert_eq!(done["agents"][0]["currentGoal"]["status"], "completed");
    assert_eq!(done["agents"][0]["zoneId"], "hall");
}
#[test]
fn follow_replans_for_a_moving_leader_and_avoid_keeps_monitoring() {
    let mut v = base(json!({"kind":"follow","targetEntityId":"leader","distance":1}));
    v["compiled"]["scene"]["controllers"]["leader"] = json!({"kind":"sequence","goals":[{"kind":"wait","duration":0.2},{"kind":"reach","targetZone":"outside"}]});
    v["compiled"]["scene"]["agents"].as_array_mut().unwrap().push(json!({"id":"leader","tags":[],"profile":"person","x":5.5,"y":3.5,"controller":"leader"}));
    let mut e = init(v);
    step(&mut e, 180);
    let s = state(&mut e);
    assert!(s["agents"][0]["position"]["x"].as_f64().unwrap() > 7.0);
    assert_eq!(s["agents"][0]["currentGoal"]["status"], "active");
    let mut v = base(json!({"kind":"avoid","targetEntityId":"hazard","distance":3}));
    v["compiled"]["scene"]["map"]["entities"] = json!([{"id":"hazard","kind":"object","shape":{"kind":"circle","center":{"x":4.5,"y":3.5},"radius":0.25}}]);
    let mut e = init(v);
    step(&mut e, 160);
    let s = state(&mut e);
    let p = &s["agents"][0]["position"];
    assert!((p["x"].as_f64().unwrap() - 4.5).hypot(p["y"].as_f64().unwrap() - 3.5) >= 3.25 - 1e-6);
    assert_eq!(s["agents"][0]["currentGoal"]["status"], "active");
}
#[test]
fn queue_is_fifo_rate_limited_and_interaction_slots_release() {
    let mut v = base(desk_goal());
    desk(&mut v);
    v["compiled"]["scene"]["agents"][0]["x"] = json!(4.5);
    v["compiled"]["scene"]["agents"]
        .as_array_mut()
        .unwrap()
        .push(json!({"id":"a2","tags":[],"profile":"person","x":5.5,"y":2.5,"controller":"test"}));
    let mut e = init(v);
    step(&mut e, 1);
    let queued = state(&mut e);
    assert_eq!(queued["queues"][0]["entries"][0]["agentId"], "a1");
    assert_eq!(queued["queues"][0]["entries"][1]["agentId"], "a2");
    step(&mut e, 10);
    let serving = state(&mut e);
    assert_eq!(serving["agents"][0]["state"], "interacting");
    assert_eq!(serving["agents"][1]["state"], "queueing");
    assert_eq!(serving["slots"][0]["slots"][0]["agentId"], "a1");
    step(&mut e, 50);
    let done = state(&mut e);
    assert!(
        done["agents"]
            .as_array()
            .unwrap()
            .iter()
            .all(|a| a["currentGoal"]["status"] == "completed")
    );
    assert!(done["queues"][0]["entries"].as_array().unwrap().is_empty());
    assert!(done["slots"][0]["slots"][0]["agentId"].is_null());
    assert_eq!(done["entities"][0]["appearance"]["fill"], "#92400E");
}
#[test]
fn stopping_service_releases_claims_recovery_restarts_duration_and_requeues() {
    let mut v = base(desk_goal());
    desk(&mut v);
    v["compiled"]["scene"]["agents"][0]["x"] = json!(4.5);
    let mut e = init(v);
    step(&mut e, 1);
    let old_ticket = state(&mut e)["agents"][0]["queueRef"]["ticketId"].clone();
    mobility(&mut e, "stop-queue", "a1", 0.0);
    assert!(
        state(&mut e)["queues"][0]["entries"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    mobility(&mut e, "recover-queue", "a1", 1.0);
    step(&mut e, 1);
    assert_ne!(
        state(&mut e)["agents"][0]["queueRef"]["ticketId"],
        old_ticket
    );
    step(&mut e, 11);
    assert_eq!(state(&mut e)["agents"][0]["state"], "interacting");
    mobility(&mut e, "stop-slot", "a1", 0.0);
    let s = state(&mut e);
    assert!(s["slots"][0]["slots"][0]["agentId"].is_null());
    step(&mut e, 40);
    mobility(&mut e, "recover-slot", "a1", 1.0);
    step(&mut e, 1);
    let s = state(&mut e);
    let end = s["agents"][0]["interactionRef"]["endsAt"].as_f64().unwrap();
    assert!(end - s["tick"].as_f64().unwrap() * 0.05 > 0.9);
    step(&mut e, 25);
    assert_eq!(
        state(&mut e)["agents"][0]["currentGoal"]["status"],
        "completed"
    );
}
#[test]
fn assign_enqueue_clear_scopes_and_failed_batch_preserve_state() {
    let mut e = init(base(json!({"kind":"wait","duration":1})));
    step(&mut e, 3);
    let old = state(&mut e)["agents"][0]["currentGoal"].clone();
    apply(
        &mut e,
        "enqueue",
        json!([{"op":"assign_goal","targets":{"ids":["a1"]},"mode":"enqueue","goal":{"kind":"wait","duration":0.2}}]),
    );
    let s = state(&mut e);
    assert_eq!(s["agents"][0]["currentGoal"], old);
    assert_eq!(s["agents"][0]["goalQueue"][0]["status"], "pending");
    apply(
        &mut e,
        "clear-queued",
        json!([{"op":"clear_goal","targets":{"ids":["a1"]},"scope":"queued"}]),
    );
    assert_eq!(state(&mut e)["agents"][0]["currentGoal"], old);
    let before = state(&mut e);
    let out = request(
        &mut e,
        "bad-batch",
        json!([{"op":"assign_goal","targets":{"ids":["a1"]},"goal":{"kind":"wait","duration":0}},{"op":"clear_goal","targets":{"ids":["missing"]}}]),
    );
    assert_eq!(out[0]["error"]["code"], "NOT_FOUND");
    assert_eq!(state(&mut e), before);
    apply(
        &mut e,
        "replace",
        json!([{"op":"assign_goal","targets":{"ids":["a1"]},"goal":{"kind":"wait","duration":0.1}}]),
    );
    step(&mut e, 2);
    assert_eq!(
        state(&mut e)["agents"][0]["currentGoal"]["status"],
        "completed"
    );
    mobility(&mut e, "stop", "a1", 0.0);
    apply(
        &mut e,
        "clear",
        json!([{"op":"clear_goal","targets":{"ids":["a1"]}}]),
    );
    assert_eq!(state(&mut e)["agents"][0]["state"], "immobile");
}
#[test]
fn queue_timeout_fails_sequence_without_running_the_next_child() {
    let mut v = base(
        json!({"kind":"sequence","goals":[{"kind":"queue","targetEntityId":"desk","maximumWait":0.1},{"kind":"wait","duration":0}]}),
    );
    desk(&mut v);
    v["compiled"]["scene"]["agents"][0]["x"] = json!(4.5);
    v["compiled"]["scene"]["map"]["entities"][0]["components"]["capacity"]["maximumOccupants"] =
        json!(0);
    let mut e = init(v);
    step(&mut e, 5);
    let s = state(&mut e);
    assert_eq!(s["agents"][0]["currentGoal"]["status"], "failed");
    assert_eq!(
        s["agents"][0]["currentGoal"]["failure"]["code"],
        "QUEUE_TIMEOUT"
    );
    assert!(s["queues"][0]["entries"].as_array().unwrap().is_empty());
    assert_eq!(
        s["agents"][0]["currentGoal"]["cursor"][0]["childIndex"],
        0.0
    );
}

#[test]
fn static_shapes_preserve_metadata_and_reject_missing_collision_masks_atomically() {
    for shape in [
        json!({"kind":"rectangle","x":6.0,"y":3.0,"width":1.0,"height":1.0}),
        json!({"kind":"circle","center":{"x":6.5,"y":3.5},"radius":0.4}),
        json!({"kind":"polygon","points":[{"x":6.0,"y":3.0},{"x":7.0,"y":3.0},{"x":6.5,"y":4.0}]}),
        json!({"kind":"thick_line","points":[{"x":6.2,"y":3.5},{"x":6.8,"y":3.5}],"width":0.4}),
    ] {
        let mut v = base(json!({"kind":"reach","targetEntityId":"desk"}));
        desk(&mut v);
        v["compiled"]["scene"]["map"]["entities"][0]["shape"] = shape.clone();
        let mut e = init(v.clone());
        step(&mut e, 80);
        let s = state(&mut e);
        assert_eq!(s["agents"][0]["currentGoal"]["status"], "completed");
        assert_eq!(s["entities"][0]["shape"], shape);
        v["compiled"]["scene"]["map"]["grid"]["blocked"][3 * 12 + 6] = json!(0);
        assert_eq!(send(&mut e, v)[0]["error"]["code"], "INVALID_SCHEMA");
        assert_eq!(state(&mut e), s);
    }
}

#[test]
fn service_cannot_be_reached_through_a_wall_and_zero_wait_can_admit_immediately() {
    let mut v = base(desk_goal());
    desk(&mut v);
    v["compiled"]["scene"]["agents"][0]["x"] = json!(4.5);
    for y in 1..7 {
        v["compiled"]["scene"]["map"]["grid"]["blocked"][y * 12 + 5] = json!(1);
    }
    let mut e = init(v);
    step(&mut e, 80);
    let s = state(&mut e);
    assert_eq!(s["agents"][0]["state"], "blocked");
    assert!(s["queues"][0]["entries"].as_array().unwrap().is_empty());
    let mut v = base(json!({"kind":"queue","targetEntityId":"desk","maximumWait":0}));
    desk(&mut v);
    v["compiled"]["scene"]["agents"][0]["x"] = json!(4.5);
    v["compiled"]["scene"]["map"]["entities"][0]["components"]["capacity"]
        .as_object_mut()
        .unwrap()
        .remove("serviceRate");
    let mut e = init(v);
    step(&mut e, 1);
    assert_eq!(
        state(&mut e)["agents"][0]["currentGoal"]["status"],
        "completed"
    );
}

#[test]
fn clearing_current_activates_pending_work_and_replacement_releases_a_slot() {
    let mut v = base(json!({"kind":"interact","targetEntityId":"desk"}));
    desk(&mut v);
    v["compiled"]["scene"]["agents"][0]["x"] = json!(4.5);
    let mut e = init(v);
    step(&mut e, 2);
    assert_eq!(state(&mut e)["agents"][0]["state"], "interacting");
    apply(
        &mut e,
        "enqueue",
        json!([{"op":"assign_goal","targets":{"ids":["a1"]},"mode":"enqueue","goal":{"kind":"wait","duration":0.2}}]),
    );
    let pending = state(&mut e)["agents"][0]["goalQueue"][0]["id"].clone();
    apply(
        &mut e,
        "clear-current",
        json!([{"op":"clear_goal","targets":{"ids":["a1"]},"scope":"current"}]),
    );
    let s = state(&mut e);
    assert_eq!(s["agents"][0]["currentGoal"]["id"], pending);
    assert!(s["slots"][0]["slots"][0]["agentId"].is_null());
    step(&mut e, 4);
    assert_eq!(
        state(&mut e)["agents"][0]["currentGoal"]["status"],
        "completed"
    );
}

#[test]
fn transition_budget_failure_rolls_back_cursors_and_service_credit() {
    let mut v = base(desk_goal());
    desk(&mut v);
    v["compiled"]["scene"]["agents"][0]["x"] = json!(4.5);
    let mut e = init(v);
    step(&mut e, 3);
    apply(
        &mut e,
        "zero-loop",
        json!([{"op":"assign_goal","targets":{"ids":["a1"]},"goal":{"kind":"sequence","repeat":100,"goals":[{"kind":"wait","duration":0}]}}]),
    );
    let s = state(&mut e);
    let mut c = command("step");
    c["ticks"] = json!(1);
    assert_eq!(send(&mut e, c)[0]["error"]["code"], "RESOURCE_LIMIT");
    assert_eq!(state(&mut e), s);
}

#[test]
fn removing_an_agent_releases_its_slot_and_is_not_a_departure() {
    let mut v = base(json!({"kind":"interact","targetEntityId":"desk"}));
    desk(&mut v);
    v["compiled"]["scene"]["agents"][0]["x"] = json!(4.5);
    let mut e = init(v);
    step(&mut e, 2);
    assert_eq!(state(&mut e)["agents"][0]["state"], "interacting");
    let result = request(
        &mut e,
        "remove",
        json!([{"op":"remove","targets":{"kind":"agent","ids":["a1"]}}]),
    );
    assert_eq!(result[0]["type"], "ack");
    assert_eq!(result[1]["type"], "scene");
    assert!(result[2]["frame"]["agents"].as_array().unwrap().is_empty());
    let s = state(&mut e);
    assert!(s["slots"][0]["slots"][0]["agentId"].is_null());
    assert_eq!(s["metrics"]["removedCount"], 1);
    assert!(s["metrics"]["departures"].as_array().unwrap().is_empty());
    assert_eq!(s["events"][0]["name"], "removed");
    assert_eq!(
        request(
            &mut e,
            "remove",
            json!([{"op":"remove","targets":{"kind":"agent","ids":["a1"]}}])
        )[0]["applied"],
        result[0]["applied"]
    );
    assert_eq!(state(&mut e), s);
}

#[test]
fn wander_duration_starts_in_its_zone_and_unknown_writable_fields_are_rejected() {
    let mut v = base(json!({"kind":"wander","insideZone":"hall","duration":0.2}));
    v["compiled"]["scene"]["agents"][0]["x"] = json!(10.5);
    let mut e = init(v);
    step(&mut e, 5);
    let s = state(&mut e);
    assert_eq!(s["agents"][0]["currentGoal"]["status"], "active");
    assert_eq!(s["agents"][0]["currentGoal"]["execution"]["elapsed"], 0.0);
    step(&mut e, 100);
    assert_eq!(
        state(&mut e)["agents"][0]["currentGoal"]["status"],
        "completed"
    );
    let before = state(&mut e);
    assert_eq!(
        request(
            &mut e,
            "bad",
            json!([{"op":"assign_goal","targets":{"ids":["a1"]},"goal":{"kind":"reach","targetZone":"outside"}}])
        )[0]["error"]["code"],
        "INVALID_SCHEMA"
    );
    assert_eq!(state(&mut e), before);
}

#[test]
fn generic_portal_entities_hold_queues_until_open_and_respect_direction() {
    let mut v: Value = serde_json::from_str(include_str!(
        "../../contract/fixtures/engine-navigation-load.json"
    ))
    .unwrap();
    v["compiled"]["scene"]["map"]["portals"] = json!([]);
    v["compiled"]["scene"]["map"]["entities"] = json!([{"id":"door","kind":"portal","shape":{"kind":"rectangle","x":3,"y":2,"width":1,"height":1},"components":{"portal":{"connects":["hall","outside"],"open":false,"oneWay":true}}}]);
    v["compiled"]["scene"]["controllers"]["leave"] =
        json!({"kind":"queue","targetEntityId":"door","maximumWait":20});
    let mut e = init(v.clone());
    step(&mut e, 100);
    assert_eq!(state(&mut e)["agents"][0]["state"], "queueing");
    apply(
        &mut e,
        "open",
        json!([{"op":"set","targets":{"ids":["door"]},"values":{"components":{"portal":{"open":true}}}}]),
    );
    step(&mut e, 1);
    assert_eq!(
        state(&mut e)["agents"][0]["currentGoal"]["status"],
        "completed"
    );
    v["compiled"]["scene"]["agents"][0]["x"] = json!(4.5);
    let mut wrong_side = init(v);
    step(&mut wrong_side, 100);
    let s = state(&mut wrong_side);
    assert_eq!(s["agents"][0]["state"], "blocked");
    assert!(s["queues"][0]["entries"].as_array().unwrap().is_empty());
}

#[test]
fn large_goal_batches_are_rejected_before_cloning_runtime_trees() {
    let mut v = base(json!({"kind":"wait","duration":1}));
    let ids: Vec<_> = (0..129).map(|i| format!("person-{i}")).collect();
    v["compiled"]["scene"]["agents"]=json!(ids.iter().map(|id|json!({"id":id,"tags":[],"profile":"person","controller":"test","x":3.5,"y":3.5,"components":{"physical":{"blocksMovement":false}}})).collect::<Vec<_>>());
    let mut e = init(v);
    let before = state(&mut e);
    let goal = json!({"kind":"sequence","goals":vec![json!({"kind":"wait","duration":1});512]});
    let result = request(
        &mut e,
        "too-large",
        json!([{"op":"assign_goal","targets":{"ids":ids},"goal":goal}]),
    );
    assert_eq!(result[0]["error"]["code"], "RESOURCE_LIMIT");
    assert_eq!(state(&mut e), before);
}

#[test]
fn obstructed_wander_retargets_before_its_refresh_timer() {
    let mut e = init(base(
        json!({"kind":"wander","insideZone":"hall","changeTargetEvery":600}),
    ));
    step(&mut e, 1);
    let before = state(&mut e);
    let target = &before["agents"][0]["currentGoal"]["execution"]["targetPoint"];
    let tx = target["x"].as_f64().unwrap().floor();
    let ty = target["y"].as_f64().unwrap().floor();
    apply(
        &mut e,
        "block-target",
        json!([{"op":"add","entity":{"id":"table","kind":"barrier","shape":{"kind":"rectangle","x":tx,"y":ty,"width":1,"height":1}}}]),
    );
    step(&mut e, 180);
    let after = state(&mut e);
    assert_ne!(
        after["agents"][0]["randomState"], before["agents"][0]["randomState"],
        "must retarget instead of pushing at furniture for 600 seconds"
    );
    assert_ne!(
        after["agents"][0]["currentGoal"]["execution"]["targetPoint"],
        *target
    );
}
