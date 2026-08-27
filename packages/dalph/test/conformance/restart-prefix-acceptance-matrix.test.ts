import { NodeCrypto } from "@effect/platform-node"
import type { PlannedTaskAttempt } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { expect } from "vitest"
import {
  InRunJournal,
  acquireStartedIntegrationTarget,
  authorizedClaimForAttempt,
  deriveIntegrationAdmission,
  deriveIntegrationFrontier,
  integratorRunCorrelationForSession,
  IntegratorRunOrdinal,
  reduceWorkflowJournalHistory,
  RunnableFrontierTransition,
  targetPromotionCorrelationEquals,
  appendPromotionStaleIntegrationQuarantine,
  type JournalRecord,
  makeIntegrationTargetResourceController
} from "@dalph/orchestrator"
import {
  WorkflowInterpreter,
  WorkflowTrace,
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

const lanes: ReadonlyArray<RecoveryStoreLane> = ["memory", "sqlite"]
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

const sourceRun = () =>
  runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.deliveryInvariantStoryCapstone).pipe(
    Effect.provide(NodeCrypto.layer)
  )

const exactlyOne = <A>(values: ReadonlyArray<A>, description: string): A => {
  const value = values.length === 1 ? values[0] : undefined
  return value === undefined ? expect.fail("expected one " + description + ", received " + values.length) : value
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

/**
 * Reconstructs the integration-owned frontier at its accepted runtime-facts
 * seam. Unrelated continuation refresh actions may precede this frontier in
 * the run-wide scheduler, but cannot replace its exact A/C/S/M authority or
 * authorize a successor.
 */
const reconstructedIntegrationFrontier = (
  records: ReadonlyArray<JournalRecord>,
  plannedAttempt: PlannedTaskAttempt
) => {
  const runId = records[0]?.runId
  if (runId === undefined) return expect.fail("restart-prefix integration reconstruction lacks a run")
  const reduction = reduceWorkflowJournalHistory(runId, records)
  if (reduction._tag !== "ValidWorkflowJournalHistory") {
    return expect.fail("restart-prefix integration reconstruction requires valid durable history")
  }
  const responsibility = exactlyOne(
    deriveIntegrationAdmission(records).responsibilities.filter(
      (candidate) =>
        candidate._tag === "StartedIntegrationResponsibility" &&
        candidate.plannedAttempt.attemptId === plannedAttempt.attemptId &&
        candidate.plannedAttempt.runId === plannedAttempt.runId
    ),
    "started integration responsibility for the stale promotion"
  )
  if (responsibility._tag !== "StartedIntegrationResponsibility") {
    return expect.fail("restart-prefix integration responsibility narrowing failed")
  }
  const claim = authorizedClaimForAttempt(records, responsibility.plannedAttempt)?.claim
  if (claim === undefined) {
    return expect.fail("restart-prefix integration reconstruction lacks the exact authorized task claim")
  }
  const lineage = records.findLast(
    ({ event }) =>
      event._tag === "TargetLineageObserved" &&
      event.plannedAttempt.attemptId === responsibility.plannedAttempt.attemptId &&
      event.plannedAttempt.runId === responsibility.plannedAttempt.runId
  )
  return deriveIntegrationFrontier(reduction.runState, {
    activeClaimByAttemptId: new Map([[responsibility.plannedAttempt.attemptId, claim]]),
    activeResponsibilityPositions: new Set(),
    completionTaskConfigured: true,
    currentTrackerTaskIds: new Set([responsibility.plannedAttempt.taskId]),
    heldResponsibilityPositions: new Set([responsibility.queuedAt]),
    integrationFinalityConfigured: true,
    integrationTarget: Option.some(responsibility.integrationTarget),
    targetLineageByAttemptId:
      lineage?.event._tag === "TargetLineageObserved"
        ? new Map([[responsibility.plannedAttempt.attemptId, lineage.event.observation]])
        : new Map(),
    targetLineageRefreshRequiredAttemptIds: new Set(),
    targetPromotionConfigured: true,
    taskClaimAuthorityByAttemptId: new Map([[responsibility.plannedAttempt.attemptId, { _tag: "Exact" }]])
  })
}

const restartFrontierAtAcceptedSeam = (
  records: ReadonlyArray<JournalRecord>,
  matrix: RestartPrefixMatrix,
  cut: RestartPrefixCutLabel
) => {
  if (matrix.attempt.event._tag !== "TargetPromotionAttemptIntended") {
    return expect.fail("restart-prefix attempt event narrowing failed")
  }
  const frontier = reconstructedIntegrationFrontier(
    records,
    matrix.attempt.event.correlation.qualifiedCandidate.run.session.plannedAttempt
  )
  if (cut !== "DirectionApplied" && cut !== "FreshReadIntent") return frontier
  if (
    matrix.successorReadIntent.event._tag !== "GitReadIntentRecorded" ||
    matrix.successorReadIntent.event.operation._tag !== "ReadTargetLineage"
  ) {
    return expect.fail("restart-prefix matrix lacks the exact successor target-lineage operation")
  }
  expect(
    frontier.transitions.some(({ _tag }) => _tag === "FixIntegratorSuccessorSession" || _tag === "RunIntegrator")
  ).toBe(false)
  return {
    ...frontier,
    transitions: [
      ...frontier.transitions,
      RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
        operation: matrix.successorReadIntent.event.operation,
        plannedAttempt: matrix.successorReadIntent.event.operation.plannedAttempt
      })
    ]
  }
}

const integrationRestartFrontier = (
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  matrix: RestartPrefixMatrix,
  lane: RecoveryStoreLane
) =>
  withRecoveryPrefixStore(prefix, lane, (storage) =>
    Effect.gen(function* () {
      const records = yield* storage.read(prefix.records[0].runId)
      return restartFrontierAtAcceptedSeam(records, matrix, prefix.cut)
    })
  )

const resumeFreshTargetLineage = (
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  matrix: RestartPrefixMatrix,
  lane: RecoveryStoreLane
) =>
  withRecoveryPrefixStore(prefix, lane, (storage) =>
    Effect.gen(function* () {
      const runId = prefix.records[0].runId
      const began = prefix.records[0]
      if (began.event._tag !== "WorkflowRunBegan") {
        return yield* Effect.die("restart prefix has no WorkflowRunBegan authority")
      }
      if (
        matrix.successor.event._tag !== "IntegratorSuccessorSessionFixed" ||
        matrix.successorLineage.event._tag !== "TargetLineageObserved" ||
        matrix.successorReadIntent.event._tag !== "GitReadIntentRecorded" ||
        matrix.successorReadIntent.event.operation._tag !== "ReadTargetLineage"
      ) {
        return yield* Effect.die("restart prefix lacks typed successor lineage evidence")
      }
      const successorLineageEvent = matrix.successorLineage.event
      const journal = InRunJournal.of({ append: storage.append, read: storage.read })
      const genericInterpreter = WorkflowInterpreter.of({
        acquireTaskClaim: () => Effect.die("unused restart test interpreter operation"),
        readTrackerGraph: () => Effect.die("unused restart test interpreter operation"),
        readTaskClaim: () => Effect.die("unused restart test interpreter operation"),
        readTaskWorktree: () => Effect.die("unused restart test interpreter operation"),
        readTargetLineage: () =>
          Effect.succeed(AuthoritativeTargetLineageObserved.make({ observation: successorLineageEvent.observation })),
        releaseTaskClaim: () => Effect.die("unused restart test interpreter operation"),
        readTaskWorkSpecification: () => Effect.die("unused restart test interpreter operation"),
        reconcileTaskWorktree: () => Effect.die("unused restart test interpreter operation"),
        recordTaskAttemptPlan: () => Effect.die("unused restart test interpreter operation")
      })
      const interpreterLayer = Layer.succeed(WorkflowInterpreter, genericInterpreter)
      const journaledLayer = journaledWorkflowInterpreterLayer(runId, interpreterLayer)
      const records = yield* storage.read(runId)
      const frontier = restartFrontierAtAcceptedSeam(records, matrix, prefix.cut)
      const lineageTransition = frontier.transitions.find(
        ({ _tag }) => _tag === "ObservePlannedAttemptContinuationTargetLineage"
      )
      if (lineageTransition?._tag !== "ObservePlannedAttemptContinuationTargetLineage") {
        return yield* Effect.die("restart prefix lacks fresh target-lineage action")
      }
      const action = newRecoveredActionOf(lineageTransition)
      const operationId = operationIdOf(lineageTransition)
      if (action?._tag !== "ReadTargetLineage" || operationId === undefined) {
        return yield* Effect.die("restart target-lineage action identity was not reconstructed")
      }
      yield* executeRestartRecoveredObservation(
        { action, operationId },
        {
          forwardBoundary: {
            _tag: "InterruptibleBoundary",
            execution: { run: (_intent, effect, recordResult) => effect.pipe(Effect.flatMap(recordResult)) }
          },
          recordIntent: () => Effect.void
        }
      ).pipe(
        Effect.provide(journaledLayer),
        Effect.provideService(InRunJournal, journal),
        Effect.provideService(WorkflowTrace, WorkflowTrace.of({ emit: () => Effect.void }))
      )
      return yield* storage.read(runId)
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
        integrationRestartFrontier(prefixAt(matrix, cut), matrix, "memory").pipe(
          Effect.map((frontier) => ({ frontier }))
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
  restartAcceptanceTimeout
)

it.effect(
  "executes recovered target-lineage observations through the production interpreter",
  () =>
    Effect.gen(function* () {
      const run = yield* sourceRun()
      const matrix = restartPrefixesFrom(run.records)
      for (const cut of ["DirectionApplied", "FreshReadIntent"] as const) {
        const prefix = prefixAt(matrix, cut)
        for (const lane of lanes) {
          const records = yield* resumeFreshTargetLineage(prefix, matrix, lane)
          const suffix = records.slice(prefix.records.length)
          expect(
            suffix.map(({ event }) => event._tag),
            cut + " / " + lane
          ).toEqual(
            cut === "DirectionApplied" ? ["GitReadIntentRecorded", "TargetLineageObserved"] : ["TargetLineageObserved"]
          )
          expect(suffix.at(-1)?.event).toEqual(matrix.successorLineage.event)
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
      const taskId =
        matrix.successor.event._tag === "IntegratorSuccessorSessionFixed"
          ? matrix.successor.event.successor.plannedAttempt.taskId
          : yield* Effect.die("restart-prefix fixture successor narrowing failed")
      const expectedTags: Readonly<Record<RestartPrefixCutLabel, ReadonlyArray<string>>> = {
        AttemptIntended: ["RunTargetPromotion"],
        Stale: ["RecordPromotionStaleIntegrationQuarantine"],
        Quarantined: ["ReleaseStartedIntegrationTarget"],
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
