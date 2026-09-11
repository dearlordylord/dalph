import { GitCommitSha, RunId, makeTaskWorkSpecification } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Context, Effect, Layer, Ref, Schema } from "effect"
import { expect } from "vitest"
import { makeAcceptedIntegrationHistory } from "../../../../test/support/accepted-integration-history.js"
import { makePromotedIntegrationHistory } from "../../../../test/support/promoted-integration-history.js"
import { ActiveTaskClaim } from "../../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../../../coordination/admission/capacity.js"
import { InitialControlPolicy } from "../../../control/policy.js"
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import {
  integrationQuarantinedRecordKey,
  targetPromotionAttemptIntentRecordKey,
  targetPromotionIntentRecordKey,
  targetPromotionStaleRecordKey
} from "../../../workflow-journal/record-key.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import { journalEvidenceFrom } from "../../../workflow-journal/record-evidence.js"
import {
  InRunJournal,
  JournalStore,
  JournalStoreContradiction,
  type JournalRecord
} from "../../../workflow-journal/store.js"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import { liveJournalTestLayer } from "../../../coordination/delivery/live-journal-test-layer.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { OperationId } from "../../identity.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { IntegratorSessionCorrelation, IntegratorSessionId } from "../integrator/events.js"
import {
  TargetPromotionAttemptIntendedEvent,
  TargetPromotionAttemptOrdinal,
  TargetPromotionAttemptReason,
  TargetPromotionCompareAndSetFailure,
  TargetPromotionGit,
  TargetPromotionGitReadFailure,
  TargetPromotionGitReadObservation,
  targetPromotionCorrelationFor,
  TargetPromotionIntendedEvent,
  TargetPromotionStaleEvent,
  TargetPromotionStaleObservation,
  TargetPromotionTerminalBasis
} from "../target-promotion/events.js"
import { runTargetPromotion } from "../target-promotion/protocol.js"
import {
  appendPromotionStaleIntegrationQuarantine,
  IntegrationPromotionStaleQuarantineRejected,
  pendingPromotionStaleIntegrationQuarantineFor
} from "./promotion-stale.js"
import {
  promotionStaleQuarantineEvidenceIssue,
  validatePromotionStaleQuarantineEvidence
} from "./promotion-stale-evidence.js"
import { deriveIntegrationQuarantineState } from "./state.js"
import { IntegrationQuarantineBasis, IntegrationQuarantinedEvent } from "./events.js"

const candidate = integrationFinalityFixture.qualifiedCandidate
const correlation = targetPromotionCorrelationFor(candidate)
const runId = candidate.run.session.plannedAttempt.runId
const target = FixtureTarget.make("promotion-stale-quarantine-target")
const attemptOrdinal = TargetPromotionAttemptOrdinal.make(1)
const changedHead = GitCommitSha.make("4".repeat(40))

type StaleKind = "BeforeFirstAttempt" | "DirectRejectionAfterAttempt" | "StaleAfterMissingAttemptIntent"

const appendStaleScenario = Effect.fn("PromotionStaleQuarantineTest.appendScenario")(function* (kind: StaleKind) {
  const journal = yield* JournalStore
  yield* journal.beginRun(runId, target, InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }))
  yield* journal.append(
    runId,
    targetPromotionIntentRecordKey(correlation.requestId),
    TargetPromotionIntendedEvent.make({ correlation, version: workflowJournalEventVersion })
  )
  const afterAttempt = kind !== "BeforeFirstAttempt"
  if (afterAttempt && kind !== "StaleAfterMissingAttemptIntent") {
    yield* journal.append(
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
  }
  return yield* journal.append(
    runId,
    targetPromotionStaleRecordKey(correlation.requestId),
    TargetPromotionStaleEvent.make({
      basis: afterAttempt
        ? TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal })
        : TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({}),
      correlation,
      observation:
        kind === "DirectRejectionAfterAttempt"
          ? TargetPromotionStaleObservation.cases.CompareAndSetRejected.make({ observedHeadSha: changedHead })
          : TargetPromotionStaleObservation.cases.ReconciledCandidateNotInAncestry.make({
              observedHeadSha: changedHead
            }),
      version: workflowJournalEventVersion
    })
  )
})

const appendRawQuarantine = Effect.fn("PromotionStaleQuarantineTest.appendRawQuarantine")(function* () {
  const stale = yield* appendStaleScenario("DirectRejectionAfterAttempt")
  const journal = yield* JournalStore
  const basis = IntegrationQuarantineBasis.cases.PromotionStale.make({
    candidateCommit: candidate.candidateCommit,
    observedTargetHead: changedHead,
    targetPromotionStaleAt: stale.position
  })
  return yield* journal.append(
    runId,
    integrationQuarantinedRecordKey(candidate.run.session.sessionId, basis),
    IntegrationQuarantinedEvent.make({
      basis,
      correlation: candidate.run.session,
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
  )
})

const liveQualifiedScenario = Effect.fn("PromotionStaleQuarantineTest.liveQualifiedScenario")(function* (
  suffix: string,
  records?: ReadonlyArray<JournalRecord>
) {
  const liveRunId = RunId.make(`promotion-stale-qualified:${suffix}`)
  const specification = makeTaskWorkSpecification({
    body: `Exercise target-promotion recovery ${suffix}.`,
    taskId: candidate.run.session.plannedAttempt.taskId,
    title: `Target-promotion recovery ${suffix}`
  })
  const plannedAttempt = {
    ...candidate.run.session.plannedAttempt,
    runId: liveRunId,
    taskRevision: specification.fingerprint
  }
  const activeClaim = ActiveTaskClaim.make({
    operationId: OperationId.make(`promotion-recovery-claim:${suffix}`),
    owner: ClaimOwner.make(`promotion-recovery-owner:${suffix}`),
    taskId: plannedAttempt.taskId,
    token: ClaimToken.make(`promotion-recovery-token:${suffix}`)
  })
  const accepted = makeAcceptedIntegrationHistory({
    acceptedResult: candidate.run.session.acceptedResult,
    activeClaim,
    integrationTarget: candidate.run.session.integrationTarget,
    plannedAttempt,
    runId: liveRunId,
    targetHeadSha: candidate.run.session.expectedTargetHead,
    taskSpecification: specification,
    trackerTarget: target
  })
  const session = IntegratorSessionCorrelation.make({
    ...candidate.run.session,
    plannedAttempt,
    queuedAt: accepted.responsibility.queuedAt,
    sessionId: IntegratorSessionId.make(`promotion-recovery-session:${suffix}`),
    startedAt: accepted.responsibility.startedAt,
    targetLineageObservedAt: accepted.targetLineageObservedAt
  })
  const qualified = makePromotedIntegrationHistory({
    candidateCommit: candidate.candidateCommit,
    candidateText: candidate.candidateText,
    originalClaim: activeClaim,
    records: accepted.records,
    session
  })
  const seededRecords = records ?? qualified.qualifiedRecords
  const live = yield* Layer.build(liveJournalTestLayer({ records: seededRecords, runId: liveRunId, target }))
  return {
    acceptedJournalReader: Context.get(live, AcceptedJournalReader),
    candidate: qualified.qualifiedCandidate,
    journal: Context.get(live, InRunJournal),
    records: seededRecords,
    runId: liveRunId
  }
})

const liveStaleScenario = Effect.fn("PromotionStaleQuarantineTest.liveStaleScenario")(function* (
  suffix: string,
  kind: "BeforeFirstAttempt" | "DirectRejectionAfterAttempt" = "DirectRejectionAfterAttempt"
) {
  const liveRunId = RunId.make(`promotion-stale-live:${suffix}`)
  const specification = makeTaskWorkSpecification({
    body: `Exercise promotion-stale quarantine ${suffix}.`,
    taskId: candidate.run.session.plannedAttempt.taskId,
    title: `Promotion-stale quarantine ${suffix}`
  })
  const plannedAttempt = {
    ...candidate.run.session.plannedAttempt,
    runId: liveRunId,
    taskRevision: specification.fingerprint
  }
  const activeClaim = ActiveTaskClaim.make({
    operationId: OperationId.make(`promotion-stale-claim:${suffix}`),
    owner: ClaimOwner.make(`promotion-stale-owner:${suffix}`),
    taskId: plannedAttempt.taskId,
    token: ClaimToken.make(`promotion-stale-token:${suffix}`)
  })
  const accepted = makeAcceptedIntegrationHistory({
    acceptedResult: candidate.run.session.acceptedResult,
    activeClaim,
    integrationTarget: candidate.run.session.integrationTarget,
    plannedAttempt,
    runId: liveRunId,
    targetHeadSha: candidate.run.session.expectedTargetHead,
    taskSpecification: specification,
    trackerTarget: target
  })
  const session = IntegratorSessionCorrelation.make({
    ...candidate.run.session,
    plannedAttempt,
    queuedAt: accepted.responsibility.queuedAt,
    sessionId: IntegratorSessionId.make(`promotion-stale-session:${suffix}`),
    startedAt: accepted.responsibility.startedAt,
    targetLineageObservedAt: accepted.targetLineageObservedAt
  })
  const qualified = makePromotedIntegrationHistory({
    candidateCommit: candidate.candidateCommit,
    candidateText: candidate.candidateText,
    originalClaim: activeClaim,
    records: accepted.records,
    session
  })
  const live = yield* Layer.build(
    liveJournalTestLayer({ records: qualified.qualifiedRecords, runId: liveRunId, target })
  )
  const journal = Context.get(live, InRunJournal)
  const promotionCorrelation = qualified.promotionCorrelation
  yield* journal.append(
    liveRunId,
    targetPromotionIntentRecordKey(promotionCorrelation.requestId),
    TargetPromotionIntendedEvent.make({ correlation: promotionCorrelation, version: workflowJournalEventVersion })
  )
  if (kind === "DirectRejectionAfterAttempt") {
    yield* journal.append(
      liveRunId,
      targetPromotionAttemptIntentRecordKey(promotionCorrelation.requestId, attemptOrdinal),
      TargetPromotionAttemptIntendedEvent.make({
        attemptOrdinal,
        correlation: promotionCorrelation,
        reason: TargetPromotionAttemptReason.cases.Initial.make({ observedHeadSha: session.expectedTargetHead }),
        version: workflowJournalEventVersion
      })
    )
  }
  const stale = yield* journal.append(
    liveRunId,
    targetPromotionStaleRecordKey(promotionCorrelation.requestId),
    TargetPromotionStaleEvent.make({
      basis:
        kind === "DirectRejectionAfterAttempt"
          ? TargetPromotionTerminalBasis.cases.AfterAttempt.make({ attemptOrdinal })
          : TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({}),
      correlation: promotionCorrelation,
      observation: TargetPromotionStaleObservation.cases.CompareAndSetRejected.make({ observedHeadSha: changedHead }),
      version: workflowJournalEventVersion
    })
  )
  return {
    acceptedJournalReader: Context.get(live, AcceptedJournalReader),
    candidate: qualified.qualifiedCandidate,
    correlation: promotionCorrelation,
    journal,
    stale
  }
})

const provideLive = <A, E, R>(
  scenario: {
    readonly acceptedJournalReader: AcceptedJournalReader["Service"]
    readonly journal: InRunJournal["Service"]
  },
  effect: Effect.Effect<A, E, R | AcceptedJournalReader | InRunJournal>
) =>
  effect.pipe(
    Effect.provideService(InRunJournal, scenario.journal),
    Effect.provideService(AcceptedJournalReader, scenario.acceptedJournalReader)
  )

it.effect("rejects quarantine after a stale pre-request read or a missing compare-and-set intent", () =>
  Effect.gen(function* () {
    for (const kind of ["BeforeFirstAttempt", "StaleAfterMissingAttemptIntent"] as const) {
      yield* Effect.gen(function* () {
        const stale = yield* appendStaleScenario(kind)
        const records = yield* (yield* JournalStore).read(runId)
        expect(pendingPromotionStaleIntegrationQuarantineFor(records, correlation)).toBeUndefined()
        expect(promotionStaleQuarantineEvidenceIssue(records, stale)).toBeDefined()
      }).pipe(Effect.provide(memoryJournalTestLayer))
    }
  })
)

it.effect("rejects non-stale and unchanged-head promotion evidence with exact diagnostics", () =>
  Effect.gen(function* () {
    const stale = yield* appendStaleScenario("DirectRejectionAfterAttempt")
    const journal = yield* JournalStore
    const records = yield* journal.read(runId)
    const attempt = records.find(({ event }) => event._tag === "TargetPromotionAttemptIntended")
    if (stale.event._tag !== "TargetPromotionStale" || attempt === undefined) {
      return yield* Effect.die("promotion evidence guard fixture lacks its stale result or attempt intent")
    }
    const unchangedHead = {
      ...stale,
      event: TargetPromotionStaleEvent.make({
        ...stale.event,
        observation: TargetPromotionStaleObservation.cases.CompareAndSetRejected.make({
          observedHeadSha: candidate.run.session.expectedTargetHead
        })
      })
    }

    for (const [label, evidence, expected] of [
      ["non-stale event", attempt, "evidence is not a target-promotion stale event"],
      ["unchanged expected head", unchangedHead, "promotion-stale quarantine cannot follow an unchanged expected head"]
    ] as const) {
      expect(promotionStaleQuarantineEvidenceIssue(records, evidence), label).toBe(expected)
    }
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects wrongly keyed stale-promotion evidence before it can authorize FullRerun", () =>
  Effect.gen(function* () {
    const stale = yield* appendStaleScenario("DirectRejectionAfterAttempt")
    const records = yield* (yield* JournalStore).read(runId)
    const wronglyKeyed = { ...stale, key: JournalRecordKey.make("foreign-stale-promotion-key") }

    expect(promotionStaleQuarantineEvidenceIssue(records, wronglyKeyed)).toBe(
      "promotion-stale evidence has a foreign Journal key"
    )
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("rejects every foreign or chronologically impossible promotion-stale quarantine relation", () =>
  Effect.gen(function* () {
    const quarantine = yield* appendRawQuarantine()
    const records = yield* (yield* JournalStore).read(runId)
    const stale = records.find(({ event }) => event._tag === "TargetPromotionStale")
    const attempt = records.find(({ event }) => event._tag === "TargetPromotionAttemptIntended")
    if (
      quarantine.event._tag !== "IntegrationQuarantined" ||
      stale?.event._tag !== "TargetPromotionStale" ||
      attempt === undefined
    ) {
      return yield* Effect.die("promotion-stale relation fixture lacks its stale result or attempt intent")
    }
    if (quarantine.event.basis._tag !== "PromotionStale") {
      return yield* Effect.die("promotion-stale relation fixture lacks its quarantine basis")
    }

    expect(
      promotionStaleQuarantineEvidenceIssue(records, { ...stale, runId: RunId.make("foreign-promotion-stale-run") })
    ).toBe("promotion-stale evidence has a foreign Journal Run")

    const foreignRunQuarantine = { ...quarantine, runId: RunId.make("foreign-promotion-quarantine-run") }
    const foreignKeyQuarantine = { ...quarantine, key: JournalRecordKey.make("foreign-promotion-quarantine-key") }
    const duplicateStaleRecords = [...records, { ...stale }]
    const foreignStaleKeyRecords = records.map((record) =>
      record.position === stale.position ? { ...record, key: JournalRecordKey.make("foreign-stale-key") } : record
    )
    const nonQuarantine = attempt
    const lateQuarantine = { ...quarantine, position: stale.position }

    const foreignCandidateBasis = { ...quarantine.event.basis, candidateCommit: GitCommitSha.make("7".repeat(40)) }
    const foreignCandidateQuarantine = {
      ...quarantine,
      event: { ...quarantine.event, basis: foreignCandidateBasis },
      key: integrationQuarantinedRecordKey(quarantine.event.correlation.sessionId, foreignCandidateBasis)
    }
    const foreignObservedHeadBasis = {
      ...quarantine.event.basis,
      observedTargetHead: GitCommitSha.make("8".repeat(40))
    }
    const foreignObservedHeadQuarantine = {
      ...quarantine,
      event: { ...quarantine.event, basis: foreignObservedHeadBasis },
      key: integrationQuarantinedRecordKey(quarantine.event.correlation.sessionId, foreignObservedHeadBasis)
    }

    for (const [label, candidateRecords, candidateQuarantine, detail] of [
      ["non-quarantine", records, nonQuarantine, "evidence is not a promotion-stale quarantine"],
      ["foreign Run", records, foreignRunQuarantine, "promotion-stale quarantine has a foreign Journal Run"],
      ["foreign key", records, foreignKeyQuarantine, "promotion-stale quarantine has a foreign Journal key"],
      [
        "duplicate stale position",
        duplicateStaleRecords,
        quarantine,
        "promotion-stale quarantine lacks one exact stale record"
      ],
      ["foreign stale key", foreignStaleKeyRecords, quarantine, "promotion-stale evidence has a foreign Journal key"],
      ["late stale evidence", records, lateQuarantine, "promotion-stale evidence must precede its quarantine"],
      [
        "foreign candidate commit",
        records,
        foreignCandidateQuarantine,
        "promotion-stale quarantine names a foreign candidate commit"
      ],
      [
        "foreign observed head",
        records,
        foreignObservedHeadQuarantine,
        "promotion-stale quarantine names a foreign observed target head"
      ]
    ] as const) {
      expect(validatePromotionStaleQuarantineEvidence(candidateRecords, candidateQuarantine), label).toEqual({
        _tag: "Invalid",
        detail
      })
    }
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("records one quarantine after Git directly rejects the exact compare-and-set", () =>
  Effect.gen(function* () {
    const scenario = yield* liveStaleScenario("direct")
    const first = yield* provideLive(
      scenario,
      appendPromotionStaleIntegrationQuarantine({
        correlation: scenario.correlation,
        targetPromotionStaleAt: scenario.stale.position
      })
    )
    const second = yield* appendPromotionStaleIntegrationQuarantine({
      correlation: scenario.correlation,
      targetPromotionStaleAt:
        first.event.basis._tag === "PromotionStale" ? first.event.basis.targetPromotionStaleAt : first.position
    }).pipe((effect) => provideLive(scenario, effect))
    expect(first.event._tag).toBe("IntegrationQuarantined")
    expect(first.event.basis._tag).toBe("PromotionStale")
    expect(second).toEqual(first)
  })
)

it.effect("compares promotion-stale session correlations by schema value rather than property insertion order", () =>
  Effect.gen(function* () {
    const scenario = yield* liveStaleScenario("reordered")
    const quarantine = yield* provideLive(
      scenario,
      appendPromotionStaleIntegrationQuarantine({
        correlation: scenario.correlation,
        targetPromotionStaleAt: scenario.stale.position
      })
    )
    const records = yield* scenario.journal.read(
      scenario.correlation.qualifiedCandidate.run.session.plannedAttempt.runId
    )
    const original = quarantine.event.correlation
    const reordered = {
      targetLineageObservedAt: original.targetLineageObservedAt,
      startedAt: original.startedAt,
      sessionId: original.sessionId,
      queuedAt: original.queuedAt,
      plannedAttempt: original.plannedAttempt,
      integrationTarget: original.integrationTarget,
      expectedTargetHead: original.expectedTargetHead,
      candidateResource: original.candidateResource,
      acceptedResult: original.acceptedResult
    } satisfies IntegratorSessionCorrelation
    expect(Schema.is(IntegratorSessionCorrelation)(reordered)).toBe(true)

    expect(
      validatePromotionStaleQuarantineEvidence(records, {
        ...quarantine,
        event: { ...quarantine.event, correlation: reordered }
      })._tag
    ).toBe("Valid")

    const foreign = {
      ...reordered,
      expectedTargetHead: GitCommitSha.make("6".repeat(40))
    } satisfies IntegratorSessionCorrelation
    expect(
      validatePromotionStaleQuarantineEvidence(records, {
        ...quarantine,
        event: { ...quarantine.event, correlation: foreign }
      })
    ).toEqual({ _tag: "Invalid", detail: "promotion-stale quarantine names a foreign Integrator session" })
  })
)

it.effect("reports exact pending quarantine work until the stale evidence is settled", () =>
  Effect.gen(function* () {
    const scenario = yield* liveStaleScenario("pending")
    const scenarioRunId = scenario.correlation.qualifiedCandidate.run.session.plannedAttempt.runId
    expect(
      pendingPromotionStaleIntegrationQuarantineFor(
        journalEvidenceFrom(yield* scenario.journal.read(scenarioRunId)),
        scenario.correlation
      )
    ).toEqual({ correlation: scenario.correlation, targetPromotionStaleAt: scenario.stale.position })
    yield* provideLive(
      scenario,
      appendPromotionStaleIntegrationQuarantine({
        correlation: scenario.correlation,
        targetPromotionStaleAt: scenario.stale.position
      })
    )
    expect(
      pendingPromotionStaleIntegrationQuarantineFor(yield* scenario.journal.read(scenarioRunId), scenario.correlation)
    ).toBeUndefined()
  })
)

it.effect("recovers an exact ambiguous quarantine winner and rejects malformed cold evidence", () =>
  Effect.gen(function* () {
    const scenario = yield* liveStaleScenario("ambiguous")
    const scenarioRunId = scenario.correlation.qualifiedCandidate.run.session.plannedAttempt.runId
    const prefix = yield* scenario.journal.read(scenarioRunId)
    const input = { correlation: scenario.correlation, targetPromotionStaleAt: scenario.stale.position }

    const wrongPosition = yield* appendPromotionStaleIntegrationQuarantine({
      ...input,
      targetPromotionStaleAt: JournalPosition.make(Number(scenario.stale.position) + 10)
    }).pipe((effect) => provideLive(scenario, effect), Effect.flip)
    expect(wrongPosition).toBeInstanceOf(IntegrationPromotionStaleQuarantineRejected)

    const basis = IntegrationQuarantineBasis.cases.PromotionStale.make({
      candidateCommit: scenario.candidate.candidateCommit,
      observedTargetHead: changedHead,
      targetPromotionStaleAt: scenario.stale.position
    })
    const foreignWinner: JournalRecord = {
      event: IntegrationQuarantinedEvent.make({
        basis,
        correlation: { ...scenario.candidate.run.session, sessionId: IntegratorSessionId.make("foreign-session") },
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      }),
      key: integrationQuarantinedRecordKey(scenario.candidate.run.session.sessionId, basis),
      position: JournalPosition.make(prefix.length + 1),
      runId: scenarioRunId
    }
    expect(validatePromotionStaleQuarantineEvidence([...prefix, foreignWinner], foreignWinner)._tag).toBe("Invalid")

    const missingAfterContradiction = yield* appendPromotionStaleIntegrationQuarantine(input).pipe(
      Effect.provideService(
        InRunJournal,
        InRunJournal.of({
          append: (requestedRunId, key) =>
            Effect.fail(
              new JournalStoreContradiction({ existingPosition: scenario.stale.position, key, runId: requestedRunId })
            ),
          read: () => Effect.die("live promotion-stale recovery must use accepted indexed evidence")
        })
      ),
      Effect.provideService(AcceptedJournalReader, scenario.acceptedJournalReader),
      Effect.flip
    )
    expect(missingAfterContradiction).toBeInstanceOf(IntegrationPromotionStaleQuarantineRejected)

    const racingJournal = InRunJournal.of({
      append: (requestedRunId, key, event) =>
        Effect.gen(function* () {
          const winner = yield* scenario.journal.append(requestedRunId, key, event)
          return yield* new JournalStoreContradiction({ existingPosition: winner.position, key, runId: requestedRunId })
        }),
      read: () => Effect.die("live promotion-stale recovery must use accepted indexed evidence")
    })
    const exactAfterContradiction = yield* appendPromotionStaleIntegrationQuarantine(input).pipe(
      Effect.provideService(InRunJournal, racingJournal),
      Effect.provideService(AcceptedJournalReader, scenario.acceptedJournalReader)
    )
    expect(exactAfterContradiction.event._tag).toBe("IntegrationQuarantined")
  })
)

it.effect("reconstructs promotion-stale quarantine only from one exact earlier compare-and-set intent", () =>
  Effect.gen(function* () {
    const quarantine = yield* appendRawQuarantine()
    const journal = yield* JournalStore
    const records = yield* journal.read(runId)
    const stale = records.find(({ event }) => event._tag === "TargetPromotionStale")
    const attempt = records.find(({ event }) => event._tag === "TargetPromotionAttemptIntended")
    if (
      quarantine.event._tag !== "IntegrationQuarantined" ||
      stale?.event._tag !== "TargetPromotionStale" ||
      attempt?.event._tag !== "TargetPromotionAttemptIntended"
    ) {
      return yield* Effect.die("promotion-stale reconstruction fixture lacks its exact attempt and stale records")
    }
    const staleEvent = stale.event
    const attemptEvent = attempt.event

    expect(deriveIntegrationQuarantineState(records, quarantine.event.correlation.sessionId)._tag).toBe("Quarantined")

    const beforeFirstAttempt: ReadonlyArray<JournalRecord> = records.map((record) =>
      record.position === stale.position
        ? {
            ...record,
            event: TargetPromotionStaleEvent.make({
              ...staleEvent,
              basis: TargetPromotionTerminalBasis.cases.BeforeFirstAttempt.make({})
            })
          }
        : record
    )
    const withoutAttempt: ReadonlyArray<JournalRecord> = records.filter(
      (record) => record.position !== attempt.position
    )
    const duplicateAttempt: ReadonlyArray<JournalRecord> = [...records, { ...attempt }]
    const foreignAttempt: ReadonlyArray<JournalRecord> = records.map((record) =>
      record.position === attempt.position
        ? {
            ...record,
            event: {
              ...attemptEvent,
              correlation: {
                ...attemptEvent.correlation,
                qualifiedCandidate: {
                  ...attemptEvent.correlation.qualifiedCandidate,
                  candidateCommit: GitCommitSha.make("5".repeat(40))
                }
              }
            }
          }
        : record
    )
    const mismatchedAttempt: ReadonlyArray<JournalRecord> = records.map((record) =>
      record.position === attempt.position
        ? { ...record, event: { ...attemptEvent, attemptOrdinal: TargetPromotionAttemptOrdinal.make(2) } }
        : record
    )

    for (const [label, invalid] of [
      ["BeforeFirstAttempt stale evidence", beforeFirstAttempt],
      ["zero compare-and-set intents", withoutAttempt],
      ["duplicate compare-and-set intents", duplicateAttempt],
      ["foreign promotion attempt", foreignAttempt],
      ["mismatched attempt ordinal", mismatchedAttempt]
    ] as const) {
      const state = deriveIntegrationQuarantineState(invalid, quarantine.event.correlation.sessionId)
      expect(state._tag, label).toBe("Contradiction")
      if (state._tag === "Contradiction") {
        expect(state.detail, label).toContain("exact earlier Journal facts")
      }
    }
  }).pipe(Effect.provide(memoryJournalTestLayer))
)

it.effect("checks Git after losing the compare-and-set response and records at most one quarantine", () =>
  Effect.gen(function* () {
    const initial = yield* liveQualifiedScenario("lost-response")
    const promotionCandidate = initial.candidate
    const calls = yield* Ref.make<ReadonlyArray<"compare-and-set" | "read">>([])
    const readCount = yield* Ref.make(0)
    const git = TargetPromotionGit.of({
      compareAndSet: () =>
        Ref.update(calls, (current) => [...current, "compare-and-set" as const]).pipe(
          Effect.andThen(
            Effect.fail(
              new TargetPromotionCompareAndSetFailure({
                candidateCommit: promotionCandidate.candidateCommit,
                detail: "Git changed H to H2 but the compare-and-set response was lost",
                expectedHead: promotionCandidate.run.session.expectedTargetHead,
                target: promotionCandidate.run.session.integrationTarget
              })
            )
          )
        ),
      read: () =>
        Ref.update(calls, (current) => [...current, "read" as const]).pipe(
          Effect.andThen(Ref.getAndUpdate(readCount, (count) => count + 1)),
          Effect.map((count) =>
            TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({
              currentHeadSha: count === 0 ? promotionCandidate.run.session.expectedTargetHead : changedHead
            })
          )
        )
    })

    const first = yield* runTargetPromotion(promotionCandidate).pipe(
      Effect.provideService(TargetPromotionGit, git),
      (effect) => provideLive(initial, effect)
    )
    expect(first._tag).toBe("PromotionPending")
    const restartPrefix = yield* initial.journal.read(initial.runId)
    expect(restartPrefix.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")).toHaveLength(1)
    expect(restartPrefix.filter(({ event }) => event._tag === "TargetPromotionStale")).toHaveLength(0)
    expect(restartPrefix.filter(({ event }) => event._tag === "IntegrationQuarantined")).toHaveLength(0)
    expect(restartPrefix.some(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")).toBe(false)
    expect(yield* Ref.get(calls)).toEqual(["read", "compare-and-set"])

    const recovered = yield* liveQualifiedScenario("lost-response", restartPrefix)
    const recoveredRecords = yield* Effect.gen(function* () {
      const reconciled = yield* runTargetPromotion(promotionCandidate).pipe(
        Effect.provideService(TargetPromotionGit, git),
        (effect) => provideLive(recovered, effect)
      )
      expect(reconciled).toMatchObject({
        _tag: "PromotionStale",
        basis: { _tag: "AfterAttempt", attemptOrdinal: 1 },
        observation: { _tag: "ReconciledCandidateNotInAncestry", observedHeadSha: changedHead }
      })
      const records = yield* recovered.journal.read(recovered.runId)
      const stale = records.find(({ event }) => event._tag === "TargetPromotionStale")
      if (stale?.event._tag !== "TargetPromotionStale") {
        return yield* Effect.die("lost-response reconciliation did not record the exact stale result")
      }
      const firstQuarantine = yield* provideLive(
        recovered,
        appendPromotionStaleIntegrationQuarantine({
          correlation: stale.event.correlation,
          targetPromotionStaleAt: stale.position
        })
      )
      const secondQuarantine = yield* provideLive(
        recovered,
        appendPromotionStaleIntegrationQuarantine({
          correlation: stale.event.correlation,
          targetPromotionStaleAt: stale.position
        })
      )
      expect(secondQuarantine).toEqual(firstQuarantine)
      expect(firstQuarantine.event.correlation).toEqual(promotionCandidate.run.session)
      expect(stale.event.correlation.qualifiedCandidate).toEqual(promotionCandidate)
      return yield* recovered.journal.read(recovered.runId)
    })
    expect(yield* Ref.get(calls)).toEqual(["read", "compare-and-set", "read"])
    expect(recoveredRecords.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")).toHaveLength(1)
    expect(recoveredRecords.filter(({ event }) => event._tag === "TargetPromotionStale")).toHaveLength(1)
    expect(recoveredRecords.filter(({ event }) => event._tag === "IntegrationQuarantined")).toHaveLength(1)
    expect(recoveredRecords.some(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")).toBe(false)
  })
)

it.effect("does not retry or authorize quarantine when restart cannot read Git", () =>
  Effect.gen(function* () {
    const scenario = yield* liveQualifiedScenario("read-failure")
    const promotionCandidate = scenario.candidate
    const calls = yield* Ref.make<ReadonlyArray<"compare-and-set" | "read">>([])
    const readCount = yield* Ref.make(0)
    const readFailure = new TargetPromotionGitReadFailure({
      candidateCommit: promotionCandidate.candidateCommit,
      detail: "Git is unavailable during restart reconciliation",
      target: promotionCandidate.run.session.integrationTarget
    })
    const git = TargetPromotionGit.of({
      compareAndSet: () =>
        Ref.update(calls, (current) => [...current, "compare-and-set" as const]).pipe(
          Effect.andThen(
            Effect.fail(
              new TargetPromotionCompareAndSetFailure({
                candidateCommit: promotionCandidate.candidateCommit,
                detail: "compare-and-set response was lost",
                expectedHead: promotionCandidate.run.session.expectedTargetHead,
                target: promotionCandidate.run.session.integrationTarget
              })
            )
          )
        ),
      read: () =>
        Ref.update(calls, (current) => [...current, "read" as const]).pipe(
          Effect.andThen(Ref.getAndUpdate(readCount, (count) => count + 1)),
          Effect.flatMap((count) =>
            count === 0
              ? Effect.succeed(
                  TargetPromotionGitReadObservation.cases.CandidateNotInAncestry.make({
                    currentHeadSha: promotionCandidate.run.session.expectedTargetHead
                  })
                )
              : Effect.fail(readFailure)
          )
        )
    })

    expect(
      (yield* runTargetPromotion(promotionCandidate).pipe(Effect.provideService(TargetPromotionGit, git), (effect) =>
        provideLive(scenario, effect)
      ))._tag
    ).toBe("PromotionPending")
    expect(
      yield* runTargetPromotion(promotionCandidate).pipe(
        Effect.provideService(TargetPromotionGit, git),
        (effect) => provideLive(scenario, effect),
        Effect.flip
      )
    ).toBe(readFailure)
    const records = yield* scenario.journal.read(scenario.runId)
    expect(yield* Ref.get(calls)).toEqual(["read", "compare-and-set", "read"])
    expect(records.filter(({ event }) => event._tag === "TargetPromotionAttemptIntended")).toHaveLength(1)
    expect(records.filter(({ event }) => event._tag === "TargetPromotionStale")).toHaveLength(0)
    expect(records.filter(({ event }) => event._tag === "IntegrationQuarantined")).toHaveLength(0)
    expect(records.some(({ event }) => event._tag === "IntegratorSuccessorSessionFixed")).toBe(false)
  })
)
