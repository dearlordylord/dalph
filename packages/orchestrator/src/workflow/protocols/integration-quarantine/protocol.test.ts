import { it } from "@effect/vitest"
import { GitCommitSha, RunId } from "@dalph/contracts"
import { Effect, Layer, Schema } from "effect"
import { expect } from "vitest"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import {
  integrationQuarantinedRecordKey,
  integratorCandidateGitObservedRecordKey,
  integratorResultRecordedRecordKey,
  integrationProviderRunActivityAbsentRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { OperationId } from "../../identity.js"
import { TargetLineageObservation } from "../../../authorities/git/target-lineage.js"
import { TargetLineageObservedEvent } from "../../registry/event.js"
import { deriveIntegrationQuarantineState, quarantineRecordForFingerprint } from "./state.js"
import {
  ApplyIntegrationQuarantineDirectionRequest,
  IntegrationQuarantineBasis,
  IntegrationQuarantineCause,
  IntegrationQuarantineDirectionAppliedEvent,
  IntegrationQuarantineDirectionFingerprint,
  IntegrationQuarantineDirectionRequestId,
  IntegrationQuarantineFailureDetail,
  IntegrationQuarantineResultEvidence,
  IntegrationQuarantinedEvent,
  IntegrationProviderRunActivityAbsentEvent
} from "./events.js"
import {
  IntegratorCandidateText,
  IntegratorCorrelation,
  IntegratorGitObservation,
  IntegratorNotPreparedDetail,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorResult,
  IntegratorCandidateGitObservedEvent,
  IntegratorResultRecordedEvent,
  IntegratorSessionId
} from "../integrator/events.js"
import {
  IntegrationQuarantineDirectionAlreadyApplied,
  IntegrationQuarantineDirectionControl,
  IntegrationQuarantineDirectionNotAvailable,
  IntegrationQuarantineDirectionRequestIdentityContradiction,
  IntegrationQuarantineDirectionRequestRunMismatch,
  integrationQuarantineDirectionControlLayer
} from "./control.js"
import { legacyMemoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"

const runId = integrationFinalityFixture.runId
const target = FixtureTarget.make("integration-quarantine-target")
const baseCorrelation = integrationFinalityFixture.qualifiedCandidate.run.session

const correlationFor = (suffix: string) =>
  IntegratorCorrelation.make({
    ...baseCorrelation,
    sessionId: IntegratorSessionId.make(`integration-quarantine-session-${suffix}`)
  })

const conclusiveBasisFor = (
  cause: IntegrationQuarantineCause,
  resultRecordedAt = JournalPosition.make(2),
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
      integratorResultRecordedRecordKey(correlation),
      IntegratorResultRecordedEvent.make({ result, version: workflowJournalEventVersion })
    )
    if (event.basis.cause._tag === "InvalidCandidate") {
      const candidateObservationAt = event.basis.evidence.candidateObservationAt
      if (candidateObservationAt === undefined) {
        return yield* Effect.die("invalid candidate test fixture lacks observation position")
      }
      yield* journal.append(
        runId,
        integratorCandidateGitObservedRecordKey(correlation, event.basis.cause.candidateText),
        IntegratorCandidateGitObservedEvent.make({
          candidateText: event.basis.cause.candidateText,
          correlation,
          observation: event.basis.cause.observation,
          version: workflowJournalEventVersion
        })
      )
      if (candidateObservationAt !== JournalPosition.make(3)) {
        return yield* Effect.die("invalid candidate test fixture must refer to the exact second evidence position")
      }
    }
  } else if (event.basis._tag === "ProviderRunFailure") {
    const correlation = event.correlation
    yield* journal.append(
      runId,
      integrationProviderRunActivityAbsentRecordKey(correlation),
      IntegrationProviderRunActivityAbsentEvent.make({
        correlation,
        detail: event.basis.detail,
        occurrenceClassification: "NonActionOccurrence",
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
  correlation: IntegratorCorrelation,
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

it.effect("quarantines one conclusively unsuccessful Integrator session and preserves its evidence", () =>
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("accepts conclusive evidence bound to the exact initial Integrator run", () =>
  Effect.gen(function* () {
    const journal = yield* JournalStore
    yield* journal.beginRun(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })
    )
    const correlation = correlationFor("run-bound-not-prepared")
    const run = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session: correlation })
    yield* journal.append(
      runId,
      JournalRecordKey.make("integration-quarantine-test:run-bound:start"),
      IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
    )
    const detail = IntegratorNotPreparedDetail.make("the exact initial run returned no candidate")
    const result = yield* journal.append(
      runId,
      JournalRecordKey.make("integration-quarantine-test:run-bound:result"),
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("rejects a candidate whose Git object or ordered parents are invalid", () =>
  Effect.gen(function* () {
    const candidateText = IntegratorCandidateText.make("refs/heads/dalph/candidate")
    const missingEvent = quarantineEventFor(
      "invalid-missing",
      conclusiveBasisFor(
        IntegrationQuarantineCause.cases.InvalidCandidate.make({
          candidateText,
          observation: IntegratorGitObservation.cases.Missing.make({ candidateText })
        }),
        JournalPosition.make(2),
        JournalPosition.make(3)
      )
    )
    const { journal, record } = yield* appendQuarantine("invalid-missing", missingEvent)
    const state = deriveIntegrationQuarantineState(yield* journal.read(runId), missingEvent.correlation.sessionId)
    expect(state._tag).toBe("Quarantined")
    expect(record.event).toEqual(missingEvent)
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("records provider-run failure only after owned activity is proved absent", () =>
  Effect.gen(function* () {
    const basis = IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
      detail: IntegrationQuarantineFailureDetail.make("provider run ended after no owned activity remained"),
      ownedActivityProvenAbsentAt: JournalPosition.make(2)
    })
    const event = quarantineEventFor("provider-failure", basis)
    const { journal } = yield* appendQuarantine("provider-failure", event)
    const state = deriveIntegrationQuarantineState(yield* journal.read(runId), event.correlation.sessionId)
    expect(state._tag).toBe("Quarantined")
    expect(event.basis).toMatchObject({ _tag: "ProviderRunFailure", ownedActivityProvenAbsentAt: 2 })
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("rejects arbitrary Journal history as proof that a provider run has no owned activity", () =>
  Effect.gen(function* () {
    const basis = IntegrationQuarantineBasis.cases.ProviderRunFailure.make({
      detail: IntegrationQuarantineFailureDetail.make("provider activity absence is required"),
      ownedActivityProvenAbsentAt: JournalPosition.make(2)
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
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
    }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
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
            key: JournalRecordKey.make("missing-retry-successor"),
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
            key: JournalRecordKey.make("foreign-retry-successor"),
            position: JournalPosition.make(100),
            runId
          }
        ],
        prior.correlation.sessionId
      )._tag
    ).toBe("Contradiction")
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
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
      IntegratorResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({
          correlation: prior.correlation,
          detail: IntegratorNotPreparedDetail.make("later conclusive result")
        }),
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
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(legacyMemoryJournalStoreLayer))
)

it.effect("applies a recorded Retry after restart without another user request", () =>
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
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
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
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
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
      correlation: IntegratorCorrelation.make({ ...baseCorrelation, plannedAttempt: subjectAttempt }),
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
    const { record } = yield* appendQuarantine("run-mismatch", event)
    const control = yield* IntegrationQuarantineDirectionControl
    const request = requestFor(fingerprintFor(event, record.position, "Retry"), "wrong-run")
    const rejection = yield* control.apply(request).pipe(Effect.flip)

    expect(rejection).toBeInstanceOf(IntegrationQuarantineDirectionRequestRunMismatch)
  }).pipe(Effect.provide(integrationQuarantineDirectionControlLayer), Effect.provide(legacyMemoryJournalStoreLayer))
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
