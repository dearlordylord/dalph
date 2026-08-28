import { it } from "@effect/vitest"
import { GitCommitSha, PlannedAttemptExecutorReport } from "@dalph/contracts"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import {
  InRunJournal,
  IntegrationQuarantineBasis,
  IntegrationQuarantinedEvent,
  IntegratorRunQualifiedCandidate,
  type IntegratorSessionId,
  JournalPosition,
  JournalRecordKey,
  JournalStore,
  CoordinatorOwnership,
  OperationId,
  TaskTrackerReadIntentRecordedEvent,
  acquireStartedIntegrationTarget,
  deriveIntegrationAdmission,
  deriveIntegrationQuarantineState,
  describeJournalEvent,
  GitReadIntentRecordedEvent,
  IntegrationResponsibilityBeganEvent,
  IntegrationStartedEvent,
  IntegratorCandidateText,
  IntegratorGitObservation,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  projectWorkflowOccurrences,
  reduceWorkflowJournalHistory,
  runTargetPromotion,
  TargetPromotionStaleEvent,
  TargetPromotionTerminalBasis,
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  TargetPromotionIntendedEvent,
  TargetPromotionGit,
  TargetPromotionGitReadObservation,
  TargetPromotionGitReadFailure,
  TargetPromotionHistoryContradiction,
  TargetPromotionReconciliationDeferredEvent,
  TargetPromotionReconciliationDeferral,
  TargetPromotionRuntime,
  intentRecordKey,
  integrationQuarantinedRecordKey,
  makeTrackerGraphObservationOperation,
  memoryJournalStoreLayer,
  appendPromotionStaleIntegrationQuarantine,
  targetPromotionAttemptIntentRecordKey,
  targetPromotionCorrelationEquals,
  targetPromotionCorrelationFor,
  targetPromotionIntentRecordKey,
  targetPromotionReconciliationDeferredRecordKey,
  targetPromotionStaleRecordKey,
  type IntegrationTargetResourceController,
  type JournalRecord,
  makeIntegrationTargetResourceController,
  makeTaskAttemptPlanOperation,
  makeTargetLineageObservationOperation,
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent,
  TargetLineageObservation,
  TargetLineageObservedEvent,
  TaskAttemptPlannedEvent,
  WorkflowRunBeganEvent,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../../../orchestrator/src/coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../orchestrator/src/control/policy.js"
import { integrationFinalityFixture } from "../../../orchestrator/src/workflow/protocols/integration-finality/fixtures.js"
import {
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionCorrelation,
  IntegratorSessionFixedEvent,
  IntegratorResult
} from "../../../orchestrator/src/workflow/protocols/integrator/events.js"
import {
  expectedRecoveryPrefix,
  prefixThrough,
  recoveryPrefixMismatch,
  withRecoveryPrefixStore,
  type RecoveryPrefix,
  type RecoveryStoreReplay,
  type RecoveryStoreLane
} from "./recovery-store-lanes.js"
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
type ReconciliationBoundaryMode = "CandidateAbsent" | "ExpectedHead" | "Unreadable"

const exactlyOne = <A>(values: ReadonlyArray<A>, description: string): A => {
  const value = values.length === 1 ? values[0] : undefined
  return value === undefined ? expect.fail("expected one " + description + ", received " + values.length) : value
}

interface RestartPrefixMatrix {
  readonly attempt: JournalRecord
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
  if (
    attempt.event._tag !== "TargetPromotionAttemptIntended" ||
    quarantine.event._tag !== "IntegrationQuarantined" ||
    quarantine.position <= stale.position
  ) {
    return expect.fail("restart-prefix fixture chronology is not attempt → stale → quarantine")
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
  return { attempt, prefixes, quarantine, stale }
}

const directPromotionRestartRecords = (): ReadonlyArray<JournalRecord> => {
  const fixture = integrationFinalityFixture
  const candidateText = IntegratorCandidateText.make(fixture.qualifiedCandidate.candidateText)
  const session = IntegratorSessionCorrelation.make({
    ...fixture.qualifiedCandidate.run.session,
    queuedAt: JournalPosition.make(6),
    startedAt: JournalPosition.make(7),
    targetLineageObservedAt: JournalPosition.make(9)
  })
  const integratorRun = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session })
  const candidate = IntegratorRunQualifiedCandidate.make({
    ...fixture.qualifiedCandidate,
    candidateText,
    qualifiedAt: JournalPosition.make(14),
    run: integratorRun
  })
  const correlation = targetPromotionCorrelationFor(candidate)
  const attemptOrdinal = TargetPromotionAttemptOrdinal.make(1)
  const changedHead = GitCommitSha.make("4".repeat(40))
  const lineageOperation = makeTargetLineageObservationOperation({
    integrationTarget: fixture.integrationTarget,
    operationId: OperationId.make("restart-prefix-direct-target-lineage"),
    plannedAttempt: fixture.plannedAttempt,
    predecessorOperationIds: []
  })
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("restart-prefix-direct-plan"),
    plannedAttempt: fixture.plannedAttempt,
    predecessorOperationIds: []
  })
  const record = (position: number, event: JournalRecord["event"]): JournalRecord => ({
    event,
    key: describeJournalEvent(event).expectedKey,
    position: JournalPosition.make(position),
    runId: fixture.runId
  })
  const stale = record(
    17,
    TargetPromotionStaleEvent.make({
      basis: TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal }),
      correlation,
      observation: { _tag: "CompareAndSetRejected", observedHeadSha: changedHead },
      version: workflowJournalEventVersion
    })
  )
  const quarantineBasis = IntegrationQuarantineBasis.cases.PromotionStale.make({
    candidateCommit: candidate.candidateCommit,
    observedTargetHead: changedHead,
    targetPromotionStaleAt: stale.position
  })
  return [
    record(
      1,
      WorkflowRunBeganEvent.make({
        initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        target: fixture.target,
        version: workflowJournalEventVersion
      })
    ),
    record(2, TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })),
    record(
      3,
      PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
        plannedAttempt: fixture.plannedAttempt,
        version: workflowJournalEventVersion
      })
    ),
    record(
      4,
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command: "StartOrContinue",
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal: PlannedAttemptExecutorCommandOrdinal.make(1),
        plannedAttempt: fixture.plannedAttempt,
        version: workflowJournalEventVersion
      })
    ),
    record(
      5,
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
        report: PlannedAttemptExecutorReport.cases.Terminal.make({
          correlation: { attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId },
          result: { _tag: "Accepted", acceptedResult: session.acceptedResult }
        }),
        version: workflowJournalEventVersion
      })
    ),
    record(
      6,
      IntegrationResponsibilityBeganEvent.make({
        acceptedResult: session.acceptedResult,
        integrationTarget: fixture.integrationTarget,
        plannedAttempt: fixture.plannedAttempt,
        version: workflowJournalEventVersion
      })
    ),
    record(
      7,
      IntegrationStartedEvent.make({
        acceptedResult: session.acceptedResult,
        integrationTarget: fixture.integrationTarget,
        plannedAttempt: fixture.plannedAttempt,
        responsibilityBeganAt: JournalPosition.make(6),
        version: workflowJournalEventVersion
      })
    ),
    record(
      8,
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: lineageOperation,
        version: workflowJournalEventVersion
      })
    ),
    record(
      9,
      TargetLineageObservedEvent.make({
        observation: TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: fixture.plannedAttempt.baseSha,
          targetHeadSha: session.expectedTargetHead
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: lineageOperation.operationId,
        plannedAttempt: fixture.plannedAttempt,
        version: workflowJournalEventVersion
      })
    ),
    record(10, IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion })),
    record(11, IntegratorRunStartedEvent.make({ run: integratorRun, version: workflowJournalEventVersion })),
    record(
      12,
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: integratorRun }),
        run: integratorRun,
        version: workflowJournalEventVersion
      })
    ),
    record(
      13,
      IntegratorRunCandidateGitReadIntendedEvent.make({
        candidateText,
        run: integratorRun,
        version: workflowJournalEventVersion
      })
    ),
    record(
      14,
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText,
        observation: IntegratorGitObservation.cases.Commit.make({
          candidateText,
          commit: candidate.candidateCommit,
          directParents: candidate.directParents
        }),
        run: integratorRun,
        version: workflowJournalEventVersion
      })
    ),
    record(15, TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })),
    record(
      16,
      TargetPromotionAttemptIntendedEvent.make({
        attemptOrdinal,
        correlation,
        reason: TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: session.expectedTargetHead }),
        version: workflowJournalEventVersion
      })
    ),
    stale,
    record(
      18,
      IntegrationQuarantinedEvent.make({
        basis: quarantineBasis,
        correlation: session,
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      })
    )
  ]
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
  readonly replay: RecoveryStoreReplay
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
  lane: RecoveryStoreLane,
  reconciliationMode: ReconciliationBoundaryMode = "CandidateAbsent"
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
      const decodedRecords = yield* storage.read(began.runId)
      const replay: RecoveryStoreReplay = {
        decodedRecords,
        historyTag: reduceWorkflowJournalHistory(began.runId, decodedRecords)._tag,
        projection: yield* projectWorkflowOccurrences(decodedRecords)
      }
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
        const reconciliation = exactlyOne(
          afterAcquire.frontier.transitions.filter(({ _tag }) => _tag === "ReconcileTargetPromotionAttempt"),
          "recovered ReconcileTargetPromotionAttempt"
        )
        if (reconciliation._tag !== "ReconcileTargetPromotionAttempt") {
          return yield* Effect.die("recovered promotion reconciliation transition narrowing failed")
        }
        // This is a current Git boundary fact, not a record copied from the
        // later authored run: the target moved to this controlled test head.
        const reconciledTargetHead = GitCommitSha.make("4".repeat(40))
        const runtime = TargetPromotionRuntime.of({
          git: {
            compareAndSet: () =>
              Effect.sync(() => boundaryCalls.push("compareAndSet")).pipe(
                Effect.andThen(Effect.die("restart must reconcile before any compare-and-set retry"))
              ),
            read: (request) =>
              Effect.sync(() => {
                boundaryCalls.push("read")
                if (reconciliationMode === "Unreadable") {
                  return new TargetPromotionGitReadFailure({
                    candidateCommit: request.candidateCommit,
                    detail: "controlled destination read unavailable",
                    target: request.integrationTarget
                  })
                }
                return TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({
                  currentHeadSha:
                    reconciliationMode === "ExpectedHead"
                      ? reconciliation.candidate.run.session.expectedTargetHead
                      : reconciledTargetHead
                })
              }).pipe(
                Effect.flatMap((result) =>
                  result instanceof TargetPromotionGitReadFailure ? Effect.fail(result) : Effect.succeed(result)
                )
              )
          }
        })
        const ownership = CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
        const lease = executionLeaseFor(resources)
        const reconciliationResult = yield* executeIntegrationAction(
          identityFreeActionFor(began.runId, yield* storage.read(began.runId), reconciliation),
          reconciliation,
          lease,
          began.event.target
        ).pipe(
          Effect.provideService(CoordinatorOwnership, ownership),
          Effect.provideService(TargetPromotionRuntime, runtime),
          Effect.provideService(InRunJournal, journal)
        )
        if (reconciliationMode === "CandidateAbsent") {
          expect(reconciliationResult._tag).toBe("ActionCompleted")
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
        } else {
          expect(reconciliationResult).toMatchObject({
            _tag: "ActionDeferred",
            reason:
              reconciliationMode === "Unreadable"
                ? "TargetPromotionDestinationUnreadable"
                : "TargetPromotionRetryAuthorityRequired"
          })
          const unrelatedOperationId = OperationId.make(
            `restart-reconciliation-stability:${reconciliationMode}:${lane}`
          )
          const unrelatedOperation = makeTrackerGraphObservationOperation(unrelatedOperationId, began.event.target)
          yield* storage.append(
            began.runId,
            intentRecordKey(unrelatedOperationId),
            TaskTrackerReadIntentRecordedEvent.make({
              operation: unrelatedOperation,
              version: workflowJournalEventVersion
            })
          )
        }
        if (reconciliationMode === "CandidateAbsent") {
          afterRecovery = yield* recovery.readDeliveryProjection
        } else {
          const restartedResources = yield* makeIntegrationTargetResourceController()
          const restartedRecovery = yield* makeRunRecoveryProjection(
            began.runId,
            session.event.correlation.integrationTarget,
            restartedResources,
            disabledTargetPromotionRuntime
          ).pipe(Effect.provideService(InRunJournal, journal))
          afterRecovery = yield* restartedRecovery.readDeliveryProjection
        }
      }
      return {
        afterAcquire,
        afterRecovery,
        beforeAcquire,
        boundaryCalls,
        records: yield* storage.read(began.runId),
        replay
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

type StoredPromotionStalePrefixKind =
  | "Exact"
  | "BeforeFirstAttempt"
  | "ZeroAttempt"
  | "DuplicateAttempt"
  | "ForeignAttempt"

interface StoredPromotionStalePrefix {
  readonly prefix: RecoveryPrefix<StoredPromotionStalePrefixKind>
  readonly sessionId: IntegratorSessionId
}

const storedPromotionStalePrefix = Effect.fn("RestartPrefixAcceptanceMatrix.storedPromotionStalePrefix")(function* (
  kind: StoredPromotionStalePrefixKind
): Effect.fn.Return<StoredPromotionStalePrefix, unknown> {
  const candidate = integrationFinalityFixture.qualifiedCandidate
  const correlation = targetPromotionCorrelationFor(candidate)
  const runId = candidate.run.session.plannedAttempt.runId
  const attemptOrdinal = TargetPromotionAttemptOrdinal.make(1)
  const changedHead = GitCommitSha.make("4".repeat(40))
  const exact = yield* Effect.scoped(
    Effect.gen(function* () {
      const storage = yield* JournalStore
      yield* storage.beginRun(
        runId,
        FixtureTarget.make("promotion-stale-storage-prefix"),
        InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
      )
      yield* storage.append(
        runId,
        targetPromotionIntentRecordKey(correlation.requestId),
        TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
      )
      yield* storage.append(
        runId,
        targetPromotionAttemptIntentRecordKey(correlation.requestId, attemptOrdinal),
        TargetPromotionAttemptIntendedEvent.make({
          attemptOrdinal,
          correlation,
          reason: TargetPromotionAttemptReason.cases.Initial.make({
            observedHeadSha: candidate.run.session.expectedTargetHead
          }),
          version: workflowJournalEventVersion
        })
      )
      const stale = yield* storage.append(
        runId,
        targetPromotionStaleRecordKey(correlation.requestId),
        TargetPromotionStaleEvent.make({
          basis: TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal }),
          correlation,
          observation: { _tag: "CompareAndSetRejected", observedHeadSha: changedHead },
          version: workflowJournalEventVersion
        })
      )
      const journal = InRunJournal.of({ append: storage.append, read: storage.read })
      yield* appendPromotionStaleIntegrationQuarantine({ correlation, targetPromotionStaleAt: stale.position }).pipe(
        Effect.provideService(InRunJournal, journal)
      )
      return yield* storage.read(runId)
    }).pipe(Effect.provide(memoryJournalStoreLayer))
  )
  const began = exactlyOne(
    exact.filter(({ event }) => event._tag === "WorkflowRunBegan"),
    "minimal stored-prefix WorkflowRunBegan"
  )
  const intent = exactlyOne(
    exact.filter(({ event }) => event._tag === "TargetPromotionIntended"),
    "minimal stored-prefix promotion intent"
  )
  const attempt = exactlyOne(
    exact.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended"),
    "minimal stored-prefix promotion attempt"
  )
  const stale = exactlyOne(
    exact.filter(({ event }) => event._tag === "TargetPromotionStale"),
    "minimal stored-prefix stale result"
  )
  const quarantine = exactlyOne(
    exact.filter(({ event }) => event._tag === "IntegrationQuarantined"),
    "minimal stored-prefix quarantine"
  )
  if (
    attempt.event._tag !== "TargetPromotionAttemptIntended" ||
    stale.event._tag !== "TargetPromotionStale" ||
    quarantine.event._tag !== "IntegrationQuarantined"
  ) {
    return yield* Effect.die("minimal stored-prefix records did not narrow")
  }

  const foreignCandidate = IntegratorRunQualifiedCandidate.make({
    ...candidate,
    candidateCommit: GitCommitSha.make("6".repeat(40))
  })
  const foreignAttempt = {
    ...attempt,
    event: TargetPromotionAttemptIntendedEvent.make({
      ...attempt.event,
      correlation: targetPromotionCorrelationFor(foreignCandidate)
    })
  }
  const attemptedRecords =
    kind === "ZeroAttempt"
      ? []
      : kind === "ForeignAttempt"
        ? [foreignAttempt]
        : kind === "DuplicateAttempt"
          ? [attempt, { ...attempt, key: JournalRecordKey.make("invalid:duplicate-target-promotion-attempt") }]
          : [attempt]
  const stalePosition = JournalPosition.make(3 + attemptedRecords.length)
  const staleEvent = TargetPromotionStaleEvent.make({
    ...stale.event,
    basis:
      kind === "BeforeFirstAttempt"
        ? TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({})
        : TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal })
  })
  const storedStale = { ...stale, event: staleEvent, position: stalePosition }
  const quarantineBasis = IntegrationQuarantineBasis.cases.PromotionStale.make({
    candidateCommit: candidate.candidateCommit,
    observedTargetHead: changedHead,
    targetPromotionStaleAt: stalePosition
  })
  const storedQuarantine = {
    ...quarantine,
    event: IntegrationQuarantinedEvent.make({ ...quarantine.event, basis: quarantineBasis }),
    key: integrationQuarantinedRecordKey(candidate.run.session.sessionId, quarantineBasis),
    position: JournalPosition.make(Number(stalePosition) + 1)
  }
  const records = [began, intent, ...attemptedRecords, storedStale, storedQuarantine] as const
  return {
    prefix: { cut: kind, endpoint: kind + " promotion-stale quarantine", records },
    sessionId: candidate.run.session.sessionId
  }
})

it.effect(
  "preserves #270 promotion intent, stale evidence, and durable quarantine through both restart stores",
  () =>
    Effect.gen(function* () {
      const matrix = restartPrefixesFrom(directPromotionRestartRecords())
      expect(matrix.prefixes).toHaveLength(restartPrefixCutLabels.length)
      if (
        matrix.attempt.event._tag !== "TargetPromotionAttemptIntended" ||
        matrix.stale.event._tag !== "TargetPromotionStale" ||
        matrix.quarantine.event._tag !== "IntegrationQuarantined"
      ) {
        return yield* Effect.die("restart-prefix fixture event narrowing failed")
      }
      const attemptEvent = matrix.attempt.event
      const staleEvent = matrix.stale.event
      const plannedAttempt = attemptEvent.correlation.qualifiedCandidate.run.session.plannedAttempt

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

        yield* Effect.forEach(
          lanes,
          (lane) =>
            Effect.gen(function* () {
              const production = yield* productionRestartProjection(prefix, lane)
              expect(recoveryPrefixMismatch(prefix.cut, lane, expected, production.replay)).toBeUndefined()
              const before = exactAttemptTransitions(production.beforeAcquire, plannedAttempt.attemptId)
              const after = exactAttemptTransitions(production.afterAcquire, plannedAttempt.attemptId)
              assertNoSuccessorTransition(production.beforeAcquire)
              assertNoSuccessorTransition(production.afterAcquire)
              if (production.afterRecovery !== undefined) assertNoSuccessorTransition(production.afterRecovery)

              if (prefix.cut === "AttemptIntended") {
                expect(prefix.records.at(-1)).toEqual(matrix.attempt)
                expect(before.map(({ _tag }) => _tag)).toEqual(["AcquireStartedIntegrationTarget"])
                const reconciliations = after.filter(({ _tag }) => _tag === "ReconcileTargetPromotionAttempt")
                expect(reconciliations).toHaveLength(1)
                if (reconciliations[0]?._tag === "ReconcileTargetPromotionAttempt") {
                  expect(reconciliations[0].candidate).toEqual(attemptEvent.correlation.qualifiedCandidate)
                  expect(reconciliations[0].responsibility.plannedAttempt).toEqual(plannedAttempt)
                }
                expect(production.boundaryCalls).toEqual(["read"])
                expect(
                  production.records.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")
                ).toEqual(prefix.records.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended"))
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
                    observedHeadSha: staleEvent.observation.observedHeadSha
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
                    correlation: staleEvent.correlation,
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
              }
            }),
          { concurrency: "unbounded" }
        )
      }

      const attemptPrefix = exactlyOne(
        matrix.prefixes.filter(({ cut }) => cut === "AttemptIntended"),
        "attempt-intended recovery prefix"
      )
      yield* Effect.forEach(
        ["ExpectedHead", "Unreadable"] as const,
        (mode) =>
          Effect.forEach(
            lanes,
            (lane) =>
              Effect.gen(function* () {
                const production = yield* productionRestartProjection(attemptPrefix, lane, mode)
                expect(
                  recoveryPrefixMismatch(
                    attemptPrefix.cut,
                    lane,
                    yield* expectedRecoveryPrefix(attemptPrefix),
                    production.replay
                  )
                ).toBeUndefined()
                expect(production.boundaryCalls).toEqual(["read"])
                const deferred = exactlyOne(
                  production.records.filter(({ event }) => event._tag === "TargetPromotionReconciliationDeferred"),
                  mode + " / " + lane + " durable reconciliation deferral"
                )
                if (deferred.event._tag !== "TargetPromotionReconciliationDeferred") {
                  return yield* Effect.die("reconciliation deferral narrowing failed")
                }
                expect(deferred.event).toMatchObject({
                  afterAttemptOrdinal: attemptEvent.attemptOrdinal,
                  correlation: attemptEvent.correlation,
                  deferral: { _tag: mode === "Unreadable" ? "TargetReadFailed" : "RetryAuthorityRequired" }
                })
                const stable = production.afterRecovery ?? expect.fail(mode + " recovery projection missing")
                expect(
                  exactAttemptTransitions(stable, plannedAttempt.attemptId).filter(({ _tag }) =>
                    ["AcquireStartedIntegrationTarget", "ReconcileTargetPromotionAttempt"].includes(_tag)
                  )
                ).toEqual([])
                assertNoSuccessorTransition(stable)
                expect(production.records.at(-1)?.event._tag).toBe("TaskTrackerReadIntentRecorded")
              }),
            { concurrency: "unbounded" }
          ),
        { concurrency: 1 }
      )
    }),
  // One cached source run feeds three retained cuts plus two fail-closed
  // outcomes through memory and SQLite. The final body measured 9.63s isolated
  // and 24.14s in the affected aggregate; 120s doubles the observed 60.112s
  // shared-runner contention ceiling for this one store-heavy test.
  120_000
)

it.effect(
  "reconstructs only an exact attempt-backed promotion-stale quarantine through both restart stores",
  () =>
    Effect.gen(function* () {
      yield* Effect.forEach(
        ["Exact", "BeforeFirstAttempt", "ZeroAttempt", "DuplicateAttempt", "ForeignAttempt"] as const,
        (kind) =>
          Effect.gen(function* () {
            const stored = yield* storedPromotionStalePrefix(kind)
            yield* Effect.forEach(
              lanes,
              (lane) =>
                withRecoveryPrefixStore(stored.prefix, lane, (storage) =>
                  Effect.gen(function* () {
                    const began = stored.prefix.records[0]
                    const decoded = yield* storage.read(began.runId)
                    const state = deriveIntegrationQuarantineState(decoded, stored.sessionId)
                    expect(state._tag, kind + " / " + lane).toBe(kind === "Exact" ? "Quarantined" : "Contradiction")
                  })
                ),
              { concurrency: 1 }
            )
          }),
        { concurrency: 1 }
      )
    }),
  120_000
)

it.effect(
  "rejects a persisted non-H retry-authority deferral before Git through both restart stores",
  () =>
    Effect.gen(function* () {
      const matrix = restartPrefixesFrom(directPromotionRestartRecords())
      const attemptPrefix = exactlyOne(
        matrix.prefixes.filter(({ cut }) => cut === "AttemptIntended"),
        "direct malformed retry-authority attempt prefix"
      )
      const began = attemptPrefix.records[0]
      const attempt = attemptPrefix.records.at(-1)
      if (attempt?.event._tag !== "TargetPromotionAttemptIntended") {
        return yield* Effect.die("direct retry-authority store fixture did not retain its exact attempt")
      }
      const candidate = attempt.event.correlation.qualifiedCandidate
      const malformedHead = GitCommitSha.make("f".repeat(40))
      const malformed: JournalRecord = {
        event: TargetPromotionReconciliationDeferredEvent.make({
          afterAttemptOrdinal: attempt.event.attemptOrdinal,
          correlation: attempt.event.correlation,
          deferral: TargetPromotionReconciliationDeferral.cases.RetryAuthorityRequired.make({
            observedHeadSha: malformedHead
          }),
          version: workflowJournalEventVersion
        }),
        key: targetPromotionReconciliationDeferredRecordKey(
          attempt.event.correlation.requestId,
          attempt.event.attemptOrdinal
        ),
        position: JournalPosition.make(Number(attempt.position) + 1),
        runId: began.runId
      }
      const malformedPrefix: RecoveryPrefix<"MalformedRetryAuthority"> = {
        cut: "MalformedRetryAuthority",
        endpoint: "non-H TargetPromotionReconciliationDeferred",
        records: [began, ...attemptPrefix.records.slice(1), malformed]
      }

      yield* Effect.forEach(
        lanes,
        (lane) =>
          withRecoveryPrefixStore(malformedPrefix, lane, (storage) =>
            Effect.gen(function* () {
              const before = yield* storage.read(began.runId)
              const reduction = reduceWorkflowJournalHistory(began.runId, before)
              expect(reduction, lane).toMatchObject({
                _tag: "InvalidWorkflowJournalHistory",
                issues: expect.arrayContaining([
                  expect.objectContaining({ detail: expect.stringContaining("instead of exact expected head") })
                ])
              })
              if (reduction._tag === "InvalidWorkflowJournalHistory") expect(reduction.issues, lane).toHaveLength(1)
              const calls = yield* Ref.make<ReadonlyArray<string>>([])
              const git = TargetPromotionGit.of({
                compareAndSet: () =>
                  Ref.update(calls, (current) => [...current, "compare-and-set"]).pipe(
                    Effect.andThen(Effect.die("malformed durable history must not compare-and-set"))
                  ),
                read: () =>
                  Ref.update(calls, (current) => [...current, "read"]).pipe(
                    Effect.andThen(Effect.die("malformed durable history must not read Git"))
                  )
              })
              const journal = InRunJournal.of({ append: storage.append, read: storage.read })
              const failure = yield* Effect.flip(
                runTargetPromotion(candidate).pipe(
                  Effect.provideService(InRunJournal, journal),
                  Effect.provideService(TargetPromotionGit, git)
                )
              )
              expect(failure, lane).toBeInstanceOf(TargetPromotionHistoryContradiction)
              expect(yield* Ref.get(calls), lane).toEqual([])
              expect(yield* storage.read(began.runId), lane).toEqual(before)
            })
          ),
        { concurrency: 1 }
      )
    }),
  120_000
)
