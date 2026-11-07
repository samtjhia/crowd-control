import type { Id, Result } from './common.js';
import type { ServiceResult } from './adapters.js';
import type { ApplyAck } from './history.js';
import type { ReadQuery } from './metrics.js';
import type { FollowupRequest, PlannerReply, PlannerRequest, ScenarioPlan } from './planner.js';
import type { ReadReply } from './worker.js';
import type { CompileOutput } from './world.js';

export type SimulationActions = {
  apply(request: FollowupRequest): Promise<Result<ApplyAck>>;
  query(query: ReadQuery): Promise<Result<ReadReply>>;
};
export type ChatPanelProps = {
  simulationId: Id; context: PlannerRequest['context'];
  plan(request: PlannerRequest): Promise<ServiceResult<PlannerReply>>;
  startScenario(plan: ScenarioPlan): Promise<Result<CompileOutput>>;
  actions: SimulationActions;
};
