import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Deferred, Effect, Exit, Fiber, Layer, Option, Ref, Semaphore } from "effect"
import * as Cause from "effect/Cause"
import type { Scope } from "effect"
import { expect } from "vitest"
import {
  GitCommitSha,
  AcceptedResultEvidenceManifest,
  makeTaskWorkSpecification,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  type TaskId,
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
import { runStabilizedDelivery } from "../../../orchestrator/src/coordination/run/run-stabilization.js"
import { DeliveryRuntimeObservationObserver } from "../../../orchestrator/src/coordination/delivery/delivery-runtime-observation.js"
import { projectTrackerSnapshot } from "../../../orchestrator/src/authorities/task-tracker/graph.js"
import { requiredPlannedAttemptPositionsOf } from "../../../orchestrator/src/coordination/run/required-planned-attempt-positions.js"
import {
  deriveIntegrationAdmission,
  type StartedIntegrationResponsibility
} from "../../../orchestrator/src/workflow/protocols/integration-admission/protocol.js"
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
import {
  integratorSuccessorIdentitiesAreDistinct,
  integratorSuccessorResponsibilityMatches
} from "../../../orchestrator/src/workflow/protocols/integrator/events.js"
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
  makeTrackerGraphObservationOperation,
  makeTargetLineageObservationOperation,
  type WorkflowOperation
} from "../../../orchestrator/src/workflow/registry/operation.js"
import { GitReadIntentRecordedEvent, taskTrackerReadIntent } from "../../../orchestrator/src/workflow/registry/event.js"
import { intentRecordKey } from "../../../orchestrator/src/workflow-journal/record-key.js"
import { JournalPosition } from "../../../orchestrator/src/workflow-journal/identity.js"
import { reduceWorkflowJournalHistory } from "../../../orchestrator/src/coordination/reconstruction/history.js"
import type { JournalStore } from "../../../orchestrator/src/workflow-journal/store.js"
import { GitTargetLineageReadFailure } from "../../../orchestrator/src/authorities/git/target-lineage.js"
import { EvidenceStore } from "../../../orchestrator/src/workflow/protocols/evidence-store.js"
import {
  CompletionTaskClaim,
  CompletionTaskAcknowledgement,
  CompletionTaskBoundary,
  CompletionTaskRequestLookup,
  CompletionTaskRequestFailure,
  FocusedTaskCompletionReadFailure,
  FocusedTaskCompletionFacts,
  completionTaskClaimEquals,
  completionTaskRequestEquals,
  type CompletionTaskRequest
} from "../../../orchestrator/src/workflow/protocols/integration-finality/events.js"
import { latestPlannedAttemptExecutorEvidence } from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/evidence.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorWorkReportedEvent
} from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/events.js"
import { workflowJournalEventVersion } from "../../../orchestrator/src/workflow/kernel/event.js"
import { describeJournalEvent } from "../../../orchestrator/src/workflow/registry/event-descriptor.js"
import { TrackerRevision } from "../../../orchestrator/src/authorities/task-tracker/task.js"
import { UnclaimedTask } from "../../../orchestrator/src/authorities/task-tracker/claim-mutation.js"
import { controlledCompletionClaimBoundaryLayerFrom } from "../../../orchestrator/src/workflow/protocols/integration-finality/controlled-boundaries.js"

const lanes: ReadonlyArray<RecoveryStoreLane> = ["memory", "sqlite"]
/**
 * These acceptance scenarios replay seven durable cuts through both journal
 * stores; keep one explicit timeout policy for the whole matrix rather than
 * letting Vitest's ten-second default or per-test ad hoc values decide which
 * lane is exercised.
 */
const restartAcceptanceTimeout = 600_000
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

/**
 * DirectionApplied must complete the direction-owned A target-lineage read.
 * A concurrent continuation C read may settle before A in one store lane, but
 * it is not part of the selected restart boundary and is admitted only as its
 * exact correlated operation by the action-trace assertion.
 */
const directionAppliedRequiredSuffixTags: ReadonlyArray<string> = [
  "PlannedAttemptExecutorCommandProjectionObserved",
  "PlannedAttemptExecutorCommandProjectionObserved",
  "GitReadIntentRecorded",
  "PlannedAttemptWorktreeObserved",
  "GitReadIntentRecorded",
  "PlannedAttemptWorktreeObserved",
  "GitReadIntentRecorded",
  "PlannedAttemptWorktreeObserved",
  "GitReadIntentRecorded",
  "TargetLineageObserved"
]
const freshLineageRequiredSuffixTags: ReadonlyArray<string> = ["IntegratorSuccessorSessionFixed"]

/** Reads and acquisition may race while the selected restart action is in flight. */
const restartConcurrentActionTags: ReadonlySet<string> = new Set([
  "TrackerGraphReadRoute",
  "Recovered:ReadTrackerGraph",
  "Recovered:ReadTaskClaim",
  "Recovered:ReadTaskWorkSpecification",
  "Recovered:ReadTaskWorktree",
  "Recovered:ReadTargetLineage",
  "AcquireStartedIntegrationTarget",
  "ObservePlannedAttemptContinuationExecutor",
  "ObservePlannedAttemptContinuationWorktree"
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

/**
 * Planned-attempt transitions that cross the executor boundary. At the
 * Quarantined cut the release milestone must win admission before any of
 * these actions can contact the executor retained by the process restart.
 */
const restartExecutorBoundaryActionTags: ReadonlySet<string> = new Set([
  "ContinuePlannedAttemptExecutorWork",
  "ContinuePlannedAttemptExecutorWorkAfterCurrentFacts"
])

/** Ordinary runtime G2 stabilization may publish these records before the selected action. */
const ordinaryGraphStabilizationEventTags: ReadonlySet<JournalRecord["event"]["_tag"]> = new Set([
  "TaskTrackerReadIntentRecorded",
  "TaskTrackerFactsObserved"
])

interface SuccessorFixedTrackerEvidence {
  readonly windows: ReadonlyArray<readonly [number, number]>
  readonly operationIds: ReadonlySet<string>
}

const successorFixedTrackerEvidenceOf = (suffix: ReadonlyArray<JournalRecord>): SuccessorFixedTrackerEvidence => {
  const boundaryPairs: ReadonlyArray<readonly [JournalRecord["event"]["_tag"], JournalRecord["event"]["_tag"]]> = [
    ["CompletionClaimReplaced", "CompletionTaskCandidateAncestryReadIntended"],
    ["CompletionTaskAcknowledged", "CompletionClaimDeletionIntended"]
  ]
  const windows = boundaryPairs.flatMap(([startTag, endTag]) => {
    const start = suffix.find(({ event }) => event._tag === startTag)?.position
    const end = suffix.find(({ event }) => event._tag === endTag)?.position
    return start === undefined || end === undefined ? [] : [[start, end] as const]
  })
  const operationIds = new Set<string>()
  for (const record of suffix) {
    if (
      record.event._tag !== "TaskTrackerReadIntentRecorded" ||
      record.event.operation._tag !== "ReadCompletionTaskFacts"
    ) {
      continue
    }
    if (windows.some(([start, end]) => record.position > start && record.position < end)) {
      operationIds.add(String(record.event.operation.operationId))
    }
  }
  return { windows, operationIds }
}

const isRequiredSuccessorFixedTrackerRecord = (
  record: JournalRecord,
  evidence: SuccessorFixedTrackerEvidence
): boolean => {
  if (record.event._tag !== "TaskTrackerReadIntentRecorded" && record.event._tag !== "TaskTrackerFactsObserved") {
    return false
  }
  const operationId = journalOperationIdOf(record.event)
  return (
    operationId !== undefined &&
    evidence.operationIds.has(operationId) &&
    evidence.windows.some(([start, end]) => record.position > start && record.position < end)
  )
}

const sourceRun = () =>
  runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.deliveryInvariantStoryCapstone).pipe(
    Effect.provide(NodeCrypto.layer)
  )

/** The restart boundary is inserted after Git applies M but before the lost CAS response is observed. */
const targetPromotionLostResponseSource =
  maintainedAuthoredCassetteCatalog.targetPromotionLostResponseDiscoversCurrentCandidate
const targetPromotionLostResponseGraphRead = (() => {
  const selection = targetPromotionLostResponseSource.story.find(
    (item) => item._tag === "DalphSelects" && item.operation._tag === "ReadTrackerGraph"
  )
  const graphRead = targetPromotionLostResponseSource.story.find((item) => item._tag === "TrackerGraphReadReturned")
  if (selection?._tag !== "DalphSelects" || graphRead?._tag !== "TrackerGraphReadReturned") {
    return expect.fail("lost promotion cassette lacks its graph read")
  }
  return [selection, graphRead] as const
})()
const targetPromotionLostResponseClaimRead = (() => {
  const selection = targetPromotionLostResponseSource.story.find(
    (item) => item._tag === "DalphSelects" && item.operation._tag === "ReadTaskClaim"
  )
  const claimRead = targetPromotionLostResponseSource.story.find((item) => item._tag === "TaskClaimCurrentReadReturned")
  if (selection?._tag !== "DalphSelects" || claimRead?._tag !== "TaskClaimCurrentReadReturned") {
    return expect.fail("lost promotion cassette lacks its claim read")
  }
  return [selection, claimRead] as const
})()
const targetPromotionLostResponseRequest = (() => {
  const integrator = targetPromotionLostResponseSource.story.find((item) => item._tag === "IntegratorRequestReceived")
  const candidate = targetPromotionLostResponseSource.story.find(
    (item) => item._tag === "IntegratorGitObservationReturned"
  )
  if (
    integrator?._tag !== "IntegratorRequestReceived" ||
    candidate?._tag !== "IntegratorGitObservationReturned" ||
    candidate.observation._tag !== "Commit"
  ) {
    return expect.fail("lost promotion cassette lacks its exact candidate request")
  }
  return {
    qualifiedCandidate: {
      candidateCommit: candidate.observation.commit,
      candidateText: candidate.candidateText,
      directParents: candidate.observation.directParents,
      qualifiedAt: 32,
      run: { ordinal: 1, session: integrator.correlation }
    },
    requestId: `target-promotion:${integrator.correlation.sessionId}:1:${candidate.observation.commit}`
  }
})()
// The runner decodes this deliberately reconstructed story at its boundary;
// keeping the intermediate value unknown avoids coupling the fixture's
// mapped-union inference to the decoder's closed story schema.
const targetPromotionLostResponseRestartCassette: unknown = {
  ...targetPromotionLostResponseSource,
  name: "target promotion restarts after an applied compare-and-set response is lost",
  story: targetPromotionLostResponseSource.story.flatMap<unknown>((item) =>
    item._tag === "TargetPromotionCompareAndSetResponseLost"
      ? [
          item,
          {
            _tag: "CassetteKillsCoordinatorAtTargetPromotionReconciliationRead" as const,
            request: targetPromotionLostResponseRequest
          },
          { _tag: "CoordinatorProcessDies" as const },
          ...targetPromotionLostResponseGraphRead,
          ...targetPromotionLostResponseClaimRead
        ]
      : item._tag === "TargetPromotionGitReadReturned" && item.observation._tag === "CandidateCurrent"
        ? [item, ...targetPromotionLostResponseGraphRead]
        : [item]
  ) as ReadonlyArray<unknown>
}

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
  /** Planned-attempt correlation distinguishes a direction-owned read from a concurrent continuation read. */
  readonly plannedAttemptId: string | undefined
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
  readonly trackerGraphReadOperationIds: ReadonlyArray<OperationId>
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
  readonly journalAppendInvocationCount: number
  readonly boundaryCalls: BoundaryCalls
  readonly ownership: ReadonlyArray<ResourceOwnershipObservation>
  readonly resourceCalls: ResourceCallLog
  readonly executorBoundaryCalls: {
    readonly project: number
    readonly requestSuspension: number
    readonly startOrContinue: number
  }
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

const plannedAttemptIdOf = (action: MaterializedDeliveryAction): string | undefined => {
  if (action._tag === "FreshAttemptAction") return action.plannedAttempt.attemptId
  if (action._tag === "FreshOperationAction") {
    const route = action.proposal.route
    if (route._tag !== "RecoveredNewActionRoute") return undefined
    return route.action.plannedAttempt === null ? undefined : route.action.plannedAttempt.attemptId
  }
  if (action._tag === "AcceptedOperationAction") {
    const transition = action.proposal.route.transition
    if (!("plannedAttempt" in transition)) return undefined
    return transition.plannedAttempt.attemptId
  }
  return undefined
}

const observedActionOf = (action: MaterializedDeliveryAction): ObservedAction => {
  const plannedAttemptId = plannedAttemptIdOf(action)
  if (action._tag === "IdentityFreeAction") {
    const route = action.proposal.route
    return {
      materializedTag: action._tag,
      operationId: undefined,
      plannedAttemptId,
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
      plannedAttemptId,
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
      plannedAttemptId,
      proposalId: String(action.proposal.id),
      routeTag: route._tag,
      semanticTag: route._tag === "RecoveredNewActionRoute" ? "Recovered:" + route.action._tag : route._tag
    }
  }
  return {
    materializedTag: action._tag,
    operationId: action.operationId,
    plannedAttemptId,
    proposalId: String(action.proposal.id),
    routeTag: action.proposal.route._tag,
    semanticTag: action.proposal.route._tag
  }
}

type ContinuationReadKind = "Worktree" | "TargetLineage"

const continuationOperationIdsFor = (
  actions: ReadonlyArray<ObservedAction>,
  kinds: ReadonlySet<ContinuationReadKind>,
  retainedAttemptId: string | undefined
): ReadonlySet<string> => {
  return new Set(
    actions.flatMap(({ operationId, plannedAttemptId, semanticTag }) => {
      if (operationId === undefined) return []
      const kind: ContinuationReadKind | undefined =
        semanticTag === "Recovered:ReadTaskWorktree" || semanticTag === "ObservePlannedAttemptContinuationWorktree"
          ? "Worktree"
          : semanticTag === "Recovered:ReadTargetLineage" ||
              semanticTag === "ObservePlannedAttemptContinuationTargetLineage"
            ? "TargetLineage"
            : undefined
      return kind !== undefined && kinds.has(kind) && plannedAttemptId !== retainedAttemptId
        ? [String(operationId)]
        : []
    })
  )
}

const journalOperationIdOf = (event: JournalRecord["event"]): string | undefined => {
  if (event._tag === "GitReadIntentRecorded" || event._tag === "TaskTrackerReadIntentRecorded") {
    return String(event.operation.operationId)
  }
  if (event._tag === "TaskTrackerFactsObserved") return String(event.operationId)
  if (event._tag === "PlannedAttemptWorktreeObserved" || event._tag === "TargetLineageObserved") {
    return String(event.operationId)
  }
  return undefined
}

const restartExpectedAttemptIdOf = (
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  matrix: RestartPrefixMatrix
): string | undefined => {
  if (prefix.cut !== "DirectionApplied" && prefix.cut !== "FreshReadIntent") return undefined
  const successorReadIntent = matrix.successorReadIntent.event
  return successorReadIntent._tag === "GitReadIntentRecorded"
    ? successorReadIntent.operation.plannedAttempt.attemptId
    : undefined
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
  activation: OrdinaryActivation,
  milestoneTagsOverride?: ReadonlyArray<string>
): void => {
  const label = prefix.cut + " / " + lane
  const actions = activation.actions
  const milestoneTags = milestoneTagsOverride ?? restartMilestoneTags[prefix.cut]
  const expectedAttemptId = restartExpectedAttemptIdOf(prefix, matrix)
  const milestoneIndexes = milestoneTags.map((semanticTag) => {
    const matches = actions.filter(
      (action) =>
        action.semanticTag === semanticTag &&
        (expectedAttemptId === undefined || action.plannedAttemptId === expectedAttemptId)
    )
    return actions.indexOf(exactlyOne(matches, label + " exact milestone " + semanticTag))
  })

  const operationIds = actions.flatMap(({ operationId }) => (operationId === undefined ? [] : [String(operationId)]))
  const actionsByOperation = new Map<string, ReadonlyArray<ObservedAction>>()
  for (const action of actions) {
    if (action.operationId === undefined) continue
    const operationId = String(action.operationId)
    actionsByOperation.set(operationId, [...(actionsByOperation.get(operationId) ?? []), action])
  }
  const correlatedContinuationOperationIds = new Set<string>()
  for (const [operationId, related] of actionsByOperation) {
    if (related.length <= 1) continue
    // A pending recovery read and its ordinary continuation can expose the
    // same operation while the runtime reconciles one exact boundary. No
    // unrelated action may reuse that operation identity.
    const tags = related.map(({ semanticTag }) => semanticTag).sort()
    expect(
      [
        ["ObservePlannedAttemptContinuationTargetLineage", "Recovered:ReadTargetLineage"],
        ["ObservePlannedAttemptContinuationWorktree", "Recovered:ReadTaskWorktree"],
        ["Recovered:ReadTrackerGraph", "RefreshCurrentGraphAfterClaim"]
      ].some((allowed) => JSON.stringify(allowed.toSorted()) === JSON.stringify(tags)),
      label + " shared operation identity " + operationId
    ).toBe(true)
    if (
      JSON.stringify(["Recovered:ReadTrackerGraph", "RefreshCurrentGraphAfterClaim"].toSorted()) ===
      JSON.stringify(tags)
    ) {
      expect(prefix.cut, label + " graph refresh shared identity cut").toBe("DirectionApplied")
      const responsibility = deriveIntegrationAdmission(prefix.records).responsibilities.find(
        (candidate) => candidate._tag === "StartedIntegrationResponsibility"
      )
      if (responsibility?._tag !== "StartedIntegrationResponsibility") {
        expect.fail(label + " graph refresh shared identity lacks its started responsibility")
        return
      }
      const taskId = responsibility.plannedAttempt.taskId
      const claimObservation = activation.records.findLast(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          (event.observation._tag === "FocusedTaskClaimFacts" ||
            event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
          String(event.observation.coverage.taskId) === String(taskId)
      )
      if (
        claimObservation?.event._tag !== "TaskTrackerFactsObserved" ||
        (claimObservation.event.observation._tag !== "FocusedTaskClaimFacts" &&
          claimObservation.event.observation._tag !== "FocusedTaskClaimFactsUnreadable")
      ) {
        expect.fail(label + " graph refresh shared identity lacks its focused claim observation")
        return
      }
      const claimObservationOperationId = claimObservation.event.operationId
      const claimIntent = activation.records.findLast(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTaskClaim" &&
          String(event.operation.operationId) === String(claimObservationOperationId)
      )
      if (
        claimIntent?.event._tag !== "TaskTrackerReadIntentRecorded" ||
        claimIntent.event.operation._tag !== "ReadTaskClaim"
      ) {
        expect.fail(label + " graph refresh shared identity lacks its claim intent")
        return
      }
      const expectedOperationId = OperationId.make(`responsibility:${taskId}:after:${claimObservation.position}:graph`)
      const graphIntent = exactlyOne(
        activation.records.filter(
          ({ event }) =>
            event._tag === "TaskTrackerReadIntentRecorded" &&
            event.operation._tag === "ReadTrackerGraph" &&
            event.operation.operationId === expectedOperationId
        ),
        label + " exact post-claim graph refresh intent"
      )
      if (
        graphIntent.event._tag !== "TaskTrackerReadIntentRecorded" ||
        graphIntent.event.operation._tag !== "ReadTrackerGraph"
      ) {
        expect.fail(label + " graph refresh shared identity lacks its typed graph intent")
      } else {
        expect(operationId, label + " exact post-claim graph refresh identity").toBe(String(expectedOperationId))
        expect(graphIntent.position, label + " graph refresh follows its claim observation").toBeGreaterThan(
          claimObservation.position
        )
        expect(claimObservation.position, label + " claim observation follows its read intent").toBeGreaterThan(
          claimIntent.position
        )
        expect(
          graphIntent.event.operation.predecessorOperationIds,
          label + " graph refresh predecessor cardinality"
        ).toEqual([claimIntent.event.operation.operationId])
        expect(graphIntent.event.operation.readShape._tag, label + " graph refresh read shape").toBe(
          "CompleteTargetClosure"
        )
        expect(
          graphIntent.event.operation.readShape.explicitlyCoveredTaskIds,
          label + " graph refresh task coverage"
        ).toEqual([taskId])
        expect(graphIntent.event.operation.target, label + " graph refresh target").toEqual(
          claimObservation.event.observation.target
        )
      }
    }
    correlatedContinuationOperationIds.add(operationId)
  }
  expect(operationIds.length - actionsByOperation.size, label + " operation identity duplicate accounting").toBe(
    [...actionsByOperation.values()].reduce((duplicates, related) => duplicates + Math.max(0, related.length - 1), 0)
  )
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
    if (action.operationId !== undefined && correlatedContinuationOperationIds.has(String(action.operationId))) continue
    expect(restartConcurrentActionTags.has(action.semanticTag), label + " unrelated action " + action.semanticTag).toBe(
      true
    )
  }

  const selected = actions[milestoneIndexes[0] ?? -1]
  if (selected === undefined) return
  const expectedMaterializedTag =
    milestoneTags[0] === "TrackerGraphReadRoute"
      ? "FreshOperationAction"
      : prefix.cut === "DirectionApplied"
        ? "FreshOperationAction"
        : prefix.cut === "FreshReadIntent"
          ? "AcceptedOperationAction"
          : "IdentityFreeAction"
  const expectedRouteTag =
    milestoneTags[0] === "TrackerGraphReadRoute"
      ? "TrackerGraphReadRoute"
      : prefix.cut === "DirectionApplied"
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
  readonly beforeAcquire: IntegrationTargetResourceSnapshot
  readonly afterAcquire: IntegrationTargetResourceSnapshot
  readonly resourceCalls: ResourceCallLog
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
  stopAfterGraphRead = false,
  initialHeldResponsibility?: StartedIntegrationResponsibility
): Effect.fn.Return<OrdinaryActivation, unknown, Scope.Scope> {
  const runId = prefix.records[0].runId
  const began = prefix.records[0]
  if (began.event._tag !== "WorkflowRunBegan") {
    return yield* Effect.die("restart-prefix activation requires WorkflowRunBegan")
  }
  const target = began.event.target
  const initial = reduceWorkflowJournalHistory(runId, yield* storage.read(runId))
  if (initial._tag === "InvalidWorkflowJournalHistory") return yield* Effect.die(initial)
  const expectedAttemptId = restartExpectedAttemptIdOf(prefix, matrix)
  const graph = graphSnapshotFrom(initial.records)
  if (graph === undefined) return yield* Effect.die("restart-prefix fixture lacks complete graph facts")
  const graphForRuntime = prefix.cut === "SuccessorFixed" ? matrix.completedGraph : graph
  const operationPrefix = "restart-prefix:" + String(runId) + ":"
  // Allocator ordinals are local to this replay. Existing journal length is a
  // safe upper bound, so no opaque OperationId decoding is needed.
  const operationOrdinal = initial.records.length

  const resourceCalls = yield* Ref.make<ResourceCallLog>({
    acquireCount: 0,
    acceptedPublicationCount: 0,
    releaseCount: 0,
    releaseAllCount: 0,
    releasePositions: []
  })
  if (initialHeldResponsibility !== undefined) {
    yield* resources.acquire(initialHeldResponsibility)
    yield* resources.publishAcceptedOwnership(initialHeldResponsibility)
  }
  const executorBoundaryCalls = yield* Ref.make({ project: 0, requestSuspension: 0, startOrContinue: 0 })
  const trackerGraphReadCalls = yield* Ref.make<ReadonlyArray<OperationId>>([])
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
  const journalAppendInvocationCount = yield* Ref.make(0)
  const journalKeys = yield* Ref.make(new Set(initial.records.map(({ key }) => key)))
  const observedStorage: JournalStore["Service"] = {
    ...storage,
    append: (appendRunId, key, event) =>
      Ref.update(journalAppendInvocationCount, (count) => count + 1)
        .pipe(Effect.andThen(storage.append(appendRunId, key, event)))
        .pipe(
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
  const allocatedOperationIds = new Set<OperationId>()

  const session = prefix.records.find(({ event }) => event._tag === "IntegratorSessionFixed")
  if (session?.event._tag !== "IntegratorSessionFixed") {
    return yield* Effect.die("restart-prefix activation requires predecessor IntegratorSessionFixed")
  }
  const recovery = yield* makeRunRecoveryProjection(
    runId,
    session.event.correlation.integrationTarget,
    observedResources,
    disabledTargetPromotionRuntime,
    true,
    true
  ).pipe(Effect.provideService(InRunJournal, inRunJournal))
  const lifecycle = yield* makeApplicationExitLifecycle()
  const targetReached = yield* Ref.make(false)
  const ownership = yield* Ref.make<ReadonlyArray<ResourceOwnershipObservation>>([])
  const protocolOwnerCount = yield* Ref.make(0)
  const knownIntegrationResponsibilityPositions = new Set(
    deriveIntegrationAdmission(initial.records).responsibilities.map(({ queuedAt }) => queuedAt)
  )
  const runtimeObserver = DeliveryRuntimeObservationObserver.of({
    observe: ({ evaluation, liveOwners }) => {
      return Effect.all({
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
        )
      )
    }
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
  const acceptedResultEvidence = new TextEncoder().encode(
    JSON.stringify(
      AcceptedResultEvidenceManifest.make({
        commit: completionClaim.promotionCorrelation.qualifiedCandidate.run.session.acceptedResult.commit,
        correlation: {
          attemptId: completionClaim.plannedAttempt.attemptId,
          runId: completionClaim.plannedAttempt.runId
        },
        formatVersion: 1,
        outcome: "Accepted",
        predecessor: null
      })
    )
  )
  const completionClaimLayer = controlledCompletionClaimBoundaryLayerFrom([activeClaimRecord.event.claim])
  const completionTaskLayer = Layer.effect(
    CompletionTaskBoundary,
    Effect.gen(function* () {
      const appliedRequests = yield* Ref.make(new Map<OperationId, CompletionTaskRequest>())
      const completed = yield* Ref.make(false)
      const latestCompletionClaim = Effect.fn("RestartPrefix.latestCompletionClaim")(function* () {
        const records = yield* observedStorage.read(runId)
        return records.findLast(
          ({ event }) =>
            event._tag === "CompletionClaimReplaced" &&
            event.claim.plannedAttempt.attemptId === completionClaim.plannedAttempt.attemptId
        )?.event
      })
      const focusedFactsFor = Effect.fn("RestartPrefix.focusedCompletionFacts")(function* (
        taskId: typeof completionClaim.plannedAttempt.taskId,
        targetForRead: typeof target,
        operationId: OperationId
      ) {
        if (taskId !== completionFacts.taskId || targetForRead !== completionFacts.target) {
          return yield* new FocusedTaskCompletionReadFailure({
            detail: "restart-prefix focused completion facts target mismatch",
            taskId
          })
        }
        const claimRecord = yield* latestCompletionClaim().pipe(
          Effect.mapError(
            (error) =>
              new FocusedTaskCompletionReadFailure({
                detail: `restart-prefix completion claim read failed: ${String(error)}`,
                taskId
              })
          )
        )
        if (claimRecord?._tag !== "CompletionClaimReplaced") {
          return yield* new FocusedTaskCompletionReadFailure({
            detail: "restart-prefix completion claim replacement is not yet observed",
            taskId
          })
        }
        return {
          ...completionFacts,
          currentClaim: claimRecord.claim,
          lifecycle: (yield* Ref.get(completed)) ? ("CompletedSuccessfully" as const) : ("Open" as const),
          operationId
        }
      })
      const completeTask = Effect.fn("RestartPrefix.completeTask")(function* (request: CompletionTaskRequest) {
        const prior = (yield* Ref.get(appliedRequests)).get(request.operationId)
        if (prior !== undefined) {
          return completionTaskRequestEquals(prior, request)
            ? CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId })
            : yield* new CompletionTaskRequestFailure({
                detail: "restart-prefix completion operation identity is already bound to another request",
                outcome: "DefinitelyNotApplied",
                request
              })
        }
        const current = yield* focusedFactsFor(request.taskId, target, request.operationId).pipe(
          Effect.mapError(
            (error) => new CompletionTaskRequestFailure({ detail: error.detail, outcome: "Unknown", request })
          )
        )
        if (current.lifecycle !== "Open" || !completionTaskClaimEquals(current.currentClaim, request.claim)) {
          return yield* new CompletionTaskRequestFailure({
            detail: "restart-prefix completion request is not bound to the current claim",
            outcome: "DefinitelyNotApplied",
            request
          })
        }
        yield* Ref.update(appliedRequests, (all) => new Map(all).set(request.operationId, request))
        yield* Ref.set(completed, true)
        return CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId })
      })
      const readCompletionRequest = Effect.fn("RestartPrefix.readCompletionRequest")(function* (
        request: CompletionTaskRequest
      ) {
        const applied = (yield* Ref.get(appliedRequests)).get(request.operationId)
        return applied === undefined
          ? CompletionTaskRequestLookup.cases.NotApplied.make({ request })
          : completionTaskRequestEquals(applied, request)
            ? CompletionTaskRequestLookup.cases.Applied.make({ request })
            : CompletionTaskRequestLookup.cases.Unreadable.make({
                detail: "restart-prefix completion operation identity contradicts the applied request",
                request
              })
      })
      return CompletionTaskBoundary.of({
        completeTask,
        readCompletionRequest,
        readFocusedTaskCompletion: focusedFactsFor
      })
    })
  )
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
    const operationAuthorityContext = ({
      operationId: _operationId,
      predecessorOperationIds: _predecessorOperationIds,
      ...context
    }: typeof operation) => JSON.stringify(context)
    const hasRecordedPlannedAttempt = initial.records.some(
      ({ event }) =>
        event._tag === "TaskAttemptPlanned" &&
        JSON.stringify(event.operation.plannedAttempt) === JSON.stringify(operation.plannedAttempt)
    )
    const predecessorOperationId =
      operation.predecessorOperationIds.length === 1 ? operation.predecessorOperationIds[0] : undefined
    const predecessorLineageOperation =
      predecessorOperationId === undefined ? undefined : lineageIntents.get(predecessorOperationId)
    const matchesRecordedLineageAuthority = [...lineageIntents.values()].some(
      (candidate) =>
        candidate.plannedAttempt.attemptId === operation.plannedAttempt.attemptId &&
        candidate.plannedAttempt.runId === operation.plannedAttempt.runId &&
        operationAuthorityContext(operation) === operationAuthorityContext(candidate)
    )
    const hasExactRuntimeCausalContext =
      hasRecordedPlannedAttempt &&
      operation.predecessorOperationIds.length === 1 &&
      matchesRecordedLineageAuthority &&
      predecessorOperationId !== undefined &&
      (allocatedOperationIds.has(predecessorOperationId) ||
        (predecessorLineageOperation !== undefined &&
          operationAuthorityContext(operation) === operationAuthorityContext(predecessorLineageOperation)))
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
    readTrackerGraph: (operation) =>
      Ref.update(trackerGraphReadCalls, (operationIds) => [...operationIds, operation.operationId]).pipe(
        Effect.andThen(
          inRunJournal
            .read(runId)
            .pipe(
              Effect.map((records) =>
                records.some(({ event }) => event._tag === "IntegrationFinalitySettled")
                  ? matrix.completedGraph
                  : graphForRuntime
              )
            )
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
            const isExpectedAction =
              observed.value.semanticTag === expectedRestartActionTags[prefix.cut] &&
              (expectedAttemptId === undefined || observed.value.plannedAttemptId === expectedAttemptId)
            if (
              isExpectedAction ||
              (stopAfterGraphRead &&
                (observed.value.semanticTag === "TrackerGraphReadRoute" ||
                  observed.value.semanticTag === "RefreshCurrentGraphAfterClaim"))
            ) {
              yield* Ref.set(targetReached, true)
              yield* Deferred.succeed(actionReached, undefined)
              // The production wrapper releases process-local integration
              // ownership at this restart boundary after the selected action
              // settles. No test-only release or reacquisition is needed.
              yield* lifecycle.requestExit
            }
          })
  })
  const executorReportFor = (correlation: Parameters<PlannedAttemptExecutor["Service"]["project"]>[0]) => {
    const plannedAttempt = initial.records.findLast(
      ({ event }) =>
        event._tag === "TaskAttemptPlanned" &&
        event.operation.plannedAttempt.attemptId === correlation.attemptId &&
        event.operation.plannedAttempt.runId === correlation.runId
    )
    return plannedAttempt?.event._tag === "TaskAttemptPlanned"
      ? latestPlannedAttemptExecutorEvidence(initial.records, plannedAttempt.event.operation.plannedAttempt)?.report
      : undefined
  }
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
            Effect.map((ordinal) => {
              const operationId = OperationId.make(operationPrefix + String(ordinal))
              allocatedOperationIds.add(operationId)
              return operationId
            })
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
      EvidenceStore,
      EvidenceStore.of({
        put: () => Effect.die("restart-prefix does not publish evidence"),
        read: () => Effect.succeed(acceptedResultEvidence)
      })
    ),
    Layer.succeed(
      PlannedAttemptExecutor,
      PlannedAttemptExecutor.of({
        project: (correlation) =>
          Ref.update(executorBoundaryCalls, (current) => ({ ...current, project: current.project + 1 })).pipe(
            Effect.andThen(
              Effect.succeed(
                (() => {
                  const report = executorReportFor(correlation)
                  return report === undefined
                    ? PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
                    : PlannedAttemptExecutorProjection.cases.Exact.make({ report })
                })()
              )
            )
          ),
        requestSuspension: () =>
          Ref.update(executorBoundaryCalls, (current) => ({
            ...current,
            requestSuspension: current.requestSuspension + 1
          })).pipe(Effect.andThen(Effect.die("restart-prefix " + prefix.cut + " action does not suspend an attempt"))),
        startOrContinue: () =>
          Ref.update(executorBoundaryCalls, (current) => ({
            ...current,
            startOrContinue: current.startOrContinue + 1
          })).pipe(Effect.andThen(Effect.die("restart-prefix " + prefix.cut + " action does not continue an attempt")))
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
        const executorBoundaryAdmissionClosed =
          prefix.cut === "Quarantined" && restartExecutorBoundaryActionTags.has(observed.semanticTag)
        const liveExecution = Effect.gen(function* () {
          if (executorBoundaryAdmissionClosed) return yield* Effect.never
          return yield* actionExecutionGate.withPermit(live.execute(action, lease))
        })
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
                Effect.raceFirst(liveExecution, lifecycle.awaitExitRequested.pipe(Effect.andThen(Effect.interrupt)))
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
    return yield* runStabilizedDelivery(target, relation).pipe(
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
          ", " +
          prefix.cut +
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
    journalAppendInvocationCount: yield* Ref.get(journalAppendInvocationCount),
    boundaryCalls: {
      targetPromotion: yield* Ref.get(targetPromotionCalls),
      integrator: yield* Ref.get(integratorCalls),
      integratorGit: yield* Ref.get(integratorGitCalls),
      trackerGraphReadOperationIds: yield* Ref.get(trackerGraphReadCalls)
    },
    ownership: yield* Ref.get(ownership),
    resourceCalls: yield* Ref.get(resourceCalls),
    executorBoundaryCalls: yield* Ref.get(executorBoundaryCalls),
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
        return yield* runOrdinaryRestartActivation(
          prefix,
          matrix,
          storage,
          resources,
          undefined,
          false,
          prefix.cut === "Quarantined"
        )
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
      const journal = InRunJournal.of({ append: storage.append, read: storage.read })
      const recovery = yield* makeRunRecoveryProjection(
        runId,
        session.event.correlation.integrationTarget,
        observedResources,
        disabledTargetPromotionRuntime,
        true,
        true
      ).pipe(Effect.provideService(InRunJournal, journal))
      const beforeAcquire = yield* observedResources.snapshot
      const snapshot = yield* recovery.readDeliveryProjection
      const afterAcquire = yield* observedResources.snapshot
      return {
        snapshot,
        beforeAcquire,
        afterAcquire,
        resourceCalls: yield* Ref.get(resourceCalls),
        records: yield* storage.read(runId)
      }
    })
  )

type RefreshCurrentGraphOperation = Extract<WorkflowOperation, { readonly _tag: "ReadTrackerGraph" }>

const graphRefreshOperationFor = (
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  taskId: TaskId
): RefreshCurrentGraphOperation => {
  const graph = prefix.records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "CompleteTaskTrackerFacts" ||
        event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed") &&
      event.observation.factFamilies.every(({ coverage }) => coverage.explicitlyCoveredTaskIds.includes(taskId))
  )
  const claim = prefix.records.findLast(
    ({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      (event.observation._tag === "FocusedTaskClaimFacts" ||
        event.observation._tag === "FocusedTaskClaimFactsUnreadable") &&
      event.observation.coverage.taskId === taskId
  )
  if (
    graph?.event._tag !== "TaskTrackerFactsObserved" ||
    claim?.event._tag !== "TaskTrackerFactsObserved" ||
    (graph.event.observation._tag !== "CompleteTaskTrackerFacts" &&
      graph.event.observation._tag !== "UnchangedTaskTrackerFactsReconfirmed") ||
    (claim.event.observation._tag !== "FocusedTaskClaimFacts" &&
      claim.event.observation._tag !== "FocusedTaskClaimFactsUnreadable")
  ) {
    return expect.fail("restart-prefix fixture lacks graph and focused-claim facts for refresh")
  }
  return makeTrackerGraphObservationOperation(
    OperationId.make(`responsibility:${taskId}:after:${claim.position}:graph`),
    graph.event.observation.target,
    [claim.event.operationId],
    [taskId]
  )
}

const intentOnlyGraphRefreshPrefix = (
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  operation: RefreshCurrentGraphOperation
): RecoveryPrefix<RestartPrefixCutLabel> => {
  const first = prefix.records[0]
  const last = prefix.records[prefix.records.length - 1]
  if (last === undefined) return expect.fail("restart-prefix fixture has no records")
  const intent: JournalRecord = {
    event: taskTrackerReadIntent(operation),
    key: intentRecordKey(operation.operationId),
    position: JournalPosition.make(Number(last.position) + 1),
    runId: first.runId
  }
  return { ...prefix, records: [first, ...prefix.records.slice(1), intent] }
}

const runningExecutorAfter = (
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  plannedAttempt: StartedIntegrationResponsibility["plannedAttempt"]
): RecoveryPrefix<RestartPrefixCutLabel> => {
  const first = prefix.records[0]
  const last = prefix.records[prefix.records.length - 1]
  if (last === undefined) return expect.fail("restart-prefix fixture has no records")
  const isOpenResponsibility = (record: JournalRecord): boolean => {
    if (record.event._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan") return false
    const responsibilityAttemptId = record.event.plannedAttempt.attemptId
    return !prefix.records.some(
      (candidate) =>
        candidate.position > record.position &&
        candidate.event._tag === "PlannedAttemptExecutorWorkReported" &&
        candidate.event.report._tag === "Terminal" &&
        candidate.event.report.correlation.attemptId === responsibilityAttemptId
    )
  }
  const requestedResponsibility = prefix.records.find(
    ({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
      event.plannedAttempt.attemptId === plannedAttempt.attemptId
  )
  const openResponsibility =
    requestedResponsibility !== undefined && isOpenResponsibility(requestedResponsibility)
      ? requestedResponsibility
      : prefix.records.findLast(isOpenResponsibility)
  if (openResponsibility?.event._tag !== "PlannedAttemptExecutorWorkResponsibilityBegan") {
    return expect.fail("pending Running fixture lacks an open executor responsibility")
  }
  const pendingAttempt = openResponsibility.event.plannedAttempt
  const attemptRecords = prefix.records.filter(
    ({ event }) =>
      (event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
        event.plannedAttempt.attemptId === pendingAttempt.attemptId) ||
      (event._tag === "PlannedAttemptExecutorCommandIntended" &&
        event.plannedAttempt.attemptId === pendingAttempt.attemptId) ||
      (event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.attemptId === pendingAttempt.attemptId)
  )
  const hasTerminalResult = attemptRecords.some(
    ({ event }) => event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "Terminal"
  )
  if (hasTerminalResult) {
    return expect.fail("pending Running fixture cannot append after a terminal executor result")
  }
  const priorCommandOrdinals = attemptRecords.flatMap(({ event }) =>
    event._tag === "PlannedAttemptExecutorCommandIntended" ? [Number(event.ordinal)] : []
  )
  const commandOrdinal = Math.max(0, ...priorCommandOrdinals) + 1
  const command = PlannedAttemptExecutorCommandIntendedEvent.make({
    command: "StartOrContinue",
    initiatedBy: { _tag: "DalphCoordinator" },
    occurrenceClassification: "InitiatedAction",
    ordinal: PlannedAttemptExecutorCommandOrdinal.make(commandOrdinal),
    plannedAttempt: pendingAttempt,
    version: workflowJournalEventVersion
  })
  const priorReports = attemptRecords.flatMap(({ event }) =>
    event._tag === "PlannedAttemptExecutorWorkReported" ? [Number(event.ordinal)] : []
  )
  const reportOrdinal = Math.max(0, ...priorReports) + 1
  const report = PlannedAttemptExecutorWorkReportedEvent.make({
    ordinal: PlannedAttemptExecutorReportOrdinal.make(reportOrdinal),
    report: PlannedAttemptExecutorReport.cases.Running.make({
      correlation: { attemptId: pendingAttempt.attemptId, runId: pendingAttempt.runId }
    }),
    version: workflowJournalEventVersion
  })
  return {
    ...prefix,
    records: [
      first,
      ...prefix.records.slice(1),
      {
        event: command,
        key: describeJournalEvent(command).expectedKey,
        position: JournalPosition.make(Number(last.position) + 1),
        runId: first.runId
      },
      {
        event: report,
        key: describeJournalEvent(report).expectedKey,
        position: JournalPosition.make(Number(last.position) + 2),
        runId: first.runId
      }
    ]
  }
}

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

/** The ordinary successor path must carry the exact S2/H2/C and queue facts, not merely a new tag. */
const assertSuccessorFacts = (matrix: RestartPrefixMatrix): void => {
  if (
    matrix.successor.event._tag !== "IntegratorSuccessorSessionFixed" ||
    matrix.successorLineage.event._tag !== "TargetLineageObserved"
  ) {
    return expect.fail("restart-prefix fixture successor narrowing failed")
  }
  const predecessor = matrix.successor.event.predecessor
  const successor = matrix.successor.event.successor
  expect(integratorSuccessorResponsibilityMatches(predecessor, successor)).toBe(true)
  expect(integratorSuccessorIdentitiesAreDistinct(predecessor, successor)).toBe(true)
  expect(successor.sessionId).not.toBe(predecessor.sessionId)
  expect(successor.candidateResource).not.toBe(predecessor.candidateResource)
  expect(successor.expectedTargetHead).not.toBe(predecessor.expectedTargetHead)
  expect(successor.expectedTargetHead).toBe(matrix.successorLineage.event.observation.targetHeadSha)
  expect(successor.targetLineageObservedAt).toBe(matrix.successorLineage.position)
  expect(successor.plannedAttempt).toEqual(predecessor.plannedAttempt)
  expect(successor.acceptedResult).toEqual(predecessor.acceptedResult)
  expect(successor.integrationTarget).toEqual(predecessor.integrationTarget)
  expect(successor.queuedAt).toBe(predecessor.queuedAt)
  expect(successor.startedAt).toBe(predecessor.startedAt)
  expect(matrix.successorLineage.event.observation.plannedBaseSha).toBe(successor.plannedAttempt.baseSha)
  const successorRun = matrix.successorRunStarted.event
  if (successorRun._tag !== "IntegratorRunStarted") return expect.fail("successor run narrowing failed")
  expect(successorRun.run.session).toEqual(successor)
}

it.effect(
  "restarts after a lost promotion response and reconciles the exact current Git head before retrying",
  () =>
    Effect.gen(function* () {
      const run = yield* runAuthoredScenarioCassette(targetPromotionLostResponseRestartCassette).pipe(
        Effect.provide(NodeCrypto.layer)
      )
      const attempts = run.records.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")
      const success = run.records.find(({ event }) => event._tag === "TargetPromotionObservedSuccess")
      const lost = run.observationCaptures.find(
        (capture) =>
          capture._tag === "AuthoredStoryOccurrenceCaptured" &&
          capture.occurrence._tag === "TargetPromotionCompareAndSetResponseLost"
      )
      const current = run.observationCaptures.find(
        (capture) =>
          capture._tag === "AuthoredStoryOccurrenceCaptured" &&
          capture.occurrence._tag === "TargetPromotionGitReadReturned" &&
          capture.occurrence.observation._tag === "CandidateCurrent"
      )
      const restart = run.observationCaptures.find(
        (capture) =>
          capture._tag === "AuthoredStoryOccurrenceCaptured" &&
          capture.occurrence._tag === "CoordinatorProcessDies" &&
          lost?._tag === "AuthoredStoryOccurrenceCaptured" &&
          capture.storyPosition > lost.storyPosition
      )

      expect(attempts).toHaveLength(1)
      expect(lost).toBeDefined()
      expect(restart).toBeDefined()
      expect(current).toBeDefined()
      if (
        attempts.length !== 1 ||
        success?.event._tag !== "TargetPromotionObservedSuccess" ||
        lost?._tag !== "AuthoredStoryOccurrenceCaptured" ||
        current?._tag !== "AuthoredStoryOccurrenceCaptured" ||
        restart?._tag !== "AuthoredStoryOccurrenceCaptured"
      ) {
        return yield* Effect.die("lost promotion restart fixture lacks typed boundary evidence")
      }
      expect(lost.storyPosition).toBeLessThan(restart.storyPosition)
      expect(restart.storyPosition).toBeLessThan(current.storyPosition)
      expect(current.storyPosition).toBeGreaterThan(lost.storyPosition)
      expect(success.event.observation).toMatchObject({
        _tag: "ReconciledCandidateCurrent",
        candidateAncestry: "Current",
        targetHeadSha: "cccccccccccccccccccccccccccccccccccccccc"
      })
      expect(run.records.filter(({ event }) => event._tag === "TargetPromotionObservedSuccess")).toHaveLength(1)
      expect(
        run.observationCaptures.filter(
          (capture) =>
            capture._tag === "AuthoredStoryOccurrenceCaptured" &&
            capture.occurrence._tag === "TargetPromotionCompareAndSetReturned"
        )
      ).toHaveLength(0)
      expect(run.activationOrdinals.length).toBeGreaterThan(1)
      expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    }),
  restartAcceptanceTimeout
)

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
  restartAcceptanceTimeout
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
        expect(projection.beforeAcquire, prefix.cut + " projection starts with an empty resource owner").toEqual({
          activeResponsibilityPositions: new Set(),
          heldResponsibilityPositions: new Set()
        })
        expect(projection.afterAcquire, prefix.cut + " projection leaves the resource owner empty").toEqual({
          activeResponsibilityPositions: new Set(),
          heldResponsibilityPositions: new Set()
        })
        expect(projection.resourceCalls, prefix.cut + " projection must not call resource boundaries").toEqual({
          acquireCount: 0,
          acceptedPublicationCount: 0,
          releaseCount: 0,
          releaseAllCount: 0,
          releasePositions: []
        })
      }
    }),
  restartAcceptanceTimeout
)

/**
 * Scenario mapping DS14–DS17 / DirectionApplied cut: after a focused claim
 * reread makes the graph stale, a process restart may retain only the exact
 * graph-read intent. Both memory and SQLite must replay that intent by its
 * existing operation identity, exact claim predecessor, and one-task coverage;
 * the resulting graph facts must settle before fresh lineage/successor work.
 */
it.effect(
  "replays an intent-only post-claim graph refresh with exact identity in both journal lanes",
  () =>
    Effect.gen(function* () {
      const run = yield* sourceRun()
      const matrix = restartPrefixesFrom(run.records)
      const directionPrefix = prefixAt(matrix, "DirectionApplied")
      const heldResponsibility = deriveIntegrationAdmission(directionPrefix.records).responsibilities.find(
        (responsibility): responsibility is StartedIntegrationResponsibility =>
          responsibility._tag === "StartedIntegrationResponsibility"
      )
      if (heldResponsibility === undefined) {
        return yield* Effect.die("intent-only graph refresh fixture lacks its started responsibility")
      }
      const refreshOperation = graphRefreshOperationFor(directionPrefix, heldResponsibility.plannedAttempt.taskId)
      expect(refreshOperation.predecessorOperationIds).toHaveLength(1)
      expect(refreshOperation.readShape._tag).toBe("CompleteTargetClosure")
      expect(refreshOperation.readShape.explicitlyCoveredTaskIds).toEqual([heldResponsibility.plannedAttempt.taskId])
      for (const lane of lanes) {
        const intentOnlyPrefix = intentOnlyGraphRefreshPrefix(directionPrefix, refreshOperation)
        const replayCuts = [
          { label: "idle executor", prefix: intentOnlyPrefix },
          {
            label: "pending Running executor",
            prefix: runningExecutorAfter(intentOnlyPrefix, heldResponsibility.plannedAttempt)
          }
        ] as const
        for (const replayCut of replayCuts) {
          const activation = yield* withRecoveryPrefixStore(replayCut.prefix, lane, (storage) =>
            Effect.gen(function* () {
              const resources = yield* makeIntegrationTargetResourceController()
              return yield* runOrdinaryRestartActivation(
                replayCut.prefix,
                matrix,
                storage,
                resources,
                undefined,
                false,
                true,
                heldResponsibility
              )
            })
          )
          const refreshActions = activation.invokedActions.filter(
            ({ operationId }) => operationId === refreshOperation.operationId
          )
          expect(
            activation.invokedActions.filter(({ semanticTag }) => semanticTag === "TrackerGraphReadRoute"),
            "intent-only refresh suppresses generic graph route / " + lane + " / " + replayCut.label
          ).toHaveLength(0)
          expect(
            refreshActions,
            "intent-only refresh has one accepted route / " + lane + " / " + replayCut.label
          ).toHaveLength(1)
          expect(refreshActions[0]).toMatchObject({
            materializedTag: "AcceptedOperationAction",
            operationId: refreshOperation.operationId,
            routeTag: "AcceptedWorkflowRoute",
            semanticTag: "RefreshCurrentGraphAfterClaim"
          })
          expect(
            activation.boundaryCalls.trackerGraphReadOperationIds.filter(
              (operationId) => operationId === refreshOperation.operationId
            ),
            "one exact tracker provider call / " + lane + " / " + replayCut.label
          ).toHaveLength(1)
          const graphFacts = activation.records.filter(
            ({ event }) =>
              event._tag === "TaskTrackerFactsObserved" && event.operationId === refreshOperation.operationId
          )
          expect(
            graphFacts,
            "intent-only refresh reconciles one exact graph outcome / " + lane + " / " + replayCut.label
          ).toHaveLength(1)

          const settledFirst = replayCut.prefix.records[0]
          const settledPrefix: RecoveryPrefix<RestartPrefixCutLabel> = {
            ...replayCut.prefix,
            records: [settledFirst, ...activation.records.slice(1)]
          }
          const settledProjection = yield* productionRestartProjection(settledPrefix, lane)
          expect(
            settledProjection.snapshot.frontier.transitions.filter(
              ({ _tag }) => _tag === "RefreshCurrentGraphAfterClaim"
            ),
            "settled graph refresh is not redelivered / " + lane + " / " + replayCut.label
          ).toHaveLength(0)
        }
      }
    }),
  restartAcceptanceTimeout
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
      assertSuccessorFacts(matrix)
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
        Quarantined: [
          "PlannedAttemptExecutorCommandProjectionObserved",
          "PlannedAttemptExecutorCommandProjectionObserved"
        ],
        DirectionApplied: directionAppliedRequiredSuffixTags,
        FreshReadIntent: ["TargetLineageObserved"],
        FreshLineage: freshLineageRequiredSuffixTags,
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
          const continuationKinds: ReadonlySet<ContinuationReadKind> =
            prefix.cut === "DirectionApplied"
              ? new Set(["TargetLineage"])
              : prefix.cut === "FreshLineage" || prefix.cut === "SuccessorFixed"
                ? new Set(["Worktree", "TargetLineage"])
                : new Set()
          const continuationOperationIds = continuationOperationIdsFor(
            result.first.invokedActions,
            continuationKinds,
            prefix.cut === "DirectionApplied" ? restartExpectedAttemptIdOf(prefix, matrix) : undefined
          )
          const successorFixedTrackerEvidence =
            prefix.cut === "SuccessorFixed" ? successorFixedTrackerEvidenceOf(suffix) : undefined
          const semanticSuffix = suffix
            .filter(
              (record) =>
                !ordinaryGraphStabilizationEventTags.has(record.event._tag) ||
                (successorFixedTrackerEvidence !== undefined &&
                  isRequiredSuccessorFixedTrackerRecord(record, successorFixedTrackerEvidence))
            )
            .filter(({ event }) => {
              const operationId = journalOperationIdOf(event)
              return operationId === undefined || !continuationOperationIds.has(operationId)
            })
            .map(({ event }) => event._tag)
          const expectedSuffixes =
            prefix.cut === "AttemptIntended" && lane === "sqlite"
              ? [["TargetPromotionStale", "GitReadIntentRecorded"]]
              : prefix.cut === "FreshReadIntent" && lane === "sqlite"
                ? [["GitReadIntentRecorded", "PlannedAttemptWorktreeObserved", "TargetLineageObserved"]]
                : prefix.cut === "DirectionApplied"
                  ? [directionAppliedRequiredSuffixTags]
                  : [expectedSuffixTags[prefix.cut]]
          expect(expectedSuffixes, prefix.cut + " / " + lane + " accepted causal suffixes").toContainEqual(
            semanticSuffix
          )
          expect(result.after.slice(0, prefix.records.length), prefix.cut + " / " + lane).toEqual(prefix.records)
          const redeliverySuffix = result.redelivered.slice(result.after.length)
          expect(
            result.redelivered.slice(0, result.after.length),
            prefix.cut + " / " + lane + " redelivery prefix"
          ).toEqual(result.after)
          const redeliveryTags = redeliverySuffix.map(({ event }) => event._tag)
          const redeliveryBound = prefix.cut === "DirectionApplied" && lane === "sqlite" ? 10 : 8
          expect(redeliverySuffix.length, prefix.cut + " / " + lane + " bounded authority reread").toBeLessThanOrEqual(
            redeliveryBound
          )
          expect(redeliveryTags, prefix.cut + " / " + lane + " authority reread").toContain(
            "TaskTrackerReadIntentRecorded"
          )
          expect(redeliveryTags, prefix.cut + " / " + lane + " authority reread").toContain("TaskTrackerFactsObserved")
          const firstContainsQuarantine = result.after.some(({ event }) => event._tag === "IntegrationQuarantined")
          if (firstContainsQuarantine) {
            expect(
              redeliveryTags,
              prefix.cut + " / " + lane + " redelivery must not duplicate quarantine"
            ).not.toContain("IntegrationQuarantined")
          }
          for (const tag of redeliveryTags) {
            expect(
              new Set([
                "TaskTrackerReadIntentRecorded",
                "TaskTrackerFactsObserved",
                "PlannedAttemptWorktreeObserved",
                "IntegrationQuarantined",
                "TargetLineageObserved"
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
            result.redeliveredActivation.journalAppendInvocationCount,
            prefix.cut + " / " + lane + " redelivery append invocation count"
          ).toBeGreaterThanOrEqual(redeliverySuffix.length)
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
          ).toBeLessThanOrEqual(prefix.cut === "DirectionApplied" && lane === "sqlite" ? 5 : 4)
          expect(
            result.redeliveredActivation.invokedActions.length,
            prefix.cut + " / " + lane + " redelivery invoked actions"
          ).toBeGreaterThan(0)
          expect(
            result.redeliveredActivation.invokedActions.some(
              ({ semanticTag }) => semanticTag === "TrackerGraphReadRoute"
            ),
            prefix.cut + " / " + lane + " redelivery invoked graph action"
          ).toBe(true)
          expect(
            result.redeliveredActivation.actions.some(({ semanticTag }) => semanticTag === "TrackerGraphReadRoute"),
            prefix.cut + " / " + lane + " redelivery graph action"
          ).toBe(true)
          for (const action of result.redeliveredActivation.actions) {
            expect(
              new Set([
                "TrackerGraphReadRoute",
                "Recovered:ReadTrackerGraph",
                "Recovered:ReadTaskWorkSpecification",
                "Recovered:ReadTaskWorktree",
                "ObservePlannedAttemptContinuationWorktree",
                "RecordPromotionStaleIntegrationQuarantine",
                "ObservePlannedAttemptContinuationTargetLineage"
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
          expect(redeliveryFinalOwnership?.taskWorkHeld).toEqual(result.redeliveredActivation.expectedTaskWorkHeld)
          if (prefix.cut === "Quarantined") {
            expect(
              result.first.executorBoundaryCalls.startOrContinue,
              prefix.cut + " / " + lane + " must not cross the executor start boundary"
            ).toBe(0)
            expect(
              result.redeliveredActivation.executorBoundaryCalls.startOrContinue,
              prefix.cut + " / " + lane + " redelivery must not cross the executor start boundary"
            ).toBe(0)
          }
          assertRestartActionTrace(
            prefix,
            matrix,
            lane,
            result.first,
            prefix.cut === "Quarantined" ? ["TrackerGraphReadRoute"] : undefined
          )
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
            const successorRunStarted = exactlyOne(
              suffix.filter(({ event }) => event._tag === "IntegratorRunStarted"),
              prefix.cut + " / " + lane + " successor Integrator start"
            )
            const stabilizationRead = suffix.findLast(
              ({ event, position }) =>
                position < successorRunStarted.position &&
                event._tag === "TaskTrackerReadIntentRecorded" &&
                event.operation._tag === "ReadTrackerGraph"
            )
            if (
              stabilizationRead?.event._tag !== "TaskTrackerReadIntentRecorded" ||
              stabilizationRead.event.operation._tag !== "ReadTrackerGraph"
            ) {
              expect.fail(prefix.cut + " / " + lane + " lacks its G2 tracker graph read")
            } else {
              const stabilizationOperationId = stabilizationRead.event.operation.operationId
              const stabilizationObservation = exactlyOne(
                suffix.filter(
                  ({ event, position }) =>
                    position > stabilizationRead.position &&
                    position < successorRunStarted.position &&
                    event._tag === "TaskTrackerFactsObserved" &&
                    event.operationId === stabilizationOperationId
                ),
                prefix.cut + " / " + lane + " G2 tracker graph observation"
              )
              expect(
                stabilizationRead.event.operation.readShape._tag,
                prefix.cut + " / " + lane + " G2 tracker graph read shape"
              ).toBe("CompleteTargetClosure")
              expect(
                stabilizationObservation.position,
                prefix.cut + " / " + lane + " G2 observation before phase two"
              ).toBeLessThan(successorRunStarted.position)
            }
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
          expect(result.first.resourceCalls.releaseAllCount, prefix.cut + " / " + lane + " exact cleanup").toBe(1)
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
            Quarantined: 0,
            DirectionApplied: 0,
            FreshReadIntent: 0,
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
  restartAcceptanceTimeout
)

it.effect(
  "executes recovered target-lineage observations through the production interpreter",
  () =>
    Effect.gen(function* () {
      const run = yield* sourceRun()
      const matrix = restartPrefixesFrom(run.records)
      for (const cut of ["FreshReadIntent", "DirectionApplied"] as const) {
        const prefix = prefixAt(matrix, cut)
        for (const lane of lanes) {
          const result = yield* resumeFreshTargetLineage(prefix, matrix, lane)
          const suffix = result.after.slice(prefix.records.length)
          const continuationKinds: ReadonlySet<ContinuationReadKind> =
            cut === "DirectionApplied" ? new Set(["TargetLineage"]) : new Set()
          const continuationOperationIds = continuationOperationIdsFor(
            result.first.invokedActions,
            continuationKinds,
            cut === "DirectionApplied" ? restartExpectedAttemptIdOf(prefix, matrix) : undefined
          )
          const semanticSuffix = suffix
            .filter(({ event }) => !ordinaryGraphStabilizationEventTags.has(event._tag))
            .filter(({ event }) => {
              const operationId = journalOperationIdOf(event)
              return operationId === undefined || !continuationOperationIds.has(operationId)
            })
            .map(({ event }) => event._tag)
          const expectedLineageSuffix =
            cut === "DirectionApplied"
              ? [directionAppliedRequiredSuffixTags]
              : lane === "sqlite"
                ? [["GitReadIntentRecorded", "PlannedAttemptWorktreeObserved", "TargetLineageObserved"]]
                : [["TargetLineageObserved"]]
          expect(expectedLineageSuffix, cut + " / " + lane + " accepted causal suffixes").toContainEqual(semanticSuffix)
          const successorLineageEvent = matrix.successorLineage.event
          if (successorLineageEvent._tag !== "TargetLineageObserved") {
            return yield* Effect.die("restart-prefix fixture successor lineage is not an observation")
          }
          const lineage = exactlyOne(
            suffix.filter(
              ({ event }) =>
                event._tag === "TargetLineageObserved" &&
                (cut === "FreshReadIntent"
                  ? event.operationId === successorLineageEvent.operationId
                  : event.plannedAttempt.attemptId === successorLineageEvent.plannedAttempt.attemptId)
            ),
            "ordinary successor target-lineage observation " + cut + " / " + lane
          )
          if (cut === "FreshReadIntent") {
            expect(lineage.event).toEqual(matrix.successorLineage.event)
          } else if (lineage.event._tag === "TargetLineageObserved") {
            expect(lineage.event.plannedAttempt).toEqual(successorLineageEvent.plannedAttempt)
            expect(lineage.event.observation).toEqual(successorLineageEvent.observation)
          }
          assertRestartActionTrace(
            prefix,
            matrix,
            lane,
            result.first,
            prefix.cut === "Quarantined" ? ["TrackerGraphReadRoute"] : undefined
          )
        }
      }
    }),
  restartAcceptanceTimeout
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
          assertRestartActionTrace(
            prefix,
            matrix,
            lane,
            result.first,
            prefix.cut === "Quarantined" ? ["TrackerGraphReadRoute"] : undefined
          )
        }
      }
    }),
  restartAcceptanceTimeout
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
      const foreignPredecessorRecord = prefix.records.findLast(
        ({ event }) =>
          event._tag === "GitReadIntentRecorded" &&
          event.operation._tag === "ReadTargetLineage" &&
          event.operation.plannedAttempt.attemptId !== successorReadIntent.operation.plannedAttempt.attemptId
      )
      if (foreignPredecessorRecord?.event._tag !== "GitReadIntentRecorded") {
        return yield* Effect.die("restart-prefix fixture lacks an existing foreign lineage predecessor")
      }
      if (foreignPredecessorRecord.event.operation._tag !== "ReadTargetLineage") {
        return yield* Effect.die("restart-prefix fixture foreign predecessor is not target-lineage")
      }
      const foreignOperation = makeTargetLineageObservationOperation({
        integrationTarget: successorReadIntent.operation.integrationTarget,
        operationId: OperationId.make("foreign-restart-lineage-operation"),
        plannedAttempt: successorReadIntent.operation.plannedAttempt,
        // Keep the attempt and target exact while naming a real but different
        // attempt's lineage read as the predecessor. The history remains
        // valid, while the operation's causal context is foreign.
        predecessorOperationIds: [foreignPredecessorRecord.event.operation.operationId]
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
        expect(foreign.foreignOperation.predecessorOperationIds).not.toEqual(
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
  restartAcceptanceTimeout
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
  restartAcceptanceTimeout
)

it.effect(
  "reuses one exact successor identity and rejects an out-of-order restart",
  () =>
    Effect.gen(function* () {
      const run = yield* sourceRun()
      const matrix = restartPrefixesFrom(run.records)
      expect(matrix.prefixes).toHaveLength(restartPrefixCutLabels.length)
      if (matrix.prefixes.length !== restartPrefixCutLabels.length) {
        return yield* Effect.die("delivery-story capstone lacks the required #255 restart prefixes")
      }
      assertSuccessorFacts(matrix)
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
    }),
  restartAcceptanceTimeout
)
