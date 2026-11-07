//! Part-one input DTOs. Unsupported executable payloads are retained only to reject them.
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
    ($name:ident { $($field:ident : $ty:ty),* $(,)? }) => {
        #[derive(Debug, Clone, Serialize, Deserialize)]
        #[serde(rename_all="camelCase", deny_unknown_fields)]
        pub struct $name { $(pub $field: $ty),* }
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
dto!(Grid { width: Counter, height: Counter, cell_size: Positive, units: Units, blocked: Vec<Counter>, traversal_cost: Vec<Nonnegative>, zone_index: Vec<Counter>, portal_index: Vec<Counter>, zone_ids: Vec<Option<Id>>, portal_ids: Vec<Option<Id>> });
dto!(Map { width: Positive, height: Positive, cell_size: Positive, units: Units, rooms: Vec<Room>, portals: Vec<Portal>, source: Option<Value>, entities: Option<Vec<Value>>, grid: Option<Grid>, rows: Option<Vec<String>>, legend: Option<BTreeMap<String,Id>> });
dto!(Versions { compiler: Id, model: Id, random: Id, engine: Option<Id> });
dto!(SceneModel {
    units: Units,
    dt: Positive
});
dto!(Scene { schema_version: Counter, simulation_id: Id, seed: Counter, versions: Versions, model: SceneModel, map: Map, profiles: BTreeMap<Id,Profile>, controllers: BTreeMap<Id,Value>, agents: Vec<Agent>, jobs: Vec<Value>, rules: Vec<Value> });
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
dto!(Compiled { scene: Scene, resolved_model: Model, inventory: Vec<Inventory> });
dto!(History { history_revision: Counter, records: Vec<Value>, outcomes: Vec<Value> });
dto!(Command { schema_version: Counter, simulation_id: Id, command_id: Id, r#type: String, compiled: Option<Compiled>, history: Option<History>, ticks: Option<Counter>, multiplier: Option<Positive>, time: Option<Nonnegative>, request: Option<Value>, query: Option<Value>, snapshot: Option<Value>, snapshot_id: Option<Id> });

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
                    visit(v, depth + 1, nodes, k == "zoneIds" || k == "portalIds")?;
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
