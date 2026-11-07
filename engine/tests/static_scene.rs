use crowd_control_engine::Engine;
use serde_json::{Value, json};
fn load() -> Value {
    serde_json::from_str(include_str!(
        "../../contract/fixtures/engine-static-load.json"
    ))
    .unwrap()
}
fn dispatch(e: &mut Engine, v: &Value) -> Vec<Value> {
    serde_json::from_str(&e.dispatch(&v.to_string())).unwrap()
}

#[test]
fn loads_metadata_before_positions_and_resets_stream() {
    let mut engine = Engine::default();
    let input = load();
    let out = dispatch(&mut engine, &input);
    assert_eq!(
        out.iter()
            .map(|m| m["type"].as_str().unwrap())
            .collect::<Vec<_>>(),
        ["ack", "scene", "frame"]
    );
    assert_eq!(out[1]["scene"]["agents"][0]["radius"], 0.2);
    assert_eq!(out[2]["frame"]["agents"][0]["x"], 1.5);
    assert_eq!(out[2]["frame"]["agents"][0]["state"], "idle");
    let reset = dispatch(
        &mut engine,
        &json!({"schemaVersion":1,"simulationId":"engine-demo","commandId":"reset","type":"reset"}),
    );
    assert_ne!(out[2]["frame"]["streamId"], reset[2]["frame"]["streamId"]);
    assert_eq!(out[2]["frame"]["agents"], reset[2]["frame"]["agents"]);
}

#[test]
fn malformed_or_unsupported_loads_preserve_the_previous_world() {
    let mut engine = Engine::default();
    dispatch(&mut engine, &load());
    for (field, value, expected) in [
        ("seed", json!(-1), "INVALID_SCHEMA"),
        ("seed", json!(4294967296u64), "INVALID_SCHEMA"),
        ("jobs", json!([{}]), "UNSUPPORTED_CAPABILITY"),
        ("surprise", json!(true), "INVALID_SCHEMA"),
    ] {
        let mut bad = load();
        bad["compiled"]["scene"][field] = value;
        let out = dispatch(&mut engine, &bad);
        assert_eq!(out[0]["type"], "error");
        assert_eq!(out[0]["commandId"], "load-demo");
        assert_eq!(out[0]["error"]["code"], expected);
    }
    let paused = dispatch(
        &mut engine,
        &json!({"schemaVersion":1,"simulationId":"engine-demo","commandId":"pause","type":"pause"}),
    );
    assert_eq!(paused[0]["stamp"]["streamId"], "rust-stream-1");
}

#[test]
fn strict_nested_fields_ranges_and_references_are_checked() {
    for pointer in [
        "/compiled/scene/agents/0/x",
        "/compiled/resolvedModel/defaultAgent/physical/radius",
        "/compiled/scene/map/width",
    ] {
        let mut bad = load();
        *bad.pointer_mut(pointer).unwrap() = json!(-1);
        assert_eq!(
            dispatch(&mut Engine::default(), &bad)[0]["error"]["code"],
            "INVALID_SCHEMA"
        );
    }
    let mut bad = load();
    bad["compiled"]["scene"]["agents"][0]["appearance"] = json!({"fill":"red"});
    assert_eq!(
        dispatch(&mut Engine::default(), &bad)[0]["error"]["code"],
        "INVALID_SCHEMA"
    );
    bad = load();
    bad["compiled"]["scene"]["agents"][0]["profile"] = json!("missing");
    assert_eq!(
        dispatch(&mut Engine::default(), &bad)[0]["error"]["code"],
        "INVALID_SCHEMA"
    );
    bad = load();
    bad["compiled"]["scene"]["agents"][0]["components"] = json!({"mobility":{"speedMultiplier":0}});
    bad["compiled"]["scene"]["agents"][0]["appearance"] =
        json!({"fill":"#FF0000","symbol":"triangle"});
    let out = dispatch(&mut Engine::default(), &bad);
    assert_eq!(
        out[1]["scene"]["agents"][0]["appearance"]["fill"],
        "#FF0000"
    );
    assert_eq!(out[2]["frame"]["agents"][0]["state"], "immobile");
}

#[test]
fn playback_advances_clock_and_correlates_errors() {
    let mut e = Engine::default();
    dispatch(&mut e, &load());
    let out = dispatch(
        &mut e,
        &json!({"schemaVersion":1,"simulationId":"engine-demo","commandId":"step","type":"step","ticks":1}),
    );
    assert_eq!(out[0]["type"], "ack");
    assert_eq!(out[0]["stamp"]["tick"], 1);
    let malformed: Value = serde_json::from_str(&e.dispatch("not json")).unwrap();
    assert_eq!(malformed[0]["error"]["code"], "INVALID_SCHEMA");
}
