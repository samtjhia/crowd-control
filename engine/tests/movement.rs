use crowd_control_engine::Engine;
use serde_json::{Value, json};

fn input(agents: Vec<Value>) -> Value {
    let mut v: Value = serde_json::from_str(include_str!(
        "../../contract/fixtures/engine-navigation-load.json"
    ))
    .unwrap();
    let (w, h) = (32, 12);
    let n = w * h;
    let mut blocked = vec![0; n];
    let mut zones = vec![1; n];
    for y in 0..h {
        for x in 0..w {
            if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                blocked[y * w + x] = 1;
                zones[y * w + x] = 0;
            } else if x == w - 2 {
                zones[y * w + x] = 2;
            } else if x == 1 {
                zones[y * w + x] = 3;
            } else if y == 1 {
                zones[y * w + x] = 4;
            } else if y == h - 2 {
                zones[y * w + x] = 5;
            }
        }
    }
    v["compiled"]["scene"]["map"] = json!({"width":w,"height":h,"cellSize":1,"units":"model","rooms":[],"portals":[],"grid":{"width":w,"height":h,"cellSize":1,"units":"model","blocked":blocked,"traversalCost":vec![1;n],"zoneIndex":zones,"portalIndex":vec![0;n],"zoneIds":[null,"hall","east","west","north","south"],"portalIds":[null]}});
    v["compiled"]["scene"]["controllers"] = json!({"east":{"kind":"reach","targetZone":"east"},"west":{"kind":"reach","targetZone":"west"},"north":{"kind":"reach","targetZone":"north"},"south":{"kind":"reach","targetZone":"south"}});
    v["compiled"]["scene"]["agents"] = json!(agents);
    v
}
fn agent(id: &str, x: f64, y: f64, goal: &str) -> Value {
    json!({"id":id,"tags":[],"profile":"person","x":x,"y":y,"controller":goal})
}
fn command(kind: &str) -> Value {
    json!({"schemaVersion":1,"simulationId":"engine-demo","commandId":kind,"type":kind})
}
fn send(e: &mut Engine, c: Value) -> Vec<Value> {
    serde_json::from_str(&e.dispatch(&c.to_string())).unwrap()
}
fn load(v: Value) -> Engine {
    let mut e = Engine::default();
    let m = send(&mut e, v);
    assert_eq!(m[0]["type"], "ack", "{m:?}");
    e
}
fn step(e: &mut Engine, n: u64) {
    let mut c = command("step");
    c["ticks"] = json!(n);
    let m = send(e, c);
    assert_eq!(m[0]["type"], "ack", "{m:?}");
}
fn snapshot(e: &mut Engine) -> Value {
    let mut c = command("snapshot");
    c["snapshotId"] = json!("state");
    send(e, c)[0]["snapshot"].clone()
}
fn change(e: &mut Engine, id: &str, ids: Vec<&str>, speed: f64) -> Vec<Value> {
    let mut c = command("apply_request");
    c["request"] = json!({"schemaVersion":1,"simulationId":"engine-demo","requestId":id,"operations":[{"op":"set","targets":{"ids":ids,"kind":"agent"},"values":{"components":{"mobility":{"speedMultiplier":speed}},"appearance":{"pose":if speed==0.0 {"fallen"} else {"upright"}}}}]});
    send(e, c)
}
fn x(a: &Value) -> f64 {
    a["position"]["x"].as_f64().unwrap()
}
fn y(a: &Value) -> f64 {
    a["position"]["y"].as_f64().unwrap()
}

#[test]
fn acceleration_and_mobility_limit_free_motion_without_overwriting_base_speeds() {
    let mut a = agent("a", 3.5, 5.5, "east");
    a["components"] = json!({"mobility":{"speedMultiplier":0.5}});
    let mut e = load(input(vec![a]));
    let mut old = 0.0;
    for _ in 0..30 {
        step(&mut e, 1);
        let s = snapshot(&mut e);
        let a = &s["agents"][0];
        let speed = a["velocity"]["x"].as_f64().unwrap();
        assert!(speed - old <= 0.1 + 1e-9);
        assert!(speed <= 0.5 + 1e-9);
        old = speed;
    }
    assert!((old - 0.5).abs() < 1e-9);
    let s = snapshot(&mut e);
    assert_eq!(
        s["agents"][0]["components"]["navigation"]["preferredSpeed"],
        1.0
    );
    assert_eq!(
        s["agents"][0]["components"]["navigation"]["maximumSpeed"],
        1.5
    );
}

#[test]
fn terrain_halves_steady_speed_and_cost_alone_does_not_slow_motion() {
    let mut v = input(vec![agent("a", 2.5, 5.5, "east")]);
    v["compiled"]["scene"]["profiles"]["person"]["acceleration"] = json!(1000);
    let mut flat = load(v.clone());
    v["compiled"]["scene"]["map"]["grid"]["traversalCost"] = json!(vec![2; 32 * 12]);
    let mut cost = load(v.clone());
    v["compiled"]["scene"]["map"]["grid"]["terrainSpeedMultiplier"] = json!(vec![0.5; 32 * 12]);
    let mut slow = load(v);
    step(&mut flat, 40);
    step(&mut cost, 40);
    step(&mut slow, 40);
    let f = snapshot(&mut flat);
    let c = snapshot(&mut cost);
    let s = snapshot(&mut slow);
    assert_eq!(f["agents"], c["agents"]);
    assert!((x(&f["agents"][0]) - 4.5).abs() < 1e-6);
    assert!((x(&s["agents"][0]) - 3.5).abs() < 1e-6);
    assert_eq!(s["map"]["grid"]["terrainSpeedMultiplier"][100], 0.5);
}

#[test]
fn local_terrain_slowdown_recovers_on_exit_with_fixed_ticks() {
    let mut v = input(vec![agent("a", 2.5, 5.5, "east")]);
    let mut terrain = vec![1.0; 32 * 12];
    for y in 0..12 {
        for x in 4..8 {
            terrain[y * 32 + x] = 0.5;
        }
    }
    v["compiled"]["scene"]["map"]["grid"]["terrainSpeedMultiplier"] = json!(terrain);
    let mut e = load(v);
    let mut saw_slow = false;
    let mut saw_recovery = false;
    for _ in 0..300 {
        step(&mut e, 1);
        let s = snapshot(&mut e);
        let a = &s["agents"][0];
        let speed = a["velocity"]["x"].as_f64().unwrap();
        if x(a) > 5.0 && x(a) < 7.0 {
            assert!((speed - 0.5).abs() < 1e-5);
            saw_slow = true;
        }
        if x(a) > 9.0 {
            assert!((speed - 1.0).abs() < 1e-5);
            saw_recovery = true;
            break;
        }
    }
    assert!(saw_slow && saw_recovery);
    let s = snapshot(&mut e);
    assert_eq!(s["model"]["dt"], 0.05);
}

#[test]
fn crossing_streams_steer_without_overlap_and_complete_their_goals() {
    let mut e = load(
        serde_json::from_str(include_str!(
            "../../contract/fixtures/engine-crossing-load.json"
        ))
        .unwrap(),
    );
    let mut deflected = false;
    for _ in 0..700 {
        step(&mut e, 1);
        let s = snapshot(&mut e);
        let agents = s["agents"].as_array().unwrap();
        for (i, a) in agents.iter().enumerate() {
            assert!(
                x(a) >= 1.2 - 1e-8
                    && x(a) <= 30.8 + 1e-8
                    && y(a) >= 1.2 - 1e-8
                    && y(a) <= 10.8 + 1e-8
            );
            for b in &agents[..i] {
                assert!(
                    (x(a) - x(b)).hypot(y(a) - y(b)) >= 0.4 - 1e-8,
                    "overlap: {agents:?}"
                );
            }
            let lateral = if a["id"] == "e" || a["id"] == "w" {
                (y(a) - 5.5).abs()
            } else {
                (x(a) - 16.5).abs()
            };
            if lateral > 0.1 {
                deflected = true;
            }
        }
        if agents
            .iter()
            .all(|a| a["currentGoal"]["status"] == "completed")
        {
            assert!(deflected);
            return;
        }
    }
    panic!("Goals did not finish: {}", snapshot(&mut e)["agents"]);
}

#[test]
fn immobility_anchors_a_body_suspends_timers_and_explicit_recovery_retains_intent() {
    let mut body = agent("body", 7.5, 5.5, "east");
    body["components"] = json!({"behavior":{"reactionDelay":1}});
    let mut e = load(input(vec![agent("a", 3.5, 5.5, "east"), body]));
    let before = snapshot(&mut e);
    let stopped = change(&mut e, "stop", vec!["body"], 0.0);
    assert_eq!(stopped[0]["type"], "ack");
    step(&mut e, 200);
    let s = snapshot(&mut e);
    let body = &s["agents"][1];
    assert_eq!(body["position"], before["agents"][1]["position"]);
    assert_eq!(body["timers"], before["agents"][1]["timers"]);
    assert_eq!(body["state"], "immobile");
    assert_eq!(body["currentGoal"]["status"], "suspended");
    assert_eq!(body["appearance"]["pose"], "fallen");
    assert!(
        x(&s["agents"][0]) > 8.0,
        "moving agent must route around the body: {}",
        s["agents"]
    );
    let recovered = change(&mut e, "recover", vec!["body"], 1.0);
    assert_eq!(recovered[0]["type"], "ack");
    let recovered = snapshot(&mut e);
    assert_eq!(
        recovered["agents"][1]["currentGoal"]["id"],
        before["agents"][1]["currentGoal"]["id"]
    );
    step(&mut e, 20);
    assert_eq!(snapshot(&mut e)["agents"][1]["position"], body["position"]);
    step(&mut e, 80);
    assert!(x(&snapshot(&mut e)["agents"][1]) > 7.5);
    let final_state = snapshot(&mut e);
    assert_eq!(final_state["topologyVersion"], 2);
    assert_eq!(final_state["historyRevision"], 2.0);
    assert_eq!(
        change(&mut e, "stop", vec!["body"], 0.0)[0]["applied"],
        stopped[0]["applied"]
    );
    assert_eq!(snapshot(&mut e), final_state);
    let before = snapshot(&mut e);
    assert_eq!(
        change(&mut e, "bad", vec!["a", "missing"], 0.0)[0]["error"]["code"],
        "NOT_FOUND"
    );
    assert_eq!(snapshot(&mut e), before);
}

#[test]
fn high_speed_agents_cannot_tunnel_through_an_anchored_body() {
    let mut v = input(vec![
        agent("a", 3.5, 5.5, "east"),
        agent("body", 7.5, 5.5, "east"),
    ]);
    v["compiled"]["scene"]["profiles"]["person"]["preferredSpeed"] = json!(80);
    v["compiled"]["scene"]["profiles"]["person"]["maximumSpeed"] = json!(80);
    v["compiled"]["scene"]["profiles"]["person"]["acceleration"] = json!(100000);
    v["compiled"]["scene"]["agents"][1]["components"] = json!({"mobility":{"speedMultiplier":0}});
    let mut e = load(v);
    for _ in 0..20 {
        step(&mut e, 1);
        let s = snapshot(&mut e);
        let a = &s["agents"][0];
        let b = &s["agents"][1];
        assert!((x(a) - x(b)).hypot(y(a) - y(b)) >= 0.4 - 1e-8);
        assert_eq!(b["position"], json!({"x":7.5,"y":5.5}));
    }
}

#[test]
fn bad_terrain_does_not_replace_the_loaded_world() {
    let v = input(vec![agent("a", 2.5, 5.5, "east")]);
    let mut e = load(v.clone());
    step(&mut e, 10);
    let before = snapshot(&mut e);
    for bad in [0.0, -1.0, 2.0, 1e-100] {
        let mut b = v.clone();
        b["compiled"]["scene"]["map"]["grid"]["terrainSpeedMultiplier"] = json!(vec![bad; 32 * 12]);
        assert_eq!(send(&mut e, b)[0]["error"]["code"], "INVALID_SCHEMA");
        assert_eq!(snapshot(&mut e), before);
    }
}

#[test]
fn crossing_motion_is_independent_of_batching_and_input_order() {
    let mut v: Value = serde_json::from_str(include_str!(
        "../../contract/fixtures/engine-crossing-load.json"
    ))
    .unwrap();
    let mut a = load(v.clone());
    let mut b = load(v.clone());
    v["compiled"]["scene"]["agents"]
        .as_array_mut()
        .unwrap()
        .reverse();
    let mut c = load(v);
    step(&mut a, 160);
    for _ in 0..160 {
        step(&mut b, 1);
    }
    step(&mut c, 160);
    let one = snapshot(&mut a);
    let two = snapshot(&mut b);
    let three = snapshot(&mut c);
    assert_eq!(one, two);
    assert_eq!(one["agents"], three["agents"]);
    assert_eq!(one["random"], three["random"]);
}

#[test]
fn valid_wall_tangent_start_joins_a_nearby_clearance_cell() {
    let mut a = agent("a", 1.6, 1.6, "east");
    a["components"] = json!({"physical":{"radius":0.6}});
    let mut v = input(vec![a]);
    // The destination must also fit this larger body.
    for row in 1..11 {
        v["compiled"]["scene"]["map"]["grid"]["zoneIndex"][row * 32 + 29] = json!(2);
    }
    let mut e = load(v);
    step(&mut e, 200);
    let s = snapshot(&mut e);
    assert!(x(&s["agents"][0]) > 6.0, "{}", s["agents"]);
}
