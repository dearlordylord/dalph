import { it } from "@effect/vitest"
import { GitCommitSha, RunId, makeTaskWorkSpecification } from "@dalph/contracts"
import { Context, Effect, Layer, Ref, Schema, Stream } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { StartedIntegrationResponsibility } from "../integration-admission/protocol.js"
import { RunnableFrontierTransition } from "../../../coordination/frontier/frontier.js"
import { deliveryProposalsOf } from "../../../coordination/delivery/delivery-proposal.js"
import { executeIntegrationAction } from "../../../coordination/delivery/integration-delivery-action-adapter.js"
import type { DeliveryActionExecutionLease } from "../../../coordination/delivery/delivery-action-executor.js"
import type {
  DeliveryActionProposal,
  IdentityFreeDeliveryProposal
} from "../../../coordination/delivery/delivery-action-proposal.js"
import { Integrator } from "../integrator/protocol.js"
import { evaluateIntegratorRetryAuthorization } from "../integrator/retry-authorization.js"
import {
  integrationProviderRunActivityAbsentRecordKey,
  integrationQuarantinedRecordKey,
  integrationQuarantineDirectionAppliedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  intentRecordKey,
  outcomeRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalPosition } from "../../../workflow-journal/identity.js"
import type { JournalRecord } from "../../../workflow-journal/store.js"
import { InRunJournal, JournalStoreContradiction } from "../../../workflow-journal/store.js"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import { liveJournalTestLayer } from "../../../coordination/delivery/live-journal-test-layer.js"
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
import { makeAcceptedIntegrationHistory } from "../../../../test/support/accepted-integration-history.js"

const baseSession = integrationFinalityFixture.qualifiedCandidate.run.session
const target = FixtureTarget.make("changed-head-retry-target")
const fixedHead = baseSession.expectedTargetHead
const changedHead = GitCommitSha.make("4".repeat(40))

type Scenario = {
  readonly acceptedJournalReader: AcceptedJournalReader["Service"]
  readonly directionRecord: JournalRecord
  readonly fixedSession: JournalRecord
  readonly journal: InRunJournal["Service"]
  readonly lineage: JournalRecord
  readonly prior: JournalRecord
  readonly runId: RunId
  readonly session: IntegratorSessionCorrelation
}

const sessionFor = (
  suffix: string,
  accepted: ReturnType<typeof makeAcceptedIntegrationHistory>
): IntegratorSessionCorrelation =>
  IntegratorSessionCorrelation.make({
    ...baseSession,
    acceptedResult: accepted.responsibility.acceptedResult,
    integrationTarget: accepted.responsibility.integrationTarget,
    plannedAttempt: accepted.responsibility.plannedAttempt,
    queuedAt: accepted.responsibility.queuedAt,
    sessionId: IntegratorSessionId.make(`${baseSession.sessionId}-${suffix}`),
    startedAt: accepted.responsibility.startedAt,
    targetLineageObservedAt: accepted.targetLineageObservedAt
  })

const lineageOperationFor = (session: IntegratorSessionCorrelation, suffix: string) =>
  makeTargetLineageObservationOperation({
    integrationTarget: session.integrationTarget,
    operationId: OperationId.make(`changed-head-retry-lineage:${suffix}`),
    plannedAttempt: session.plannedAttempt,
    predecessorOperationIds: []
  })

const appendLineage = Effect.fn("ChangedHeadRetryTest.appendLineage")(function* (
  journal: InRunJournal["Service"],
  session: IntegratorSessionCorrelation,
  head: GitCommitSha,
  suffix: string
) {
  const operation = lineageOperationFor(session, suffix)
  yield* journal.append(
    session.plannedAttempt.runId,
    intentRecordKey(operation.operationId),
    GitReadIntentRecordedEvent.make({
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      operation,
      version: workflowJournalEventVersion
    })
  )
  return yield* journal.append(
    session.plannedAttempt.runId,
    outcomeRecordKey(operation.operationId),
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
  freshHead: GitCommitSha = changedHead
) {
  const scenarioRunId = RunId.make(`changed-head-retry-run:${suffix}`)
  const taskSpecification = makeTaskWorkSpecification({
    body: `Exercise changed-head Retry quarantine ${suffix}.`,
    taskId: baseSession.plannedAttempt.taskId,
    title: `Changed-head Retry ${suffix}`
  })
  const plannedAttempt = {
    ...baseSession.plannedAttempt,
    runId: scenarioRunId,
    taskRevision: taskSpecification.fingerprint
  }
  const accepted = makeAcceptedIntegrationHistory({
    acceptedResult: baseSession.acceptedResult,
    activeClaim: ActiveTaskClaim.make({
      ...integrationFinalityFixture.activeClaim,
      operationId: OperationId.make(`changed-head-retry-claim:${suffix}`)
    }),
    integrationTarget: baseSession.integrationTarget,
    initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
    plannedAttempt,
    runId: scenarioRunId,
    targetHeadSha: fixedHead,
    taskSpecification,
    trackerTarget: target
  })
  const session = sessionFor(suffix, accepted)
  const live = yield* Layer.build(liveJournalTestLayer({ records: accepted.records, runId: scenarioRunId, target }))
  const journal = Context.get(live, InRunJournal)
  const fixedSession = yield* journal.append(
    scenarioRunId,
    integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(session)),
    IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion })
  )
  const absenceDetail = IntegrationQuarantineFailureDetail.make(`provider activity absent: ${suffix}`)
  const run = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session })
  yield* journal.append(
    scenarioRunId,
    integratorRunStartedRecordKey(run),
    IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
  )
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
  return {
    acceptedJournalReader: Context.get(live, AcceptedJournalReader),
    directionRecord,
    fixedSession,
    journal: Context.get(live, InRunJournal),
    lineage,
    prior,
    runId: scenarioRunId,
    session
  } satisfies Scenario
})

const provideScenario =
  (scenario: Scenario) =>
  <A, E, R>(effect: Effect.Effect<A, E, R | AcceptedJournalReader | InRunJournal>) =>
    effect.pipe(
      Effect.provideService(InRunJournal, scenario.journal),
      Effect.provideService(AcceptedJournalReader, scenario.acceptedJournalReader)
    )

const isIdentityFreeDeliveryProposal = (proposal: DeliveryActionProposal): proposal is IdentityFreeDeliveryProposal =>
  proposal.actionIdentity._tag === "NoWorkflowOperationIdentity"

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
    const first = yield* appendChangedHeadRetryQuarantine(input).pipe(provideScenario(scenario))
    const second = yield* appendChangedHeadRetryQuarantine(input).pipe(provideScenario(scenario))
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
  })
)

it.effect("rejects an idempotent replay whose complete lineage facts do not match L", () =>
  Effect.gen(function* () {
    const scenario = yield* appendScenario("invalid-replay")
    const input = inputFor(scenario)
    const first = yield* appendChangedHeadRetryQuarantine(input).pipe(provideScenario(scenario))

    const foreignBase = yield* appendChangedHeadRetryQuarantine({
      ...input,
      targetLineage: { ...input.targetLineage, plannedBaseSha: GitCommitSha.make("5".repeat(40)) }
    }).pipe(provideScenario(scenario), Effect.flip)
    const foreignAncestry = yield* appendChangedHeadRetryQuarantine({
      ...input,
      targetLineage: { ...input.targetLineage, plannedBaseIsAncestorOfTargetHead: false }
    }).pipe(provideScenario(scenario), Effect.flip)

    expect(foreignBase).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)
    expect(foreignAncestry).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)
    expect(
      (yield* scenario.journal.read(scenario.runId)).filter(
        ({ event }) => event._tag === "IntegrationQuarantined" && event.basis._tag === "RetryTargetHeadChanged"
      )
    ).toEqual([first])
  })
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
    if (candidate === undefined || !isIdentityFreeDeliveryProposal(candidate)) {
      return yield* Effect.die("expected one identity-free changed-head disposition proposal")
    }
    const proposal = candidate

    const releases = yield* Ref.make(0)
    const integratorCalls = yield* Ref.make(0)
    const lease: DeliveryActionExecutionLease = {
      acceptIntegrationTargetOwnership: Effect.void,
      bindPlannedAttemptPosition: () => Effect.void,
      forwardBoundary: { _tag: "AtomicBoundary", execution: { run: (effect) => effect } },
      integrationTargets: {
        acquire: () => Effect.void,
        changes: Stream.empty,
        isActive: () => Effect.succeed(false),
        isHeld: () => Effect.succeed(false),
        publishAcceptedOwnership: () => Effect.void,
        release: () => Ref.update(releases, (count) => count + 1),
        releaseAll: Effect.void,
        snapshot: Effect.succeed({ activeResponsibilities: [], heldResponsibilities: [] }),
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
    expect(yield* run.pipe(provideScenario(scenario))).toMatchObject({
      _tag: "ActionCompleted",
      proposalId: proposal.id
    })
    expect(yield* run.pipe(provideScenario(scenario))).toMatchObject({
      _tag: "ActionCompleted",
      proposalId: proposal.id
    })
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
        provideScenario(scenario),
        Effect.flip
      )
    ).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)
    expect(yield* Ref.get(releases)).toBe(2)
  })
)

it.effect("rejects unchanged, foreign, and FullRerun evidence without appending", () =>
  Effect.gen(function* () {
    const unchanged = yield* appendScenario("unchanged", "Retry", fixedHead)
    const unchangedFailure = yield* appendChangedHeadRetryQuarantine(inputFor(unchanged, fixedHead)).pipe(
      provideScenario(unchanged),
      Effect.flip
    )
    expect(unchangedFailure).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)

    const full = yield* appendScenario("full", "FullRerun")
    const fullFailure = yield* appendChangedHeadRetryQuarantine(inputFor(full)).pipe(provideScenario(full), Effect.flip)
    expect(fullFailure).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)

    const foreign = yield* appendScenario("foreign")
    const foreignFailure = yield* appendChangedHeadRetryQuarantine(
      inputFor({ ...foreign, directionRecord: foreign.lineage })
    ).pipe(provideScenario(foreign), Effect.flip)
    expect(foreignFailure).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)

    for (const scenario of [unchanged, full, foreign]) {
      expect(
        (yield* scenario.journal.read(scenario.runId)).filter(
          ({ event }) => event._tag === "IntegrationQuarantined" && event.basis._tag === "RetryTargetHeadChanged"
        )
      ).toHaveLength(0)
    }
  })
)

it.effect("keeps duplicate Retry directions on the explicit raw diagnostic boundary", () =>
  Effect.gen(function* () {
    const scenario = yield* appendScenario("duplicate")
    const records = yield* scenario.journal.read(scenario.runId)
    const duplicateEvent = IntegrationQuarantineDirectionAppliedEvent.make({
      fingerprint: IntegrationQuarantineDirectionFingerprint.make({
        direction: "FullRerun",
        quarantineAt: scenario.prior.position,
        sessionId: scenario.session.sessionId
      }),
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "duplicate:full", runId: scenario.runId }),
      version: workflowJournalEventVersion
    })
    const duplicateRecord: JournalRecord = {
      event: duplicateEvent,
      key: integrationQuarantineDirectionAppliedRecordKey(
        IntegrationQuarantineDirectionSubject.make({
          quarantineAt: scenario.prior.position,
          sessionId: scenario.session.sessionId
        })
      ),
      position: JournalPosition.make(records.length + 1),
      runId: scenario.runId
    }
    expect(
      evaluateIntegratorRetryAuthorization(
        [...records, duplicateRecord],
        IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(2), session: scenario.session }),
        { requiredTargetLineageObservedAt: scenario.lineage.position }
      )
    ).toMatchObject({ _tag: "Rejected", detail: "Retry authorization requires one exact Journal history for the Run" })
  })
)

it.effect("rejects a foreign target-lineage position and strict malformed input", () =>
  Effect.gen(function* () {
    const scenario = yield* appendScenario("lineage-foreign")
    const foreignPositionFailure = yield* appendChangedHeadRetryQuarantine(
      inputFor({ ...scenario, lineage: scenario.fixedSession }, changedHead)
    ).pipe(provideScenario(scenario), Effect.flip)
    expect(foreignPositionFailure).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)
    const malformedFailure = yield* appendChangedHeadRetryQuarantine({ ...inputFor(scenario), unexpected: true }).pipe(
      provideScenario(scenario),
      Effect.flip
    )
    expect(malformedFailure).toBeInstanceOf(Schema.SchemaError)
  })
)

it.effect("rejects missing run-start evidence", () =>
  Effect.gen(function* () {
    const missingStart = yield* appendScenario("missing-start")
    const missingStartFailure = yield* appendChangedHeadRetryQuarantine({
      ...inputFor(missingStart),
      session: IntegratorSessionCorrelation.make({
        ...missingStart.session,
        startedAt: JournalPosition.make(Number(missingStart.session.startedAt) + 10_000)
      })
    }).pipe(provideScenario(missingStart), Effect.flip)
    expect(missingStartFailure).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)

    expect(
      (yield* missingStart.journal.read(missingStart.runId)).filter(
        ({ event }) => event._tag === "IntegrationQuarantined" && event.basis._tag === "RetryTargetHeadChanged"
      )
    ).toHaveLength(0)
  })
)

it.effect("recovers the durable ambiguous Q2 winner and rejects missing or returned foreign winners", () =>
  Effect.gen(function* () {
    const scenario = yield* appendScenario("ambiguous-append")
    const records = yield* scenario.journal.read(scenario.runId)
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
      Effect.provideService(AcceptedJournalReader, scenario.acceptedJournalReader),
      Effect.flip
    )
    expect(missingWinner).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)

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
      Effect.provideService(AcceptedJournalReader, scenario.acceptedJournalReader),
      Effect.flip
    )
    expect(returnedForeign).toBeInstanceOf(IntegrationChangedHeadRetryQuarantineRejected)

    const reconciledJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key, event) =>
        Effect.gen(function* () {
          const winner = yield* scenario.journal.append(requestedRunId, key, event)
          return yield* new JournalStoreContradiction({ existingPosition: winner.position, key, runId: requestedRunId })
        }),
      read: () => Effect.die("live changed-head recovery must use accepted indexed evidence")
    }
    const reconciled = yield* appendChangedHeadRetryQuarantine(inputFor(scenario)).pipe(
      Effect.provideService(InRunJournal, reconciledJournal),
      Effect.provideService(AcceptedJournalReader, scenario.acceptedJournalReader)
    )
    expect(reconciled.event._tag).toBe("IntegrationQuarantined")
  })
)
