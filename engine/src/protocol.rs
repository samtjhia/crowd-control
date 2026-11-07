//! Strict input/runtime DTOs for the supported engine subset.
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

macro_rules! number {
    ($name:ident, $check:expr) => {
        #[derive(Debug, Clone, Copy, Serialize)]
        #[serde(transparent)]
        pub struct $name(pub f64);
        impl<'de> Deserialize<'de> for $name {
            fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
                let v = f64::deserialize(d)?;
                if v.is_finite() && ($check)(v) {
                    Ok(Self(v))
                } else {
                    Err(serde::de::Error::custom(stringify!($name)))
                }
            }
        }
    };
}
number!(Number, |_: f64| true);
number!(Nonnegative, |v: f64| v >= 0.0);
number!(Positive, |v: f64| v > 0.0);
number!(Strength, |v: f64| (0.0..=1.0).contains(&v));
number!(Counter, |v: f64| v >= 0.0
    && v <= 9_007_199_254_740_991.0
    && v.fract() == 0.0);

#[derive(Debug, Clone, Serialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(transparent)]
pub struct Id(pub String);
pub fn valid_id(v: &str) -> bool {
    !v.is_empty()
        && v.encode_utf16().count() <= 256
        && !["__proto__", "prototype", "constructor"].contains(&v)
}
impl<'de> Deserialize<'de> for Id {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = String::deserialize(d)?;
        if !valid_id(&v) {
            Err(serde::de::Error::custom("Invalid ID"))
        } else {
            Ok(Self(v))
        }
    }
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Units {
    #[serde(rename = "model")]
    Model,
    #[serde(rename = "m")]
    Metres,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Symbol {
    Circle,
    Square,
    Triangle,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Pose {
    Upright,
    Fallen,
}
#[derive(Debug, Clone, Serialize)]
#[serde(transparent)]
pub struct Color(pub String);
impl<'de> Deserialize<'de> for Color {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = String::deserialize(d)?;
        if v.len() == 7 && v.starts_with('#') && v[1..].bytes().all(|b| b.is_ascii_hexdigit()) {
            Ok(Self(v))
        } else {
            Err(serde::de::Error::custom("Expected #RRGGBB"))
        }
    }
}
macro_rules! dto {
    ($name:ident { $($(#[$attr:meta])* $field:ident : $ty:ty),* $(,)? }) => {
        #[derive(Debug, Clone, Serialize, Deserialize)]
        #[serde(rename_all="camelCase", deny_unknown_fields)]
        pub struct $name { $($(#[$attr])* pub $field: $ty),* }
    };
}
dto!(Appearance { fill: Option<Color>, stroke: Option<Color>, stroke_width_px: Option<Nonnegative>, opacity: Option<Strength>, label_visible: Option<bool>, symbol: Option<Symbol>, pose: Option<Pose> });
dto!(MapAppearance { fill: Option<Color>, stroke: Option<Color>, stroke_width_px: Option<Nonnegative>, opacity: Option<Strength>, label_visible: Option<bool> });
dto!(Physical {
    radius: Positive,
    blocks_movement: bool,
    movable: bool
});
dto!(Navigation {
    preferred_speed: Nonnegative,
    maximum_speed: Nonnegative,
    acceleration: Nonnegative,
    personal_space: Nonnegative
});
dto!(Behavior {
    reaction_delay: Nonnegative,
    route_compliance: Strength,
    avoidance_strength: Strength,
    group_cohesion: Strength,
    goal_persistence: Strength
});
dto!(Mobility {
    speed_multiplier: Strength
});
dto!(Components {
    physical: Physical,
    navigation: Navigation,
    behavior: Behavior,
    mobility: Mobility
});
dto!(PhysicalOverride { radius: Option<Positive>, blocks_movement: Option<bool>, movable: Option<bool> });
dto!(NavigationOverride { preferred_speed: Option<Nonnegative>, maximum_speed: Option<Nonnegative>, acceleration: Option<Nonnegative>, personal_space: Option<Nonnegative> });
dto!(BehaviorOverride { reaction_delay: Option<Nonnegative>, route_compliance: Option<Strength>, avoidance_strength: Option<Strength>, group_cohesion: Option<Strength>, goal_persistence: Option<Strength> });
dto!(MobilityOverride { speed_multiplier: Option<Strength> });
dto!(Overrides { physical: Option<PhysicalOverride>, navigation: Option<NavigationOverride>, behavior: Option<BehaviorOverride>, mobility: Option<MobilityOverride> });
dto!(Profile { radius: Positive, preferred_speed: Nonnegative, maximum_speed: Option<Nonnegative>, acceleration: Option<Nonnegative>, personal_space: Option<Nonnegative>, blocks_movement: Option<bool>, movable: Option<bool>, behavior: Option<BehaviorOverride>, mobility: Option<MobilityOverride>, appearance: Option<Appearance> });
dto!(Agent { id: Id, label: Option<String>, tags: Vec<Id>, profile: Id, x: Number, y: Number, controller: Option<Id>, components: Option<Overrides>, appearance: Option<Appearance> });
dto!(Room { id: Id, label: Option<String>, tags: Option<Vec<Id>>, x: Number, y: Number, width: Positive, height: Positive, appearance: Option<MapAppearance> });
dto!(Portal { id: Id, label: Option<String>, tags: Option<Vec<Id>>, x: Number, y: Number, width: Positive, height: Positive, connects: [Id;2], open: bool, one_way: Option<bool>, traversal_time: Option<Nonnegative>, appearance: Option<MapAppearance> });
dto!(Grid { width: Counter, height: Counter, cell_size: Positive, units: Units, blocked: Vec<Counter>, traversal_cost: Vec<Nonnegative>, terrain_speed_multiplier: Option<Vec<Positive>>, zone_index: Vec<Counter>, portal_index: Vec<Counter>, zone_ids: Vec<Option<Id>>, portal_ids: Vec<Option<Id>> });
dto!(Calibration {
    points_px: [[Number; 2]; 2],
    distance_metres: Positive,
    metres_per_pixel: Positive
});
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "lowercase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum MapSource {
    Generate {
        accuracy: String,
    },
    Upload {
        asset_id: Id,
        revision: Id,
        page: Counter,
        #[serde(deserialize_with = "required_calibration")]
        calibration: Option<Calibration>,
        source_to_world: [Number; 6],
    },
    Lookup {
        asset_id: Id,
        revision: Id,
        venue: String,
        floor: String,
    },
}
fn required_calibration<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Calibration>, D::Error> {
    Option::deserialize(d)
}
dto!(Map { width: Positive, height: Positive, cell_size: Positive, units: Units, rooms: Vec<Room>, portals: Vec<Portal>, source: Option<MapSource>, entities: Option<Vec<Entity>>, grid: Option<Grid>, rows: Option<Vec<String>>, legend: Option<BTreeMap<String,Id>> });
dto!(Versions { compiler: Id, model: Id, random: Id, engine: Option<Id> });
dto!(SceneModel {
    units: Units,
    dt: Positive
});
dto!(ClearanceCohort { cohort_ids: Vec<Id>, started_at: Nonnegative });
dto!(Scene { clearance: Option<ClearanceCohort>, schema_version: Counter, simulation_id: Id, seed: Counter, versions: Versions, model: SceneModel, map: Map, profiles: BTreeMap<Id,Profile>, controllers: BTreeMap<Id,Value>, agents: Vec<Agent>, jobs: Vec<Value>, rules: Vec<Value> });
dto!(Layout {
    body_diameter: Positive,
    spacing_diameters: Positive,
    preferred_aspect: Positive,
    door_body_widths: Positive
});
dto!(Model { id: Id, version: Id, units: Units, dt: Positive, default_agent: Components, layout: Layout, contact: Option<Value> });
dto!(Inventory { id: Id, kind: EntityKind, label: Option<String>, tags: Vec<Id>, component_names: Vec<Id> });
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EntityKind {
    Agent,
    Zone,
    Barrier,
    Portal,
    Object,
}
dto!(Capacity { maximum_occupants: Counter, service_rate: Option<Positive> });
dto!(Interaction {
    duration: Nonnegative,
    slots: Counter
});
dto!(EntityPortal { connects: [Id;2], open: bool, one_way: Option<bool>, traversal_time: Option<Nonnegative> });
dto!(EntityComponents { physical: Option<PhysicalOverride>, capacity: Option<Capacity>, interaction: Option<Interaction>, portal: Option<EntityPortal> });
dto!(Entity { id: Id, kind: EntityKind, label: Option<String>, tags: Option<Vec<Id>>, components: Option<EntityComponents>, appearance: Option<MapAppearance>, shape: Option<crate::shapes::Shape> });
dto!(Compiled { scene: Scene, resolved_model: Model, inventory: Vec<Inventory> });
dto!(History { history_revision: Counter, records: Vec<Value>, outcomes: Vec<Value> });
dto!(Command { schema_version: Counter, simulation_id: Id, command_id: Id, r#type: String, compiled: Option<Compiled>, history: Option<History>, ticks: Option<Counter>, multiplier: Option<Positive>, time: Option<Nonnegative>, request: Option<Value>, query: Option<Value>, snapshot: Option<Value>, snapshot_id: Option<Id> });

dto!(Point {
    x: Number,
    y: Number
});
dto!(AgentNavigation { target_entity_id: Option<Id>, target_point: Option<Point>, flow_field_id: Option<Id>, map_version: Counter });
dto!(Timers { reaction_remaining: Nonnegative, wait_remaining: Nonnegative, wander_refresh_remaining: Option<Nonnegative> });
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum GoalKind {
    #[serde(rename = "reach")]
    Reach,
    #[serde(rename = "avoid")]
    Avoid,
    #[serde(rename = "wait")]
    Wait,
    #[serde(rename = "wander")]
    Wander,
    #[serde(rename = "follow")]
    Follow,
    #[serde(rename = "queue")]
    Queue,
    #[serde(rename = "interact")]
    Interact,
    #[serde(rename = "sequence")]
    Sequence,
}
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default)]
pub enum Selection {
    #[serde(rename = "nearest")]
    Nearest,
    #[default]
    #[serde(rename = "lowest-cost")]
    LowestCost,
    #[serde(rename = "random")]
    Random,
}
dto!(GoalSpec {
    kind: GoalKind,
    #[serde(skip_serializing_if = "Option::is_none")] target_zone: Option<Id>,
    #[serde(skip_serializing_if = "Option::is_none")] target_entity_id: Option<Id>,
    #[serde(skip_serializing_if = "Option::is_none")] target_ids: Option<Vec<Id>>,
    #[serde(skip_serializing_if = "Option::is_none")] selection: Option<Selection>,
    #[serde(skip_serializing_if = "Option::is_none")] stop_distance: Option<Nonnegative>,
    #[serde(skip_serializing_if = "Option::is_none")] urgency: Option<Nonnegative>,
    #[serde(skip_serializing_if = "Option::is_none")] duration: Option<Nonnegative>,
    #[serde(skip_serializing_if = "Option::is_none")] inside_zone: Option<Id>,
    #[serde(skip_serializing_if = "Option::is_none")] change_target_every: Option<Positive>,
    #[serde(skip_serializing_if = "Option::is_none")] distance: Option<Nonnegative>,
    #[serde(skip_serializing_if = "Option::is_none")] maximum_wait: Option<Nonnegative>,
    #[serde(skip_serializing_if = "Option::is_none")] goals: Option<Vec<GoalSpec>>,
    #[serde(skip_serializing_if = "Option::is_none")] repeat: Option<Counter>,
    #[serde(skip_serializing_if = "Option::is_none")] depart_on_arrival: Option<bool>
});
dto!(GoalCursor {
    child_index: Counter,
    repeats_remaining: Counter
});
dto!(GoalFailure {
    code: String,
    message: String
});
dto!(GoalExecution { phase: String, elapsed: Nonnegative, target_point: Option<Point> });
dto!(GoalRuntime { id: Id, spec: GoalSpec, status: String, cursor: Vec<GoalCursor>, started_at: Option<Nonnegative>, failure: Option<GoalFailure>, #[serde(default,skip_serializing_if="Option::is_none")] execution: Option<GoalExecution> });
dto!(QueueRef {
    target_id: Id,
    ticket_id: Id,
    joined_at: Nonnegative
});
dto!(InteractionRef {
    target_id: Id,
    slot_id: Id,
    ends_at: Nonnegative
});
dto!(QueueEntry {
    ticket_id: Id,
    agent_id: Id,
    joined_at: Nonnegative
});
dto!(QueueRuntime { target_id: Id, service_credit: Nonnegative, entries: Vec<QueueEntry> });
dto!(InteractionSlot { id: Id, agent_id: Option<Id>, ends_at: Option<Nonnegative> });
dto!(SlotsRuntime { target_id: Id, slots: Vec<InteractionSlot> });
dto!(AgentRuntime {
    id: Id, kind: String, #[serde(skip_serializing_if="Option::is_none")] label: Option<String>, tags: Vec<Id>, profile: Id,
    components: Components, appearance: Value, sensors: Option<Value>, state: String, state_reason: Option<String>,
    position: Point, velocity: Point, zone_id: Option<Id>, controller: Option<Id>, current_goal: Option<GoalRuntime>, goal_queue: Vec<GoalRuntime>,
    navigation: AgentNavigation, timers: Timers, queue_ref: Option<QueueRef>, interaction_ref: Option<InteractionRef>, random_state: u32, departed_at: Option<Nonnegative>
});
dto!(Allocation { next_entity: Counter, next_goal: Counter, next_job: Counter, next_ticket: Counter, next_event: Counter, reserved: Vec<Reservation> });
dto!(Reservation { key: Id, ids: Vec<Id> });
dto!(RandomStreams { layout: u32, placement: u32, rule_sampling: BTreeMap<Id,u32> });
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CreateAction {
    #[serde(rename = "create_intervention")]
    Create,
}
dto!(AgentTemplate { kind: EntityKind, label: Option<String>, tags: Option<Vec<Id>>, profile: Option<Id>, components: Option<Overrides>, appearance: Option<Appearance> });
dto!(PortalRequest { schema_version: Counter, simulation_id: Id, request_id: Id, action: Option<CreateAction>, label: Option<String>, at: Option<Nonnegative>, operations: Vec<Value> });
dto!(PortalSelector { ids: Vec<Id>, kind: Option<EntityKind> });
pub fn preflight(value: &Value) -> Result<(), &'static str> {
    fn visit(
        value: &Value,
        depth: usize,
        nodes: &mut usize,
        nullable: bool,
    ) -> Result<(), &'static str> {
        *nodes += 1;
        if depth > 64 || *nodes > 1_000_000 {
            return Err("JSON resource budget exceeded");
        }
        match value {
            Value::Object(fields) => {
                for (k, v) in fields {
                    if ["__proto__", "prototype", "constructor"].contains(&k.as_str()) {
                        return Err("Reserved property name");
                    }
                    visit(
                        v,
                        depth + 1,
                        nodes,
                        nullable
                            || k == "zoneIds"
                            || k == "portalIds"
                            || k == "calibration"
                            || k == "snapshot"
                            || k == "data",
                    )?;
                }
            }
            Value::Array(items) => {
                for v in items {
                    visit(v, depth + 1, nodes, nullable)?;
                }
            }
            Value::Null if !nullable => return Err("Null is not an optional field value"),
            _ => (),
        }
        Ok(())
    }
    visit(value, 0, &mut 0, false)
}
