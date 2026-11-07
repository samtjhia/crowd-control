use crowd_control_engine::Engine;
use serde_json::{Value, json};

fn load() -> Value {
    serde_json::from_str(include_str!(
        "../../contract/fixtures/engine-navigation-load.json"
    ))
    .unwrap()
}
fn send(e: &mut Engine, v: Value) -> Vec<Value> {
    serde_json::from_str(&e.dispatch(&v.to_string())).unwrap()
}
fn command(kind: &str) -> Value {
    json!({"schemaVersion":1,"simulationId":"engine-demo","commandId":kind,"type":kind})
}
fn step(e: &mut Engine, ticks: u64) -> Vec<Value> {
    let mut c = command("step");
    c["ticks"] = json!(ticks);
    send(e, c)
}
fn snapshot(e: &mut Engine) -> Value {
    let mut c = command("snapshot");
    c["snapshotId"] = json!("state");
    send(e, c)[0]["snapshot"].clone()
}
fn door(e: &mut Engine, id: &str, open: bool) -> Vec<Value> {
    let mut c = command("apply_request");
    c["request"] = json!({"schemaVersion":1,"simulationId":"engine-demo","requestId":id,"action":"create_intervention","operations":[{"op":"set","targets":{"ids":["door"]},"values":{"components":{"portal":{"open":open}}}}]});
    send(e, c)
}
fn init(input: Value) -> Engine {
    let mut e = Engine::default();
    let out = send(&mut e, input);
    assert_eq!(out[0]["type"], "ack", "{out:?}");
    e
}

#[test]
fn navigates_around_wall_without_cutting_corners_or_inventing_departures() {
    let mut e = init(load());
    let goal = snapshot(&mut e)["agents"][0]["currentGoal"]["id"].clone();
    for _ in 0..100 {
        step(&mut e, 1);
        let s = snapshot(&mut e);
        let a = &s["agents"][0];
        let x = a["position"]["x"].as_f64().unwrap();
        let y = a["position"]["y"].as_f64().unwrap();
        assert!((1.2..=6.8).contains(&x) && (1.2..=2.8).contains(&y));
        if x > 2.8 && x < 4.2 {
            assert!(y >= 2.2, "corner cut: {x},{y}");
        }
        assert_eq!(a["currentGoal"]["id"], goal);
    }
    let s = snapshot(&mut e);
    let a = &s["agents"][0];
    assert_eq!(a["currentGoal"]["status"], "completed");
    assert!((a["position"]["x"].as_f64().unwrap() - 4.5).abs() < 1e-9);
    assert_eq!(a["position"]["y"], 2.5);
    assert_eq!(a["zoneId"], "outside");
    assert!(a["departedAt"].is_null());
    assert_eq!(a["velocity"], json!({"x":0.0,"y":0.0}));
}

#[test]
fn portal_changes_retain_intent_publish_versions_and_resume_without_teleporting() {
    let mut e = init(load());
    step(&mut e, 10);
    let before = snapshot(&mut e);
    let close = door(&mut e, "close", false);
    assert_eq!(
        close
            .iter()
            .map(|v| v["type"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["ack", "scene", "frame"]
    );
    assert_eq!(close[0]["stamp"]["topologyVersion"], 1);
    assert_eq!(close[0]["stamp"]["sceneVersion"], 2);
    assert_eq!(close[0]["stamp"]["historyRevision"], 1.0);
    let closed = snapshot(&mut e);
    assert_eq!(
        closed["agents"][0]["position"],
        before["agents"][0]["position"]
    );
    assert_eq!(
        closed["agents"][0]["currentGoal"],
        before["agents"][0]["currentGoal"]
    );
    assert_eq!(closed["agents"][0]["state"], "blocked");
    step(&mut e, 30);
    assert_eq!(
        snapshot(&mut e)["agents"][0]["position"],
        before["agents"][0]["position"]
    );
    door(&mut e, "open", true);
    step(&mut e, 100);
    let done = snapshot(&mut e);
    assert_eq!(done["agents"][0]["currentGoal"]["status"], "completed");
    assert_eq!(done["topologyVersion"], 2);
    assert_eq!(done["historyRevision"], 2.0);
    assert_eq!(done["agents"][0]["navigation"]["mapVersion"], 2.0);
    let retry = door(&mut e, "close", false);
    assert_eq!(retry[0]["applied"], close[0]["applied"]);
    assert_eq!(
        snapshot(&mut e),
        done,
        "retry must not close the portal again"
    );
    assert_eq!(
        door(&mut e, "close", true)[0]["error"]["code"],
        "INVALID_SCHEMA"
    );
    let mut q = command("query");
    q["query"] = json!({"kind":"history"});
    let history = send(&mut e, q);
    assert_eq!(
        history[0]["result"]["history"]["records"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
}

#[test]
fn occupied_closures_and_failed_batches_are_atomic_and_memoized() {
    let mut e = init(load());
    step(&mut e, 60);
    let before = snapshot(&mut e);
    assert!((before["agents"][0]["position"]["x"].as_f64().unwrap() - 3.5).abs() < 1e-9);
    let failed = door(&mut e, "occupied", false);
    assert_eq!(failed[0]["error"]["code"], "NO_WALKABLE_SPACE");
    assert_eq!(snapshot(&mut e), before);
    step(&mut e, 30);
    assert_eq!(
        door(&mut e, "occupied", false)[0]["error"],
        failed[0]["error"]
    );
    let mut c = command("apply_request");
    c["request"] = json!({"schemaVersion":1,"simulationId":"engine-demo","requestId":"batch","operations":[{"op":"set","targets":{"ids":["door"]},"values":{"components":{"portal":{"open":false}}}},{"op":"set","targets":{"ids":["missing"]},"values":{"components":{"portal":{"open":false}}}}]});
    let before = snapshot(&mut e);
    assert_eq!(send(&mut e, c)[0]["error"]["code"], "NOT_FOUND");
    assert_eq!(snapshot(&mut e), before);
}

#[test]
fn closed_and_one_way_portals_enforce_direction_and_can_be_reopened() {
    let mut input = load();
    input["compiled"]["scene"]["map"]["portals"][0]["open"] = json!(false);
    let mut e = init(input);
    step(&mut e, 50);
    assert_eq!(snapshot(&mut e)["agents"][0]["state"], "blocked");
    door(&mut e, "open", true);
    step(&mut e, 100);
    assert_eq!(
        snapshot(&mut e)["agents"][0]["currentGoal"]["status"],
        "completed"
    );
    let mut input = load();
    input["compiled"]["scene"]["map"]["portals"][0]["oneWay"] = json!(true);
    let mut forward = init(input.clone());
    step(&mut forward, 100);
    assert_eq!(
        snapshot(&mut forward)["agents"][0]["currentGoal"]["status"],
        "completed"
    );
    input["compiled"]["scene"]["agents"][0]["x"] = json!(4.5);
    input["compiled"]["scene"]["controllers"]["leave"]["targetZone"] = json!("hall");
    let mut reverse = init(input);
    step(&mut reverse, 100);
    assert_eq!(snapshot(&mut reverse)["agents"][0]["state"], "blocked");
}

#[test]
fn reaction_and_traversal_delays_are_tick_bounded_and_serializable() {
    let mut input = load();
    input["compiled"]["resolvedModel"]["defaultAgent"]["behavior"]["reactionDelay"] = json!(0.2);
    input["compiled"]["scene"]["map"]["portals"][0]["traversalTime"] = json!(0.2);
    let mut e = init(input);
    step(&mut e, 4);
    let state = snapshot(&mut e);
    assert_eq!(state["agents"][0]["position"], json!({"x":1.5,"y":1.5}));
    assert_eq!(state["agents"][0]["timers"]["reactionRemaining"], 0.0);
    step(&mut e, 1);
    assert_ne!(
        snapshot(&mut e)["agents"][0]["position"],
        state["agents"][0]["position"]
    );
    while snapshot(&mut e)["agents"][0]["state"] != "waiting" {
        step(&mut e, 1);
    }
    let waiting = snapshot(&mut e);
    step(&mut e, 4);
    assert_eq!(
        snapshot(&mut e)["agents"][0]["position"],
        waiting["agents"][0]["position"]
    );
    assert_eq!(
        snapshot(&mut e)["agents"][0]["timers"]["waitRemaining"],
        0.0
    );
    step(&mut e, 1);
    assert_ne!(
        snapshot(&mut e)["agents"][0]["position"],
        waiting["agents"][0]["position"]
    );
}

#[test]
fn deterministic_batches_and_input_order_preserve_goal_and_rng_state() {
    let mut a = init(load());
    let mut b = init(load());
    step(&mut a, 17);
    for _ in 0..17 {
        step(&mut b, 1);
    }
    assert_eq!(snapshot(&mut a), snapshot(&mut b));
    let mut input = load();
    let mut second = input["compiled"]["scene"]["agents"][0].clone();
    second["id"] = json!("a2");
    second["x"] = json!(2.5);
    input["compiled"]["scene"]["agents"]
        .as_array_mut()
        .unwrap()
        .push(second);
    input["compiled"]["scene"]["controllers"]["leave"] =
        json!({"kind":"reach","targetIds":["hall","outside"],"selection":"random"});
    let mut a = init(input.clone());
    input["compiled"]["scene"]["agents"]
        .as_array_mut()
        .unwrap()
        .reverse();
    let mut b = init(input);
    assert_eq!(snapshot(&mut a)["agents"], snapshot(&mut b)["agents"]);
}

fn masked(rows: &[&str]) -> Value {
    let mut input = load();
    let w = rows[0].len();
    let h = rows.len();
    let chars: Vec<_> = rows.iter().flat_map(|s| s.chars()).collect();
    input["compiled"]["scene"]["map"] = json!({"width":w,"height":h,"cellSize":1,"units":"model","rooms":[],"portals":[],"grid":{"width":w,"height":h,"cellSize":1,"units":"model","blocked":chars.iter().map(|c|u8::from(*c=='#')).collect::<Vec<_>>(),"traversalCost":vec![1;w*h],"zoneIndex":chars.iter().map(|c|match c {'H'=>1,'O'=>2,_=>0}).collect::<Vec<_>>(),"portalIndex":vec![0;w*h],"zoneIds":[null,"hall","outside"],"portalIds":[null]}});
    input
}

#[test]
fn weighted_fields_choose_a_cheaper_detour_and_masks_prevent_diagonal_cutting() {
    let mut input = masked(&["########", "#HHHHHO#", "#HHHHHH#", "#HHHHHH#", "########"]);
    let mut direct = init(input.clone());
    step(&mut direct, 1);
    assert_eq!(snapshot(&mut direct)["agents"][0]["position"]["y"], 1.5);
    for x in 2..6 {
        input["compiled"]["scene"]["map"]["grid"]["traversalCost"][8 + x] = json!(20);
    }
    let mut detour = init(input);
    step(&mut detour, 1);
    assert!(
        snapshot(&mut detour)["agents"][0]["position"]["y"]
            .as_f64()
            .unwrap()
            > 1.5
    );
    step(&mut detour, 180);
    assert_eq!(
        snapshot(&mut detour)["agents"][0]["currentGoal"]["status"],
        "completed"
    );
    let mut diagonal = init(masked(&["#####", "#H###", "##O##", "#####"]));
    step(&mut diagonal, 100);
    assert_eq!(snapshot(&mut diagonal)["agents"][0]["state"], "blocked");
}

#[test]
fn body_radius_and_anchored_bodies_can_make_routes_unreachable() {
    let mut input = load();
    input["compiled"]["scene"]["map"]["width"] = json!(9);
    input["compiled"]["scene"]["map"]["height"] = json!(7);
    input["compiled"]["scene"]["map"]["rows"] = json!([
        "#########",
        "#HHH#OOO#",
        "#HHH#OOO#",
        "#HHHDOOO#",
        "#HHH#OOO#",
        "#HHH#OOO#",
        "#########"
    ]);
    input["compiled"]["scene"]["map"]["rooms"] = json!([{"id":"hall","x":1,"y":1,"width":3,"height":5},{"id":"outside","x":5,"y":1,"width":3,"height":5}]);
    input["compiled"]["scene"]["map"]["portals"][0]["x"] = json!(4);
    input["compiled"]["scene"]["map"]["portals"][0]["y"] = json!(3);
    input["compiled"]["scene"]["agents"][0]["x"] = json!(2.5);
    input["compiled"]["scene"]["agents"][0]["y"] = json!(2.5);
    input["compiled"]["scene"]["profiles"]["person"]["radius"] = json!(0.6);
    let mut wide = init(input);
    step(&mut wide, 100);
    assert_eq!(snapshot(&mut wide)["agents"][0]["state"], "blocked");
    let mut input = masked(&["########", "#HHHHHO#", "########"]);
    let mut body = input["compiled"]["scene"]["agents"][0].clone();
    body["id"] = json!("anchored");
    body["x"] = json!(3.5);
    body.as_object_mut().unwrap().remove("controller");
    body["components"] = json!({"mobility":{"speedMultiplier":0},"physical":{"radius":0.4}});
    input["compiled"]["scene"]["agents"]
        .as_array_mut()
        .unwrap()
        .push(body);
    let mut anchored = init(input);
    step(&mut anchored, 100);
    let s = snapshot(&mut anchored);
    assert_eq!(s["agents"][0]["state"], "blocked");
    assert_eq!(s["agents"][1]["position"], json!({"x":3.5,"y":1.5}));
}

#[test]
fn stop_distance_speed_limits_off_center_alignment_and_resource_rejection() {
    let mut input = load();
    input["compiled"]["scene"]["agents"][0]["x"] = json!(1.3);
    input["compiled"]["scene"]["controllers"]["leave"]["stopDistance"] = json!(1);
    input["compiled"]["scene"]["controllers"]["leave"]["urgency"] = json!(100);
    let mut e = init(input);
    let before = snapshot(&mut e);
    step(&mut e, 1);
    let after = snapshot(&mut e);
    let dx = after["agents"][0]["position"]["x"].as_f64().unwrap()
        - before["agents"][0]["position"]["x"].as_f64().unwrap();
    let dy = after["agents"][0]["position"]["y"].as_f64().unwrap()
        - before["agents"][0]["position"]["y"].as_f64().unwrap();
    assert!((dx.hypot(dy) - 0.075).abs() < 1e-9);
    step(&mut e, 100);
    let s = snapshot(&mut e);
    assert_eq!(s["agents"][0]["currentGoal"]["status"], "completed");
    assert!((s["agents"][0]["position"]["x"].as_f64().unwrap() - 3.5).abs() < 1e-9);
    let mut bad = load();
    bad["compiled"]["scene"]["profiles"]["person"]["preferredSpeed"] = json!(10000);
    bad["compiled"]["scene"]["profiles"]["person"]["maximumSpeed"] = json!(10000);
    assert_eq!(send(&mut e, bad)[0]["error"]["code"], "RESOURCE_LIMIT");
    assert_eq!(snapshot(&mut e), s);
}

#[test]
fn closing_one_of_two_doors_reroutes_mid_edge_toward_the_same_destination() {
    let mut input = load();
    input["compiled"]["scene"]["map"] = json!({"width":7,"height":7,"cellSize":1,"units":"model","rooms":[{"id":"hall","x":1,"y":1,"width":2,"height":5},{"id":"outside","x":4,"y":1,"width":2,"height":5}],"portals":[{"id":"door","connects":["hall","outside"],"x":3,"y":2,"width":1,"height":1,"open":true},{"id":"other","connects":["hall","outside"],"x":3,"y":4,"width":1,"height":1,"open":true}],"rows":["#######","#HH#OO#","#HHDOO#","#HH#OO#","#HHEOO#","#HH#OO#","#######"],"legend":{"H":"hall","O":"outside","D":"door","E":"other"}});
    input["compiled"]["scene"]["agents"][0]["x"] = json!(2.5);
    input["compiled"]["scene"]["agents"][0]["y"] = json!(3.5);
    let mut e = init(input);
    step(&mut e, 5);
    let before = snapshot(&mut e);
    assert!(before["agents"][0]["position"]["y"].as_f64().unwrap() < 3.5);
    let out = door(&mut e, "reroute", false);
    assert_eq!(out[0]["type"], "ack");
    assert_eq!(
        snapshot(&mut e)["agents"][0]["position"],
        before["agents"][0]["position"]
    );
    let mut used_other = false;
    for _ in 0..100 {
        step(&mut e, 1);
        let s = snapshot(&mut e);
        let a = &s["agents"][0];
        let x = a["position"]["x"].as_f64().unwrap();
        let y = a["position"]["y"].as_f64().unwrap();
        if x > 2.8 && x < 4.2 {
            assert!(y >= 4.2);
            used_other = true;
        }
        assert_eq!(a["navigation"]["targetEntityId"], "outside");
    }
    assert!(used_other);
    assert_eq!(
        snapshot(&mut e)["agents"][0]["currentGoal"]["status"],
        "completed"
    );
}

#[test]
fn fast_motion_visits_each_waypoint_and_future_or_unknown_goal_work_is_rejected() {
    let mut input = load();
    input["compiled"]["scene"]["profiles"]["person"]["preferredSpeed"] = json!(80);
    input["compiled"]["scene"]["profiles"]["person"]["maximumSpeed"] = json!(80);
    let mut e = init(input);
    step(&mut e, 1);
    let before = snapshot(&mut e);
    assert_eq!(before["agents"][0]["currentGoal"]["status"], "completed");
    assert_eq!(before["agents"][0]["position"], json!({"x":4.5,"y":2.5}));
    let mut unsupported = load();
    unsupported["compiled"]["scene"]["controllers"]["leave"] =
        json!({"kind":"wander","insideZone":"hall"});
    assert_eq!(
        send(&mut e, unsupported)[0]["error"]["code"],
        "UNSUPPORTED_CAPABILITY"
    );
    assert_eq!(snapshot(&mut e), before);
    let mut c = command("apply_request");
    c["request"] = json!({"schemaVersion":1,"simulationId":"engine-demo","requestId":"future","at":10,"operations":[{"op":"set","targets":{"ids":["door"]},"values":{"components":{"portal":{"open":false}}}}]});
    assert_eq!(
        send(&mut e, c)[0]["error"]["code"],
        "UNSUPPORTED_CAPABILITY"
    );
    assert_eq!(snapshot(&mut e), before);
}

#[test]
fn recorded_request_memory_is_bounded_without_mutating_the_world() {
    let mut e = init(load());
    let before = snapshot(&mut e);
    let mut c = command("apply_request");
    c["request"] = json!({"schemaVersion":1,"simulationId":"engine-demo","requestId":"too-large","label":"x".repeat(2*1024*1024),"operations":[{"op":"set","targets":{"ids":["door"]},"values":{"components":{"portal":{"open":false}}}}]});
    assert_eq!(send(&mut e, c)[0]["error"]["code"], "RESOURCE_LIMIT");
    assert_eq!(snapshot(&mut e), before);
}
