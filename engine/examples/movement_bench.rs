use crowd_control_engine::Engine;
use serde_json::{Value, json};
use std::time::Instant;

fn main() {
    let mut load: Value = serde_json::from_str(include_str!(
        "../../contract/fixtures/engine-navigation-load.json"
    ))
    .unwrap();
    let (w, h) = (256, 128);
    let n = w * h;
    let mut blocked = vec![0; n];
    let mut zones = vec![1; n];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if x == 0 || y == 0 || x == w - 1 || y == h - 1 {
                blocked[i] = 1;
                zones[i] = 0;
            } else if x >= w - 3 {
                zones[i] = 2;
            }
        }
    }
    load["compiled"]["scene"]["map"] = json!({"width":w as f64*0.5,"height":h as f64*0.5,"cellSize":0.5,"units":"model","rooms":[],"portals":[],"grid":{"width":w,"height":h,"cellSize":0.5,"units":"model","blocked":blocked,"traversalCost":vec![1;n],"zoneIndex":zones,"portalIndex":vec![0;n],"zoneIds":[null,"hall","outside"],"portalIds":[null]}});
    load["compiled"]["scene"]["agents"]=json!((0..2000).map(|i|json!({"id":format!("a{i:04}"),"tags":[],"profile":"person","controller":"leave","x":2.5+(i%50) as f64*0.8,"y":2.5+(i/50) as f64*0.8})).collect::<Vec<_>>());
    let mut inventory = vec![
        json!({"id":"hall","kind":"zone","tags":[],"componentNames":[]}),
        json!({"id":"outside","kind":"zone","tags":[],"componentNames":[]}),
    ];
    inventory.extend((0..2000).map(|i|json!({"id":format!("a{i:04}"),"kind":"agent","tags":[],"componentNames":["physical","navigation","behavior","mobility"]})));
    load["compiled"]["inventory"] = json!(inventory);
    if std::env::args().any(|a| a == "--fixture") {
        println!("{load}");
        return;
    }
    let mut e = Engine::default();
    let reply: Value = serde_json::from_str(&e.dispatch(&load.to_string())).unwrap();
    assert_eq!(reply[0]["type"], "ack", "{reply}");
    let step=json!({"schemaVersion":1,"simulationId":"engine-demo","commandId":"bench","type":"step","ticks":1}).to_string();
    let mut samples = vec![];
    let mut last = String::new();
    for i in 0..90 {
        let start = Instant::now();
        let reply = e.dispatch(&step);
        let elapsed = start.elapsed().as_secs_f64() * 1000.0;
        assert!(!reply.contains("\"type\":\"error\""), "{reply}");
        if i >= 10 {
            samples.push(elapsed);
        }
        last = reply;
    }
    samples.sort_by(f64::total_cmp);
    let mean = samples.iter().sum::<f64>() / samples.len() as f64;
    let last: Value = serde_json::from_str(&last).unwrap();
    let agents = last[1]["frame"]["agents"].as_array().unwrap();
    let progress = agents
        .iter()
        .enumerate()
        .map(|(i, a)| {
            a["x"].as_f64().unwrap()
                - load["compiled"]["scene"]["agents"][i]["x"]
                    .as_f64()
                    .unwrap()
        })
        .sum::<f64>()
        / 2000.0;
    assert!(progress > 0.5, "Benchmark crowd must actually advance");
    println!(
        "{}",
        json!({"runtime":"native Rust + JSON","agents":2000,"ticksMeasured":samples.len(),"meanMs":mean,"p95Ms":samples[samples.len()*95/100],"ticksPerSecond":1000.0/mean,"requiredTicksPerSecondAt4x":80,"meanXProgress":progress,"renderFps":null})
    );
}
