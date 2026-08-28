import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, Layer } from "effect"
import { expect } from "vitest"
import {
  InRunJournal,
  acquireStartedIntegrationTarget,
  authorizedClaimForAttempt,
  integratorRunCorrelationForSession,
  IntegratorRunOrdinal,
  targetPromotionCorrelationEquals,
  appendPromotionStaleIntegrationQuarantine,
  type JournalRecord,
  makeIntegrationTargetResourceController
} from "@dalph/orchestrator"
import {
  WorkflowInterpreter,
  WorkflowTrace,
  AuthoritativeTaskClaimObserved,
  AuthoritativeTargetLineageObserved
} from "../../../orchestrator/src/workflow/interpretation/interpreter.js"
import { journaledWorkflowInterpreterLayer } from "../../../orchestrator/src/workflow-journal/journaled-interpreter.js"
import {
  newRecoveredActionOf,
  operationIdOf
} from "../../../orchestrator/src/coordination/delivery/delivery-proposal-route.js"
import { executeRestartRecoveredObservation } from "../../../orchestrator/src/coordination/delivery/recovered-delivery-action-adapter.js"
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
import type { TargetPromotionRuntimeInput } from "../../../orchestrator/src/workflow/protocols/target-promotion/runtime.js"
import { projectTrackerSnapshot } from "../../../orchestrator/src/authorities/task-tracker/graph.js"
import { TargetLineageObservation } from "../../../orchestrator/src/authorities/git/target-lineage.js"

const lanes: ReadonlyArray<RecoveryStoreLane> = ["memory", "sqlite"]
const fullPrefixReplayTimeout = 60_000
const bothStoreFrontierTimeout = 30_000
const successorIdentityTimeout = 20_000
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

const cachedRun = Effect.runSync(
  Effect.cached(
    runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.deliveryInvariantStoryCapstone).pipe(
      Effect.provide(NodeCrypto.layer)
    )
  )
)

const exactlyOne = <A>(values: ReadonlyArray<A>, description: string): A => {
  const value = values.length === 1 ? values[0] : undefined
  return value === undefined ? expect.fail("expected one " + description + ", received " + values.length) : value
}

/** Reconstructs the provider result for a fresh graph read from this prefix's latest complete graph fact. */
const currentGraphBoundaryFactFrom = (records: ReadonlyArray<JournalRecord>) => {
  const graphRecord = records.findLast(
    ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "CompleteTaskTrackerFacts"
  )
  if (
    graphRecord?.event._tag !== "TaskTrackerFactsObserved" ||
    graphRecord.event.observation._tag !== "CompleteTaskTrackerFacts"
  ) {
    return expect.fail("restart prefix lacks a complete current tracker graph boundary fact")
  }
  const [identities, lifecycles, prerequisites, groupings] = graphRecord.event.observation.factFamilies
  const tasks = identities.taskIds.map((taskId) => {
    const lifecycle = lifecycles.lifecycles.find((entry) => entry.taskId === taskId)
    const prerequisitesForTask = prerequisites.prerequisites.find((entry) => entry.taskId === taskId)
    const grouping = groupings.groupings.find((entry) => entry.taskId === taskId)
    if (lifecycle === undefined || prerequisitesForTask === undefined || grouping === undefined) {
      return expect.fail("restart prefix complete graph fact has inconsistent families")
    }
    return {
      id: taskId,
      lifecycle: lifecycle.lifecycle,
      parentTaskId: grouping.parentTaskId,
      prerequisiteIds: prerequisitesForTask.prerequisiteTaskIds
    }
  })
  const projected = projectTrackerSnapshot({
    revision: identities.contentIdentity,
    rootTaskId: graphRecord.event.observation.rootTaskId,
    tasks
  })
  return projected._tag === "Valid"
    ? projected.snapshot
    : expect.fail("restart prefix complete graph fact does not project to a valid current boundary fact")
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
  if (stale.event.basis._tag !== "AfterAttempt") {
    return expect.fail("restart-prefix stale event lacks its exact compare-and-set attempt ordinal")
  }
  const staleCorrelation = stale.event.correlation
  const staleAttemptOrdinal = stale.event.basis.attemptOrdinal
  const attempt = exactlyOne(
    records.filter(
      (record) =>
        record.runId === stale.runId &&
        record.position < stale.position &&
        record.event._tag === "TargetPromotionAttemptIntended" &&
        record.event.attemptOrdinal === staleAttemptOrdinal &&
        targetPromotionCorrelationEquals(record.event.correlation, staleCorrelation)
    ),
    "TargetPromotionAttemptIntended for the stale event's exact AfterAttempt ordinal"
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
        yield* acquireStartedIntegrationTarget(resources, acquire)
      }
      const afterAcquire = yield* recovery.readDeliveryProjection
      return { snapshot, beforeAcquire: snapshot, afterAcquire, records: yield* storage.read(runId) }
    })
  )

const expectedIntegrationActionTag: Readonly<Record<RestartPrefixCutLabel, string | undefined>> = {
  AttemptIntended: "RunTargetPromotion",
  Stale: "RecordPromotionStaleIntegrationQuarantine",
  Quarantined: undefined,
  DirectionApplied: "ObservePlannedAttemptContinuationTargetLineage",
  FreshReadIntent: "ObservePlannedAttemptContinuationTargetLineage",
  FreshLineage: "FixIntegratorSuccessorSession",
  SuccessorFixed: "RunIntegrator"
}

/** Git's current boundary fact after H moved to the stale record's observed H2. */
const currentTargetLineageBoundaryFactFor = (matrix: RestartPrefixMatrix) => {
  if (
    matrix.stale.event._tag !== "TargetPromotionStale" ||
    matrix.attempt.event._tag !== "TargetPromotionAttemptIntended"
  ) {
    return expect.fail("restart-prefix matrix lacks stale promotion lineage inputs")
  }
  const plannedAttempt = matrix.attempt.event.correlation.qualifiedCandidate.run.session.plannedAttempt
  return TargetLineageObservation.make({
    plannedBaseIsAncestorOfTargetHead: true,
    plannedBaseSha: plannedAttempt.baseSha,
    targetHeadSha: matrix.stale.event.observation.observedHeadSha
  })
}

const executeRecoveredTransition = (
  transition: RunRecoveryProjectionSnapshot["frontier"]["transitions"][number],
  journal: InRunJournal["Service"],
  interpreterLayer: Layer.Layer<WorkflowInterpreter, never, InRunJournal>
) => {
  const action = newRecoveredActionOf(transition)
  const operationId = operationIdOf(transition)
  if (
    action === undefined ||
    operationId === undefined ||
    (action._tag !== "ReadTrackerGraph" && action._tag !== "ReadTaskClaim" && action._tag !== "ReadTargetLineage")
  ) {
    return Effect.die("restart current-facts action identity was not reconstructed")
  }
  return executeRestartRecoveredObservation(
    { action, operationId },
    {
      forwardBoundary: {
        _tag: "InterruptibleBoundary",
        execution: { run: (_intent, effect, recordResult) => effect.pipe(Effect.flatMap(recordResult)) }
      },
      recordIntent: () => Effect.void
    }
  ).pipe(
    Effect.provide(interpreterLayer),
    Effect.provideService(InRunJournal, journal),
    Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
  )
}

const withProductionIntegrationRestart = <A>(
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  matrix: RestartPrefixMatrix,
  lane: RecoveryStoreLane,
  use: (context: {
    readonly frontier: NonNullable<RunRecoveryProjectionSnapshot["integrationFrontier"]>
    readonly journal: InRunJournal["Service"]
    readonly transition: RunRecoveryProjectionSnapshot["frontier"]["transitions"][number] | undefined
  }) => Effect.Effect<A, unknown>
) =>
  withRecoveryPrefixStore(prefix, lane, (storage) =>
    Effect.gen(function* () {
      const runId = prefix.records[0].runId
      const began = prefix.records[0]
      if (began.event._tag !== "WorkflowRunBegan" || matrix.attempt.event._tag !== "TargetPromotionAttemptIntended") {
        return yield* Effect.die("restart prefix lacks its run or exact promotion attempt authority")
      }
      const initialRecords = yield* storage.read(runId)
      const plannedAttempt = matrix.attempt.event.correlation.qualifiedCandidate.run.session.plannedAttempt
      const claim = authorizedClaimForAttempt(initialRecords, plannedAttempt)?.claim
      if (claim === undefined) return yield* Effect.die("restart prefix lacks its exact durable task claim")
      const graph = currentGraphBoundaryFactFrom(initialRecords)
      const resources = yield* makeIntegrationTargetResourceController()
      const journal = InRunJournal.of({ append: storage.append, read: storage.read })
      const recovery = yield* makeRunRecoveryProjection(
        runId,
        matrix.attempt.event.correlation.qualifiedCandidate.run.session.integrationTarget,
        resources,
        disabledTargetPromotionRuntime,
        true,
        true
      ).pipe(Effect.provideService(InRunJournal, journal))
      const beforeAcquire = yield* recovery.readDeliveryProjection
      const acquire = beforeAcquire.frontier.transitions.find(
        (transition) =>
          transition._tag === "AcquireStartedIntegrationTarget" &&
          transition.responsibility.plannedAttempt.attemptId === plannedAttempt.attemptId
      )
      if (acquire?._tag === "AcquireStartedIntegrationTarget") {
        yield* acquireStartedIntegrationTarget(resources, acquire)
      }
      const interpreter = WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("unused restart test interpreter operation"),
        readTrackerGraph: () => Effect.succeed(graph),
        readTaskClaim: () => Effect.succeed(AuthoritativeTaskClaimObserved.make({ observation: claim })),
        readTaskWorktree: () => Effect.die("unused restart test interpreter operation"),
        readTargetLineage: () =>
          Effect.succeed(
            AuthoritativeTargetLineageObserved.make({ observation: currentTargetLineageBoundaryFactFor(matrix) })
          ),
        releaseTaskClaim: () => Effect.die("unused restart test interpreter operation"),
        readTaskWorkSpecification: () => Effect.die("unused restart test interpreter operation"),
        reconcileTaskWorktree: () => Effect.die("unused restart test interpreter operation"),
        recordTaskAttemptPlan: () => Effect.die("unused restart test interpreter operation")
      })
      const interpreterLayer = journaledWorkflowInterpreterLayer(runId, Layer.succeed(WorkflowInterpreter, interpreter))

      for (let turn = 0; turn < 6; turn += 1) {
        const projection = yield* recovery.readDeliveryProjection
        const frontier = projection.integrationFrontier
        if (frontier === undefined) return yield* Effect.die("authoritative recovery omitted its integration frontier")
        const expectedTag = expectedIntegrationActionTag[prefix.cut]
        const transition = frontier.transitions.find(({ _tag }) => _tag === expectedTag)
        if (transition !== undefined) return yield* use({ frontier, journal, transition })
        const refresh =
          frontier.transitions.find(
            (candidate) =>
              (candidate._tag === "AcquireStartedIntegrationTarget" &&
                candidate.responsibility.plannedAttempt.attemptId === plannedAttempt.attemptId) ||
              (candidate._tag === "ObserveResponsibleTaskClaim" && candidate.taskId === plannedAttempt.taskId) ||
              (candidate._tag === "ObservePlannedAttemptContinuationGraph" &&
                candidate.plannedAttempt.attemptId === plannedAttempt.attemptId) ||
              (candidate._tag === "ObservePlannedAttemptContinuationTargetLineage" &&
                (prefix.cut === "FreshLineage" || prefix.cut === "SuccessorFixed") &&
                candidate.plannedAttempt.attemptId === plannedAttempt.attemptId)
          ) ??
          projection.frontier.transitions.find(
            (candidate) =>
              candidate._tag === "ObservePlannedAttemptContinuationGraph" ||
              (candidate._tag === "ObserveResponsibleTaskClaim" && candidate.taskId === plannedAttempt.taskId) ||
              (candidate._tag === "AcquireStartedIntegrationTarget" &&
                candidate.responsibility.plannedAttempt.attemptId === plannedAttempt.attemptId)
          )
        if (refresh === undefined) {
          if (expectedTag === undefined && frontier.transitions.length === 0) {
            return yield* use({ frontier, journal, transition: undefined })
          }
          return yield* Effect.die(
            `production recovery did not expose ${expectedTag} or a current graph/claim gate: run=${projection.frontier.transitions.map((candidate) => `${candidate._tag}:${"plannedAttempt" in candidate ? candidate.plannedAttempt.taskId : "taskId" in candidate ? candidate.taskId : "responsibility" in candidate ? candidate.responsibility.plannedAttempt.taskId : "none"}`).join(",")}; integration=${JSON.stringify(frontier.transitions)}; explanations=${JSON.stringify(frontier.explanations)}`
          )
        }
        if (refresh._tag === "AcquireStartedIntegrationTarget") {
          yield* acquireStartedIntegrationTarget(resources, refresh)
        } else {
          yield* executeRecoveredTransition(refresh, journal, interpreterLayer)
        }
      }
      return yield* Effect.die(
        "production recovery did not settle its initial graph, claim, post-claim graph, and resource gates within six turns"
      )
    })
  )

const integrationRestartSnapshot = (
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  matrix: RestartPrefixMatrix,
  lane: RecoveryStoreLane
) =>
  withProductionIntegrationRestart(prefix, matrix, lane, ({ frontier, journal }) =>
    journal.read(prefix.records[0].runId).pipe(Effect.map((records) => ({ frontier, records })))
  )

const integrationRestartFrontier = (
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  matrix: RestartPrefixMatrix,
  lane: RecoveryStoreLane
) => integrationRestartSnapshot(prefix, matrix, lane).pipe(Effect.map(({ frontier }) => frontier))

const resumeFreshTargetLineage = (
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  matrix: RestartPrefixMatrix,
  lane: RecoveryStoreLane
) =>
  withProductionIntegrationRestart(prefix, matrix, lane, ({ journal, transition }) =>
    Effect.gen(function* () {
      const runId = prefix.records[0].runId
      if (transition?._tag !== "ObservePlannedAttemptContinuationTargetLineage") {
        return yield* Effect.die("production recovery selected a non-lineage action for the lineage cut")
      }
      const boundaryRecordsBefore = (yield* journal.read(runId)).length
      const interpreter = WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("unused restart test interpreter operation"),
        readTrackerGraph: () => Effect.die("unused restart test interpreter operation"),
        readTaskClaim: () => Effect.die("unused restart test interpreter operation"),
        readTaskWorktree: () => Effect.die("unused restart test interpreter operation"),
        readTargetLineage: () =>
          Effect.succeed(
            AuthoritativeTargetLineageObserved.make({ observation: currentTargetLineageBoundaryFactFor(matrix) })
          ),
        releaseTaskClaim: () => Effect.die("unused restart test interpreter operation"),
        readTaskWorkSpecification: () => Effect.die("unused restart test interpreter operation"),
        reconcileTaskWorktree: () => Effect.die("unused restart test interpreter operation"),
        recordTaskAttemptPlan: () => Effect.die("unused restart test interpreter operation")
      })
      yield* executeRecoveredTransition(
        transition,
        journal,
        journaledWorkflowInterpreterLayer(runId, Layer.succeed(WorkflowInterpreter, interpreter))
      )
      return { boundaryRecordsBefore, records: yield* journal.read(runId), transition }
    })
  )

const integrationTransitionsFor = (snapshot: Pick<RunRecoveryProjectionSnapshot, "frontier">, taskId: string) =>
  snapshot.frontier.transitions.filter(
    (transition) =>
      ("responsibility" in transition && transition.responsibility.plannedAttempt.taskId === taskId) ||
      ("plannedAttempt" in transition && transition.plannedAttempt.taskId === taskId)
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
      const run = yield* cachedRun
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
  fullPrefixReplayTimeout
)

it.effect("selects the exact #255 action after each retained prefix", () =>
  Effect.gen(function* () {
    const run = yield* cachedRun
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
      integrationRestartSnapshot(prefixAt(matrix, cut), matrix, "memory")

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
    ).toEqual([])
    expect(quarantinedSnapshot.frontier.explanations).toContainEqual(
      expect.objectContaining({
        _tag: "IntegrationInProgress",
        plannedAttempt: matrix.quarantine.event.correlation.plannedAttempt
      })
    )

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
      expect(freshReadIntentReads[0].plannedAttempt).toEqual(matrix.successorReadIntent.event.operation.plannedAttempt)
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
      const currentLineage = freshLineageSnapshot.records.findLast(
        ({ event }) => event._tag === "TargetLineageObserved"
      )
      expect(currentLineage?.event._tag).toBe("TargetLineageObserved")
      expect(freshLineageFixes[0].input).toEqual({
        ...successorPreparationInputFor(matrix),
        targetLineageObservedAt: currentLineage?.position
      })
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
  })
)

it.effect("executes recovered target-lineage observations through the production interpreter", () =>
  Effect.gen(function* () {
    const run = yield* cachedRun
    const matrix = restartPrefixesFrom(run.records)
    for (const cut of ["DirectionApplied", "FreshReadIntent"] as const) {
      const prefix = prefixAt(matrix, cut)
      for (const lane of lanes) {
        const resumed = yield* resumeFreshTargetLineage(prefix, matrix, lane)
        const suffix = resumed.records.slice(resumed.boundaryRecordsBefore)
        expect(
          suffix.map(({ event }) => event._tag),
          cut + " / " + lane
        ).toEqual(
          cut === "DirectionApplied" ? ["GitReadIntentRecorded", "TargetLineageObserved"] : ["TargetLineageObserved"]
        )
        const observed = suffix.at(-1)?.event
        expect(observed).toMatchObject({
          _tag: "TargetLineageObserved",
          observation: currentTargetLineageBoundaryFactFor(matrix),
          operationId: resumed.transition.operation.operationId
        })
      }
    }
  })
)

it.effect(
  "retains the exact visible action tag in both restart-store lanes",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedRun
      const matrix = restartPrefixesFrom(run.records)
      const taskId =
        matrix.successor.event._tag === "IntegratorSuccessorSessionFixed"
          ? matrix.successor.event.successor.plannedAttempt.taskId
          : yield* Effect.die("restart-prefix fixture successor narrowing failed")
      const expectedTags: Readonly<Record<RestartPrefixCutLabel, ReadonlyArray<string>>> = {
        AttemptIntended: ["RunTargetPromotion"],
        Stale: ["RecordPromotionStaleIntegrationQuarantine"],
        Quarantined: [],
        DirectionApplied: ["ObservePlannedAttemptContinuationTargetLineage"],
        FreshReadIntent: ["ObservePlannedAttemptContinuationTargetLineage"],
        FreshLineage: ["FixIntegratorSuccessorSession"],
        SuccessorFixed: ["RunIntegrator"]
      }
      for (const prefix of matrix.prefixes) {
        for (const lane of lanes) {
          const frontier = yield* integrationRestartFrontier(prefix, matrix, lane)
          const tags = integrationTransitionsFor({ frontier }, taskId).map(({ _tag }) => _tag)
          expect(tags, prefix.cut + " / " + lane).toEqual(expectedTags[prefix.cut])
        }
      }
    }),
  bothStoreFrontierTimeout
)

it.effect(
  "reuses one exact successor identity and rejects an out-of-order restart",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedRun
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
    }),
  successorIdentityTimeout
)
