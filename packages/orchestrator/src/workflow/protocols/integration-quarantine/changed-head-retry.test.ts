import { it } from "@effect/vitest"
import { GitCommitSha, RunId } from "@dalph/contracts"
import { Effect, Ref, Schema, Stream } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import { RunnableFrontierTransition } from "../../../coordination/frontier/frontier.js"
import { deliveryProposalsOf } from "../../../coordination/delivery/delivery-proposal.js"
import { executeIntegrationAction } from "../../../coordination/delivery/integration-delivery-action-adapter.js"
import type { DeliveryActionExecutionLease } from "../../../coordination/delivery/delivery-action-executor.js"
import type { IdentityFreeDeliveryProposal } from "../../../coordination/delivery/delivery-action-proposal.js"
import { Integrator } from "../integrator/protocol.js"
import { evaluateIntegratorRetryAuthorization } from "../integrator/retry-authorization.js"
import {
  integrationProviderRunActivityAbsentRecordKey,
  integrationQuarantinedRecordKey,
  integrationQuarantineDirectionAppliedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import type { JournalRecord, JournalStoreService } from "../../../workflow-journal/store.js"
import { InRunJournal, JournalStore, JournalStoreContradiction } from "../../../workflow-journal/store.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { OperationId } from "../../identity.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../registry/event.js"
import { makeTargetLineageObservationOperation } from "../../registry/operation.js"
import {
  IntegratorSessionCorrelation,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunStartedEvent,
  IntegratorSessionId,
  IntegratorSessionFixedEvent
} from "../integrator/events.js"
import { integratorResponsibilityFactsFromCorrelation } from "../integrator/state.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineDirectionSubject,
  IntegrationQuarantineFailureDetail,
  IntegrationProviderRunActivityAbsentEvent,
  IntegrationQuarantinedEvent
} from "./events.js"
import {
  appendChangedHeadRetryQuarantine,
  ChangedHeadRetryQuarantineInput,
  IntegrationChangedHeadRetryQuarantineRejected
} from "./changed-head-retry.js"

const baseSession = integrationFinalityFixture.qualifiedCandidate.run.session
const target = FixtureTarget.make("changed-head-retry-target")
const fixedHead = baseSession.expectedTargetHead
const changedHead = GitCommitSha.make("4".repeat(40))

type Scenario = {
  readonly directionRecord: JournalRecord
  readonly fixedSession: JournalRecord
  readonly journal: JournalStoreService
  readonly lineage: JournalRecord
  readonly prior: JournalRecord
  readonly runId: RunId
  readonly session: IntegratorSessionCorrelation
}

const sessionFor = (suffix: string): IntegratorSessionCorrelation =>
  IntegratorSessionCorrelation.make({
    ...baseSession,
    plannedAttempt: { ...baseSession.plannedAttempt, runId: RunId.make(`changed-head-retry-run:${suffix}`) },
    queuedAt: JournalPosition.make(5),
    sessionId: IntegratorSessionId.make(`${baseSession.sessionId}-${suffix}`),
    startedAt: JournalPosition.make(5),
    targetLineageObservedAt: JournalPosition.make(3)
  })

const lineageOperationFor = (session: IntegratorSessionCorrelation, suffix: string) =>
  makeTargetLineageObservationOperation({
    integrationTarget: session.integrationTarget,
    operationId: OperationId.make(`changed-head-retry-lineage:${suffix}`),
    plannedAttempt: session.plannedAttempt,
    predecessorOperationIds: []
  })

const appendLineage = Effect.fn("ChangedHeadRetryTest.appendLineage")(function* (
  journal: JournalStoreService,
  session: IntegratorSessionCorrelation,
  head: GitCommitSha,
  suffix: string
) {
  const operation = lineageOperationFor(session, suffix)
  yield* journal.append(
    session.plannedAttempt.runId,
    JournalRecordKey.make(`changed-head-retry:${suffix}:intent`),
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation,
      version: workflowJournalEventVersion
    })
  )
  return yield* journal.append(
    session.plannedAttempt.runId,
    JournalRecordKey.make(`changed-head-retry:${suffix}:observed`),
    TargetLineageObservedEvent.make({
      observation: {
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: session.plannedAttempt.baseSha,
        targetHeadSha: head
      },
      occurrenceClassification: "NonActionOccurrence",
      operationId: operation.operationId,
      plannedAttempt: session.plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
})

const appendScenario = Effect.fn("ChangedHeadRetryTest.appendScenario")(function* (
  suffix: string,
  direction: "Retry" | "FullRerun" = "Retry",
  freshHead: GitCommitSha = changedHead,
  includeRunStart = true
) {
  const journal = yield* JournalStore
  const session = sessionFor(suffix)
  const scenarioRunId = session.plannedAttempt.runId
  yield* journal.beginRun(
    scenarioRunId,
    target,
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
  )
  yield* appendLineage(journal, session, fixedHead, `${suffix}:fixed`)
  const fixedSession = yield* journal.append(
    scenarioRunId,
    integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(session)),
    IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion })
  )
  const absenceDetail = IntegrationQuarantineFailureDetail.make(`provider activity absent: ${suffix}`)
  const run = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session })
  if (includeRunStart) {
    yield* journal.append(
      scenarioRunId,
      integratorRunStartedRecordKey(run),
      IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
    )
  }
  const priorBasis = yield* Effect.gen(function* () {
    const absence = yield* journal.append(
      scenarioRunId,
      integrationProviderRunActivityAbsentRecordKey(run),
      IntegrationProviderRunActivityAbsentEvent.make({
        correlation: session,
        detail: absenceDetail,
        occurrenceClassification: "NonActionOccurrence",
        run,
        version: workflowJournalEventVersion
      })
    )
    return IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
      detail: absenceDetail,
      ownedActivityProvenAbsentAt: absence.position
    })
  })
  const prior = yield* journal.append(
    scenarioRunId,
    integrationQuarantinedRecordKey(session.sessionId, priorBasis),
    IntegrationQuarantinedEvent.make({
      basis: priorBasis,
      correlation: session,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
  )
  const directionFingerprint = IntegrationQuarantineDirectionFingerprint.make({
    direction,
    quarantineAt: prior.position,
    sessionId: session.sessionId
  })
  const directionRecord = yield* journal.append(
    scenarioRunId,
    integrationQuarantineDirectionAppliedRecordKey(
      IntegrationQuarantineDirectionSubject.make({ quarantineAt: prior.position, sessionId: session.sessionId })
    ),
    IntegrationQuarantineDirectionAppliedEvent.make({
      fingerprint: directionFingerprint,
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: `${suffix}:direction`, runId: scenarioRunId }),
      version: workflowJournalEventVersion
    })
  )
  const lineage = yield* appendLineage(journal, session, freshHead, `${suffix}:fresh`)
  return { directionRecord, fixedSession, journal, lineage, prior, runId: scenarioRunId, session } satisfies Scenario
})

const inputFor = (scenario: Scenario, targetHead: GitCommitSha = changedHead): ChangedHeadRetryQuarantineInput =>
  ChangedHeadRetryQuarantineInput.make({
    directionAppliedAt: scenario.directionRecord.position,
    priorQuarantineAt: scenario.prior.position,
    session: scenario.session,
    targetLineage: {
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: scenario.session.plannedAttempt.baseSha,
      targetHeadSha: targetHead
    },
    targetLineageObservedAt: scenario.lineage.position
  })

it.effect("starts no retry when the session target head has changed", () =>
  Effect.gen(function* () {
    const scenario = yield* appendScenario("changed")
    const input = inputFor(scenario)
    const first = yield* appendChangedHeadRetryQuarantine(input)
    const second = yield* appendChangedHeadRetryQuarantine(input)
    expect(second).toEqual(first)
    expect(first.event.basis).toEqual({
      _tag: "RetryTargetHeadChanged",
      direction: "Retry",
      directionAppliedAt: scenario.directionRecord.position,
      observedTargetHead: changedHead,
      priorQuarantineAt: scenario.prior.position,
      targetLineageObservedAt: scenario.lineage.position
    })
    expect(
      (yield* scenario.journal.read(scenario.runId)).filter(({ event }) => event._tag === "IntegrationQuarantined")
    ).toHaveLength(2)

    const returnedLineage = yield* appendLineage(scenario.journal, scenario.session, fixedHead, "changed:returned")
    const laterAuthorization = evaluateIntegratorRetryAuthorization(
      yield* scenario.journal.read(scenario.runId),
      IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(2), session: scenario.session }),
      { requiredTargetLineageObservedAt: returnedLineage.position }
    )
    expect(laterAuthorization).toMatchObject({
      _tag: "Rejected",
      detail: "Retry authorization was terminated by a changed-head quarantine"
    })
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects an idempotent replay whose complete lineage facts do not match L", () =>
  Effect.gen(function* () {
    const scenario = yield* appendScenario("invalid-replay")
    const input = inputFor(scenario)
    const first = yield* appendChangedHeadRetryQuarantine(input)

    const foreignBase = yield* appendChangedHeadRetryQuarantine({
      ...input,
      targetLineage: { ...input.targetLineage, plannedBaseSha: GitCommitSha.make("5".repeat(40)) }
    }).pipe(Effect.flip)
    const foreignAncestry = yield* appendChangedHeadRetryQuarantine({
      ...input,
      targetLineage: { ...input.targetLineage, plannedBaseIsAncestorOfTargetHead: false }
    }).pipe(Effect.flip)

    expect(foreignBase).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)
    expect(foreignAncestry).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)
    expect(
      (yield* scenario.journal.read(scenario.runId)).filter(
        ({ event }) => event._tag === "IntegrationQuarantined" && event.basis._tag === "RetryTargetHeadChanged"
      )
    ).toEqual([first])
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("routes changed-head Retry through delivery once, releases ownership, and never calls Integrator", () =>
  Effect.gen(function* () {
    const scenario = yield* appendScenario("delivery-route")
    const responsibility = StartedIntegrationResponsibility.make({
      acceptedResult: scenario.session.acceptedResult,
      integrationTarget: scenario.session.integrationTarget,
      plannedAttempt: scenario.session.plannedAttempt,
      queuedAt: scenario.session.queuedAt,
      startedAt: scenario.session.startedAt
    })
    const transition = RunnableFrontierTransition.RecordChangedHeadRetryQuarantine({
      request: inputFor(scenario),
      responsibility
    })
    const contributions = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: [],
      integrationResponsibilities: [responsibility],
      runId: scenario.runId,
      transitions: [transition]
    })
    const candidate = [...contributions.ticketDelivery, ...contributions.deliverySettlement][0]
    if (candidate === undefined || candidate.actionIdentity._tag !== "NoWorkflowOperationIdentity") {
      return yield* Effect.die("expected one identity-free changed-head disposition proposal")
    }
    const proposal = candidate as IdentityFreeDeliveryProposal

    const releases = yield* Ref.make(0)
    const integratorCalls = yield* Ref.make(0)
    const lease: DeliveryActionExecutionLease = {
      acceptIntegrationTargetOwnership: Effect.void,
      bindPlannedAttemptPosition: () => Effect.void,
      forwardBoundary: { _tag: "AtomicBoundary", execution: { run: (effect) => effect } },
      integrationTargets: {
        acquire: () => Effect.void,
        changes: Stream.empty,
        publishAcceptedOwnership: () => Effect.void,
        release: () => Ref.update(releases, (count) => count + 1),
        releaseAll: Effect.void,
        snapshot: Effect.succeed({ activeResponsibilityPositions: new Set(), heldResponsibilityPositions: new Set() }),
        withPermit: (_responsibility, effect) => effect
      },
      recordIntent: () => Effect.void,
      releasePlannedAttemptPosition: () => Effect.void,
      withPlannedAttemptProtocol: () => Effect.die("unused planned-attempt protocol lease")
    }
    const action = { _tag: "IdentityFreeAction" as const, proposal }
    const run = executeIntegrationAction(action, transition, lease, target).pipe(
      Effect.provideService(
        Integrator,
        Integrator.of({
          prepare: () =>
            Ref.update(integratorCalls, (count) => count + 1).pipe(
              Effect.andThen(Effect.die("unexpected Integrator call"))
            )
        })
      )
    )
    expect(yield* run).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
    expect(yield* run).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
    expect(yield* Ref.get(releases)).toBe(2)
    expect(yield* Ref.get(integratorCalls)).toBe(0)
    expect(
      (yield* scenario.journal.read(scenario.runId)).filter(({ event }) => event._tag === "IntegrationQuarantined")
    ).toHaveLength(2)

    const rejectedTransition = RunnableFrontierTransition.RecordChangedHeadRetryQuarantine({
      request: ChangedHeadRetryQuarantineInput.make({
        ...transition.request,
        directionAppliedAt: scenario.lineage.position
      }),
      responsibility
    })
    expect(
      yield* executeIntegrationAction(action, rejectedTransition, lease, target).pipe(
        Effect.provideService(Integrator, Integrator.of({ prepare: () => Effect.die("unexpected Integrator call") })),
        Effect.flip
      )
    ).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)
    expect(yield* Ref.get(releases)).toBe(2)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects unchanged, foreign, FullRerun, and duplicate Retry evidence without appending", () =>
  Effect.gen(function* () {
    const unchanged = yield* appendScenario("unchanged", "Retry", fixedHead)
    const unchangedFailure = yield* appendChangedHeadRetryQuarantine(inputFor(unchanged, fixedHead)).pipe(Effect.flip)
    expect(unchangedFailure).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)

    const full = yield* appendScenario("full", "FullRerun")
    const fullFailure = yield* appendChangedHeadRetryQuarantine(inputFor(full)).pipe(Effect.flip)
    expect(fullFailure).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)

    const foreign = yield* appendScenario("foreign")
    const foreignFailure = yield* appendChangedHeadRetryQuarantine(
      inputFor({ ...foreign, directionRecord: foreign.lineage })
    ).pipe(Effect.flip)
    expect(foreignFailure).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)

    const duplicate = yield* appendScenario("duplicate")
    yield* duplicate.journal.append(
      duplicate.runId,
      JournalRecordKey.make("changed-head-retry:duplicate:second-direction"),
      IntegrationQuarantineDirectionAppliedEvent.make({
        fingerprint: IntegrationQuarantineDirectionFingerprint.make({
          direction: "FullRerun",
          quarantineAt: duplicate.prior.position,
          sessionId: duplicate.session.sessionId
        }),
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "duplicate:full", runId: duplicate.runId }),
        version: workflowJournalEventVersion
      })
    )
    const duplicateFailure = yield* appendChangedHeadRetryQuarantine(inputFor(duplicate)).pipe(Effect.flip)
    expect(duplicateFailure).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)

    for (const scenario of [unchanged, full, foreign, duplicate]) {
      expect(
        (yield* scenario.journal.read(scenario.runId)).filter(
          ({ event }) => event._tag === "IntegrationQuarantined" && event.basis._tag === "RetryTargetHeadChanged"
        )
      ).toHaveLength(0)
    }
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a foreign target-lineage position and strict malformed input", () =>
  Effect.gen(function* () {
    const scenario = yield* appendScenario("lineage-foreign")
    const foreignPositionFailure = yield* appendChangedHeadRetryQuarantine(
      inputFor({ ...scenario, lineage: scenario.fixedSession }, changedHead)
    ).pipe(Effect.flip)
    expect(foreignPositionFailure).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)
    const malformedFailure = yield* appendChangedHeadRetryQuarantine({ ...inputFor(scenario), unexpected: true }).pipe(
      Effect.flip
    )
    expect(malformedFailure).toBeInstanceOf(Schema.SchemaError)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects missing run-start evidence", () =>
  Effect.gen(function* () {
    const missingStart = yield* appendScenario("missing-start", "Retry", changedHead, false)
    const missingStartFailure = yield* appendChangedHeadRetryQuarantine(inputFor(missingStart)).pipe(Effect.flip)
    expect(missingStartFailure).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)

    expect(
      (yield* missingStart.journal.read(missingStart.runId)).filter(
        ({ event }) => event._tag === "IntegrationQuarantined" && event.basis._tag === "RetryTargetHeadChanged"
      )
    ).toHaveLength(0)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("reconciles ambiguous Q2 appends and rejects every foreign winner", () =>
  Effect.gen(function* () {
    const scenario = yield* appendScenario("ambiguous-append")
    const records = yield* scenario.journal.read(scenario.runId)
    const expected = yield* appendChangedHeadRetryQuarantine(inputFor(scenario))
    const foreignExisting = {
      ...scenario.fixedSession,
      key: expected.key,
      position: JournalPosition.make(records.length + 1)
    }
    const existingForeign = yield* appendChangedHeadRetryQuarantine(inputFor(scenario)).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: () => Effect.die("a foreign exact-key record must be rejected before append"),
          read: () => Effect.succeed([...records, foreignExisting])
        })
      ),
      Effect.flip
    )
    expect(existingForeign).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)

    let reconciledWinner: JournalRecord | undefined
    const reconciledJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key, event) => {
        reconciledWinner = { event, key, position: JournalPosition.make(records.length + 1), runId: requestedRunId }
        return Effect.fail(
          new JournalStoreContradiction({ existingPosition: reconciledWinner.position, key, runId: requestedRunId })
        )
      },
      read: () =>
        reconciledWinner === undefined ? Effect.succeed(records) : Effect.succeed([...records, reconciledWinner])
    }
    const reconciled = yield* appendChangedHeadRetryQuarantine(inputFor(scenario)).pipe(
      Effect.provideService(InRunJournal, reconciledJournal)
    )
    expect(reconciled.event._tag).toBe("IntegrationQuarantined")

    const missingWinnerJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key) =>
        Effect.fail(
          new JournalStoreContradiction({
            existingPosition: JournalPosition.make(records.length + 5),
            key,
            runId: requestedRunId
          })
        ),
      read: () => Effect.succeed(records)
    }
    const missingWinner = yield* appendChangedHeadRetryQuarantine(inputFor(scenario)).pipe(
      Effect.provideService(InRunJournal, missingWinnerJournal),
      Effect.flip
    )
    expect(missingWinner).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)

    const foreignWinner = {
      ...scenario.fixedSession,
      key: JournalRecordKey.make("changed-head-retry:foreign-winner"),
      position: JournalPosition.make(records.length + 1)
    }
    const foreignWinnerJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key) =>
        Effect.fail(
          new JournalStoreContradiction({ existingPosition: foreignWinner.position, key, runId: requestedRunId })
        ),
      read: () => Effect.succeed([...records, foreignWinner])
    }
    const foreignWinnerFailure = yield* appendChangedHeadRetryQuarantine(inputFor(scenario)).pipe(
      Effect.provideService(InRunJournal, foreignWinnerJournal),
      Effect.flip
    )
    expect(foreignWinnerFailure).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)

    const returnedForeignJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key) =>
        Effect.succeed({
          ...scenario.fixedSession,
          key,
          position: JournalPosition.make(records.length + 1),
          runId: requestedRunId
        }),
      read: () => Effect.succeed(records)
    }
    const returnedForeign = yield* appendChangedHeadRetryQuarantine(inputFor(scenario)).pipe(
      Effect.provideService(InRunJournal, returnedForeignJournal),
      Effect.flip
    )
    expect(returnedForeign).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)
