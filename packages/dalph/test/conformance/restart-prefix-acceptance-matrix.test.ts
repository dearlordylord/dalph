import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  InRunJournal,
  acquireStartedIntegrationTarget,
  targetPromotionCorrelationEquals,
  type JournalRecord,
  makeIntegrationTargetResourceController
} from "@dalph/orchestrator"
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
import type { TargetPromotionRuntimeInput } from "../../../orchestrator/src/workflow/protocols/target-promotion/runtime.js"

const lanes: ReadonlyArray<RecoveryStoreLane> = ["memory", "sqlite"]
const restartPrefixCutLabels = ["AttemptIntended", "Stale", "Quarantined"] as const
type RestartPrefixCutLabel = (typeof restartPrefixCutLabels)[number]

// One authored execution supplies immutable source records to every store replay.
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

interface RestartPrefixMatrix {
  readonly attempt: JournalRecord
  readonly direction: JournalRecord
  readonly prefixes: ReadonlyArray<RecoveryPrefix<RestartPrefixCutLabel>>
  readonly quarantine: JournalRecord
  readonly stale: JournalRecord
}

const restartPrefixesFrom = (records: ReadonlyArray<JournalRecord>): RestartPrefixMatrix => {
  const stale = exactlyOne(
    records.filter(({ event }) => event._tag === "TargetPromotionStale"),
    "TargetPromotionStale"
  )
  if (stale.event._tag !== "TargetPromotionStale" || stale.event.basis._tag !== "AfterAttempt") {
    return expect.fail("restart-prefix stale event lacks its exact compare-and-set attempt ordinal")
  }
  const staleEvent = stale.event
  const staleAttemptOrdinal = stale.event.basis.attemptOrdinal
  const attempt = exactlyOne(
    records.filter(
      (record) =>
        record.runId === stale.runId &&
        record.position < stale.position &&
        record.event._tag === "TargetPromotionAttemptIntended" &&
        record.event.attemptOrdinal === staleAttemptOrdinal &&
        targetPromotionCorrelationEquals(record.event.correlation, staleEvent.correlation)
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
    "later FullRerun IntegrationQuarantineDirectionApplied"
  )
  if (
    attempt.event._tag !== "TargetPromotionAttemptIntended" ||
    quarantine.event._tag !== "IntegrationQuarantined" ||
    direction.event._tag !== "IntegrationQuarantineDirectionApplied" ||
    direction.position <= quarantine.position
  ) {
    return expect.fail("restart-prefix fixture chronology is not attempt → stale → quarantine → Operator direction")
  }
  const endpoints: ReadonlyArray<[RestartPrefixCutLabel, JournalRecord, string]> = [
    ["AttemptIntended", attempt, "TargetPromotionAttemptIntended"],
    ["Stale", stale, "TargetPromotionStale"],
    ["Quarantined", quarantine, "PromotionStale IntegrationQuarantined"]
  ]
  const prefixes = endpoints.map(([cut, endpoint, description]) => {
    const prefix = prefixThrough(records, cut, description, records.indexOf(endpoint))
    return prefix === undefined ? expect.fail("missing retained restart prefix " + cut) : prefix
  })
  return { attempt, direction, prefixes, quarantine, stale }
}

const disabledTargetPromotionRuntime: TargetPromotionRuntimeInput = {
  git: {
    compareAndSet: () => Effect.die("restart-prefix projection must not repeat target promotion"),
    read: () => Effect.die("restart-prefix projection must not cross a Git boundary")
  }
}

interface ProductionRestartProjection {
  readonly afterAcquire: RunRecoveryProjectionSnapshot
  readonly beforeAcquire: RunRecoveryProjectionSnapshot
  readonly records: ReadonlyArray<JournalRecord>
}

const productionRestartProjection = (
  prefix: RecoveryPrefix<RestartPrefixCutLabel>,
  lane: RecoveryStoreLane
): Effect.Effect<ProductionRestartProjection, unknown> =>
  withRecoveryPrefixStore(prefix, lane, (storage) =>
    Effect.gen(function* () {
      const began = prefix.records[0]
      const session = prefix.records.find(({ event }) => event._tag === "IntegratorSessionFixed")
      if (began.event._tag !== "WorkflowRunBegan" || session?.event._tag !== "IntegratorSessionFixed") {
        return yield* Effect.die("restart prefix lacks its run and predecessor integration session")
      }
      const resources = yield* makeIntegrationTargetResourceController()
      const journal = InRunJournal.of({ append: storage.append, read: storage.read })
      const recovery = yield* makeRunRecoveryProjection(
        began.runId,
        session.event.correlation.integrationTarget,
        resources,
        disabledTargetPromotionRuntime
      ).pipe(Effect.provideService(InRunJournal, journal))
      const beforeAcquire = yield* recovery.readDeliveryProjection
      const acquire = beforeAcquire.frontier.transitions.find(
        (transition) => transition._tag === "AcquireStartedIntegrationTarget"
      )
      if (acquire?._tag === "AcquireStartedIntegrationTarget") {
        yield* acquireStartedIntegrationTarget(resources, acquire)
      }
      return {
        afterAcquire: yield* recovery.readDeliveryProjection,
        beforeAcquire,
        records: yield* storage.read(began.runId)
      }
    })
  )

const exactAttemptTransitions = (snapshot: RunRecoveryProjectionSnapshot, attemptId: string) =>
  snapshot.frontier.transitions.filter(
    (transition) =>
      ("responsibility" in transition && transition.responsibility.plannedAttempt.attemptId === attemptId) ||
      ("plannedAttempt" in transition && transition.plannedAttempt.attemptId === attemptId)
  )

const assertNoOperatorChoiceOrSuccessor = (prefix: RecoveryPrefix<RestartPrefixCutLabel>): void => {
  expect(
    prefix.records.filter(
      ({ event }) =>
        event._tag === "IntegrationQuarantineDirectionApplied" || event._tag === "IntegratorSuccessorSessionFixed"
    )
  ).toEqual([])
}

const successorTransitionTags = new Set([
  "ObservePlannedAttemptContinuationTargetLineage",
  "FixIntegratorSuccessorSession",
  "RunIntegrator"
])

const assertNoSuccessorTransition = (snapshot: RunRecoveryProjectionSnapshot): void => {
  expect(snapshot.frontier.transitions.filter(({ _tag }) => successorTransitionTags.has(_tag))).toEqual([])
}

it.effect(
  "preserves #270 promotion intent, stale evidence, and durable quarantine through both restart stores",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedRun
      const matrix = restartPrefixesFrom(run.records)
      expect(matrix.prefixes).toHaveLength(restartPrefixCutLabels.length)
      if (
        matrix.attempt.event._tag !== "TargetPromotionAttemptIntended" ||
        matrix.stale.event._tag !== "TargetPromotionStale" ||
        matrix.quarantine.event._tag !== "IntegrationQuarantined"
      ) {
        return yield* Effect.die("restart-prefix fixture event narrowing failed")
      }
      const plannedAttempt = matrix.attempt.event.correlation.qualifiedCandidate.run.session.plannedAttempt

      expect(matrix.stale.event.correlation).toEqual(matrix.attempt.event.correlation)
      expect(matrix.stale.event.basis).toEqual({
        _tag: "AfterAttempt",
        attemptOrdinal: matrix.attempt.event.attemptOrdinal
      })
      expect(matrix.quarantine.event.basis).toEqual({
        _tag: "PromotionStale",
        candidateCommit: matrix.stale.event.correlation.qualifiedCandidate.candidateCommit,
        observedTargetHead: matrix.stale.event.observation.observedHeadSha,
        targetPromotionStaleAt: matrix.stale.position
      })

      for (const prefix of matrix.prefixes) {
        const expected = yield* expectedRecoveryPrefix(prefix)
        expect(expected.historyTag, prefix.cut + " must retain valid exact history").toBe("ValidWorkflowJournalHistory")
        assertNoOperatorChoiceOrSuccessor(prefix)

        for (const lane of lanes) {
          const replayed = yield* replayRecoveryPrefix(prefix, lane)
          expect(recoveryPrefixMismatch(prefix.cut, lane, expected, replayed)).toBeUndefined()
          const production = yield* productionRestartProjection(prefix, lane)
          expect(production.records, prefix.cut + " / " + lane + " projection must be read-only").toEqual(
            prefix.records
          )
          const before = exactAttemptTransitions(production.beforeAcquire, plannedAttempt.attemptId)
          const after = exactAttemptTransitions(production.afterAcquire, plannedAttempt.attemptId)
          assertNoSuccessorTransition(production.beforeAcquire)
          assertNoSuccessorTransition(production.afterAcquire)

          if (prefix.cut === "AttemptIntended") {
            expect(prefix.records.at(-1)).toEqual(matrix.attempt)
            // The compare-and-set response was lost. The retained intent is
            // exact, but unrelated earlier continuation work prevents retry.
            expect(before).toEqual([])
            expect(after).toEqual([])
          } else if (prefix.cut === "Stale") {
            expect(prefix.records.at(-1)).toEqual(matrix.stale)
            expect(before.filter(({ _tag }) => _tag === "AcquireStartedIntegrationTarget")).toEqual([])
            const quarantines = after.filter(({ _tag }) => _tag === "RecordPromotionStaleIntegrationQuarantine")
            expect(quarantines).toHaveLength(1)
            if (quarantines[0]?._tag === "RecordPromotionStaleIntegrationQuarantine") {
              expect(quarantines[0].input).toEqual({
                correlation: matrix.stale.event.correlation,
                targetPromotionStaleAt: matrix.stale.position
              })
              expect(quarantines[0].responsibility.plannedAttempt).toEqual(plannedAttempt)
            }
          } else {
            // #271 owns recovery after an Operator direction. A process restart
            // has no retained semaphore lease to release at this durable-Q cut.
            expect(prefix.records.at(-1)).toEqual(matrix.quarantine)
            expect(before).toEqual([])
            expect(after).toEqual([])
            expect(matrix.direction.position).toBeGreaterThan(
              prefix.records.at(-1)?.position ?? Number.MAX_SAFE_INTEGER
            )
          }
        }
      }
    }),
  // Six SQLite/memory reconstructions plus production projections measured
  // 11.7s locally; 30s leaves store-heavy CI margin without hiding a hang.
  30_000
)
