use crowd_control_engine::Engine;
use serde_json::{Value, json};

fn send(e: &mut Engine, kind: &str, fields: Value) -> Vec<Value> {
    let mut command =
        json!({"schemaVersion":1,"simulationId":"engine-demo","commandId":kind,"type":kind});
    command
        .as_object_mut()
        .unwrap()
        .extend(fields.as_object().unwrap().clone());
    serde_json::from_str(&e.dispatch(&command.to_string())).unwrap()
}
fn ok(e: &mut Engine, kind: &str, fields: Value) -> Vec<Value> {
    let out = send(e, kind, fields);
    assert_eq!(out[0]["type"], "ack", "{out:?}");
    out
}
fn engine() -> Engine {
    let mut e = Engine::default();
    let load: Value = serde_json::from_str(include_str!(
        "../../contract/fixtures/engine-navigation-load.json"
    ))
    .unwrap();
    let out: Vec<Value> = serde_json::from_str(&e.dispatch(&load.to_string())).unwrap();
    assert_eq!(out[0]["type"], "ack", "{out:?}");
    e
}
fn snapshot(e: &mut Engine) -> Value {
    send(e, "snapshot", json!({"snapshotId":"state"}))[0]["snapshot"].clone()
}
fn request(e: &mut Engine, request: Value) -> Vec<Value> {
    send(e, "apply_request", json!({"request":request}))
}
fn late_spawn() -> Value {
    json!({"schemaVersion":1,"simulationId":"engine-demo","requestId":"late","label":"Late arrival","at":20,"operations":[{"op":"spawn","template":{"kind":"agent","tags":["late"]},"count":1,"placement":{"inside":{"ids":["hall"]}}}]})
}

#[test]
fn exact_seek_restores_checkpoints_or_replays_and_starts_a_fresh_stream() {
    let mut e = engine();
    ok(&mut e, "run_to", json!({"time":4}));
    let at_four = snapshot(&mut e);
    let later = ok(&mut e, "run_to", json!({"time":8}));
    let sought = ok(&mut e, "seek", json!({"time":4}));
    assert_ne!(
        sought[0]["stamp"]["streamId"],
        later[0]["stamp"]["streamId"]
    );
    assert_eq!(snapshot(&mut e), at_four);
    ok(&mut e, "seek", json!({"time":1.01}));
    let mut reference = engine();
    ok(&mut reference, "run_to", json!({"time":1.01}));
    assert_eq!(snapshot(&mut e), snapshot(&mut reference));
    ok(&mut e, "run_to", json!({"time":4}));
    assert_eq!(snapshot(&mut e), at_four);
}

#[test]
fn replay_preserves_future_changes_rng_and_request_deduplication() {
    let mut e = engine();
    ok(&mut e, "run_to", json!({"time":10}));
    let applied = request(&mut e, late_spawn());
    assert_eq!(applied[0]["type"], "ack", "{applied:?}");
    ok(&mut e, "run_to", json!({"time":25}));
    let expected = snapshot(&mut e);
    assert_eq!(expected["agents"].as_array().unwrap().len(), 2);
    ok(&mut e, "seek", json!({"time":5}));
    assert_eq!(snapshot(&mut e)["historyRevision"], 0.0);
    ok(&mut e, "run_to", json!({"time":25}));
    assert_eq!(snapshot(&mut e), expected);
    let duplicate = request(&mut e, late_spawn());
    assert_eq!(duplicate[0]["applied"], applied[0]["applied"]);
    assert_eq!(snapshot(&mut e), expected);
    ok(&mut e, "seek", json!({"time":0}));
    ok(&mut e, "seek", json!({"time":25}));
    assert_eq!(snapshot(&mut e), expected);
}

#[test]
fn invalid_seek_and_changes_to_the_recorded_past_leave_state_unchanged() {
    let mut e = engine();
    ok(&mut e, "run_to", json!({"time":4}));
    let expected = snapshot(&mut e);
    for time in [-1.0, 4.01, 1e300] {
        let out = send(&mut e, "seek", json!({"time":time}));
        assert_eq!(out[0]["type"], "error", "{out:?}");
        assert_eq!(snapshot(&mut e), expected);
    }
    ok(&mut e, "seek", json!({"time":0}));
    let expected = snapshot(&mut e);
    assert_eq!(
        request(&mut e, late_spawn())[0]["error"]["code"],
        "UNSUPPORTED_CAPABILITY"
    );
    assert_eq!(snapshot(&mut e), expected);
    ok(&mut e, "reset", json!({}));
    assert_eq!(send(&mut e, "seek", json!({"time":4}))[0]["type"], "error");
}

#[test]
fn sliding_back_and_forth_restores_each_recorded_point() {
    fn reference_at(time: f64) -> Value {
        let mut reference = engine();
        if time >= 10.0 {
            ok(&mut reference, "run_to", json!({"time":10}));
            assert_eq!(request(&mut reference, late_spawn())[0]["type"], "ack");
        }
        ok(&mut reference, "run_to", json!({"time":time}));
        snapshot(&mut reference)
    }

    let mut e = engine();
    ok(&mut e, "run_to", json!({"time":10}));
    assert_eq!(request(&mut e, late_spawn())[0]["type"], "ack");
    ok(&mut e, "run_to", json!({"time":25}));
    let latest = snapshot(&mut e);
    for time in [3.0, 20.0, 0.0, 12.0, 25.0, 1.0, 25.0] {
        ok(&mut e, "seek", json!({"time":time}));
        assert_eq!(snapshot(&mut e), reference_at(time), "seek to {time}");
    }
    assert_eq!(snapshot(&mut e), latest);
}
