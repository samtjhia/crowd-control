use crowd_control_engine::Engine;
use serde_json::{Value, json};
fn load() -> Value {
    serde_json::from_str(include_str!(
        "../../contract/fixtures/engine-static-load.json"
    ))
    .unwrap()
}
fn grid_load() -> Value {
    serde_json::from_str(include_str!(
        "../../contract/fixtures/engine-grid-load.json"
    ))
    .unwrap()
}
fn send(e: &mut Engine, value: &Value) -> Vec<Value> {
    serde_json::from_str(&e.dispatch(&value.to_string())).unwrap()
}
fn command(kind: &str) -> Value {
    json!({"schemaVersion":1,"simulationId":"engine-demo","commandId":kind,"type":kind})
}
fn snapshot(e: &mut Engine) -> Value {
    let mut c = command("snapshot");
    c["snapshotId"] = json!("checkpoint");
    send(e, &c)[0]["snapshot"].clone()
}
fn step(e: &mut Engine, ticks: u64) -> Vec<Value> {
    let mut c = command("step");
    c["ticks"] = json!(ticks);
    send(e, &c)
}
fn run_to(e: &mut Engine, time: f64) -> Vec<Value> {
    let mut c = command("run_to");
    c["time"] = json!(time);
    send(e, &c)
}

#[test]
fn initializes_complete_independent_agents_and_seed_streams() {
    let mut e = Engine::default();
    let mut input = load();
    input["compiled"]["resolvedModel"]["defaultAgent"]["behavior"]["reactionDelay"] = json!(3);
    input["compiled"]["scene"]["profiles"]["person"]["behavior"] = json!({"groupCohesion":0.5});
    input["compiled"]["scene"]["agents"][0]["components"] =
        json!({"behavior":{"groupCohesion":0.75},"mobility":{"speedMultiplier":0}});
    send(&mut e, &input);
    let state = snapshot(&mut e);
    let a = &state["agents"][0];
    let b = &state["agents"][1];
    assert_eq!(a["components"]["behavior"]["reactionDelay"], 3.0);
    assert_eq!(a["components"]["behavior"]["groupCohesion"], 0.75);
    assert_eq!(b["components"]["behavior"]["groupCohesion"], 0.5);
    assert_eq!(a["state"], "immobile");
    assert_eq!(b["state"], "idle");
    for agent in [a, b] {
        assert_eq!(agent["velocity"], json!({"x":0.0,"y":0.0}));
        for field in [
            "sensors",
            "stateReason",
            "controller",
            "currentGoal",
            "queueRef",
            "interactionRef",
            "departedAt",
        ] {
            assert!(agent[field].is_null(), "{field}");
        }
        assert_eq!(agent["goalQueue"], json!([]));
        assert_eq!(agent["timers"]["reactionRemaining"], 0.0);
        assert_eq!(agent["navigation"]["mapVersion"], 0.0);
        assert_eq!(agent["zoneId"], "hall");
    }
    assert_ne!(a["randomState"], b["randomState"]);
    assert_ne!(state["random"]["placement"], a["randomState"]);
    assert_eq!(state["random"]["layout"], 42);
    assert_eq!(state["overlays"][0]["entityId"], "a1");
    assert!(
        state["allocations"]["reserved"][0]["ids"]
            .as_array()
            .unwrap()
            .contains(&json!("a1"))
    );
}

#[test]
fn steps_batched_or_separately_match_and_reset_restores_everything_once() {
    let mut first = Engine::default();
    let mut second = Engine::default();
    send(&mut first, &load());
    send(&mut second, &load());
    step(&mut first, 20);
    for _ in 0..20 {
        step(&mut second, 1);
    }
    assert_eq!(snapshot(&mut first), snapshot(&mut second));
    let after = snapshot(&mut first);
    assert_eq!(after["tick"], 20);
    assert_eq!(after["agents"][0]["position"]["x"], 1.5);
    let reset = send(&mut first, &command("reset"));
    assert_eq!(reset[0]["stamp"]["tick"], 0);
    assert_eq!(reset[2]["frame"]["agents"].as_array().unwrap().len(), 2);
    let mut fresh = Engine::default();
    send(&mut fresh, &load());
    assert_eq!(snapshot(&mut first), snapshot(&mut fresh));
}

#[test]
fn stable_ids_isolate_rng_from_input_order_and_seed_does_not_move_geometry() {
    let mut a = Engine::default();
    let mut b = Engine::default();
    send(&mut a, &load());
    let mut reversed = load();
    reversed["compiled"]["scene"]["agents"]
        .as_array_mut()
        .unwrap()
        .reverse();
    send(&mut b, &reversed);
    let one = snapshot(&mut a);
    let two = snapshot(&mut b);
    assert_eq!(one["agents"], two["agents"]);
    assert_eq!(one["random"], two["random"]);
    let mut changed = load();
    changed["compiled"]["scene"]["seed"] = json!(9001);
    send(&mut b, &changed);
    let three = snapshot(&mut b);
    assert_ne!(
        one["agents"][0]["randomState"],
        three["agents"][0]["randomState"]
    );
    assert_eq!(one["map"], three["map"]);
    assert_eq!(one["agents"][0]["position"], three["agents"][0]["position"]);
    step(&mut a, 100);
    assert_eq!(
        snapshot(&mut a)["agents"][0]["randomState"],
        one["agents"][0]["randomState"],
        "Idle ticks consume no random draws"
    );
}

#[test]
fn both_map_encodings_preserve_membership_and_closed_portals() {
    let mut a = Engine::default();
    let mut b = Engine::default();
    send(&mut a, &load());
    send(&mut b, &grid_load());
    assert_eq!(snapshot(&mut a)["map"], snapshot(&mut b)["map"]);
    let mut closed = grid_load();
    closed["compiled"]["scene"]["map"]["portals"][0]["open"] = json!(false);
    send(&mut b, &closed);
    let state = snapshot(&mut b);
    assert_eq!(state["map"]["grid"]["blocked"][19], 1);
    assert_eq!(state["map"]["grid"]["portalIndex"][19], 1);
    let mut masked = grid_load();
    masked["compiled"]["scene"]["map"]["rooms"] = json!([]);
    send(&mut b, &masked);
    assert_eq!(snapshot(&mut b)["agents"][0]["zoneId"], "hall");
}

#[test]
fn initial_walls_overlaps_and_bad_masks_fail_without_replacing_the_world() {
    let mut e = Engine::default();
    send(&mut e, &load());
    step(&mut e, 5);
    let previous = snapshot(&mut e);
    for path in ["/compiled/scene/agents/0/x", "/compiled/scene/agents/1/x"] {
        let mut bad = load();
        *bad.pointer_mut(path).unwrap() = json!(if path.contains("/0/") { 0.9 } else { 1.6 });
        assert_eq!(send(&mut e, &bad)[0]["error"]["code"], "NO_WALKABLE_SPACE");
        assert_eq!(snapshot(&mut e), previous);
    }
    let mut bad = grid_load();
    bad["compiled"]["scene"]["map"]["grid"]["zoneIndex"][9] = json!(99);
    assert_eq!(send(&mut e, &bad)[0]["error"]["code"], "INVALID_SCHEMA");
    assert_eq!(snapshot(&mut e), previous);
    let mut tangent = load();
    for i in 0..2 {
        tangent["compiled"]["scene"]["agents"][i]["x"] = json!(1.2 + 0.4 * i as f64);
        tangent["compiled"]["scene"]["agents"][i]["y"] = json!(1.2);
    }
    assert_eq!(send(&mut e, &tangent)[0]["type"], "ack");
}

#[test]
fn forward_time_rounding_speed_and_resource_errors_are_atomic() {
    let mut e = Engine::default();
    let mut input = load();
    input["compiled"]["scene"]["model"]["dt"] = json!(0.1);
    input["compiled"]["resolvedModel"]["dt"] = json!(0.1);
    send(&mut e, &input);
    let out = run_to(&mut e, 0.1 + 0.2);
    assert_eq!(out[0]["stamp"]["tick"], 3);
    assert_eq!(run_to(&mut e, 0.3)[0]["stamp"]["tick"], 3);
    assert_eq!(run_to(&mut e, 0.3000000000000001)[0]["stamp"]["tick"], 4);
    let state = snapshot(&mut e);
    assert_eq!(run_to(&mut e, 0.1)[0]["error"]["code"], "INVALID_SCHEMA");
    assert_eq!(snapshot(&mut e), state);
    assert_eq!(step(&mut e, 100001)[0]["error"]["code"], "RESOURCE_LIMIT");
    assert_eq!(snapshot(&mut e), state);
    let mut speed = command("speed");
    speed["multiplier"] = json!(4);
    assert_eq!(send(&mut e, &speed)[0]["type"], "ack");
    send(&mut e, &command("resume"));
    send(&mut e, &command("pause"));
    assert_eq!(snapshot(&mut e), state);
    let out = step(&mut e, 10);
    assert_eq!(out[0]["stamp"]["tick"], 14);
    assert_eq!(out[0]["stamp"]["time"], 1.4000000000000001);
}

#[test]
fn calibrated_upload_scale_and_outside_initialization_are_preserved() {
    let mut e = Engine::default();
    let mut input = grid_load();
    input["compiled"]["scene"]["model"]["units"] = json!("m");
    input["compiled"]["resolvedModel"]["units"] = json!("m");
    let map = &mut input["compiled"]["scene"]["map"];
    map["units"] = json!("m");
    map["grid"]["units"] = json!("m");
    map["source"] = json!({"mode":"upload","assetId":"floor-plan","revision":"review-1","page":1,"calibration":null,"sourceToWorld":[0.04,0,0,0.04,0,0]});
    assert_eq!(
        send(&mut e, &input)[0]["error"]["code"],
        "SCALE_CALIBRATION_REQUIRED"
    );
    input["compiled"]["scene"]["map"]["source"]["calibration"] =
        json!({"pointsPx":[[0,0],[250,0]],"distanceMetres":10,"metresPerPixel":0.04});
    input["compiled"]["scene"]["agents"][0]["x"] = json!(4.5);
    assert_eq!(send(&mut e, &input)[0]["type"], "ack");
    let state = snapshot(&mut e);
    assert_eq!(state["map"]["width"], 8.0);
    assert_eq!(state["map"]["grid"]["cellSize"], 1.0);
    assert_eq!(state["map"]["source"]["revision"], "review-1");
    assert_eq!(state["agents"][0]["zoneId"], "outside");
    assert_eq!(state["agents"][0]["state"], "idle");
    assert!(state["agents"][0]["departedAt"].is_null());
    let mut restore = command("restore");
    restore["snapshot"] = state.clone();
    assert_eq!(
        send(&mut e, &restore)[0]["error"]["code"],
        "UNSUPPORTED_CAPABILITY"
    );
    assert_eq!(snapshot(&mut e), state);
    let mut missing = input.clone();
    missing["compiled"]["scene"]["model"]["units"] = json!("model");
    missing["compiled"]["resolvedModel"]["units"] = json!("model");
    missing["compiled"]["scene"]["map"]["units"] = json!("model");
    missing["compiled"]["scene"]["map"]["grid"]["units"] = json!("model");
    missing["compiled"]["scene"]["map"]["source"]
        .as_object_mut()
        .unwrap()
        .remove("calibration");
    assert_eq!(send(&mut e, &missing)[0]["error"]["code"], "INVALID_SCHEMA");
}
