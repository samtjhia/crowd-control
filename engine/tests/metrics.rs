use crowd_control_engine::Engine;
use serde_json::{Value, json};
fn header(t: &str) -> Value {
    json!({"schemaVersion":1,"simulationId":"engine-demo","commandId":t,"type":t})
}
fn send(e: &mut Engine, c: Value) -> Vec<Value> {
    serde_json::from_str(&e.dispatch(&c.to_string())).unwrap()
}
fn init(c: Value) -> Engine {
    let mut e = Engine::default();
    let out = send(&mut e, c);
    assert_eq!(out[0]["type"], "ack", "{out:?}");
    e
}
fn fixture(name: &str) -> Value {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../contract/fixtures")
        .join(format!("{name}.json"));
    serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
}
fn snapshot(e: &mut Engine) -> Value {
    let mut c = header("snapshot");
    c["snapshotId"] = json!("saved");
    send(e, c)[0]["snapshot"].clone()
}
fn step(e: &mut Engine, n: u64) -> Vec<Value> {
    let mut c = header("step");
    c["ticks"] = json!(n);
    let out = send(e, c);
    assert_eq!(out[0]["type"], "ack", "{out:?}");
    out
}
fn query(e: &mut Engine, q: Value) -> Value {
    let mut c = header("query");
    c["query"] = q;
    let out = send(e, c);
    assert_eq!(out[0]["type"], "query_result", "{out:?}");
    out[0]["result"].clone()
}
fn apply(e: &mut Engine, id: &str, ops: Value) -> Vec<Value> {
    let mut c = header("apply_request");
    c["request"] =
        json!({"schemaVersion":1,"simulationId":"engine-demo","requestId":id,"operations":ops});
    let out = send(e, c);
    assert_eq!(out[0]["type"], "ack", "{out:?}");
    out
}
fn telemetry(messages: &[Value]) -> &Value {
    messages.iter().find(|m| m["type"] == "metrics").unwrap()
}
#[test]
fn occupancy_uses_masks_immobile_bodies_units_and_density_integrates_to_present() {
    let mut c = fixture("engine-services-load");
    for a in c["compiled"]["scene"]["agents"].as_array_mut().unwrap() {
        a.as_object_mut().unwrap().remove("controller");
    }
    let mut e = Engine::default();
    let load = send(&mut e, c);
    let m = telemetry(&load);
    assert_eq!(m["sample"]["present"], 3);
    assert_eq!(m["density"]["units"], "people/model-unit2");
    assert_eq!(m["sample"]["zones"][0]["occupancy"], 3);
    let map = &load[1]["scene"]["map"]["grid"];
    let area = map["blocked"]
        .as_array()
        .unwrap()
        .iter()
        .zip(map["zoneIndex"].as_array().unwrap())
        .filter(|(b, z)| **b == 0 && **z == 1)
        .count();
    assert!(
        (m["sample"]["zones"][0]["density"].as_f64().unwrap() - 3.0 / area as f64).abs() < 1e-12
    );
    let total: f64 = m["density"]["values"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_f64().unwrap())
        .sum();
    assert_eq!(total, 3.0);
    let out = apply(
        &mut e,
        "stop",
        json!([{"op":"set","targets":{"ids":["a1"]},"values":{"components":{"mobility":{"speedMultiplier":0}}}}]),
    );
    assert_eq!(telemetry(&out)["sample"]["immobile"], 1);
    assert_eq!(telemetry(&out)["sample"]["present"], 3);
    for (v, b) in telemetry(&out)["density"]["values"]
        .as_array()
        .unwrap()
        .iter()
        .zip(map["blocked"].as_array().unwrap())
    {
        if b == 1 {
            assert_eq!(v, 0.0)
        }
    }
    let mut c = fixture("engine-static-load");
    c["compiled"]["scene"]["model"]["units"] = json!("m");
    c["compiled"]["scene"]["map"]["units"] = json!("m");
    c["compiled"]["resolvedModel"]["units"] = json!("m");
    let mut e = Engine::default();
    assert_eq!(telemetry(&send(&mut e, c))["density"]["units"], "people/m2");
}
#[test]
fn all_queries_are_read_only_and_filters_do_not_advance_sampling_rng() {
    let mut e = init(fixture("engine-services-load"));
    step(&mut e, 20);
    let before = snapshot(&mut e);
    let q = json!({"kind":"agents","targets":{"kind":"agent","sample":{"count":2}}});
    let first = query(&mut e, q.clone());
    assert_eq!(first, query(&mut e, q));
    assert_eq!(first["agents"].as_array().unwrap().len(), 2);
    let inv = query(&mut e, json!({"kind":"inventory"}));
    assert!(inv["items"].as_array().unwrap().iter().any(|i| {
        i["id"] == "desk"
            && i["componentNames"]
                .as_array()
                .unwrap()
                .contains(&json!("interaction"))
    }));
    let out = query(
        &mut e,
        json!({"kind":"metrics","from":0.5,"to":1,"zones":["hall"]}),
    );
    assert_eq!(out["samples"].as_array().unwrap().len(), 2);
    assert!(out["samples"].as_array().unwrap().iter().all(|s| {
        s["zones"]
            .as_array()
            .unwrap()
            .iter()
            .all(|z| z["zoneId"] == "hall")
    }));
    query(&mut e, json!({"kind":"history"}));
    query(
        &mut e,
        json!({"kind":"events","from":0,"to":1,"names":["departure"]}),
    );
    assert_eq!(snapshot(&mut e), before);
    for q in [
        json!({"kind":"events","from":2,"to":1}),
        json!({"kind":"metrics","extra":true}),
        json!({"kind":"agents"}),
    ] {
        let mut c = header("query");
        c["query"] = q;
        assert_eq!(send(&mut e, c)[0]["type"], "error");
        assert_eq!(snapshot(&mut e), before);
    }
}
#[test]
fn crossings_are_completed_passages_not_entries_and_flow_expires() {
    let mut e = init(fixture("engine-navigation-load"));
    let out = step(&mut e, 80);
    let s = snapshot(&mut e);
    assert_eq!(s["metrics"]["portalCrossings"].as_array().unwrap().len(), 1);
    assert_eq!(s["metrics"]["portalCrossings"][0]["portalId"], "door");
    assert_eq!(telemetry(&out)["sample"]["portals"][0]["crossed"], 1);
    let out = step(&mut e, 30);
    assert_eq!(telemetry(&out)["sample"]["portals"][0]["flowRate"], 0.0);
    let mut c = fixture("engine-navigation-load");
    c["compiled"]["scene"]["profiles"]["person"]["preferredSpeed"] = json!(80);
    c["compiled"]["scene"]["profiles"]["person"]["maximumSpeed"] = json!(80);
    c["compiled"]["scene"]["profiles"]["person"]["acceleration"] = json!(100000);
    let mut e = init(c);
    let out = step(&mut e, 1);
    assert_eq!(telemetry(&out)["sample"]["portals"][0]["crossed"], 1);
    assert_eq!(telemetry(&out)["sample"]["portals"][0]["flowRate"], 1.0);
}
#[test]
fn queues_record_admission_waits_and_never_count_cancelled_tickets_as_served() {
    let mut e = init(fixture("engine-services-load"));
    step(&mut e, 200);
    let s = snapshot(&mut e);
    let q = s["metrics"]["queueTotals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|q| q["targetId"] == "desk")
        .unwrap();
    assert_eq!(q["served"], 2);
    assert_eq!(q["length"], 0);
    assert!(q["totalWait"].as_f64().unwrap() > 0.0);
    assert!(q["maximumWait"].as_f64().unwrap() <= q["totalWait"].as_f64().unwrap());
    let mut e = init(fixture("engine-services-load"));
    step(&mut e, 1);
    apply(
        &mut e,
        "clear",
        json!([{"op":"clear_goal","targets":{"kind":"agent"}}]),
    );
    let s = snapshot(&mut e);
    let q = s["metrics"]["queueTotals"]
        .as_array()
        .unwrap()
        .iter()
        .find(|q| q["targetId"] == "desk")
        .unwrap();
    assert_eq!(q["served"], 0);
    assert_eq!(q["length"], 0);
}
#[test]
fn explicit_clearance_counts_departures_not_removals_and_keeps_missing_members_incomplete() {
    let mut c = fixture("engine-services-load");
    c["compiled"]["scene"]["clearance"] =
        json!({"cohortIds":["a1","a2","a3","future"],"startedAt":0});
    let mut e = init(c);
    apply(
        &mut e,
        "immobile",
        json!([{"op":"set","targets":{"ids":["a3"]},"values":{"components":{"mobility":{"speedMultiplier":0}}}}]),
    );
    let out = step(&mut e, 400);
    let sample = &telemetry(&out)["sample"];
    assert_eq!(sample["departed"], 2);
    assert!(sample["clearance"]["t50"].is_number());
    assert!(sample["clearance"]["t90"].is_null());
    assert!(sample["clearance"]["t100"].is_null());
    let out = apply(
        &mut e,
        "remove",
        json!([{"op":"remove","targets":{"ids":["a3"]}}]),
    );
    assert_eq!(telemetry(&out)["sample"]["removed"], 1);
    assert_eq!(telemetry(&out)["sample"]["departed"], 2);
    assert!(telemetry(&out)["sample"]["clearance"]["t100"].is_null());
    let mut c = fixture("engine-services-load");
    c["compiled"]["scene"]["clearance"] = json!({"cohortIds":["a1","a2"],"startedAt":0});
    let mut e = init(c);
    let out = step(&mut e, 400);
    assert!(telemetry(&out)["sample"]["clearance"]["t100"].is_number());
    let complete = telemetry(&out)["sample"]["clearance"].clone();
    let out = apply(
        &mut e,
        "remove-departed",
        json!([{"op":"remove","targets":{"ids":["a1"]}}]),
    );
    assert_eq!(telemetry(&out)["sample"]["removed"], 1);
    assert_eq!(telemetry(&out)["sample"]["departed"], 2);
    assert_eq!(telemetry(&out)["sample"]["clearance"], complete);
    let mut e = init(fixture("engine-services-load"));
    assert!(telemetry(&step(&mut e, 400))["sample"]["clearance"]["t100"].is_null());
}
#[test]
fn density_rules_use_usable_union_area_at_tick_boundaries_without_contact_sensors() {
    let mut c = fixture("engine-static-load");
    c["compiled"]["scene"]["rules"] = json!([{"op":"define_rule","id":"busy","when":{"kind":"density","inside":{"ids":["hall"]},"comparison":"gte","value":0.5},"operations":[{"op":"emit","event":{"name":"busy"}}]}]);
    let mut e = init(c);
    let s = snapshot(&mut e);
    assert_eq!(s["events"][0]["name"], "busy");
    assert!(
        s["agents"]
            .as_array()
            .unwrap()
            .iter()
            .all(|a| a["sensors"].is_null())
    );
    let out = apply(
        &mut e,
        "threshold",
        json!([{"op":"define_rule","id":"after-arrival","when":{"kind":"density","inside":{"ids":["hall"]},"comparison":"gt","value":0.5},"operations":[{"op":"emit","event":{"name":"denser"}}]},{"op":"schedule","id":"arrival","after":0.1,"operations":[{"op":"spawn","template":{"kind":"agent"},"count":1,"placement":{"inside":{"ids":["hall"]}}}]}]),
    );
    assert!(out.iter().all(|m| m["type"] != "events"));
    step(&mut e, 2);
    let events = query(&mut e, json!({"kind":"events","names":["denser"]}));
    assert_eq!(events["events"].as_array().unwrap().len(), 1);
    assert_eq!(events["events"][0]["time"], 0.1);
}
#[test]
fn history_retains_more_than_mock_cap_and_ranges_include_endpoints() {
    let mut c = fixture("engine-static-load");
    c["compiled"]["scene"]["agents"] = json!([]);
    let mut e = init(c);
    step(&mut e, 20010);
    let samples = query(&mut e, json!({"kind":"metrics"}));
    assert_eq!(samples["samples"].as_array().unwrap().len(), 2002);
    let selected = query(&mut e, json!({"kind":"metrics","from":1000,"to":1000.5}));
    assert_eq!(selected["samples"].as_array().unwrap().len(), 2);
}
#[test]
fn portal_entries_and_uturns_are_not_completed_passages() {
    let mut c = fixture("engine-navigation-load");
    c["compiled"]["scene"]["controllers"]["leave"] = json!({"kind":"sequence","goals":[{"kind":"reach","targetEntityId":"door"},{"kind":"reach","targetZone":"hall"},{"kind":"reach","targetZone":"outside"}]});
    let mut e = init(c);
    step(&mut e, 300);
    assert_eq!(
        snapshot(&mut e)["metrics"]["portalCrossings"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let mut c = fixture("engine-navigation-load");
    c["compiled"]["scene"]["agents"][0]["x"] = json!(3.5);
    c["compiled"]["scene"]["agents"][0]["y"] = json!(2.5);
    let mut e = init(c);
    step(&mut e, 80);
    assert!(
        snapshot(&mut e)["metrics"]["portalCrossings"]
            .as_array()
            .unwrap()
            .is_empty()
    );
}
