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
    nav: &mut Navigator,
    grid: &GridData,
    agents: &mut [AgentRuntime],
    dt: f64,
    tick: u64,
    metrics: &mut crate::metrics::Metrics,
    contact: Option<(&crate::contact::Config, &mut crate::contact::State)>,
) -> Result<(), Failure> {
    if agents.is_empty() {
        return Ok(());
    }
    let mut active: Vec<bool> = agents
        .iter_mut()
        .enumerate()
        .map(|(i, a)| nav.ready(a, i, dt))
        .collect();
    if contact.is_none() && !active.iter().any(|active| *active) {
        return Ok(());
    }
    let mut max_speed = agents
        .iter()
        .enumerate()
        .filter(|(i, _)| active[*i])
        .map(|(_, a)| navigation::speed(a).max(V::of(&a.velocity).len()))
        .fold(0.0, f64::max);
    if let Some((config, _)) = &contact {
        max_speed = config.parameters.maximum_speed.0;
    }
    let mut contact = contact;
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
    for substep in 0..steps {
        let old: Vec<Motion> = agents
            .iter()
            .map(|a| Motion {
                p: V::of(&a.position),
                v: V::of(&a.velocity),
                radius: a.components.physical.radius.0,
                blocking: a.components.physical.blocks_movement && a.departed_at.is_none(),
            })
            .collect();
        let neighbors = Neighbors::new(&old, bucket_size, grid);
        charge(&mut work, neighbors.heads.len() + agents.len())?;
        let mut physical = if contact.is_some() {
            agents
                .iter()
                .map(|a| {
                    if a.departed_at.is_some()
                        || !a.components.physical.movable
                        || a.components.mobility.speed_multiplier.0 == 0.0
                    {
                        crate::contact::Vec2::default()
                    } else {
                        let v = V::of(&a.velocity);
                        let slowing = v
                            .mul(-1.0)
                            .limit(a.components.navigation.acceleration.0 * h);
                        let v = v.add(slowing);
                        crate::contact::Vec2::new(v.x, v.y)
                    }
                })
                .collect::<Vec<_>>()
        } else {
            vec![]
        };
        let rotation = (tick % agents.len() as u64) as usize;
        let mut order: Vec<_> = (0..agents.len())
            .map(|i| (i + rotation) % agents.len())
            .collect();
        if contact.is_none() {
            let costs: Vec<_> = agents
                .iter()
                .enumerate()
                .map(|(i, a)| nav.progress_cost(grid, a, i))
                .collect();
            // Let the front advance before followers predict their motion; rotate equal-cost ties.
            order.sort_unstable_by(|&a, &b| {
                costs[a].total_cmp(&costs[b]).then_with(|| {
                    ((a + agents.len() - rotation) % agents.len())
                        .cmp(&((b + agents.len() - rotation) % agents.len()))
                })
            });
        }
        for i in order {
            if !active[i] {
                continue;
            }
            let Some((target, remaining)) = nav.waypoint(grid, &mut agents[i], i, &mut work)?
            else {
                active[i] = false;
                continue;
            };
            let target =
                nav.traffic_waypoint(grid, &agents[i], i, &target, remaining, &mut work)?;
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
            let mut slower_ahead = false;
            for &j in &nearby {
                if i == j {
                    continue;
                }
                let other = old[j];
                let offset = other.p.sub(me.p);
                let dist = offset.len();
                let along = offset.dot(direction);
                let across = (offset.x * direction.y - offset.y * direction.x).abs();
                slower_ahead |= along > 0.0
                    && along < desired_speed * 1.2 + me.radius + other.radius
                    && across < me.radius + other.radius
                    && me.v.dot(direction) > other.v.dot(direction) + desired_speed * 0.15;
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
            // Personal-space preferences must not reverse progress along the route.
            let forward = desired.dot(direction);
            if forward < speed * 0.25 {
                desired = desired.add(direction.mul(speed * 0.25 - forward));
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
            if contact.is_some() {
                if agents[i].components.physical.movable
                    && agents[i].components.mobility.speed_multiplier.0 > 0.0
                {
                    let end = me.p.add(v.mul(h));
                    if nav.permits_agent(grid, &me.p.point(), &end.point(), i) {
                        physical[i] = crate::contact::Vec2::new(v.x, v.y)
                    }
                }
                continue;
            }
            let direct =
                me.v.add(direction.mul(speed).sub(me.v).limit(acceleration * h))
                    .limit(hard_max)
                    .limit(d / h)
                    .limit(remaining / h);
            // Fixed samples keep steering identical in native Rust and Wasm.
            let turns = [
                (0.8660254037844386, 0.5),
                (0.8660254037844386, -0.5),
                (0.5, 0.8660254037844386),
                (0.5, -0.8660254037844386),
                (0.0, 1.0),
                (0.0, -1.0),
                (-0.5, 0.8660254037844386),
                (-0.5, -0.8660254037844386),
                (-0.8660254037844386, 0.5),
                (-0.8660254037844386, -0.5),
                (-1.0, 0.0),
            ];
            // Overtaking needs free space; packed crowds retain coordinated separation steering.
            let mut passing_room = nearby
                .iter()
                .filter(|&&j| {
                    j != i
                        && old[j].p.sub(me.p).len()
                            < me.radius + old[j].radius + a.components.navigation.personal_space.0
                })
                .take(3)
                .count()
                < 3;
            let mut passing_velocity = None;
            let mut preferred_velocity = v;
            let mut accepted = V::default();
            let mut best_progress = f64::NEG_INFINITY;
            for sample in 0..17 {
                // Start passing while closing on a slower leader, before hard braking becomes necessary.
                let candidate = if slower_ahead && sample < 2 {
                    1 - sample
                } else {
                    sample
                };
                if candidate == 1 {
                    if !passing_room || slower_ahead {
                        let lateral = 2.0 * me.radius
                            + a.components.navigation.personal_space.0.min(me.radius);
                        let forward = desired_speed * 0.75 + 2.0 * me.radius;
                        for side in [-1.0, 1.0] {
                            let beside = me.p.add(
                                V {
                                    x: -direction.y,
                                    y: direction.x,
                                }
                                .mul(side * lateral),
                            );
                            let ahead = beside.add(direction.mul(forward));
                            let start = me.p.point();
                            let bend = beside.point();
                            let end = ahead.point();
                            if !geometry::clear(grid, &[], &start, &bend, me.radius, &mut work)?
                                || !geometry::clear(grid, &[], &bend, &end, me.radius, &mut work)?
                                || !nav.permits_agent(grid, &start, &bend, i)
                                || !nav.permits_agent(grid, &bend, &end, i)
                            {
                                continue;
                            }
                            let mut open = true;
                            for &j in &nearby {
                                if i == j {
                                    continue;
                                }
                                charge(&mut work, 1)?;
                                let other = old[j];
                                let sum = me.radius + other.radius;
                                if geometry::point_segment(other.p.x, other.p.y, &start, &bend)
                                    < sum - sum * 1e-10
                                    || geometry::point_segment(other.p.x, other.p.y, &bend, &end)
                                        < sum - sum * 1e-10
                                {
                                    open = false;
                                    break;
                                }
                            }
                            if open {
                                passing_room = true;
                                let aim = ahead.sub(me.p).limit(speed);
                                passing_velocity = Some(
                                    me.v.add(aim.sub(me.v).limit(acceleration * h))
                                        .limit(hard_max)
                                        .limit(d / h)
                                        .limit(remaining / h),
                                );
                                break;
                            }
                        }
                    }
                    preferred_velocity = passing_velocity.unwrap_or(v);
                }
                let v = match candidate {
                    0 => direct,
                    1 => passing_velocity.unwrap_or(v),
                    2 if passing_velocity.is_none() => continue,
                    2 => v,
                    3..=13 => {
                        let (cos, sin) = turns[candidate - 3];
                        let detour = V {
                            x: direction.x * cos - direction.y * sin,
                            y: direction.x * sin + direction.y * cos,
                        }
                        .mul(speed);
                        me.v.add(detour.sub(me.v).limit(acceleration * h))
                            .limit(hard_max)
                            .limit(d / h)
                            .limit(remaining / h)
                    }
                    14 => V { x: v.x, y: 0.0 },
                    15 => V { x: 0.0, y: v.y },
                    _ => V::default(),
                };
                let progress =
                    v.dot(direction) + v.len() * 0.05 - v.sub(preferred_velocity).len() * 0.5;
                if progress <= best_progress {
                    continue;
                }
                let end = me.p.add(v.mul(h));
                if !geometry::clear(grid, &[], &me.p.point(), &end.point(), me.radius, &mut work)?
                    || !nav.permits_agent(grid, &me.p.point(), &end.point(), i)
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
                    let offset = old[j].p.sub(me.p);
                    let relative = V::of(&agents[j].velocity).sub(v);
                    let vv = relative.dot(relative);
                    let closest_time = if vv > 0.0 {
                        (-offset.dot(relative) / vv).clamp(0.0, 0.75)
                    } else {
                        0.0
                    };
                    let predicted = offset.add(relative.mul(closest_time)).len();
                    if predicted < sum && predicted < offset.len() - sum * 1e-10 {
                        clear = false;
                        break;
                    }
                    if sum - geometry::point_segment(0.0, 0.0, &start.point(), &finish.point())
                        > sum * 1e-10
                    {
                        clear = false;
                        break;
                    }
                }
                if clear {
                    accepted = v;
                    best_progress = progress;
                    // No sampled velocity can beat full-speed progress straight toward the waypoint.
                    if !passing_room
                        || (candidate == 0 && passing_velocity.is_none())
                        || progress >= speed * 1.05 - 1e-10
                    {
                        break;
                    }
                }
            }
            let a = &mut agents[i];
            a.position = me.p.add(accepted.mul(h)).point();
            if grid.portal_ids.len() > 1 {
                let from = navigation::index(grid, &me.p.point());
                let to = navigation::index(grid, &a.position);
                if from != to {
                    metrics.transition(
                        grid,
                        &a.id,
                        from,
                        to,
                        (tick as f64 + (substep + 1) as f64 / steps as f64) * dt,
                    )?;
                }
            }
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
        if let Some((config, state)) = contact.as_mut() {
            state.solve(
                grid,
                agents,
                &mut physical,
                h,
                &config.parameters,
                &mut work,
            )?;
            for (i, a) in agents
                .iter_mut()
                .enumerate()
                .filter(|(_, a)| a.departed_at.is_none())
            {
                let v = physical[i];
                let from = navigation::index(grid, &a.position);
                a.position.x.0 += v.x * h;
                a.position.y.0 += v.y * h;
                if grid.portal_ids.len() > 1 {
                    let to = navigation::index(grid, &a.position);
                    if from != to {
                        metrics.transition(
                            grid,
                            &a.id,
                            from,
                            to,
                            (tick as f64 + (substep + 1) as f64 / steps as f64) * dt,
                        )?;
                    }
                }
                a.velocity = Point {
                    x: Number(v.x),
                    y: Number(v.y),
                };
                a.zone_id = grid.zone_at(a.position.x.0, a.position.y.0);
                if active[i] {
                    if v.len() <= grid.cell_size * 1e-10 {
                        a.state = "waiting".into();
                        a.state_reason = Some("movement-obstructed".into())
                    } else {
                        a.state = "moving".into();
                        a.state_reason = None;
                    }
                }
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
