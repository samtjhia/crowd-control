use crowd_control_engine::Engine;
use serde_json::{Value, json};
fn command(t: &str) -> Value {
    json!({"schemaVersion":1,"simulationId":"engine-demo","commandId":t,"type":t})
}
fn send(e: &mut Engine, v: Value) -> Vec<Value> {
    serde_json::from_str(&e.dispatch(&v.to_string())).unwrap()
}
fn snapshot(e: &mut Engine) -> Value {
    let mut c = command("snapshot");
    c["snapshotId"] = json!("saved");
    send(e, c)[0]["snapshot"].clone()
}
fn load() -> Value {
    let mut v: Value = serde_json::from_str(include_str!(
        "../../contract/fixtures/engine-services-load.json"
    ))
    .unwrap();
    v["compiled"]["scene"]["jobs"] = json!([]);
    v["compiled"]["scene"]["rules"] = json!([]);
    for a in v["compiled"]["scene"]["agents"].as_array_mut().unwrap() {
        a.as_object_mut().unwrap().remove("controller");
    }
    v
}
fn init(v: Value) -> Engine {
    let mut e = Engine::default();
    let out = send(&mut e, v);
    assert_eq!(out[0]["type"], "ack", "{out:?}");
    e
}
fn step(e: &mut Engine, n: u64) -> Vec<Value> {
    let mut c = command("step");
    c["ticks"] = json!(n);
    let out = send(e, c);
    assert_eq!(out[0]["type"], "ack", "{out:?}");
    out
}
fn apply(e: &mut Engine, id: &str, ops: Value) -> Vec<Value> {
    let mut c = command("apply_request");
    c["request"] =
        json!({"schemaVersion":1,"simulationId":"engine-demo","requestId":id,"operations":ops});
    send(e, c)
}
fn ok(e: &mut Engine, id: &str, ops: Value) {
    let out = apply(e, id, ops);
    assert_eq!(out[0]["type"], "ack", "{out:?}");
}
fn spawn(n: usize) -> Value {
    json!({"op":"spawn","template":{"kind":"agent","tags":["attendee","late"],"profile":"person","appearance":{"symbol":"square","fill":"#7C3AED"}},"count":n,"placement":{"inside":{"ids":["hall"]}}})
}
#[test]
fn full_compiler_scenario_runs_arrivals_then_alarm_for_all_ten() {
    let mut v = command("load");
    v["compiled"] =
        serde_json::from_str(include_str!("../../contract/fixtures/compile-output.json")).unwrap();
    v["compiled"]["resolvedModel"]
        .as_object_mut()
        .unwrap()
        .remove("contact");
    v["simulationId"] = v["compiled"]["scene"]["simulationId"].clone();
    v["history"] = json!({"historyRevision":0,"records":[],"outcomes":[]});
    let sim = v["simulationId"].clone();
    let mut e = Engine::default();
    let out = send(&mut e, v);
    assert_eq!(out[0]["type"], "ack", "{out:?}");
    let mut c = command("step");
    c["simulationId"] = sim.clone();
    c["ticks"] = json!(600);
    let out = send(&mut e, c);
    assert_eq!(out[0]["type"], "ack", "{out:?}");
    assert!(out.iter().any(|v| v["type"] == "scene"));
    let mut c = command("snapshot");
    c["simulationId"] = sim;
    c["snapshotId"] = json!("all");
    let s = send(&mut e, c)[0]["snapshot"].clone();
    assert_eq!(s["agents"].as_array().unwrap().len(), 10);
    for a in s["agents"].as_array().unwrap() {
        assert_eq!(a["currentGoal"]["spec"]["kind"], "reach", "{a}");
        assert_eq!(
            a["state"], "departed",
            "alarm reached agent but it never exited: {a}"
        );
    }
    assert!(
        s["events"]
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["name"] != "job_failed" && e["name"] != "rule_failed"),
        "{}",
        s["events"]
    );
    assert!(s["jobs"].as_array().unwrap().is_empty());
    assert_eq!(s["rules"][0]["fired"], true);
    assert_eq!(s["entityOrigins"].as_array().unwrap().len(), 15);
}
#[test]
fn live_selectors_sampling_nested_patches_and_style_preserve_position_rng_and_topology() {
    let mut a = init(load());
    let mut b = init(load());
    let ops = json!([{"op":"set","targets":{"kind":"agent","tags":["attendee"],"inside":{"ids":["hall"]},"where":[{"path":"components.navigation.preferredSpeed","comparison":"gte","value":0}],"sample":{"count":2}},"values":{"components":{"navigation":{"preferredSpeed":0.4}},"appearance":{"fill":"#AABBCC"}}}]);
    ok(&mut a, "sample", ops.clone());
    ok(&mut b, "sample", ops);
    let s = snapshot(&mut a);
    assert_eq!(s, snapshot(&mut b));
    assert_eq!(s["topologyVersion"], 0);
    assert_eq!(
        s["agents"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|a| a["appearance"]["fill"] == "#AABBCC")
            .count(),
        2
    );
    let before = s.clone();
    ok(
        &mut a,
        "style",
        json!([{"op":"set","targets":{"kind":"agent","near":{"targets":{"ids":["a1"]},"distance":100}},"values":{"appearance":{"symbol":"triangle","opacity":0.8}}}]),
    );
    let after = snapshot(&mut a);
    for (a, b) in before["agents"]
        .as_array()
        .unwrap()
        .iter()
        .zip(after["agents"].as_array().unwrap())
    {
        assert_eq!(a["position"], b["position"]);
        assert_eq!(a["randomState"], b["randomState"]);
        assert_eq!(a["currentGoal"], b["currentGoal"]);
    }
    assert_eq!(after["topologyVersion"], before["topologyVersion"]);
}
#[test]
fn failed_batches_rollback_spawn_sampling_allocations_events_and_geometry_and_dedupe() {
    let mut e = init(load());
    let before = snapshot(&mut e);
    let ops = json!([spawn(2),{"op":"emit","event":{"name":"partial"}},{"op":"set","targets":{"kind":"agent","sample":{"fraction":0.5}},"values":{"appearance":{"fill":"#FFFFFF"}}},{"op":"remove","targets":{"ids":["missing"]}}]);
    let first = apply(&mut e, "failed", ops.clone());
    assert_eq!(first[0]["type"], "error");
    assert_eq!(first, apply(&mut e, "failed", ops));
    let after = snapshot(&mut e);
    assert_eq!(after, before);
    ok(&mut e, "spawn", json!([spawn(2)]));
    let once = snapshot(&mut e);
    ok(&mut e, "spawn", json!([spawn(2)]));
    assert_eq!(snapshot(&mut e), once);
    assert_eq!(
        apply(&mut e, "spawn", json!([spawn(1)]))[0]["type"],
        "error"
    );
}
#[test]
fn time_zero_relative_absolute_event_count_rules_cooldowns_and_remove_rule() {
    let mut v = load();
    v["compiled"]["scene"]["jobs"] =
        json!([{"id":"zero","at":0,"operations":[{"op":"emit","event":"begin"}]}]);
    v["compiled"]["scene"]["rules"] = json!([{"op":"define_rule","id":"at-zero","when":{"kind":"event","name":"begin"},"operations":[{"op":"schedule","id":"later","after":0.15,"operations":[{"op":"emit","event":{"name":"later"}}]}]}]);
    let mut e = init(v);
    let s = snapshot(&mut e);
    assert_eq!(s["events"][0]["name"], "begin");
    assert_eq!(s["jobs"][0]["dueTick"], 3);
    assert_eq!(s["jobs"][0]["origin"]["parentRuleId"], "at-zero");
    ok(
        &mut e,
        "rules",
        json!([{"op":"define_rule","id":"clock","when":{"kind":"time","comparison":"gte","value":0.1},"once":false,"cooldown":0.1,"operations":[{"op":"emit","event":{"name":"pulse"}}]},{"op":"define_rule","id":"count","when":{"kind":"count","targets":{"tags":["late"]},"comparison":"eq","value":1},"operations":[{"op":"emit","event":{"name":"one-arrival"}}]},{"op":"schedule","id":"arrival","at":0.2,"operations":[spawn(1)]}]),
    );
    step(&mut e, 6);
    let s = snapshot(&mut e);
    let names: Vec<_> = s["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v["name"].as_str().unwrap())
        .collect();
    assert_eq!(names.iter().filter(|n| **n == "pulse").count(), 3);
    assert!(names.contains(&"one-arrival") && names.contains(&"later"));
    ok(
        &mut e,
        "remove-rule",
        json!([{"op":"remove_rule","id":"clock"}]),
    );
    step(&mut e, 10);
    assert_eq!(snapshot(&mut e)["events"], s["events"]);
}
#[test]
fn due_spawn_uses_current_occupancy_and_failure_is_logged_without_partial_mutation() {
    let mut e = init(load());
    ok(
        &mut e,
        "delayed",
        json!([{"op":"schedule","id":"impossible","after":0.1,"operations":[{"op":"emit","event":{"name":"partial"}},spawn(2000)]}]),
    );
    let before = snapshot(&mut e);
    step(&mut e, 2);
    let after = snapshot(&mut e);
    assert_eq!(after["agents"], before["agents"]);
    assert_eq!(
        after["allocations"]["nextEntity"],
        before["allocations"]["nextEntity"]
    );
    assert_eq!(after["random"], before["random"]);
    assert_eq!(after["events"][0]["name"], "job_failed");
    assert_eq!(after["events"][0]["origin"]["parentJobId"], "impossible");
    assert!(after["jobs"].as_array().unwrap().is_empty());
}
#[test]
fn add_remove_shapes_restore_underlay_and_reject_occupied_or_invalid_geometry() {
    let mut e = init(load());
    let before = snapshot(&mut e);
    let entity = json!({"id":"rail","kind":"barrier","shape":{"kind":"rectangle","x":2,"y":1,"width":1,"height":1},"appearance":{"fill":"#334455"}});
    ok(&mut e, "rail", json!([{"op":"add","entity":entity}]));
    let added = snapshot(&mut e);
    assert_eq!(added["map"]["grid"]["blocked"][14], 1);
    assert_eq!(
        added["entityOrigins"].as_array().unwrap().last().unwrap()["origin"]["interventionId"],
        "intervention-1"
    );
    ok(
        &mut e,
        "remove",
        json!([{"op":"remove","targets":{"ids":["rail"]}}]),
    );
    assert_eq!(
        snapshot(&mut e)["map"]["grid"]["blocked"],
        before["map"]["grid"]["blocked"]
    );
    let before = snapshot(&mut e);
    let out = apply(
        &mut e,
        "occupied",
        json!([{"op":"add","entity":{"id":"on-agent","kind":"barrier","shape":{"kind":"circle","center":{"x":4.5,"y":3.5},"radius":0.4}}}]),
    );
    assert_eq!(out[0]["type"], "error");
    assert_eq!(snapshot(&mut e), before);
    assert_eq!(
        apply(
            &mut e,
            "dotted",
            json!([{"op":"set","targets":{"ids":["a1"]},"values":{"appearance.fill":"#FFFFFF"}}])
        )[0]["type"],
        "error"
    );
}
#[test]
fn future_intervention_rejects_past_edits_and_unavailable_conditions() {
    let mut e = init(load());
    let mut c = command("apply_request");
    c["request"] = json!({"schemaVersion":1,"simulationId":"engine-demo","requestId":"future","at":0.1,"operations":[{"op":"set","targets":{"ids":["a1"]},"values":{"appearance":{"fill":"#FFFFFF"}}}]});
    assert_eq!(send(&mut e, c)[0]["type"], "ack");
    assert_ne!(
        snapshot(&mut e)["agents"][0]["appearance"]["fill"],
        "#FFFFFF"
    );
    step(&mut e, 2);
    assert_eq!(
        snapshot(&mut e)["agents"][0]["appearance"]["fill"],
        "#FFFFFF"
    );
    assert_eq!(
        apply(
            &mut e,
            "past",
            json!([{"op":"schedule","id":"past","at":0,"operations":[spawn(1)]}])
        )[0]["error"]["code"],
        "INVALID_SCHEMA"
    );
    for (index,condition) in [
        json!({"kind":"entity_metric","targets":{"kind":"agent"},"metric":"contactLoadRatio","comparison":"gt","value":1,"for":1}),
    ].into_iter().enumerate() {
        assert_eq!(
            apply(
                &mut e,
                &format!("sensor-{index}"),
                json!([{"op":"define_rule","id":"unsupported","when":condition,"operations":[{"op":"emit","event":{"name":"fall"}}]}])
            )[0]["error"]["code"],
            "UNSUPPORTED_CAPABILITY"
        );
    }
}
#[test]
fn placement_constraints_and_removed_destinations_are_resolved_at_execution() {
    let mut e = init(load());
    ok(
        &mut e,
        "near",
        json!([{"op":"spawn","template":{"kind":"agent","tags":["new"]},"count":1,"placement":{"near":{"ids":["hazard"]},"distance":2,"edge":"north","awayFrom":[{"ids":["desk"]}]}}]),
    );
    let s = snapshot(&mut e);
    let p = &s["agents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["tags"] == json!(["new"]))
        .unwrap()["position"];
    assert!(p["x"].as_f64().unwrap().is_finite());
    ok(
        &mut e,
        "target",
        json!([{"op":"assign_goal","targets":{"ids":["a3"]},"goal":{"kind":"reach","target":{"ids":["hazard"]}}}]),
    );
    ok(
        &mut e,
        "remove-target",
        json!([{"op":"remove","targets":{"ids":["hazard"]}}]),
    );
    assert_eq!(
        snapshot(&mut e)["agents"]
            .as_array()
            .unwrap()
            .iter()
            .find(|a| a["id"] == "a3")
            .unwrap()["currentGoal"]["failure"]["code"],
        "NOT_FOUND"
    );
}
#[test]
fn zero_delay_cascades_are_bounded_and_failed_interventions_roll_back() {
    let mut e = init(load());
    let before = snapshot(&mut e);
    // New unique rule IDs defeat per-rule cooldown, so the dispatch budget must stop the chain.
    let mut child = json!({"op":"emit","event":{"name":"bottom"}});
    for n in (0..8).rev() {
        child = json!({"op":"schedule","id":format!("job-{n}"),"after":0,"operations":[child]});
    }
    // Eight nested schedules are supported, including their time-zero execution.
    ok(&mut e, "nested", json!([child]));
    assert!(snapshot(&mut e)["jobs"].as_array().unwrap().is_empty());
    let mut ops = vec![];
    for n in 0..100 {
        ops.push(json!({"op":"schedule","id":format!("cascade-{n}"),"after":0,"operations":[{"op":"schedule","id":format!("child-{n}"),"after":0,"operations":[{"op":"emit","event":{"name":"cascade"}}]}]}));
    }
    let after_nested = snapshot(&mut e);
    assert_eq!(
        apply(&mut e, "too-many", json!(ops))[0]["error"]["code"],
        "RESOURCE_LIMIT"
    );
    assert_eq!(snapshot(&mut e), after_nested);
    assert_ne!(snapshot(&mut e)["events"], before["events"]);
}
#[test]
fn scheduled_placement_checks_bodies_that_arrived_after_registration() {
    let mut e = init(load());
    let one = json!({"op":"spawn","count":1,"template":{"kind":"agent"},"placement":{"inside":{"ids":["outside"]}}});
    ok(
        &mut e,
        "schedule",
        json!([{"op":"schedule","id":"later-occupancy","after":0.1,"operations":[one]}]),
    );
    ok(
        &mut e,
        "fill-space",
        json!([{"op":"spawn","count":6,"template":{"kind":"agent"},"placement":{"inside":{"ids":["outside"]}}}]),
    );
    step(&mut e, 2);
    let s = snapshot(&mut e);
    assert_eq!(s["agents"].as_array().unwrap().len(), 9);
    assert_eq!(
        s["events"].as_array().unwrap().last().unwrap()["data"]["code"],
        "NO_WALKABLE_SPACE"
    );
}
#[test]
fn static_styles_and_geometry_removal_keep_source_walls_and_other_objects() {
    let mut e = init(load());
    let before = snapshot(&mut e);
    ok(
        &mut e,
        "source-wall",
        json!([{"op":"add","entity":{"id":"wall-overlay","kind":"barrier","shape":{"kind":"rectangle","x":0,"y":1,"width":1,"height":1}}},{"op":"set","targets":{"ids":["hall"]},"values":{"appearance":{"fill":"#ABCDEF"}}}]),
    );
    ok(
        &mut e,
        "remove-overlay",
        json!([{"op":"remove","targets":{"ids":["wall-overlay"]}}]),
    );
    let after = snapshot(&mut e);
    assert_eq!(
        after["map"]["grid"]["blocked"],
        before["map"]["grid"]["blocked"]
    );
    assert_eq!(after["map"]["rooms"][0]["appearance"]["fill"], "#ABCDEF");
    ok(
        &mut e,
        "remove-desk",
        json!([{"op":"remove","targets":{"ids":["desk"]}}]),
    );
    let s = snapshot(&mut e);
    assert_eq!(s["map"]["grid"]["blocked"][42], 0);
    assert!(
        s["queues"]
            .as_array()
            .unwrap()
            .iter()
            .all(|q| q["targetId"] != "desk")
    );
}
#[test]
fn new_event_rules_do_not_consume_historical_events() {
    let mut e = init(load());
    ok(
        &mut e,
        "past-event",
        json!([{"op":"emit","event":{"name":"old"}}]),
    );
    step(&mut e, 2);
    ok(
        &mut e,
        "new-rule",
        json!([{"op":"define_rule","id":"new","when":{"kind":"event","name":"old"},"operations":[{"op":"emit","event":{"name":"should-not-fire"}}]}]),
    );
    assert_eq!(snapshot(&mut e)["events"].as_array().unwrap().len(), 1);
}
#[test]
fn near_placement_within_an_area_stays_on_that_side_of_the_door() {
    let mut e = init(load());
    ok(
        &mut e,
        "arrivals",
        json!([{"op":"spawn","template":{"kind":"agent","tags":["arrival"]},"count":3,"placement":{"near":{"ids":["door"]},"within":{"ids":["outside"]},"distance":3}}]),
    );
    let s = snapshot(&mut e);
    let arrivals: Vec<&Value> = s["agents"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|a| a["tags"] == json!(["arrival"]))
        .collect();
    assert_eq!(arrivals.len(), 3);
    for a in arrivals {
        let x = a["position"]["x"].as_f64().unwrap();
        assert!((10.0..=11.0).contains(&x), "arrival placed in the hall at x={x}");
    }
    let out = apply(
        &mut e,
        "within-alone",
        json!([{"op":"spawn","template":{"kind":"agent"},"count":1,"placement":{"inside":{"ids":["hall"]},"within":{"ids":["outside"]}}}]),
    );
    assert_eq!(out[0]["type"], "error", "{out:?}");
}
