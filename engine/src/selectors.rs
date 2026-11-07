//! Live, stable-order selection. Samples use an origin-specific stream, never agent RNG.
use crate::{
    core::{Failure, invalid},
    protocol::*,
    random,
    shapes::Shape,
    world::{World, wire},
};
use serde_json::{Value, json};
use std::collections::BTreeMap;

pub fn keys(v: &Value, allowed: &[&str], required: &[&str]) -> Result<(), Failure> {
    let o = v.as_object().ok_or_else(|| invalid("Expected an object"))?;
    if o.keys().any(|k| !allowed.contains(&k.as_str()))
        || required.iter().any(|k| !o.contains_key(*k))
    {
        return Err(invalid("Unknown or missing fields"));
    }
    Ok(())
}
pub fn id(v: &Value) -> Result<Id, Failure> {
    serde_json::from_value(v.clone()).map_err(|e| invalid(e.to_string()))
}
pub fn number(v: &Value) -> Result<f64, Failure> {
    v.as_f64()
        .filter(|n| n.is_finite() && *n >= 0.0)
        .ok_or_else(|| invalid("Expected nonnegative finite number"))
}
pub fn count(v: &Value) -> Result<usize, Failure> {
    let n = number(v)?;
    if n.fract() != 0.0 || n > 9_007_199_254_740_991.0 {
        return Err(invalid("Expected safe integer"));
    }
    Ok(n as usize)
}
pub fn compare(a: &Value, op: &str, b: &Value) -> bool {
    match op {
        "eq" => a.as_f64().zip(b.as_f64()).map_or(a == b, |(a, b)| a == b),
        "neq" => a.as_f64().zip(b.as_f64()).map_or(a != b, |(a, b)| a != b),
        "gt" => a.as_f64().zip(b.as_f64()).is_some_and(|(a, b)| a > b),
        "gte" => a.as_f64().zip(b.as_f64()).is_some_and(|(a, b)| a >= b),
        "lt" => a.as_f64().zip(b.as_f64()).is_some_and(|(a, b)| a < b),
        "lte" => a.as_f64().zip(b.as_f64()).is_some_and(|(a, b)| a <= b),
        _ => false,
    }
}
pub fn validate(v: &Value, depth: usize) -> Result<(), Failure> {
    if depth > 4 {
        return Err(("RESOURCE_LIMIT", "Selector nesting exceeds four".into()));
    }
    keys(
        v,
        &[
            "ids", "kind", "tags", "label", "where", "inside", "near", "sample",
        ],
        &[],
    )?;
    if v.as_object().unwrap().keys().all(|k| k == "sample") {
        return Err(invalid("Empty selector"));
    }
    for key in ["ids", "tags"] {
        if let Some(a) = v.get(key) {
            let a = a
                .as_array()
                .filter(|a| !a.is_empty() && a.len() <= 4096)
                .ok_or_else(|| invalid("Selector needs a bounded nonempty ID array"))?;
            for i in a {
                id(i)?;
            }
        }
    }
    if let Some(k) = v.get("kind") {
        serde_json::from_value::<EntityKind>(k.clone()).map_err(|e| invalid(e.to_string()))?;
    }
    if let Some(l) = v.get("label") {
        if l.as_str().is_none_or(str::is_empty) {
            return Err(invalid("Invalid selector label"));
        }
    }
    if let Some(i) = v.get("inside") {
        validate(i, depth + 1)?;
    }
    if let Some(n) = v.get("near") {
        keys(n, &["targets", "distance"], &["targets", "distance"])?;
        validate(&n["targets"], depth + 1)?;
        number(&n["distance"])?;
    }
    if let Some(s) = v.get("sample") {
        keys(s, &["count", "fraction"], &[])?;
        if s.as_object().unwrap().len() != 1 {
            return Err(invalid("Sample requires count XOR fraction"));
        }
        if let Some(c) = s.get("count") {
            count(c)?;
        } else if number(&s["fraction"])? > 1.0 {
            return Err(invalid("Fraction exceeds one"));
        }
    }
    if let Some(w) = v.get("where") {
        let predicates = w
            .as_array()
            .filter(|a| !a.is_empty() && a.len() <= 64)
            .ok_or_else(|| invalid("Invalid predicates"))?;
        for p in predicates {
            keys(
                p,
                &["path", "comparison", "value"],
                &["path", "comparison", "value"],
            )?;
            let path = p["path"].as_str().unwrap_or("");
            let op = p["comparison"].as_str().unwrap_or("");
            let numeric = [
                "physical.radius",
                "navigation.preferredSpeed",
                "navigation.maximumSpeed",
                "navigation.acceleration",
                "navigation.personalSpace",
                "behavior.reactionDelay",
                "behavior.routeCompliance",
                "behavior.avoidanceStrength",
                "behavior.groupCohesion",
                "behavior.goalPersistence",
                "mobility.speedMultiplier",
                "capacity.maximumOccupants",
                "capacity.serviceRate",
                "portal.traversalTime",
                "interaction.duration",
                "interaction.slots",
            ];
            if path == "state" || path == "zoneId" {
                if !p["value"].is_string() || !["eq", "neq"].contains(&op) {
                    return Err(invalid("Invalid string predicate"));
                }
            } else if [
                "components.physical.blocksMovement",
                "components.physical.movable",
                "components.portal.open",
                "components.portal.oneWay",
            ]
            .contains(&path)
            {
                if !p["value"].is_boolean() || !["eq", "neq"].contains(&op) {
                    return Err(invalid("Invalid boolean predicate"));
                }
            } else if path
                .strip_prefix("components.")
                .is_some_and(|s| numeric.contains(&s))
            {
                if !p["value"].is_number() || !["eq", "neq", "gt", "gte", "lt", "lte"].contains(&op)
                {
                    return Err(invalid("Invalid numeric predicate"));
                }
            } else {
                return Err(invalid("Predicate path is not allowlisted"));
            }
        }
    }
    Ok(())
}
pub fn records(world: &World) -> BTreeMap<Id, Value> {
    let mut records = BTreeMap::new();
    for r in &world.map_state.rooms {
        let mut v = wire(r);
        v["kind"] = json!("zone");
        v["shape"] = json!({"kind":"rectangle","x":r.x,"y":r.y,"width":r.width,"height":r.height});
        records.insert(r.id.clone(), v);
    }
    for p in &world.map_state.portals {
        let mut v = wire(p);
        v["kind"] = json!("portal");
        v["shape"] = json!({"kind":"rectangle","x":p.x,"y":p.y,"width":p.width,"height":p.height});
        v["components"] = json!({"portal":{"connects":p.connects,"open":p.open,"oneWay":p.one_way.unwrap_or(false),"traversalTime":p.traversal_time.map_or(0.0,|v|v.0)}});
        records.insert(p.id.clone(), v);
    }
    for e in world.map_state.entities() {
        records.insert(e.id.clone(), wire(e));
    }
    for id in world.grid.zone_ids.iter().flatten() {
        records
            .entry(id.clone())
            .or_insert_with(|| json!({"id":id,"kind":"zone"}));
    }
    for a in &world.agents {
        records.insert(a.id.clone(), serde_json::to_value(a).unwrap());
    }
    records
}
pub fn contains(world: &World, id: &Id, p: &Point) -> bool {
    if world.grid.zone_ids.contains(&Some(id.clone())) {
        return world.grid.zone_at(p.x.0, p.y.0).as_ref() == Some(id);
    }
    if world.grid.portal_ids.contains(&Some(id.clone())) {
        let g = &world.grid;
        if p.x.0 < 0.0
            || p.y.0 < 0.0
            || p.x.0 >= world.map_state.width.0
            || p.y.0 >= world.map_state.height.0
        {
            return false;
        }
        let i = (p.y.0 / g.cell_size).floor() as usize * g.width
            + (p.x.0 / g.cell_size).floor() as usize;
        return g.portal_ids[g.portal_index[i] as usize].as_ref() == Some(id);
    }
    distance(world, id, p) <= 1e-9
}
pub fn distance(world: &World, id: &Id, p: &Point) -> f64 {
    if let Some(a) = world.agents.iter().find(|a| &a.id == id) {
        return (crate::geometry::distance(&a.position, p) - a.components.physical.radius.0)
            .max(0.0);
    }
    let grid = &world.grid;
    if let Some(cells) = grid.target_cells.get(id) {
        if grid.zone_ids.contains(&Some(id.clone())) || grid.portal_ids.contains(&Some(id.clone()))
        {
            return cells
                .iter()
                .map(|i| {
                    let l = (i % grid.width) as f64 * grid.cell_size;
                    let t = (i / grid.width) as f64 * grid.cell_size;
                    crate::geometry::norm(
                        p.x.0 - p.x.0.clamp(l, l + grid.cell_size),
                        p.y.0 - p.y.0.clamp(t, t + grid.cell_size),
                    )
                })
                .fold(f64::INFINITY, f64::min);
        }
    }
    world
        .map_state
        .entities()
        .iter()
        .find(|e| &e.id == id)
        .and_then(|e| e.shape.as_ref())
        .map_or(f64::INFINITY, |s| s.distance(p))
}
pub fn point(v: &Value) -> Option<Point> {
    if let Ok(p) = serde_json::from_value::<Point>(v["position"].clone()) {
        return Some(p);
    }
    let s: Shape = serde_json::from_value(v["shape"].clone()).ok()?;
    let (x, y, w, h) = s.extent();
    Some(Point {
        x: Number(x + w / 2.0),
        y: Number(y + h / 2.0),
    })
}
pub fn resolve(
    world: &mut World,
    v: &Value,
    key: &str,
    work: &mut usize,
) -> Result<Vec<Id>, Failure> {
    validate(v, 0)?;
    let inside = if let Some(v) = v.get("inside") {
        Some(resolve(world, v, key, work)?)
    } else {
        None
    };
    let near = if let Some(v) = v.get("near") {
        Some((
            resolve(world, &v["targets"], key, work)?,
            number(&v["distance"])?,
        ))
    } else {
        None
    };
    if v["kind"] == "agent" && v.get("where").is_none() && inside.is_none() && near.is_none() {
        *work = work.saturating_add(world.agents.len());
        if *work > 64_000_000 {
            return Err(("RESOURCE_LIMIT", "Selector work exceeds budget".into()));
        }
        let ids = world
            .agents
            .iter()
            .filter(|a| {
                !v.get("ids").is_some_and(|ids| {
                    !ids.as_array()
                        .unwrap()
                        .iter()
                        .any(|id| id.as_str() == Some(&a.id.0))
                }) && !v.get("tags").is_some_and(|tags| {
                    tags.as_array()
                        .unwrap()
                        .iter()
                        .any(|tag| !a.tags.iter().any(|t| tag.as_str() == Some(&t.0)))
                }) && !v
                    .get("label")
                    .is_some_and(|l| a.label.as_deref() != l.as_str())
            })
            .map(|a| a.id.clone())
            .collect();
        return sample(world, v, key, ids);
    }
    let records = records(world);
    let geometric_cost = near
        .iter()
        .flat_map(|(ids, _)| ids)
        .map(|id| world.grid.target_cells.get(id).map_or(1, Vec::len))
        .sum::<usize>()
        .saturating_mul(records.len());
    *work = work.saturating_add(geometric_cost);
    if *work > 64_000_000 {
        return Err((
            "RESOURCE_LIMIT",
            "Selector geometry work exceeds budget".into(),
        ));
    }
    let mut ids = vec![];
    for (id, r) in records {
        *work += 1;
        if *work > 64_000_000 {
            return Err(("RESOURCE_LIMIT", "Selector work exceeds budget".into()));
        }
        if v.get("ids")
            .is_some_and(|a| !a.as_array().unwrap().contains(&json!(id)))
            || v.get("kind").is_some_and(|k| k != &r["kind"])
            || v.get("label").is_some_and(|l| l != &r["label"])
        {
            continue;
        }
        if v.get("tags").is_some_and(|a| {
            a.as_array()
                .unwrap()
                .iter()
                .any(|t| r["tags"].as_array().is_none_or(|tags| !tags.contains(t)))
        }) {
            continue;
        }
        if v.get("where").is_some_and(|a| {
            a.as_array().unwrap().iter().any(|p| {
                let mut a = &r;
                for s in p["path"].as_str().unwrap().split('.') {
                    a = &a[s];
                }
                a.is_null() || !compare(a, p["comparison"].as_str().unwrap(), &p["value"])
            })
        }) {
            continue;
        }
        if let Some(targets) = &inside {
            if point(&r).is_none_or(|p| !targets.iter().any(|id| contains(world, id, &p))) {
                continue;
            }
        }
        if let Some((targets, d)) = &near {
            if point(&r).is_none_or(|p| !targets.iter().any(|id| distance(world, id, &p) <= *d)) {
                continue;
            }
        }
        ids.push(id);
    }
    sample(world, v, key, ids)
}
fn sample(world: &mut World, v: &Value, key: &str, mut ids: Vec<Id>) -> Result<Vec<Id>, Failure> {
    ids.sort();
    if let Some(s) = v.get("sample") {
        let n = if let Some(c) = s.get("count") {
            count(c)?.min(ids.len())
        } else {
            (ids.len() as f64 * number(&s["fraction"])?).floor() as usize
        };
        let stream_id = Id(format!("sample-{}", crate::world::fingerprint(&key)));
        if world.random.rule_sampling.len() >= 10000
            && !world.random.rule_sampling.contains_key(&stream_id)
        {
            return Err(("RESOURCE_LIMIT", "Selector stream budget exceeded".into()));
        }
        let state = world
            .random
            .rule_sampling
            .entry(stream_id)
            .or_insert_with(|| {
                random::stream_seed(
                    world.initial.scene.seed.0 as u32,
                    &format!("selection:{key}"),
                )
            });
        for i in 0..n {
            let j = i
                + (u64::from(random::next(state)) * (ids.len() - i) as u64
                    / (u64::from(u32::MAX) + 1)) as usize;
            ids.swap(i, j);
        }
        ids.truncate(n);
        ids.sort();
    }
    Ok(ids)
}
