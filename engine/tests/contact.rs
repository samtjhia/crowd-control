use crowd_control_engine::Engine;
use serde_json::{Value, json};
fn h(t: &str) -> Value {
    json!({"schemaVersion":1,"simulationId":"engine-demo","commandId":t,"type":t})
}
fn send(e: &mut Engine, c: Value) -> Vec<Value> {
    serde_json::from_str(&e.dispatch(&c.to_string())).unwrap()
}
fn fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../contract/fixtures/engine-contact-load.json"
    ))
    .unwrap()
}
fn init(v: Value) -> Engine {
    let mut e = Engine::default();
    let out = send(&mut e, v);
    assert_eq!(out[0]["type"], "ack", "{out:?}");
    e
}
fn step(e: &mut Engine, n: u64) {
    let mut c = h("step");
    c["ticks"] = json!(n);
    let out = send(e, c);
    assert_eq!(out[0]["type"], "ack", "{out:?}");
}
fn state(e: &mut Engine) -> Value {
    let mut c = h("snapshot");
    c["snapshotId"] = json!("state");
    send(e, c)[0]["snapshot"].clone()
}
fn apply(e: &mut Engine, id: &str, ops: Value) -> Vec<Value> {
    let mut c = h("apply_request");
    c["request"] =
        json!({"schemaVersion":1,"simulationId":"engine-demo","requestId":id,"operations":ops});
    send(e, c)
}
#[test]
fn opposing_impulses_add_and_sustained_own_contact_queues_only_the_subject_next_tick() {
    let mut e = init(fixture());
    assert!(state(&mut e)["agents"][0]["sensors"].is_null());
    step(&mut e, 1);
    let s = state(&mut e);
    let loads: Vec<_> = s["agents"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["sensors"]["contactLoad"].as_f64().unwrap())
        .collect();
    assert!((loads[0] - 2.0).abs() < 1e-8, "{loads:?}");
    assert!((loads[1] - 4.0).abs() < 1e-8, "{loads:?}");
    assert!((loads[2] - 2.0).abs() < 1e-8, "{loads:?}");
    assert!(s["jobs"].as_array().unwrap().is_empty());
    step(&mut e, 1);
    let s = state(&mut e);
    assert_eq!(s["rules"][0]["subjects"]["a2"]["heldTicks"], 2);
    assert_eq!(s["jobs"][0]["dueTick"], 3);
    assert_eq!(s["jobs"][0]["subjectId"], "a2");
    assert_ne!(s["agents"][1]["state"], "immobile");
    step(&mut e, 1);
    let s = state(&mut e);
    assert_eq!(s["agents"][1]["state"], "immobile");
    assert_eq!(s["agents"][1]["appearance"]["pose"], "fallen");
    assert_ne!(s["agents"][0]["state"], "immobile");
    assert_ne!(s["agents"][2]["state"], "immobile");
    assert_eq!(s["agents"][1]["currentGoal"]["status"], "suspended");
    assert_eq!(
        apply(
            &mut e,
            "recover",
            json!([{"op":"set","targets":{"ids":["a2"]},"values":{"components":{"mobility":{"speedMultiplier":1}},"appearance":{"pose":"upright"}}}])
        )[0]["type"],
        "ack"
    );
    step(&mut e, 5);
    let s = state(&mut e);
    assert_ne!(s["agents"][1]["state"], "immobile");
    assert_eq!(s["rules"][0]["subjects"]["a2"]["fired"], true);
}
#[test]
fn a_short_spike_resets_dwell_and_no_contact_is_measured_zero() {
    let mut e = init(fixture());
    step(&mut e, 1);
    assert_eq!(
        apply(
            &mut e,
            "stop-pushing",
            json!([{"op":"clear_goal","targets":{"tags":["push"]}}])
        )[0]["type"],
        "ack"
    );
    step(&mut e, 5);
    let s = state(&mut e);
    assert_eq!(s["rules"][0]["subjects"]["a2"]["heldTicks"], 0);
    assert!(
        s["agents"]
            .as_array()
            .unwrap()
            .iter()
            .all(|a| a["sensors"]["contactLoad"].as_f64().unwrap() < 1e-8
                && a["state"] != "immobile")
    );
}
#[test]
fn scheduled_descendants_capture_ids_and_run_explicit_recovery_while_immobile() {
    let mut v = fixture();
    v["compiled"]["scene"]["rules"][0]["operations"].as_array_mut().unwrap().push(json!({"op":"schedule","id":"recover-subject","after":0.1,"operations":[{"op":"set","targets":{"binding":"subject"},"values":{"components":{"mobility":{"speedMultiplier":1}},"appearance":{"pose":"upright"}}}]}));
    let mut e = init(v);
    step(&mut e, 3);
    let s = state(&mut e);
    assert_eq!(s["agents"][1]["state"], "immobile");
    assert_eq!(
        s["jobs"][0]["operations"][0]["targets"]["ids"],
        json!(["a2"])
    );
    step(&mut e, 2);
    assert_ne!(state(&mut e)["agents"][1]["state"], "immobile");
}
#[test]
fn invalid_models_unbound_subjects_and_disabled_sensors_fail_atomically() {
    for patch in [
        json!({"mass":0}),
        json!({"iterations":0}),
        json!({"unknown":1}),
        json!({"maximumSpeed":1000}),
    ] {
        let mut v = fixture();
        for (k, value) in patch.as_object().unwrap() {
            v["compiled"]["resolvedModel"]["contact"]["parameters"][k] = value.clone();
        }
        assert_eq!(send(&mut Engine::default(), v)[0]["type"], "error");
    }
    let mut e = init(fixture());
    let before = state(&mut e);
    let out = apply(
        &mut e,
        "unbound",
        json!([{"op":"set","targets":{"binding":"subject"},"values":{"appearance":{"pose":"fallen"}}}]),
    );
    assert_eq!(out[0]["type"], "error");
    assert_eq!(state(&mut e), before);
    let mut v = fixture();
    v["compiled"]["resolvedModel"]
        .as_object_mut()
        .unwrap()
        .remove("contact");
    assert_eq!(
        send(&mut Engine::default(), v)[0]["error"]["code"],
        "UNSUPPORTED_CAPABILITY"
    );
}
#[test]
fn zero_density_or_other_agents_falling_never_substitutes_for_own_contacts() {
    let mut v = fixture();
    v["compiled"]["scene"]["agents"][0]["x"] = json!(2.5);
    v["compiled"]["scene"]["agents"][2]["x"] = json!(6.5);
    v["compiled"]["scene"]["controllers"] = json!({"right":{"kind":"wait","duration":600},"left":{"kind":"wait","duration":600},"wait":{"kind":"wait","duration":600}});
    let mut e = init(v);
    step(&mut e, 10);
    let s = state(&mut e);
    assert!(
        s["agents"]
            .as_array()
            .unwrap()
            .iter()
            .all(|a| a["sensors"]["contactLoad"] == 0.0)
    );
    apply(
        &mut e,
        "manual",
        json!([{"op":"set","targets":{"ids":["a1"]},"values":{"components":{"mobility":{"speedMultiplier":0}},"appearance":{"pose":"fallen"}}}]),
    );
    step(&mut e, 10);
    assert_ne!(state(&mut e)["agents"][1]["state"], "immobile");
}
#[test]
fn wall_and_person_impulses_add_for_a_body_pressed_against_a_wall() {
    let mut v = fixture();
    v["compiled"]["scene"]["controllers"]["left"] =
        json!({"kind":"follow","targetEntityId":"a2","distance":0});
    v["compiled"]["scene"]["rules"] = json!([]);
    v["compiled"]["scene"]["agents"] = json!([{"id":"a2","tags":[],"profile":"person","x":1.5,"y":2.5,"controller":"wait"},{"id":"a3","tags":[],"profile":"person","x":2.5,"y":2.5,"controller":"left"}]);
    let mut e = init(v);
    step(&mut e, 1);
    let s = state(&mut e);
    assert!(
        (s["agents"][0]["sensors"]["contactLoad"].as_f64().unwrap() - 4.0).abs() < 1e-8,
        "{s}"
    );
    assert_eq!(
        s["contactState"]["data"]["impulses"]["a2"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert!(s["agents"][0]["position"]["x"].as_f64().unwrap() >= 1.5 - 1e-10);
}
#[test]
fn next_tick_jobs_skip_subjects_that_became_immobile_and_repeating_cooldowns_are_per_agent() {
    let mut e = init(fixture());
    step(&mut e, 2);
    apply(
        &mut e,
        "manual-stop",
        json!([{"op":"set","targets":{"ids":["a2"]},"values":{"components":{"mobility":{"speedMultiplier":0}},"appearance":{"pose":"upright"}}}]),
    );
    step(&mut e, 1);
    assert_eq!(state(&mut e)["agents"][1]["appearance"]["pose"], "upright");
    let mut v = fixture();
    let rule = &mut v["compiled"]["scene"]["rules"][0];
    rule["once"] = json!(false);
    rule["cooldown"] = json!(0.1);
    rule["when"]["for"] = json!(0);
    rule["operations"] = json!([{"op":"emit","event":{"name":"qualified"}}]);
    let mut e = init(v);
    step(&mut e, 6);
    let s = state(&mut e);
    assert_eq!(
        s["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["name"] == "qualified")
            .count(),
        3
    );
    assert_eq!(s["rules"][0]["subjects"]["a2"]["nextEligibleTick"], 7);
}
#[test]
fn fractional_dwell_rounding_uses_the_same_fixed_clock_as_schedules() {
    let mut v = fixture();
    v["compiled"]["scene"]["model"]["dt"] = json!(0.01);
    v["compiled"]["resolvedModel"]["dt"] = json!(0.01);
    v["compiled"]["scene"]["rules"][0]["when"]["for"] = json!(0.07);
    let mut e = init(v);
    step(&mut e, 7);
    assert_eq!(state(&mut e)["jobs"][0]["dueTick"], 8);
    step(&mut e, 1);
    assert_eq!(state(&mut e)["agents"][1]["state"], "immobile");
}
#[test]
fn future_spawns_build_their_own_dwell_and_removed_subject_ids_are_not_reused() {
    let mut e = init(fixture());
    step(&mut e, 3);
    let out = apply(
        &mut e,
        "replacement",
        json!([{"op":"remove","targets":{"ids":["a2"]}},{"op":"add","entity":{"id":"gap","kind":"zone","shape":{"kind":"rectangle","x":4,"y":2,"width":1,"height":1}}},{"op":"spawn","template":{"kind":"agent","tags":["new"]},"count":1,"placement":{"inside":{"ids":["gap"]}}},{"op":"assign_goal","targets":{"tags":["new"]},"goal":{"kind":"wait","duration":600}}]),
    );
    assert_eq!(out[0]["type"], "ack", "{out:?}");
    let s = state(&mut e);
    assert!(s["rules"][0]["subjects"].get("a2").is_none());
    assert_eq!(s["agents"][2]["id"], "a4");
    assert!(s["agents"][2]["sensors"].is_null());
    step(&mut e, 1);
    let s = state(&mut e);
    assert_eq!(s["rules"][0]["subjects"]["a4"]["heldTicks"], 1);
    assert_ne!(s["agents"][2]["state"], "immobile");
    step(&mut e, 2);
    assert_eq!(state(&mut e)["agents"][2]["state"], "immobile");
}
#[test]
fn each_matching_subject_owns_a_distinct_scheduled_descendant() {
    let mut v = fixture();
    v["compiled"]["scene"]["rules"][0]["when"]["value"] = json!(0.5);
    v["compiled"]["scene"]["rules"][0]["operations"].as_array_mut().unwrap().push(json!({"op":"schedule","id":"recover","after":0.1,"operations":[{"op":"set","targets":{"binding":"subject"},"values":{"components":{"mobility":{"speedMultiplier":1}},"appearance":{"pose":"upright"}}}]}));
    let mut e = init(v);
    step(&mut e, 3);
    let s = state(&mut e);
    assert!(
        s["agents"]
            .as_array()
            .unwrap()
            .iter()
            .all(|a| a["state"] == "immobile")
    );
    let ids: std::collections::BTreeSet<_> = s["jobs"]
        .as_array()
        .unwrap()
        .iter()
        .map(|j| j["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids.len(), 3);
    step(&mut e, 2);
    assert!(
        state(&mut e)["agents"]
            .as_array()
            .unwrap()
            .iter()
            .all(|a| a["state"] != "immobile")
    );
}
