use crate::{
    core::{Failure, unsupported},
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
    key: Option<(u64, Id)>,
    direct: Option<Point>,
    stop: f64,
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
    intents: Vec<Option<Intent>>,
    bodies: Vec<Body>,
    visible: Vec<Option<(Point, Point)>>,
}
#[derive(Debug, Clone)]
pub struct Intent {
    pub goal: GoalSpec,
    pub point: Option<Point>,
    pub local: bool,
}
fn field_targets(g: &GoalSpec) -> Vec<Id> {
    let ids = candidates(g);
    if matches!(g.kind, GoalKind::Avoid) {
        ids.into_iter().take(1).collect()
    } else {
        ids
    }
}
fn cache_key(intent: &Intent, target: &Id, grid: &GridData, positions: &BTreeMap<Id, Point>) -> Id {
    if intent.point.is_none()
        && !positions.contains_key(target)
        && matches!(
            intent.goal.kind,
            GoalKind::Reach | GoalKind::Wait | GoalKind::Wander
        )
    {
        return target.clone();
    }
    let moving: Vec<_> = candidates(&intent.goal)
        .iter()
        .filter_map(|id| positions.get(id).map(|p| (id.clone(), index(grid, p))))
        .collect();
    Id(crate::world::fingerprint(&serde_json::json!([
        target,
        candidates(&intent.goal),
        intent.point.as_ref().map(|p| index(grid, p)),
        intent.goal.kind,
        intent.goal.distance,
        moving
    ])))
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

pub fn candidates(goal: &GoalSpec) -> Vec<Id> {
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
pub fn speed(agent: &AgentRuntime) -> f64 {
    let goal = crate::goals::leaf(agent).unwrap();
    (agent.components.navigation.preferred_speed.0 * (1.0 + goal.urgency.map_or(0.0, |u| u.0)))
        .min(agent.components.navigation.maximum_speed.0)
        * agent.components.mobility.speed_multiplier.0
}
pub fn center(grid: &GridData, i: usize) -> Point {
    Point {
        x: Number((i % grid.width) as f64 * grid.cell_size + grid.cell_size / 2.0),
        y: Number((i / grid.width) as f64 * grid.cell_size + grid.cell_size / 2.0),
    }
}
pub fn line_in_zone(grid: &GridData, from: &Point, to: &Point, zone: usize) -> bool {
    let mut x = (from.x.0 / grid.cell_size).floor() as isize;
    let mut y = (from.y.0 / grid.cell_size).floor() as isize;
    let ex = (to.x.0 / grid.cell_size).floor() as isize;
    let ey = (to.y.0 / grid.cell_size).floor() as isize;
    let dx = to.x.0 - from.x.0;
    let dy = to.y.0 - from.y.0;
    let sx = dx.signum() as isize;
    let sy = dy.signum() as isize;
    let mut tx = if dx == 0.0 {
        f64::INFINITY
    } else {
        ((x + isize::from(sx > 0)) as f64 * grid.cell_size - from.x.0) / dx
    };
    let mut ty = if dy == 0.0 {
        f64::INFINITY
    } else {
        ((y + isize::from(sy > 0)) as f64 * grid.cell_size - from.y.0) / dy
    };
    let valid = |x: isize, y: isize| {
        x >= 0
            && y >= 0
            && (x as usize) < grid.width
            && (y as usize) < grid.height
            && grid.zone_index[y as usize * grid.width + x as usize] as usize == zone
    };
    for _ in 0..grid.width + grid.height + 2 {
        if !valid(x, y) {
            return false;
        }
        if x == ex && y == ey {
            return true;
        }
        if tx < ty {
            x += sx;
            tx += grid.cell_size / dx.abs();
        } else if ty < tx {
            y += sy;
            ty += grid.cell_size / dy.abs();
        } else {
            if !valid(x + sx, y) || !valid(x, y + sy) {
                return false;
            }
            x += sx;
            y += sy;
            tx += grid.cell_size / dx.abs();
            ty += grid.cell_size / dy.abs();
        }
    }
    false
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
fn target_distances(
    grid: &GridData,
    map: &Map,
    positions: &BTreeMap<Id, Point>,
    id: &Id,
) -> Vec<f64> {
    if let Some(p) = positions.get(id) {
        return (0..grid.blocked.len())
            .map(|i| distance(&center(grid, i), p))
            .collect();
    }
    if let Some(e) = map.entities().iter().find(|e| &e.id == id) {
        if e.shape.is_some() {
            return (0..grid.blocked.len())
                .map(|i| crate::shapes::distance(e, &center(grid, i)))
                .collect();
        }
    }
    let z = grid.zone_ids.iter().position(|v| v.as_ref() == Some(id));
    let p = grid.portal_ids.iter().position(|v| v.as_ref() == Some(id));
    let mut d = vec![f64::INFINITY; grid.blocked.len()];
    let mut queue = VecDeque::new();
    for i in 0..d.len() {
        if z.is_some_and(|z| grid.zone_index[i] as usize == z)
            || p.is_some_and(|p| grid.portal_index[i] as usize == p)
        {
            d[i] = 0.0;
            queue.push_back(i);
        }
    }
    while let Some(i) = queue.pop_front() {
        let x = i % grid.width;
        let y = i / grid.width;
        for dy in -1isize..=1 {
            for dx in -1isize..=1 {
                if let (Some(nx), Some(ny)) = (x.checked_add_signed(dx), y.checked_add_signed(dy)) {
                    if nx < grid.width && ny < grid.height {
                        let j = ny * grid.width + nx;
                        if !d[j].is_finite() {
                            d[j] = d[i] + grid.cell_size;
                            queue.push_back(j);
                        }
                    }
                }
            }
        }
    }
    d
}
fn portals(grid: &GridData, map: &Map) -> Vec<Option<(u32, u32, bool, f64)>> {
    let zone_indices: BTreeMap<&Id, u32> = grid
        .zone_ids
        .iter()
        .enumerate()
        .filter_map(|(i, v)| v.as_ref().map(|id| (id, i as u32)))
        .collect();
    let all = map.all_portals().unwrap();
    let by_id: BTreeMap<&Id, &Portal> = all.iter().map(|p| (&p.id, p)).collect();
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

// Continuous positions at wall tangencies can lie in a cell whose centre lacks clearance.
fn entry(
    grid: &GridData,
    field: &Field,
    p: &Point,
    radius: f64,
    bodies: &[Body],
    portals: &[Option<(u32, u32, bool, f64)>],
    work: &mut usize,
) -> Result<Option<usize>, Failure> {
    let cell = index(grid, p);
    let x = cell % grid.width;
    let y = cell / grid.width;
    let mut best: Option<(f64, usize)> = None;
    for cy in y.saturating_sub(1)..=(y + 1).min(grid.height - 1) {
        for cx in x.saturating_sub(1)..=(x + 1).min(grid.width - 1) {
            let i = cy * grid.width + cx;
            if field.distance[i].is_finite()
                && allowed(grid, portals, cell, i).unwrap_or(false)
                && geometry::clear(grid, bodies, p, &center(grid, i), radius, work)?
            {
                let cost = distance(p, &center(grid, i)) + field.distance[i];
                if best.is_none_or(|b| cost < b.0) {
                    best = Some((cost, i));
                }
            }
        }
    }
    Ok(best.map(|b| b.1))
}

fn same_terrain(
    grid: &GridData,
    from: usize,
    to: usize,
    work: &mut usize,
) -> Result<bool, Failure> {
    let x = from % grid.width;
    let y = from / grid.width;
    let nx = to % grid.width;
    let ny = to / grid.width;
    let same = (y.min(ny)..=y.max(ny)).all(|cy| {
        (x.min(nx)..=x.max(nx)).all(|cx| {
            *work += 1;
            let i = cy * grid.width + cx;
            grid.traversal_cost[i] == grid.traversal_cost[from]
                && grid.terrain_speed_multiplier[i] == grid.terrain_speed_multiplier[from]
        })
    });
    if *work > 64_000_000 {
        return Err((
            "RESOURCE_LIMIT",
            "Navigation lookahead work budget exceeded".into(),
        ));
    }
    Ok(same)
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
        intent: &Intent,
        actual: &Id,
        map: &Map,
        positions: &BTreeMap<Id, Point>,
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
        let distances = target_distances(grid, map, positions, actual);
        let hazards: Vec<_> = if matches!(intent.goal.kind, GoalKind::Avoid) {
            candidates(&intent.goal)
                .iter()
                .map(|id| target_distances(grid, map, positions, id))
                .collect()
        } else {
            vec![]
        };
        self.work = self
            .work
            .saturating_add(grid.blocked.len().saturating_mul(1 + hazards.len()));
        if self.work > 64_000_000 {
            return Err((
                "RESOURCE_LIMIT",
                "Navigation target work budget exceeded".into(),
            ));
        }
        let zone = grid
            .zone_ids
            .iter()
            .position(|id| id.as_ref() == Some(actual));
        let portal = grid
            .portal_ids
            .iter()
            .position(|id| id.as_ref() == Some(actual));
        let upstream = if matches!(intent.goal.kind, GoalKind::Queue) {
            map.all_portals()?
                .iter()
                .find(|p| &p.id == actual && p.one_way == Some(true))
                .and_then(|p| {
                    grid.zone_ids
                        .iter()
                        .position(|z| z.as_ref() == Some(&p.connects[0]))
                })
        } else {
            None
        };
        let mut visible = None;
        if matches!(intent.goal.kind, GoalKind::Queue | GoalKind::Interact)
            || (!matches!(intent.goal.kind, GoalKind::Avoid)
                && zone.is_none()
                && portal.is_none()
                && intent.point.is_none()
                && !positions.contains_key(actual))
        {
            let mut cells = vec![false; grid.blocked.len()];
            for i in 0..cells.len() {
                if clear.walk[i] && distances[i] <= grid.cell_size * 1.5 + radius {
                    cells[i] = crate::shapes::approachable(
                        grid,
                        map,
                        actual,
                        &center(grid, i),
                        radius,
                        &mut self.work,
                    )?;
                }
            }
            visible = Some(cells);
        }
        let seeds: Vec<usize> = (0..f.next.len())
            .filter(|i| {
                if !clear.walk[*i] {
                    return false;
                }
                if !hazards.is_empty() {
                    return hazards
                        .iter()
                        .all(|d| d[*i] + 1e-9 >= intent.goal.distance.unwrap().0);
                }
                if let Some(point) = &intent.point {
                    let range = if matches!(intent.goal.kind, GoalKind::Follow) {
                        (intent.goal.distance.unwrap().0
                            - grid.cell_size * std::f64::consts::FRAC_1_SQRT_2)
                            .max(0.0)
                    } else {
                        0.0
                    };
                    return geometry::distance(&center(grid, *i), point)
                        <= range.max(grid.cell_size * 1e-7);
                }
                if matches!(intent.goal.kind, GoalKind::Queue) {
                    return visible.as_ref().unwrap()[*i]
                        && upstream.is_none_or(|z| grid.zone_index[*i] as usize == z)
                        && !zone.is_some_and(|z| grid.zone_index[*i] as usize == z)
                        && !portal.is_some_and(|z| grid.portal_index[*i] as usize == z);
                }
                if let Some(z) = zone {
                    return grid.zone_index[*i] as usize == z;
                }
                if let Some(p) = portal {
                    return grid.portal_index[*i] as usize == p;
                }
                visible.as_ref().is_some_and(|v| v[*i])
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
        intents: Vec<Option<Intent>>,
    ) -> Result<(), Failure> {
        let positions: BTreeMap<Id, Point> = agents
            .iter()
            .filter(|a| a.departed_at.is_none())
            .map(|a| (a.id.clone(), a.position.clone()))
            .collect();
        let mut live = BTreeSet::new();
        for (a, intent) in agents.iter().zip(&intents) {
            if let Some(intent) = intent {
                if !intent.local {
                    for id in field_targets(&intent.goal) {
                        live.insert((
                            a.components.physical.radius.0.to_bits(),
                            cache_key(intent, &id, grid, &positions),
                        ));
                    }
                }
            }
        }
        self.fields.retain(|key, _| live.contains(key));
        self.cells =
            self.fields.len() * grid.blocked.len() + self.clearance.len() * grid.blocked.len();
        self.work = 0;
        self.intents = intents;
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
        self.bodies = bodies.clone();
        self.routes = vec![None; agents.len()];
        self.visible = vec![None; agents.len()];
        for (i, a) in agents.iter_mut().enumerate() {
            let old_version = a.navigation.map_version.0 as u64;
            a.navigation.map_version = Counter(version as f64);
            if a.departed_at.is_some() {
                continue;
            }
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
            let Some(intent) = self.intents[i].clone() else {
                continue;
            };
            a.current_goal
                .as_mut()
                .unwrap()
                .execution
                .as_mut()
                .unwrap()
                .phase = "travel".into();
            let radius = a.components.physical.radius.0;
            if intent.local {
                a.navigation.target_point = intent.point.clone();
                a.navigation.flow_field_id = None;
                a.state = "moving".into();
                self.routes[i] = Some(Route {
                    key: None,
                    direct: intent.point.clone(),
                    stop: intent.goal.stop_distance.map_or(0.0, |d| d.0),
                    blocked: false,
                });
                continue;
            }
            self.clearance(grid, map, &bodies, radius)?;
            let ids = field_targets(&intent.goal);
            let retained = a
                .navigation
                .target_entity_id
                .as_ref()
                .filter(|id| ids.contains(id))
                .cloned();
            let chosen = if let Some(id) = retained {
                self.field(
                    grid,
                    radius,
                    &cache_key(&intent, &id, grid, &positions),
                    version,
                    &intent,
                    &id,
                    map,
                    &positions,
                )?;
                id
            } else {
                for id in &ids {
                    self.field(
                        grid,
                        radius,
                        &cache_key(&intent, id, grid, &positions),
                        version,
                        &intent,
                        id,
                        map,
                        &positions,
                    )?;
                }
                let selection = intent.goal.selection.unwrap_or_default();
                match selection {
                    Selection::Random if ids.len() > 1 => {
                        ids[(u64::from(random::next(&mut a.random_state)) * ids.len() as u64
                            / 4_294_967_296) as usize]
                            .clone()
                    }
                    Selection::Nearest => {
                        let mut best = (f64::INFINITY, ids[0].clone());
                        for id in &ids {
                            let field = &self.fields
                                [&(radius.to_bits(), cache_key(&intent, id, grid, &positions))];
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
                            self.fields
                                [&(radius.to_bits(), cache_key(&intent, x, grid, &positions))]
                                .distance[index(grid, &a.position)]
                            .total_cmp(
                                &self.fields
                                    [&(radius.to_bits(), cache_key(&intent, y, grid, &positions))]
                                    .distance[index(grid, &a.position)],
                            )
                            .then_with(|| x.cmp(y))
                        })
                        .unwrap()
                        .clone(),
                }
            };
            let key = (
                radius.to_bits(),
                cache_key(&intent, &chosen, grid, &positions),
            );
            let field = &self.fields[&key];
            let cell = index(grid, &a.position);
            let mut blocked = !field.distance[cell].is_finite()
                && entry(
                    grid,
                    field,
                    &a.position,
                    radius,
                    &bodies,
                    &self.portal_info,
                    &mut self.work,
                )?
                .is_none();
            if !blocked && field.distance[cell].is_finite() {
                let saved = a.navigation.target_point.as_ref();
                let keep = if let Some(p) = saved {
                    let to = index(grid, p);
                    let on_route = (old_version == version
                        && a.navigation.flow_field_id.as_ref() == Some(&field.id))
                        || to == cell
                        || field.next[cell] == to as u32;
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
            self.routes[i] = Some(Route {
                key: Some(key),
                direct: None,
                stop: intent.goal.stop_distance.map_or(0.0, |d| d.0),
                blocked,
            });
        }
        self.prepared = true;
        Ok(())
    }
    pub fn step(
        &mut self,
        grid: &GridData,
        agents: &mut [AgentRuntime],
        dt: f64,
        tick: u64,
        metrics: &mut crate::metrics::Metrics,
        contact: Option<(&crate::contact::Config, &mut crate::contact::State)>,
    ) -> Result<(), Failure> {
        crate::movement::advance(self, grid, agents, dt, tick, metrics, contact)
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
        &mut self,
        grid: &GridData,
        a: &mut AgentRuntime,
        i: usize,
        work: &mut usize,
    ) -> Result<Option<(Point, f64)>, Failure> {
        let Some(route) = self.routes[i].as_ref() else {
            return Ok(None);
        };
        if let Some(point) = &route.direct {
            let remaining = distance(&a.position, point) - route.stop;
            if remaining <= grid.cell_size * 1e-7 {
                complete(a);
                return Ok(None);
            }
            return Ok(Some((point.clone(), remaining)));
        }
        let field = &self.fields[route.key.as_ref().unwrap()];
        let epsilon = grid.cell_size * 1e-7;
        let cell = index(grid, &a.position);
        if !field.distance[cell].is_finite() {
            if let Some(i) = entry(
                grid,
                field,
                &a.position,
                a.components.physical.radius.0,
                &self.bodies,
                &self.portal_info,
                work,
            )? {
                let target = center(grid, i);
                let remaining =
                    distance(&a.position, &target) + f64::from(field.hops[i]) * grid.cell_size;
                a.navigation.target_point = Some(target.clone());
                return Ok(Some((target, remaining)));
            }
            return Ok(None);
        }
        // Keep a visible lookahead until approached instead of rebuilding it every substep.
        if let Some(target) = &a.navigation.target_point {
            let to = index(grid, target);
            // A point remaining on a previously checked ray needs no new geometry scan.
            let certified = self.visible[i].as_ref().is_some_and(|(from, end)| {
                end.x.0 == target.x.0
                    && end.y.0 == target.y.0
                    && geometry::point_segment(a.position.x.0, a.position.y.0, from, end)
                        <= grid.cell_size * 1e-12
            });
            if field.distance[to] < field.distance[cell]
                && distance(&a.position, target) > grid.cell_size * 2.0
                && (certified
                    || same_terrain(grid, cell, to, work)?
                        && geometry::clear(
                            grid,
                            &self.bodies,
                            &a.position,
                            target,
                            a.components.physical.radius.0,
                            work,
                        )?)
            {
                let remaining = distance(&a.position, target)
                    + f64::from(field.hops[to]) * grid.cell_size
                    - route.stop;
                if remaining <= epsilon {
                    complete(a);
                    return Ok(None);
                }
                return Ok(Some((target.clone(), remaining)));
            }
        }
        // Look ahead along the field so crowds do not compete for every cell centre.
        let mut ahead = cell;
        let mut visible = None;
        for _ in 0..8 {
            let next = field.next[ahead];
            if next == NONE || next == ahead as u32 {
                break;
            }
            let next = next as usize;
            let portal = grid.portal_index[next];
            if portal != 0
                && portal != grid.portal_index[ahead]
                && self.portal_info[portal as usize].unwrap().3 > 0.0
            {
                break;
            }
            let point = center(grid, next);
            if same_terrain(grid, cell, next, work)?
                && geometry::clear(
                    grid,
                    &self.bodies,
                    &a.position,
                    &point,
                    a.components.physical.radius.0,
                    work,
                )?
            {
                visible = Some((point, next));
            }
            ahead = next;
        }
        if let Some((point, next)) = visible {
            let remaining = distance(&a.position, &point)
                + f64::from(field.hops[next]) * grid.cell_size
                - route.stop;
            if remaining <= epsilon {
                complete(a);
                return Ok(None);
            }
            self.visible[i] = Some((a.position.clone(), point.clone()));
            a.navigation.target_point = Some(point.clone());
            return Ok(Some((point, remaining)));
        }
        if a.navigation.target_point.as_ref().is_some_and(|target| {
            let to = index(grid, target);
            to != cell && field.next[cell] != to as u32
        }) {
            a.navigation.target_point = None;
        }
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
        let stop = route.stop;
        if remaining <= stop + epsilon {
            complete(a);
            return Ok(None);
        }
        Ok(Some((target.clone(), remaining - stop)))
    }
    pub fn permits(&self, grid: &GridData, from: &Point, to: &Point) -> bool {
        allowed(grid, &self.portal_info, index(grid, from), index(grid, to)).unwrap_or(false)
    }
    pub fn permits_agent(&self, grid: &GridData, from: &Point, to: &Point, i: usize) -> bool {
        if self.intents[i].as_ref().is_some_and(|intent| intent.local) {
            let zone = self.intents[i]
                .as_ref()
                .unwrap()
                .goal
                .inside_zone
                .as_ref()
                .unwrap();
            let z = grid
                .zone_ids
                .iter()
                .position(|v| v.as_ref() == Some(zone))
                .unwrap();
            if !line_in_zone(grid, from, to, z) {
                return false;
            }
        }
        self.permits(grid, from, to)
    }
    pub fn has_route(&self, i: usize) -> bool {
        self.routes.get(i).is_some_and(Option::is_some)
    }
    #[cfg(test)]
    pub fn field_count(&self) -> usize {
        self.fields.len()
    }
}
fn complete(a: &mut AgentRuntime) {
    a.current_goal
        .as_mut()
        .unwrap()
        .execution
        .as_mut()
        .unwrap()
        .phase = "arrived".into();
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
