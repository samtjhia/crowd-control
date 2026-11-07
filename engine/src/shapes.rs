use crate::{
    core::{Failure, invalid, unsupported},
    geometry,
    grid::{GridData, bounds},
    protocol::*,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Shape {
    Rectangle {
        x: Number,
        y: Number,
        width: Positive,
        height: Positive,
    },
    Circle {
        center: Point,
        radius: Positive,
    },
    Polygon {
        points: Vec<Point>,
    },
    ThickLine {
        points: Vec<Point>,
        width: Positive,
    },
}
impl Shape {
    pub fn closest(&self, p: &Point) -> Point {
        if self.distance(p) == 0.0 {
            return p.clone();
        }
        match self {
            Self::Rectangle {
                x,
                y,
                width,
                height,
            } => Point {
                x: Number(p.x.0.clamp(x.0, x.0 + width.0)),
                y: Number(p.y.0.clamp(y.0, y.0 + height.0)),
            },
            Self::Circle { center, radius } => {
                let d = geometry::distance(p, center);
                Point {
                    x: Number(center.x.0 + (p.x.0 - center.x.0) * radius.0 / d),
                    y: Number(center.y.0 + (p.y.0 - center.y.0) * radius.0 / d),
                }
            }
            Self::Polygon { points } | Self::ThickLine { points, .. } => {
                let mut best = points[0].clone();
                let mut distance = f64::INFINITY;
                let edges = if matches!(self, Self::Polygon { .. }) {
                    points.len()
                } else {
                    points.len() - 1
                };
                for (a, b) in points.iter().zip(points.iter().cycle().skip(1)).take(edges) {
                    let d = geometry::distance(a, b);
                    let ux = (b.x.0 - a.x.0) / d;
                    let uy = (b.y.0 - a.y.0) / d;
                    let t = ((p.x.0 - a.x.0) * ux + (p.y.0 - a.y.0) * uy).clamp(0.0, d);
                    let q = Point {
                        x: Number(a.x.0 + ux * t),
                        y: Number(a.y.0 + uy * t),
                    };
                    let n = geometry::distance(p, &q);
                    if n < distance {
                        distance = n;
                        best = q;
                    }
                }
                if let Self::ThickLine { width, .. } = self {
                    let r = width.0 / 2.0;
                    best.x.0 += (p.x.0 - best.x.0) * r / distance;
                    best.y.0 += (p.y.0 - best.y.0) * r / distance;
                }
                best
            }
        }
    }
    fn extent(&self) -> (f64, f64, f64, f64) {
        match self {
            Self::Rectangle {
                x,
                y,
                width,
                height,
            } => (x.0, y.0, width.0, height.0),
            Self::Circle { center, radius } => (
                center.x.0 - radius.0,
                center.y.0 - radius.0,
                2.0 * radius.0,
                2.0 * radius.0,
            ),
            Self::Polygon { points } | Self::ThickLine { points, .. } => {
                let pad = if let Self::ThickLine { width, .. } = self {
                    width.0 / 2.0
                } else {
                    0.0
                };
                let l = points.iter().map(|p| p.x.0).fold(f64::INFINITY, f64::min) - pad;
                let t = points.iter().map(|p| p.y.0).fold(f64::INFINITY, f64::min) - pad;
                let r = points
                    .iter()
                    .map(|p| p.x.0)
                    .fold(f64::NEG_INFINITY, f64::max)
                    + pad;
                let b = points
                    .iter()
                    .map(|p| p.y.0)
                    .fold(f64::NEG_INFINITY, f64::max)
                    + pad;
                (l, t, r - l, b - t)
            }
        }
    }
    pub fn distance(&self, p: &Point) -> f64 {
        match self {
            Self::Rectangle {
                x,
                y,
                width,
                height,
            } => geometry::norm(
                p.x.0 - p.x.0.clamp(x.0, x.0 + width.0),
                p.y.0 - p.y.0.clamp(y.0, y.0 + height.0),
            ),
            Self::Circle { center, radius } => (geometry::distance(p, center) - radius.0).max(0.0),
            Self::ThickLine { points, width } => (points
                .windows(2)
                .map(|e| geometry::point_segment(p.x.0, p.y.0, &e[0], &e[1]))
                .fold(f64::INFINITY, f64::min)
                - width.0 / 2.0)
                .max(0.0),
            Self::Polygon { points } => {
                let mut inside = false;
                let mut d = f64::INFINITY;
                for (a, b) in points
                    .iter()
                    .zip(points.iter().cycle().skip(1))
                    .take(points.len())
                {
                    d = d.min(geometry::point_segment(p.x.0, p.y.0, a, b));
                    if (a.y.0 > p.y.0) != (b.y.0 > p.y.0)
                        && p.x.0 < (b.x.0 - a.x.0) * (p.y.0 - a.y.0) / (b.y.0 - a.y.0) + a.x.0
                    {
                        inside = !inside;
                    }
                }
                if inside { 0.0 } else { d }
            }
        }
    }
    fn intersects(&self, l: f64, t: f64, size: f64) -> bool {
        let e = size * 1e-10;
        let r = l + size - e;
        let b = t + size - e;
        let l = l + e;
        let t = t + e;
        match self {
            Self::Rectangle {
                x,
                y,
                width,
                height,
            } => x.0 < r && x.0 + width.0 > l && y.0 < b && y.0 + height.0 > t,
            Self::Circle { center, radius } => {
                geometry::norm(
                    center.x.0 - center.x.0.clamp(l, r),
                    center.y.0 - center.y.0.clamp(t, b),
                ) < radius.0
            }
            Self::Polygon { points } => {
                self.distance(&Point {
                    x: Number((l + r) / 2.0),
                    y: Number((t + b) / 2.0),
                }) == 0.0
                    || points
                        .iter()
                        .zip(points.iter().cycle().skip(1))
                        .take(points.len())
                        .any(|(a, z)| geometry::segment_rect(a, z, l, t, r, b) == 0.0)
            }
            Self::ThickLine { points, width } => points
                .windows(2)
                .any(|v| geometry::segment_rect(&v[0], &v[1], l, t, r, b) < width.0 / 2.0),
        }
    }
}
pub fn target_closest(
    grid: &GridData,
    map: &Map,
    id: &Id,
    p: &Point,
    work: &mut usize,
) -> Result<Option<Point>, Failure> {
    if let Some(entity) = map
        .entities()
        .iter()
        .find(|e| &e.id == id && !matches!(e.kind, EntityKind::Zone | EntityKind::Portal))
    {
        if !entity.blocking() {
            return Ok(entity.shape.as_ref().map(|s| s.closest(p)));
        }
    }
    let Some(cells) = grid.target_cells.get(id) else {
        return Ok(None);
    };
    *work = work.saturating_add(cells.len());
    if *work > 64_000_000 {
        return Err((
            "RESOURCE_LIMIT",
            "Approach search work budget exceeded".into(),
        ));
    }
    let zone = grid.zone_ids.iter().flatten().any(|v| v == id);
    let mut best = f64::INFINITY;
    let mut selected = None;
    for &i in cells {
        if zone && grid.blocked[i] != 0 {
            continue;
        }
        let x = (i % grid.width) as f64 * grid.cell_size;
        let y = (i / grid.width) as f64 * grid.cell_size;
        let q = Point {
            x: Number(p.x.0.clamp(x, x + grid.cell_size)),
            y: Number(p.y.0.clamp(y, y + grid.cell_size)),
        };
        let d = geometry::distance(p, &q);
        if d < best {
            best = d;
            selected = Some(q);
        }
    }
    Ok(selected)
}
pub fn approachable(
    grid: &GridData,
    map: &Map,
    id: &Id,
    p: &Point,
    radius: f64,
    work: &mut usize,
) -> Result<bool, Failure> {
    let Some(q) = target_closest(grid, map, id, p, work)? else {
        return Ok(false);
    };
    let d = geometry::distance(p, &q);
    if d > grid.cell_size * 1.5 + radius {
        return Ok(false);
    }
    let end = if d > radius {
        let t = (d - radius - grid.cell_size * 1e-8).max(0.0) / d;
        Point {
            x: Number(p.x.0 + (q.x.0 - p.x.0) * t),
            y: Number(p.y.0 + (q.y.0 - p.y.0) * t),
        }
    } else {
        p.clone()
    };
    geometry::clear(grid, &[], p, &end, radius, work)
}
impl Entity {
    pub fn blocking(&self) -> bool {
        self.components
            .as_ref()
            .and_then(|c| c.physical.as_ref())
            .and_then(|p| p.blocks_movement)
            .unwrap_or(matches!(self.kind, EntityKind::Barrier))
    }
    pub fn capacity(&self) -> Option<&Capacity> {
        self.components.as_ref()?.capacity.as_ref()
    }
    pub fn interaction(&self) -> Option<&Interaction> {
        self.components.as_ref()?.interaction.as_ref()
    }
}
impl Map {
    pub fn entities(&self) -> &[Entity] {
        self.entities.as_deref().unwrap_or(&[])
    }
    pub fn all_portals(&self) -> Result<Vec<Portal>, Failure> {
        let mut portals = self.portals.clone();
        for e in self
            .entities()
            .iter()
            .filter(|e| matches!(e.kind, EntityKind::Portal))
        {
            let p = e
                .components
                .as_ref()
                .and_then(|c| c.portal.as_ref())
                .ok_or_else(|| invalid("Portal entity requires portal components"))?;
            let (x, y, w, h) = e
                .shape
                .as_ref()
                .ok_or_else(|| invalid("Portal entity requires shape"))?
                .extent();
            portals.push(Portal {
                id: e.id.clone(),
                label: e.label.clone(),
                tags: e.tags.clone(),
                x: Number(x),
                y: Number(y),
                width: Positive(w),
                height: Positive(h),
                connects: p.connects.clone(),
                open: p.open,
                one_way: p.one_way,
                traversal_time: p.traversal_time,
                appearance: e.appearance.clone(),
            });
        }
        Ok(portals)
    }
}
pub fn distance(entity: &Entity, p: &Point) -> f64 {
    entity
        .shape
        .as_ref()
        .map_or(f64::INFINITY, |s| s.distance(p))
}
pub fn center(entity: &Entity) -> Option<Point> {
    let (x, y, w, h) = entity.shape.as_ref()?.extent();
    Some(Point {
        x: Number(x + w / 2.0),
        y: Number(y + h / 2.0),
    })
}
pub fn validate(map: &Map) -> Result<(), Failure> {
    if map.entities().len() > 4096 {
        return Err(("RESOURCE_LIMIT", "Static entity budget exceeded".into()));
    }
    let mut slots = 0.0;
    for e in map.entities() {
        if matches!(e.kind, EntityKind::Agent) {
            return Err(invalid("Map entities cannot contain agents"));
        }
        if e.components.as_ref().is_some_and(|c| c.portal.is_some())
            && !matches!(e.kind, EntityKind::Portal)
        {
            return Err(invalid("Portal components require portal kind"));
        }
        if let Some(p) = e.components.as_ref().and_then(|c| c.physical.as_ref()) {
            if p.movable == Some(true) || p.radius.is_some() {
                return Err(unsupported(
                    "Static entities use shape and immovable geometry; omit physical.radius",
                ));
            }
        }
        if let Some(i) = e.interaction() {
            if i.slots.0 < 1.0 {
                return Err(invalid("Interaction slots must be positive"));
            }
            slots += i.slots.0;
        }
        if slots > 10000.0 {
            return Err(("RESOURCE_LIMIT", "Interaction slot budget exceeded".into()));
        }
        if let Some(v) = &e.shape {
            let shape = v;
            if let Shape::Polygon { points } | Shape::ThickLine { points, .. } = &shape {
                let min = if matches!(shape, Shape::Polygon { .. }) {
                    3
                } else {
                    2
                };
                if points.len() < min
                    || points.len() > 512
                    || points
                        .windows(2)
                        .any(|v| geometry::distance(&v[0], &v[1]) == 0.0)
                {
                    return Err(invalid("Invalid shape points"));
                }
                if matches!(shape, Shape::Polygon { .. }) {
                    if geometry::distance(&points[0], points.last().unwrap()) == 0.0 {
                        return Err(invalid("Polygon must not repeat its first vertex"));
                    }
                    let mut area = 0.0;
                    for i in 0..points.len() {
                        let a = &points[i];
                        let b = &points[(i + 1) % points.len()];
                        area += a.x.0 * b.y.0 - b.x.0 * a.y.0;
                        for j in i + 1..points.len() {
                            if j == i + 1 || (i == 0 && j == points.len() - 1) {
                                continue;
                            }
                            if segments_touch(a, b, &points[j], &points[(j + 1) % points.len()]) {
                                return Err(invalid("Polygon must be simple"));
                            }
                        }
                    }
                    if !area.is_finite() || area == 0.0 {
                        return Err(invalid("Polygon requires finite nonzero area"));
                    }
                }
            }
            let (x, y, w, h) = shape.extent();
            bounds(x, y, w, h, map)?;
        } else if !matches!(e.kind, EntityKind::Zone) {
            return Err(invalid("Static objects require compiled shapes"));
        }
    }
    Ok(())
}
fn segments_touch(a: &Point, b: &Point, c: &Point, d: &Point) -> bool {
    fn cross(a: &Point, b: &Point, c: &Point) -> f64 {
        (b.x.0 - a.x.0) * (c.y.0 - a.y.0) - (b.y.0 - a.y.0) * (c.x.0 - a.x.0)
    }
    fn on(a: &Point, b: &Point, c: &Point) -> bool {
        cross(a, b, c) == 0.0
            && c.x.0 >= a.x.0.min(b.x.0)
            && c.x.0 <= a.x.0.max(b.x.0)
            && c.y.0 >= a.y.0.min(b.y.0)
            && c.y.0 <= a.y.0.max(b.y.0)
    }
    (cross(a, b, c) * cross(a, b, d) < 0.0 && cross(c, d, a) * cross(c, d, b) < 0.0)
        || on(a, b, c)
        || on(a, b, d)
        || on(c, d, a)
        || on(c, d, b)
}
pub fn validate_masks(
    map: &Map,
    grid: &GridData,
) -> Result<std::collections::BTreeMap<Id, Vec<usize>>, Failure> {
    let mut cache = std::collections::BTreeMap::new();
    let mut work = 0usize;
    let mut cached_cells = 0;
    for e in map.entities() {
        let mut cells = vec![];
        if let Some(v) = &e.shape {
            let shape = v;
            let (x, y, w, h) = shape.extent();
            let mut count = 0;
            for row in (y / grid.cell_size).floor() as usize
                ..=((y + h) / grid.cell_size)
                    .floor()
                    .min(grid.height as f64 - 1.0) as usize
            {
                for col in (x / grid.cell_size).floor() as usize
                    ..=((x + w) / grid.cell_size)
                        .floor()
                        .min(grid.width as f64 - 1.0) as usize
                {
                    work += match &shape {
                        Shape::Polygon { points } | Shape::ThickLine { points, .. } => points.len(),
                        _ => 1,
                    };
                    if work > 64_000_000 {
                        return Err((
                            "RESOURCE_LIMIT",
                            "Entity mask validation budget exceeded".into(),
                        ));
                    }
                    if shape.intersects(
                        col as f64 * grid.cell_size,
                        row as f64 * grid.cell_size,
                        grid.cell_size,
                    ) {
                        count += 1;
                        cached_cells += 1;
                        if cached_cells > 4_000_000 {
                            return Err((
                                "RESOURCE_LIMIT",
                                "Entity footprint cache budget exceeded".into(),
                            ));
                        }
                        let i = row * grid.width + col;
                        cells.push(i);
                        if e.blocking() && grid.blocked[i] == 0 {
                            return Err(invalid(
                                "Blocking entity footprint must already be blocked in the compiled grid",
                            ));
                        }
                    }
                }
            }
            if count == 0 {
                return Err(invalid("Entity footprint lost at grid resolution"));
            }
        }
        cache.insert(e.id.clone(), cells);
    }
    for id in grid.zone_ids.iter().chain(&grid.portal_ids).flatten() {
        cache.insert(id.clone(), vec![]);
    }
    for i in 0..grid.blocked.len() {
        if let Some(id) = &grid.zone_ids[grid.zone_index[i] as usize] {
            cache.get_mut(id).unwrap().push(i);
        }
        if let Some(id) = &grid.portal_ids[grid.portal_index[i] as usize] {
            cache.get_mut(id).unwrap().push(i);
        }
    }
    Ok(cache)
}
