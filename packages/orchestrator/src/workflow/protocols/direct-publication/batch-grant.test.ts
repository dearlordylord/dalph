import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { GitCommitSha, makeTaskWorkSpecification } from "@dalph/contracts"
import { expect, it } from "@effect/vitest"
import { Context, Effect, FileSystem, Layer, Path, Ref } from "effect"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import { Journal, journalLayer, type JournalService } from "../../../coordination/delivery/journal.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { JournalDatabaseLocator, JournalPosition } from "../../../workflow-journal/identity.js"
import { sqliteJournalStoreLayer } from "../../../workflow-journal/adapters/sqlite-store.js"
import { liveJournalTestLayer } from "../../../coordination/delivery/live-journal-test-layer.js"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { publicationPremiseFor } from "../integration-finality/publication-premise.js"
import { type CompletionTaskBoundaryService, completionTaskRequestFor } from "../integration-finality/events.js"
import {
  CompletionTaskPreconditionConflict,
  runCompletionTaskProtocol
} from "../integration-finality/completion-task-protocol.js"
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
import { InRunJournal, JournalStore, type JournalRecord } from "../../../workflow-journal/store.js"
import { materializeJournalRecords } from "../../../workflow-journal/record-sequence.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { projectWorkflowOccurrences } from "../../registry/occurrence-projection.js"
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
  RemotePublicationAttemptIntendedEvent,
  RemotePublicationAttemptOrdinal,
  RemotePublicationGit,
  RemotePublicationGitObservation,
  RemotePublicationPushResult,
  RemotePublicationResumeRequest,
  RemotePublicationResumeRequestId,
  RemotePublicationRetainedEvent,
  remotePublicationCorrelationEquals,
  remotePublicationCorrelationFor
} from "./events.js"
import { applyRemotePublicationBatchGrantWithAdmission } from "./batch-grant-control.js"
import { applyRemotePublicationResumeWithAdmission } from "./resume-control.js"
import { makeRemotePublicationEngine } from "./protocol-engine.js"
import { validateRemotePublicationState } from "./transition-journal.js"

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

const seedSqlitePrefix = Effect.fn("RemotePublicationBatchGrantTest.seedSqlitePrefix")(function* (
  store: JournalStore["Service"]
) {
  const [beginning, ...records] = prePublicationPrefix
  if (beginning?.event._tag !== "WorkflowRunBegan") return yield* Effect.die("accepted history must begin the Run")
  yield* store.beginRun(
    runId,
    beginning.event.target,
    beginning.event.initialControlPolicy,
    beginning.event.remotePublicationTarget
  )
  for (const record of records) {
    if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
      return yield* Effect.die(`accepted prefix contains non-appendable ${record.event._tag}`)
    }
    yield* store.append(runId, record.key, record.event)
  }
})

const journalFromStore = Effect.fn("RemotePublicationBatchGrantTest.journalFromStore")(function* (
  store: JournalStore["Service"]
) {
  const records: ReadonlyArray<JournalRecord> = yield* store.read(runId)
  const history = reduceWorkflowJournalHistory(runId, records)
  if (history._tag === "InvalidWorkflowJournalHistory") {
    return yield* Effect.die(`reopened grant history is invalid: ${JSON.stringify(history.issues)}`)
  }
  const context = yield* Layer.build(journalLayer(runId, accepted.trackerTarget, history, store))
  return {
    acceptedJournal: Context.get(context, AcceptedJournalReader),
    inRunJournal: Context.get(context, InRunJournal),
    journal: Context.get(context, Journal)
  }
})

const actualExhaustionPrefix = Effect.fn("RemotePublicationBatchGrantTest.reachActualExhaustion")(function* (
  inRunJournal: InRunJournal["Service"],
  expectedObservations = 4,
  expectedPushes = 3
) {
  const pushes = yield* Ref.make(0)
  const observations = yield* Ref.make(0)
  const chronology = yield* Ref.make<ReadonlyArray<string>>([])
  const git = RemotePublicationGit.of({
    admit: () => Effect.die("destination admission is outside this exact candidate publication test"),
    prepareSenderCustody: () => Effect.void,
    reconcileSenderCustody: (_, ordinal) => Ref.update(chronology, (events) => [...events, `reconcile:${ordinal}`]),
    observe: () =>
      Ref.update(observations, (count) => count + 1).pipe(
        Effect.as(
          RemotePublicationGitObservation.cases.RemoteAncestorOfCandidate.make({
            remoteHead: candidate.run.session.expectedTargetHead
          })
        )
      ),
    push: () =>
      Ref.update(chronology, (events) => [...events, "push"]).pipe(
        Effect.andThen(Ref.update(pushes, (count) => count + 1)),
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
  expect(yield* Ref.get(observations)).toBe(expectedObservations)
  expect(yield* Ref.get(pushes)).toBe(expectedPushes)
  return { chronology, engine, git, observations, pushes }
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

const applyRealUnpause = Effect.fn("RemotePublicationBatchGrantTest.applyUnpause")(function* (
  inRunJournal: InRunJournal["Service"],
  acceptedJournal: AcceptedJournalReader["Service"]
) {
  const unpauseLayer = controlDirectionApplicationLayer.pipe(
    Layer.provide(
      Layer.merge(Layer.succeed(InRunJournal, inRunJournal), Layer.succeed(AcceptedJournalReader, acceptedJournal))
    )
  )
  const unpauseContext = yield* Layer.build(unpauseLayer)
  const control = Context.get(unpauseContext, ControlDirectionApplication)
  return yield* control.apply(
    ApplyControlDirectionRequest.make({
      direction: "Unpause",
      subject: ControlDirectionSubject.cases.Run.make({ runId })
    })
  )
})

const recordsFrom = (journal: JournalService) => journal.state.get.pipe(Effect.map(({ prefix }) => prefix))

it.effect(
  "records and replays one exact Full rerun grant during Pause, then executes one bounded batch after Unpause",
  () =>
    Effect.gen(function* () {
      const context = yield* Layer.build(buildJournal())
      const inRunJournal = Context.get(context, InRunJournal)
      const journal = Context.get(context, Journal)
      const acceptedJournal = Context.get(context, AcceptedJournalReader)
      const { engine, git, observations, pushes } = yield* actualExhaustionPrefix(inRunJournal)
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
      expect(publicationPremiseFor(afterGrant.prefix, qualified.claim)).toBe("Missing")
      const completionCalls = yield* Ref.make(0)
      const authorizationCalls = yield* Ref.make(0)
      const completionBoundary: CompletionTaskBoundaryService = {
        completeTask: () =>
          Ref.update(completionCalls, (count) => count + 1).pipe(
            Effect.andThen(Effect.die("grant cannot complete the task"))
          ),
        readCompletionRequest: () => Effect.die("grant cannot reconcile a completion request"),
        readFocusedTaskCompletion: () => Effect.die("grant cannot authorize task completion")
      }
      const completionFailure = yield* runCompletionTaskProtocol(
        completionBoundary,
        completionTaskRequestFor(qualified.claim),
        accepted.trackerTarget,
        () =>
          Ref.update(authorizationCalls, (count) => count + 1).pipe(
            Effect.andThen(Effect.die("grant cannot authorize task completion"))
          )
      ).pipe(Effect.provide(context), Effect.flip)
      expect(completionFailure).toBeInstanceOf(CompletionTaskPreconditionConflict)
      expect(completionFailure).toMatchObject({ reason: "RemotePublicationMissing" })
      expect(yield* Ref.get(completionCalls)).toBe(0)
      expect(yield* Ref.get(authorizationCalls)).toBe(0)
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

      yield* applyRealUnpause(inRunJournal, acceptedJournal)
      const lostAttemptAcknowledgement = yield* Ref.make(false)
      const processLossAfterGrantedAttemptIntent = InRunJournal.of({
        append: (requestedRunId, key, event) =>
          inRunJournal
            .append(requestedRunId, key, event)
            .pipe(
              Effect.flatMap((record) =>
                event._tag === "RemotePublicationAttemptIntended" &&
                grantRecord !== undefined &&
                event.batchGrantAt === grantRecord.position
                  ? Ref.modify(lostAttemptAcknowledgement, (alreadyLost) => [!alreadyLost, true] as const).pipe(
                      Effect.flatMap((shouldLose) =>
                        shouldLose
                          ? Effect.die("process lost after the exact granted attempt intent committed")
                          : Effect.succeed(record)
                      )
                    )
                  : Effect.succeed(record)
              )
            ),
        read: inRunJournal.read
      })
      const lostAfterIntent = yield* Effect.exit(
        engine
          .runRemotePublication(candidate, remotePublicationTargetForTest, {
            runObservation: (phase) => phase,
            runSender: (phase) => phase
          })
          .pipe(
            Effect.provideService(InRunJournal, processLossAfterGrantedAttemptIntent),
            Effect.provideService(RemotePublicationGit, git)
          )
      )
      expect(lostAfterIntent._tag).toBe("Failure")
      expect(yield* Ref.get(pushes)).toBe(3)
      const afterCommittedUnsent = yield* journal.state.get
      const unsentAttempt = Array.from(
        journalRecordsOfKind(afterCommittedUnsent.prefix, "RemotePublicationAttemptIntended")
      ).at(-1)
      expect(unsentAttempt?.event).toMatchObject({ attemptOrdinal: 4, batchGrantAt: grantRecord?.position })

      let nextBatch = yield* engine
        .runRemotePublication(candidate, remotePublicationTargetForTest, {
          runObservation: (phase) => phase,
          runSender: (phase) => phase
        })
        .pipe(Effect.provideService(InRunJournal, inRunJournal), Effect.provideService(RemotePublicationGit, git))
      for (let activation = 1; activation <= 3; activation += 1) {
        nextBatch = yield* engine
          .runRemotePublication(candidate, remotePublicationTargetForTest, {
            runObservation: (phase) => phase,
            runSender: (phase) => phase
          })
          .pipe(Effect.provideService(InRunJournal, inRunJournal), Effect.provideService(RemotePublicationGit, git))
      }
      expect(nextBatch).toMatchObject({
        _tag: "PublicationRetained",
        attemptOrdinalsInBatch: [4, 5, 6],
        cause: { _tag: "AttemptsExhausted" },
        batchGrantAt: grantRecord?.position
      })
      const afterSecondBatch = yield* journal.state.get
      const attempted = Array.from(journalRecordsOfKind(afterSecondBatch.prefix, "RemotePublicationAttemptIntended"))
      expect(
        attempted.map(({ event }) => event._tag === "RemotePublicationAttemptIntended" && event.attemptOrdinal)
      ).toEqual([1, 2, 3, 4, 5, 6])
      expect(
        attempted.slice(3).map(({ event }) => event._tag === "RemotePublicationAttemptIntended" && event.batchGrantAt)
      ).toEqual([grantRecord?.position, grantRecord?.position, grantRecord?.position])
      const secondBatchRecords = materializeJournalRecords(afterSecondBatch.prefix.records)
      const exactCorrelation = remotePublicationCorrelationFor(candidate, remotePublicationTargetForTest)
      const invalidateAttempt = (
        records: ReadonlyArray<JournalRecord>,
        update: (event: RemotePublicationAttemptIntendedEvent) => RemotePublicationAttemptIntendedEvent
      ) =>
        records.map((record) =>
          record.event._tag === "RemotePublicationAttemptIntended" && Number(record.event.attemptOrdinal) === 4
            ? { ...record, event: update(record.event) }
            : record
        )
      const staleGrantMarker = invalidateAttempt(secondBatchRecords, (event) =>
        RemotePublicationAttemptIntendedEvent.make({ ...event, batchGrantAt: JournalPosition.make(1) })
      )
      const resetOrdinal = invalidateAttempt(secondBatchRecords, (event) =>
        RemotePublicationAttemptIntendedEvent.make({
          ...event,
          attemptOrdinal: RemotePublicationAttemptOrdinal.make(1)
        })
      )
      const skippedOrdinal = invalidateAttempt(secondBatchRecords, (event) =>
        RemotePublicationAttemptIntendedEvent.make({
          ...event,
          attemptOrdinal: RemotePublicationAttemptOrdinal.make(7)
        })
      )
      for (const malformed of [staleGrantMarker, resetOrdinal, skippedOrdinal]) {
        expect((yield* Effect.exit(validateRemotePublicationState(malformed, exactCorrelation)))._tag).toBe("Failure")
      }
      expect(
        Array.from(journalRecordsOfKind(afterSecondBatch.prefix, "RemotePublicationBatchGrantApplied"))
      ).toHaveLength(1)
      expect(Array.from(journalRecordsOfKind(afterSecondBatch.prefix, "IntegratorSessionFixed"))).toHaveLength(
        Array.from(journalRecordsOfKind(beforePause.prefix, "IntegratorSessionFixed")).length
      )
      expect(yield* Ref.get(observations)).toBe(8)
      expect(yield* Ref.get(pushes)).toBe(5)
      const projectedSecondBatch = yield* projectWorkflowOccurrences(
        materializeJournalRecords(afterSecondBatch.prefix.records)
      )
      expect(projectedSecondBatch.occurrences.filter(({ _tag }) => _tag === "RemotePublicationRetained")).toHaveLength(
        2
      )

      const secondExhaustion = Array.from(journalRecordsOfKind(afterSecondBatch.prefix, "RemotePublicationRetained"))
        .filter(({ event }) => event._tag === "RemotePublicationRetained" && event.cause._tag === "AttemptsExhausted")
        .at(-1)
      if (secondExhaustion?.event._tag !== "RemotePublicationRetained") {
        return yield* Effect.die("the granted three-attempt batch must produce its own exact exhaustion")
      }
      const o2Grant = yield* applyRemotePublicationBatchGrantWithAdmission(
        runId,
        journal,
        grantRequest("full-rerun-grant-exhaustion-o2", secondExhaustion.position)
      )
      expect(o2Grant._tag).toBe("NewlyRecordedBatchGrant")
      const afterO2 = yield* journal.state.get
      expect(Array.from(journalRecordsOfKind(afterO2.prefix, "RemotePublicationBatchGrantApplied"))).toHaveLength(2)
      const projectedO2 = yield* projectWorkflowOccurrences(materializeJournalRecords(afterO2.prefix.records))
      expect(projectedO2.occurrences.filter(({ _tag }) => _tag === "RemotePublicationBatchGrantApplied")).toHaveLength(
        2
      )
      expect(projectedO2.occurrences.filter(({ _tag }) => _tag === "RemotePublicationRetained")).toHaveLength(2)
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

it.effect("admits retained publication resume from the granted batch allowance", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(buildJournal())
    const inRunJournal = Context.get(context, InRunJournal)
    const journal = Context.get(context, Journal)
    yield* actualExhaustionPrefix(inRunJournal)
    const first = yield* journal.state.get
    const exhaustion = Array.from(journalRecordsOfKind(first.prefix, "RemotePublicationRetained")).findLast(
      ({ event }) => event._tag === "RemotePublicationRetained" && event.cause._tag === "AttemptsExhausted"
    )
    if (exhaustion?.event._tag !== "RemotePublicationRetained") {
      return yield* Effect.die("actual first batch must reach its exact retained exhaustion")
    }
    const grant = yield* applyRemotePublicationBatchGrantWithAdmission(
      runId,
      journal,
      grantRequest("resume-after-batch-grant", exhaustion.position)
    )
    expect(grant._tag).toBe("NewlyRecordedBatchGrant")
    const git = RemotePublicationGit.of({
      admit: () => Effect.die("destination admission is outside this candidate test"),
      prepareSenderCustody: () => Effect.void,
      reconcileSenderCustody: () => Effect.void,
      observe: () => Effect.succeed(RemotePublicationGitObservation.cases.TargetMissing.make({})),
      push: () => Effect.die("a missing target cannot be pushed")
    })
    const engine = makeRemotePublicationEngine((requestedRunId) => inRunJournal.read(requestedRunId))
    const retained = yield* engine
      .runRemotePublication(candidate, remotePublicationTargetForTest, {
        runObservation: (phase) => phase,
        runSender: (phase) => phase
      })
      .pipe(Effect.provideService(InRunJournal, inRunJournal), Effect.provideService(RemotePublicationGit, git))
    expect(retained).toMatchObject({
      _tag: "PublicationRetained",
      batchGrantAt: grant.result.acceptedAt,
      cause: { _tag: "TargetMissing" },
      attemptOrdinalsInBatch: []
    })
    const resume = yield* applyRemotePublicationResumeWithAdmission(
      runId,
      journal,
      RemotePublicationResumeRequest.make({
        requestId: RemotePublicationResumeRequestId.make("resume-granted-target-missing"),
        responsibility: IntegrationResponsibilityIdentity.make({ queuedAt: candidate.run.session.queuedAt, runId }),
        runId,
        schemaVersion: 1
      })
    )
    expect(resume._tag).toBe("NewlyRecordedResumeReceipt")
    const after = yield* journal.state.get
    expect(Array.from(journalRecordsOfKind(after.prefix, "RemotePublicationAttemptIntended"))).toHaveLength(3)
    expect(Array.from(journalRecordsOfKind(after.prefix, "RemotePublicationResumeRequested"))).toHaveLength(1)
    const forgedRetainedMarker = materializeJournalRecords(after.prefix.records).map((record) =>
      record.event._tag === "RemotePublicationRetained" && record.event.cause._tag === "TargetMissing"
        ? {
            ...record,
            event: RemotePublicationRetainedEvent.make({ ...record.event, batchGrantAt: JournalPosition.make(1) })
          }
        : record
    )
    expect(
      (yield* Effect.exit(
        validateRemotePublicationState(
          forgedRetainedMarker,
          remotePublicationCorrelationFor(candidate, remotePublicationTargetForTest)
        )
      ))._tag
    ).toBe("Failure")
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

it.effect("retries an exact paused grant after a precommit crash in memory", () =>
  Effect.gen(function* () {
    const context = yield* Layer.build(buildJournal())
    const inRunJournal = Context.get(context, InRunJournal)
    const acceptedJournal = Context.get(context, AcceptedJournalReader)
    const journal = Context.get(context, Journal)
    yield* actualExhaustionPrefix(inRunJournal)
    yield* applyRealPause(inRunJournal, acceptedJournal)
    const before = yield* journal.state.get
    const exhaustion = Array.from(journalRecordsOfKind(before.prefix, "RemotePublicationRetained")).findLast(
      ({ event }) => event._tag === "RemotePublicationRetained" && event.cause._tag === "AttemptsExhausted"
    )
    if (exhaustion === undefined) return yield* Effect.die("actual exhaustion must precede the crash")
    const request = grantRequest("memory-precommit-crash", exhaustion.position)
    const precommitCrash: JournalService = {
      ...journal,
      appendIfAcceptedPrefixCurrent: () => Effect.die("host stopped before the grant append")
    }
    expect(
      (yield* Effect.exit(applyRemotePublicationBatchGrantWithAdmission(runId, precommitCrash, request)))._tag
    ).toBe("Failure")
    const afterCrash = yield* journal.state.get
    expect(afterCrash.position).toBe(before.position)
    expect(Array.from(journalRecordsOfKind(afterCrash.prefix, "RemotePublicationBatchGrantApplied"))).toHaveLength(0)
    const grant = yield* applyRemotePublicationBatchGrantWithAdmission(runId, journal, request)
    expect(grant._tag).toBe("NewlyRecordedBatchGrant")
    const afterRetry = yield* journal.state.get
    expect(Array.from(journalRecordsOfKind(afterRetry.prefix, "RemotePublicationBatchGrantApplied"))).toHaveLength(1)
    expect(Array.from(journalRecordsOfKind(afterRetry.prefix, "IntegratorSessionFixed"))).toHaveLength(
      Array.from(journalRecordsOfKind(before.prefix, "IntegratorSessionFixed")).length
    )
    expect(Array.from(journalRecordsOfKind(afterRetry.prefix, "RemotePublicationAttemptIntended"))).toHaveLength(3)
  })
)

it.effect("replays an exact batch grant from a reopened SQLite journal after lost acknowledgement", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-publication-batch-grant-" })
      const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
      const openSqlite = <A, E, R>(use: (store: JournalStore["Service"]) => Effect.Effect<A, E, R>) =>
        Effect.scoped(
          Effect.gen(function* () {
            const store = yield* JournalStore
            return yield* use(store)
          }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
        )

      yield* openSqlite(seedSqlitePrefix)
      const committed = yield* openSqlite((store) =>
        Effect.gen(function* () {
          const { acceptedJournal, inRunJournal, journal } = yield* journalFromStore(store)
          yield* actualExhaustionPrefix(inRunJournal)
          const beforePause = yield* journal.state.get
          const retained = Array.from(journalRecordsOfKind(beforePause.prefix, "RemotePublicationRetained")).findLast(
            ({ event }) => event._tag === "RemotePublicationRetained" && event.cause._tag === "AttemptsExhausted"
          )
          if (retained?.event._tag !== "RemotePublicationRetained") {
            return yield* Effect.die("SQLite engine execution must retain its exact exhausted batch")
          }
          yield* applyRealPause(inRunJournal, acceptedJournal)
          const request = grantRequest("sqlite-exact-batch-grant", retained.position)
          const lostAcknowledgement: JournalService = {
            ...journal,
            appendIfAcceptedPrefixCurrent: (requestedRunId, expectedPosition, key, event) =>
              journal
                .appendIfAcceptedPrefixCurrent(requestedRunId, expectedPosition, key, event)
                .pipe(Effect.flatMap(() => Effect.die("host stopped after the grant committed before acknowledgement")))
          }
          expect(
            (yield* Effect.exit(applyRemotePublicationBatchGrantWithAdmission(runId, lostAcknowledgement, request)))
              ._tag
          ).toBe("Failure")
          const afterCrash = yield* journal.state.get
          const grant = Array.from(journalRecordsOfKind(afterCrash.prefix, "RemotePublicationBatchGrantApplied"))[0]
          if (grant === undefined) return yield* Effect.die("grant must survive lost acknowledgement")
          expect(grant.event).toMatchObject({ request })
          return { acceptedAt: grant.position, exhaustionAt: retained.position, request }
        })
      )

      yield* openSqlite((store) =>
        Effect.gen(function* () {
          const { acceptedJournal, inRunJournal, journal } = yield* journalFromStore(store)
          const reopened = yield* journal.state.get
          expect(Array.from(journalRecordsOfKind(reopened.prefix, "RemotePublicationBatchGrantApplied"))).toHaveLength(
            1
          )
          expect(
            Array.from(journalRecordsOfKind(reopened.prefix, "ControlDirectionApplied")).at(-1)?.event
          ).toMatchObject({ direction: "Pause", subject: { _tag: "Run", runId } })

          const replay = yield* applyRemotePublicationBatchGrantWithAdmission(runId, journal, committed.request)
          expect(replay._tag).toBe("BatchGrantReplay")
          expect(replay.result.acceptedAt).toBe(committed.acceptedAt)
          const otherDelivery = yield* applyRemotePublicationBatchGrantWithAdmission(
            runId,
            journal,
            grantRequest("sqlite-other-transport-request-id", committed.exhaustionAt)
          )
          expect(otherDelivery._tag).toBe("BatchGrantAlreadyRecordedForExhaustion")
          const afterReplay = yield* journal.state.get
          expect(
            Array.from(journalRecordsOfKind(afterReplay.prefix, "RemotePublicationBatchGrantApplied"))
          ).toHaveLength(1)

          yield* applyRealUnpause(inRunJournal, acceptedJournal)
          const pushCalls = yield* Ref.make(0)
          const grantAt = committed.acceptedAt
          const loseAcknowledgementAfterIntent = InRunJournal.of({
            append: (requestedRunId, key, event) =>
              inRunJournal
                .append(requestedRunId, key, event)
                .pipe(
                  Effect.flatMap((record) =>
                    event._tag === "RemotePublicationAttemptIntended" && event.batchGrantAt === grantAt
                      ? Effect.die("host stopped after granted intent 4 committed")
                      : Effect.succeed(record)
                  )
                ),
            read: inRunJournal.read
          })
          const git = RemotePublicationGit.of({
            admit: () => Effect.die("destination admission is outside this exact candidate publication test"),
            prepareSenderCustody: () => Effect.void,
            reconcileSenderCustody: () => Effect.void,
            observe: () =>
              Effect.succeed(
                RemotePublicationGitObservation.cases.RemoteAncestorOfCandidate.make({
                  remoteHead: candidate.run.session.expectedTargetHead
                })
              ),
            push: () =>
              Ref.update(pushCalls, (count) => count + 1).pipe(
                Effect.andThen(Effect.die("crash cut must precede push"))
              )
          })
          const engine = makeRemotePublicationEngine((requestedRunId) => inRunJournal.read(requestedRunId))
          const crash = yield* Effect.exit(
            engine
              .runRemotePublication(candidate, remotePublicationTargetForTest, {
                runObservation: (phase) => phase,
                runSender: (phase) => phase
              })
              .pipe(
                Effect.provideService(InRunJournal, loseAcknowledgementAfterIntent),
                Effect.provideService(RemotePublicationGit, git)
              )
          )
          expect(crash._tag).toBe("Failure")
          expect(yield* Ref.get(pushCalls)).toBe(0)
          const afterCrash = yield* journal.state.get
          expect(Array.from(journalRecordsOfKind(afterCrash.prefix, "RemotePublicationAttemptIntended"))).toHaveLength(
            4
          )
        })
      )

      yield* openSqlite((store) =>
        Effect.gen(function* () {
          const { inRunJournal, journal } = yield* journalFromStore(store)
          const reopenedBeforeReconcile = yield* journal.state.get
          expect(
            Array.from(journalRecordsOfKind(reopenedBeforeReconcile.prefix, "RemotePublicationAttemptIntended"))
          ).toHaveLength(4)
          const { chronology, pushes } = yield* actualExhaustionPrefix(inRunJournal, 3, 2)
          expect((yield* Ref.get(chronology))[0]).toBe("reconcile:4")
          const afterBatch = yield* journal.state.get
          const grantRecord = Array.from(
            journalRecordsOfKind(afterBatch.prefix, "RemotePublicationBatchGrantApplied")
          )[0]
          const attempts = Array.from(journalRecordsOfKind(afterBatch.prefix, "RemotePublicationAttemptIntended"))
          expect(grantRecord).toBeDefined()
          expect(attempts).toHaveLength(6)
          expect(
            attempts
              .slice(3)
              .map(({ event }) =>
                event._tag === "RemotePublicationAttemptIntended" ? event.attemptOrdinal : undefined
              )
          ).toEqual([4, 5, 6])
          expect(
            attempts
              .slice(3)
              .map(({ event }) => (event._tag === "RemotePublicationAttemptIntended" ? event.batchGrantAt : undefined))
          ).toEqual([grantRecord?.position, grantRecord?.position, grantRecord?.position])
          expect(yield* Ref.get(pushes)).toBe(2)
        })
      )

      yield* openSqlite((store) =>
        Effect.gen(function* () {
          const { journal } = yield* journalFromStore(store)
          const reopened = yield* journal.state.get
          const grantRecord = Array.from(journalRecordsOfKind(reopened.prefix, "RemotePublicationBatchGrantApplied"))[0]
          if (grantRecord === undefined) return yield* Effect.die("the committed SQLite grant must survive reopen")
          const attempts = Array.from(journalRecordsOfKind(reopened.prefix, "RemotePublicationAttemptIntended"))
          expect(attempts).toHaveLength(6)
          expect(
            attempts
              .slice(3)
              .map(({ event }) => (event._tag === "RemotePublicationAttemptIntended" ? event.batchGrantAt : undefined))
          ).toEqual([grantRecord.position, grantRecord.position, grantRecord.position])
          const state = yield* validateRemotePublicationState(
            reopened.prefix,
            remotePublicationCorrelationFor(candidate, remotePublicationTargetForTest)
          )
          expect(state._tag).toBe("PublicationRetained")
          if (state._tag !== "PublicationRetained") {
            return yield* Effect.die("reopened SQLite must reconstruct the exact retained granted batch")
          }
          expect(state.batchGrantAt).toBe(grantRecord.position)
          expect(state.attemptOrdinalsInBatch).toEqual([4, 5, 6])
        })
      )
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
  )
)
