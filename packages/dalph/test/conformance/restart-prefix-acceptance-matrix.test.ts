import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Layer, Option, Ref, Semaphore } from "effect"
import * as Cause from "effect/Cause"
import type { Scope } from "effect"
import { expect } from "vitest"
import {
  GitCommitSha,
  makeTaskWorkSpecification,
  PlannedAttemptExecutor,
  TaskExecutorLocator,
  WorktreeLocator
} from "@dalph/contracts"
import {
  InRunJournal,
  targetPromotionCorrelationEquals,
  appendPromotionStaleIntegrationQuarantine,
  type JournalRecord,
  makeIntegrationTargetResourceController
} from "@dalph/orchestrator"
import { CoordinatorOwnership } from "../../../orchestrator/src/authorities/coordinator-ownership/ownership.js"
import type {
  IntegrationTargetResourceController,
  IntegrationTargetResourceSnapshot
} from "../../../orchestrator/src/coordination/admission/integration-target-resource.js"
import { makeApplicationExitLifecycle } from "../../../orchestrator/src/coordination/application-exit/lifecycle.js"
import { ApplicationExiting } from "../../../orchestrator/src/coordination/application-exit/lifecycle-decision.js"
import {
  WorkflowInterpreter,
  WorkflowTrace,
  AuthoritativeTargetLineageObserved,
  AuthoritativeTaskClaimObserved,
  AuthoritativePlannedAttemptWorktreeObserved
} from "../../../orchestrator/src/workflow/interpretation/interpreter.js"
import { journaledWorkflowInterpreterLayer } from "../../../orchestrator/src/workflow-journal/journaled-interpreter.js"
import {
  DeliveryActionExecutor,
  type MaterializedDeliveryAction,
  DeliverySemanticTrace
} from "../../../orchestrator/src/coordination/delivery/delivery-action-executor.js"
import { deliveryRuntime } from "../../../orchestrator/src/coordination/delivery/delivery-runtime-adapter.js"
import {
  deliveryRuntimeResourceCapabilitiesLayer,
  deliveryRuntimeResourceCapabilitiesOf
} from "../../../orchestrator/src/coordination/delivery/delivery-runtime-resources.js"
import { DeliveryRelationPublicationObserver } from "../../../orchestrator/src/coordination/delivery/delivery-publication-observer.js"
import { makeLiveDeliveryActionExecutor } from "../../../orchestrator/src/coordination/delivery/live-delivery-action-executor.js"
import { makeJournal } from "../../../orchestrator/src/coordination/delivery/journal.js"
import { makeReactiveDeliveryRelationsLayer } from "../../../orchestrator/src/coordination/delivery/reactive-delivery-relations.js"
import { runDeliveryRuntimePhase } from "../../../orchestrator/src/coordination/delivery/run-delivery-runtime.js"
import { DeliveryRuntimeObservationObserver } from "../../../orchestrator/src/coordination/delivery/delivery-runtime-observation.js"
import { projectTrackerSnapshot } from "../../../orchestrator/src/authorities/task-tracker/graph.js"
import { requiredPlannedAttemptPositionsOf } from "../../../orchestrator/src/coordination/run/required-planned-attempt-positions.js"
import { deriveIntegrationAdmission } from "../../../orchestrator/src/workflow/protocols/integration-admission/protocol.js"
import { OperationId } from "../../../orchestrator/src/workflow/identity.js"
import {
  expectedRecoveryPrefix,
  prefixThrough,
  recoveryPrefixMismatch,
  replayRecoveryPrefix,
  withRecoveryPrefixStore,
  type RecoveryPrefix,
  type RecoveryStoreLane
} from "./recovery-store-lanes.js"
import { maintainedAuthoredCassetteCatalog, runAuthoredScenarioCassette } from "../../src/cassettes/index.js"
import {
  makeRunRecoveryProjection,
  type RunRecoveryProjectionSnapshot
} from "../../../orchestrator/src/coordination/run/recovery-activation.js"
import { appendIntegratorSuccessorSessionIfNeeded } from "../../../orchestrator/src/workflow/protocols/integrator/successor-session.js"
import {
  IntegratorSuccessorPreparationInput,
  type IntegratorSuccessorPreparationInput as IntegratorSuccessorPreparationInputType
} from "../../../orchestrator/src/workflow/protocols/integrator/session.js"
import {
  TargetPromotionRuntime,
  type TargetPromotionRuntimeInput
} from "../../../orchestrator/src/workflow/protocols/target-promotion/runtime.js"
import {
  TargetPromotionCompareAndSetResult,
  TargetPromotionGitReadObservation,
  targetPromotionGitRequestFor,
  type TargetPromotionRequestId,
  type TargetPromotionGitRequest as TargetPromotionGitRequestType
} from "../../../orchestrator/src/workflow/protocols/target-promotion/events.js"
import {
  Integrator,
  type IntegratorCandidateText,
  IntegratorGit,
  IntegratorGitObservation,
  IntegratorResult,
  prepareIntegrationCandidateRun
} from "../../../orchestrator/src/workflow/protocols/integrator/protocol.js"
import type {
  IntegratorRequest,
  IntegratorSessionId
} from "../../../orchestrator/src/workflow/protocols/integrator/events.js"
import {
  makePlannedAttemptProtocolController,
  PlannedAttemptProtocolController
} from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import {
  OperationIdAllocator,
  deterministicPlannedTaskAttemptLayer
} from "../../../orchestrator/src/workflow/protocols/task-attempt-planning/plan.js"
import { TaskClaimAcquisitionPlanner } from "../../../orchestrator/src/workflow/protocols/task-claim-acquisition/plan.js"
import {
  makeTargetLineageObservationOperation,
  type WorkflowOperation
} from "../../../orchestrator/src/workflow/registry/operation.js"
import { GitReadIntentRecordedEvent } from "../../../orchestrator/src/workflow/registry/event.js"
import { intentRecordKey } from "../../../orchestrator/src/workflow-journal/record-key.js"
import { reduceWorkflowJournalHistory } from "../../../orchestrator/src/coordination/reconstruction/history.js"
import type { JournalStore } from "../../../orchestrator/src/workflow-journal/store.js"
import { GitTargetLineageReadFailure } from "../../../orchestrator/src/authorities/git/target-lineage.js"
import {
  CompletionTaskClaim,
  FocusedTaskCompletionFacts
} from "../../../orchestrator/src/workflow/protocols/integration-finality/events.js"
import { TrackerRevision } from "../../../orchestrator/src/authorities/task-tracker/task.js"
import { UnclaimedTask } from "../../../orchestrator/src/authorities/task-tracker/claim-mutation.js"
import {
  controlledCompletionClaimBoundaryLayerFrom,
  controlledCompletionTaskBoundaryLayerFrom
} from "../../../orchestrator/src/workflow/protocols/integration-finality/controlled-boundaries.js"

const lanes: ReadonlyArray<RecoveryStoreLane> = ["memory", "sqlite"]
const restartPrefixCutLabels = [
  "AttemptIntended",
  "Stale",
  "Quarantined",
  "DirectionApplied",
  "FreshReadIntent",
  "FreshLineage",
  "SuccessorFixed"
] as const
type RestartPrefixCutLabel = (typeof restartPrefixCutLabels)[number]

const expectedRestartActionTags: Readonly<Record<RestartPrefixCutLabel, string>> = {
  AttemptIntended: "RunTargetPromotion",
  Stale: "RecordPromotionStaleIntegrationQuarantine",
  Quarantined: "ReleaseStartedIntegrationTarget",
  DirectionApplied: "Recovered:ReadTargetLineage",
  FreshReadIntent: "ObservePlannedAttemptContinuationTargetLineage",
  FreshLineage: "FixIntegratorSuccessorSession",
  SuccessorFixed: "DeleteCompletedTaskCompletionClaim"
}

/** Reads and acquisition may race while the selected restart action is in flight. */
const restartConcurrentActionTags: ReadonlySet<string> = new Set([
  "TrackerGraphReadRoute",
  "Recovered:ReadTrackerGraph",
  "Recovered:ReadTaskClaim",
  "Recovered:ReadTaskWorkSpecification",
  "Recovered:ReadTaskWorktree",
  "Recovered:ReadTargetLineage",
  "AcquireStartedIntegrationTarget"
])

const restartMilestoneTags: Readonly<Record<RestartPrefixCutLabel, ReadonlyArray<string>>> = {
  AttemptIntended: ["RunTargetPromotion"],
  Stale: ["RecordPromotionStaleIntegrationQuarantine"],
  Quarantined: ["ReleaseStartedIntegrationTarget"],
  DirectionApplied: ["Recovered:ReadTargetLineage"],
  FreshReadIntent: ["ObservePlannedAttemptContinuationTargetLineage"],
  FreshLineage: ["FixIntegratorSuccessorSession"],
  SuccessorFixed: [
    "RunIntegrator",
    "RunTargetPromotion",
    "ReplacePromotedTaskClaim",
    "CompletePromotedTask",
    "ObserveFocusedTaskCompletion",
    "DeleteCompletedTaskCompletionClaim"
  ]
}

/** Ordinary runtime G2 stabilization may publish these records before the selected action. */
const ordinaryGraphStabilizationEventTags: ReadonlySet<JournalRecord["event"]["_tag"]> = new Set([
  "TaskTrackerReadIntentRecorded",
  "TaskTrackerFactsObserved"
])

const sourceRun = () =>
  runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.deliveryInvariantStoryCapstone).pipe(
    Effect.provide(NodeCrypto.layer)
  )

const exactlyOne = <A>(values: ReadonlyArray<A>, description: string): A => {
  const value = values.length === 1 ? values[0] : undefined
  return value === undefined ? expect.fail("expected one " + description + ", received " + values.length) : value
}

/** Replays the latest complete tracker facts as the controlled provider result for G2. */
const graphSnapshotFrom = (records: ReadonlyArray<JournalRecord>) => {
  const graphRecord = records.findLast(
    ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "CompleteTaskTrackerFacts"
  )
  if (
    graphRecord?.event._tag !== "TaskTrackerFactsObserved" ||
    graphRecord.event.observation._tag !== "CompleteTaskTrackerFacts"
  ) {
    return undefined
  }
  const [identities, lifecycles, prerequisites, groupings] = graphRecord.event.observation.factFamilies
  const tasks = []
  for (const taskId of identities.taskIds) {
    const lifecycle = lifecycles.lifecycles.find((entry) => entry.taskId === taskId)
    const prerequisitesForTask = prerequisites.prerequisites.find((entry) => entry.taskId === taskId)
    const grouping = groupings.groupings.find((entry) => entry.taskId === taskId)
    if (lifecycle === undefined || prerequisitesForTask === undefined || grouping === undefined) return undefined
    tasks.push({
      id: taskId,
      lifecycle: lifecycle.lifecycle,
      parentTaskId: grouping.parentTaskId,
      prerequisiteIds: prerequisitesForTask.prerequisiteTaskIds
    })
  }
  const projected = projectTrackerSnapshot({
    revision: identities.contentIdentity,
    rootTaskId: graphRecord.event.observation.rootTaskId,
    tasks
  })
  return projected._tag === "Invalid" ? undefined : projected.snapshot
}

const isTargetLineageReadIntent = (record: JournalRecord): boolean =>
  record.event._tag === "GitReadIntentRecorded" && record.event.operation._tag === "ReadTargetLineage"

/** The seven durable cut points that must survive a process restart in DS14-17. */
type CompleteGraphSnapshot = NonNullable<ReturnType<typeof graphSnapshotFrom>>

interface RestartPrefixMatrix {
  readonly prefixes: ReadonlyArray<RecoveryPrefix<RestartPrefixCutLabel>>
  /** The complete post-finality graph authority used by the controlled G3 read. */
  readonly completedGraph: CompleteGraphSnapshot
  readonly attempt: JournalRecord
  readonly stale: JournalRecord
  readonly quarantine: JournalRecord
  readonly direction: JournalRecord
  readonly successorReadIntent: JournalRecord
  readonly successorLineage: JournalRecord
  readonly successor: JournalRecord
  readonly successorRunStarted: JournalRecord
  readonly successorRunResult: JournalRecord
  readonly successorGitObserved: JournalRecord
  readonly successorPromotion: JournalRecord
}

interface ObservedAction {
  readonly materializedTag: MaterializedDeliveryAction["_tag"]
  readonly proposalId: string
  readonly routeTag: string
  readonly semanticTag: string
  readonly operationId: OperationId | undefined
}

interface TargetPromotionBoundaryCall {
  readonly _tag: "read" | "compareAndSet"
  readonly operationIdentity: TargetPromotionRequestId
  readonly request: TargetPromotionGitRequestType
}

interface IntegratorGitBoundaryCall {
  readonly operationIdentity: IntegratorSessionId
  readonly target: TargetPromotionGitRequestType["integrationTarget"]
  readonly candidateText: IntegratorCandidateText
}

interface BoundaryCalls {
  readonly targetPromotion: ReadonlyArray<TargetPromotionBoundaryCall>
  readonly integrator: ReadonlyArray<IntegratorRequest>
  readonly integratorGit: ReadonlyArray<IntegratorGitBoundaryCall>
}

interface ResourceCallLog {
  readonly acquireCount: number
  readonly acceptedPublicationCount: number
  readonly releaseCount: number
  readonly releaseAllCount: number
  readonly releasePositions: ReadonlyArray<unknown>
}

interface ResourceOwnershipObservation {
  readonly integration: IntegrationTargetResourceSnapshot
  readonly taskWorkHeld: ReadonlyArray<unknown>
  readonly liveOwnerCount: number
  readonly forwardOwnerCount: number
  readonly protocolOwnerCount: number
}

interface OrdinaryActivation {
  readonly records: ReadonlyArray<JournalRecord>
  readonly actions: ReadonlyArray<ObservedAction>
  /** Every materialized action handed to the live executor, including failed actions. */
  readonly invokedActions: ReadonlyArray<ObservedAction>
  /** Appends performed after the retained prefix was installed. */
  readonly journalAppendCount: number
  readonly boundaryCalls: BoundaryCalls
  readonly ownership: ReadonlyArray<ResourceOwnershipObservation>
  readonly resourceCalls: ResourceCallLog
  readonly protocolOwnerCount: number
  readonly knownIntegrationResponsibilityPositions: ReadonlySet<unknown>
  readonly expectedTaskWorkHeld: ReadonlyArray<unknown>
  readonly foreignReadFailure: GitTargetLineageReadFailure | undefined
}

interface DispatchResult {
  readonly before: ReadonlyArray<JournalRecord>
  readonly after: ReadonlyArray<JournalRecord>
  readonly redelivered: ReadonlyArray<JournalRecord>
  readonly first: OrdinaryActivation
  readonly redeliveredActivation: OrdinaryActivation
}

/** Narrows the exact successor relation used to derive its fresh read and run identity. */
type IntegratorSuccessorSessionFixedRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorSuccessorSessionFixed" }>
}

const isIntegratorSuccessorSessionFixedRecord = (
  record: JournalRecord
): record is IntegratorSuccessorSessionFixedRecord => record.event._tag === "IntegratorSuccessorSessionFixed"

const observedActionOf = (action: MaterializedDeliveryAction): ObservedAction => {
  if (action._tag === "IdentityFreeAction") {
    const route = action.proposal.route
    return {
      materializedTag: action._tag,
      operationId: undefined,
      proposalId: String(action.proposal.id),
      routeTag: route._tag,
      semanticTag: route._tag === "IdentityFreeWorkflowRoute" ? route.transition._tag : route._tag
    }
  }
  if (action._tag === "AcceptedOperationAction") {
    return {
      materializedTag: action._tag,
      operationId:
        "operationId" in action.proposal.route.transition
          ? action.proposal.route.transition.operationId
          : action.proposal.route.transition.operation._tag === "ReleaseTaskClaim"
            ? action.proposal.route.transition.operation.release.operationId
            : action.proposal.route.transition.operation.operationId,
      proposalId: String(action.proposal.id),
      routeTag: action.proposal.route._tag,
      semanticTag: action.proposal.route.transition._tag
    }
  }
  if (action._tag === "FreshOperationAction") {
    const route = action.proposal.route
    return {
      materializedTag: action._tag,
      operationId: action.operationId,
      proposalId: String(action.proposal.id),
      routeTag: route._tag,
      semanticTag: route._tag === "RecoveredNewActionRoute" ? "Recovered:" + route.action._tag : route._tag
    }
  }
  return {
    materializedTag: action._tag,
    operationId: action.operationId,
    proposalId: String(action.proposal.id),
    routeTag: action.proposal.route._tag,
    semanticTag: action.proposal.route._tag
  }
}

/**
 * Checks the restart action contract without treating scheduler interleaving as
 * workflow order. Reads can race, but each selected milestone has one exact
 * materialization, identity, and order; no unrelated action may be admitted.
 */
const assertRestartActionTrace = (
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  matrix: RestartPrefixMatrix,
  lane: RecoveryStoreLane,
  activation: OrdinaryActivation
): void => {
  const label = prefix.cut + " / " + lane
  const actions = activation.actions
  const milestoneTags = restartMilestoneTags[prefix.cut]
  const milestoneIndexes = milestoneTags.map((semanticTag) => {
    const matches = actions.filter((action) => action.semanticTag === semanticTag)
    return actions.indexOf(exactlyOne(matches, label + " exact milestone " + semanticTag))
  })

  expect(new Set(actions.map(({ proposalId }) => proposalId)).size, label + " proposal identity singleton").toBe(
    actions.length
  )
  const operationIds = actions.flatMap(({ operationId }) => (operationId === undefined ? [] : [String(operationId)]))
  expect(new Set(operationIds).size, label + " operation identity singleton").toBe(operationIds.length)
  for (let index = 1; index < milestoneIndexes.length; index += 1) {
    const previous = milestoneIndexes[index - 1]
    const current = milestoneIndexes[index]
    if (previous === undefined || current === undefined) {
      expect.fail(label + " milestone index missing")
      return
    }
    expect(previous, label + " milestone order").toBeLessThan(current)
  }

  for (const action of actions) {
    if (milestoneTags.includes(action.semanticTag)) continue
    expect(restartConcurrentActionTags.has(action.semanticTag), label + " unrelated action " + action.semanticTag).toBe(
      true
    )
  }

  const selected = actions[milestoneIndexes[0] ?? -1]
  if (selected === undefined) return
  const expectedMaterializedTag =
    prefix.cut === "DirectionApplied"
      ? "FreshOperationAction"
      : prefix.cut === "FreshReadIntent"
        ? "AcceptedOperationAction"
        : "IdentityFreeAction"
  const expectedRouteTag =
    prefix.cut === "DirectionApplied"
      ? "RecoveredNewActionRoute"
      : prefix.cut === "FreshReadIntent"
        ? "AcceptedWorkflowRoute"
        : "IdentityFreeWorkflowRoute"
  expect(selected.materializedTag, label + " selected materialization").toBe(expectedMaterializedTag)
  expect(selected.routeTag, label + " selected route").toBe(expectedRouteTag)

  if (prefix.cut === "FreshReadIntent") {
    const successorReadIntent = matrix.successorReadIntent.event
    if (successorReadIntent._tag !== "GitReadIntentRecorded") {
      expect.fail(label + " fixture lacks typed successor read intent")
      return
    }
    expect(selected.operationId, label + " accepted operation identity").toEqual(
      successorReadIntent.operation.operationId
    )
    expect(
      successorReadIntent.operation.predecessorOperationIds.length,
      label + " accepted predecessors"
    ).toBeGreaterThan(0)
    for (const predecessorOperationId of successorReadIntent.operation.predecessorOperationIds) {
      expect(
        prefix.records.some(
          ({ event }) =>
            (event._tag === "GitReadIntentRecorded" || event._tag === "TaskTrackerReadIntentRecorded") &&
            event.operation.operationId === predecessorOperationId
        ),
        label + " accepted predecessor " + predecessorOperationId
      ).toBe(true)
    }
  }

  if (prefix.cut === "DirectionApplied") {
    if (selected.operationId === undefined) {
      expect.fail(label + " fresh target-lineage action lacks an operation identity")
      return
    }
    expect(
      activation.records.filter(
        ({ event }) => event._tag === "TargetLineageObserved" && event.operationId === selected.operationId
      ),
      label + " target-lineage operation identity"
    ).toHaveLength(1)
  }
}

const restartPrefixesFrom = (records: ReadonlyArray<JournalRecord>): RestartPrefixMatrix => {
  const stale = exactlyOne(
    records.filter(({ event }) => event._tag === "TargetPromotionStale"),
    "TargetPromotionStale"
  )
  if (stale.event._tag !== "TargetPromotionStale") {
    return expect.fail("restart-prefix stale event narrowing failed")
  }
  const staleCorrelation = stale.event.correlation
  const attempt = exactlyOne(
    records.filter(
      ({ event }) =>
        event._tag === "TargetPromotionAttemptIntended" &&
        targetPromotionCorrelationEquals(event.correlation, staleCorrelation)
    ),
    "TargetPromotionAttemptIntended for the stale predecessor"
  )
  const quarantine = exactlyOne(
    records.filter(({ event }) => event._tag === "IntegrationQuarantined" && event.basis._tag === "PromotionStale"),
    "PromotionStale IntegrationQuarantined"
  )
  const direction = exactlyOne(
    records.filter(
      ({ event }) =>
        event._tag === "IntegrationQuarantineDirectionApplied" && event.fingerprint.direction === "FullRerun"
    ),
    "FullRerun IntegrationQuarantineDirectionApplied"
  )
  const successor = exactlyOne(
    records.filter(isIntegratorSuccessorSessionFixedRecord),
    "IntegratorSuccessorSessionFixed"
  )
  if (
    attempt.event._tag !== "TargetPromotionAttemptIntended" ||
    quarantine.event._tag !== "IntegrationQuarantined" ||
    direction.event._tag !== "IntegrationQuarantineDirectionApplied"
  ) {
    return expect.fail("restart-prefix fixture event narrowing failed")
  }
  const successorEvent = successor.event
  const successorReadIntent = exactlyOne(
    records.filter(
      (record) =>
        isTargetLineageReadIntent(record) &&
        record.position > direction.position &&
        record.position < successor.position &&
        record.event._tag === "GitReadIntentRecorded" &&
        record.event.operation.plannedAttempt.attemptId === successorEvent.successor.plannedAttempt.attemptId
    ),
    "successor fresh GitReadIntentRecorded(ReadTargetLineage)"
  )
  if (successorReadIntent.event._tag !== "GitReadIntentRecorded") {
    return expect.fail("restart-prefix fixture successor read intent narrowing failed")
  }
  const successorReadIntentEvent = successorReadIntent.event
  const successorLineage = exactlyOne(
    records.filter(
      (record) =>
        record.position === successorEvent.successor.targetLineageObservedAt &&
        record.event._tag === "TargetLineageObserved" &&
        record.event.operationId === successorReadIntentEvent.operation.operationId
    ),
    "matching successor TargetLineageObserved"
  )
  const successorSessionId = successor.event.successor.sessionId
  const successorRunStarted = exactlyOne(
    records.filter(
      ({ event }) => event._tag === "IntegratorRunStarted" && event.run.session.sessionId === successorSessionId
    ),
    "successor IntegratorRunStarted"
  )
  const successorRunResult = exactlyOne(
    records.filter(
      ({ event }) => event._tag === "IntegratorRunResultRecorded" && event.run.session.sessionId === successorSessionId
    ),
    "successor IntegratorRunResultRecorded"
  )
  const successorGitObserved = exactlyOne(
    records.filter(
      ({ event }) =>
        event._tag === "IntegratorRunCandidateGitObserved" && event.run.session.sessionId === successorSessionId
    ),
    "successor IntegratorRunCandidateGitObserved"
  )
  const successorPromotion = exactlyOne(
    records.filter(
      ({ event }) =>
        event._tag === "TargetPromotionIntended" &&
        event.correlation.qualifiedCandidate.run.session.sessionId === successorSessionId
    ),
    "successor TargetPromotionIntended"
  )

  const endpoints: ReadonlyArray<[RestartPrefixCutLabel, JournalRecord, string]> = [
    ["AttemptIntended", attempt, "TargetPromotionAttemptIntended"],
    ["Stale", stale, "TargetPromotionStale"],
    ["Quarantined", quarantine, "PromotionStale IntegrationQuarantined"],
    ["DirectionApplied", direction, "IntegrationQuarantineDirectionApplied"],
    ["FreshReadIntent", successorReadIntent, "successor fresh GitReadIntentRecorded(ReadTargetLineage)"],
    ["FreshLineage", successorLineage, "matching successor TargetLineageObserved"],
    ["SuccessorFixed", successor, "IntegratorSuccessorSessionFixed"]
  ]
  const prefixes = endpoints.flatMap(([cut, endpoint, description]) => {
    const endpointIndex = records.indexOf(endpoint)
    if (endpointIndex < 0) return []
    const prefix = prefixThrough(records, cut, description, endpointIndex)
    if (prefix === undefined) return []
    if (prefix.records.at(-1)?.position !== endpoint.position) return []
    return [prefix]
  })
  const completedGraph = graphSnapshotFrom(records)
  if (completedGraph === undefined) return expect.fail("restart-prefix fixture lacks complete finality graph facts")
  return {
    attempt,
    completedGraph,
    stale,
    quarantine,
    direction,
    successorReadIntent,
    successorLineage,
    successor,
    successorRunStarted,
    successorRunResult,
    successorGitObserved,
    successorPromotion,
    prefixes
  }
}

const disabledTargetPromotionRuntime: TargetPromotionRuntimeInput = {
  git: {
    compareAndSet: () => Effect.die("restart-prefix matrix does not cross target promotion"),
    read: () => Effect.die("restart-prefix matrix does not cross target promotion")
  }
}

interface ProductionRestartProjection {
  readonly snapshot: RunRecoveryProjectionSnapshot
  readonly beforeAcquire: RunRecoveryProjectionSnapshot
  readonly afterAcquire: RunRecoveryProjectionSnapshot
  readonly records: ReadonlyArray<JournalRecord>
}

const isExpectedApplicationExit = (cause: Cause.Cause<unknown>): boolean => {
  const failure = Cause.findErrorOption(cause)
  return Option.isSome(failure) && failure.value instanceof ApplicationExiting
}

/** Runs one restart activation through the relation, admission, live executor, and runtime owner. */
const runOrdinaryRestartActivation = Effect.fn("RestartPrefix.runOrdinaryRestartActivation")(function* (
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  matrix: RestartPrefixMatrix,
  storage: JournalStore["Service"],
  resources: IntegrationTargetResourceController,
  foreignOperation?: Extract<WorkflowOperation, { readonly _tag: "ReadTargetLineage" }>,
  allowQuiescenceWithoutExpectedAction = false,
  stopAfterGraphRead = false
): Effect.fn.Return<OrdinaryActivation, unknown, Scope.Scope> {
  const runId = prefix.records[0].runId
  const began = prefix.records[0]
  if (began.event._tag !== "WorkflowRunBegan") {
    return yield* Effect.die("restart-prefix activation requires WorkflowRunBegan")
  }
  const target = began.event.target
  const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
  if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
  const graph = graphSnapshotFrom(initial.records)
  if (graph === undefined) return yield* Effect.die("restart-prefix fixture lacks complete graph facts")
  const graphForRuntime = prefix.cut === "SuccessorFixed" ? matrix.completedGraph : graph
  const operationPrefix = "restart-prefix:" + String(runId) + ":"
  const operationOrdinal = initial.records
    .flatMap(({ event }) => {
      const operationId =
        "operationId" in event
          ? event.operationId
          : "operation" in event && "operationId" in event.operation
            ? event.operation.operationId
            : undefined
      if (operationId === undefined) return []
      const text = String(operationId)
      if (!text.startsWith(operationPrefix)) return []
      const ordinal = Number(text.slice(operationPrefix.length))
      return Number.isSafeInteger(ordinal) && ordinal >= 0 ? [ordinal + 1] : []
    })
    .reduce((maximum, next) => Math.max(maximum, next), 0)

  const resourceCalls = yield* Ref.make<ResourceCallLog>({
    acquireCount: 0,
    acceptedPublicationCount: 0,
    releaseCount: 0,
    releaseAllCount: 0,
    releasePositions: []
  })
  const observedResources: IntegrationTargetResourceController = {
    ...resources,
    acquire: (responsibility) =>
      Ref.update(resourceCalls, (current) => ({ ...current, acquireCount: current.acquireCount + 1 })).pipe(
        Effect.andThen(resources.acquire(responsibility))
      ),
    publishAcceptedOwnership: (responsibility) =>
      Ref.update(resourceCalls, (current) => ({
        ...current,
        acceptedPublicationCount: current.acceptedPublicationCount + 1
      })).pipe(Effect.andThen(resources.publishAcceptedOwnership(responsibility))),
    release: (responsibility) =>
      Ref.update(resourceCalls, (current) => ({
        ...current,
        releaseCount: current.releaseCount + 1,
        releasePositions: [...current.releasePositions, responsibility.queuedAt]
      })).pipe(Effect.andThen(resources.release(responsibility))),
    releaseAll: Ref.update(resourceCalls, (current) => ({
      ...current,
      releaseAllCount: current.releaseAllCount + 1
    })).pipe(Effect.andThen(resources.releaseAll))
  }

  const journalAppendCount = yield* Ref.make(0)
  const journalKeys = yield* Ref.make(new Set(initial.records.map(({ key }) => key)))
  const observedStorage: JournalStore["Service"] = {
    ...storage,
    append: (appendRunId, key, event) =>
      storage.append(appendRunId, key, event).pipe(
        Effect.flatMap((record) =>
          Ref.modify(journalKeys, (current) => {
            if (current.has(record.key)) return [false, current] as const
            const next = new Set(current)
            next.add(record.key)
            return [true, next] as const
          }).pipe(
            Effect.tap((isNew) => (isNew ? Ref.update(journalAppendCount, (count) => count + 1) : Effect.void)),
            Effect.as(record)
          )
        )
      )
  }
  const journal = yield* makeJournal(runId, target, initial, observedStorage)
  const inRunJournal = InRunJournal.of({ append: journal.append, read: journal.read })

  const session = prefix.records.find(({ event }) => event._tag === "IntegratorSessionFixed")
  if (session?.event._tag !== "IntegratorSessionFixed") {
    return yield* Effect.die("restart-prefix activation requires predecessor IntegratorSessionFixed")
  }
  const recovery = yield* makeRunRecoveryProjection(
    runId,
    session.event.correlation.integrationTarget,
    observedResources,
    disabledTargetPromotionRuntime
  ).pipe(Effect.provideService(InRunJournal, inRunJournal))

  const lifecycle = yield* makeApplicationExitLifecycle()
  const targetReached = yield* Ref.make(false)
  const allOwnersSettled = yield* Deferred.make<void>()
  const ownership = yield* Ref.make<ReadonlyArray<ResourceOwnershipObservation>>([])
  const protocolOwnerCount = yield* Ref.make(0)
  const knownIntegrationResponsibilityPositions = new Set(
    deriveIntegrationAdmission(initial.records).responsibilities.map(({ queuedAt }) => queuedAt)
  )
  const runtimeObserver = DeliveryRuntimeObservationObserver.of({
    observe: ({ evaluation, liveOwners }) =>
      Effect.all({
        forward: lifecycle.admission.snapshot,
        integration: observedResources.snapshot,
        protocol: Ref.get(protocolOwnerCount)
      }).pipe(
        Effect.flatMap(({ forward, integration, protocol }) =>
          Ref.update(ownership, (observations) => [
            ...observations,
            {
              integration,
              taskWorkHeld: evaluation.taskWork.held,
              liveOwnerCount: liveOwners.length,
              forwardOwnerCount: forward.registeredOwnerCount,
              protocolOwnerCount: protocol
            }
          ])
        ),
        Effect.andThen(
          Ref.get(targetReached).pipe(
            Effect.flatMap((reached) =>
              reached && liveOwners.length === 0 ? Deferred.succeed(allOwnersSettled, undefined) : Effect.void
            )
          )
        )
      )
  })
  const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(observedResources, lifecycle.admission).pipe(
    Effect.provideService(DeliveryRuntimeObservationObserver, runtimeObserver)
  )
  const targetPromotionCalls = yield* Ref.make<ReadonlyArray<TargetPromotionBoundaryCall>>([])
  const integratorCalls = yield* Ref.make<ReadonlyArray<IntegratorRequest>>([])
  const integratorGitCalls = yield* Ref.make<ReadonlyArray<IntegratorGitBoundaryCall>>([])
  const protocolController = yield* makePlannedAttemptProtocolController()
  const operationOrdinalRef = yield* Ref.make(operationOrdinal)
  const trackedProtocolController = PlannedAttemptProtocolController.of({
    reserve: (correlation) =>
      protocolController.reserve(correlation).pipe(
        Effect.map(
          Option.map((permit) => {
            return {
              ...permit,
              release: Ref.update(protocolOwnerCount, (count) => Math.max(0, count - 1)).pipe(
                Effect.andThen(permit.release)
              )
            }
          })
        ),
        Effect.tap((reserved) =>
          Option.match(reserved, {
            onNone: () => Effect.void,
            onSome: () => Ref.update(protocolOwnerCount, (count) => count + 1)
          })
        )
      ),
    withPermit: (correlation, use) =>
      protocolController.withPermit(correlation, (permit) =>
        Ref.update(protocolOwnerCount, (count) => count + 1).pipe(
          Effect.andThen(use(permit)),
          Effect.ensuring(Ref.update(protocolOwnerCount, (count) => Math.max(0, count - 1)))
        )
      )
  })
  const staleHead =
    matrix.stale.event._tag === "TargetPromotionStale"
      ? matrix.stale.event.observation.observedHeadSha
      : yield* Effect.die("restart-prefix fixture lacks typed stale target head")
  if (
    matrix.successor.event._tag !== "IntegratorSuccessorSessionFixed" ||
    matrix.successorLineage.event._tag !== "TargetLineageObserved" ||
    matrix.successorRunStarted.event._tag !== "IntegratorRunStarted" ||
    matrix.successorRunResult.event._tag !== "IntegratorRunResultRecorded" ||
    matrix.successorGitObserved.event._tag !== "IntegratorRunCandidateGitObserved" ||
    matrix.successorPromotion.event._tag !== "TargetPromotionIntended"
  ) {
    return yield* Effect.die("restart-prefix fixture lacks typed successor production chronology")
  }
  if (matrix.successorRunResult.event.result._tag !== "PreparedCandidate") {
    return yield* Effect.die("restart-prefix fixture successor Integrator result is not prepared")
  }
  if (matrix.successorGitObserved.event.observation._tag !== "Commit") {
    return yield* Effect.die("restart-prefix fixture successor Git observation is not a commit")
  }
  const successorEvent = matrix.successor.event
  const successorCandidateCommit = matrix.successorGitObserved.event.observation.commit
  const successorCandidateText = matrix.successorRunResult.event.result.candidateText
  const successorCandidateParents = matrix.successorGitObserved.event.observation.directParents
  const predecessorCandidateCommit =
    matrix.attempt.event._tag === "TargetPromotionAttemptIntended"
      ? matrix.attempt.event.correlation.qualifiedCandidate.candidateCommit
      : yield* Effect.die("restart-prefix fixture lacks typed predecessor promotion attempt")
  const predecessorPromotionIdentity =
    matrix.attempt.event._tag === "TargetPromotionAttemptIntended"
      ? matrix.attempt.event.correlation.requestId
      : yield* Effect.die("restart-prefix fixture lacks typed predecessor promotion identity")
  const successorPromotionIdentity = matrix.successorPromotion.event.correlation.requestId
  const promotionIdentityFor = (request: TargetPromotionGitRequestType): TargetPromotionRequestId =>
    request.candidateCommit === successorCandidateCommit ? successorPromotionIdentity : predecessorPromotionIdentity
  const integratorOperationIdentity = matrix.successorRunStarted.event.run.session.sessionId
  const activeClaimRecord = prefix.records.findLast(
    ({ event }) =>
      event._tag === "TaskClaimAcquired" && event.claim.taskId === successorEvent.successor.plannedAttempt.taskId
  )
  if (activeClaimRecord?.event._tag !== "TaskClaimAcquired") {
    return yield* Effect.die("restart-prefix fixture lacks the exact active task claim")
  }
  const completionClaim = CompletionTaskClaim.make({
    originalClaim: activeClaimRecord.event.claim,
    plannedAttempt: successorEvent.successor.plannedAttempt,
    promotionCorrelation: matrix.successorPromotion.event.correlation
  })
  const completionFacts = FocusedTaskCompletionFacts.make({
    currentClaim: completionClaim,
    lifecycle: "Open",
    operationId: OperationId.make("restart-prefix-focused-completion-facts"),
    targetMembership: "Member",
    target,
    taskId: completionClaim.plannedAttempt.taskId,
    taskRevision: completionClaim.plannedAttempt.taskRevision,
    trackerRevision: TrackerRevision.make("restart-prefix-focused-tracker"),
    unfinishedPrerequisiteTaskIds: []
  })
  const completionClaimLayer = controlledCompletionClaimBoundaryLayerFrom([activeClaimRecord.event.claim])
  const completionTaskLayer = controlledCompletionTaskBoundaryLayerFrom([completionFacts])
  const taskSpecifications = new Map(
    initial.records.flatMap(({ event }) => {
      if (event._tag !== "TaskTrackerFactsObserved" || event.observation._tag !== "FocusedTaskWorkSpecificationFacts") {
        return []
      }
      const specification = makeTaskWorkSpecification({
        body: event.observation.factFamily.body,
        taskId: event.observation.factFamily.taskId,
        title: event.observation.factFamily.title
      })
      return [[specification.taskId, specification] as const]
    })
  )
  const worktreeObservations = initial.records.flatMap(({ event }) =>
    event._tag === "PlannedAttemptWorktreeObserved" && event.observation._tag === "PlannedWorktreeReady"
      ? [event.observation]
      : []
  )
  if (taskSpecifications.size === 0 || worktreeObservations.length === 0) {
    return yield* Effect.die("restart-prefix fixture lacks focused specification/worktree facts")
  }
  const lineageIntents = new Map(
    initial.records.flatMap(({ event }) =>
      event._tag === "GitReadIntentRecorded" && event.operation._tag === "ReadTargetLineage"
        ? [[event.operation.operationId, event.operation] as const]
        : []
    )
  )
  const lineageObservations = new Map(
    initial.records.flatMap(({ event }) => {
      if (event._tag !== "TargetLineageObserved") return []
      const operation = lineageIntents.get(event.operationId)
      return operation === undefined ? [] : [[operation.plannedAttempt.attemptId, event.observation] as const]
    })
  )
  const readTargetLineageBoundary = (operation: Extract<WorkflowOperation, { readonly _tag: "ReadTargetLineage" }>) => {
    const observation =
      operation.plannedAttempt.attemptId === successorEvent.successor.plannedAttempt.attemptId &&
      matrix.successorLineage.event._tag === "TargetLineageObserved"
        ? matrix.successorLineage.event.observation
        : lineageObservations.get(operation.plannedAttempt.attemptId)
    if (matrix.successorReadIntent.event._tag !== "GitReadIntentRecorded") {
      return Effect.fail(
        new GitTargetLineageReadFailure({
          detail: "restart-prefix fixture lacks the expected target-lineage operation",
          plannedBaseSha: operation.plannedAttempt.baseSha,
          target: operation.integrationTarget
        })
      )
    }
    const successorLineageOperation = matrix.successorReadIntent.event.operation
    if (successorLineageOperation._tag !== "ReadTargetLineage") {
      return Effect.fail(
        new GitTargetLineageReadFailure({
          detail: "restart-prefix fixture successor operation is not target-lineage",
          plannedBaseSha: operation.plannedAttempt.baseSha,
          target: operation.integrationTarget
        })
      )
    }
    const expectedLineageOperation =
      prefix.cut === "FreshReadIntent" ? successorLineageOperation : lineageIntents.get(operation.operationId)
    const operationContext = ({ operationId: _operationId, ...context }: typeof operation) => JSON.stringify(context)
    const restartOperationIdPrefix = "restart-prefix:" + String(runId) + ":"
    const hasRecordedPlannedAttempt = initial.records.some(
      ({ event }) =>
        event._tag === "TaskAttemptPlanned" &&
        JSON.stringify(event.operation.plannedAttempt) === JSON.stringify(operation.plannedAttempt)
    )
    const hasExactRuntimeCausalContext =
      hasRecordedPlannedAttempt &&
      String(operation.operationId).startsWith(restartOperationIdPrefix) &&
      operation.predecessorOperationIds.length === 1 &&
      String(operation.predecessorOperationIds[0]).startsWith(restartOperationIdPrefix)
    const accepted =
      observation !== undefined &&
      ((expectedLineageOperation !== undefined &&
        operation.operationId === expectedLineageOperation.operationId &&
        operationContext(operation) === operationContext(expectedLineageOperation)) ||
        (expectedLineageOperation === undefined && hasExactRuntimeCausalContext))
    return accepted
      ? Effect.succeed(AuthoritativeTargetLineageObserved.make({ observation }))
      : Effect.fail(
          new GitTargetLineageReadFailure({
            detail: "restart-prefix rejected a foreign target-lineage operation",
            plannedBaseSha: operation.plannedAttempt.baseSha,
            target: operation.integrationTarget
          })
        )
  }
  const interpreter = WorkflowInterpreter.of({
    acquireTaskClaim: () => Effect.die("restart-prefix action does not read a task claim"),
    readTrackerGraph: () =>
      inRunJournal
        .read(runId)
        .pipe(
          Effect.map((records) =>
            records.some(({ event }) => event._tag === "IntegrationFinalitySettled")
              ? matrix.completedGraph
              : graphForRuntime
          )
        ),
    readTaskClaim: (operation) => {
      const claim = initial.records.findLast(
        ({ event }) => event._tag === "TaskClaimAcquired" && event.claim.taskId === operation.taskId
      )
      return Effect.succeed(
        AuthoritativeTaskClaimObserved.make({
          observation:
            claim?.event._tag === "TaskClaimAcquired"
              ? claim.event.claim
              : UnclaimedTask.make({ taskId: operation.taskId })
        })
      )
    },
    readTaskWorktree: (operation) => {
      const observation = worktreeObservations.find(
        (candidate) =>
          candidate.branch === operation.plannedAttempt.branch &&
          candidate.worktree === operation.plannedAttempt.worktree
      )
      return observation === undefined
        ? Effect.die("restart-prefix fixture lacks exact planned worktree")
        : Effect.succeed(AuthoritativePlannedAttemptWorktreeObserved.make({ observation }))
    },
    readTargetLineage: readTargetLineageBoundary,
    releaseTaskClaim: () => Effect.die("restart-prefix action does not release a task claim"),
    readTaskWorkSpecification: (operation) => {
      const specification = taskSpecifications.get(operation.taskId)
      return specification === undefined
        ? Effect.die("restart-prefix fixture lacks exact task specification")
        : Effect.succeed(specification)
    },
    reconcileTaskWorktree: () => Effect.die("restart-prefix action does not reconcile a worktree"),
    recordTaskAttemptPlan: () => Effect.die("restart-prefix action does not plan an attempt")
  })
  const observer = DeliveryRelationPublicationObserver.of({ observe: () => Effect.void })
  const relations = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery, observedResources).pipe(
    Effect.provideService(DeliveryRelationPublicationObserver, observer)
  )
  const actions = yield* Ref.make<ReadonlyArray<ObservedAction>>([])
  const invokedActions = yield* Ref.make<ReadonlyArray<ObservedAction>>([])
  const proposedActions = yield* Ref.make<ReadonlyMap<string, ObservedAction>>(new Map())
  const foreignReadFailure = yield* Ref.make<GitTargetLineageReadFailure | undefined>(undefined)
  const actionReached = yield* Deferred.make<void>()
  const activeExecutionCount = yield* Ref.make(0)
  const actionExecutionGate = yield* Semaphore.make(1)
  const semanticTrace = DeliverySemanticTrace.of({
    emit: (event) =>
      event._tag !== "ActionOutcome"
        ? Effect.void
        : Effect.gen(function* () {
            const observed = yield* Ref.modify(proposedActions, (current) => {
              const proposalId = String(event.result.proposalId)
              const value = current.get(proposalId)
              if (value === undefined) return [Option.none<ObservedAction>(), current] as const
              const next = new Map(current)
              next.delete(proposalId)
              return [Option.some(value), next] as const
            })
            if (Option.isNone(observed)) return
            yield* Ref.update(actions, (current) => [...current, observed.value])
            if (
              observed.value.semanticTag === expectedRestartActionTags[prefix.cut] ||
              (stopAfterGraphRead && observed.value.semanticTag === "TrackerGraphReadRoute")
            ) {
              yield* Ref.set(targetReached, true)
              yield* Deferred.succeed(actionReached, undefined)
              // The accepted target is the phase boundary; close admission before the runtime can schedule another proposal.
              yield* lifecycle.requestExit
            }
          })
  })
  const ordinaryLayer = Layer.mergeAll(
    deliveryRuntimeResourceCapabilitiesLayer(capabilities),
    Layer.succeed(DeliveryRelationPublicationObserver, observer),
    relations,
    journaledWorkflowInterpreterLayer(runId, Layer.succeed(WorkflowInterpreter, interpreter)),
    Layer.succeed(
      OperationIdAllocator,
      OperationIdAllocator.of({
        allocate: () =>
          Ref.getAndUpdate(operationOrdinalRef, (current) => current + 1).pipe(
            Effect.map((ordinal) => OperationId.make(operationPrefix + String(ordinal)))
          )
      })
    ),
    deterministicPlannedTaskAttemptLayer({
      baseSha: GitCommitSha.make("2".repeat(40)),
      executor: TaskExecutorLocator.make("executor:restart-prefix"),
      runId,
      worktreeRoot: WorktreeLocator.make("/restart-prefix/planned")
    }),
    Layer.succeed(PlannedAttemptProtocolController, trackedProtocolController),
    completionClaimLayer,
    completionTaskLayer,
    Layer.succeed(
      PlannedAttemptExecutor,
      PlannedAttemptExecutor.of({
        project: () => Effect.die("restart-prefix " + prefix.cut + " action does not execute an attempt"),
        requestSuspension: () => Effect.die("restart-prefix " + prefix.cut + " action does not suspend an attempt"),
        startOrContinue: () => Effect.die("restart-prefix " + prefix.cut + " action does not continue an attempt")
      })
    ),
    Layer.succeed(
      TaskClaimAcquisitionPlanner,
      TaskClaimAcquisitionPlanner.of({ plan: () => Effect.die("restart-prefix action does not acquire a claim") })
    ),
    Layer.succeed(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void })),
    Layer.succeed(
      CoordinatorOwnership,
      CoordinatorOwnership.of({ release: Effect.void, runMutation: (effect) => effect })
    ),
    Layer.succeed(
      TargetPromotionRuntime,
      TargetPromotionRuntime.of({
        git: {
          compareAndSet: (request): Effect.Effect<TargetPromotionCompareAndSetResult, never> =>
            Effect.succeed(
              request.candidateCommit === successorCandidateCommit
                ? TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: successorCandidateCommit })
                : TargetPromotionCompareAndSetResult.cases.RejectedExpectedHead.make({
                    observedHeadSha:
                      request.candidateCommit === predecessorCandidateCommit ? staleHead : request.expectedTargetHead
                  })
            ).pipe(
              Effect.tap(() =>
                Ref.update(targetPromotionCalls, (calls) => [
                  ...calls,
                  { _tag: "compareAndSet" as const, operationIdentity: promotionIdentityFor(request), request }
                ])
              )
            ),
          read: (request): Effect.Effect<TargetPromotionGitReadObservation, never> =>
            Ref.update(targetPromotionCalls, (calls) => [
              ...calls,
              { _tag: "read" as const, operationIdentity: promotionIdentityFor(request), request }
            ]).pipe(
              Effect.andThen(
                Ref.get(targetPromotionCalls).pipe(
                  Effect.map((calls) =>
                    request.candidateCommit === successorCandidateCommit &&
                    calls.some(
                      (call) =>
                        call._tag === "compareAndSet" &&
                        call.request.candidateCommit === successorCandidateCommit &&
                        call.request.expectedTargetHead === request.expectedTargetHead &&
                        call.request.integrationTarget.repository === request.integrationTarget.repository &&
                        call.request.integrationTarget.ref === request.integrationTarget.ref
                    )
                      ? TargetPromotionGitReadObservation.cases.CandidateCurrent.make({
                          currentHeadSha: successorCandidateCommit
                        })
                      : TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({
                          currentHeadSha:
                            request.candidateCommit === successorCandidateCommit
                              ? request.expectedTargetHead
                              : request.candidateCommit === predecessorCandidateCommit
                                ? staleHead
                                : request.expectedTargetHead
                        })
                  )
                )
              )
            )
        }
      })
    ),
    Layer.succeed(
      Integrator,
      Integrator.of({
        prepare: (request) =>
          Ref.update(integratorCalls, (calls) => [...calls, request]).pipe(
            Effect.andThen(
              Effect.succeed(
                IntegratorResult.cases.PreparedCandidate.make({
                  candidateText: successorCandidateText,
                  correlation: request.correlation
                })
              )
            )
          )
      })
    ),
    Layer.succeed(
      IntegratorGit,
      IntegratorGit.of({
        readCandidate: (requestedTarget, text) =>
          Ref.update(integratorGitCalls, (calls) => [
            ...calls,
            { operationIdentity: integratorOperationIdentity, target: requestedTarget, candidateText: text }
          ]).pipe(
            Effect.andThen(
              Effect.succeed(
                IntegratorGitObservation.cases.Commit.make({
                  candidateText: text,
                  commit: successorCandidateCommit,
                  directParents: successorCandidateParents
                })
              )
            )
          )
      })
    )
  ).pipe(Layer.provideMerge(Layer.succeed(InRunJournal, inRunJournal)))

  const activation = Effect.gen(function* () {
    const relation = yield* deliveryRuntime
    const live = yield* makeLiveDeliveryActionExecutor(runId, target)
    const bounded = DeliveryActionExecutor.of({
      execute: (action, lease) => {
        const observed = observedActionOf(action)
        return Ref.update(invokedActions, (current) => [...current, observed]).pipe(
          Effect.andThen(
            Ref.update(proposedActions, (current) => {
              const next = new Map(current)
              next.set(observed.proposalId, observed)
              return next
            })
          ),
          Effect.andThen(
            Ref.update(activeExecutionCount, (count) => count + 1).pipe(
              Effect.andThen(
                Effect.raceFirst(
                  actionExecutionGate.withPermit(live.execute(action, lease)),
                  lifecycle.awaitExitRequested.pipe(Effect.andThen(Effect.interrupt))
                )
              ),
              Effect.ensuring(Ref.update(activeExecutionCount, (count) => Math.max(0, count - 1)))
            )
          ),
          Effect.catchCause((cause) =>
            Effect.gen(function* () {
              const failure = Cause.findErrorOption(cause)
              if (
                foreignOperation !== undefined &&
                Option.isSome(failure) &&
                failure.value instanceof GitTargetLineageReadFailure
              ) {
                yield* Ref.set(foreignReadFailure, failure.value)
              }
              return yield* Effect.failCause(cause)
            })
          )
        )
      }
    })
    return yield* runDeliveryRuntimePhase(relation).pipe(
      Effect.provideService(DeliveryActionExecutor, bounded),
      Effect.provideService(DeliverySemanticTrace, semanticTrace),
      Effect.exit
    )
  }).pipe(Effect.provide(ordinaryLayer))

  const runtimeFiber = yield* Effect.scoped(activation).pipe(Effect.forkChild)
  const runtimeState = yield* Effect.raceFirst(
    Deferred.await(actionReached).pipe(Effect.as({ _tag: "ExpectedAction" as const })),
    Effect.exit(Fiber.join(runtimeFiber)).pipe(Effect.map((exit) => ({ _tag: "RuntimeFinished" as const, exit })))
  )
  const preserveExpectedForeignFailure = (cause: Cause.Cause<unknown>) => {
    const failure = Cause.findErrorOption(cause)
    return Option.isSome(failure) &&
      foreignOperation !== undefined &&
      failure.value instanceof GitTargetLineageReadFailure
      ? Ref.set(foreignReadFailure, failure.value).pipe(Effect.andThen(lifecycle.requestExit))
      : Ref.get(targetReached).pipe(
          Effect.flatMap((reached) =>
            reached && Cause.hasInterruptsOnly(cause) ? Effect.void : Effect.failCause(cause)
          )
        )
  }
  if (runtimeState._tag === "ExpectedAction") {
    yield* lifecycle.requestExit
    const finished = yield* Fiber.join(runtimeFiber).pipe(Effect.exit)
    if (Exit.isFailure(finished)) yield* preserveExpectedForeignFailure(finished.cause)
    if (
      Exit.isSuccess(finished) &&
      Exit.isFailure(finished.value) &&
      !isExpectedApplicationExit(finished.value.cause)
    ) {
      yield* preserveExpectedForeignFailure(finished.value.cause)
    }
  }
  if (runtimeState._tag === "RuntimeFinished") {
    if (Exit.isFailure(runtimeState.exit)) yield* preserveExpectedForeignFailure(runtimeState.exit.cause)
    if (
      Exit.isSuccess(runtimeState.exit) &&
      Exit.isFailure(runtimeState.exit.value) &&
      !isExpectedApplicationExit(runtimeState.exit.value.cause)
    ) {
      yield* preserveExpectedForeignFailure(runtimeState.exit.value.cause)
    }
    if (
      Exit.isSuccess(runtimeState.exit) &&
      !(yield* Ref.get(targetReached)) &&
      (foreignOperation === undefined || (yield* Ref.get(foreignReadFailure)) === undefined) &&
      !allowQuiescenceWithoutExpectedAction
    ) {
      return yield* Effect.die(
        "restart-prefix runtime quiesced before its expected action (" +
          (foreignOperation === undefined ? "valid" : "foreign") +
          ")"
      )
    }
  }
  if ((yield* Ref.get(targetReached)) || (yield* Ref.get(foreignReadFailure)) !== undefined) {
    yield* lifecycle.requestExit
  }
  yield* lifecycle.awaitForwardOwnersReleased
  const finalForward = yield* lifecycle.admission.snapshot
  const finalIntegration = yield* observedResources.snapshot
  const finalActiveExecutionCount = yield* Ref.get(activeExecutionCount)
  const finalProtocolOwnerCount = yield* Ref.get(protocolOwnerCount)
  const finalTaskWorkHeld = requiredPlannedAttemptPositionsOf(initial.runState).map(({ attemptId, runId, taskId }) => ({
    correlation: { attemptId, runId },
    taskId
  }))
  yield* Ref.update(ownership, (observations) => [
    ...observations,
    {
      integration: finalIntegration,
      taskWorkHeld: finalTaskWorkHeld,
      liveOwnerCount: finalActiveExecutionCount,
      forwardOwnerCount: finalForward.registeredOwnerCount,
      protocolOwnerCount: finalProtocolOwnerCount
    }
  ])
  return {
    records: yield* observedStorage.read(runId),
    actions: yield* Ref.get(actions),
    invokedActions: yield* Ref.get(invokedActions),
    journalAppendCount: yield* Ref.get(journalAppendCount),
    boundaryCalls: {
      targetPromotion: yield* Ref.get(targetPromotionCalls),
      integrator: yield* Ref.get(integratorCalls),
      integratorGit: yield* Ref.get(integratorGitCalls)
    },
    ownership: yield* Ref.get(ownership),
    resourceCalls: yield* Ref.get(resourceCalls),
    protocolOwnerCount: yield* Ref.get(protocolOwnerCount),
    knownIntegrationResponsibilityPositions,
    expectedTaskWorkHeld: requiredPlannedAttemptPositionsOf(initial.runState).map(({ attemptId, runId, taskId }) => ({
      correlation: { attemptId, runId },
      taskId
    })),
    foreignReadFailure: foreignOperation === undefined ? undefined : yield* Ref.get(foreignReadFailure)
  }
})

const dispatchPrefixNextAction = (
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  matrix: RestartPrefixMatrix,
  lane: RecoveryStoreLane
): Effect.Effect<DispatchResult, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    const first = yield* withRecoveryPrefixStore(prefix, lane, (storage) =>
      Effect.gen(function* () {
        const resources = yield* makeIntegrationTargetResourceController()
        return yield* runOrdinaryRestartActivation(prefix, matrix, storage, resources)
      })
    )
    const firstRecord = first.records[0]
    if (firstRecord === undefined) return yield* Effect.die("restart-prefix first activation produced no records")
    const redeliveryPrefix: RecoveryPrefix<RestartPrefixCutLabel> = {
      ...prefix,
      records: [firstRecord, ...first.records.slice(1)]
    }
    const redelivered = yield* withRecoveryPrefixStore(redeliveryPrefix, lane, (storage) =>
      Effect.gen(function* () {
        const resources = yield* makeIntegrationTargetResourceController()
        return yield* runOrdinaryRestartActivation(redeliveryPrefix, matrix, storage, resources, undefined, true, true)
      })
    )
    return {
      before: prefix.records,
      after: first.records,
      redelivered: redelivered.records,
      first,
      redeliveredActivation: redelivered
    }
  })

const productionRestartProjection = <Cut extends string>(
  prefix: RecoveryPrefix<Cut>,
  lane: RecoveryStoreLane
): Effect.Effect<ProductionRestartProjection, unknown> =>
  withRecoveryPrefixStore(prefix, lane, (storage) =>
    Effect.gen(function* () {
      const began = prefix.records[0]
      const runId = began.runId
      if (began.event._tag !== "WorkflowRunBegan") {
        return yield* Effect.die("restart prefix has no WorkflowRunBegan authority")
      }
      const session = prefix.records.find(({ event }) => event._tag === "IntegratorSessionFixed")
      if (session?.event._tag !== "IntegratorSessionFixed") {
        return yield* Effect.die("restart prefix has no predecessor IntegratorSessionFixed authority")
      }
      const resources = yield* makeIntegrationTargetResourceController()
      const journal = InRunJournal.of({ append: storage.append, read: storage.read })
      const recovery = yield* makeRunRecoveryProjection(
        runId,
        session.event.correlation.integrationTarget,
        resources,
        disabledTargetPromotionRuntime
      ).pipe(Effect.provideService(InRunJournal, journal))
      const snapshot = yield* recovery.readDeliveryProjection
      return { snapshot, beforeAcquire: snapshot, afterAcquire: snapshot, records: yield* storage.read(runId) }
    })
  )

const resumeFreshTargetLineage = dispatchPrefixNextAction
const prefixAt = (matrix: RestartPrefixMatrix, cut: RestartPrefixCutLabel): RecoveryPrefix<RestartPrefixCutLabel> => {
  const prefix = matrix.prefixes.find((candidate) => candidate.cut === cut)
  return prefix === undefined ? expect.fail("missing restart prefix " + cut) : prefix
}

const successorPreparationInputFor = (matrix: RestartPrefixMatrix): IntegratorSuccessorPreparationInputType => {
  if (
    matrix.successor.event._tag !== "IntegratorSuccessorSessionFixed" ||
    matrix.successorLineage.event._tag !== "TargetLineageObserved"
  ) {
    return expect.fail("restart-prefix fixture successor narrowing failed")
  }
  return IntegratorSuccessorPreparationInput.make({
    directionAppliedAt: matrix.successor.event.directionAppliedAt,
    predecessor: matrix.successor.event.predecessor,
    quarantineAt: matrix.successor.event.quarantineAt,
    targetLineage: matrix.successorLineage.event.observation,
    targetLineageObservedAt: matrix.successor.event.successor.targetLineageObservedAt
  })
}

it.effect(
  "reconstructs every #255 restart prefix through both journal-store lanes",
  () =>
    Effect.gen(function* () {
      const run = yield* sourceRun()
      const matrix = restartPrefixesFrom(run.records)
      expect(matrix.prefixes).toHaveLength(restartPrefixCutLabels.length)
      if (matrix.prefixes.length !== restartPrefixCutLabels.length) {
        return yield* Effect.die("delivery-story capstone lacks the required #255 restart prefixes")
      }

      const executions = yield* Effect.forEach(matrix.prefixes, (prefix) =>
        Effect.gen(function* () {
          const expected = yield* expectedRecoveryPrefix(prefix)
          expect(expected.historyTag, prefix.cut + " (" + prefix.endpoint + ") must retain valid history").toBe(
            "ValidWorkflowJournalHistory"
          )
          const laneExecutions = yield* Effect.forEach(lanes, (lane) =>
            Effect.gen(function* () {
              const actual = yield* replayRecoveryPrefix(prefix, lane)
              expect(recoveryPrefixMismatch(prefix.cut, lane, expected, actual)).toBeUndefined()

              const production = yield* productionRestartProjection(prefix, lane)
              expect(production.records, prefix.cut + " / " + lane + " must not append while projecting").toEqual(
                prefix.records
              )
              return { cut: prefix.cut, lane }
            })
          )
          return laneExecutions
        })
      )

      expect(executions.flat()).toHaveLength(restartPrefixCutLabels.length * lanes.length)
    }),
  120_000
)

it.effect(
  "keeps each #255 restart projection side-effect free until ordinary admission",
  () =>
    Effect.gen(function* () {
      const run = yield* sourceRun()
      const matrix = restartPrefixesFrom(run.records)
      expect(matrix.prefixes).toHaveLength(restartPrefixCutLabels.length)
      if (matrix.prefixes.length !== restartPrefixCutLabels.length) {
        return yield* Effect.die("delivery-story capstone lacks the required #255 restart prefixes")
      }
      for (const prefix of matrix.prefixes) {
        const projection = yield* productionRestartProjection(prefix, "memory")
        expect(projection.records, prefix.cut + " projection must not append").toEqual(prefix.records)
        expect(projection.afterAcquire, prefix.cut + " projection must not acquire resources").toEqual(
          projection.beforeAcquire
        )
        expect(
          projection.beforeAcquire.frontier.transitions.some(({ _tag }) => _tag === "AcquireStartedIntegrationTarget"),
          prefix.cut + " resource acquisition remains an ordinary dispatched action"
        ).toBe(false)
      }
    }),
  120_000
)

it.effect(
  "dispatches every #255 restart prefix through its ordinary production action",
  () =>
    Effect.gen(function* () {
      const run = yield* sourceRun()
      const matrix = restartPrefixesFrom(run.records)
      if (
        matrix.attempt.event._tag !== "TargetPromotionAttemptIntended" ||
        matrix.successor.event._tag !== "IntegratorSuccessorSessionFixed" ||
        matrix.successorPromotion.event._tag !== "TargetPromotionIntended" ||
        matrix.successorRunStarted.event._tag !== "IntegratorRunStarted" ||
        matrix.successorRunResult.event._tag !== "IntegratorRunResultRecorded" ||
        matrix.successorGitObserved.event._tag !== "IntegratorRunCandidateGitObserved"
      ) {
        return yield* Effect.die("restart-prefix fixture lacks typed promotion requests")
      }
      const predecessorPromotionRequest = {
        candidateCommit: matrix.attempt.event.correlation.qualifiedCandidate.candidateCommit,
        expectedTargetHead: matrix.attempt.event.correlation.qualifiedCandidate.run.session.expectedTargetHead,
        integrationTarget: matrix.attempt.event.correlation.qualifiedCandidate.run.session.integrationTarget
      }
      const successorPromotionRequest = targetPromotionGitRequestFor(matrix.successorPromotion.event.correlation)
      if (
        matrix.successorRunResult.event.result._tag !== "PreparedCandidate" ||
        matrix.successorGitObserved.event.observation._tag !== "Commit"
      ) {
        return yield* Effect.die("restart-prefix fixture lacks typed successor candidate facts")
      }
      expect(
        matrix.successorGitObserved.event.observation.directParents,
        "successor Git candidate must report exact ordered parents [H2, C]"
      ).toEqual([
        matrix.successor.event.successor.expectedTargetHead,
        matrix.successor.event.successor.acceptedResult.commit
      ])
      const expectedSuffixTags: Readonly<Record<RestartPrefixCutLabel, ReadonlyArray<string>>> = {
        AttemptIntended: ["TargetPromotionStale", "GitReadIntentRecorded", "PlannedAttemptWorktreeObserved"],
        Stale: ["IntegrationQuarantined"],
        Quarantined: [],
        DirectionApplied: ["GitReadIntentRecorded", "TargetLineageObserved"],
        FreshReadIntent: ["TargetLineageObserved"],
        FreshLineage: ["IntegratorSuccessorSessionFixed"],
        SuccessorFixed: [
          "IntegratorRunStarted",
          "IntegratorRunResultRecorded",
          "IntegratorRunCandidateGitReadIntended",
          "IntegratorRunCandidateGitObserved",
          "TargetPromotionIntended",
          "TargetPromotionAttemptIntended",
          "TargetPromotionObservedSuccess",
          "CompletionClaimReplacementIntended",
          "CompletionClaimReplacementAttemptIntended",
          "CompletionClaimReplaced",
          "TaskTrackerReadIntentRecorded",
          "TaskTrackerFactsObserved",
          "CompletionTaskCandidateAncestryReadIntended",
          "CompletionTaskCandidateAncestryObserved",
          "CompletionTaskIntended",
          "CompletionTaskAttemptIntended",
          "CompletionTaskAcknowledged",
          "TaskTrackerReadIntentRecorded",
          "TaskTrackerFactsObserved",
          "CompletionClaimDeletionIntended",
          "CompletionClaimDeletionReadObserved",
          "CompletionClaimDeletionAttemptIntended",
          "CompletionClaimDeleted",
          "IntegrationFinalitySettled"
        ]
      }
      for (const prefix of matrix.prefixes) {
        for (const lane of lanes) {
          const result = yield* dispatchPrefixNextAction(prefix, matrix, lane)
          const suffix = result.after.slice(result.before.length)
          const semanticSuffix = suffix
            .filter(({ event }) => !ordinaryGraphStabilizationEventTags.has(event._tag))
            .map(({ event }) => event._tag)
          const expectedSuffix =
            prefix.cut === "AttemptIntended" && lane === "sqlite"
              ? ["TargetPromotionStale", "GitReadIntentRecorded"]
              : expectedSuffixTags[prefix.cut]
          expect(semanticSuffix, prefix.cut + " / " + lane).toEqual(expectedSuffix)
          expect(result.after.slice(0, prefix.records.length), prefix.cut + " / " + lane).toEqual(prefix.records)
          const redeliverySuffix = result.redelivered.slice(result.after.length)
          expect(
            result.redelivered.slice(0, result.after.length),
            prefix.cut + " / " + lane + " redelivery prefix"
          ).toEqual(result.after)
          const redeliveryTags = redeliverySuffix.map(({ event }) => event._tag)
          expect(redeliverySuffix.length, prefix.cut + " / " + lane + " bounded authority reread").toBeLessThanOrEqual(
            8
          )
          expect(redeliveryTags, prefix.cut + " / " + lane + " authority reread").toContain(
            "TaskTrackerReadIntentRecorded"
          )
          expect(redeliveryTags, prefix.cut + " / " + lane + " authority reread").toContain("TaskTrackerFactsObserved")
          for (const tag of redeliveryTags) {
            expect(
              new Set([
                "TaskTrackerReadIntentRecorded",
                "TaskTrackerFactsObserved",
                "PlannedAttemptWorktreeObserved",
                "IntegrationQuarantined"
              ]),
              prefix.cut + " / " + lane + " redelivery event " + tag
            ).toContain(tag)
          }
          const priorKeys = new Set(result.after.map(({ key }) => key))
          expect(
            redeliverySuffix.every(({ key }) => !priorKeys.has(key)),
            prefix.cut + " / " + lane + " redelivery must not duplicate a journal key"
          ).toBe(true)
          expect(
            new Set(redeliverySuffix.map(({ key }) => key)).size,
            prefix.cut + " / " + lane + " redelivery journal keys"
          ).toBe(redeliverySuffix.length)
          expect(
            result.redeliveredActivation.journalAppendCount,
            prefix.cut + " / " + lane + " redelivery append count"
          ).toBe(redeliverySuffix.length)
          expect(
            result.redeliveredActivation.resourceCalls.acquireCount,
            prefix.cut + " / " + lane + " redelivery acquire count"
          ).toBe(0)
          expect(
            result.redeliveredActivation.resourceCalls.acceptedPublicationCount,
            prefix.cut + " / " + lane + " redelivery ownership publication count"
          ).toBe(0)
          expect(
            result.redeliveredActivation.actions.length,
            prefix.cut + " / " + lane + " redelivery actions"
          ).toBeLessThanOrEqual(4)
          expect(
            result.redeliveredActivation.actions.some(({ semanticTag }) => semanticTag === "TrackerGraphReadRoute"),
            prefix.cut + " / " + lane + " redelivery graph action"
          ).toBe(true)
          for (const action of result.redeliveredActivation.actions) {
            expect(
              new Set([
                "TrackerGraphReadRoute",
                "Recovered:ReadTrackerGraph",
                "Recovered:ReadTaskWorktree",
                "ObservePlannedAttemptContinuationWorktree",
                "RecordPromotionStaleIntegrationQuarantine"
              ]),
              prefix.cut + " / " + lane + " redelivery action " + action.semanticTag
            ).toContain(action.semanticTag)
          }
          expect(result.redeliveredActivation.boundaryCalls.targetPromotion).toHaveLength(0)
          expect(result.redeliveredActivation.boundaryCalls.integrator).toHaveLength(0)
          expect(result.redeliveredActivation.boundaryCalls.integratorGit).toHaveLength(0)
          const redeliveryFinalOwnership = result.redeliveredActivation.ownership.at(-1)
          expect(redeliveryFinalOwnership?.integration.activeResponsibilityPositions).toEqual(new Set())
          expect(redeliveryFinalOwnership?.integration.heldResponsibilityPositions).toEqual(new Set())
          expect(redeliveryFinalOwnership?.liveOwnerCount).toBe(0)
          expect(redeliveryFinalOwnership?.forwardOwnerCount).toBe(0)
          expect(redeliveryFinalOwnership?.protocolOwnerCount).toBe(0)
          assertRestartActionTrace(prefix, matrix, lane, result.first)
          expect(
            result.first.boundaryCalls.targetPromotion,
            prefix.cut + " / " + lane + " target promotion boundary chronology"
          ).toEqual(
            prefix.cut === "AttemptIntended"
              ? [
                  {
                    _tag: "read",
                    operationIdentity: matrix.attempt.event.correlation.requestId,
                    request: predecessorPromotionRequest
                  }
                ]
              : prefix.cut === "SuccessorFixed"
                ? [
                    {
                      _tag: "read",
                      operationIdentity: matrix.successorPromotion.event.correlation.requestId,
                      request: successorPromotionRequest
                    },
                    {
                      _tag: "compareAndSet",
                      operationIdentity: matrix.successorPromotion.event.correlation.requestId,
                      request: successorPromotionRequest
                    },
                    {
                      _tag: "read",
                      operationIdentity: matrix.successorPromotion.event.correlation.requestId,
                      request: successorPromotionRequest
                    }
                  ]
                : []
          )
          if (prefix.cut === "SuccessorFixed") {
            expect(result.first.boundaryCalls.integrator, prefix.cut + " / " + lane + " Integrator request").toEqual([
              { correlation: matrix.successorRunStarted.event.run.session }
            ])
            expect(
              result.first.boundaryCalls.integratorGit,
              prefix.cut + " / " + lane + " Integrator Git request"
            ).toEqual([
              {
                operationIdentity: matrix.successorRunStarted.event.run.session.sessionId,
                target: successorPromotionRequest.integrationTarget,
                candidateText: matrix.successorRunResult.event.result.candidateText
              }
            ])
          }
          const finalOwnership = result.first.ownership.at(-1)
          for (const observation of result.first.ownership) {
            expect(
              observation.liveOwnerCount,
              prefix.cut + " / " + lane + " live ownership must be nonnegative"
            ).toBeGreaterThanOrEqual(0)
            expect(
              observation.forwardOwnerCount,
              prefix.cut + " / " + lane + " forward ownership must be nonnegative"
            ).toBeGreaterThanOrEqual(0)
            expect(
              observation.protocolOwnerCount,
              prefix.cut + " / " + lane + " protocol ownership must be nonnegative"
            ).toBeGreaterThanOrEqual(0)
            for (const activePosition of observation.integration.activeResponsibilityPositions) {
              expect(
                result.first.knownIntegrationResponsibilityPositions.has(activePosition),
                prefix.cut + " / " + lane + " active target must be a journal responsibility"
              ).toBe(true)
              expect(
                observation.integration.heldResponsibilityPositions.has(activePosition),
                prefix.cut + " / " + lane + " active target must be held"
              ).toBe(true)
            }
            for (const heldPosition of observation.integration.heldResponsibilityPositions) {
              expect(
                result.first.knownIntegrationResponsibilityPositions.has(heldPosition),
                prefix.cut + " / " + lane + " held target must be a journal responsibility"
              ).toBe(true)
            }
          }
          expect(finalOwnership?.integration.activeResponsibilityPositions, prefix.cut + " / " + lane).toEqual(
            new Set()
          )
          expect(finalOwnership?.integration.heldResponsibilityPositions, prefix.cut + " / " + lane).toEqual(new Set())
          expect(finalOwnership?.taskWorkHeld, prefix.cut + " / " + lane).toEqual(result.first.expectedTaskWorkHeld)
          expect(finalOwnership?.liveOwnerCount, prefix.cut + " / " + lane).toBe(0)
          expect(finalOwnership?.forwardOwnerCount, prefix.cut + " / " + lane).toBe(0)
          expect(finalOwnership?.protocolOwnerCount, prefix.cut + " / " + lane).toBe(0)
          expect(result.first.protocolOwnerCount, prefix.cut + " / " + lane + " protocol owner cleanup").toBe(0)
          expect(result.first.resourceCalls.releaseAllCount, prefix.cut + " / " + lane + " exact cleanup").toBe(0)
          expect(
            result.first.resourceCalls.releasePositions.length,
            prefix.cut + " / " + lane + " release ledger count"
          ).toBe(result.first.resourceCalls.releaseCount)
          for (const releasePosition of result.first.resourceCalls.releasePositions) {
            expect(
              result.first.knownIntegrationResponsibilityPositions.has(releasePosition),
              prefix.cut + " / " + lane + " release must name a journal responsibility"
            ).toBe(true)
          }
          const expectedReleaseCount: Readonly<Record<RestartPrefixCutLabel, number>> = {
            AttemptIntended: 1,
            Stale: 1,
            Quarantined: 1,
            DirectionApplied: 0,
            FreshReadIntent: 1,
            FreshLineage: 0,
            SuccessorFixed: 2
          }
          expect(result.first.resourceCalls.releaseCount, prefix.cut + " / " + lane + " exact release count").toBe(
            expectedReleaseCount[prefix.cut]
          )
          expect(
            result.first.resourceCalls.acceptedPublicationCount,
            prefix.cut + " / " + lane + " every acquire publishes exactly once"
          ).toBe(result.first.resourceCalls.acquireCount)
        }
      }
    }),
  120_000
)

it.effect("executes recovered target-lineage observations through the production interpreter", () =>
  Effect.gen(function* () {
    const run = yield* sourceRun()
    const matrix = restartPrefixesFrom(run.records)
    for (const cut of ["FreshReadIntent", "DirectionApplied"] as const) {
      const prefix = prefixAt(matrix, cut)
      for (const lane of lanes) {
        const result = yield* resumeFreshTargetLineage(prefix, matrix, lane)
        const suffix = result.after.slice(prefix.records.length)
        const semanticSuffix = suffix
          .filter(({ event }) => !ordinaryGraphStabilizationEventTags.has(event._tag))
          .map(({ event }) => event._tag)
        const expectedLineageSuffix =
          cut === "DirectionApplied"
            ? ["GitReadIntentRecorded", "TargetLineageObserved"]
            : lane === "sqlite"
              ? ["GitReadIntentRecorded", "PlannedAttemptWorktreeObserved", "TargetLineageObserved"]
              : ["TargetLineageObserved"]
        expect(semanticSuffix, cut + " / " + lane).toEqual(expectedLineageSuffix)
        const lineage = exactlyOne(
          suffix.filter(({ event }) => event._tag === "TargetLineageObserved"),
          "ordinary target-lineage observation"
        )
        expect(lineage.event).toEqual(matrix.successorLineage.event)
        assertRestartActionTrace(prefix, matrix, lane, result.first)
      }
    }
  })
)

it.effect(
  "retains the exact visible action tag in both restart-store lanes",
  () =>
    Effect.gen(function* () {
      const run = yield* sourceRun()
      const matrix = restartPrefixesFrom(run.records)
      for (const prefix of matrix.prefixes) {
        for (const lane of lanes) {
          const result = yield* dispatchPrefixNextAction(prefix, matrix, lane)
          assertRestartActionTrace(prefix, matrix, lane, result.first)
        }
      }
    }),
  120_000
)

it.effect(
  "rejects an independent foreign operation chronology through ordinary production dispatch",
  () =>
    Effect.gen(function* () {
      const run = yield* sourceRun()
      const matrix = restartPrefixesFrom(run.records)
      const prefix = prefixAt(matrix, "FreshReadIntent")
      if (
        matrix.successor.event._tag !== "IntegratorSuccessorSessionFixed" ||
        matrix.successorLineage.event._tag !== "TargetLineageObserved"
      ) {
        return yield* Effect.die("restart-prefix fixture successor narrowing failed")
      }
      const successorReadIntent = matrix.successorReadIntent.event
      if (successorReadIntent._tag !== "GitReadIntentRecorded") {
        return yield* Effect.die("restart-prefix fixture lacks typed successor read intent")
      }
      if (successorReadIntent.operation._tag !== "ReadTargetLineage") {
        return yield* Effect.die("restart-prefix fixture successor intent is not target-lineage")
      }
      expect(successorReadIntent.operation.operationId).not.toBe(OperationId.make("foreign-restart-lineage-operation"))
      expect(successorReadIntent.operation.predecessorOperationIds.length).toBeGreaterThan(0)
      const foreignOperation = makeTargetLineageObservationOperation({
        integrationTarget: successorReadIntent.operation.integrationTarget,
        operationId: OperationId.make("foreign-restart-lineage-operation"),
        plannedAttempt: successorReadIntent.operation.plannedAttempt,
        predecessorOperationIds: successorReadIntent.operation.predecessorOperationIds
      })
      const foreignIntentRecord = prefix.records.find(
        ({ position }) => position === matrix.successorReadIntent.position
      )
      const foreignIntentEvent = foreignIntentRecord?.event
      if (foreignIntentEvent?._tag !== "GitReadIntentRecorded") {
        return yield* Effect.die("restart-prefix fixture lacks the successor target-lineage intent record")
      }
      const foreignPrefixRecords = prefix.records.map((record) =>
        record.position === matrix.successorReadIntent.position
          ? {
              ...record,
              key: intentRecordKey(foreignOperation.operationId),
              event: GitReadIntentRecordedEvent.make({
                initiatedBy: foreignIntentEvent.initiatedBy,
                occurrenceClassification: foreignIntentEvent.occurrenceClassification,
                operation: foreignOperation,
                version: foreignIntentEvent.version
              })
            }
          : record
      )
      const foreignPrefixFirst = foreignPrefixRecords[0]
      if (foreignPrefixFirst === undefined) return yield* Effect.die("foreign restart prefix has no Run beginning")
      const foreignPrefix: RecoveryPrefix<RestartPrefixCutLabel> = {
        ...prefix,
        records: [foreignPrefixFirst, ...foreignPrefixRecords.slice(1)]
      }

      for (const lane of lanes) {
        const valid = yield* withRecoveryPrefixStore(prefix, lane, (storage) =>
          Effect.gen(function* () {
            const resources = yield* makeIntegrationTargetResourceController()
            return yield* runOrdinaryRestartActivation(prefix, matrix, storage, resources)
          })
        )
        const validTargetActions = valid.actions.filter(
          ({ semanticTag }) => semanticTag === expectedRestartActionTags[prefix.cut]
        )
        expect(validTargetActions, "valid exact operation dispatch / " + lane).toHaveLength(1)
        const validTargetAction = exactlyOne(validTargetActions, "valid target-lineage action")
        if (validTargetAction.operationId === undefined) {
          return yield* Effect.die("restart-prefix valid target-lineage action lacks an operation identity")
        }
        const validLineage = valid.records.filter(
          ({ event }) => event._tag === "TargetLineageObserved" && event.operationId === validTargetAction.operationId
        )
        expect(validLineage, "valid exact operation observed / " + lane).toHaveLength(1)
        const validLineageRecord = exactlyOne(validLineage, "valid target-lineage observation")
        if (validLineageRecord.event._tag !== "TargetLineageObserved") {
          return yield* Effect.die("restart-prefix valid lineage narrowing failed")
        }
        expect(validLineageRecord.event.operationId).not.toBe(OperationId.make("foreign-restart-lineage-operation"))

        const foreign = yield* withRecoveryPrefixStore(foreignPrefix, lane, (storage) =>
          Effect.gen(function* () {
            const resources = yield* makeIntegrationTargetResourceController()
            const activation = yield* runOrdinaryRestartActivation(
              foreignPrefix,
              matrix,
              storage,
              resources,
              foreignOperation
            )
            const records = activation.records
            return { activation, records, foreignOperation }
          })
        )
        expect(
          foreign.records.some(
            ({ event }) =>
              event._tag === "TargetLineageObserved" && event.operationId === foreign.foreignOperation.operationId
          ),
          "foreign operation chronology / " + lane
        ).toBe(false)
        expect(foreign.activation.foreignReadFailure, "foreign operation typed rejection / " + lane).toBeInstanceOf(
          GitTargetLineageReadFailure
        )
        expect(foreign.foreignOperation.predecessorOperationIds).toEqual(
          successorReadIntent.operation.predecessorOperationIds
        )
        expect(foreign.foreignOperation.plannedAttempt).toEqual(successorReadIntent.operation.plannedAttempt)
        expect(foreign.foreignOperation.integrationTarget).toEqual(successorReadIntent.operation.integrationTarget)
        expect(
          foreign.activation.invokedActions.filter(
            ({ operationId }) => operationId === foreign.foreignOperation.operationId
          ),
          "foreign operation live executor invocation / " + lane
        ).toHaveLength(1)
        expect(
          foreign.activation.records.filter(
            ({ event }) =>
              event._tag === "TargetLineageObserved" && event.operationId === foreign.foreignOperation.operationId
          ),
          "foreign operation no durable outcome / " + lane
        ).toHaveLength(0)
        expect(
          foreign.activation.actions.filter(({ operationId }) => operationId === foreign.foreignOperation.operationId),
          "foreign operation has no successful action outcome / " + lane
        ).toHaveLength(0)
      }
    }),
  120_000
)

it.effect(
  "rejects a successor Git candidate with wrong ordered parents",
  () =>
    Effect.gen(function* () {
      const run = yield* sourceRun()
      const matrix = restartPrefixesFrom(run.records)
      const prefix = prefixAt(matrix, "SuccessorFixed")
      if (
        matrix.successor.event._tag !== "IntegratorSuccessorSessionFixed" ||
        matrix.successorGitObserved.event._tag !== "IntegratorRunCandidateGitObserved" ||
        matrix.successorGitObserved.event.observation._tag !== "Commit"
      ) {
        return yield* Effect.die("restart-prefix fixture lacks typed successor Git candidate")
      }
      const successor = matrix.successor.event
      const expectedParents = [
        successor.successor.expectedTargetHead,
        successor.successor.acceptedResult.commit
      ] as const
      expect(matrix.successorGitObserved.event.observation.directParents).toEqual(expectedParents)
      const wrongParents: readonly [GitCommitSha, GitCommitSha] = [expectedParents[1], expectedParents[0]]
      if (
        matrix.successorRunStarted.event._tag !== "IntegratorRunStarted" ||
        matrix.successorRunResult.event._tag !== "IntegratorRunResultRecorded" ||
        matrix.successorRunResult.event.result._tag !== "PreparedCandidate" ||
        matrix.successorLineage.event._tag !== "TargetLineageObserved"
      ) {
        return yield* Effect.die("restart-prefix fixture lacks successor Integrator preparation facts")
      }
      const successorRunStarted = matrix.successorRunStarted.event
      const successorRunResult = matrix.successorRunResult.event
      const successorLineage = matrix.successorLineage.event
      const successorRunResultValue = successorRunResult.result
      if (successorRunResultValue._tag !== "PreparedCandidate") {
        return yield* Effect.die("restart-prefix fixture successor result narrowing failed")
      }
      const responsibility = deriveIntegrationAdmission(prefix.records).responsibilities.find(
        (candidate) =>
          candidate._tag === "StartedIntegrationResponsibility" &&
          candidate.plannedAttempt.attemptId === successor.successor.plannedAttempt.attemptId
      )
      if (responsibility?._tag !== "StartedIntegrationResponsibility") {
        return yield* Effect.die("restart-prefix fixture lacks successor integration responsibility")
      }
      const wrongObservation = IntegratorGitObservation.cases.Commit.make({
        candidateText: matrix.successorRunResult.event.result.candidateText,
        commit: matrix.successorGitObserved.event.observation.commit,
        directParents: wrongParents
      })

      for (const lane of lanes) {
        const rejection = yield* withRecoveryPrefixStore(prefix, lane, (storage) =>
          Effect.gen(function* () {
            const runId = prefix.records[0].runId
            const journal = InRunJournal.of({ append: storage.append, read: storage.read })
            const result = yield* prepareIntegrationCandidateRun({
              preparation: {
                responsibility,
                targetLineage: successorLineage.observation,
                targetLineageObservedAt: successor.successor.targetLineageObservedAt
              },
              run: successorRunStarted.run
            }).pipe(
              Effect.provideService(InRunJournal, journal),
              Effect.provideService(
                Integrator,
                Integrator.of({
                  prepare: (request) =>
                    Effect.succeed(
                      IntegratorResult.cases.PreparedCandidate.make({
                        candidateText: successorRunResultValue.candidateText,
                        correlation: request.correlation
                      })
                    )
                })
              ),
              Effect.provideService(
                IntegratorGit,
                IntegratorGit.of({ readCandidate: () => Effect.succeed(wrongObservation) })
              )
            )
            return { result, records: yield* storage.read(runId) }
          })
        )
        expect(rejection.result._tag, "wrong-parent successor protocol result / " + lane).toBe("CandidateRejected")
        const candidateObservation = exactlyOne(
          rejection.records.filter(
            ({ event }) =>
              event._tag === "IntegratorRunCandidateGitObserved" &&
              event.run.session.sessionId === successor.successor.sessionId
          ),
          "wrong-parent successor Git observation"
        )
        if (candidateObservation.event._tag !== "IntegratorRunCandidateGitObserved") {
          return yield* Effect.die("wrong-parent successor Git observation narrowing failed")
        }
        expect(candidateObservation.event.observation).toMatchObject({ _tag: "Commit", directParents: wrongParents })
      }
    }),
  120_000
)

it.effect("reuses one exact successor identity and rejects an out-of-order restart", () =>
  Effect.gen(function* () {
    const run = yield* sourceRun()
    const matrix = restartPrefixesFrom(run.records)
    expect(matrix.prefixes).toHaveLength(restartPrefixCutLabels.length)
    if (matrix.prefixes.length !== restartPrefixCutLabels.length) {
      return yield* Effect.die("delivery-story capstone lacks the required #255 restart prefixes")
    }
    const input = successorPreparationInputFor(matrix)
    const foreignAttemptRecord = run.records.find(
      ({ event }) =>
        event._tag === "TaskAttemptPlanned" &&
        event.operation.plannedAttempt.taskId !== input.predecessor.plannedAttempt.taskId
    )
    if (foreignAttemptRecord?.event._tag !== "TaskAttemptPlanned") {
      return yield* Effect.die("restart-prefix fixture lacks a foreign planned attempt")
    }
    const foreignInput = IntegratorSuccessorPreparationInput.make({
      ...input,
      predecessor: { ...input.predecessor, plannedAttempt: foreignAttemptRecord.event.operation.plannedAttempt },
      targetLineage: {
        ...input.targetLineage,
        targetHeadSha: input.predecessor.expectedTargetHead,
        plannedBaseIsAncestorOfTargetHead: true
      }
    })
    const freshReadIntentPrefix = prefixAt(matrix, "FreshReadIntent")
    const freshLineagePrefix = prefixAt(matrix, "FreshLineage")
    if (
      matrix.successor.event._tag !== "IntegratorSuccessorSessionFixed" ||
      matrix.successorLineage.event._tag !== "TargetLineageObserved"
    ) {
      return yield* Effect.die("restart-prefix fixture successor narrowing failed")
    }
    if (matrix.stale.event._tag !== "TargetPromotionStale") {
      return yield* Effect.die("restart-prefix fixture stale event narrowing failed")
    }
    const staleInput = { correlation: matrix.stale.event.correlation, targetPromotionStaleAt: matrix.stale.position }

    const executions = yield* Effect.forEach(lanes, (lane) =>
      Effect.gen(function* () {
        const quarantine = yield* withRecoveryPrefixStore(prefixAt(matrix, "Stale"), lane, (storage) =>
          Effect.gen(function* () {
            const stalePrefix = prefixAt(matrix, "Stale")
            const runId = stalePrefix.records[0].runId
            const journal = InRunJournal.of({ append: storage.append, read: storage.read })
            const first = yield* appendPromotionStaleIntegrationQuarantine(staleInput).pipe(
              Effect.provideService(InRunJournal, journal)
            )
            const second = yield* appendPromotionStaleIntegrationQuarantine(staleInput).pipe(
              Effect.provideService(InRunJournal, journal)
            )
            return { first, second, records: yield* storage.read(runId) }
          })
        )
        expect(quarantine.second).toEqual(quarantine.first)
        expect(quarantine.first.event).toEqual(matrix.quarantine.event)
        const quarantineSuffix = quarantine.records.slice(prefixAt(matrix, "Stale").records.length)
        expect(quarantineSuffix).toHaveLength(1)
        expect(quarantineSuffix[0]?.event).toEqual(matrix.quarantine.event)

        const idempotent = yield* withRecoveryPrefixStore(freshLineagePrefix, lane, (storage) =>
          Effect.gen(function* () {
            const runId = freshLineagePrefix.records[0].runId
            const journal = InRunJournal.of({ append: storage.append, read: storage.read })
            const first = yield* appendIntegratorSuccessorSessionIfNeeded(journal, input, yield* storage.read(runId))
            const second = yield* appendIntegratorSuccessorSessionIfNeeded(journal, input, yield* storage.read(runId))
            const records = yield* storage.read(runId)
            return { first, second, records }
          })
        )
        expect(idempotent.second).toEqual(idempotent.first)
        expect(idempotent.first.position).toBeGreaterThan(freshLineagePrefix.records.at(-1)?.position ?? -1)
        expect(idempotent.first.event).toEqual(matrix.successor.event)
        const successorSuffix = idempotent.records.slice(freshLineagePrefix.records.length)
        expect(successorSuffix).toHaveLength(1)
        expect(successorSuffix[0]?.event).toEqual(matrix.successor.event)

        const failure = yield* withRecoveryPrefixStore(freshReadIntentPrefix, lane, (storage) =>
          Effect.gen(function* () {
            const runId = freshReadIntentPrefix.records[0].runId
            const journal = InRunJournal.of({ append: storage.append, read: storage.read })
            return yield* appendIntegratorSuccessorSessionIfNeeded(journal, input, yield* storage.read(runId)).pipe(
              Effect.flip
            )
          })
        )
        expect(failure).toMatchObject({ _tag: "IntegratorJournalContradiction" })

        const foreignFailure = yield* withRecoveryPrefixStore(freshLineagePrefix, lane, (storage) =>
          Effect.gen(function* () {
            const runId = freshLineagePrefix.records[0].runId
            const journal = InRunJournal.of({ append: storage.append, read: storage.read })
            return yield* appendIntegratorSuccessorSessionIfNeeded(
              journal,
              foreignInput,
              yield* storage.read(runId)
            ).pipe(Effect.flip)
          })
        )
        expect(foreignFailure).toMatchObject({ _tag: "IntegratorJournalContradiction" })
        return lane
      })
    )

    expect(executions).toEqual(["memory", "sqlite"])
  })
)
