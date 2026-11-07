import { z } from 'zod';
import { CounterSchema, FiniteSchema, IdSchema, NonnegativeSchema, PositiveIntegerSchema, PositiveSchema, Vec2Schema, nonemptyPatch } from './common.js';

export const RectSchema = z.strictObject({ x: FiniteSchema, y: FiniteSchema, width: PositiveSchema, height: PositiveSchema });
const polygonPoints = z.array(Vec2Schema).min(3).refine((points) => {
  if (points.length > 512) return false;
  const cross = (a: typeof points[number], b: typeof a, c: typeof a) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const onSegment = (a: typeof points[number], b: typeof a, p: typeof a) => cross(a, b, p) === 0 && p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x) && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    if (a.x === b.x && a.y === b.y) return false;
    area += a.x * b.y - b.x * a.y;
    for (let j = i + 1; j < points.length; j++) {
      if (j === i + 1 || (i === 0 && j === points.length - 1)) continue;
      const c = points[j]!, d = points[(j + 1) % points.length]!;
      if ((cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b)) return false;
    }
  }
  return area !== 0;
}, 'Polygon must be simple with nonzero area and at most 512 vertices');
export const ShapeSchema = z.discriminatedUnion('kind', [
  RectSchema.extend({ kind: z.literal('rectangle') }),
  z.strictObject({ kind: z.literal('circle'), center: Vec2Schema, radius: PositiveSchema }),
  z.strictObject({ kind: z.literal('polygon'), points: polygonPoints }),
  z.strictObject({ kind: z.literal('thick_line'), points: z.array(Vec2Schema).min(2).refine((p) => p.every((v, i) => i === 0 || v.x !== p[i - 1]!.x || v.y !== p[i - 1]!.y), 'Consecutive points must differ'), width: PositiveSchema }),
]);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const MapAppearanceSchema = z.strictObject({ fill: color.optional(), stroke: color.optional(), strokeWidthPx: NonnegativeSchema.optional(), opacity: NonnegativeSchema.max(1).optional(), labelVisible: z.boolean().optional() });
export const AppearanceSchema = MapAppearanceSchema.extend({ symbol: z.enum(['circle', 'square', 'triangle']).optional(), pose: z.enum(['upright', 'fallen']).optional() });
export const PhysicalSchema = z.strictObject({ radius: PositiveSchema, blocksMovement: z.boolean(), movable: z.boolean() });
const NavigationFieldsSchema = z.strictObject({ preferredSpeed: NonnegativeSchema, maximumSpeed: NonnegativeSchema, acceleration: NonnegativeSchema, personalSpace: NonnegativeSchema });
export const NavigationSchema = NavigationFieldsSchema.refine((v) => v.maximumSpeed >= v.preferredSpeed, 'Maximum speed must be at least preferred speed');
const strength = NonnegativeSchema.max(1);
export const BehaviorSchema = z.strictObject({ reactionDelay: NonnegativeSchema, routeCompliance: strength, avoidanceStrength: strength, groupCohesion: strength, goalPersistence: strength });
export const MobilitySchema = z.strictObject({ speedMultiplier: strength });
export const CapacitySchema = z.strictObject({ maximumOccupants: CounterSchema, serviceRate: PositiveSchema.optional() });
export const PortalSchema = z.strictObject({ connects: z.tuple([IdSchema, IdSchema]).refine(([a, b]) => a !== b, 'Portal must connect different zones'), open: z.boolean(), oneWay: z.boolean().optional(), traversalTime: NonnegativeSchema.optional() });
export const InteractionSchema = z.strictObject({ duration: NonnegativeSchema, slots: PositiveIntegerSchema });
export const ResolvedAgentComponentsSchema = z.strictObject({ physical: PhysicalSchema, navigation: NavigationSchema, behavior: BehaviorSchema, mobility: MobilitySchema });
export const AgentOverridesSchema = z.strictObject({ physical: PhysicalSchema.partial().optional(), navigation: NavigationFieldsSchema.partial().refine((v) => v.maximumSpeed === undefined || v.preferredSpeed === undefined || v.maximumSpeed >= v.preferredSpeed, 'Invalid speed range').optional(), behavior: BehaviorSchema.partial().optional(), mobility: MobilitySchema.partial().optional() });
export const WorldComponentsSchema = z.strictObject({ physical: PhysicalSchema.partial().optional(), capacity: CapacitySchema.optional(), portal: PortalSchema.optional(), interaction: InteractionSchema.optional() });
export const AgentTemplateSchema = z.strictObject({ kind: z.literal('agent'), label: z.string().optional(), tags: z.array(IdSchema).optional(), profile: IdSchema.optional(), components: AgentOverridesSchema.optional(), appearance: AppearanceSchema.optional() });
export const EntityBlueprintSchema = z.strictObject({ id: IdSchema, kind: z.enum(['zone', 'barrier', 'portal', 'object']), label: z.string().optional(), tags: z.array(IdSchema).optional(), components: WorldComponentsSchema.optional(), appearance: MapAppearanceSchema.optional(), shape: ShapeSchema.optional() });
export const WorldEntitySchema = EntityBlueprintSchema.extend({ shape: ShapeSchema });
export const MutableComponentsSchema = nonemptyPatch({
  physical: nonemptyPatch(PhysicalSchema.pick({ blocksMovement: true, movable: true }).partial().shape).optional(),
  navigation: nonemptyPatch(NavigationFieldsSchema.partial().shape).refine((v) => v.maximumSpeed === undefined || v.preferredSpeed === undefined || v.maximumSpeed >= v.preferredSpeed, 'Invalid speed range').optional(),
  behavior: nonemptyPatch(BehaviorSchema.partial().shape).optional(), mobility: nonemptyPatch(MobilitySchema.partial().shape).optional(),
  capacity: nonemptyPatch(CapacitySchema.partial().shape).optional(), portal: nonemptyPatch(PortalSchema.omit({ connects: true, oneWay: true }).partial().shape).optional(),
  interaction: nonemptyPatch(InteractionSchema.partial().shape).optional(),
});
export const SetValuesSchema = nonemptyPatch({ components: MutableComponentsSchema.optional(), appearance: nonemptyPatch(AppearanceSchema.shape).optional() });
export type Rect = z.infer<typeof RectSchema>;
export type Shape = z.infer<typeof ShapeSchema>;
export type MapAppearance = z.infer<typeof MapAppearanceSchema>;
export type Appearance = z.infer<typeof AppearanceSchema>;
export type Physical = z.infer<typeof PhysicalSchema>;
export type Navigation = z.infer<typeof NavigationSchema>;
export type Behavior = z.infer<typeof BehaviorSchema>;
export type Mobility = z.infer<typeof MobilitySchema>;
export type Capacity = z.infer<typeof CapacitySchema>;
export type Portal = z.infer<typeof PortalSchema>;
export type Interaction = z.infer<typeof InteractionSchema>;
export type ResolvedAgentComponents = z.infer<typeof ResolvedAgentComponentsSchema>;
export type AgentOverrides = z.infer<typeof AgentOverridesSchema>;
export type WorldComponents = z.infer<typeof WorldComponentsSchema>;
export type AgentTemplate = z.infer<typeof AgentTemplateSchema>;
export type EntityBlueprint = z.infer<typeof EntityBlueprintSchema>;
export type WorldEntity = z.infer<typeof WorldEntitySchema>;
export type MutableComponents = z.infer<typeof MutableComponentsSchema>;
export type SetValues = z.infer<typeof SetValuesSchema>;
