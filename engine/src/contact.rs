//! Frictionless inelastic disc constraints. Only swept/touching contacts generate impulses.
use crate::{
    core::{Failure, invalid, unsupported},
    geometry,
    grid::GridData,
    protocol::*,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;
pub const VERSION: &str = "disc-impulse-v1";
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    pub solver_version: Id,
    pub reference_load: Positive,
    pub force_units: String,
    pub parameters: Parameters,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Parameters {
    pub mass: Positive,
    pub iterations: Counter,
    pub tolerance: Positive,
    pub maximum_speed: Positive,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct State {
    pub sample_tick: Option<u64>,
    pub dt: f64,
    pub impulses: BTreeMap<Id, Vec<f64>>,
}
#[derive(Clone, Copy, Debug, Default)]
pub struct Vec2 {
    pub x: f64,
    pub y: f64,
}
impl Vec2 {
    pub fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }
    pub fn dot(self, b: Self) -> f64 {
        self.x * b.x + self.y * b.y
    }
    pub fn add(self, b: Self) -> Self {
        Self::new(self.x + b.x, self.y + b.y)
    }
    pub fn sub(self, b: Self) -> Self {
        Self::new(self.x - b.x, self.y - b.y)
    }
    pub fn mul(self, s: f64) -> Self {
        Self::new(self.x * s, self.y * s)
    }
    pub fn len(self) -> f64 {
        geometry::norm(self.x, self.y)
    }
}
pub fn config(raw: Option<&Value>, units: &Units) -> Result<Option<Config>, Failure> {
    let Some(raw) = raw else { return Ok(None) };
    if raw["solverVersion"] != VERSION {
        return Err(unsupported("Unknown contact solver version"));
    }
    let c: Config = serde_json::from_value(raw.clone()).map_err(|e| invalid(e.to_string()))?;
    if !["model-force", "N"].contains(&c.force_units.as_str())
        || c.force_units == "N" && *units != Units::Metres
    {
        return Err(invalid(
            "Newton contact units require metre geometry and a kg mass",
        ));
    }
    if c.parameters.iterations.0 < 1.0
        || c.parameters.iterations.0 > 128.0
        || c.parameters.tolerance.0 > 0.001
        || c.parameters.maximum_speed.0 > 100.0
        || (c.parameters.mass.0 < 1e-9 || c.parameters.mass.0 > 1e6)
        || c.reference_load.0 < 1e-12
    {
        return Err(invalid("Contact parameters exceed supported bounds"));
    }
    Ok(Some(c))
}
pub fn inverse_mass(a: &AgentRuntime, p: &Parameters) -> f64 {
    if a.departed_at.is_none()
        && a.components.physical.movable
        && a.components.mobility.speed_multiplier.0 > 0.0
    {
        1.0 / p.mass.0
    } else {
        0.0
    }
}
#[derive(Clone)]
struct Constraint {
    a: usize,
    b: Option<usize>,
    n: Vec2,
    lower: f64,
    impulse: f64,
}
fn circle_hit(delta: Vec2, relative: Vec2, r: f64, h: f64) -> Option<(f64, Vec2)> {
    let d = delta.len();
    if d <= r {
        return (d > 0.0).then(|| (0.0, delta.mul(1.0 / d)));
    }
    let aa = relative.dot(relative);
    if aa == 0.0 {
        return None;
    }
    let bb = delta.dot(relative);
    let cc = delta.dot(delta) - r * r;
    let discriminant = bb * bb - aa * cc;
    if bb >= 0.0 || discriminant < 0.0 {
        return None;
    }
    let t = cc / (-bb + discriminant.sqrt());
    if t < 0.0 || t > h {
        return None;
    }
    let n = delta.add(relative.mul(t));
    let len = n.len();
    (len > 0.0).then(|| (t, n.mul(1.0 / len)))
}
fn wall_hit(p: Vec2, v: Vec2, r: f64, l: f64, t: f64, size: f64, h: f64) -> Option<(Vec2, Vec2)> {
    let right = l + size;
    let bottom = t + size;
    let closest = Vec2::new(p.x.clamp(l, right), p.y.clamp(t, bottom));
    let offset = p.sub(closest);
    let d = offset.len();
    if d > 0.0 && d <= r {
        return Some((offset.mul(1.0 / d), closest));
    }
    let mut best = f64::INFINITY;
    let mut result = None;
    for (axis, edge, normal, low, high) in [
        (0, l - r, Vec2::new(-1.0, 0.0), t, bottom),
        (0, right + r, Vec2::new(1.0, 0.0), t, bottom),
        (1, t - r, Vec2::new(0.0, -1.0), l, right),
        (1, bottom + r, Vec2::new(0.0, 1.0), l, right),
    ] {
        let (s, speed, other, other_speed) = if axis == 0 {
            (p.x, v.x, p.y, v.y)
        } else {
            (p.y, v.y, p.x, v.x)
        };
        if speed == 0.0 || v.dot(normal) >= 0.0 {
            continue;
        }
        let time = (edge - s) / speed;
        let tangent = other + other_speed * time;
        if time >= 0.0 && time <= h && time < best && tangent >= low && tangent <= high {
            best = time;
            let contact = p.add(v.mul(time)).sub(normal.mul(r));
            result = Some((normal, contact));
        }
    }
    for (x, y) in [(l, t), (l, bottom), (right, t), (right, bottom)] {
        let corner = Vec2::new(x, y);
        if let Some((time, n)) = circle_hit(p.sub(corner), v, r, h) {
            if time < best {
                best = time;
                result = Some((n, corner));
            }
        }
    }
    result
}
fn charge(work: &mut usize, n: usize) -> Result<(), Failure> {
    *work = work.saturating_add(n);
    if *work > 64_000_000 {
        Err(("RESOURCE_LIMIT", "Contact work budget exceeded".into()))
    } else {
        Ok(())
    }
}
impl State {
    pub fn begin(&mut self) {
        self.impulses.clear();
    }
    pub fn solve(
        &mut self,
        grid: &GridData,
        agents: &[AgentRuntime],
        velocities: &mut [Vec2],
        h: f64,
        p: &Parameters,
        work: &mut usize,
    ) -> Result<(), Failure> {
        let positions: Vec<_> = agents
            .iter()
            .map(|a| Vec2::new(a.position.x.0, a.position.y.0))
            .collect();
        let inv: Vec<_> = agents.iter().map(|a| inverse_mass(a, p)).collect();
        let max_radius = agents
            .iter()
            .map(|a| a.components.physical.radius.0)
            .fold(0.0, f64::max);
        let size = (2.0 * max_radius + 2.0 * p.maximum_speed.0 * h).max(grid.cell_size);
        let mut buckets = BTreeMap::<(i64, i64), Vec<usize>>::new();
        for (i, a) in agents.iter().enumerate() {
            if a.departed_at.is_none() && a.components.physical.blocks_movement {
                buckets
                    .entry((
                        (positions[i].x / size).floor() as i64,
                        (positions[i].y / size).floor() as i64,
                    ))
                    .or_default()
                    .push(i);
            }
        }
        let mut pairs = vec![];
        for (i, a) in agents
            .iter()
            .enumerate()
            .filter(|(_, a)| a.departed_at.is_none() && a.components.physical.blocks_movement)
        {
            let key = (
                (positions[i].x / size).floor() as i64,
                (positions[i].y / size).floor() as i64,
            );
            for dy in -1..=1 {
                for dx in -1..=1 {
                    if let Some(ids) = buckets.get(&(key.0 + dx, key.1 + dy)) {
                        for &j in ids {
                            if j > i && (inv[i] > 0.0 || inv[j] > 0.0) {
                                charge(work, 1)?;
                                if positions[i].sub(positions[j]).len()
                                    <= a.components.physical.radius.0
                                        + agents[j].components.physical.radius.0
                                        + 2.0 * p.maximum_speed.0 * h
                                        + p.tolerance.0
                                {
                                    pairs.push((i, j));
                                }
                            }
                        }
                    }
                }
            }
        }
        let mut walls = vec![];
        for (i, a) in agents
            .iter()
            .enumerate()
            .filter(|(i, a)| inv[*i] > 0.0 && a.departed_at.is_none())
        {
            let reach = a.components.physical.radius.0 + p.maximum_speed.0 * h + p.tolerance.0;
            let pos = positions[i];
            let left = ((pos.x - reach) / grid.cell_size).floor().max(0.0) as usize;
            let right = ((pos.x + reach) / grid.cell_size)
                .floor()
                .min(grid.width as f64 - 1.0) as usize;
            let top = ((pos.y - reach) / grid.cell_size).floor().max(0.0) as usize;
            let bottom = ((pos.y + reach) / grid.cell_size)
                .floor()
                .min(grid.height as f64 - 1.0) as usize;
            for y in top..=bottom {
                for x in left..=right {
                    charge(work, 1)?;
                    if grid.blocked[y * grid.width + x] != 0 {
                        walls.push((i, y * grid.width + x));
                    }
                }
            }
        }
        let mut rows: Vec<Constraint> = vec![];
        let mut pair_rows = std::collections::BTreeSet::new();
        let mut wall_rows = std::collections::BTreeSet::new();
        let min_radius = agents
            .iter()
            .map(|a| a.components.physical.radius.0)
            .fold(f64::INFINITY, f64::min);
        let tolerance = p.tolerance.0.min(min_radius * 1e-12) / h;
        let mut converged = false;
        for _ in 0..p.iterations.0 as usize {
            let previous = rows.len();
            for &(i, j) in &pairs {
                charge(work, 1)?;
                if pair_rows.contains(&(i, j)) {
                    continue;
                }
                let radius =
                    agents[i].components.physical.radius.0 + agents[j].components.physical.radius.0;
                if let Some((_, n)) = circle_hit(
                    positions[i].sub(positions[j]),
                    velocities[i].sub(velocities[j]),
                    radius,
                    h,
                ) {
                    let gap = positions[i].sub(positions[j]).dot(n) - radius;
                    rows.push(Constraint {
                        a: i,
                        b: Some(j),
                        n,
                        lower: -gap / h,
                        impulse: 0.0,
                    });
                    pair_rows.insert((i, j));
                }
            }
            for &(i, cell) in &walls {
                charge(work, 1)?;
                if wall_rows.contains(&(i, cell)) {
                    continue;
                }
                let radius = agents[i].components.physical.radius.0;
                if let Some((n, point)) = wall_hit(
                    positions[i],
                    velocities[i],
                    radius,
                    (cell % grid.width) as f64 * grid.cell_size,
                    (cell / grid.width) as f64 * grid.cell_size,
                    grid.cell_size,
                    h,
                ) {
                    let gap = positions[i].sub(point).dot(n) - radius;
                    rows.push(Constraint {
                        a: i,
                        b: None,
                        n,
                        lower: -gap / h,
                        impulse: 0.0,
                    });
                    wall_rows.insert((i, cell));
                }
            }
            for (i, a) in agents
                .iter()
                .enumerate()
                .filter(|(i, a)| inv[*i] > 0.0 && a.departed_at.is_none())
            {
                let r = a.components.physical.radius.0;
                for (key, n, gap) in [
                    (grid.blocked.len(), Vec2::new(1.0, 0.0), positions[i].x - r),
                    (
                        grid.blocked.len() + 1,
                        Vec2::new(-1.0, 0.0),
                        grid.width as f64 * grid.cell_size - positions[i].x - r,
                    ),
                    (
                        grid.blocked.len() + 2,
                        Vec2::new(0.0, 1.0),
                        positions[i].y - r,
                    ),
                    (
                        grid.blocked.len() + 3,
                        Vec2::new(0.0, -1.0),
                        grid.height as f64 * grid.cell_size - positions[i].y - r,
                    ),
                ] {
                    if !wall_rows.contains(&(i, key))
                        && gap + velocities[i].dot(n) * h <= p.tolerance.0
                    {
                        rows.push(Constraint {
                            a: i,
                            b: None,
                            n,
                            lower: -gap / h,
                            impulse: 0.0,
                        });
                        wall_rows.insert((i, key));
                    }
                }
            }
            for row in &mut rows {
                charge(work, 1)?;
                let inverse = inv[row.a] + row.b.map_or(0.0, |b| inv[b]);
                if inverse == 0.0 {
                    continue;
                }
                let relative = velocities[row.a]
                    .sub(row.b.map_or(Vec2::default(), |b| velocities[b]))
                    .dot(row.n);
                let next = (row.impulse + (row.lower - relative) / inverse).max(0.0);
                let delta = next - row.impulse;
                row.impulse = next;
                velocities[row.a] = velocities[row.a].add(row.n.mul(delta * inv[row.a]));
                if let Some(b) = row.b {
                    velocities[b] = velocities[b].sub(row.n.mul(delta * inv[b]));
                }
            }
            let residual = rows
                .iter()
                .map(|r| {
                    (r.lower
                        - velocities[r.a]
                            .sub(r.b.map_or(Vec2::default(), |b| velocities[b]))
                            .dot(r.n))
                    .max(0.0)
                })
                .fold(0.0, f64::max);
            if previous == rows.len() && residual <= tolerance {
                converged = true;
                break;
            }
        }
        if !converged {
            return Err((
                "RESOURCE_LIMIT",
                "Contact solver did not converge; increase iterations or reduce dt".into(),
            ));
        }
        for v in velocities.iter() {
            if !v.x.is_finite() || !v.y.is_finite() || v.len() > p.maximum_speed.0 * (1.0 + 1e-10) {
                return Err((
                    "RESOURCE_LIMIT",
                    "Contact velocity exceeds configured maximumSpeed".into(),
                ));
            }
        }
        if self.impulses.values().map(Vec::len).sum::<usize>() + 2 * rows.len() > 100000 {
            return Err((
                "RESOURCE_LIMIT",
                "Contact diagnostic budget exceeded".into(),
            ));
        }
        for r in rows.iter().filter(|r| r.impulse > 0.0) {
            self.impulses
                .entry(agents[r.a].id.clone())
                .or_default()
                .push(r.impulse);
            if let Some(b) = r.b {
                self.impulses
                    .entry(agents[b].id.clone())
                    .or_default()
                    .push(r.impulse);
            }
        }
        Ok(())
    }
    pub fn finish(
        &mut self,
        config: &Config,
        agents: &mut [AgentRuntime],
        tick: u64,
        dt: f64,
    ) -> Result<(), Failure> {
        for a in agents {
            if a.departed_at.is_some() {
                a.sensors = None;
                continue;
            }
            let load = self
                .impulses
                .get(&a.id)
                .map_or(0.0, |v| v.iter().sum::<f64>() / dt);
            let ratio = load / config.reference_load.0;
            if !load.is_finite() || !ratio.is_finite() {
                return Err((
                    "RESOURCE_LIMIT",
                    "Contact load exceeds numeric range".into(),
                ));
            }
            a.sensors = Some(json!({"contactLoad":load,"contactLoadRatio":ratio}));
        }
        self.sample_tick = Some(tick);
        self.dt = dt;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::world::World;
    fn world() -> World {
        let v: Value = serde_json::from_str(include_str!(
            "../../contract/fixtures/engine-contact-load.json"
        ))
        .unwrap();
        World::load(
            serde_json::from_value(v["compiled"].clone()).unwrap(),
            &Id("engine-demo".into()),
        )
        .unwrap()
    }
    #[test]
    fn state_and_captured_rules_resume_from_a_saved_tick() {
        let mut a = world();
        a.advance(2).unwrap();
        let mut b: World = serde_json::from_value(serde_json::to_value(&a).unwrap()).unwrap();
        for _ in 0..12 {
            a.advance(1).unwrap();
            b.advance(1).unwrap();
            assert_eq!(
                a.snapshot(&Id("saved".into())),
                b.snapshot(&Id("saved".into()))
            );
        }
    }
    #[test]
    fn high_speed_glancing_contacts_do_not_tunnel_and_impulses_dissipate_energy() {
        let mut w = world();
        w.agents.truncate(2);
        w.agents[0].position = Point {
            x: Number(3.0),
            y: Number(2.0),
        };
        w.agents[1].position = Point {
            x: Number(5.0),
            y: Number(2.6),
        };
        let mut state = State::default();
        let mut p = w.contact_config.as_ref().unwrap().parameters.clone();
        p.maximum_speed = Positive(30.0);
        let mut v = vec![Vec2::new(25.0, 0.0), Vec2::new(-25.0, 0.0)];
        state
            .solve(&w.grid, &w.agents, &mut v, 0.05, &p, &mut 0)
            .unwrap();
        let start = Point {
            x: Number(-2.0),
            y: Number(-0.6),
        };
        let end = Point {
            x: Number(start.x.0 + (v[0].x - v[1].x) * 0.05),
            y: Number(start.y.0 + (v[0].y - v[1].y) * 0.05),
        };
        assert!(geometry::point_segment(0.0, 0.0, &start, &end) >= 1.0 - 1e-10);
        assert!(v.iter().map(|v| v.dot(*v)).sum::<f64>() <= 1250.0 + 1e-8);
        assert!(state.impulses.values().all(|v| v.iter().all(|i| *i > 0.0)));
    }
    #[test]
    fn solver_failure_rolls_back_contacts_sensors_counters_and_clock() {
        let mut w = world();
        w.contact_config.as_mut().unwrap().parameters.iterations = Counter(1.0);
        let before = serde_json::to_value(&w).unwrap();
        assert_eq!(w.advance(1).unwrap_err().0, "RESOURCE_LIMIT");
        assert_eq!(serde_json::to_value(&w).unwrap(), before);
    }
}

#[cfg(test)]
mod near_miss_tests {
    use super::*;
    #[test]
    fn close_pass_without_collision_produces_no_impulses_even_with_large_tolerance() {
        let input: Value = serde_json::from_str(include_str!(
            "../../contract/fixtures/engine-contact-load.json"
        ))
        .unwrap();
        let mut w = crate::world::World::load(
            serde_json::from_value(input["compiled"].clone()).unwrap(),
            &Id("engine-demo".into()),
        )
        .unwrap();
        w.agents.truncate(2);
        w.agents[0].position = Point {
            x: Number(3.0),
            y: Number(2.5),
        };
        w.agents[1].position = Point {
            x: Number(4.0001),
            y: Number(2.5),
        };
        let mut p = w.contact_config.as_ref().unwrap().parameters.clone();
        p.tolerance = Positive(0.001);
        let mut state = State::default();
        let mut velocities = vec![Vec2::new(0.01, 1.0), Vec2::default()];
        state
            .solve(&w.grid, &w.agents, &mut velocities, 0.05, &p, &mut 0)
            .unwrap();
        assert!(state.impulses.is_empty());
        assert_eq!(velocities[0].x, 0.01);
    }
}
