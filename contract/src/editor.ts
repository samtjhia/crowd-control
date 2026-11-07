import { z } from 'zod';
import { CounterSchema, FiniteSchema, IdSchema, PositiveIntegerSchema, PositiveSchema, UnitsSchema, uniqueIds } from './common.js';
import { EntityBlueprintSchema, ShapeSchema } from './entities.js';

export const PixelPointSchema = z.tuple([FiniteSchema, FiniteSchema]);
export const CalibrationSchema = z.strictObject({ pointsPx: z.tuple([PixelPointSchema, PixelPointSchema]), distanceMetres: PositiveSchema, metresPerPixel: PositiveSchema }).refine((v) => {
  const [[x1, y1], [x2, y2]] = v.pointsPx;
  const measured = Math.hypot(x2 - x1, y2 - y1) * v.metresPerPixel;
  return measured > 0 && Math.abs(measured - v.distanceMetres) <= 1e-8 * Math.max(1, measured, v.distanceMetres);
}, 'Calibration scale must match its two distinct points and distance');
export const SourcePageSchema = z.strictObject({ assetId: IdSchema, revision: IdSchema, page: PositiveIntegerSchema, mimeType: z.enum(['image/png', 'image/jpeg', 'application/pdf']), pixelWidth: PositiveIntegerSchema, pixelHeight: PositiveIntegerSchema, contentHash: IdSchema });
const pixelPolygon = z.array(PixelPointSchema).min(3).refine((points) => ShapeSchema.safeParse({ kind: 'polygon', points: points.map(([x, y]) => ({ x, y })) }).success, 'Invalid pixel polygon');
export const ZoneDraftSchema = z.strictObject({ id: IdSchema, label: z.string().optional(), tags: z.array(IdSchema).optional(), polygonPx: pixelPolygon });
export const PortalDraftSchema = ZoneDraftSchema.extend({ connects: z.tuple([IdSchema, IdSchema]).refine(([a, b]) => a !== b), open: z.boolean(), oneWay: z.boolean().optional() });
export const EditorDraftSchema = z.strictObject({
  source: SourcePageSchema, threshold: CounterSchema.max(255), draftBlocked: z.array(z.union([z.literal(0), z.literal(1)])), reviewedFloor: z.array(z.union([z.literal(0), z.literal(1)])),
  corrections: z.array(z.strictObject({ id: IdSchema, cells: z.array(CounterSchema), walkable: z.boolean() })), zones: z.array(ZoneDraftSchema), portals: z.array(PortalDraftSchema), calibration: CalibrationSchema.nullable(),
}).superRefine((v, ctx) => {
  const size = v.source.pixelWidth * v.source.pixelHeight;
  if (v.draftBlocked.length !== size || v.reviewedFloor.length !== size) ctx.addIssue({ code: 'custom', message: 'Pixel masks must match source dimensions' });
  if (!uniqueIds([...v.zones, ...v.portals]) || !uniqueIds(v.corrections)) ctx.addIssue({ code: 'custom', message: 'Duplicate editor IDs' });
  if (v.corrections.some((c) => c.cells.some((i) => i >= size))) ctx.addIssue({ code: 'custom', message: 'Correction cell outside source' });
  const zones = new Set(v.zones.map((r) => r.id));
  if (v.portals.some((p) => p.connects.some((id) => !zones.has(id)))) ctx.addIssue({ code: 'custom', message: 'Portal references unknown zone' });
  const points = [...v.zones, ...v.portals].flatMap((r) => r.polygonPx).concat(v.calibration?.pointsPx ?? []);
  if (points.some(([x, y]) => x < 0 || y < 0 || x > v.source.pixelWidth || y > v.source.pixelHeight)) ctx.addIssue({ code: 'custom', message: 'Point outside source page' });
});
export const MapSourceSchema = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('generate'), accuracy: z.literal('approximate') }),
  z.strictObject({ mode: z.literal('upload'), assetId: IdSchema, revision: IdSchema, page: PositiveIntegerSchema, calibration: CalibrationSchema.nullable(), sourceToWorld: z.tuple([FiniteSchema, FiniteSchema, FiniteSchema, FiniteSchema, FiniteSchema, FiniteSchema]) }),
  z.strictObject({ mode: z.literal('lookup'), assetId: IdSchema, revision: IdSchema, venue: z.string().min(1), floor: z.string().min(1) }),
]);
export const GridDataSchema = z.strictObject({
  width: PositiveIntegerSchema, height: PositiveIntegerSchema, cellSize: PositiveSchema, units: UnitsSchema,
  blocked: z.array(z.union([z.literal(0), z.literal(1)])), traversalCost: z.array(FiniteSchema.nonnegative()), zoneIndex: z.array(CounterSchema), portalIndex: z.array(CounterSchema), zoneIds: z.array(IdSchema.nullable()).min(1), portalIds: z.array(IdSchema.nullable()).min(1),
}).superRefine((v, ctx) => {
  const size = v.width * v.height;
  for (const key of ['blocked', 'traversalCost', 'zoneIndex', 'portalIndex'] as const) if (v[key].length !== size) ctx.addIssue({ code: 'custom', path: [key], message: 'Grid buffer length must equal width × height' });
  if (v.traversalCost.some((cost, i) => v.blocked[i] === 0 && cost <= 0)) ctx.addIssue({ code: 'custom', path: ['traversalCost'], message: 'Walkable cells require positive traversal cost' });
  for (const [indices, ids, path] of [[v.zoneIndex, v.zoneIds, 'zoneIndex'], [v.portalIndex, v.portalIds, 'portalIndex']] as const) {
    if (ids[0] !== null || ids.slice(1).some((id) => id === null) || new Set(ids).size !== ids.length || indices.some((i) => i >= ids.length)) ctx.addIssue({ code: 'custom', path: [path], message: 'Invalid grid membership dictionary or index' });
  }
});
export const PreparedMapSchema = z.strictObject({ id: IdSchema, revision: IdSchema, source: MapSourceSchema, grid: GridDataSchema, entities: z.array(EntityBlueprintSchema), reviewed: z.literal(true) }).refine((v) => uniqueIds(v.entities), 'Duplicate map entity IDs');
export type PixelPoint = z.infer<typeof PixelPointSchema>;
export type Calibration = z.infer<typeof CalibrationSchema>;
export type SourcePage = z.infer<typeof SourcePageSchema>;
export type ZoneDraft = z.infer<typeof ZoneDraftSchema>;
export type PortalDraft = z.infer<typeof PortalDraftSchema>;
export type EditorDraft = z.infer<typeof EditorDraftSchema>;
export type MapSource = z.infer<typeof MapSourceSchema>;
export type GridData = z.infer<typeof GridDataSchema>;
export type PreparedMap = z.infer<typeof PreparedMapSchema>;
