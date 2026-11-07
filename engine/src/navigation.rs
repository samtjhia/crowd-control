use crate::{
    core::{Failure, invalid, unsupported},
    geometry::{self, Body, distance},
    grid::GridData,
    protocol::*,
    random,
};
use std::{
    cmp::Ordering,
    collections::{BTreeMap, BTreeSet, BinaryHeap, VecDeque},
};

const NONE: u32 = u32::MAX;
const DIRS: [(isize, isize); 4] = [(0, -1), (1, 0), (0, 1), (-1, 0)];
#[derive(Debug, Clone)]
struct Clearance {
    walk: Vec<bool>,
    edges: Vec<u8>,
}
#[derive(Debug, Clone)]
struct Field {
    id: Id,
    seeds: Vec<usize>,
    distance: Vec<f64>,
    next: Vec<u32>,
    hops: Vec<u32>,
}
#[derive(Debug, Clone)]
struct Route {
    key: (u64, Id),
    blocked: bool,
}
#[derive(Debug, Clone, Default)]
pub struct Navigator {
    pub prepared: bool,
    clearance: BTreeMap<u64, Clearance>,
    fields: BTreeMap<(u64, Id), Field>,
    routes: Vec<Option<Route>>,
    cells: usize,
    work: usize,
    portal_info: Vec<Option<(u32, u32, bool, f64)>>,
}
#[derive(Clone, Copy)]
struct Entry {
    cost: f64,
    cell: usize,
}
impl PartialEq for Entry {
    fn eq(&self, other: &Self) -> bool {
        self.cell == other.cell && self.cost == other.cost
    }
}
impl Eq for Entry {}
impl PartialOrd for Entry {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Entry {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .cost
            .total_cmp(&self.cost)
            .then_with(|| other.cell.cmp(&self.cell))
    }
}

pub fn parse_goal(value: &serde_json::Value) -> Result<ReachGoal, Failure> {
    if value["kind"] != "reach" {
        return Err(unsupported("Only reach goals are enabled in part four"));
    }
    let goal: ReachGoal =
        serde_json::from_value(value.clone()).map_err(|e| invalid(e.to_string()))?;
    if usize::from(goal.target_zone.is_some())
        + usize::from(goal.target_entity_id.is_some())
        + usize::from(goal.target_ids.is_some())
        != 1
    {
        return Err(invalid("Reach needs exactly one destination form"));
    }
    if goal
        .target_ids
        .as_ref()
        .is_some_and(|v| v.is_empty() || v.len() > 64)
    {
        return Err(("RESOURCE_LIMIT", "Reach requires 1–64 candidate IDs".into()));
    }
    Ok(goal)
}
pub fn candidates(goal: &ReachGoal) -> Vec<Id> {
    goal.target_ids
        .clone()
        .unwrap_or_else(|| {
            vec![
                goal.target_zone
                    .as_ref()
                    .or(goal.target_entity_id.as_ref())
                    .unwrap()
                    .clone(),
            ]
        })
        .into_iter()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}
pub fn validate_goal(goal: &ReachGoal, grid: &GridData, agents: &[Agent]) -> Result<(), Failure> {
    for id in candidates(goal) {
        if goal.target_zone.is_some() && !grid.zone_ids.contains(&Some(id.clone())) {
            return Err(("NOT_FOUND", format!("Unknown target zone {}", id.0)));
        }
        if !grid.zone_ids.contains(&Some(id.clone()))
            && !grid.portal_ids.contains(&Some(id.clone()))
        {
            if agents.iter().any(|a| a.id == id) {
                return Err(unsupported(
                    "Moving-agent reach targets require the later goal system",
                ));
            }
            return Err(("NOT_FOUND", format!("Unknown target {}", id.0)));
        }
    }
    Ok(())
}
pub fn speed(agent: &AgentRuntime) -> f64 {
    let goal = &agent.current_goal.as_ref().unwrap().spec;
    (agent.components.navigation.preferred_speed.0 * (1.0 + goal.urgency.map_or(0.0, |u| u.0)))
        .min(agent.components.navigation.maximum_speed.0)
        * agent.components.mobility.speed_multiplier.0
}
fn center(grid: &GridData, i: usize) -> Point {
    Point {
        x: Number((i % grid.width) as f64 * grid.cell_size + grid.cell_size / 2.0),
        y: Number((i / grid.width) as f64 * grid.cell_size + grid.cell_size / 2.0),
    }
}
pub fn index(grid: &GridData, p: &Point) -> usize {
    (p.y.0 / grid.cell_size).floor() as usize * grid.width
        + (p.x.0 / grid.cell_size).floor() as usize
}
fn neighbour(grid: &GridData, i: usize, dir: usize) -> Option<usize> {
    let (dx, dy) = DIRS[dir];
    let x = (i % grid.width).checked_add_signed(dx)?;
    let y = (i / grid.width).checked_add_signed(dy)?;
    (x < grid.width && y < grid.height).then_some(y * grid.width + x)
}
fn portals(grid: &GridData, map: &Map) -> Vec<Option<(u32, u32, bool, f64)>> {
    let zone_indices: BTreeMap<&Id, u32> = grid
        .zone_ids
        .iter()
        .enumerate()
        .filter_map(|(i, v)| v.as_ref().map(|id| (id, i as u32)))
        .collect();
    let by_id: BTreeMap<&Id, &Portal> = map.portals.iter().map(|p| (&p.id, p)).collect();
    grid.portal_ids
        .iter()
        .map(|id| {
            id.as_ref().map(|id| {
                let p = by_id[id];
                (
                    zone_indices[&p.connects[0]],
                    zone_indices[&p.connects[1]],
                    p.one_way.unwrap_or(false),
                    p.traversal_time.map_or(0.0, |t| t.0),
                )
            })
        })
        .collect()
}
fn allowed(
    grid: &GridData,
    p: &[Option<(u32, u32, bool, f64)>],
    from: usize,
    to: usize,
) -> Result<bool, Failure> {
    let a = grid.portal_index[from];
    let b = grid.portal_index[to];
    if a == b {
        return Ok(true);
    }
    if a != 0 && b != 0 {
        return Err(unsupported(
            "Distinct portal regions need an intervening zoned floor",
        ));
    }
    let portal = p[if a != 0 { a } else { b } as usize].unwrap();
    let zone = grid.zone_index[if a == 0 { from } else { to }];
    if zone != portal.0 && zone != portal.1 {
        return Err(unsupported(
            "Portal entry/exit needs its declared adjacent zone membership",
        ));
    }
    Ok(!portal.2
        || if a == 0 {
            zone == portal.0
        } else {
            zone == portal.1
        })
}

impl Navigator {
    fn reserve(&mut self, size: usize) -> Result<(), Failure> {
        if self.cells.saturating_add(size) > 4_000_000 {
            return Err((
                "RESOURCE_LIMIT",
                "Navigation cache cell budget exceeded".into(),
            ));
        }
        self.cells += size;
        Ok(())
    }
    fn clearance(
        &mut self,
        grid: &GridData,
        map: &Map,
        bodies: &[Body],
        radius: f64,
    ) -> Result<(), Failure> {
        let key = radius.to_bits();
        if self.clearance.contains_key(&key) {
            return Ok(());
        }
        self.reserve(grid.blocked.len())?;
        let mut c = Clearance {
            walk: vec![false; grid.blocked.len()],
            edges: vec![0; grid.blocked.len()],
        };
        for i in 0..c.walk.len() {
            if grid.blocked[i] == 0 {
                let p = center(grid, i);
                c.walk[i] = geometry::clear(grid, bodies, &p, &p, radius, &mut self.work)?;
            }
        }
        let portal_info = portals(grid, map);
        for i in 0..c.walk.len() {
            if !c.walk[i] {
                continue;
            }
            for dir in 0..4 {
                if let Some(j) = neighbour(grid, i, dir) {
                    if c.walk[j]
                        && allowed(grid, &portal_info, i, j)?
                        && geometry::clear(
                            grid,
                            bodies,
                            &center(grid, i),
                            &center(grid, j),
                            radius,
                            &mut self.work,
                        )?
                    {
                        c.edges[i] |= 1 << dir;
                    }
                }
            }
        }
        self.clearance.insert(key, c);
        Ok(())
    }
    fn field(
        &mut self,
        grid: &GridData,
        radius: f64,
        target: &Id,
        version: u64,
    ) -> Result<(), Failure> {
        let key = (radius.to_bits(), target.clone());
        if self.fields.contains_key(&key) {
            return Ok(());
        }
        self.reserve(grid.blocked.len())?;
        let clear = &self.clearance[&key.0];
        let hash = target.0.bytes().fold(0xcbf29ce484222325u64, |h, b| {
            (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
        });
        let id = Id(format!("flow-{version}-{:016x}-{hash:016x}", key.0));
        if self.fields.values().any(|f| f.id == id) {
            return Err(("RESOURCE_LIMIT", "Flow identifier collision".into()));
        }
        let mut f = Field {
            id,
            seeds: vec![],
            distance: vec![f64::INFINITY; grid.blocked.len()],
            next: vec![NONE; grid.blocked.len()],
            hops: vec![0; grid.blocked.len()],
        };
        let zone = grid
            .zone_ids
            .iter()
            .position(|id| id.as_ref() == Some(target));
        let portal = grid
            .portal_ids
            .iter()
            .position(|id| id.as_ref() == Some(target));
        let seeds: Vec<usize> = (0..f.next.len())
            .filter(|i| {
                clear.walk[*i]
                    && (zone.is_some_and(|z| grid.zone_index[*i] as usize == z)
                        || portal.is_some_and(|p| grid.portal_index[*i] as usize == p))
            })
            .collect();
        for i in &seeds {
            f.distance[*i] = 0.0;
            f.next[*i] = *i as u32;
        }
        f.seeds = seeds.clone();
        let uniform = grid
            .traversal_cost
            .iter()
            .enumerate()
            .filter(|(i, _)| clear.walk[*i])
            .map(|(_, v)| *v)
            .try_fold(None, |last: Option<f32>, v| {
                if last.is_none_or(|old| old == v) {
                    Ok(Some(v))
                } else {
                    Err(())
                }
            })
            .is_ok();
        let edge_cost = |from: usize, to: usize| {
            grid.cell_size
                * (f64::from(grid.traversal_cost[from]) + f64::from(grid.traversal_cost[to]))
                / 2.0
        };
        if uniform {
            let mut queue: VecDeque<usize> = seeds.into();
            while let Some(to) = queue.pop_front() {
                for dir in 0..4 {
                    if let Some(from) = neighbour(grid, to, dir) {
                        let reverse = (dir + 2) % 4;
                        if clear.edges[from] & (1 << reverse) == 0 || f.next[from] != NONE {
                            continue;
                        }
                        let cost = edge_cost(from, to);
                        let distance = f.distance[to] + cost;
                        if cost <= 0.0 || !distance.is_finite() {
                            return Err((
                                "RESOURCE_LIMIT",
                                "Navigation cost exceeds numeric range".into(),
                            ));
                        }
                        f.distance[from] = distance;
                        f.next[from] = to as u32;
                        f.hops[from] = f.hops[to] + 1;
                        queue.push_back(from);
                    }
                }
            }
        } else {
            let mut heap: BinaryHeap<Entry> = seeds
                .into_iter()
                .map(|cell| Entry { cost: 0.0, cell })
                .collect();
            while let Some(Entry { cost, cell: to }) = heap.pop() {
                if cost != f.distance[to] {
                    continue;
                }
                for dir in 0..4 {
                    if let Some(from) = neighbour(grid, to, dir) {
                        if clear.edges[from] & (1 << ((dir + 2) % 4)) == 0 {
                            continue;
                        }
                        let edge = edge_cost(from, to);
                        let candidate = cost + edge;
                        if edge <= 0.0 || !candidate.is_finite() {
                            return Err((
                                "RESOURCE_LIMIT",
                                "Navigation cost exceeds numeric range".into(),
                            ));
                        }
                        if candidate < f.distance[from] {
                            f.distance[from] = candidate;
                            f.next[from] = to as u32;
                            f.hops[from] = f.hops[to] + 1;
                            heap.push(Entry {
                                cost: candidate,
                                cell: from,
                            });
                        }
                    }
                }
            }
        }
        self.fields.insert(key, f);
        Ok(())
    }
    pub fn prepare(
        &mut self,
        grid: &GridData,
        map: &Map,
        agents: &mut [AgentRuntime],
        version: u64,
        dt: f64,
    ) -> Result<(), Failure> {
        self.portal_info = portals(grid, map);
        let bodies: Vec<Body> = agents
            .iter()
            .filter(|a| {
                a.components.physical.blocks_movement
                    && (a.components.mobility.speed_multiplier.0 == 0.0
                        || !a.components.physical.movable)
            })
            .map(|a| Body {
                x: a.position.x.0,
                y: a.position.y.0,
                radius: a.components.physical.radius.0,
            })
            .collect();
        self.routes = vec![None; agents.len()];
        for (i, a) in agents.iter_mut().enumerate() {
            let old_version = a.navigation.map_version.0 as u64;
            a.navigation.map_version = Counter(version as f64);
            let Some(goal) = a.current_goal.as_ref() else {
                continue;
            };
            if goal.status == "completed" || goal.status == "failed" {
                continue;
            }
            if a.components.mobility.speed_multiplier.0 == 0.0 {
                a.state = "immobile".into();
                a.current_goal.as_mut().unwrap().status = "suspended".into();
                continue;
            }
            if !a.components.physical.movable {
                a.state = "blocked".into();
                a.state_reason = Some("body-not-movable".into());
                continue;
            }
            let travel = speed(a) * dt;
            if !travel.is_finite() || (travel / grid.cell_size).ceil() * 4.0 + 8.0 > 256.0 {
                return Err((
                    "RESOURCE_LIMIT",
                    "Movement travel per tick exceeds the subdivision budget".into(),
                ));
            }
            let radius = a.components.physical.radius.0;
            self.clearance(grid, map, &bodies, radius)?;
            let ids = candidates(&a.current_goal.as_ref().unwrap().spec);
            let retained = a
                .navigation
                .target_entity_id
                .as_ref()
                .filter(|id| ids.contains(id))
                .cloned();
            let chosen = if let Some(id) = retained {
                self.field(grid, radius, &id, version)?;
                id
            } else {
                for id in &ids {
                    self.field(grid, radius, id, version)?;
                }
                let selection = a
                    .current_goal
                    .as_ref()
                    .unwrap()
                    .spec
                    .selection
                    .unwrap_or_default();
                match selection {
                    Selection::Random if ids.len() > 1 => {
                        ids[(u64::from(random::next(&mut a.random_state)) * ids.len() as u64
                            / 4_294_967_296) as usize]
                            .clone()
                    }
                    Selection::Nearest => {
                        let mut best = (f64::INFINITY, ids[0].clone());
                        for id in &ids {
                            let field = &self.fields[&(radius.to_bits(), id.clone())];
                            self.work = self.work.saturating_add(field.seeds.len());
                            if self.work > 64_000_000 {
                                return Err((
                                    "RESOURCE_LIMIT",
                                    "Destination selection exceeds navigation work budget".into(),
                                ));
                            }
                            let d = field
                                .seeds
                                .iter()
                                .map(|i| distance(&a.position, &center(grid, *i)))
                                .fold(f64::INFINITY, f64::min);
                            if d < best.0 {
                                best = (d, id.clone());
                            }
                        }
                        best.1
                    }
                    _ => ids
                        .iter()
                        .min_by(|x, y| {
                            self.fields[&(radius.to_bits(), (*x).clone())].distance
                                [index(grid, &a.position)]
                            .total_cmp(
                                &self.fields[&(radius.to_bits(), (*y).clone())].distance
                                    [index(grid, &a.position)],
                            )
                            .then_with(|| x.cmp(y))
                        })
                        .unwrap()
                        .clone(),
                }
            };
            let key = (radius.to_bits(), chosen.clone());
            let field = &self.fields[&key];
            let cell = index(grid, &a.position);
            let mut blocked = !field.distance[cell].is_finite();
            if !blocked {
                let saved = a.navigation.target_point.as_ref();
                let keep = if let Some(p) = saved {
                    let to = index(grid, p);
                    let on_route =
                        old_version == version || to == cell || field.next[cell] == to as u32;
                    on_route
                        && self.clearance[&radius.to_bits()].walk[to]
                        && geometry::clear(grid, &bodies, &a.position, p, radius, &mut self.work)?
                        && geometry::clear(
                            grid,
                            &bodies,
                            p,
                            &center(grid, to),
                            radius,
                            &mut self.work,
                        )?
                } else {
                    false
                };
                if !keep {
                    a.navigation.target_point = None;
                    a.timers.wait_remaining = Nonnegative(0.0);
                    let goal_center = center(grid, cell);
                    let epsilon = grid.cell_size * 1e-9;
                    if distance(&a.position, &goal_center) > epsilon {
                        let options = [
                            goal_center.clone(),
                            Point {
                                x: goal_center.x,
                                y: a.position.y,
                            },
                            Point {
                                x: a.position.x,
                                y: goal_center.y,
                            },
                        ];
                        let mut approach = None;
                        for p in options {
                            if distance(&a.position, &p) > epsilon
                                && geometry::clear(
                                    grid,
                                    &bodies,
                                    &a.position,
                                    &p,
                                    radius,
                                    &mut self.work,
                                )?
                                && geometry::clear(
                                    grid,
                                    &bodies,
                                    &p,
                                    &goal_center,
                                    radius,
                                    &mut self.work,
                                )?
                            {
                                approach = Some(p);
                                break;
                            }
                        }
                        blocked = approach.is_none();
                        a.navigation.target_point = approach;
                    }
                }
            }
            a.navigation.target_entity_id = Some(chosen);
            a.navigation.flow_field_id = Some(field.id.clone());
            a.current_goal.as_mut().unwrap().status = "active".into();
            a.state = if a.timers.reaction_remaining.0 > 0.0 {
                "reacting"
            } else if blocked {
                "blocked"
            } else {
                "moving"
            }
            .into();
            a.state_reason = blocked.then(|| "unreachable-at-current-topology".into());
            if blocked {
                a.velocity = Point {
                    x: Number(0.0),
                    y: Number(0.0),
                };
            }
            self.routes[i] = Some(Route { key, blocked });
        }
        self.prepared = true;
        Ok(())
    }
    pub fn step(
        &self,
        grid: &GridData,
        agents: &mut [AgentRuntime],
        dt: f64,
        tick: u64,
    ) -> Result<(), Failure> {
        crate::movement::advance(self, grid, agents, dt, tick)
    }
    pub fn ready(&self, a: &mut AgentRuntime, i: usize, dt: f64) -> bool {
        if a.components.mobility.speed_multiplier.0 == 0.0 {
            a.state = "immobile".into();
            a.velocity = Point {
                x: Number(0.0),
                y: Number(0.0),
            };
            return false;
        }
        let Some(route) = &self.routes[i] else {
            return false;
        };
        if a.current_goal
            .as_ref()
            .is_none_or(|g| g.status == "completed" || g.status == "failed")
        {
            return false;
        }
        let state = if a.timers.reaction_remaining.0 > 0.0 {
            a.timers.reaction_remaining.0 = countdown(a.timers.reaction_remaining.0, dt);
            Some("reacting")
        } else if route.blocked {
            Some("blocked")
        } else if a.timers.wait_remaining.0 > 0.0 {
            a.timers.wait_remaining.0 = countdown(a.timers.wait_remaining.0, dt);
            Some("waiting")
        } else {
            None
        };
        if let Some(state) = state {
            a.state = state.into();
            a.velocity = Point {
                x: Number(0.0),
                y: Number(0.0),
            };
            false
        } else {
            a.state = "moving".into();
            a.state_reason = None;
            true
        }
    }
    pub fn waypoint(
        &self,
        grid: &GridData,
        a: &mut AgentRuntime,
        i: usize,
        work: &mut usize,
    ) -> Result<Option<(Point, f64)>, Failure> {
        let Some(route) = self.routes[i].as_ref() else {
            return Ok(None);
        };
        let field = &self.fields[&route.key];
        let epsilon = grid.cell_size * 1e-7;
        let cell = index(grid, &a.position);
        if let Some(target) = a.navigation.target_point.as_ref() {
            let to = index(grid, target);
            let next = field.next[cell];
            if next == cell as u32 && to != cell {
                a.navigation.target_point = Some(center(grid, cell));
            } else if to == cell && next != NONE && next != cell as u32 {
                let p = grid.portal_index[next as usize];
                let delayed = p != 0
                    && p != grid.portal_index[cell]
                    && self.portal_info[p as usize].unwrap().3 > 0.0;
                let next_point = center(grid, next as usize);
                // Follow the field through a cell without forcing crossing streams onto its center.
                if !delayed
                    && geometry::clear(
                        grid,
                        &[],
                        &a.position,
                        &next_point,
                        a.components.physical.radius.0,
                        work,
                    )?
                    && self.permits(grid, &a.position, &next_point)
                {
                    a.navigation.target_point = Some(next_point);
                }
            }
        }
        if a.navigation
            .target_point
            .as_ref()
            .is_some_and(|p| distance(&a.position, p) <= epsilon)
        {
            a.navigation.target_point = None;
        }
        if a.navigation.target_point.is_none() {
            let current = center(grid, cell);
            if distance(&a.position, &current) > epsilon {
                a.navigation.target_point = Some(current);
            } else {
                let next = field.next[cell];
                if next == NONE {
                    a.state = "blocked".into();
                    a.state_reason = Some("unreachable-at-current-topology".into());
                    a.velocity = Point {
                        x: Number(0.0),
                        y: Number(0.0),
                    };
                    return Ok(None);
                }
                if next == cell as u32 {
                    complete(a);
                    return Ok(None);
                }
                a.navigation.target_point = Some(center(grid, next as usize));
                let portal = grid.portal_index[next as usize];
                if portal != 0 && portal != grid.portal_index[cell] {
                    let wait = self.portal_info[portal as usize].unwrap().3;
                    if wait > 0.0 {
                        a.timers.wait_remaining = Nonnegative(wait);
                        a.state = "waiting".into();
                        a.velocity = Point {
                            x: Number(0.0),
                            y: Number(0.0),
                        };
                        return Ok(None);
                    }
                }
            }
        }
        let target = a.navigation.target_point.as_ref().unwrap();
        let to = index(grid, target);
        let remaining = distance(&a.position, target)
            + distance(target, &center(grid, to))
            + f64::from(field.hops[to]) * grid.cell_size;
        let stop = a
            .current_goal
            .as_ref()
            .unwrap()
            .spec
            .stop_distance
            .map_or(0.0, |d| d.0);
        if remaining <= stop + epsilon {
            complete(a);
            return Ok(None);
        }
        Ok(Some((target.clone(), remaining - stop)))
    }
    pub fn permits(&self, grid: &GridData, from: &Point, to: &Point) -> bool {
        allowed(grid, &self.portal_info, index(grid, from), index(grid, to)).unwrap_or(false)
    }
    #[cfg(test)]
    pub fn field_count(&self) -> usize {
        self.fields.len()
    }
}
fn complete(a: &mut AgentRuntime) {
    a.current_goal.as_mut().unwrap().status = "completed".into();
    a.state = "idle".into();
    a.state_reason = None;
    a.navigation.target_point = None;
    a.navigation.flow_field_id = None;
    a.velocity = Point {
        x: Number(0.0),
        y: Number(0.0),
    };
}
fn countdown(remaining: f64, dt: f64) -> f64 {
    if remaining <= dt * (1.0 + 1e-9) {
        0.0
    } else {
        remaining - dt
    }
}
