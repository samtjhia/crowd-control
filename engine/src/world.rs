use crate::{
    core::{ENGINE_VERSION, Failure, invalid, unsupported},
    grid::{GridData, bounds},
    navigation::Navigator,
    protocol::*,
    random::stream_seed,
};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeSet;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct World {
    pub initial: Compiled,
    pub grid: GridData,
    pub agents: Vec<AgentRuntime>,
    pub tick: u64,
    pub random: RandomStreams,
    pub allocations: Allocation,
    pub map_state: Map,
    pub queues: Vec<QueueRuntime>,
    pub slots: Vec<SlotsRuntime>,
    pub departures: Vec<Value>,
    pub events: Vec<Value>,
    pub removed_count: u64,
    pub runtime: crate::scheduling::Runtime,
    #[serde(skip)]
    pub wander_cells: Vec<Vec<usize>>,
    pub topology_version: u64,
    pub scene_version: u64,
    pub history: History,
    pub request_contents: std::collections::BTreeMap<Id, String>,
    #[serde(skip)]
    pub navigator: Navigator,
    initial_scene_hash: String,
}

impl World {
    pub fn load(initial: Compiled, simulation_id: &Id) -> Result<Self, Failure> {
        let s = &initial.scene;
        let model = &initial.resolved_model;
        if s.schema_version.0 != 1.0
            || &s.simulation_id != simulation_id
            || s.seed.0 > u32::MAX as f64
        {
            return Err(invalid("Invalid scene header or seed"));
        }
        if s.versions.model != model.version
            || s.model.units != model.units
            || s.map.units != model.units
            || s.model.dt.0 != model.dt.0
        {
            return Err(invalid("Model version, units or timestep mismatch"));
        }
        if s.versions.random.0 != "lcg32-v1"
            || s.versions
                .engine
                .as_ref()
                .is_some_and(|v| v.0 != ENGINE_VERSION)
        {
            return Err(unsupported("Unsupported random or engine version"));
        }
        if model.contact.is_some() {
            return Err(unsupported("Contact physics is not currently enabled"));
        }
        if s.agents.len() > 2000 {
            return Err(("RESOURCE_LIMIT", "Agent budget exceeded".into()));
        }
        let grid = GridData::decode(&s.map)?;
        let mut controllers = std::collections::BTreeMap::new();
        let agent_ids = s.agents.iter().map(|a| a.id.clone()).collect();
        for (id, value) in &s.controllers {
            let goal = crate::goals::parse(value)?;
            crate::goals::validate(&goal, &s.map, &grid, &agent_ids)?;
            controllers.insert(id.clone(), goal);
        }
        let mut ids: BTreeSet<Id> = grid
            .zone_ids
            .iter()
            .chain(grid.portal_ids.iter())
            .flatten()
            .cloned()
            .collect();
        for entity in s.map.entities() {
            if !ids.contains(&entity.id) && !ids.insert(entity.id.clone()) {
                return Err(invalid("Duplicate static ID"));
            }
        }
        let mut agents = vec![];
        let mut placement_work = 0usize;
        let mut next_goal = 1u64;
        let mut goal_nodes = 0usize;
        if model.default_agent.navigation.maximum_speed.0
            < model.default_agent.navigation.preferred_speed.0
        {
            return Err(invalid("Invalid default speed range"));
        }
        for p in s.profiles.values() {
            if p.maximum_speed
                .is_some_and(|max| max.0 < p.preferred_speed.0)
            {
                return Err(invalid("Invalid profile speed range"));
            }
        }
        let mut blueprints: Vec<_> = s.agents.iter().collect();
        blueprints.sort_by(|a, b| a.id.cmp(&b.id));
        for a in blueprints {
            if !ids.insert(a.id.clone()) {
                return Err(invalid("Duplicate entity ID"));
            }
            let profile = s
                .profiles
                .get(&a.profile)
                .ok_or_else(|| invalid("Unknown agent profile"))?;
            let components =
                resolve_components(&model.default_agent, profile, a.components.as_ref());
            if components.navigation.maximum_speed.0 < components.navigation.preferred_speed.0 {
                return Err(invalid("Invalid resolved speed range"));
            }
            let radius = components.physical.radius.0;
            bounds(
                a.x.0 - radius,
                a.y.0 - radius,
                2.0 * radius,
                2.0 * radius,
                &s.map,
            )?;
            let footprint = grid.footprint(a.x.0, a.y.0, radius);
            placement_work += footprint.len();
            if placement_work > 2_000_000 {
                return Err((
                    "RESOURCE_LIMIT",
                    "Initial placement work exceeds budget".into(),
                ));
            }
            if footprint.is_empty() || footprint.iter().any(|i| grid.blocked[*i] != 0) {
                return Err((
                    "NO_WALKABLE_SPACE",
                    format!("Agent {} intersects blocked geometry", a.id.0),
                ));
            }
            let mut appearance = json!({"symbol":"circle","fill":"#2563EB","opacity":1});
            for layer in [&profile.appearance, &a.appearance].into_iter().flatten() {
                for (k, v) in wire(layer).as_object().unwrap() {
                    appearance[k] = v.clone();
                }
            }
            let immobile = components.mobility.speed_multiplier.0 == 0.0;
            agents.push(AgentRuntime {
                id: a.id.clone(),
                kind: "agent".into(),
                label: a.label.clone(),
                tags: a.tags.clone(),
                profile: a.profile.clone(),
                components,
                appearance,
                sensors: None,
                state: if immobile { "immobile" } else { "idle" }.into(),
                state_reason: None,
                position: Point { x: a.x, y: a.y },
                velocity: Point {
                    x: Number(0.0),
                    y: Number(0.0),
                },
                zone_id: grid.zone_at(a.x.0, a.y.0),
                controller: None,
                current_goal: None,
                goal_queue: vec![],
                navigation: AgentNavigation {
                    target_entity_id: None,
                    target_point: None,
                    flow_field_id: None,
                    map_version: Counter(0.0),
                },
                timers: Timers {
                    reaction_remaining: Nonnegative(0.0),
                    wait_remaining: Nonnegative(0.0),
                    wander_refresh_remaining: None,
                },
                queue_ref: None,
                interaction_ref: None,
                random_state: stream_seed(s.seed.0 as u32, &format!("agent:{}", a.id.0)),
                departed_at: None,
            });
            if let Some(controller) = &a.controller {
                let definition = controllers
                    .get(controller)
                    .ok_or_else(|| invalid("Unknown controller"))?;
                goal_nodes += crate::goals::nodes(definition);
                if goal_nodes > 64000 {
                    return Err(("RESOURCE_LIMIT", "Runtime goal node budget exceeded".into()));
                }
                let goal = definition.clone();
                let runtime = agents.last_mut().unwrap();
                runtime.controller = Some(controller.clone());
                runtime.current_goal = Some(crate::goals::install(
                    goal,
                    Id(format!("goal-{next_goal}")),
                    0.0,
                    false,
                ));
                if immobile {
                    runtime.current_goal.as_mut().unwrap().status = "suspended".into();
                }
                runtime.timers.reaction_remaining = runtime.components.behavior.reaction_delay;
                next_goal += 1;
            }
        }
        agents.sort_by(|a, b| a.id.cmp(&b.id));
        for (i, a) in agents.iter().enumerate() {
            for b in agents.iter().take(i) {
                let sum = a.components.physical.radius.0 + b.components.physical.radius.0;
                if a.components.physical.blocks_movement
                    && b.components.physical.blocks_movement
                    && sum
                        - crate::geometry::norm(
                            a.position.x.0 - b.position.x.0,
                            a.position.y.0 - b.position.y.0,
                        )
                        > sum * 1e-10
                {
                    return Err((
                        "NO_WALKABLE_SPACE",
                        format!("Agents {} and {} overlap", a.id.0, b.id.0),
                    ));
                }
            }
        }
        let random = RandomStreams {
            layout: s.seed.0 as u32,
            placement: stream_seed(s.seed.0 as u32, "placement"),
            rule_sampling: Default::default(),
        };
        let allocations = Allocation {
            next_entity: Counter(
                s.agents
                    .iter()
                    .filter_map(|a| a.id.0.strip_prefix("a").and_then(|s| s.parse::<u64>().ok()))
                    .max()
                    .unwrap_or(0)
                    .min(9_007_199_254_740_990) as f64
                    + 1.0,
            ),
            next_goal: Counter(next_goal as f64),
            next_job: Counter(1.0),
            next_ticket: Counter(1.0),
            next_event: Counter(1.0),
            reserved: vec![Reservation {
                key: Id("initial".into()),
                ids: ids.into_iter().collect(),
            }],
        };
        // A versioned integrity fingerprint, not an authentication or replay-commit proof.
        let bytes = serde_json::to_vec(&initial).unwrap();
        let hash = bytes.iter().fold(0xcbf29ce484222325u64, |h, b| {
            (h ^ u64::from(*b)).wrapping_mul(0x100000001b3)
        });
        let map_state = initial.scene.map.clone();
        let mut world = Self {
            initial,
            grid,
            agents,
            tick: 0,
            random,
            allocations,
            map_state,
            queues: vec![],
            slots: vec![],
            departures: vec![],
            events: vec![],
            removed_count: 0,
            runtime: Default::default(),
            wander_cells: vec![],
            topology_version: 0,
            scene_version: 1,
            history: History {
                history_revision: Counter(0.0),
                records: vec![],
                outcomes: vec![],
            },
            request_contents: Default::default(),
            navigator: Navigator::default(),
            initial_scene_hash: format!("fnv1a64-v1:{hash:016x}"),
        };
        world.initialize_services();
        world.initialize_runtime()?;
        world.prepare_navigation()?;
        Ok(world)
    }

    pub fn time(&self) -> f64 {
        self.tick as f64 * self.initial.scene.model.dt.0
    }
    pub fn advance(&mut self, ticks: u64) -> Result<(), Failure> {
        let next = self
            .tick
            .checked_add(ticks)
            .filter(|n| {
                *n <= 9_007_199_254_740_991
                    && (*n as f64 * self.initial.scene.model.dt.0).is_finite()
            })
            .ok_or_else(|| ("RESOURCE_LIMIT", "Tick/time range exceeded".into()))?;
        let dynamic_before = if self.has_runtime_work() {
            // Derived navigation caches are rebuilt on rollback; do not copy them twice.
            let navigator = std::mem::take(&mut self.navigator);
            let before = self.clone();
            self.navigator = navigator;
            Some(before)
        } else {
            None
        };
        let before = if dynamic_before.is_none() {
            Some((
                self.agents.clone(),
                self.queues.clone(),
                self.slots.clone(),
                self.allocations.clone(),
                self.departures.clone(),
                self.events.clone(),
                self.tick,
                self.runtime.processed_events,
            ))
        } else {
            None
        };
        let result = (|| -> Result<(), Failure> {
            while self.tick < next {
                self.before_goals()?;
                if !self.navigator.prepared {
                    self.prepare_navigation()?;
                }
                self.navigator.step(
                    &self.grid,
                    &mut self.agents,
                    self.initial.scene.model.dt.0,
                    self.tick,
                )?;
                self.after_goals()?;
                self.tick += 1;
                if self.events.len() > 10000 {
                    return Err(("RESOURCE_LIMIT", "Event retention budget exceeded".into()));
                }
                if self.has_runtime_work() {
                    self.pump()?;
                } else {
                    self.runtime.processed_events = self.events.len();
                }
            }
            Ok(())
        })();
        if let Err(error) = result {
            if let Some(before) = dynamic_before {
                *self = before;
                return Err(error);
            }
            (
                self.agents,
                self.queues,
                self.slots,
                self.allocations,
                self.departures,
                self.events,
                self.tick,
                self.runtime.processed_events,
            ) = before.unwrap();
            self.navigator = Navigator::default();
            return Err(error);
        }
        Ok(())
    }
    pub fn prepare_navigation(&mut self) -> Result<(), Failure> {
        if self.grid.target_cells.is_empty() {
            self.grid.target_cells = crate::shapes::validate_masks(&self.map_state, &self.grid)?;
        }
        let intents = self.goal_intents();
        self.navigator.prepare(
            &self.grid,
            &self.map_state,
            &mut self.agents,
            self.topology_version,
            self.initial.scene.model.dt.0,
            intents,
        )?;
        Ok(())
    }
    pub fn map(&self) -> Value {
        let mut map = wire(&self.map_state);
        map.as_object_mut().unwrap().remove("rows");
        map.as_object_mut().unwrap().remove("legend");
        map["grid"] = serde_json::to_value(&self.grid).unwrap();
        map
    }
    pub fn render_scene(&self) -> Value {
        let agents:Vec<Value>=self.agents.iter().map(|a|{
            let mut metadata=json!({"id":a.id,"radius":a.components.physical.radius,"appearance":a.appearance});
            if let Some(label)=&a.label { metadata["label"]=json!(label); }metadata
        }).collect();
        json!({"map":self.map(),"entities":self.map_state.entities().iter().map(wire).collect::<Vec<_>>(),"agents":agents})
    }
    pub fn frame_agents(&self) -> Value {
        json!(self.agents.iter().map(|a|json!({"id":a.id,"x":a.position.x,"y":a.position.y,"profile":a.profile,"controller":a.controller,"state":a.state})).collect::<Vec<_>>())
    }
    pub fn snapshot(&self, id: &Id) -> Value {
        let mut versions = wire(&self.initial.scene.versions);
        versions["engine"] = json!(ENGINE_VERSION);
        let mut overlays:Vec<Value>=self.agents.iter().enumerate().filter(|(_,a)|a.state=="immobile"&&a.components.physical.blocks_movement).map(|(i,a)|json!({"id":format!("immobile-{}",i+1),"entityId":a.id,"cells":self.grid.footprint(a.position.x.0,a.position.y.0,a.components.physical.radius.0),"kind":"immobile"})).collect();
        for (i, portal) in self
            .map_state
            .all_portals()
            .unwrap()
            .iter()
            .enumerate()
            .filter(|(_, p)| !p.open)
        {
            let index = self
                .grid
                .portal_ids
                .iter()
                .position(|id| id.as_ref() == Some(&portal.id))
                .unwrap() as u32;
            overlays.push(json!({"id":format!("portal-{i}"),"entityId":portal.id,"cells":self.grid.portal_index.iter().enumerate().filter_map(|(i,p)|(*p==index).then_some(i)).collect::<Vec<_>>(),"kind":"portal"}));
        }
        json!({"schemaVersion":1,"simulationId":self.initial.scene.simulation_id,"id":id,"initialSceneHash":self.initial_scene_hash,"versions":versions,
            "tick":self.tick,"model":wire(&self.initial.resolved_model),"map":self.map(),"topologyVersion":self.topology_version,"overlays":overlays,"entities":self.map_state.entities().iter().map(wire).collect::<Vec<_>>(),"entityOrigins":self.runtime.entity_origins,
            "profiles":wire(&self.initial.scene.profiles),"controllers":wire(&self.initial.scene.controllers),"agents":self.agents,"jobs":self.runtime.jobs,"rules":self.runtime.rules,"queues":self.queues,"slots":self.slots,"allocations":self.allocations,"random":self.random,
            "metrics":{"samples":[],"departures":self.departures,"removedCount":self.removed_count,"portalCrossings":[],"queueTotals":[],"clearance":null},"events":self.events,"historyRevision":self.history.history_revision,
            "appliedThrough":{"tick":self.tick,"order":self.history.records.len(),"prefixHash":fingerprint(&self.history.records)},"contactState":null})
    }
}
pub fn fingerprint<T: Serialize>(value: &T) -> String {
    let hash = serde_json::to_vec(value)
        .unwrap()
        .iter()
        .fold(0xcbf29ce484222325u64, |h, b| {
            (h ^ u64::from(*b)).wrapping_mul(0x100000001b3)
        });
    format!("fnv1a64-v1:{hash:016x}")
}

pub(crate) fn resolve_components(
    base: &Components,
    profile: &Profile,
    overrides: Option<&Overrides>,
) -> Components {
    let mut c = base.clone();
    c.physical.radius = profile.radius;
    c.navigation.preferred_speed = profile.preferred_speed;
    macro_rules! fields { ($dest:expr,$src:expr,$($field:ident),+) => { if let Some(source)=$src { $(if let Some(value)=source.$field { $dest.$field=value; })+ } }; }
    if let Some(value) = profile.blocks_movement {
        c.physical.blocks_movement = value;
    }
    if let Some(value) = profile.movable {
        c.physical.movable = value;
    }
    if let Some(value) = profile.maximum_speed {
        c.navigation.maximum_speed = value;
    }
    if let Some(value) = profile.acceleration {
        c.navigation.acceleration = value;
    }
    if let Some(value) = profile.personal_space {
        c.navigation.personal_space = value;
    }
    fields!(
        c.behavior,
        profile.behavior.as_ref(),
        reaction_delay,
        route_compliance,
        avoidance_strength,
        group_cohesion,
        goal_persistence
    );
    fields!(c.mobility, profile.mobility.as_ref(), speed_multiplier);
    if let Some(o) = overrides {
        fields!(
            c.physical,
            o.physical.as_ref(),
            radius,
            blocks_movement,
            movable
        );
        fields!(
            c.navigation,
            o.navigation.as_ref(),
            preferred_speed,
            maximum_speed,
            acceleration,
            personal_space
        );
        fields!(
            c.behavior,
            o.behavior.as_ref(),
            reaction_delay,
            route_compliance,
            avoidance_strength,
            group_cohesion,
            goal_persistence
        );
        fields!(c.mobility, o.mobility.as_ref(), speed_multiplier);
    }
    c
}

/// Input DTO optionals are omitted on the wire; runtime nullable state is serialized separately.
pub fn wire<T: Serialize>(value: &T) -> Value {
    fn omit(value: &mut Value) {
        match value {
            Value::Object(fields) => {
                fields.retain(|key, v| key == "calibration" || !v.is_null());
                for v in fields.values_mut() {
                    omit(v);
                }
            }
            Value::Array(items) => {
                for v in items {
                    omit(v);
                }
            }
            _ => (),
        }
    }
    let mut value = serde_json::to_value(value).unwrap();
    omit(&mut value);
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pending_jobs_rules_and_sampling_resume_and_batch_independently() {
        let input: Value =
            serde_json::from_str(include_str!("../../contract/fixtures/engine-load.json")).unwrap();
        let initial = serde_json::from_value(input["compiled"].clone()).unwrap();
        let mut batched = World::load(initial, &Id("engine-demo".into())).unwrap();
        batched.advance(7).unwrap();
        let mut restored: World =
            serde_json::from_value(serde_json::to_value(&batched).unwrap()).unwrap();
        batched.advance(220).unwrap();
        for _ in 0..220 {
            restored.advance(1).unwrap();
        }
        assert_eq!(
            batched.snapshot(&Id("same".into())),
            restored.snapshot(&Id("same".into()))
        );
    }
    #[test]
    fn service_serialization_preserves_fifo_credit_slots_and_nested_cursors() {
        let input: Value = serde_json::from_str(include_str!(
            "../../contract/fixtures/engine-services-load.json"
        ))
        .unwrap();
        let initial = serde_json::from_value(input["compiled"].clone()).unwrap();
        let mut world = World::load(initial, &Id("engine-demo".into())).unwrap();
        world.advance(7).unwrap();
        let mut restored: World =
            serde_json::from_str(&serde_json::to_string(&world).unwrap()).unwrap();
        for _ in 0..100 {
            world.advance(1).unwrap();
            restored.advance(1).unwrap();
            assert_eq!(
                world.snapshot(&Id("saved".into())),
                restored.snapshot(&Id("saved".into()))
            );
        }
    }
    #[test]
    fn movement_failure_rolls_back_the_whole_batch() {
        let input: Value = serde_json::from_str(include_str!(
            "../../contract/fixtures/engine-movement-load.json"
        ))
        .unwrap();
        let initial = serde_json::from_value(input["compiled"].clone()).unwrap();
        let mut world = World::load(initial, &Id("engine-demo".into())).unwrap();
        world.agents[0].components.navigation.preferred_speed = Nonnegative(10000.0);
        world.agents[0].components.navigation.maximum_speed = Nonnegative(10000.0);
        world.agents[0].timers.reaction_remaining = Nonnegative(0.05);
        let before = world.snapshot(&Id("saved".into()));
        assert_eq!(world.advance(2).unwrap_err().0, "RESOURCE_LIMIT");
        assert_eq!(world.snapshot(&Id("saved".into())), before);
    }
    #[test]
    fn terrain_and_immobile_serialization_resume_without_resetting_goals() {
        let input: Value = serde_json::from_str(include_str!(
            "../../contract/fixtures/engine-movement-load.json"
        ))
        .unwrap();
        let initial = serde_json::from_value(input["compiled"].clone()).unwrap();
        let mut world = World::load(initial, &Id("engine-demo".into())).unwrap();
        world.advance(17).unwrap();
        let stop = json!({"schemaVersion":1,"simulationId":"engine-demo","requestId":"stop","operations":[{"op":"set","targets":{"ids":["a1"]},"values":{"components":{"mobility":{"speedMultiplier":0}},"appearance":{"pose":"fallen"}}}]});
        assert_eq!(world.apply_request(&stop).unwrap()["ok"], true);
        let mut restored: World =
            serde_json::from_str(&serde_json::to_string(&world).unwrap()).unwrap();
        for w in [&mut world, &mut restored] {
            w.advance(20).unwrap();
            let recover = json!({"schemaVersion":1,"simulationId":"engine-demo","requestId":"recover","operations":[{"op":"set","targets":{"ids":["a1"]},"values":{"components":{"mobility":{"speedMultiplier":1}},"appearance":{"pose":"upright"}}}]});
            assert_eq!(w.apply_request(&recover).unwrap()["ok"], true);
            w.advance(30).unwrap();
        }
        assert_eq!(
            restored.snapshot(&Id("saved".into())),
            world.snapshot(&Id("saved".into()))
        );
        assert_eq!(restored.history.outcomes, world.history.outcomes);
    }
    #[test]
    fn shared_fields_and_active_roundtrip_preserve_route_progress() {
        let mut input: Value = serde_json::from_str(include_str!(
            "../../contract/fixtures/engine-static-load.json"
        ))
        .unwrap();
        input["compiled"]["scene"]["controllers"] =
            json!({"leave":{"kind":"reach","targetZone":"outside"}});
        for agent in input["compiled"]["scene"]["agents"].as_array_mut().unwrap() {
            agent["controller"] = json!("leave");
        }
        let initial: Compiled = serde_json::from_value(input["compiled"].clone()).unwrap();
        let mut world = World::load(initial, &Id("engine-demo".into())).unwrap();
        assert_eq!(world.navigator.field_count(), 1);
        world.advance(17).unwrap();
        let encoded = serde_json::to_string(&world).unwrap();
        let mut restored: World = serde_json::from_str(&encoded).unwrap();
        restored.advance(21).unwrap();
        world.advance(21).unwrap();
        assert_eq!(
            restored.snapshot(&Id("saved".into())),
            world.snapshot(&Id("saved".into()))
        );
        assert_eq!(restored.navigator.field_count(), 1);
    }
    #[test]
    fn world_roundtrip_preserves_independent_state() {
        let input: Value = serde_json::from_str(include_str!(
            "../../contract/fixtures/engine-static-load.json"
        ))
        .unwrap();
        let initial: Compiled = serde_json::from_value(input["compiled"].clone()).unwrap();
        let mut world = World::load(initial, &Id("engine-demo".into())).unwrap();
        world.advance(123).unwrap();
        crate::random::next(&mut world.agents[0].random_state);
        world.agents[0].components.behavior.group_cohesion = Strength(0.75);
        world.agents[0].components.navigation.personal_space = Nonnegative(0.1 + 0.2);
        world.agents[0].timers.wait_remaining = Nonnegative(1.4000000000000001);
        assert_eq!(world.agents[1].components.behavior.group_cohesion.0, 0.0);
        let encoded = serde_json::to_string(&world).unwrap();
        let restored: World = serde_json::from_str(&encoded).unwrap();
        assert_eq!(
            serde_json::to_value(&restored).unwrap(),
            serde_json::to_value(&world).unwrap()
        );
        assert_eq!(
            restored.snapshot(&Id("saved".into())),
            world.snapshot(&Id("saved".into()))
        );
    }
}
