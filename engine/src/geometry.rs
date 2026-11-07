//! Exact swept-disc checks against grid-cell rectangles and anchored discs.
use crate::{core::Failure, grid::GridData, protocol::Point};

#[derive(Debug, Clone, Copy)]
pub struct Body {
    pub x: f64,
    pub y: f64,
    pub radius: f64,
}
pub fn distance(a: &Point, b: &Point) -> f64 {
    norm(a.x.0 - b.x.0, a.y.0 - b.y.0)
}
// Use the same IEEE arithmetic in native Rust and Wasm, independent of platform libm.
pub fn norm(x: f64, y: f64) -> f64 {
    let large = x.abs().max(y.abs());
    if large == 0.0 {
        0.0
    } else {
        let r = x.abs().min(y.abs()) / large;
        large * (1.0 + r * r).sqrt()
    }
}
pub fn point_segment(x: f64, y: f64, a: &Point, b: &Point) -> f64 {
    let length = distance(a, b);
    if length == 0.0 {
        return norm(x - a.x.0, y - a.y.0);
    }
    let ux = (b.x.0 - a.x.0) / length;
    let uy = (b.y.0 - a.y.0) / length;
    let t = ((x - a.x.0) * ux + (y - a.y.0) * uy).clamp(0.0, length);
    norm(x - (a.x.0 + t * ux), y - (a.y.0 + t * uy))
}
pub fn segment_rect(a: &Point, b: &Point, l: f64, t: f64, r: f64, bottom: f64) -> f64 {
    let mut enter: f64 = 0.0;
    let mut exit: f64 = 1.0;
    for (start, delta, min, max) in [
        (a.x.0, b.x.0 - a.x.0, l, r),
        (a.y.0, b.y.0 - a.y.0, t, bottom),
    ] {
        if delta == 0.0 {
            if start < min || start > max {
                enter = 2.0;
                break;
            }
        } else {
            let p = (min - start) / delta;
            let q = (max - start) / delta;
            enter = enter.max(p.min(q));
            exit = exit.min(p.max(q));
        }
    }
    if enter <= exit {
        return 0.0;
    }
    let point_rect = |p: &Point| norm(p.x.0 - p.x.0.clamp(l, r), p.y.0 - p.y.0.clamp(t, bottom));
    let mut d = point_rect(a).min(point_rect(b));
    for (x, y) in [(l, t), (l, bottom), (r, t), (r, bottom)] {
        d = d.min(point_segment(x, y, a, b));
    }
    d
}
pub fn clear(
    grid: &GridData,
    bodies: &[Body],
    a: &Point,
    b: &Point,
    radius: f64,
    work: &mut usize,
) -> Result<bool, Failure> {
    let w = grid.width as f64 * grid.cell_size;
    let h = grid.height as f64 * grid.cell_size;
    let tolerance = radius * 1e-10;
    for p in [a, b] {
        if p.x.0 < radius - tolerance
            || p.y.0 < radius - tolerance
            || p.x.0 + radius > w + tolerance
            || p.y.0 + radius > h + tolerance
        {
            return Ok(false);
        }
    }
    let min_x = ((a.x.0.min(b.x.0) - radius) / grid.cell_size)
        .floor()
        .max(0.0) as usize;
    let min_y = ((a.y.0.min(b.y.0) - radius) / grid.cell_size)
        .floor()
        .max(0.0) as usize;
    let max_x = ((a.x.0.max(b.x.0) + radius) / grid.cell_size)
        .floor()
        .min(grid.width as f64 - 1.0) as usize;
    let max_y = ((a.y.0.max(b.y.0) + radius) / grid.cell_size)
        .floor()
        .min(grid.height as f64 - 1.0) as usize;
    let count = (max_x - min_x + 1)
        .saturating_mul(max_y - min_y + 1)
        .saturating_add(bodies.len());
    *work = work.saturating_add(count);
    if *work > 64_000_000 {
        return Err((
            "RESOURCE_LIMIT",
            "Navigation geometry work budget exceeded".into(),
        ));
    }
    for y in min_y..=max_y {
        for x in min_x..=max_x {
            if grid.blocked[y * grid.width + x] == 0 {
                continue;
            }
            let l = x as f64 * grid.cell_size;
            let t = y as f64 * grid.cell_size;
            if radius - segment_rect(a, b, l, t, l + grid.cell_size, t + grid.cell_size) > tolerance
            {
                return Ok(false);
            }
        }
    }
    for body in bodies {
        let sum = radius + body.radius;
        if sum - point_segment(body.x, body.y, a, b) > sum * 1e-10 {
            return Ok(false);
        }
    }
    Ok(true)
}
