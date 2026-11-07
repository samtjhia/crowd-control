use crate::core::{Failure, invalid};
use crate::protocol::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GridData {
    pub width: usize,
    pub height: usize,
    pub cell_size: f64,
    pub units: Units,
    pub blocked: Vec<u8>,
    pub traversal_cost: Vec<f32>,
    pub terrain_speed_multiplier: Vec<f32>,
    pub zone_index: Vec<u32>,
    pub portal_index: Vec<u32>,
    pub zone_ids: Vec<Option<Id>>,
    pub portal_ids: Vec<Option<Id>>,
    #[serde(skip)]
    pub target_cells: BTreeMap<Id, Vec<usize>>,
}

impl GridData {
    pub fn decode(map: &Map) -> Result<Self, Failure> {
        let width = map.width.0 / map.cell_size.0;
        let height = map.height.0 / map.cell_size.0;
        if width.fract() != 0.0 || height.fract() != 0.0 || width * height > 1_000_000.0 {
            return Err((
                "RESOURCE_LIMIT",
                "Map dimensions exceed the cell budget or are not exact multiples of cellSize"
                    .into(),
            ));
        }
        crate::shapes::validate(map)?;
        let portals = map.all_portals()?;
        validate_source(map)?;
        let size = (width * height) as usize;
        let mut data = if let Some(grid) = &map.grid {
            if map.rows.is_some() || map.legend.is_some() {
                return Err(invalid("Provide grid or rows/legend, not both"));
            }
            if grid.width.0 != width
                || grid.height.0 != height
                || grid.cell_size.0 != map.cell_size.0
                || grid.units != map.units
            {
                return Err(invalid("Map and grid dimensions/units disagree"));
            }
            for len in [
                grid.blocked.len(),
                grid.traversal_cost.len(),
                grid.zone_index.len(),
                grid.portal_index.len(),
            ] {
                if len != size {
                    return Err(invalid("Grid buffer length mismatch"));
                }
            }
            validate_dictionary(&grid.zone_ids)?;
            validate_dictionary(&grid.portal_ids)?;
            if grid.blocked.iter().any(|b| b.0 > 1.0)
                || grid
                    .zone_index
                    .iter()
                    .any(|i| i.0 >= grid.zone_ids.len() as f64)
                || grid
                    .portal_index
                    .iter()
                    .any(|i| i.0 >= grid.portal_ids.len() as f64)
            {
                return Err(invalid("Invalid grid value or dictionary index"));
            }
            let costs: Vec<f32> = grid.traversal_cost.iter().map(|c| c.0 as f32).collect();
            let terrain: Vec<f32> = grid.terrain_speed_multiplier.as_ref().map_or_else(
                || vec![1.0; size],
                |v| v.iter().map(|s| s.0 as f32).collect(),
            );
            if terrain.len() != size
                || terrain
                    .iter()
                    .any(|s| !s.is_finite() || *s <= 0.0 || *s > 1.0)
                || grid
                    .terrain_speed_multiplier
                    .as_ref()
                    .is_some_and(|v| v.iter().any(|s| s.0 > 1.0))
            {
                return Err(invalid(
                    "Terrain speed multipliers require one Float32 value in (0,1] per cell",
                ));
            }
            if costs
                .iter()
                .enumerate()
                .any(|(i, c)| !c.is_finite() || (grid.blocked[i].0 == 0.0 && *c <= 0.0))
            {
                return Err(invalid(
                    "Walkable costs must remain finite and positive at Float32 precision",
                ));
            }
            Self {
                width: width as usize,
                height: height as usize,
                cell_size: map.cell_size.0,
                units: map.units.clone(),
                blocked: grid.blocked.iter().map(|v| v.0 as u8).collect(),
                traversal_cost: costs,
                terrain_speed_multiplier: terrain,
                zone_index: grid.zone_index.iter().map(|v| v.0 as u32).collect(),
                portal_index: grid.portal_index.iter().map(|v| v.0 as u32).collect(),
                zone_ids: grid.zone_ids.clone(),
                portal_ids: grid.portal_ids.clone(),
                target_cells: BTreeMap::new(),
            }
        } else {
            let rows = map
                .rows
                .as_ref()
                .ok_or_else(|| invalid("Missing grid or rows"))?;
            let legend = map
                .legend
                .as_ref()
                .ok_or_else(|| invalid("Missing legend"))?;
            if rows.len() != height as usize
                || rows
                    .iter()
                    .any(|r| r.encode_utf16().count() != width as usize)
                || legend.keys().any(|k| k.encode_utf16().count() != 1)
            {
                return Err(invalid("Invalid rows or legend keys"));
            }
            let mut result = Self {
                width: width as usize,
                height: height as usize,
                cell_size: map.cell_size.0,
                units: map.units.clone(),
                blocked: vec![1; size],
                traversal_cost: vec![1.0; size],
                terrain_speed_multiplier: vec![1.0; size],
                zone_index: vec![0; size],
                portal_index: vec![0; size],
                zone_ids: vec![None],
                portal_ids: vec![None],
                target_cells: BTreeMap::new(),
            };
            let mut zones = BTreeMap::new();
            let mut portal_indices = BTreeMap::new();
            for entity in map
                .entities()
                .iter()
                .filter(|e| matches!(e.kind, EntityKind::Zone))
            {
                result.zone_ids.push(Some(entity.id.clone()));
                zones.insert(&entity.id, result.zone_ids.len() as u32 - 1);
            }
            for room in &map.rooms {
                result.zone_ids.push(Some(room.id.clone()));
                zones.insert(&room.id, result.zone_ids.len() as u32 - 1);
            }
            for portal in &portals {
                result.portal_ids.push(Some(portal.id.clone()));
                portal_indices.insert(&portal.id, result.portal_ids.len() as u32 - 1);
            }
            for (key, id) in legend {
                if key == "#"
                    || (!zones.contains_key(id)
                        && !portal_indices.contains_key(id)
                        && !map.entities().iter().any(|e| &e.id == id))
                {
                    return Err(invalid("Unknown legend entity or reserved wall glyph"));
                }
            }
            for (y, row) in rows.iter().enumerate() {
                for (x, ch) in row.encode_utf16().enumerate() {
                    if ch == u16::from(b'#') {
                        continue;
                    }
                    let glyph = String::from_utf16(&[ch]).map_err(|_| invalid("Invalid glyph"))?;
                    let id = legend
                        .get(&glyph)
                        .ok_or_else(|| invalid("Unknown grid glyph"))?;
                    let i = y * result.width + x;
                    result.blocked[i] = 0;
                    if let Some(index) = zones.get(id) {
                        result.zone_index[i] = *index;
                    }
                    if let Some(index) = portal_indices.get(id) {
                        result.portal_index[i] = *index;
                    }
                }
            }
            result
        };
        let mut ids = BTreeSet::new();
        for id in data.zone_ids.iter().chain(data.portal_ids.iter()).flatten() {
            if !ids.insert(id) {
                return Err(invalid("Zone and portal IDs must be distinct"));
            }
        }
        for room in &map.rooms {
            bounds(room.x.0, room.y.0, room.width.0, room.height.0, map)?;
            if !data.zone_ids.contains(&Some(room.id.clone())) {
                return Err(invalid("Room missing from zone dictionary"));
            }
        }
        for e in map.entities() {
            if (data.zone_ids.iter().flatten().any(|id| id == &e.id)
                && !matches!(e.kind, EntityKind::Zone))
                || (data.portal_ids.iter().flatten().any(|id| id == &e.id)
                    && !matches!(e.kind, EntityKind::Portal))
            {
                return Err(invalid(
                    "Entity kind conflicts with grid membership identity",
                ));
            }
        }
        for e in map
            .entities()
            .iter()
            .filter(|e| matches!(e.kind, EntityKind::Zone))
        {
            if !data.zone_ids.contains(&Some(e.id.clone())) {
                return Err(invalid("Zone entity missing from zone dictionary"));
            }
        }
        for p in &portals {
            bounds(p.x.0, p.y.0, p.width.0, p.height.0, map)?;
            if p.connects[0] == p.connects[1]
                || p.connects
                    .iter()
                    .any(|id| !data.zone_ids.contains(&Some(id.clone())))
                || !data.portal_ids.contains(&Some(p.id.clone()))
            {
                return Err(invalid("Portal references unknown zones or membership"));
            }
            let index = data
                .portal_ids
                .iter()
                .position(|id| id.as_ref() == Some(&p.id))
                .unwrap() as u32;
            if !data.portal_index.contains(&index) {
                return Err(invalid("Portal opening lost at grid resolution"));
            }
        }
        if data
            .portal_ids
            .iter()
            .flatten()
            .any(|id| !portals.iter().any(|p| &p.id == id))
        {
            return Err(invalid("Portal dictionary needs explicit portal metadata"));
        }
        let mut described = BTreeSet::new();
        for entity in map
            .rooms
            .iter()
            .map(|r| &r.id)
            .chain(portals.iter().map(|p| &p.id))
            .chain(
                map.entities()
                    .iter()
                    .filter(|e| !matches!(e.kind, EntityKind::Portal))
                    .map(|e| &e.id),
            )
        {
            if !described.insert(entity) {
                return Err(invalid("Duplicate map entity ID"));
            }
        }
        for i in 0..size {
            let x = (i % data.width) as f64 * data.cell_size;
            let y = (i / data.width) as f64 * data.cell_size;
            if let Some(id) = &data.zone_ids[data.zone_index[i] as usize] {
                if let Some(room) = map.rooms.iter().find(|r| &r.id == id) {
                    if !contains_cell(
                        x,
                        y,
                        data.cell_size,
                        room.x.0,
                        room.y.0,
                        room.width.0,
                        room.height.0,
                    ) {
                        return Err(invalid("Zone membership disagrees with room geometry"));
                    }
                }
            }
            if let Some(id) = &data.portal_ids[data.portal_index[i] as usize] {
                let p = portals
                    .iter()
                    .find(|p| &p.id == id)
                    .ok_or_else(|| invalid("Portal membership needs explicit portal metadata"))?;
                if !contains_cell(x, y, data.cell_size, p.x.0, p.y.0, p.width.0, p.height.0) {
                    return Err(invalid("Portal membership disagrees with opening geometry"));
                }
                if !p.open {
                    data.blocked[i] = 1;
                }
            }
        }
        data.target_cells = crate::shapes::validate_masks(map, &data)?;
        Ok(data)
    }

    pub fn zone_at(&self, x: f64, y: f64) -> Option<Id> {
        if x < 0.0
            || y < 0.0
            || x >= self.width as f64 * self.cell_size
            || y >= self.height as f64 * self.cell_size
        {
            return None;
        }
        let i = (y / self.cell_size).floor() as usize * self.width
            + (x / self.cell_size).floor() as usize;
        self.zone_index
            .get(i)
            .and_then(|index| self.zone_ids[*index as usize].clone())
    }

    pub fn footprint(&self, x: f64, y: f64, radius: f64) -> Vec<usize> {
        let min_x = ((x - radius) / self.cell_size).floor().max(0.0) as usize;
        let min_y = ((y - radius) / self.cell_size).floor().max(0.0) as usize;
        let max_x = ((x + radius) / self.cell_size)
            .floor()
            .min(self.width as f64 - 1.0) as usize;
        let max_y = ((y + radius) / self.cell_size)
            .floor()
            .min(self.height as f64 - 1.0) as usize;
        let mut cells = vec![];
        for row in min_y..=max_y {
            for col in min_x..=max_x {
                let left = col as f64 * self.cell_size;
                let top = row as f64 * self.cell_size;
                let dx = x - x.clamp(left, left + self.cell_size);
                let dy = y - y.clamp(top, top + self.cell_size);
                if radius - crate::geometry::norm(dx, dy) > radius * 1e-10 {
                    cells.push(row * self.width + col);
                }
            }
        }
        cells
    }
}

fn validate_dictionary(ids: &[Option<Id>]) -> Result<(), Failure> {
    if ids.first() != Some(&None)
        || ids.iter().skip(1).any(Option::is_none)
        || ids.iter().flatten().collect::<BTreeSet<_>>().len() + 1 != ids.len()
    {
        return Err(invalid(
            "Membership dictionary requires null only at index zero and unique IDs",
        ));
    }
    Ok(())
}
fn contains_cell(x: f64, y: f64, size: f64, left: f64, top: f64, width: f64, height: f64) -> bool {
    let tolerance = 1e-9 * size;
    x + tolerance >= left
        && y + tolerance >= top
        && x + size <= left + width + tolerance
        && y + size <= top + height + tolerance
}
pub fn bounds(x: f64, y: f64, w: f64, h: f64, map: &Map) -> Result<(), Failure> {
    if x < 0.0
        || y < 0.0
        || !(x + w).is_finite()
        || !(y + h).is_finite()
        || x + w > map.width.0
        || y + h > map.height.0
    {
        Err(invalid("Geometry outside map bounds"))
    } else {
        Ok(())
    }
}
fn validate_source(map: &Map) -> Result<(), Failure> {
    match &map.source {
        Some(MapSource::Generate { accuracy }) if accuracy != "approximate" => {
            Err(invalid("Generated accuracy must be approximate"))
        }
        Some(MapSource::Lookup { venue, floor, .. }) if venue.is_empty() || floor.is_empty() => {
            Err(invalid("Lookup provenance requires venue/floor"))
        }
        Some(MapSource::Upload {
            page,
            calibration,
            source_to_world,
            ..
        }) => {
            if page.0 < 1.0 {
                return Err(invalid("Source page must be positive"));
            }
            let [a, b, c, d, _, _] = source_to_world;
            if !(a.0 * d.0 - b.0 * c.0).is_finite() || a.0 * d.0 - b.0 * c.0 == 0.0 {
                return Err(invalid("Source transform must be invertible"));
            }
            match calibration {
                None if map.units == Units::Metres => Err((
                    "SCALE_CALIBRATION_REQUIRED",
                    "Metric maps require calibration".into(),
                )),
                Some(cal) => {
                    let [[x1, y1], [x2, y2]] = cal.points_px;
                    let distance = (x2.0 - x1.0).hypot(y2.0 - y1.0) * cal.metres_per_pixel.0;
                    if distance == 0.0
                        || !distance.is_finite()
                        || (distance - cal.distance_metres.0).abs()
                            > 1e-8 * distance.max(cal.distance_metres.0).max(1.0)
                    {
                        return Err(invalid("Calibration distance and scale disagree"));
                    }
                    Ok(())
                }
                _ => Ok(()),
            }
        }
        _ => Ok(()),
    }
}
