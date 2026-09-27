import { GitCommitSha, makeTaskWorkSpecification } from "@dalph/contracts"
import { expect, it } from "@effect/vitest"
import { Context, Effect, Layer, Ref } from "effect"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import { Journal, type JournalService } from "../../../coordination/delivery/journal.js"
import { liveJournalTestLayer } from "../../../coordination/delivery/live-journal-test-layer.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { integratorCorrelationFor, integratorRunCorrelationForSession } from "../integrator/session.js"
import { makeAcceptedIntegrationHistory } from "../../../../test/support/accepted-integration-history.js"
import { makePromotedIntegrationHistory } from "../../../../test/support/promoted-integration-history.js"
import { remotePublicationTargetForTest } from "../../../../test/support/direct-publication.js"
import {
  appendAutomaticSuccessorGeneration,
  makeSuccessorPrefix
} from "../../../../test/support/automatic-successor-history.js"
import { IntegrationResponsibilityIdentity } from "../integration-admission/responsibility.js"
import { ApplyControlDirectionRequest } from "../control-direction-application/request.js"
import {
  ControlDirectionApplication,
  controlDirectionApplicationLayer
} from "../control-direction-application/protocol.js"
import { ControlDirectionSubject } from "../control-direction-application/events.js"
import { journalRecordsOfKind } from "../../../workflow-journal/record-evidence.js"
import {
  integrationQuarantinedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey,
  integratorSessionFixedRecordKey,
  remotePublicationBatchGrantRecordKey
} from "../../../workflow-journal/record-key.js"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import {
  IntegratorNotPreparedDetail,
  IntegratorAutomaticSuccessorGeneration,
  IntegratorResult,
  IntegratorRunOrdinal,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorSessionFixedEvent
} from "../integrator/events.js"
import { prepareIntegratorAutomaticSuccessorSessionAppend } from "../integrator/automatic-successor-session.js"
import {
  deriveCurrentIntegratorState,
  integratorResponsibilityFactsFromCorrelation,
  integratorRunQualifiedCandidateFromState
} from "../integrator/state.js"
import { integratorSessionCapacityForJournal } from "../integrator/session-capacity.js"
import {
  IntegrationQuarantineBasis,
  IntegrationQuarantineCause,
  IntegrationQuarantineResultEvidence,
  IntegrationQuarantinedEvent
} from "../integration-quarantine/events.js"
import {
  RemotePublicationBatchGrantRequest,
  RemotePublicationBatchGrantRequestId,
  RemotePublicationGit,
  RemotePublicationGitObservation,
  RemotePublicationPushResult,
  remotePublicationCorrelationEquals,
  remotePublicationCorrelationFor
} from "./events.js"
import { applyRemotePublicationBatchGrantWithAdmission } from "./batch-grant-control.js"
import { makeRemotePublicationEngine } from "./protocol-engine.js"

const fixture = integrationFinalityFixture
const specification = makeTaskWorkSpecification({
  body: "Authorize one exact bounded batch after real publication exhaustion.",
  taskId: fixture.taskId,
  title: "Publication batch grant"
})
const plannedAttempt = { ...fixture.plannedAttempt, taskRevision: specification.fingerprint }
const accepted = makeAcceptedIntegrationHistory({
  acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
  activeClaim: fixture.activeClaim,
  integrationTarget: fixture.integrationTarget,
  plannedAttempt,
  runId: fixture.runId,
  targetHeadSha: fixture.qualifiedCandidate.run.session.expectedTargetHead,
  taskSpecification: specification,
  trackerTarget: fixture.target
})
const qualified = makePromotedIntegrationHistory({
  candidateCommit: fixture.qualifiedCandidate.candidateCommit,
  candidateText: fixture.qualifiedCandidate.candidateText,
  originalClaim: accepted.activeClaim,
  records: accepted.records,
  session: integratorCorrelationFor(accepted)
})
const prePublicationPrefix = qualified.qualifiedRecords
const candidate = qualified.qualifiedCandidate
const runId = fixture.runId

const buildJournal = () =>
  liveJournalTestLayer({ records: prePublicationPrefix, runId, target: accepted.trackerTarget })

const actualExhaustionPrefix = Effect.fn("RemotePublicationBatchGrantTest.reachActualExhaustion")(function* (
  inRunJournal: InRunJournal["Service"]
) {
  const pushes = yield* Ref.make(0)
  const observations = yield* Ref.make(0)
  const git = RemotePublicationGit.of({
    admit: () => Effect.die("destination admission is outside this exact candidate publication test"),
    prepareSenderCustody: () => Effect.void,
    reconcileSenderCustody: () => Effect.void,
    observe: () =>
      Ref.update(observations, (count) => count + 1).pipe(
        Effect.as(
          RemotePublicationGitObservation.cases.RemoteAncestorOfCandidate.make({
            remoteHead: candidate.run.session.expectedTargetHead
          })
        )
      ),
    push: () =>
      Ref.update(pushes, (count) => count + 1).pipe(
        Effect.as(RemotePublicationPushResult.cases.RejectedNonFastForward.make({}))
      )
  })
  const engine = makeRemotePublicationEngine((requestedRunId) => inRunJournal.read(requestedRunId))
  let result = yield* engine
    .runRemotePublication(candidate, remotePublicationTargetForTest, {
      runObservation: (phase) => phase,
      runSender: (phase) => phase
    })
    .pipe(Effect.provideService(InRunJournal, inRunJournal), Effect.provideService(RemotePublicationGit, git))
  for (let activation = 1; activation <= 3; activation += 1) {
    result = yield* engine
      .runRemotePublication(candidate, remotePublicationTargetForTest, {
        runObservation: (phase) => phase,
        runSender: (phase) => phase
      })
      .pipe(Effect.provideService(InRunJournal, inRunJournal), Effect.provideService(RemotePublicationGit, git))
  }
  expect(result).toMatchObject({ _tag: "PublicationRetained", cause: { _tag: "AttemptsExhausted" } })
  expect(yield* Ref.get(observations)).toBe(4)
  expect(yield* Ref.get(pushes)).toBe(3)
  return { observations, pushes }
})

const grantRequest = (requestId: string, exhaustionAt: RemotePublicationBatchGrantRequest["exhaustionAt"]) =>
  RemotePublicationBatchGrantRequest.make({
    exhaustionAt,
    requestId: RemotePublicationBatchGrantRequestId.make(requestId),
    responsibility: IntegrationResponsibilityIdentity.make({ queuedAt: candidate.run.session.queuedAt, runId }),
    runId,
    schemaVersion: 1
  })

const applyRealPause = Effect.fn("RemotePublicationBatchGrantTest.applyPause")(function* (
  inRunJournal: InRunJournal["Service"],
  acceptedJournal: AcceptedJournalReader["Service"]
) {
  const pauseLayer = controlDirectionApplicationLayer.pipe(
    Layer.provide(
      Layer.merge(Layer.succeed(InRunJournal, inRunJournal), Layer.succeed(AcceptedJournalReader, acceptedJournal))
    )
  )
  const pauseContext = yield* Layer.build(pauseLayer)
  const control = Context.get(pauseContext, ControlDirectionApplication)
  return yield* control.apply(
    ApplyControlDirectionRequest.make({
      direction: "Pause",
      subject: ControlDirectionSubject.cases.Run.make({ runId })
    })
  )
})

const recordsFrom = (journal: JournalService) => journal.state.get.pipe(Effect.map(({ prefix }) => prefix))

it.effect(
  "records one exact publication exhaustion Full rerun grant during Pause and replays it without a second batch",
  () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(buildJournal())
      const inRunJournal = Context.get(context, InRunJournal)
      const journal = Context.get(context, Journal)
      const acceptedJournal = Context.get(context, AcceptedJournalReader)
      const { observations, pushes } = yield* actualExhaustionPrefix(inRunJournal)
      const beforePause = yield* journal.state.get
      const retained = Array.from(journalRecordsOfKind(beforePause.prefix, "RemotePublicationRetained")).findLast(
        ({ event }) => event._tag === "RemotePublicationRetained" && event.cause._tag === "AttemptsExhausted"
      )
      if (retained?.event._tag !== "RemotePublicationRetained") {
        return yield* Effect.die("actual engine prefix must retain exact exhaustion")
      }
      const currentIntegrator = deriveCurrentIntegratorState(beforePause.prefix, accepted.responsibility)
      expect(currentIntegrator._tag).toBe("GitQualifiedPrepared")
      if (currentIntegrator._tag !== "GitQualifiedPrepared") {
        return yield* Effect.die("actual exhaustion prefix must retain its exact current qualified candidate")
      }
      expect(
        remotePublicationCorrelationEquals(
          retained.event.correlation,
          remotePublicationCorrelationFor(
            integratorRunQualifiedCandidateFromState(currentIntegrator),
            remotePublicationTargetForTest
          )
        )
      ).toBe(true)

      yield* applyRealPause(inRunJournal, acceptedJournal)
      const request = grantRequest("full-rerun-grant-exhaustion-o1", retained.position)
      const newlyRecorded = yield* applyRemotePublicationBatchGrantWithAdmission(runId, journal, request)
      const exactReplay = yield* applyRemotePublicationBatchGrantWithAdmission(runId, journal, request)
      const otherRequestId = grantRequest("full-rerun-grant-second-delivery-id", retained.position)
      const sameSubject = yield* applyRemotePublicationBatchGrantWithAdmission(runId, journal, otherRequestId)
      const afterGrant = yield* journal.state.get

      expect(newlyRecorded._tag).toBe("NewlyRecordedBatchGrant")
      expect(exactReplay._tag).toBe("BatchGrantReplay")
      expect(sameSubject._tag).toBe("BatchGrantAlreadyRecordedForExhaustion")
      expect(exactReplay.result).toEqual(newlyRecorded.result)
      expect(sameSubject.result).toEqual(newlyRecorded.result)
      expect(sameSubject.result.requestId).toBe(request.requestId)
      expect(remotePublicationBatchGrantRecordKey(otherRequestId)).toEqual(
        remotePublicationBatchGrantRecordKey(request)
      )
      expect(newlyRecorded.result.exhaustionAt).toBe(retained.position)
      expect(Array.from(journalRecordsOfKind(afterGrant.prefix, "RemotePublicationBatchGrantApplied"))).toHaveLength(1)
      expect(
        Array.from(journalRecordsOfKind(afterGrant.prefix, "ControlDirectionApplied")).at(-1)?.event
      ).toMatchObject({ direction: "Pause", subject: { _tag: "Run", runId } })
      expect(Array.from(journalRecordsOfKind(afterGrant.prefix, "RemotePublicationAttemptIntended"))).toHaveLength(3)
      expect(Array.from(journalRecordsOfKind(afterGrant.prefix, "IntegratorSessionFixed"))).toHaveLength(
        Array.from(journalRecordsOfKind(beforePause.prefix, "IntegratorSessionFixed")).length
      )
      expect(yield* Ref.get(observations)).toBe(4)
      expect(yield* Ref.get(pushes)).toBe(3)
      const grantRecord = Array.from(journalRecordsOfKind(afterGrant.prefix, "RemotePublicationBatchGrantApplied"))[0]
      expect(grantRecord?.key).toEqual(remotePublicationBatchGrantRecordKey(request))
      expect(grantRecord?.event).toMatchObject({ direction: "FullRerun", request })
      expect(grantRecord?.position).toBe(newlyRecorded.result.acceptedAt)
      expect(
        Array.from(journalRecordsOfKind(afterGrant.prefix, "RemotePublicationAttemptIntended")).at(-1)?.position
      ).toBeLessThan(grantRecord?.position ?? 0)
    })
)

it.effect("rejects a publication batch grant for an unrelated quarantine occurrence", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(
      liveJournalTestLayer({ records: accepted.records, runId, target: accepted.trackerTarget })
    )
    const inRunJournal = Context.get(context, InRunJournal)
    const journal = Context.get(context, Journal)
    const session = integratorCorrelationFor(accepted)
    const run = integratorRunCorrelationForSession(session, IntegratorRunOrdinal.make(1))
    yield* inRunJournal.append(
      runId,
      integratorSessionFixedRecordKey(integratorResponsibilityFactsFromCorrelation(session)),
      IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion })
    )
    yield* inRunJournal.append(
      runId,
      integratorRunStartedRecordKey(run),
      IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
    )
    const detail = IntegratorNotPreparedDetail.make("the Integrator returned no candidate")
    const resultRecord = yield* inRunJournal.append(
      runId,
      integratorRunResultRecordedRecordKey(run),
      IntegratorRunResultRecordedEvent.make({
        result: IntegratorResult.cases.NotPrepared.make({ correlation: run, detail }),
        run,
        version: workflowJournalEventVersion
      })
    )
    const basis = IntegrationQuarantineBasis.cases.ConclusiveResult.make({
      cause: IntegrationQuarantineCause.cases.NotPrepared.make({ detail }),
      evidence: IntegrationQuarantineResultEvidence.make({ resultRecordedAt: resultRecord.position })
    })
    const quarantine = yield* inRunJournal.append(
      runId,
      integrationQuarantinedRecordKey(session.sessionId, basis),
      IntegrationQuarantinedEvent.make({
        basis,
        correlation: session,
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      })
    )
    const request = grantRequest("unrelated-quarantine", quarantine.position)
    const result = yield* applyRemotePublicationBatchGrantWithAdmission(runId, journal, request).pipe(Effect.flip)
    expect(result._tag).toBe("RemotePublicationBatchGrantSubjectMismatch")
    expect(
      Array.from(journalRecordsOfKind(yield* recordsFrom(journal), "RemotePublicationBatchGrantApplied"))
    ).toHaveLength(0)
  })
)

it.effect("rejects a superseded exhaustion occurrence after a later successor candidate becomes current", () =>
  Effect.gen(function* () {
    const successor = makeSuccessorPrefix()
    const firstRetained = Array.from(journalRecordsOfKind(successor.records(), "RemotePublicationRetained")).find(
      ({ event }) => event._tag === "RemotePublicationRetained"
    )
    expect(firstRetained?.event._tag).toBe("RemotePublicationRetained")
    if (firstRetained?.event._tag !== "RemotePublicationRetained") {
      return yield* Effect.die("accepted successor prefix must retain the first competing-head occurrence")
    }

    const second = yield* prepareIntegratorAutomaticSuccessorSessionAppend(successor.input, successor.reduction.prefix)
    if (second._tag !== "Append") return yield* Effect.die("the exact first authorization must fix session two")
    successor.append(second.event)
    const thirdPrefix = appendAutomaticSuccessorGeneration(
      successor,
      second.event.successor,
      GitCommitSha.make("8".repeat(40)),
      IntegratorAutomaticSuccessorGeneration.make(2)
    )
    const third = yield* prepareIntegratorAutomaticSuccessorSessionAppend(
      thirdPrefix.input,
      thirdPrefix.reduction.prefix
    )
    if (third._tag !== "Append") return yield* Effect.die("the exact second authorization must fix session three")
    successor.append(third.event)
    appendAutomaticSuccessorGeneration(
      successor,
      third.event.successor,
      GitCommitSha.make("9".repeat(40)),
      IntegratorAutomaticSuccessorGeneration.make(3)
    )

    const prefix = successor.records()
    const capacity = integratorSessionCapacityForJournal(
      prefix,
      firstRetained.event.correlation.qualifiedCandidate.run.session
    )
    expect(capacity._tag).toBe("Exhausted")
    const current = deriveCurrentIntegratorState(prefix, successor.accepted.responsibility)
    expect(current._tag).toBe("GitQualifiedPrepared")
    if (current._tag !== "GitQualifiedPrepared") {
      return yield* Effect.die("the third successor candidate must be the current qualified candidate")
    }
    const currentCorrelation = remotePublicationCorrelationFor(
      integratorRunQualifiedCandidateFromState(current),
      remotePublicationTargetForTest
    )
    const currentRetained = Array.from(journalRecordsOfKind(prefix, "RemotePublicationRetained")).findLast(
      (record) =>
        record.event._tag === "RemotePublicationRetained" &&
        remotePublicationCorrelationEquals(record.event.correlation, currentCorrelation)
    )
    expect(currentRetained?.event._tag).toBe("RemotePublicationRetained")
    if (currentRetained?.event._tag !== "RemotePublicationRetained") {
      return yield* Effect.die("the current third-session candidate must retain its competing-head occurrence")
    }

    const journalContext = yield* Layer.build(
      liveJournalTestLayer({ records: prefix, runId: successor.runId, target: successor.accepted.trackerTarget })
    )
    const journal = Context.get(journalContext, Journal)
    const requestFor = (requestId: string, exhaustionAt: RemotePublicationBatchGrantRequest["exhaustionAt"]) =>
      RemotePublicationBatchGrantRequest.make({
        exhaustionAt,
        requestId: RemotePublicationBatchGrantRequestId.make(requestId),
        responsibility: IntegrationResponsibilityIdentity.make({
          queuedAt: successor.accepted.responsibility.queuedAt,
          runId: successor.runId
        }),
        runId: successor.runId,
        schemaVersion: 1
      })
    const stale = yield* Effect.flip(
      applyRemotePublicationBatchGrantWithAdmission(
        successor.runId,
        journal,
        requestFor("stale-first-session-occurrence", firstRetained.position)
      )
    )
    expect(stale._tag).toBe("RemotePublicationBatchGrantSubjectMismatch")
    expect(
      Array.from(journalRecordsOfKind(yield* recordsFrom(journal), "RemotePublicationBatchGrantApplied"))
    ).toHaveLength(0)

    const currentGrant = yield* applyRemotePublicationBatchGrantWithAdmission(
      successor.runId,
      journal,
      requestFor("current-third-session-occurrence", currentRetained.position)
    )
    expect(currentGrant._tag).toBe("NewlyRecordedBatchGrant")
    expect(
      Array.from(journalRecordsOfKind(yield* recordsFrom(journal), "RemotePublicationBatchGrantApplied"))
    ).toHaveLength(1)
  })
)
