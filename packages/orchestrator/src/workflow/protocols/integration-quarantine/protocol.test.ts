import { it } from "@effect/vitest"
import { GitCommitSha, RunId } from "@dalph/contracts"
import { Effect, Layer, Schema } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import {
  integrationQuarantineDirectionAppliedRecordKey,
  integrationQuarantinedRecordKey,
  integratorRunCandidateGitObservedRecordKey,
  integratorRunResultRecordedRecordKey,
  integrationProviderRunActivityAbsentRecordKey,
  integratorSessionFixedRecordKey,
  integratorRunStartedRecordKey
} from "../../../workflow-journal/record-key.js"
import {
  type InRunJournal,
  JournalStore,
  JournalStoreContradiction,
  type JournalRecord
} from "../../../workflow-journal/store.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { OperationId } from "../../identity.js"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { TargetLineageObservedEvent } from "../../registry/event.js"
import {
  deriveIntegrationQuarantineState,
  isIntegrationQuarantineEvent,
  quarantineRecordForFingerprint
} from "./state.js"
import {
  ApplyIntegrationQuarantineDirectionRequest,
  IntegrationQuarantineBasis,
  IntegrationQuarantineCause,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineDirectionSubject,
  IntegrationQuarantineFailureDetail,
  IntegrationQuarantineResultEvidence,
  IntegrationQuarantinedEvent,
  IntegrationProviderRunActivityAbsentEvent
} from "./events.js"
import {
  IntegratorCandidateText,
  IntegratorSessionCorrelation,
  IntegratorGitObservation,
  IntegratorNotPreparedDetail,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionFixedEvent,
  IntegratorResult,
  IntegratorSessionId
} from "../integrator/events.js"
import { integratorResponsibilityFactsFromCorrelation } from "../integrator/state.js"
import {
  IntegrationQuarantineDirectionAlreadyApplied,
  IntegrationQuarantineDirectionControl,
  IntegrationQuarantineDirectionNotAvailable,
  IntegrationQuarantineDirectionRequestIdentityContradiction,
  IntegrationQuarantineDirectionRequestRunMismatch,
  IntegrationQuarantineDirectionResultNotFound,
  makeIntegrationQuarantineDirectionControl,
  integrationQuarantineDirectionControlLayer
} from "./control.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"

const runId = integrationFinalityFixture.runId
const target = FixtureTarget.make("integration-quarantine-target")
const baseCorrelation = integrationFinalityFixture.qualifiedCandidate.run.session

const correlationFor = (suffix: string) =>
  IntegratorSessionCorrelation.make({
    ...baseCorrelation,
    queuedAt: JournalPosition.make(2),
    sessionId: IntegratorSessionId.make(`integration-quarantine-session-${suffix}`),
    startedAt: JournalPosition.make(3),
    targetLineageObservedAt: JournalPosition.make(2)
  })

const conclusiveBasisFor = (
  cause: IntegrationQuarantineCause,
  resultRecordedAt = JournalPosition.make(4),
  candidateObservationAt?: JournalPosition
) =>
  IntegrationQuarantineBasis.cases.ConclusiveResult.make({
    cause,
    evidence: IntegrationQuarantineResultEvidence.make({
      ...(candidateObservationAt === undefined ? {} : { candidateObservationAt }),
      resultRecordedAt
    })
  })

const quarantineEventFor = (
  suffix: string,
  basis: IntegrationQuarantineBasis = conclusiveBasisFor(
    IntegrationQuarantineCause.cases.NotPrepared.make({
      detail: IntegratorNotPreparedDetail.make("the outer Integrator reached a conclusive no-candidate result")
    })
  )
) =>
  IntegrationQuarantinedEvent.make({
    basis,
    correlation: correlationFor(suffix),
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })

const appendQuarantine = Effect.fn("IntegrationQuarantineTest.appendQuarantine")(function* (
  suffix: string,
  event = quarantineEventFor(suffix)
) {
  const journal = yield* JournalStore
  yield* journal.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }))
  if (event.basis._tag === "ConclusiveResult") {
    const correlation = event.correlation
    const run = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: correlation })
    yield* journal.append(
      runId,
      JournalRecordKey.make(`integration-quarantine-test:conclusive-lineage:${correlation.sessionId}`),
      TargetLineageObservedEvent.make({
        observation: TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: correlation.plannedAttempt.baseSha,
          targetHeadSha: correlation.expectedTargetHead
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: OperationId.make(
          `integration-quarantine-test:conclusive-lineage-operation:${correlation.sessionId}`
        ),
        plannedAttempt: correlation.plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    const result =
      event.basis.cause._tag === "InvalidCandidate"
        ? IntegratorResult.cases.PreparedCandidate.make({ candidateText: event.basis.cause.candidateText, correlation })
        : IntegratorResult.cases.NotPrepared.make({
            correlation,
            detail:
              event.basis.cause._tag === "NotPrepared"
                ? event.basis.cause.detail
                : IntegratorNotPreparedDetail.make("provider-owned activity was proved absent")
          })
    yield* journal.append(
      runId,
      integratorRunStartedRecordKey(run),
      IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      integratorRunResultRecordedRecordKey(run),
      IntegratorRunResultRecordedEvent.make({ result, run, version: workflowJournalEventVersion })
    )
    if (event.basis.cause._tag === "InvalidCandidate") {
      const candidateObservationAt = event.basis.evidence.candidateObservationAt
      if (candidateObservationAt === undefined) {
        return yield* Effect.die("invalid candidate test fixture lacks observation position")
      }
      yield* journal.append(
        runId,
        integratorRunCandidateGitObservedRecordKey(run, event.basis.cause.candidateText),
        IntegratorRunCandidateGitObservedEvent.make({
          candidateText: event.basis.cause.candidateText,
          observation: event.basis.cause.observation,
          run,
          version: workflowJournalEventVersion
        })
      )
      if (candidateObservationAt !== JournalPosition.make(5)) {
        return yield* Effect.die("invalid candidate test fixture must refer to the exact second evidence position")
      }
    }
  } else if (event.basis._tag === "ProviderRunFailure") {
    const correlation = event.correlation
    const lineage = yield* journal.append(
      runId,
      JournalRecordKey.make(`integration-quarantine-test:provider-lineage:${correlation.sessionId}`),
      TargetLineageObservedEvent.make({
        observation: TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: correlation.plannedAttempt.baseSha,
          targetHeadSha: correlation.expectedTargetHead
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: OperationId.make(
          `integration-quarantine-test:provider-lineage-operation:${correlation.sessionId}`
        ),
        plannedAttempt: correlation.plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    if (lineage.position !== correlation.targetLineageObservedAt) {
      return yield* Effect.die("provider-failure fixture lineage position does not match its session correlation")
    }
    yield* journal.append(
      runId,
      integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(correlation)),
      IntegratorSessionFixedEvent.make({ correlation, version: workflowJournalEventVersion })
    )
    const run = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: correlation })
    yield* journal.append(
      runId,
      integratorRunStartedRecordKey(run),
      IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
    )
    yield* journal.append(
      runId,
      integrationProviderRunActivityAbsentRecordKey(run),
      IntegrationProviderRunActivityAbsentEvent.make({
        correlation,
        detail: event.basis.detail,
        occurrenceClassification: "NonActionOccurrence",
        run,
        version: workflowJournalEventVersion
      })
    )
  }
  const record = yield* journal.append(
    runId,
    integrationQuarantinedRecordKey(event.correlation.sessionId, event.basis),
    event
  )
  return { event, journal, record }
})

const fingerprintFor = (
  event: IntegrationQuarantinedEvent,
  quarantineAt: JournalPosition,
  direction: "Retry" | "FullRerun"
) => IntegrationQuarantineDirectionFingerprint.make({ direction, quarantineAt, sessionId: event.correlation.sessionId })

const requestFor = (
  fingerprint: IntegrationQuarantineDirectionFingerprint,
  nonce: string,
  requestRunId: RunId = runId
) =>
  ApplyIntegrationQuarantineDirectionRequest.make({
    fingerprint,
    requestId: IntegrationQuarantineDirectionRequestId.make({ nonce, runId: requestRunId })
  })

const appendTargetLineageObservation = Effect.fn("IntegrationQuarantineTest.appendTargetLineageObservation")(function* (
  correlation: IntegratorSessionCorrelation,
  targetHead: GitCommitSha,
  suffix: string
) {
  const journal = yield* JournalStore
  return yield* journal.append(
    runId,
    JournalRecordKey.make(`integration-quarantine-test:lineage:${suffix}`),
    TargetLineageObservedEvent.make({
      observation: TargetLineageObservation.make({
        plannedBaseIsAncestorOfTargetHead: true,
        plannedBaseSha: correlation.plannedAttempt.baseSha,
        targetHeadSha: targetHead
      }),
      occurrenceClassification: "NonActionOccurrence",
      operationId: OperationId.make(`integration-quarantine-test:lineage-operation:${suffix}`),
      plannedAttempt: correlation.plannedAttempt,
      version: workflowJournalEventVersion
    })
  )
})

it.effect("reconstructs one conclusively unsuccessful Integrator quarantine from its preserved evidence", () =>
  Effect.gen(function* () {
    const cause = IntegrationQuarantineCause.cases.NotPrepared.make({
      detail: IntegratorNotPreparedDetail.make("the provider returned no prepared candidate")
    })
    const event = quarantineEventFor("not-prepared", conclusiveBasisFor(cause))
    const { journal, record } = yield* appendQuarantine("not-prepared", event)
    const records = yield* journal.read(runId)
    const state = deriveIntegrationQuarantineState(records, event.correlation.sessionId)

    expect(state._tag).toBe("Quarantined")
    if (state._tag !== "Quarantined") return
    expect(state.quarantine.basis).toEqual(event.basis)
    expect(state.quarantine.correlation).toEqual(event.correlation)
    expect(state.quarantineAt).toBe(record.position)
    expect(event.correlation.acceptedResult).toEqual(baseCorrelation.acceptedResult)
    expect(event.correlation.plannedAttempt).toEqual(baseCorrelation.plannedAttempt)
    expect(event.correlation.candidateResource).toBe(baseCorrelation.candidateResource)
    expect(event.correlation.queuedAt).toBe(JournalPosition.make(2))
    expect(event.correlation.startedAt).toBe(JournalPosition.make(3))
    expect(records.at(-1)).toEqual(record)
    expect(
      records.some(({ event: current }) =>
        ["CompletionTaskClaimReleased", "IntegrationCompleted", "IntegratorSessionFixed"].includes(current._tag)
      )
    ).toBe(false)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("accepts conclusive evidence bound to the exact initial Integrator run", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const correlation = IntegratorSessionCorrelation.make({
      ...correlationFor("run-bound-not-prepared"),
      targetLineageObservedAt: JournalPosition.make(1)
    })
    const run = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: correlation })
    yield* journal.append(
      runId,
      integratorRunStartedRecordKey(run),
      IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
    )
    const detail = IntegratorNotPreparedDetail.make("the exact initial run returned no candidate")
    const result = yield* journal.append(
      runId,
      integratorRunResultRecordedRecordKey(run),
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({ correlation, detail }),
        run,
        version: workflowJournalEventVersion
      })
    )
    const quarantine = IntegrationQuarantinedEvent.make({
      basis: conclusiveBasisFor(IntegrationQuarantineCause.cases.NotPrepared.make({ detail }), result.position),
      correlation,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    yield* journal.append(runId, integrationQuarantinedRecordKey(correlation.sessionId, quarantine.basis), quarantine)

    expect(deriveIntegrationQuarantineState(yield* journal.read(runId), correlation.sessionId)._tag).toBe("Quarantined")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("reconstructs exact invalid-candidate quarantine evidence and rejects mismatched evidence", () =>
  Effect.gen(function* () {
    const candidateText = IntegratorCandidateText.make("refs/heads/dalph/candidate")
    const missingEvent = quarantineEventFor(
      "invalid-missing",
      conclusiveBasisFor(
        IntegrationQuarantineCause.cases.InvalidCandidate.make({
          candidateText,
          observation: IntegratorGitObservation.cases.Missing.make({ candidateText })
        }),
        JournalPosition.make(4),
        JournalPosition.make(5)
      )
    )
    const { journal, record } = yield* appendQuarantine("invalid-missing", missingEvent)
    const state = deriveIntegrationQuarantineState(yield* journal.read(runId), missingEvent.correlation.sessionId)
    expect(state._tag).toBe("Quarantined")
    expect(record.event).toEqual(missingEvent)
    const records = yield* journal.read(runId)
    const candidateRecord = records.find(({ event: current }) => current._tag === "IntegratorRunCandidateGitObserved")
    const foreignEvidenceRecord = records.find(({ event: current }) => current._tag === "IntegratorRunResultRecorded")
    if (candidateRecord === undefined || foreignEvidenceRecord?.event._tag !== "IntegratorRunResultRecorded") {
      return yield* Effect.die("invalid candidate fixture lacks its evidence records")
    }
    const nonCandidateObservation = records.map((current) =>
      current.position === candidateRecord.position ? { ...current, event: foreignEvidenceRecord.event } : current
    )
    expect(deriveIntegrationQuarantineState(nonCandidateObservation, missingEvent.correlation.sessionId)._tag).toBe(
      "Contradiction"
    )
    expect(missingEvent.basis._tag).toBe("ConclusiveResult")
    if (missingEvent.basis._tag !== "ConclusiveResult") return
    expect(missingEvent.basis.cause._tag).toBe("InvalidCandidate")
    expect(missingEvent.basis.evidence.candidateObservationAt).toBeDefined()

    const nonCommitObservation = IntegratorGitObservation.cases.NonCommit.make({ candidateText, objectType: "tree" })
    const wrongParentObservation = IntegratorGitObservation.cases.Commit.make({
      candidateText,
      commit: GitCommitSha.make("3".repeat(40)),
      directParents: [baseCorrelation.acceptedResult.commit, baseCorrelation.expectedTargetHead]
    })
    for (const observation of [nonCommitObservation, wrongParentObservation]) {
      const candidateEvent = quarantineEventFor(
        "invalid-schema",
        conclusiveBasisFor(
          IntegrationQuarantineCause.cases.InvalidCandidate.make({ candidateText, observation }),
          JournalPosition.make(2),
          JournalPosition.make(3)
        )
      )
      expect(candidateEvent.basis._tag).toBe("ConclusiveResult")
    }
    expect(() =>
      quarantineEventFor(
        "mismatched-text",
        conclusiveBasisFor(
          IntegrationQuarantineCause.cases.InvalidCandidate.make({
            candidateText: IntegratorCandidateText.make("refs/heads/dalph/other-candidate"),
            observation: nonCommitObservation
          }),
          JournalPosition.make(2),
          JournalPosition.make(3)
        )
      )
    ).toThrow()
    expect(() =>
      quarantineEventFor(
        "not-prepared-with-observation",
        conclusiveBasisFor(
          IntegrationQuarantineCause.cases.NotPrepared.make({
            detail: IntegratorNotPreparedDetail.make("not-prepared evidence must not name a Git observation")
          }),
          JournalPosition.make(2),
          JournalPosition.make(3)
        )
      )
    ).toThrow()
    expect(() =>
      quarantineEventFor(
        "candidate-without-observation",
        conclusiveBasisFor(
          IntegrationQuarantineCause.cases.InvalidCandidate.make({
            candidateText,
            observation: IntegratorGitObservation.cases.Missing.make({ candidateText })
          }),
          JournalPosition.make(2)
        )
      )
    ).toThrow()
    const invalidRetryBasis = IntegrationQuarantineBasis.cases.RetryTargetHeadChanged.make({
      direction: "Retry",
      directionAppliedAt: JournalPosition.make(2),
      observedTargetHead: baseCorrelation.expectedTargetHead,
      priorQuarantineAt: JournalPosition.make(2),
      targetLineageObservedAt: JournalPosition.make(3)
    })
    expect(() => quarantineEventFor("invalid-retry-basis", invalidRetryBasis)).toThrow()
    const foreignProviderRun = IntegratorRunCorrelation.make({
      ordinal: IntegratorRunOrdinal.make(1),
      session: correlationFor("foreign-provider-run")
    })
    expect(() =>
      IntegrationProviderRunActivityAbsentEvent.make({
        correlation: baseCorrelation,
        detail: IntegrationQuarantineFailureDetail.make("provider absence must bind one exact session"),
        occurrenceClassification: "NonActionOccurrence",
        run: foreignProviderRun,
        version: workflowJournalEventVersion
      })
    ).toThrow()
    expect(() =>
      quarantineEventFor(
        "valid-schema",
        conclusiveBasisFor(
          IntegrationQuarantineCause.cases.InvalidCandidate.make({
            candidateText,
            observation: IntegratorGitObservation.cases.Commit.make({
              candidateText,
              commit: GitCommitSha.make("3".repeat(40)),
              directParents: [baseCorrelation.expectedTargetHead, baseCorrelation.acceptedResult.commit]
            })
          }),
          JournalPosition.make(2),
          JournalPosition.make(3)
        )
      )
    ).toThrow()
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("records provider-run failure only after owned activity is proved absent", () =>
  Effect.gen(function* () {
    const basis = IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
      detail: IntegrationQuarantineFailureDetail.make("provider run ended after no owned activity remained"),
      ownedActivityProvenAbsentAt: JournalPosition.make(5)
    })
    const event = quarantineEventFor("provider-failure", basis)
    const { journal } = yield* appendQuarantine("provider-failure", event)
    const state = deriveIntegrationQuarantineState(yield* journal.read(runId), event.correlation.sessionId)
    expect(state._tag).toBe("Quarantined")
    expect(event.basis).toMatchObject({ _tag: "ProviderRunFailure", ownedActivityProvenAbsentAt: 5 })
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("authorizes Retry from exact provider-failure and run-bound conclusive evidence", () =>
  Effect.gen(function* () {
    const providerBasis = IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
      detail: IntegrationQuarantineFailureDetail.make("provider activity was proved absent for Retry"),
      ownedActivityProvenAbsentAt: JournalPosition.make(5)
    })
    const provider = yield* appendQuarantine(
      "provider-retry-eligible",
      quarantineEventFor("provider-retry-eligible", providerBasis)
    )
    const providerControl = yield* IntegrationQuarantineDirectionControl
    const providerApplied = yield* providerControl.apply(
      requestFor(fingerprintFor(provider.event, provider.record.position, "Retry"), "provider-retry-eligible-request")
    )
    expect(providerApplied._tag).toBe("DirectionApplied")

    const journal = yield* JournalStore
    const correlation = IntegratorSessionCorrelation.make({
      ...baseCorrelation,
      sessionId: IntegratorSessionId.make("run-bound-retry-eligible"),
      targetLineageObservedAt: JournalPosition.make(1)
    })
    const run = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: correlation })
    const start = yield* journal.append(
      runId,
      integratorRunStartedRecordKey(run),
      IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
    )
    const detail = IntegratorNotPreparedDetail.make("run-bound Retry evidence is exact")
    const result = yield* journal.append(
      runId,
      integratorRunResultRecordedRecordKey(run),
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({ correlation, detail }),
        run,
        version: workflowJournalEventVersion
      })
    )
    const quarantine = IntegrationQuarantinedEvent.make({
      basis: conclusiveBasisFor(IntegrationQuarantineCause.cases.NotPrepared.make({ detail }), result.position),
      correlation,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    const quarantineRecord = yield* journal.append(
      runId,
      integrationQuarantinedRecordKey(correlation.sessionId, quarantine.basis),
      quarantine
    )
    expect(start.position).toBeLessThan(result.position)
    const runBoundRecords = yield* journal.read(runId)
    const wronglyKeyedStartJournal: InRunJournal["Service"] = {
      append: () => Effect.die("wrongly keyed run start must fail before append"),
      read: () =>
        Effect.succeed(
          runBoundRecords.map((candidate) =>
            candidate === start ? { ...candidate, key: JournalRecordKey.make("wrong-run-bound-start-key") } : candidate
          )
        )
    }
    const wronglyKeyedStartControl = yield* makeIntegrationQuarantineDirectionControl(wronglyKeyedStartJournal)
    const wronglyKeyedStart = yield* wronglyKeyedStartControl
      .apply(requestFor(fingerprintFor(quarantine, quarantineRecord.position, "Retry"), "wrong-run-bound-start"))
      .pipe(Effect.flip)
    expect(wronglyKeyedStart).toMatchObject({
      _tag: "IntegrationQuarantineDirectionNotAvailable",
      reason: "RetryLimitReached"
    })
    const runBoundApplied = yield* providerControl.apply(
      requestFor(fingerprintFor(quarantine, quarantineRecord.position, "Retry"), "run-bound-retry-request")
    )
    expect(runBoundApplied._tag).toBe("DirectionApplied")
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects arbitrary Journal history as proof that a provider run has no owned activity", () =>
  Effect.gen(function* () {
    const basis = IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
      detail: IntegrationQuarantineFailureDetail.make("provider activity absence is required"),
      ownedActivityProvenAbsentAt: JournalPosition.make(5)
    })
    const event = quarantineEventFor("provider-negative", basis)
    const { journal } = yield* appendQuarantine("provider-negative", event)
    const records = yield* journal.read(runId)
    const absence = records.find(({ event: current }) => current._tag === "IntegrationProviderRunActivityAbsent")
    if (absence === undefined) return yield* Effect.die("provider test fixture lacks its exact absence occurrence")
    const arbitrary = records.map((record) =>
      record.position === absence.position ? { ...record, event: records[0]?.event ?? record.event } : record
    )
    expect(deriveIntegrationQuarantineState(arbitrary, event.correlation.sessionId)._tag).toBe("Contradiction")
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("distinguishes an unopened Run, a missing quarantine, and a session-mismatched quarantine", () =>
  Effect.gen(function* () {
    const event = quarantineEventFor("control-lookup")
    const fingerprint = fingerprintFor(event, JournalPosition.make(3), "Retry")
    const request = requestFor(fingerprint, "control-lookup-request")
    const unopenedJournal: InRunJournal["Service"] = {
      append: () => Effect.die("unopened Run must fail before append"),
      read: () => Effect.succeed([])
    }
    const unopenedControl = yield* makeIntegrationQuarantineDirectionControl(unopenedJournal)
    const unopened = yield* unopenedControl.apply(request).pipe(Effect.flip)
    expect(unopened._tag).toBe("WorkflowRunNotBegan")

    const { journal, record } = yield* appendQuarantine("control-lookup", event)
    const records = yield* journal.read(runId)
    const noQuarantineJournal: InRunJournal["Service"] = {
      append: () => Effect.die("missing quarantine must fail before append"),
      read: () => Effect.succeed(records.filter((candidate) => candidate.position < event.correlation.queuedAt))
    }
    const noQuarantineControl = yield* makeIntegrationQuarantineDirectionControl(noQuarantineJournal)
    const missing = yield* noQuarantineControl.apply(request).pipe(Effect.flip)
    expect(missing).toMatchObject({ _tag: "IntegrationQuarantineDirectionNotAvailable", reason: "MissingQuarantine" })

    const foreignCorrelation = correlationFor("control-lookup-foreign")
    const foreignEvent = IntegrationQuarantinedEvent.make({ ...event, correlation: foreignCorrelation })
    const sessionMismatchJournal: InRunJournal["Service"] = {
      append: () => Effect.die("session mismatch must fail before append"),
      read: () =>
        Effect.succeed(
          records.map((candidate) => (candidate === record ? { ...candidate, event: foreignEvent } : candidate))
        )
    }
    const sessionMismatchControl = yield* makeIntegrationQuarantineDirectionControl(sessionMismatchJournal)
    const mismatch = yield* sessionMismatchControl.apply(request).pipe(Effect.flip)
    expect(mismatch).toMatchObject({ _tag: "IntegrationQuarantineDirectionNotAvailable", reason: "SessionMismatch" })
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects incomplete conclusive run-one evidence and reports an absent direction result", () =>
  Effect.gen(function* () {
    const event = quarantineEventFor("control-incomplete-result")
    const { journal, record } = yield* appendQuarantine("control-incomplete-result", event)
    const records = yield* journal.read(runId)
    const request = requestFor(fingerprintFor(event, record.position, "Retry"), "control-incomplete-result-request")
    const incompleteJournal: InRunJournal["Service"] = {
      append: () => Effect.die("incomplete conclusive evidence must fail before append"),
      read: () => Effect.succeed(records.filter((candidate) => candidate.event._tag !== "IntegratorRunResultRecorded"))
    }
    const incompleteControl = yield* makeIntegrationQuarantineDirectionControl(incompleteJournal)
    const incomplete = yield* incompleteControl.apply(request).pipe(Effect.flip)
    expect(incomplete).toMatchObject({ _tag: "IntegrationQuarantineDirectionNotAvailable", reason: "SessionMismatch" })

    const control = yield* IntegrationQuarantineDirectionControl
    const notFound = yield* control
      .read({ requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "never-applied", runId }) })
      .pipe(Effect.flip)
    expect(notFound).toBeInstanceOf(IntegrationQuarantineDirectionResultNotFound)
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("reconciles every ambiguous direction append outcome against the Journal winner", () =>
  Effect.gen(function* () {
    const event = quarantineEventFor("control-append-outcomes")
    const { journal, record } = yield* appendQuarantine("control-append-outcomes", event)
    const records = yield* journal.read(runId)
    const fingerprint = fingerprintFor(event, record.position, "FullRerun")

    let redelivered: JournalRecord | undefined
    let redeliveryAttempted = false
    const redeliveredJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key, appliedEvent) => {
        redeliveryAttempted = true
        redelivered = {
          event: appliedEvent,
          key,
          position: JournalPosition.make(records.length + 1),
          runId: requestedRunId
        }
        return Effect.fail(
          new JournalStoreContradiction({ existingPosition: redelivered.position, key, runId: requestedRunId })
        )
      },
      read: () => Effect.succeed(redeliveryAttempted && redelivered !== undefined ? [...records, redelivered] : records)
    }
    const redeliveredControl = yield* makeIntegrationQuarantineDirectionControl(redeliveredJournal)
    const redeliveredResult = yield* redeliveredControl.apply(requestFor(fingerprint, "append-redelivered"))
    expect(redeliveredResult._tag).toBe("DirectionApplied")

    let conflicting: JournalRecord | undefined
    let conflictingAttempted = false
    const conflictingJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key, appliedEvent) => {
        conflictingAttempted = true
        if (appliedEvent._tag !== "IntegrationQuarantineDirectionApplied") {
          return Effect.die("control supplied a non-direction event")
        }
        const conflictingEvent = IntegrationQuarantineDirectionAppliedEvent.make({
          ...appliedEvent,
          fingerprint: IntegrationQuarantineDirectionFingerprint.make({
            ...appliedEvent.fingerprint,
            direction: "Retry"
          })
        })
        conflicting = {
          event: conflictingEvent,
          key,
          position: JournalPosition.make(records.length + 1),
          runId: requestedRunId
        }
        return Effect.fail(
          new JournalStoreContradiction({ existingPosition: conflicting.position, key, runId: requestedRunId })
        )
      },
      read: () =>
        Effect.succeed(conflictingAttempted && conflicting !== undefined ? [...records, conflicting] : records)
    }
    const conflictingControl = yield* makeIntegrationQuarantineDirectionControl(conflictingJournal)
    const conflictingResult = yield* conflictingControl
      .apply(requestFor(fingerprint, "append-conflicting"))
      .pipe(Effect.flip)
    expect(conflictingResult).toBeInstanceOf(IntegrationQuarantineDirectionRequestIdentityContradiction)

    let subjectWinner: JournalRecord | undefined
    let subjectAttempted = false
    const subjectJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key, appliedEvent) => {
        subjectAttempted = true
        if (appliedEvent._tag !== "IntegrationQuarantineDirectionApplied") {
          return Effect.die("control supplied a non-direction event")
        }
        const subjectEvent = IntegrationQuarantineDirectionAppliedEvent.make({
          ...appliedEvent,
          requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "subject-winner", runId: requestedRunId })
        })
        subjectWinner = {
          event: subjectEvent,
          key,
          position: JournalPosition.make(records.length + 1),
          runId: requestedRunId
        }
        return Effect.fail(
          new JournalStoreContradiction({ existingPosition: subjectWinner.position, key, runId: requestedRunId })
        )
      },
      read: () =>
        Effect.succeed(subjectAttempted && subjectWinner !== undefined ? [...records, subjectWinner] : records)
    }
    const subjectControl = yield* makeIntegrationQuarantineDirectionControl(subjectJournal)
    const subjectResult = yield* subjectControl.apply(requestFor(fingerprint, "append-subject")).pipe(Effect.flip)
    expect(subjectResult).toBeInstanceOf(IntegrationQuarantineDirectionAlreadyApplied)

    let fallbackAttempted = false
    const fallbackJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key) => {
        fallbackAttempted = true
        return Effect.fail(
          new JournalStoreContradiction({
            existingPosition: JournalPosition.make(records.length + 1),
            key,
            runId: requestedRunId
          })
        )
      },
      read: () => Effect.succeed(records)
    }
    const fallbackControl = yield* makeIntegrationQuarantineDirectionControl(fallbackJournal)
    const fallbackResult = yield* fallbackControl.apply(requestFor(fingerprint, "append-fallback")).pipe(Effect.flip)
    expect(fallbackAttempted).toBe(true)
    expect(fallbackResult).toBeInstanceOf(IntegrationQuarantineDirectionRequestIdentityContradiction)

    const foreignAppendJournal: InRunJournal["Service"] = {
      append: (requestedRunId, key) =>
        Effect.succeed({
          event: IntegratorRunResultRecordedEvent.make({
            result: IntegratorResult.cases.NotPrepared.make({
              correlation: event.correlation,
              detail: IntegratorNotPreparedDetail.make("foreign append result")
            }),
            run: IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: event.correlation }),
            version: workflowJournalEventVersion
          }),
          key,
          position: JournalPosition.make(records.length + 1),
          runId: requestedRunId
        }),
      read: () => Effect.succeed(records)
    }
    const foreignAppendControl = yield* makeIntegrationQuarantineDirectionControl(foreignAppendJournal)
    const foreignAppend = yield* foreignAppendControl
      .apply(requestFor(fingerprint, "append-foreign-result"))
      .pipe(Effect.flip)
    expect(foreignAppend).toBeInstanceOf(IntegrationQuarantineDirectionRequestIdentityContradiction)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect(
  "reconstructs changed-head Retry as a fresh quarantine only after prior quarantine, Retry, and new lineage evidence",
  () =>
    Effect.gen(function* () {
      const { event: prior, journal, record: priorRecord } = yield* appendQuarantine("changed-chain-prior")
      const control = yield* IntegrationQuarantineDirectionControl
      const retry = requestFor(fingerprintFor(prior, priorRecord.position, "Retry"), "changed-chain-retry")
      const applied = yield* control.apply(retry)
      const observedHead = GitCommitSha.make("4".repeat(40))
      const lineage = yield* appendTargetLineageObservation(prior.correlation, observedHead, "changed-chain")
      const successor = IntegrationQuarantinedEvent.make({
        basis: IntegrationQuarantineBasis.cases.RetryTargetHeadChanged.make({
          direction: "Retry",
          directionAppliedAt: applied.application.position,
          observedTargetHead: observedHead,
          priorQuarantineAt: priorRecord.position,
          targetLineageObservedAt: lineage.position
        }),
        correlation: prior.correlation,
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      })
      const successorRecord = yield* journal.append(
        runId,
        integrationQuarantinedRecordKey(successor.correlation.sessionId, successor.basis),
        successor
      )

      const retryAfterChangedHead = yield* control
        .apply(requestFor(fingerprintFor(successor, successorRecord.position, "Retry"), "changed-chain-retry-again"))
        .pipe(Effect.flip)
      expect(retryAfterChangedHead).toBeInstanceOf(IntegrationQuarantineDirectionNotAvailable)
      expect(retryAfterChangedHead).toMatchObject({ reason: "RetryLimitReached" })

      const fullRerunAfterChangedHead = yield* control.apply(
        requestFor(fingerprintFor(successor, successorRecord.position, "FullRerun"), "changed-chain-full-rerun")
      )
      expect(fullRerunAfterChangedHead._tag).toBe("DirectionApplied")

      const state = deriveIntegrationQuarantineState(yield* journal.read(runId), prior.correlation.sessionId)
      expect(state._tag).toBe("DirectionApplied")
      if (state._tag !== "DirectionApplied") return
      expect(state.quarantine.basis).toEqual(successor.basis)
    }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects changed-head quarantine when its direction evidence is missing, FullRerun, or foreign", () =>
  Effect.gen(function* () {
    const { event: prior, journal, record: priorRecord } = yield* appendQuarantine("changed-negative")
    const control = yield* IntegrationQuarantineDirectionControl
    const fullRerun = yield* control.apply(
      requestFor(fingerprintFor(prior, priorRecord.position, "FullRerun"), "changed-negative-full")
    )
    const observedHead = GitCommitSha.make("5".repeat(40))
    const lineage = yield* appendTargetLineageObservation(prior.correlation, observedHead, "changed-negative")
    const missingRetryEvidence = IntegrationQuarantinedEvent.make({
      basis: IntegrationQuarantineBasis.cases.RetryTargetHeadChanged.make({
        direction: "Retry",
        directionAppliedAt: lineage.position,
        observedTargetHead: observedHead,
        priorQuarantineAt: priorRecord.position,
        targetLineageObservedAt: JournalPosition.make(lineage.position + 1)
      }),
      correlation: prior.correlation,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    expect(missingRetryEvidence.basis._tag).toBe("RetryTargetHeadChanged")
    const fullDirectionSuccessor = IntegrationQuarantinedEvent.make({
      ...missingRetryEvidence,
      basis: IntegrationQuarantineBasis.cases.RetryTargetHeadChanged.make({
        direction: "Retry",
        directionAppliedAt: fullRerun.application.position,
        observedTargetHead: observedHead,
        priorQuarantineAt: priorRecord.position,
        targetLineageObservedAt: lineage.position
      })
    })
    expect(fullDirectionSuccessor.basis._tag).toBe("RetryTargetHeadChanged")
    yield* journal.append(
      runId,
      integrationQuarantinedRecordKey(fullDirectionSuccessor.correlation.sessionId, fullDirectionSuccessor.basis),
      fullDirectionSuccessor
    )
    const foreignDirection = IntegrationQuarantineDirectionAppliedEvent.make({
      fingerprint: IntegrationQuarantineDirectionFingerprint.make({
        direction: "Retry",
        quarantineAt: priorRecord.position,
        sessionId: IntegratorSessionId.make("foreign-quarantine-session")
      }),
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "foreign-direction", runId }),
      version: workflowJournalEventVersion
    })
    yield* journal.append(runId, JournalRecordKey.make("foreign-direction"), foreignDirection)
    const foreignDirectionSuccessor = IntegrationQuarantinedEvent.make({
      ...missingRetryEvidence,
      basis: IntegrationQuarantineBasis.cases.RetryTargetHeadChanged.make({
        direction: "Retry",
        directionAppliedAt: JournalPosition.make(lineage.position + 1),
        observedTargetHead: observedHead,
        priorQuarantineAt: priorRecord.position,
        targetLineageObservedAt: JournalPosition.make(lineage.position + 2)
      })
    })
    expect(foreignDirectionSuccessor.basis._tag).toBe("RetryTargetHeadChanged")
    const records = yield* journal.read(runId)
    expect(deriveIntegrationQuarantineState(records, prior.correlation.sessionId)._tag).toBe("Contradiction")
    expect(
      deriveIntegrationQuarantineState(
        [
          ...records,
          {
            event: missingRetryEvidence,
            key: integrationQuarantinedRecordKey(prior.correlation.sessionId, missingRetryEvidence.basis),
            position: JournalPosition.make(99),
            runId
          }
        ],
        prior.correlation.sessionId
      )._tag
    ).toBe("Contradiction")
    expect(
      deriveIntegrationQuarantineState(
        [
          ...records,
          {
            event: foreignDirectionSuccessor,
            key: integrationQuarantinedRecordKey(prior.correlation.sessionId, foreignDirectionSuccessor.basis),
            position: JournalPosition.make(100),
            runId
          }
        ],
        prior.correlation.sessionId
      )._tag
    ).toBe("Contradiction")
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("fails closed for canonical quarantine and direction records with foreign or pre-quarantine keys", () =>
  Effect.gen(function* () {
    const { event: prior, journal, record: priorRecord } = yield* appendQuarantine("state-boundary")
    const control = yield* IntegrationQuarantineDirectionControl
    const applied = yield* control.apply(
      requestFor(fingerprintFor(prior, priorRecord.position, "Retry"), "state-boundary-retry")
    )
    const observedHead = GitCommitSha.make("6".repeat(40))
    const lineage = yield* appendTargetLineageObservation(prior.correlation, observedHead, "state-boundary")
    const changed = IntegrationQuarantinedEvent.make({
      basis: IntegrationQuarantineBasis.cases.RetryTargetHeadChanged.make({
        direction: "Retry",
        directionAppliedAt: applied.application.position,
        observedTargetHead: observedHead,
        priorQuarantineAt: priorRecord.position,
        targetLineageObservedAt: lineage.position
      }),
      correlation: prior.correlation,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    const changedRecord = yield* journal.append(
      runId,
      integrationQuarantinedRecordKey(changed.correlation.sessionId, changed.basis),
      changed
    )
    const records = yield* journal.read(runId)
    expect(deriveIntegrationQuarantineState(records, prior.correlation.sessionId)._tag).toBe("Quarantined")

    const nonDirectionBasis = IntegrationQuarantineBasis.cases.RetryTargetHeadChanged.make({
      direction: "Retry",
      directionAppliedAt: lineage.position,
      observedTargetHead: observedHead,
      priorQuarantineAt: priorRecord.position,
      targetLineageObservedAt: JournalPosition.make(lineage.position + 1)
    })
    const nonDirectionEvent = IntegrationQuarantinedEvent.make({
      basis: nonDirectionBasis,
      correlation: prior.correlation,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    const nonDirectionRecords = [
      ...records,
      {
        event: nonDirectionEvent,
        key: integrationQuarantinedRecordKey(prior.correlation.sessionId, nonDirectionBasis),
        position: JournalPosition.make(changedRecord.position + 1),
        runId
      }
    ]
    expect(deriveIntegrationQuarantineState(nonDirectionRecords, prior.correlation.sessionId)._tag).toBe(
      "Contradiction"
    )

    const foreignQuarantine = records.map((record) =>
      record.position === changedRecord.position
        ? { ...record, key: JournalRecordKey.make("state:foreign-quarantine") }
        : record
    )
    expect(deriveIntegrationQuarantineState(foreignQuarantine, prior.correlation.sessionId)._tag).toBe("Contradiction")

    const changedSubject = IntegrationQuarantineDirectionSubject.make({
      quarantineAt: changedRecord.position,
      sessionId: prior.correlation.sessionId
    })
    const changedDirection = IntegrationQuarantineDirectionAppliedEvent.make({
      fingerprint: IntegrationQuarantineDirectionFingerprint.make({
        direction: "Retry",
        quarantineAt: changedRecord.position,
        sessionId: prior.correlation.sessionId
      }),
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "state-boundary-direction", runId }),
      version: workflowJournalEventVersion
    })
    const foreignDirection = [
      ...records,
      {
        event: changedDirection,
        key: JournalRecordKey.make("state:foreign-direction"),
        position: JournalPosition.make(changedRecord.position + 1),
        runId
      }
    ]
    expect(deriveIntegrationQuarantineState(foreignDirection, prior.correlation.sessionId)._tag).toBe("Contradiction")

    const preQuarantineDirection = [
      ...records,
      {
        event: changedDirection,
        key: integrationQuarantineDirectionAppliedRecordKey(changedSubject),
        position: JournalPosition.make(changedRecord.position - 1),
        runId
      }
    ]
    expect(deriveIntegrationQuarantineState(preQuarantineDirection, prior.correlation.sessionId)._tag).toBe(
      "Contradiction"
    )
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("detects duplicate directions on an earlier quarantine even after a later quarantine occurrence", () =>
  Effect.gen(function* () {
    const { event: prior, journal, record: priorRecord } = yield* appendQuarantine("duplicate-earlier")
    const control = yield* IntegrationQuarantineDirectionControl
    const retry = yield* control.apply(
      requestFor(fingerprintFor(prior, priorRecord.position, "Retry"), "duplicate-retry")
    )
    const conflictingDirection = IntegrationQuarantineDirectionAppliedEvent.make({
      fingerprint: IntegrationQuarantineDirectionFingerprint.make({
        direction: "FullRerun",
        quarantineAt: priorRecord.position,
        sessionId: prior.correlation.sessionId
      }),
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      requestId: IntegrationQuarantineDirectionRequestId.make({ nonce: "duplicate-full", runId }),
      version: workflowJournalEventVersion
    })
    yield* journal.append(runId, JournalRecordKey.make("duplicate-direction"), conflictingDirection)
    const laterResultPosition = JournalPosition.make(retry.application.position + 1)
    yield* journal.append(
      runId,
      JournalRecordKey.make("later-quarantine-result"),
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({
          correlation: prior.correlation,
          detail: IntegratorNotPreparedDetail.make("later conclusive result")
        }),
        run: IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: prior.correlation }),
        version: workflowJournalEventVersion
      })
    )
    const later = IntegrationQuarantinedEvent.make({
      basis: conclusiveBasisFor(
        IntegrationQuarantineCause.cases.NotPrepared.make({
          detail: IntegratorNotPreparedDetail.make("later conclusive result")
        }),
        laterResultPosition
      ),
      correlation: prior.correlation,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    yield* journal.append(runId, JournalRecordKey.make("later-quarantine"), later)

    expect(deriveIntegrationQuarantineState(yield* journal.read(runId), prior.correlation.sessionId)._tag).toBe(
      "Contradiction"
    )
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("deduplicates repeated Retry requests by session quarantine and direction", () =>
  Effect.gen(function* () {
    const { event, journal, record } = yield* appendQuarantine("retry")
    const control = yield* IntegrationQuarantineDirectionControl
    const request = requestFor(fingerprintFor(event, record.position, "Retry"), "retry-request")
    const first = yield* control.apply(request)
    expect(yield* control.apply(request)).toEqual(first)
    expect(yield* control.read({ requestId: request.requestId })).toEqual(first)
    const records = yield* journal.read(runId)
    expect(
      records.filter(({ event: current }) => current._tag === "IntegrationQuarantineDirectionApplied")
    ).toHaveLength(1)
    expect(first.application.event.requestId).toEqual(request.requestId)
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("uses the Journal as the first-choice authority across two fresh control layers", () =>
  Effect.gen(function* () {
    const { event, journal, record } = yield* appendQuarantine("concurrent-choice")
    const fingerprint = fingerprintFor(event, record.position, "Retry")
    const requests = [
      requestFor(fingerprint, "concurrent-choice-one"),
      requestFor(fingerprint, "concurrent-choice-two")
    ]
    const outcomes = yield* Effect.all(
      requests.map((request) =>
        Effect.gen(function* () {
          const freshControl = yield* IntegrationQuarantineDirectionControl
          return yield* freshControl.apply(request)
        })
          .pipe(Effect.provide(Layer.fresh(integrationQuarantineDirectionControlLayer)))
          .pipe(
            Effect.matchEffect({
              onFailure: (error) => Effect.succeed({ _tag: "Failure" as const, error }),
              onSuccess: (result) => Effect.succeed({ _tag: "Success" as const, result })
            })
          )
      ),
      { concurrency: "unbounded" }
    )

    const winners = outcomes.filter((outcome) => outcome._tag === "Success")
    const losers = outcomes.filter((outcome) => outcome._tag === "Failure")
    expect(winners).toHaveLength(1)
    expect(losers).toHaveLength(1)
    const loser = losers[0]
    if (loser?._tag !== "Failure") return
    expect(loser.error).toBeInstanceOf(IntegrationQuarantineDirectionAlreadyApplied)
    expect(
      (yield* journal.read(runId)).filter(
        ({ event: current }) => current._tag === "IntegrationQuarantineDirectionApplied"
      )
    ).toHaveLength(1)
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("replays a recorded Retry direction through the control after restart", () =>
  Effect.gen(function* () {
    const { event, record } = yield* appendQuarantine("restart")
    const request = requestFor(fingerprintFor(event, record.position, "Retry"), "restart-request")
    const control = yield* IntegrationQuarantineDirectionControl
    const first = yield* control.apply(request)
    const replayed = yield* Effect.gen(function* () {
      const restartedControl = yield* IntegrationQuarantineDirectionControl
      return yield* restartedControl.read({ requestId: request.requestId })
    }).pipe(Effect.provide(Layer.fresh(integrationQuarantineDirectionControlLayer)))

    expect(replayed).toEqual(first)
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a conflicting direction after the first choice", () =>
  Effect.gen(function* () {
    const { event, journal, record } = yield* appendQuarantine("first-choice")
    const control = yield* IntegrationQuarantineDirectionControl
    const retry = requestFor(fingerprintFor(event, record.position, "Retry"), "first-retry")
    yield* control.apply(retry)
    const fullRerun = requestFor(fingerprintFor(event, record.position, "FullRerun"), "second-full-rerun")
    const rejection = yield* control.apply(fullRerun).pipe(Effect.flip)

    expect(rejection).toBeInstanceOf(IntegrationQuarantineDirectionAlreadyApplied)
    expect(
      (yield* journal.read(runId)).filter(
        ({ event: current }) => current._tag === "IntegrationQuarantineDirectionApplied"
      )
    ).toHaveLength(1)
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects conflicting request identity and starts nothing", () =>
  Effect.gen(function* () {
    const { event, journal, record } = yield* appendQuarantine("request-identity")
    const control = yield* IntegrationQuarantineDirectionControl
    const first = requestFor(fingerprintFor(event, record.position, "Retry"), "same-request")
    yield* control.apply(first)
    const contradiction = yield* control
      .apply(requestFor(fingerprintFor(event, record.position, "FullRerun"), "same-request"))
      .pipe(Effect.flip)

    expect(contradiction).toBeInstanceOf(IntegrationQuarantineDirectionRequestIdentityContradiction)
    expect(
      (yield* journal.read(runId)).filter(
        ({ event: current }) => current._tag === "IntegrationQuarantineDirectionApplied"
      )
    ).toHaveLength(1)
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects a direction request bound to a different Run than the quarantined responsibility", () =>
  Effect.gen(function* () {
    const subjectRunId = RunId.make("quarantined-subject-run")
    const subjectAttempt = { ...baseCorrelation.plannedAttempt, runId: subjectRunId }
    const event = IntegrationQuarantinedEvent.make({
      basis: conclusiveBasisFor(
        IntegrationQuarantineCause.cases.NotPrepared.make({
          detail: IntegratorNotPreparedDetail.make("subject run differs from journal route")
        })
      ),
      correlation: IntegratorSessionCorrelation.make({ ...baseCorrelation, plannedAttempt: subjectAttempt }),
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    const { record } = yield* appendQuarantine("run-mismatch", event)
    const control = yield* IntegrationQuarantineDirectionControl
    const request = requestFor(fingerprintFor(event, record.position, "Retry"), "wrong-run")
    const rejection = yield* control.apply(request).pipe(Effect.flip)

    expect(rejection).toBeInstanceOf(IntegrationQuarantineDirectionRequestRunMismatch)
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(memoryJournalTestLayer))
)

it.effect("decodes unknown direction requests strictly and does not accept malformed story inputs", () =>
  Effect.gen(function* () {
    const malformed = {
      fingerprint: { direction: "Retry", quarantineAt: JournalPosition.make(2), sessionId: "malformed-session" },
      requestId: { nonce: "malformed-request", runId },
      unexpected: true
    }
    const issue = yield* Schema.decodeUnknownEffect(ApplyIntegrationQuarantineDirectionRequest, {
      onExcessProperty: "error"
    })(malformed).pipe(Effect.flip)
    expect(issue).toBeInstanceOf(Schema.SchemaError)
    expect(quarantineRecordForFingerprint([], malformed.fingerprint as never)).toBeUndefined()
  })
)

it.effect("narrows only the closed Integration Quarantine Journal event vocabulary", () =>
  Effect.sync(() => {
    const quarantine = quarantineEventFor("event-vocabulary")
    expect(isIntegrationQuarantineEvent(quarantine)).toBe(true)
    const result = IntegratorRunResultRecordedEvent.make({
      result: IntegratorResult.cases.NotPrepared.make({
        correlation: quarantine.correlation,
        detail: IntegratorNotPreparedDetail.make("event vocabulary probe")
      }),
      run: IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: quarantine.correlation }),
      version: workflowJournalEventVersion
    })
    expect(isIntegrationQuarantineEvent(result)).toBe(false)
  })
)
