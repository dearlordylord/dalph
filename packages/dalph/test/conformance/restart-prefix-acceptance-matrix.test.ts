import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Layer, Ref } from "effect"
import type { Scope } from "effect"
import { expect } from "vitest"
import { GitCommitSha, PlannedAttemptExecutor, TaskExecutorLocator, WorktreeLocator } from "@dalph/contracts"
import {
  InRunJournal,
  integratorRunCorrelationForSession,
  IntegratorRunOrdinal,
  targetPromotionCorrelationEquals,
  appendPromotionStaleIntegrationQuarantine,
  type JournalRecord,
  makeIntegrationTargetResourceController
} from "@dalph/orchestrator"
import { CoordinatorOwnership } from "../../../orchestrator/src/authorities/coordinator-ownership/ownership.js"
import type { IntegrationTargetResourceController } from "../../../orchestrator/src/coordination/admission/integration-target-resource.js"
import { makeApplicationExitLifecycle } from "../../../orchestrator/src/coordination/application-exit/lifecycle.js"
import {
  WorkflowInterpreter,
  WorkflowTrace,
  AuthoritativeTargetLineageObserved
} from "../../../orchestrator/src/workflow/interpretation/interpreter.js"
import { journaledWorkflowInterpreterLayer } from "../../../orchestrator/src/workflow-journal/journaled-interpreter.js"
import {
  DeliveryActionExecutor,
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
import { TargetPromotionGitReadObservation } from "../../../orchestrator/src/workflow/protocols/target-promotion/events.js"
import {
  Integrator,
  IntegratorCandidateText,
  IntegratorGit,
  IntegratorGitObservation,
  IntegratorResult
} from "../../../orchestrator/src/workflow/protocols/integrator/protocol.js"
import { deriveIntegrationAdmission } from "../../../orchestrator/src/workflow/protocols/integration-admission/protocol.js"
import { plannedAttemptProtocolControllerLayer } from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import {
  deterministicOperationIdAllocatorLayer,
  deterministicPlannedTaskAttemptLayer
} from "../../../orchestrator/src/workflow/protocols/task-attempt-planning/plan.js"
import { TaskClaimAcquisitionPlanner } from "../../../orchestrator/src/workflow/protocols/task-claim-acquisition/plan.js"
import { makeTargetLineageObservationOperation } from "../../../orchestrator/src/workflow/registry/operation.js"
import { GitReadIntentRecordedEvent } from "../../../orchestrator/src/workflow/registry/event.js"
import { workflowJournalEventVersion } from "../../../orchestrator/src/workflow/kernel/event.js"
import { intentRecordKey } from "../../../orchestrator/src/workflow-journal/record-key.js"
import { reduceWorkflowJournalHistory } from "../../../orchestrator/src/coordination/reconstruction/history.js"
import type { JournalStore } from "../../../orchestrator/src/workflow-journal/store.js"
import { GitTargetLineageReadFailure } from "../../../orchestrator/src/authorities/git/target-lineage.js"

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
  DirectionApplied: "ObservePlannedAttemptContinuationTargetLineage",
  FreshReadIntent: "ObservePlannedAttemptContinuationTargetLineage",
  FreshLineage: "FixIntegratorSuccessorSession",
  SuccessorFixed: "RunIntegrator"
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
interface RestartPrefixMatrix {
  readonly prefixes: ReadonlyArray<RecoveryPrefix<RestartPrefixCutLabel>>
  readonly attempt: JournalRecord
  readonly stale: JournalRecord
  readonly quarantine: JournalRecord
  readonly direction: JournalRecord
  readonly successorReadIntent: JournalRecord
  readonly successorLineage: JournalRecord
  readonly successor: JournalRecord
}

/** Narrows the exact successor relation used to derive its fresh read and run identity. */
type IntegratorSuccessorSessionFixedRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "IntegratorSuccessorSessionFixed" }>
}

const isIntegratorSuccessorSessionFixedRecord = (
  record: JournalRecord
): record is IntegratorSuccessorSessionFixedRecord => record.event._tag === "IntegratorSuccessorSessionFixed"

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
  const successorLineage = exactlyOne(
    records.filter(
      (record) =>
        record.position === successorEvent.successor.targetLineageObservedAt &&
        record.event._tag === "TargetLineageObserved" &&
        record.event.operationId ===
          (successorReadIntent.event._tag === "GitReadIntentRecorded"
            ? successorReadIntent.event.operation.operationId
            : undefined)
    ),
    "matching successor TargetLineageObserved"
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
  return { attempt, stale, quarantine, direction, successorReadIntent, successorLineage, successor, prefixes }
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

type OrdinaryActivation = { readonly records: ReadonlyArray<JournalRecord>; readonly actionTags: ReadonlyArray<string> }

/** Runs one restart activation through the relation, admission, live executor, and runtime owner. */
const runOrdinaryRestartActivation = Effect.fn("RestartPrefix.runOrdinaryRestartActivation")(function* (
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  matrix: RestartPrefixMatrix,
  storage: JournalStore["Service"],
  resources: IntegrationTargetResourceController,
  restoreTargetOwnership: boolean
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

  const journal = yield* makeJournal(runId, target, initial, storage)
  const inRunJournal = InRunJournal.of({ append: journal.append, read: journal.read })
  if (restoreTargetOwnership) {
    const successorAttempt =
      matrix.successor.event._tag === "IntegratorSuccessorSessionFixed"
        ? matrix.successor.event.successor.plannedAttempt
        : yield* Effect.die("restart-prefix fixture lacks typed successor attempt")
    const responsibility = deriveIntegrationAdmission(prefix.records).responsibilities.find(
      (candidate) =>
        candidate._tag === "StartedIntegrationResponsibility" &&
        candidate.plannedAttempt.taskId === successorAttempt.taskId
    )
    if (responsibility?._tag === "StartedIntegrationResponsibility") {
      const current = yield* resources.snapshot
      if (!current.heldResponsibilityPositions.has(responsibility.queuedAt)) {
        yield* resources.acquire(responsibility)
        yield* resources.publishAcceptedOwnership(responsibility)
      }
    }
  }

  const session = prefix.records.find(({ event }) => event._tag === "IntegratorSessionFixed")
  if (session?.event._tag !== "IntegratorSessionFixed") {
    return yield* Effect.die("restart-prefix activation requires predecessor IntegratorSessionFixed")
  }
  const recovery = yield* makeRunRecoveryProjection(
    runId,
    session.event.correlation.integrationTarget,
    resources,
    disabledTargetPromotionRuntime
  ).pipe(Effect.provideService(InRunJournal, inRunJournal))

  const lifecycle = yield* makeApplicationExitLifecycle()
  const targetReached = yield* Ref.make(false)
  const allOwnersSettled = yield* Deferred.make<void>()
  const runtimeObserver = DeliveryRuntimeObservationObserver.of({
    observe: ({ liveOwners }) =>
      Ref.get(targetReached).pipe(
        Effect.flatMap((reached) =>
          reached && liveOwners.length === 0 ? Deferred.succeed(allOwnersSettled, undefined) : Effect.void
        )
      )
  })
  const capabilities = yield* deliveryRuntimeResourceCapabilitiesOf(resources, lifecycle.admission).pipe(
    Effect.provideService(DeliveryRuntimeObservationObserver, runtimeObserver)
  )
  const staleHead =
    matrix.stale.event._tag === "TargetPromotionStale"
      ? matrix.stale.event.observation.observedHeadSha
      : yield* Effect.die("restart-prefix fixture lacks typed stale target head")
  const expectedLineageOperationId =
    matrix.successorReadIntent.event._tag === "GitReadIntentRecorded"
      ? matrix.successorReadIntent.event.operation.operationId
      : yield* Effect.die("restart-prefix fixture lacks typed successor read intent")
  const interpreter = WorkflowInterpreter.of({
    acquireTaskClaim: () => Effect.die("restart-prefix action does not read a task claim"),
    readTrackerGraph: () => Effect.succeed(graph),
    readTaskClaim: () => Effect.die("restart-prefix action does not read a task claim"),
    readTaskWorktree: () => Effect.die("restart-prefix action does not read a worktree"),
    readTargetLineage: (operation) =>
      operation.operationId === expectedLineageOperationId &&
      matrix.successorLineage.event._tag === "TargetLineageObserved"
        ? Effect.succeed(
            AuthoritativeTargetLineageObserved.make({ observation: matrix.successorLineage.event.observation })
          )
        : Effect.fail(
            new GitTargetLineageReadFailure({
              detail: "restart-prefix rejected a foreign target-lineage operation",
              plannedBaseSha: operation.plannedAttempt.baseSha,
              target: operation.integrationTarget
            })
          ),
    releaseTaskClaim: () => Effect.die("restart-prefix action does not release a task claim"),
    readTaskWorkSpecification: () => Effect.die("restart-prefix action does not read task specification"),
    reconcileTaskWorktree: () => Effect.die("restart-prefix action does not reconcile a worktree"),
    recordTaskAttemptPlan: () => Effect.die("restart-prefix action does not plan an attempt")
  })
  const candidateText = IntegratorCandidateText.make("refs/heads/restart-prefix-successor")
  const candidateParents =
    matrix.successor.event._tag === "IntegratorSuccessorSessionFixed"
      ? [matrix.successor.event.successor.expectedTargetHead, matrix.successor.event.successor.acceptedResult.commit]
      : yield* Effect.die("restart-prefix fixture lacks typed successor session")
  const observer = DeliveryRelationPublicationObserver.of({ observe: () => Effect.void })
  const relations = yield* makeReactiveDeliveryRelationsLayer(runId, target, journal, recovery, resources).pipe(
    Effect.provideService(DeliveryRelationPublicationObserver, observer)
  )
  const semanticTags = yield* Ref.make<ReadonlyArray<string>>([])
  const actionReached = yield* Deferred.make<void>()
  const semanticTrace = DeliverySemanticTrace.of({
    emit: (event) =>
      event._tag === "ActionOutcome"
        ? Ref.get(semanticTags).pipe(
            Effect.flatMap((tags) =>
              tags.at(-1) === expectedRestartActionTags[prefix.cut]
                ? Ref.set(targetReached, true).pipe(Effect.andThen(Deferred.succeed(actionReached, undefined)))
                : Effect.void
            ),
            Effect.asVoid
          )
        : Effect.void
  })
  const ordinaryLayer = Layer.mergeAll(
    deliveryRuntimeResourceCapabilitiesLayer(capabilities),
    Layer.succeed(DeliveryRelationPublicationObserver, observer),
    relations,
    journaledWorkflowInterpreterLayer(runId, Layer.succeed(WorkflowInterpreter, interpreter)),
    deterministicOperationIdAllocatorLayer("restart-prefix:" + runId),
    deterministicPlannedTaskAttemptLayer({
      baseSha: GitCommitSha.make("2".repeat(40)),
      executor: TaskExecutorLocator.make("executor:restart-prefix"),
      runId,
      worktreeRoot: WorktreeLocator.make("/restart-prefix/planned")
    }),
    plannedAttemptProtocolControllerLayer,
    Layer.succeed(
      PlannedAttemptExecutor,
      PlannedAttemptExecutor.of({
        project: () => Effect.die("restart-prefix action does not execute an attempt"),
        requestSuspension: () => Effect.die("restart-prefix action does not suspend an attempt"),
        startOrContinue: () => Effect.die("restart-prefix action does not continue an attempt")
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
          compareAndSet: () => Effect.die("restart-prefix promotion must observe stale ancestry first"),
          read: () =>
            Effect.succeed(
              TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({ currentHeadSha: staleHead })
            )
        }
      })
    ),
    Layer.succeed(
      Integrator,
      Integrator.of({
        prepare: (request) =>
          Effect.succeed(
            IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: request.correlation })
          )
      })
    ),
    Layer.succeed(
      IntegratorGit,
      IntegratorGit.of({
        readCandidate: (_target, text) =>
          Effect.succeed(
            IntegratorGitObservation.cases.Commit.make({
              candidateText: text,
              commit: GitCommitSha.make("e".repeat(40)),
              directParents: candidateParents
            })
          )
      })
    )
  ).pipe(Layer.provideMerge(Layer.succeed(InRunJournal, inRunJournal)))

  const activation = Effect.gen(function* () {
    const relation = yield* deliveryRuntime
    const live = yield* makeLiveDeliveryActionExecutor(runId, target)
    const bounded = DeliveryActionExecutor.of({
      execute: (action, lease) =>
        Ref.update(semanticTags, (tags) => [
          ...tags,
          action._tag === "IdentityFreeAction"
            ? action.proposal.route._tag === "IdentityFreeWorkflowRoute"
              ? action.proposal.route.transition._tag
              : action.proposal.route._tag
            : action._tag === "AcceptedOperationAction"
              ? action.proposal.route.transition._tag
              : action._tag === "FreshOperationAction"
                ? action.proposal.route._tag === "RecoveredNewActionRoute"
                  ? "Recovered:" + action.proposal.route.action._tag
                  : "FreshOperation:" + action.proposal.route._tag
                : action._tag
        ]).pipe(Effect.andThen(live.execute(action, lease)))
    })
    yield* runDeliveryRuntimePhase(relation).pipe(
      Effect.provideService(DeliveryActionExecutor, bounded),
      Effect.provideService(DeliverySemanticTrace, semanticTrace),
      Effect.exit
    )
  }).pipe(Effect.provide(ordinaryLayer))

  const runtimeFiber = yield* Effect.scoped(activation).pipe(Effect.forkChild)
  const runtimeState = yield* Effect.raceFirst(
    Deferred.await(actionReached).pipe(Effect.as("ExpectedAction" as const)),
    Effect.exit(Fiber.join(runtimeFiber)).pipe(Effect.as("RuntimeFinished" as const))
  )
  if (runtimeState === "ExpectedAction") {
    yield* Deferred.await(allOwnersSettled)
    yield* lifecycle.requestExit
    yield* Effect.exit(Fiber.join(runtimeFiber))
    yield* lifecycle.awaitForwardOwnersReleased
  }
  const actionTags = yield* Ref.get(semanticTags)
  return { records: yield* storage.read(runId), actionTags }
})

const dispatchPrefixNextAction = (
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  matrix: RestartPrefixMatrix,
  lane: RecoveryStoreLane
) =>
  Effect.gen(function* () {
    const resources = yield* makeIntegrationTargetResourceController()
    const acquisitions = yield* Ref.make(0)
    const countedResources: IntegrationTargetResourceController = {
      ...resources,
      acquire: (responsibility) =>
        Ref.update(acquisitions, (count) => count + 1).pipe(Effect.andThen(resources.acquire(responsibility)))
    }
    const first = yield* withRecoveryPrefixStore(prefix, lane, (storage) =>
      runOrdinaryRestartActivation(prefix, matrix, storage, countedResources, true)
    )
    const redeliveryPrefix: RecoveryPrefix<RestartPrefixCutLabel> =
      prefix.cut === "Quarantined"
        ? (() => {
            const firstRecord = first.records[0]
            return firstRecord === undefined ? prefix : { ...prefix, records: [firstRecord, ...first.records.slice(1)] }
          })()
        : prefix
    const redelivered = yield* withRecoveryPrefixStore(redeliveryPrefix, lane, (storage) =>
      runOrdinaryRestartActivation(redeliveryPrefix, matrix, storage, countedResources, prefix.cut !== "Quarantined")
    )
    return {
      before: prefix.records,
      after: first.records,
      redelivered: redelivered.records,
      actionTags: first.actionTags,
      resources: countedResources,
      acquisitions: yield* Ref.get(acquisitions)
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
      const acquire = snapshot.frontier.transitions.find(
        (transition) => transition._tag === "AcquireStartedIntegrationTarget"
      )
      if (acquire?._tag === "AcquireStartedIntegrationTarget") {
        yield* resources.acquire(acquire.responsibility)
        yield* resources.publishAcceptedOwnership(acquire.responsibility)
      }
      const afterAcquire = yield* recovery.readDeliveryProjection
      return { snapshot, beforeAcquire: snapshot, afterAcquire, records: yield* storage.read(runId) }
    })
  )

const resumeFreshTargetLineage = (
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  matrix: RestartPrefixMatrix,
  lane: RecoveryStoreLane
) => dispatchPrefixNextAction(prefix, matrix, lane).pipe(Effect.map(({ after }) => after))
const integrationTransitionsFor = (snapshot: RunRecoveryProjectionSnapshot, taskId: string) =>
  snapshot.frontier.transitions.filter(
    (transition) => "responsibility" in transition && transition.responsibility.plannedAttempt.taskId === taskId
  )

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
  "selects the exact #255 action after each retained prefix",
  () =>
    Effect.gen(function* () {
      const run = yield* sourceRun()
      const matrix = restartPrefixesFrom(run.records)
      expect(matrix.prefixes).toHaveLength(restartPrefixCutLabels.length)
      if (matrix.prefixes.length !== restartPrefixCutLabels.length) {
        return yield* Effect.die("delivery-story capstone lacks the required #255 restart prefixes")
      }
      if (
        matrix.attempt.event._tag !== "TargetPromotionAttemptIntended" ||
        matrix.stale.event._tag !== "TargetPromotionStale" ||
        matrix.quarantine.event._tag !== "IntegrationQuarantined" ||
        matrix.direction.event._tag !== "IntegrationQuarantineDirectionApplied" ||
        matrix.successorReadIntent.event._tag !== "GitReadIntentRecorded" ||
        matrix.successorLineage.event._tag !== "TargetLineageObserved" ||
        matrix.successor.event._tag !== "IntegratorSuccessorSessionFixed"
      ) {
        return yield* Effect.die("restart-prefix fixture event narrowing failed")
      }

      const afterAcquire = (cut: RestartPrefixCutLabel) =>
        productionRestartProjection(prefixAt(matrix, cut), "memory").pipe(
          Effect.map(({ afterAcquire: snapshot }) => snapshot)
        )

      for (const cut of ["Stale", "Quarantined"] as const) {
        const projection = yield* productionRestartProjection(prefixAt(matrix, cut), "memory")
        expect(
          integrationTransitionsFor(
            projection.beforeAcquire,
            matrix.stale.event.correlation.qualifiedCandidate.run.session.plannedAttempt.taskId
          ).filter(({ _tag }) => _tag === "AcquireStartedIntegrationTarget")
        ).toHaveLength(0)
      }

      const attemptIntendedSnapshot = yield* afterAcquire("AttemptIntended")
      const attemptIntendedPromotions = integrationTransitionsFor(
        attemptIntendedSnapshot,
        matrix.attempt.event.correlation.qualifiedCandidate.run.session.plannedAttempt.taskId
      ).filter((transition) => transition._tag === "RunTargetPromotion")
      expect(attemptIntendedPromotions).toHaveLength(1)
      expect(
        integrationTransitionsFor(
          attemptIntendedSnapshot,
          matrix.attempt.event.correlation.qualifiedCandidate.run.session.plannedAttempt.taskId
        ).map(({ _tag }) => _tag)
      ).toEqual(["RunTargetPromotion"])
      if (attemptIntendedPromotions[0]?._tag === "RunTargetPromotion") {
        expect(attemptIntendedPromotions[0].candidate).toEqual(matrix.attempt.event.correlation.qualifiedCandidate)
        expect(attemptIntendedPromotions[0].responsibility.plannedAttempt).toEqual(
          matrix.attempt.event.correlation.qualifiedCandidate.run.session.plannedAttempt
        )
      }

      const staleSnapshot = yield* afterAcquire("Stale")
      const staleQuarantines = integrationTransitionsFor(
        staleSnapshot,
        matrix.stale.event.correlation.qualifiedCandidate.run.session.plannedAttempt.taskId
      ).filter((transition) => transition._tag === "RecordPromotionStaleIntegrationQuarantine")
      expect(staleQuarantines).toHaveLength(1)
      expect(
        integrationTransitionsFor(
          staleSnapshot,
          matrix.stale.event.correlation.qualifiedCandidate.run.session.plannedAttempt.taskId
        ).map(({ _tag }) => _tag)
      ).toEqual(["RecordPromotionStaleIntegrationQuarantine"])
      if (staleQuarantines[0]?._tag === "RecordPromotionStaleIntegrationQuarantine") {
        expect(staleQuarantines[0].input).toEqual({
          correlation: matrix.stale.event.correlation,
          targetPromotionStaleAt: matrix.stale.position
        })
        expect(staleQuarantines[0].responsibility.plannedAttempt).toEqual(
          matrix.stale.event.correlation.qualifiedCandidate.run.session.plannedAttempt
        )
      }

      const quarantinedSnapshot = yield* afterAcquire("Quarantined")
      expect(
        integrationTransitionsFor(quarantinedSnapshot, matrix.quarantine.event.correlation.plannedAttempt.taskId).map(
          ({ _tag }) => _tag
        )
      ).toEqual(["ReleaseStartedIntegrationTarget"])

      const directionAppliedSnapshot = yield* afterAcquire("DirectionApplied")
      const directionAppliedTags = integrationTransitionsFor(
        directionAppliedSnapshot,
        matrix.quarantine.event.correlation.plannedAttempt.taskId
      ).map(({ _tag }) => _tag)
      expect(directionAppliedTags).toEqual(["ObservePlannedAttemptContinuationTargetLineage"])

      const successorTaskId = matrix.successor.event.successor.plannedAttempt.taskId
      const freshReadIntentSnapshot = yield* afterAcquire("FreshReadIntent")
      const freshReadIntentReads = integrationTransitionsFor(freshReadIntentSnapshot, successorTaskId).filter(
        (transition) => transition._tag === "ObservePlannedAttemptContinuationTargetLineage"
      )
      expect(integrationTransitionsFor(freshReadIntentSnapshot, successorTaskId).map(({ _tag }) => _tag)).toEqual([
        "ObservePlannedAttemptContinuationTargetLineage"
      ])
      expect(freshReadIntentReads).toHaveLength(1)
      if (freshReadIntentReads[0]?._tag === "ObservePlannedAttemptContinuationTargetLineage") {
        expect(freshReadIntentReads[0].operation).toEqual(matrix.successorReadIntent.event.operation)
        expect(freshReadIntentReads[0].plannedAttempt).toEqual(
          matrix.successorReadIntent.event.operation.plannedAttempt
        )
      }

      const freshLineageSnapshot = yield* afterAcquire("FreshLineage")
      const freshLineageFixes = integrationTransitionsFor(freshLineageSnapshot, successorTaskId).filter(
        (transition) => transition._tag === "FixIntegratorSuccessorSession"
      )
      expect(freshLineageFixes).toHaveLength(1)
      expect(integrationTransitionsFor(freshLineageSnapshot, successorTaskId).map(({ _tag }) => _tag)).toEqual([
        "FixIntegratorSuccessorSession"
      ])
      if (freshLineageFixes[0]?._tag === "FixIntegratorSuccessorSession") {
        expect(freshLineageFixes[0].input).toEqual(successorPreparationInputFor(matrix))
        expect(freshLineageFixes[0].responsibility.plannedAttempt).toEqual(
          matrix.successor.event.successor.plannedAttempt
        )
      }

      const successorFixedSnapshot = yield* afterAcquire("SuccessorFixed")
      const successorFixedFixes = integrationTransitionsFor(successorFixedSnapshot, successorTaskId).filter(
        (transition) => transition._tag === "FixIntegratorSuccessorSession"
      )
      expect(successorFixedFixes).toHaveLength(0)
      const successorFixedRuns = integrationTransitionsFor(successorFixedSnapshot, successorTaskId).filter(
        (transition) => transition._tag === "RunIntegrator"
      )
      expect(successorFixedRuns).toHaveLength(1)
      expect(integrationTransitionsFor(successorFixedSnapshot, successorTaskId).map(({ _tag }) => _tag)).toEqual([
        "RunIntegrator"
      ])
      if (successorFixedRuns[0]?._tag === "RunIntegrator") {
        expect(successorFixedRuns[0].lineage).toEqual(matrix.successorLineage.event.observation)
        expect(successorFixedRuns[0].lineageObservedAt).toBe(matrix.successorLineage.position)
        expect(successorFixedRuns[0].responsibility.plannedAttempt).toEqual(
          matrix.successor.event.successor.plannedAttempt
        )
        expect(successorFixedRuns[0].run).toEqual(
          integratorRunCorrelationForSession(matrix.successor.event.successor, IntegratorRunOrdinal.make(1))
        )
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
      const expectedSuffixTags: Readonly<Record<RestartPrefixCutLabel, ReadonlyArray<string>>> = {
        AttemptIntended: ["TargetPromotionStale"],
        Stale: ["IntegrationQuarantined"],
        Quarantined: [],
        DirectionApplied: ["GitReadIntentRecorded", "TargetLineageObserved"],
        FreshReadIntent: ["TargetLineageObserved"],
        FreshLineage: ["IntegratorSuccessorSessionFixed"],
        SuccessorFixed: [
          "IntegratorRunStarted",
          "IntegratorRunResultRecorded",
          "IntegratorRunCandidateGitReadIntended",
          "IntegratorRunCandidateGitObserved"
        ]
      }
      for (const prefix of matrix.prefixes) {
        for (const lane of lanes) {
          const result = yield* dispatchPrefixNextAction(prefix, matrix, lane)
          const suffix = result.after.slice(result.before.length)
          const semanticSuffix = suffix
            .filter(({ event }) => !ordinaryGraphStabilizationEventTags.has(event._tag))
            .map(({ event }) => event._tag)
          expect(semanticSuffix, prefix.cut + " / " + lane).toEqual(expectedSuffixTags[prefix.cut])
          expect(result.after.slice(0, prefix.records.length), prefix.cut + " / " + lane).toEqual(prefix.records)
          expect(result.redelivered, prefix.cut + " / " + lane + " redelivery").toEqual(result.after)
          expect(yield* result.resources.snapshot).toMatchObject({ activeResponsibilityPositions: new Set() })
          if (prefix.cut === "Quarantined") expect(result.acquisitions).toBe(1)
        }
      }
    }),
  120_000
)

it.effect("executes recovered target-lineage observations through the production interpreter", () =>
  Effect.gen(function* () {
    const run = yield* sourceRun()
    const matrix = restartPrefixesFrom(run.records)
    for (const cut of ["DirectionApplied", "FreshReadIntent"] as const) {
      const prefix = prefixAt(matrix, cut)
      for (const lane of lanes) {
        const records = yield* resumeFreshTargetLineage(prefix, matrix, lane)
        const suffix = records.slice(prefix.records.length)
        const semanticSuffix = suffix
          .filter(({ event }) => !ordinaryGraphStabilizationEventTags.has(event._tag))
          .map(({ event }) => event._tag)
        expect(semanticSuffix, cut + " / " + lane).toEqual(
          cut === "DirectionApplied" ? ["GitReadIntentRecorded", "TargetLineageObserved"] : ["TargetLineageObserved"]
        )
        const lineage = exactlyOne(
          suffix.filter(({ event }) => event._tag === "TargetLineageObserved"),
          "ordinary target-lineage observation"
        )
        expect(lineage.event).toEqual(matrix.successorLineage.event)
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
          const expected = expectedRestartActionTags[prefix.cut]
          expect(
            result.actionTags.filter((tag) => tag === expected),
            prefix.cut + " / " + lane
          ).toEqual([expected])
        }
      }
    }),
  120_000
)

it.effect("rejects an independent foreign operation chronology through ordinary production dispatch", () =>
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
    const successor = matrix.successor.event
    const successorReadIntent = matrix.successorReadIntent.event
    if (successorReadIntent._tag !== "GitReadIntentRecorded") {
      return yield* Effect.die("restart-prefix fixture lacks typed successor read intent")
    }

    for (const lane of lanes) {
      const result = yield* withRecoveryPrefixStore(prefix, lane, (storage) =>
        Effect.gen(function* () {
          const runId = prefix.records[0].runId
          const foreignOperation = makeTargetLineageObservationOperation({
            integrationTarget: successor.predecessor.integrationTarget,
            operationId: OperationId.make("foreign-restart-lineage-operation"),
            plannedAttempt: successor.successor.plannedAttempt,
            predecessorOperationIds: []
          })
          yield* storage.append(
            runId,
            intentRecordKey(foreignOperation.operationId),
            GitReadIntentRecordedEvent.make({
              initiatedBy: { _tag: "DalphCoordinator" },
              occurrenceClassification: "InitiatedAction",
              operation: foreignOperation,
              version: workflowJournalEventVersion
            })
          )
          const resources = yield* makeIntegrationTargetResourceController()
          const activation = yield* runOrdinaryRestartActivation(prefix, matrix, storage, resources, true)
          const records = activation.records
          return { activation, records, foreignOperation }
        })
      )
      expect(
        result.records.some(
          ({ event }) =>
            event._tag === "TargetLineageObserved" && event.operationId === result.foreignOperation.operationId
        ),
        "foreign operation chronology / " + lane
      ).toBe(false)
    }
  })
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
