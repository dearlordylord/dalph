import { NodeCrypto } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { GitCommitSha } from "@dalph/contracts"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  InRunJournal,
  CoordinatorOwnership,
  acquireStartedIntegrationTarget,
  deriveIntegrationAdmission,
  TargetPromotionGitReadObservation,
  TargetPromotionRuntime,
  targetPromotionCorrelationEquals,
  type IntegrationTargetResourceController,
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
import { deliveryProposalsOf } from "../../../orchestrator/src/coordination/delivery/delivery-proposal-derivation.js"
import { executeIntegrationAction } from "../../../orchestrator/src/coordination/delivery/integration-delivery-action-adapter.js"
import type { DeliveryActionExecutionLease } from "../../../orchestrator/src/coordination/delivery/delivery-action-executor.js"
import type {
  DeliveryActionProposal,
  IdentityFreeDeliveryProposal
} from "../../../orchestrator/src/coordination/delivery/delivery-action-proposal.js"
import type { RunnableFrontierTransition } from "../../../orchestrator/src/coordination/frontier/frontier.js"
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
  readonly afterRecovery: RunRecoveryProjectionSnapshot | undefined
  readonly beforeAcquire: RunRecoveryProjectionSnapshot
  readonly boundaryCalls: ReadonlyArray<string>
  readonly records: ReadonlyArray<JournalRecord>
}

const isIdentityFreeProposal = (proposal: DeliveryActionProposal): proposal is IdentityFreeDeliveryProposal =>
  proposal.actionIdentity._tag === "NoWorkflowOperationIdentity"

const identityFreeActionFor = (
  runId: JournalRecord["runId"],
  records: ReadonlyArray<JournalRecord>,
  transition: RunnableFrontierTransition
): { readonly _tag: "IdentityFreeAction"; readonly proposal: IdentityFreeDeliveryProposal } => {
  const acceptedAt = records.at(-1)?.position
  if (acceptedAt === undefined) return expect.fail(transition._tag + " has no accepted journal position")
  const proposals = deliveryProposalsOf({
    acceptedAt,
    acceptedOperationIds: new Set(),
    fresh: [],
    integrationResponsibilities: deriveIntegrationAdmission(records).responsibilities,
    responsibilities: [],
    runId,
    transitions: [transition]
  })
  expect(proposals.issues).toEqual([])
  const proposal = exactlyOne(
    [...proposals.ticketDelivery, ...proposals.deliverySettlement],
    transition._tag + " production proposal"
  )
  if (!isIdentityFreeProposal(proposal)) {
    return expect.fail(transition._tag + " did not derive its identity-free production proposal")
  }
  return { _tag: "IdentityFreeAction", proposal }
}

const executionLeaseFor = (integrationTargets: IntegrationTargetResourceController): DeliveryActionExecutionLease => ({
  acceptIntegrationTargetOwnership: Effect.void,
  bindPreStartTaskWorkPosition: () => Effect.void,
  bindPreStartPlannedAttemptPosition: () => Effect.void,
  bindPlannedAttemptPosition: () => Effect.void,
  forwardBoundary: { _tag: "AtomicBoundary", execution: { run: (effect) => effect } },
  integrationTargets,
  recordIntent: () => Effect.void,
  releasePlannedAttemptPosition: () => Effect.void,
  withPlannedAttemptProtocol: () => Effect.die("restart-prefix promotion never enters attempt execution")
})

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
      const afterAcquire = yield* recovery.readDeliveryProjection
      const boundaryCalls: Array<string> = []
      let afterRecovery: RunRecoveryProjectionSnapshot | undefined
      if (prefix.cut === "AttemptIntended") {
        const promotion = exactlyOne(
          afterAcquire.frontier.transitions.filter(({ _tag }) => _tag === "RunTargetPromotion"),
          "recovered RunTargetPromotion"
        )
        if (promotion._tag !== "RunTargetPromotion") {
          return yield* Effect.die("recovered promotion transition narrowing failed")
        }
        // This is a current Git boundary fact, not a record copied from the
        // later authored run: the target moved to this controlled test head.
        const reconciledTargetHead = GitCommitSha.make("2".repeat(40))
        const runtime = TargetPromotionRuntime.of({
          git: {
            compareAndSet: () =>
              Effect.sync(() => boundaryCalls.push("compareAndSet")).pipe(
                Effect.andThen(Effect.die("restart must reconcile before any compare-and-set retry"))
              ),
            read: () =>
              Effect.sync(() => {
                boundaryCalls.push("read")
                return TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({
                  currentHeadSha: reconciledTargetHead
                })
              })
          }
        })
        const ownership = CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
        const lease = executionLeaseFor(resources)
        yield* executeIntegrationAction(
          identityFreeActionFor(began.runId, yield* storage.read(began.runId), promotion),
          promotion,
          lease,
          began.event.target
        ).pipe(
          Effect.provideService(CoordinatorOwnership, ownership),
          Effect.provideService(TargetPromotionRuntime, runtime),
          Effect.provideService(InRunJournal, journal)
        )
        const afterStale = yield* recovery.readDeliveryProjection
        const quarantine = exactlyOne(
          afterStale.frontier.transitions.filter(({ _tag }) => _tag === "RecordPromotionStaleIntegrationQuarantine"),
          "recovered promotion-stale quarantine"
        )
        if (quarantine._tag !== "RecordPromotionStaleIntegrationQuarantine") {
          return yield* Effect.die("recovered quarantine transition narrowing failed")
        }
        yield* executeIntegrationAction(
          identityFreeActionFor(began.runId, yield* storage.read(began.runId), quarantine),
          quarantine,
          lease,
          began.event.target
        ).pipe(Effect.provideService(InRunJournal, journal))
        afterRecovery = yield* recovery.readDeliveryProjection
      }
      return { afterAcquire, afterRecovery, beforeAcquire, boundaryCalls, records: yield* storage.read(began.runId) }
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
          const before = exactAttemptTransitions(production.beforeAcquire, plannedAttempt.attemptId)
          const after = exactAttemptTransitions(production.afterAcquire, plannedAttempt.attemptId)
          assertNoSuccessorTransition(production.beforeAcquire)
          assertNoSuccessorTransition(production.afterAcquire)
          if (production.afterRecovery !== undefined) assertNoSuccessorTransition(production.afterRecovery)

          if (prefix.cut === "AttemptIntended") {
            expect(prefix.records.at(-1)).toEqual(matrix.attempt)
            expect(before.map(({ _tag }) => _tag)).toEqual(["AcquireStartedIntegrationTarget"])
            const promotions = after.filter(({ _tag }) => _tag === "RunTargetPromotion")
            expect(promotions).toHaveLength(1)
            if (promotions[0]?._tag === "RunTargetPromotion") {
              expect(promotions[0].candidate).toEqual(matrix.attempt.event.correlation.qualifiedCandidate)
              expect(promotions[0].responsibility.plannedAttempt).toEqual(plannedAttempt)
            }
            expect(production.boundaryCalls).toEqual(["read"])
            expect(production.records.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")).toEqual(
              prefix.records.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")
            )
            const recoveredStale = exactlyOne(
              production.records.filter(({ event }) => event._tag === "TargetPromotionStale"),
              prefix.cut + " / " + lane + " recovered TargetPromotionStale"
            )
            const recoveredQuarantine = exactlyOne(
              production.records.filter(
                ({ event }) => event._tag === "IntegrationQuarantined" && event.basis._tag === "PromotionStale"
              ),
              prefix.cut + " / " + lane + " recovered promotion-stale quarantine"
            )
            expect(recoveredStale.event).toEqual({
              ...matrix.stale.event,
              observation: {
                _tag: "ReconciledCandidateNotInAncestry",
                observedHeadSha: matrix.stale.event.observation.observedHeadSha
              }
            })
            expect(recoveredQuarantine.event).toEqual(matrix.quarantine.event)
            expect(
              exactAttemptTransitions(
                production.afterRecovery ?? expect.fail("lost-response recovery did not reach durable quarantine"),
                plannedAttempt.attemptId
              )
            ).toEqual([])
          } else if (prefix.cut === "Stale") {
            expect(production.records, prefix.cut + " / " + lane + " projection must be read-only").toEqual(
              prefix.records
            )
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
            expect(production.records, prefix.cut + " / " + lane + " projection must be read-only").toEqual(
              prefix.records
            )
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
