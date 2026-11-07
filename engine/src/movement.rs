//! Deterministic local steering with hard swept-disc exclusion; no contact forces.
use crate::{
    core::Failure,
    geometry,
    grid::GridData,
    navigation::{self, Navigator},
    protocol::*,
};

#[derive(Clone, Copy, Default)]
struct V {
    x: f64,
    y: f64,
}
impl V {
    fn of(p: &Point) -> Self {
        Self { x: p.x.0, y: p.y.0 }
    }
    fn point(self) -> Point {
        Point {
            x: Number(self.x),
            y: Number(self.y),
        }
    }
    fn add(self, v: Self) -> Self {
        Self {
            x: self.x + v.x,
            y: self.y + v.y,
        }
    }
    fn sub(self, v: Self) -> Self {
        Self {
            x: self.x - v.x,
            y: self.y - v.y,
        }
    }
    fn mul(self, n: f64) -> Self {
        Self {
            x: self.x * n,
            y: self.y * n,
        }
    }
    fn dot(self, v: Self) -> f64 {
        self.x * v.x + self.y * v.y
    }
    fn len(self) -> f64 {
        geometry::norm(self.x, self.y)
    }
    fn limit(self, n: f64) -> Self {
        let d = self.len();
        if d > n { self.mul(n / d) } else { self }
    }
}
#[derive(Clone, Copy)]
struct Motion {
    p: V,
    v: V,
    radius: f64,
    blocking: bool,
}
struct Neighbors {
    heads: Vec<usize>,
    next: Vec<usize>,
    width: usize,
    height: usize,
    size: f64,
}
impl Neighbors {
    fn new(old: &[Motion], size: f64, grid: &GridData) -> Self {
        let width = ((grid.width as f64 * grid.cell_size / size).ceil() as usize).max(1);
        let height = ((grid.height as f64 * grid.cell_size / size).ceil() as usize).max(1);
        let mut s = Self {
            heads: vec![usize::MAX; width * height],
            next: vec![usize::MAX; old.len()],
            width,
            height,
            size,
        };
        for (i, a) in old.iter().enumerate().rev().filter(|(_, a)| a.blocking) {
            let (x, y) = s.key(a.p);
            let cell = y * s.width + x;
            s.next[i] = s.heads[cell];
            s.heads[cell] = i;
        }
        s
    }
    fn key(&self, p: V) -> (usize, usize) {
        (
            ((p.x / self.size).floor().max(0.0) as usize).min(self.width - 1),
            ((p.y / self.size).floor().max(0.0) as usize).min(self.height - 1),
        )
    }
    fn query(
        &self,
        old: &[Motion],
        p: V,
        r: f64,
        out: &mut Vec<usize>,
        work: &mut usize,
    ) -> Result<(), Failure> {
        out.clear();
        let (x0, y0) = self.key(V {
            x: p.x - r,
            y: p.y - r,
        });
        let (x1, y1) = self.key(V {
            x: p.x + r,
            y: p.y + r,
        });
        charge(work, (x1 - x0 + 1) * (y1 - y0 + 1))?;
        for y in y0..=y1 {
            for x in x0..=x1 {
                let mut i = self.heads[y * self.width + x];
                while i != usize::MAX {
                    charge(work, 1)?;
                    let delta = old[i].p.sub(p);
                    if delta.dot(delta) <= r * r {
                        out.push(i);
                    }
                    i = self.next[i];
                }
            }
        }
        Ok(())
    }
}

pub fn advance(
    nav: &Navigator,
    grid: &GridData,
    agents: &mut [AgentRuntime],
    dt: f64,
    tick: u64,
) -> Result<(), Failure> {
    let mut active: Vec<bool> = agents
        .iter_mut()
        .enumerate()
        .map(|(i, a)| nav.ready(a, i, dt))
        .collect();
    if !active.iter().any(|active| *active) {
        return Ok(());
    }
    let max_speed = agents
        .iter()
        .enumerate()
        .filter(|(i, _)| active[*i])
        .map(|(_, a)| navigation::speed(a).max(V::of(&a.velocity).len()))
        .fold(0.0, f64::max);
    let steps = (max_speed * dt / (grid.cell_size * 0.25)).ceil().max(1.0) as usize;
    if steps > 256 || dt / (steps as f64) == 0.0 {
        return Err((
            "RESOURCE_LIMIT",
            "Movement subdivision budget exceeded".into(),
        ));
    }
    let h = dt / (steps as f64);
    let max_radius = agents
        .iter()
        .map(|a| a.components.physical.radius.0)
        .fold(0.0, f64::max);
    let bucket_size = grid.cell_size.max(2.0 * max_radius + 1.2 * max_speed);
    if !bucket_size.is_finite() {
        return Err(("RESOURCE_LIMIT", "Movement spatial range exceeded".into()));
    }
    let mut work = 0usize;
    let mut nearby = vec![];
    for _ in 0..steps {
        let old: Vec<Motion> = agents
            .iter()
            .map(|a| Motion {
                p: V::of(&a.position),
                v: V::of(&a.velocity),
                radius: a.components.physical.radius.0,
                blocking: a.components.physical.blocks_movement,
            })
            .collect();
        let neighbors = Neighbors::new(&old, bucket_size, grid);
        charge(&mut work, neighbors.heads.len() + agents.len())?;
        for order in 0..agents.len() {
            let i = (order + (tick % agents.len() as u64) as usize) % agents.len();
            if !active[i] {
                continue;
            }
            let Some((target, remaining)) = nav.waypoint(grid, &mut agents[i], i, &mut work)?
            else {
                active[i] = false;
                continue;
            };
            let a = &agents[i];
            let me = old[i];
            let delta = V::of(&target).sub(me.p);
            let d = delta.len();
            let terrain =
                f64::from(grid.terrain_speed_multiplier[navigation::index(grid, &a.position)]);
            let desired_speed = navigation::speed(a) * terrain;
            let acceleration = a.components.navigation.acceleration.0;
            let speed = desired_speed
                .min((2.0 * acceleration * remaining).sqrt())
                .min(d / h);
            let direction = if d > 0.0 {
                delta.mul(1.0 / d)
            } else {
                V::default()
            };
            let mut desired = direction.mul(speed);
            let query = (me.radius + max_radius + desired_speed * 1.2)
                .min(4.0 * bucket_size)
                .max(me.radius + max_radius + 2.0 * max_speed * h);
            if me.blocking {
                neighbors.query(&old, me.p, query, &mut nearby, &mut work)?;
            } else {
                nearby.clear();
            }
            charge(&mut work, nearby.len())?;
            for &j in &nearby {
                if i == j {
                    continue;
                }
                let other = old[j];
                let offset = other.p.sub(me.p);
                let dist = offset.len();
                let personal = a.components.navigation.personal_space.0;
                let gap = dist - me.radius - other.radius;
                let strength = a.components.behavior.avoidance_strength.0;
                if personal > 0.0 && gap < personal && dist > 0.0 {
                    desired = desired.sub(offset.mul(
                        desired_speed * strength * ((personal - gap) / personal).clamp(0.0, 1.0)
                            / dist,
                    ));
                }
                let relative = other.v.sub(direction.mul(desired_speed));
                let vv = relative.dot(relative);
                let t = if vv > 0.0 {
                    -offset.dot(relative) / vv
                } else {
                    -1.0
                };
                let closest = offset.add(relative.mul(t.max(0.0))).len();
                if t >= 0.0
                    && t < 1.2
                    && closest < me.radius + other.radius + personal
                    && offset.dot(direction) > 0.0
                {
                    let right = V {
                        x: -direction.y,
                        y: direction.x,
                    };
                    desired =
                        desired.add(right.mul(desired_speed * strength * (1.0 - t / 1.2) * 1.5));
                }
            }
            if !desired.x.is_finite() || !desired.y.is_finite() {
                return Err(("RESOURCE_LIMIT", "Steering numeric range exceeded".into()));
            }
            desired = desired.limit(speed);
            let hard_max =
                a.components.navigation.maximum_speed.0 * a.components.mobility.speed_multiplier.0;
            let v =
                me.v.add(desired.sub(me.v).limit(acceleration * h))
                    .limit(hard_max)
                    .limit(d / h)
                    .limit(remaining / h);
            if !v.x.is_finite() || !v.y.is_finite() {
                return Err(("RESOURCE_LIMIT", "Velocity numeric range exceeded".into()));
            }
            let candidates = [v, V { x: v.x, y: 0.0 }, V { x: 0.0, y: v.y }, V::default()];
            let mut accepted = V::default();
            for v in candidates {
                let end = me.p.add(v.mul(h));
                if !geometry::clear(grid, &[], &me.p.point(), &end.point(), me.radius, &mut work)?
                    || !nav.permits(grid, &me.p.point(), &end.point())
                {
                    continue;
                }
                let mut clear = true;
                for &j in &nearby {
                    if i == j {
                        continue;
                    }
                    charge(&mut work, 1)?;
                    let start = me.p.sub(old[j].p);
                    let finish = end.sub(V::of(&agents[j].position));
                    let sum = me.radius + old[j].radius;
                    if sum - geometry::point_segment(0.0, 0.0, &start.point(), &finish.point())
                        > sum * 1e-10
                    {
                        clear = false;
                        break;
                    }
                }
                if clear {
                    accepted = v;
                    break;
                }
            }
            let a = &mut agents[i];
            a.position = me.p.add(accepted.mul(h)).point();
            a.velocity = accepted.point();
            a.zone_id = grid.zone_at(a.position.x.0, a.position.y.0);
            if accepted.len() <= grid.cell_size * 1e-10 {
                a.state = "waiting".into();
                a.state_reason = Some(
                    if desired_speed == 0.0 {
                        "zero-desired-speed"
                    } else {
                        "movement-obstructed"
                    }
                    .into(),
                );
            } else {
                a.state = "moving".into();
                a.state_reason = None;
            }
        }
    }
    for (i, a) in agents.iter_mut().enumerate().filter(|(i, _)| active[*i]) {
        nav.waypoint(grid, a, i, &mut work)?;
    }
    Ok(())
}
fn charge(work: &mut usize, n: usize) -> Result<(), Failure> {
    *work = work.saturating_add(n);
    if *work > 64_000_000 {
        Err(("RESOURCE_LIMIT", "Movement work budget exceeded".into()))
    } else {
        Ok(())
    }
}
