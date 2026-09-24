import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { AcceptedResultEvidenceManifest, GitCommitSha, makeTaskWorkSpecification, RunId } from "@dalph/contracts"
import { expect, it } from "@effect/vitest"
import { Context, Effect, FileSystem, Layer, Option, Path, Ref, type Scope } from "effect"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import { integratorCorrelationFor } from "../integrator/session.js"
import { makeAcceptedIntegrationHistory } from "../../../../test/support/accepted-integration-history.js"
import { makePromotedIntegrationHistory } from "../../../../test/support/promoted-integration-history.js"
import { journalLayer, type JournalStorageBoundary } from "../../../coordination/delivery/journal.js"
import { RunReactivationHint } from "../../../coordination/run/run-reactivation-owner.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { reconstructRunState } from "../../../coordination/reconstruction/reduce.js"
import { deriveIntegrationFrontier } from "../../../coordination/frontier/integration-frontier.js"
import { JournalDatabaseLocator, JournalPosition } from "../../../workflow-journal/identity.js"
import { memoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { sqliteJournalStoreLayer } from "../../../workflow-journal/adapters/sqlite-store.js"
import { JournalStore, type JournalRecord } from "../../../workflow-journal/store.js"
import { IntegrationResponsibilityIdentity } from "../integration-admission/responsibility.js"
import { remotePublicationTargetForTest } from "../../../../test/support/direct-publication.js"
import { deriveRemotePublicationState } from "./state.js"
import { EvidenceStore } from "../evidence-store.js"
import {
  CompletionTaskAcknowledgement,
  CompletionTaskBoundary,
  CompletionTaskClaim,
  completionClaimReplacementRequestFor,
  completionTaskRequestFor
} from "../integration-finality/events.js"
import {
  authorizeCompletionTaskAttempt,
  runCompletionTaskProtocol
} from "../integration-finality/completion-task-protocol.js"
import { CompletionClaimBoundary, type CompletionClaimObservation } from "../integration-finality/completion-claim.js"
import { runCompletionClaimReplacementProtocol } from "../integration-finality/protocol.js"
import {
  TargetPromotionCompareAndSetResult,
  TargetPromotionGit,
  TargetPromotionGitReadObservation,
  targetPromotionCorrelationFor
} from "../target-promotion/events.js"
import { runTargetPromotion } from "../target-promotion/protocol.js"
import {
  RemotePublicationAttemptAuthorization,
  RemotePublicationRetainedEvent,
  RemotePublicationGit,
  RemotePublicationGitObservation,
  RemotePublicationPushFailure,
  RemotePublicationPushResult,
  RemotePublicationResumeRequest,
  RemotePublicationResumeRequestId,
  PublishedIntegratorRunQualifiedCandidate,
  type RemotePublicationAttemptOrdinal,
  type RemotePublicationGitService
} from "./events.js"
import {
  resumeRemotePublicationAndDispatch,
  resumeRemotePublication,
  runRemotePublication,
  type RemotePublicationResumeDispatchBoundary,
  type RemotePublicationPhaseBoundary
} from "./protocol-engine.js"
import { resumeRemotePublicationInRuntime, type RemotePublicationResumeRuntimeOwners } from "./resume-runtime.js"

const fixture = integrationFinalityFixture
const specification = makeTaskWorkSpecification({
  body: "Resume one exact retained direct publication after a repaired temporary failure.",
  taskId: fixture.taskId,
  title: "Direct publication resume"
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
const candidate = qualified.qualifiedCandidate
const runId = candidate.run.session.plannedAttempt.runId
const target = remotePublicationTargetForTest
const phaseBoundary = {
  runObservation: <A, E, R>(phase: Effect.Effect<A, E, R>) => phase,
  runSender: <A, E, R>(phase: Effect.Effect<A, E, R>) => phase
}

type ResumeRequest = RemotePublicationResumeRequest
type StoreProcess = <A>(
  process: (store: JournalStore["Service"]) => Effect.Effect<A, unknown>
) => Effect.Effect<A, unknown>
type FreshLane = <A>(
  use: (process: StoreProcess) => Effect.Effect<A, unknown>
) => Effect.Effect<A, unknown, Scope.Scope>

const requestFor = (id: string): ResumeRequest =>
  RemotePublicationResumeRequest.make({
    requestId: RemotePublicationResumeRequestId.make(id),
    responsibility: IntegrationResponsibilityIdentity.make({ queuedAt: candidate.run.session.queuedAt, runId }),
    runId,
    schemaVersion: 1
  })

const seedQualifiedHistory = Effect.fn("DirectPublicationResume.seedQualifiedHistory")(function* (
  store: JournalStore["Service"]
) {
  const [beginning, ...records] = qualified.qualifiedRecords
  if (beginning?.event._tag !== "WorkflowRunBegan") return yield* Effect.die("qualified history must begin the Run")
  yield* store.beginRun(
    runId,
    beginning.event.target,
    beginning.event.initialControlPolicy,
    beginning.event.remotePublicationTarget
  )
  for (const record of records) {
    if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
      return yield* Effect.die(`qualified history contains non-appendable ${record.event._tag}`)
    }
    yield* store.append(runId, record.key, record.event)
  }
})

type GitBehavior = "denied" | "applied" | "throttled" | "uncertain" | "competing" | "incompatible" | "candidate-current"
type GitCalls = Readonly<{
  readonly custody: number
  readonly observations: number
  readonly preparations: ReadonlyArray<number>
  readonly pushes: ReadonlyArray<number>
  readonly timeline: ReadonlyArray<string>
}>

const emptyCalls = (): GitCalls => ({ custody: 0, observations: 0, preparations: [], pushes: [], timeline: [] })
const ordinalNumber = (ordinal: RemotePublicationAttemptOrdinal): number => Number(ordinal)

const makeGit = Effect.fn("DirectPublicationResume.makeGit")(function* (behavior: GitBehavior) {
  const calls = yield* Ref.make(emptyCalls())
  const update = (f: (current: GitCalls) => GitCalls) => Ref.update(calls, f)
  const observedHead =
    behavior === "competing"
      ? GitCommitSha.make("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
      : behavior === "incompatible"
        ? GitCommitSha.make("cccccccccccccccccccccccccccccccccccccccc")
        : behavior === "candidate-current"
          ? candidate.candidateCommit
          : candidate.run.session.expectedTargetHead
  const git = RemotePublicationGit.of({
    admit: () => Effect.die("destination admission precedes resume"),
    prepareSenderCustody: (_request, ordinal) =>
      update((current) => ({
        ...current,
        preparations: [...current.preparations, ordinalNumber(ordinal)],
        timeline: [...current.timeline, `prepare:${ordinalNumber(ordinal)}`]
      })),
    reconcileSenderCustody: (_request, ordinal) =>
      update((current) => ({
        ...current,
        custody: current.custody + 1,
        timeline: [...current.timeline, `custody:${ordinalNumber(ordinal)}`]
      })),
    observe: () =>
      update((current) => ({
        ...current,
        observations: current.observations + 1,
        timeline: [...current.timeline, `observe:${observedHead}`]
      })).pipe(
        Effect.as(
          behavior === "competing"
            ? RemotePublicationGitObservation.cases.CompatibleCompetingHead.make({
                mergeBase: candidate.run.session.expectedTargetHead,
                remoteHead: observedHead
              })
            : behavior === "incompatible"
              ? RemotePublicationGitObservation.cases.IncompatibleLineage.make({ remoteHead: observedHead })
              : behavior === "candidate-current"
                ? RemotePublicationGitObservation.cases.CandidateCurrent.make({ remoteHead: observedHead })
                : RemotePublicationGitObservation.cases.RemoteAncestorOfCandidate.make({ remoteHead: observedHead })
        )
      ),
    push: (_request, ordinal) => {
      const result: Effect.Effect<RemotePublicationPushResult, RemotePublicationPushFailure> =
        behavior === "uncertain"
          ? Effect.fail(new RemotePublicationPushFailure({ reason: "ResponseDeadline", target }))
          : behavior === "denied"
            ? Effect.succeed(RemotePublicationPushResult.cases.RejectedDefinite.make({ cause: "Authentication" }))
            : behavior === "throttled"
              ? Effect.succeed(RemotePublicationPushResult.cases.Throttled.make({}))
              : Effect.succeed(
                  RemotePublicationPushResult.cases.Applied.make({ remoteHead: candidate.candidateCommit })
                )
      return update((current) => ({
        ...current,
        pushes: [...current.pushes, ordinalNumber(ordinal)],
        timeline: [...current.timeline, `push:${ordinalNumber(ordinal)}`]
      })).pipe(Effect.andThen(result))
    }
  })
  return { calls, git }
})

const boundaryWithReceiptCrash = (store: JournalStore["Service"]): JournalStorageBoundary => ({
  append: (requestedRunId, key, event) =>
    event._tag === "RemotePublicationResumeRequested"
      ? store
          .append(requestedRunId, key, event)
          .pipe(Effect.flatMap(() => Effect.die("process lost after resume receipt COMMIT")))
      : store.append(requestedRunId, key, event),
  read: store.read,
  terminateRun: store.terminateRun
})

const boundaryWithCompatibleRetainedCrash = (store: JournalStore["Service"]): JournalStorageBoundary => ({
  append: (requestedRunId, key, event) =>
    event._tag === "RemotePublicationRetained" &&
    event.cause._tag === "CompatibleCompetingHead" &&
    event.authorization._tag === "ResumeRequest"
      ? store
          .append(requestedRunId, key, event)
          .pipe(Effect.flatMap(() => Effect.die("process lost after compatible-head retained COMMIT")))
      : store.append(requestedRunId, key, event),
  read: store.read,
  terminateRun: store.terminateRun
})

const invoke = Effect.fn("DirectPublicationResume.invoke")(function* (
  store: JournalStore["Service"],
  git: RemotePublicationGitService,
  operation:
    | "run"
    | Readonly<{
        readonly request: unknown
        readonly dispatchBoundary?: RemotePublicationResumeDispatchBoundary<unknown, never>
        readonly runtimeOwners?: RemotePublicationResumeRuntimeOwners
      }>,
  crashAt?: "receipt" | "compatibleRetained",
  boundary: RemotePublicationPhaseBoundary = phaseBoundary
) {
  const records = yield* store.read(runId)
  const history = reduceWorkflowJournalHistory(runId, records)
  if (history._tag === "InvalidWorkflowJournalHistory") {
    return yield* Effect.die(`invalid resume prefix: ${JSON.stringify(history.issues)}`)
  }
  const action =
    operation === "run"
      ? runRemotePublication(candidate, target, phaseBoundary)
      : operation.runtimeOwners !== undefined
        ? resumeRemotePublicationInRuntime(
            candidate,
            target,
            operation.request as ResumeRequest,
            boundary,
            operation.runtimeOwners
          )
        : operation.dispatchBoundary === undefined
          ? resumeRemotePublication(candidate, target, operation.request, boundary)
          : resumeRemotePublicationAndDispatch(
              candidate,
              target,
              operation.request,
              boundary,
              operation.dispatchBoundary
            )
  const storage =
    crashAt === "receipt"
      ? boundaryWithReceiptCrash(store)
      : crashAt === "compatibleRetained"
        ? boundaryWithCompatibleRetainedCrash(store)
        : store
  return yield* action.pipe(
    Effect.provide(
      Layer.merge(journalLayer(runId, fixture.target, history, storage), Layer.succeed(RemotePublicationGit, git))
    )
  )
})

const recordTags = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<string> =>
  records.map(({ event }) => event._tag)

const publicationEvents = (records: ReadonlyArray<JournalRecord>) =>
  records.flatMap(({ event }) =>
    event._tag === "RemotePublicationIntended" ||
    event._tag === "RemotePublicationAttemptIntended" ||
    event._tag === "RemotePublicationAttemptRejectedNonFastForward" ||
    event._tag === "RemotePublicationSucceeded" ||
    event._tag === "RemotePublicationRetained" ||
    event._tag === "RemotePublicationResumeRequested"
      ? [event]
      : []
  )

const publicationOrdinals = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<number> =>
  records.flatMap(({ event }) =>
    event._tag === "RemotePublicationAttemptIntended" ? [Number(event.attemptOrdinal)] : []
  )

const memoryFresh: FreshLane = (use) =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(memoryJournalStoreLayer)
      const store = Context.get(context, JournalStore)
      yield* seedQualifiedHistory(store)
      return yield* use((process) => process(store))
    })
  )

const sqliteFresh: FreshLane = (use) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-publication-resume-" })
    const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
    const process: StoreProcess = (action) =>
      Effect.scoped(
        Effect.gen(function* () {
          const store = yield* JournalStore
          return yield* action(store)
        }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
      )
    yield* process(seedQualifiedHistory)
    return yield* use(process)
  }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))

const exerciseReceiptRecovery = (process: StoreProcess): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const first = yield* makeGit("denied")
    expect((yield* process((store) => invoke(store, first.git, "run")))._tag).toBe("PublicationRetained")
    const before = yield* process((store) => store.read(runId))
    const receiptCrash = yield* makeGit("applied")
    const failedActivation = yield* Effect.exit(
      process((store) => invoke(store, receiptCrash.git, { request: requestFor("resume-receipt-recovery") }, "receipt"))
    )
    expect(failedActivation._tag).toBe("Failure")
    expect(yield* Ref.get(receiptCrash.calls)).toEqual(emptyCalls())

    const afterReceipt = yield* process((store) => store.read(runId))
    expect(recordTags(afterReceipt).at(-1)).toBe("RemotePublicationResumeRequested")
    expect(afterReceipt.filter(({ event }) => event._tag === "RemotePublicationResumeRequested")).toHaveLength(1)
    expect(recordTags(afterReceipt).filter((tag) => tag === "WorkflowRunBegan")).toHaveLength(
      recordTags(before).filter((tag) => tag === "WorkflowRunBegan").length
    )

    const restarted = yield* makeGit("applied")
    const recovered = yield* process((store) => invoke(store, restarted.git, "run"))
    expect(recovered._tag).toBe("PublicationSucceeded")
    expect(yield* Ref.get(restarted.calls)).toMatchObject({
      custody: 1,
      observations: 1,
      preparations: [2],
      pushes: [2]
    })
    const recoveredRecords = yield* process((store) => store.read(runId))
    expect(publicationOrdinals(recoveredRecords)).toEqual([1, 2])
    expect(recoveredRecords.some(({ event }) => event._tag === "IntegratorSessionFixed")).toBe(true)

    const redelivery = yield* makeGit("applied")
    expect(
      (yield* process((store) => invoke(store, redelivery.git, { request: requestFor("resume-receipt-recovery") })))
        ._tag
    ).toBe("PublicationSucceeded")
    expect(yield* Ref.get(redelivery.calls)).toEqual(emptyCalls())
    expect(
      (yield* process((store) => store.read(runId))).filter(
        ({ event }) => event._tag === "RemotePublicationResumeRequested"
      )
    ).toHaveLength(1)
  })

it.effect("recovers the same retained resume receipt after restart with memory and reopened SQLite journals", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* memoryFresh(exerciseReceiptRecovery)
      yield* sqliteFresh(exerciseReceiptRecovery)
    })
  )
)

const exerciseCompatibleHandoffRecovery = (process: StoreProcess): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const initialDenial = yield* makeGit("denied")
    yield* process((store) => invoke(store, initialDenial.git, "run"))
    const request = requestFor("resume-compatible-head-handoff-recovery")
    const hints = yield* Ref.make<ReadonlyArray<RunReactivationHint>>([])
    const runtimeOwners: RemotePublicationResumeRuntimeOwners = {
      ordinaryRun: { hint: (hint) => Ref.update(hints, (current) => [...current, hint]) }
    }
    const competing = yield* makeGit("competing")
    const interrupted = yield* Effect.exit(
      process((store) => invoke(store, competing.git, { request, runtimeOwners }, "compatibleRetained"))
    )
    expect(interrupted._tag).toBe("Failure")
    expect(yield* Ref.get(hints)).toEqual([])
    expect(yield* Ref.get(competing.calls)).toMatchObject({ custody: 1, observations: 1, pushes: [] })

    const afterCrash = yield* process((store) => store.read(runId))
    expect(afterCrash.at(-1)?.event).toMatchObject({
      _tag: "RemotePublicationRetained",
      authorization: { _tag: "ResumeRequest", requestId: request.requestId },
      cause: {
        _tag: "CompatibleCompetingHead",
        mergeBase: candidate.run.session.expectedTargetHead,
        remoteHead: GitCommitSha.make("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
      }
    })

    const replayGit = yield* makeGit("applied")
    const replayed = yield* process((store) => invoke(store, replayGit.git, { request, runtimeOwners }))
    expect(replayed).toMatchObject({ _tag: "PublicationRetained", cause: { _tag: "CompatibleCompetingHead" } })
    expect(yield* Ref.get(replayGit.calls)).toEqual(emptyCalls())
    expect(yield* Ref.get(hints)).toEqual([RunReactivationHint.AcceptedFactPublication()])

    const afterReplay = yield* process((store) => store.read(runId))
    expect(afterReplay.filter(({ event }) => event._tag === "RemotePublicationResumeRequested")).toHaveLength(1)
    expect(afterReplay.filter(({ event }) => event._tag === "RemotePublicationAttemptIntended")).toHaveLength(1)
    expect(afterReplay.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
    expect(afterReplay.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(1)
    expect(afterReplay.at(-1)).toEqual(afterCrash.at(-1))
  })

it.effect("replays the exact compatible-head continuation after restart from memory and reopened SQLite", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* memoryFresh(exerciseCompatibleHandoffRecovery)
      yield* sqliteFresh(exerciseCompatibleHandoffRecovery)
    })
  )
)

it.effect("continues a resumed publication proof through promotion and fresh tracker finality", () =>
  memoryFresh((process) =>
    Effect.gen(function* () {
      const firstFailure = yield* makeGit("denied")
      expect((yield* process((store) => invoke(store, firstFailure.git, "run")))._tag).toBe("PublicationRetained")
      const request = requestFor("resume-proof-through-promotion-and-finality")
      const published = yield* makeGit("candidate-current")
      const firstStatus = yield* process((store) => invoke(store, published.git, { request }))
      expect(firstStatus._tag).toBe("PublicationSucceeded")
      expect(yield* Ref.get(published.calls)).toMatchObject({
        custody: 1,
        observations: 1,
        preparations: [],
        pushes: []
      })
      const afterResume = yield* process((store) => store.read(runId))
      expect(afterResume.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(
        qualified.qualifiedRecords.filter(({ event }) => event._tag === "WorkflowRunBegan").length
      )
      expect(afterResume.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(
        qualified.qualifiedRecords.filter(({ event }) => event._tag === "IntegratorRunStarted").length
      )
      expect(publicationOrdinals(afterResume)).toEqual([1])
      expect(afterResume.filter(({ event }) => event._tag === "RemotePublicationResumeRequested")).toEqual([
        expect.objectContaining({ event: expect.objectContaining({ request }) })
      ])
      const statusOnlyGit = yield* makeGit("applied")
      const replayedStatus = yield* process((store) =>
        invoke(store, statusOnlyGit.git, { request: requestFor("new-request-after-settlement") })
      )
      expect(replayedStatus).toEqual(firstStatus)
      expect(yield* Ref.get(statusOnlyGit.calls)).toEqual(emptyCalls())
      expect(recordTags(yield* process((store) => store.read(runId)))).toEqual(recordTags(afterResume))

      const successRecord = afterResume.find(({ event }) => event._tag === "RemotePublicationSucceeded")
      if (successRecord?.event._tag !== "RemotePublicationSucceeded" || firstStatus._tag !== "PublicationSucceeded") {
        return yield* Effect.die("settled publication proof must remain available to finality")
      }
      const reconstructed = reconstructRunState(runId, afterResume)
      if (reconstructed._tag !== "ValidReconstructedRun") {
        return yield* Effect.die("resumed publication history must remain reconstructable for the Run selector")
      }
      const targetLineageRecord = qualified.qualifiedRecords.find(({ event }) => event._tag === "TargetLineageObserved")
      if (targetLineageRecord?.event._tag !== "TargetLineageObserved") {
        return yield* Effect.die("qualified candidate history must retain its exact target lineage")
      }
      const attemptId = candidate.run.session.plannedAttempt.attemptId
      const selectedActions = deriveIntegrationFrontier(reconstructed.state, {
        currentTrackerTaskIds: new Set([candidate.run.session.plannedAttempt.taskId]),
        heldResponsibilities: [
          IntegrationResponsibilityIdentity.make({ queuedAt: candidate.run.session.queuedAt, runId })
        ],
        integrationTarget: Option.some(candidate.run.session.integrationTarget),
        targetLineageByAttemptId: new Map([[attemptId, targetLineageRecord.event.observation]]),
        targetPromotionConfigured: true,
        remotePublicationConfigured: true,
        taskClaimAuthorityByAttemptId: new Map([[attemptId, { _tag: "Exact" as const }]])
      }).transitions
      expect(selectedActions).toHaveLength(1)
      const nextAction = selectedActions[0]
      if (nextAction?._tag !== "RunTargetPromotion") {
        return yield* Effect.die("fresh permission after resumed proof must select the existing local promotion")
      }
      expect(nextAction.candidate).toEqual(candidate)
      expect(nextAction.publication).toEqual(successRecord.event)
      const handoff = PublishedIntegratorRunQualifiedCandidate.make({
        candidate: nextAction.candidate,
        publication: nextAction.publication
      })
      expect(handoff.candidate).toEqual(candidate)
      expect(targetPromotionCorrelationFor(handoff.candidate)).toEqual(targetPromotionCorrelationFor(candidate))
      expect(handoff.candidate.run.session.expectedTargetHead).toBe(candidate.run.session.expectedTargetHead)
      expect(handoff.candidate.candidateCommit).toBe(candidate.candidateCommit)
      expect(handoff.publication).toEqual(successRecord.event)

      const promotionGit = TargetPromotionGit.of({
        compareAndSet: () =>
          Effect.succeed(
            TargetPromotionCompareAndSetResult.cases.Applied.make({ newHeadSha: candidate.candidateCommit })
          ),
        read: () =>
          Effect.succeed(
            TargetPromotionGitReadObservation.cases.CandidateCurrent.make({ currentHeadSha: candidate.candidateCommit })
          )
      })
      const promoted = yield* process((store) =>
        Effect.gen(function* () {
          const records = yield* store.read(runId)
          const history = reduceWorkflowJournalHistory(runId, records)
          if (history._tag === "InvalidWorkflowJournalHistory") {
            return yield* Effect.die("resume proof must leave a valid prefix for existing promotion")
          }
          return yield* runTargetPromotion(handoff).pipe(
            Effect.provide(
              Layer.merge(
                journalLayer(runId, fixture.target, history, store),
                Layer.succeed(TargetPromotionGit, promotionGit)
              )
            )
          )
        })
      )
      expect(promoted._tag).toBe("PromotionSucceeded")

      const manifest = AcceptedResultEvidenceManifest.make({
        commit: candidate.run.session.acceptedResult.commit,
        correlation: { attemptId: candidate.run.session.plannedAttempt.attemptId, runId },
        formatVersion: 1,
        outcome: "Accepted",
        predecessor: null
      })
      const completionRequest = completionTaskRequestFor(
        CompletionTaskClaim.make({
          originalClaim: accepted.activeClaim,
          plannedAttempt: candidate.run.session.plannedAttempt,
          promotionCorrelation: targetPromotionCorrelationFor(candidate)
        })
      )
      const completionEvidence = EvidenceStore.of({
        put: () => Effect.die("finality handoff test only reads accepted evidence"),
        read: () => Effect.succeed(new TextEncoder().encode(JSON.stringify(manifest)))
      })
      const currentClaim = yield* Ref.make<CompletionClaimObservation>(accepted.activeClaim)
      const completionCalls = yield* Ref.make<ReadonlyArray<unknown>>([])
      const currentPermissionReads = yield* Ref.make<ReadonlyArray<unknown>>([])
      const replacementBoundary = CompletionClaimBoundary.of({
        readOriginalTaskClaim: () => Effect.succeed(accepted.activeClaim),
        readTaskClaim: () => Ref.get(currentClaim),
        readCompletionClaimMarker: () =>
          Effect.die("claim replacement does not need an independent completion-marker read"),
        replaceTaskClaim: (request) => Ref.set(currentClaim, request.claim).pipe(Effect.as(request.claim)),
        deleteTaskClaim: () => Effect.die("claim replacement does not delete a completion claim"),
        releaseOriginalTaskClaim: () => Effect.die("claim replacement does not release the original claim")
      })
      const replacement = yield* process((store) =>
        Effect.gen(function* () {
          const records = yield* store.read(runId)
          const history = reduceWorkflowJournalHistory(runId, records)
          if (history._tag === "InvalidWorkflowJournalHistory") {
            return yield* Effect.die("promotion should retain a valid prefix before claim replacement")
          }
          return yield* runCompletionClaimReplacementProtocol(
            replacementBoundary,
            completionClaimReplacementRequestFor(completionRequest.claim)
          ).pipe(Effect.provide(journalLayer(runId, fixture.target, history, store)))
        })
      )
      expect(replacement._tag).toBe("CompletionClaimReplaced")
      const completionBoundary = CompletionTaskBoundary.of({
        completeTask: (request) =>
          Ref.update(completionCalls, (calls) => [...calls, request]).pipe(
            Effect.as(CompletionTaskAcknowledgement.make({ operationId: request.operationId, taskId: request.taskId }))
          ),
        readCompletionRequest: () => Effect.die("fresh completion does not need request lookup"),
        readFocusedTaskCompletion: ({ operationId }) => {
          const facts = {
            ...fixture.focusedSuccessFactsEvent.observation.facts,
            currentClaim: completionRequest.claim,
            lifecycle: "Open" as const,
            taskRevision: candidate.run.session.plannedAttempt.taskRevision,
            operationId
          }
          return Ref.update(currentPermissionReads, (reads) => [...reads, facts]).pipe(Effect.as(facts))
        }
      })
      const completion = yield* process((store) =>
        Effect.gen(function* () {
          const records = yield* store.read(runId)
          const history = reduceWorkflowJournalHistory(runId, records)
          if (history._tag === "InvalidWorkflowJournalHistory") {
            return yield* Effect.die("promoted resume history must remain valid for finality")
          }
          return yield* runCompletionTaskProtocol(completionBoundary, completionRequest, fixture.target, (ordinal) =>
            authorizeCompletionTaskAttempt(completionBoundary, completionRequest, fixture.target, ordinal).pipe(
              Effect.provide(Layer.succeed(TargetPromotionGit, promotionGit))
            )
          ).pipe(
            Effect.provide(
              Layer.merge(
                journalLayer(runId, fixture.target, history, store),
                Layer.merge(
                  Layer.succeed(EvidenceStore, completionEvidence),
                  Layer.succeed(TargetPromotionGit, promotionGit)
                )
              )
            )
          )
        })
      )
      expect(completion).toEqual(
        CompletionTaskAcknowledgement.make({
          operationId: completionRequest.operationId,
          taskId: completionRequest.taskId
        })
      )
      expect(yield* Ref.get(completionCalls)).toEqual([completionRequest])
      const observedPermissions = yield* Ref.get(currentPermissionReads)
      expect(observedPermissions).not.toHaveLength(0)
      expect(observedPermissions).toContainEqual(
        expect.objectContaining({
          currentClaim: completionRequest.claim,
          lifecycle: "Open",
          taskRevision: candidate.run.session.plannedAttempt.taskRevision
        })
      )
      expect(recordTags(yield* process((store) => store.read(runId)))).toContain("CompletionTaskAcknowledged")
    })
  )
)

const exerciseAmbiguousResumeRecovery = (process: StoreProcess): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const firstDenial = yield* makeGit("denied")
    yield* process((store) => invoke(store, firstDenial.git, "run"))
    const request = requestFor("resume-ambiguous-activation")
    const uncertainPush = yield* makeGit("uncertain")
    expect(yield* process((store) => invoke(store, uncertainPush.git, { request }))).toMatchObject({
      _tag: "PublicationPending",
      authorization: { _tag: "ResumeRequest", requestId: request.requestId }
    })
    expect((yield* Ref.get(uncertainPush.calls)).timeline).toEqual([
      "custody:1",
      `observe:${candidate.run.session.expectedTargetHead}`,
      "prepare:2",
      "push:2"
    ])
    expect(publicationOrdinals(yield* process((store) => store.read(runId)))).toEqual([1, 2])

    const recovery = yield* makeGit("applied")
    expect((yield* process((store) => invoke(store, recovery.git, { request })))._tag).toBe("PublicationSucceeded")
    expect((yield* Ref.get(recovery.calls)).timeline).toEqual([
      "custody:2",
      `observe:${candidate.run.session.expectedTargetHead}`,
      "prepare:3",
      "push:3"
    ])
    expect(publicationOrdinals(yield* process((store) => store.read(runId)))).toEqual([1, 2, 3])
  })

it.effect("reconciles the active receipt after an ambiguous push before any later push", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* memoryFresh(exerciseAmbiguousResumeRecovery)
      yield* sqliteFresh(exerciseAmbiguousResumeRecovery)
    })
  )
)

const exercisePreExistingCompatibleHeadWait = (process: StoreProcess): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const initialGit = yield* makeGit("competing")
    const initial = yield* process((store) => invoke(store, initialGit.git, "run"))
    expect(initial).toMatchObject({ _tag: "PublicationRetained", cause: { _tag: "CompatibleCompetingHead" } })
    const before = yield* process((store) => store.read(runId))
    const hints = yield* Ref.make<ReadonlyArray<RunReactivationHint>>([])
    const owners: RemotePublicationResumeRuntimeOwners = {
      ordinaryRun: { hint: (hint) => Ref.update(hints, (current) => [...current, hint]) }
    }
    const request = requestFor("resume-to-pre-existing-competing-head")
    const resumedGit = yield* makeGit("competing")
    const retained = yield* process((store) => invoke(store, resumedGit.git, { request, runtimeOwners: owners }))
    expect(retained).toMatchObject({
      _tag: "PublicationRetained",
      authorization: { _tag: "ResumeRequest", requestId: request.requestId },
      correlation: { qualifiedCandidate: candidate, target },
      cause: {
        _tag: "CompatibleCompetingHead",
        mergeBase: candidate.run.session.expectedTargetHead,
        remoteHead: GitCommitSha.make("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
      }
    })
    expect(yield* Ref.get(hints)).toEqual([RunReactivationHint.AcceptedFactPublication()])
    expect(yield* Ref.get(resumedGit.calls)).toMatchObject({
      custody: 0,
      observations: 1,
      pushes: [],
      preparations: []
    })
    const records = yield* process((store) => store.read(runId))
    const runBeginsBefore = before.filter(({ event }) => event._tag === "WorkflowRunBegan").length
    const integratorStartsBefore = before.filter(({ event }) => event._tag === "IntegratorRunStarted").length
    expect(records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(runBeginsBefore)
    expect(records.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(integratorStartsBefore)
    expect(publicationOrdinals(records)).toEqual([])
    expect(records.filter(({ event }) => event._tag === "RemotePublicationResumeRequested")).toEqual([
      expect.objectContaining({ event: expect.objectContaining({ request }) })
    ])
  })

it.effect("resumes a pre-existing compatible-head wait through the ordinary Run frontier", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* memoryFresh(exercisePreExistingCompatibleHeadWait)
      yield* sqliteFresh(exercisePreExistingCompatibleHeadWait)
    })
  )
)

it.effect("resume proof wakes the ordinary Run owner while downstream finality remains", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const exercise = (process: StoreProcess) =>
        Effect.gen(function* () {
          const denied = yield* makeGit("denied")
          yield* process((store) => invoke(store, denied.git, "run"))
          const hints = yield* Ref.make<ReadonlyArray<RunReactivationHint>>([])
          const owners = {
            ordinaryRun: { hint: (hint: RunReactivationHint) => Ref.update(hints, (current) => [...current, hint]) }
          }
          const resumedGit = yield* makeGit("applied")
          const resumed = yield* process((store) =>
            invoke(store, resumedGit.git, { request: requestFor("resume-to-publication-proof"), runtimeOwners: owners })
          )
          expect(resumed._tag).toBe("PublicationSucceeded")
          expect(yield* Ref.get(hints)).toEqual([RunReactivationHint.AcceptedFactPublication()])
          expect(yield* Ref.get(resumedGit.calls)).toMatchObject({ preparations: [2], pushes: [2] })

          const records = yield* process((store) => store.read(runId))
          const beginsBeforeSettledRequest = records.filter(({ event }) => event._tag === "WorkflowRunBegan").length
          const integratorStartsBeforeSettledRequest = records.filter(
            ({ event }) => event._tag === "IntegratorRunStarted"
          ).length
          const finalityPendingGit = yield* makeGit("applied")
          const finalityPending = yield* process((store) =>
            invoke(store, finalityPendingGit.git, {
              request: requestFor("resume-while-finality-pending"),
              runtimeOwners: owners
            })
          )
          expect(finalityPending).toEqual(resumed)
          expect(yield* Ref.get(finalityPendingGit.calls)).toEqual(emptyCalls())
          expect(yield* Ref.get(hints)).toEqual([
            RunReactivationHint.AcceptedFactPublication(),
            RunReactivationHint.AcceptedFactPublication()
          ])
          const finalRecords = yield* process((store) => store.read(runId))
          expect(finalRecords.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(
            beginsBeforeSettledRequest
          )
          expect(finalRecords.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(
            integratorStartsBeforeSettledRequest
          )
        })
      yield* memoryFresh(exercise)
      yield* sqliteFresh(exercise)
    })
  )
)

it.effect("rejects resume schema and exact Run or responsibility mismatches before journal mutation", () =>
  memoryFresh((process) =>
    Effect.gen(function* () {
      const denied = yield* makeGit("denied")
      yield* process((store) => invoke(store, denied.git, "run"))
      const before = yield* process((store) => store.read(runId))
      const unused = yield* makeGit("applied")
      const valid = requestFor("invalid-resume-subject")
      const invalidSchema = { ...valid, schemaVersion: 2 }
      const wrongRun = RemotePublicationResumeRequest.make({
        ...valid,
        runId: RunId.make("foreign-resume-run"),
        responsibility: IntegrationResponsibilityIdentity.make({
          queuedAt: valid.responsibility.queuedAt,
          runId: RunId.make("foreign-resume-run")
        })
      })
      const wrongResponsibility = RemotePublicationResumeRequest.make({
        ...valid,
        responsibility: IntegrationResponsibilityIdentity.make({
          queuedAt: JournalPosition.make(Number(valid.responsibility.queuedAt) + 1),
          runId
        })
      })
      for (const request of [invalidSchema, wrongRun, wrongResponsibility]) {
        const exit = yield* Effect.exit(process((store) => invoke(store, unused.git, { request })))
        expect(exit._tag).toBe("Failure")
      }
      expect(yield* Ref.get(unused.calls)).toEqual(emptyCalls())
      expect(recordTags(yield* process((store) => store.read(runId)))).toEqual(recordTags(before))
    })
  )
)

const exerciseDistinctResumeRequests = (process: StoreProcess): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const initialDenial = yield* makeGit("denied")
    yield* process((store) => invoke(store, initialDenial.git, "run"))
    const firstResume = yield* makeGit("denied")
    expect(
      (yield* process((store) => invoke(store, firstResume.git, { request: requestFor("resume-same-id") })))._tag
    ).toBe("PublicationRetained")
    expect(publicationOrdinals(yield* process((store) => store.read(runId)))).toEqual([1, 2])

    const beforeReplay = yield* process((store) => store.read(runId))
    const retainedRows = beforeReplay.filter(({ event }) => event._tag === "RemotePublicationRetained")
    expect(retainedRows.map(({ key }) => key)).toHaveLength(2)
    expect(
      retainedRows.map(({ event }) => (event._tag === "RemotePublicationRetained" ? event.authorization : undefined))
    ).toEqual([
      RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
      RemotePublicationAttemptAuthorization.cases.ResumeRequest.make({
        requestId: RemotePublicationResumeRequestId.make("resume-same-id")
      })
    ])
    expect(retainedRows[0]?.key).not.toBe(retainedRows[1]?.key)

    const corruptLink = RemotePublicationResumeRequestId.make("wrong-resume-link")
    const corruptedEvents = publicationEvents(beforeReplay).map((event) =>
      event._tag === "RemotePublicationRetained" && event.authorization._tag === "ResumeRequest"
        ? RemotePublicationRetainedEvent.make({
            ...event,
            authorization: RemotePublicationAttemptAuthorization.cases.ResumeRequest.make({ requestId: corruptLink })
          })
        : event
    )
    expect(deriveRemotePublicationState(corruptedEvents)._tag).toBe("PublicationContradiction")

    const duplicate = yield* makeGit("applied")
    expect(
      (yield* process((store) => invoke(store, duplicate.git, { request: requestFor("resume-same-id") })))._tag
    ).toBe("PublicationRetained")
    expect(yield* Ref.get(duplicate.calls)).toEqual(emptyCalls())
    expect(recordTags(yield* process((store) => store.read(runId)))).toEqual(recordTags(beforeReplay))

    const laterRepair = yield* makeGit("applied")
    expect(
      (yield* process((store) => invoke(store, laterRepair.git, { request: requestFor("resume-repaired-facts") })))._tag
    ).toBe("PublicationSucceeded")
    expect(publicationOrdinals(yield* process((store) => store.read(runId)))).toEqual([1, 2, 3])
    expect(yield* Ref.get(laterRepair.calls)).toMatchObject({ custody: 1, preparations: [3], pushes: [3] })
  })

const exerciseUnchangedIncompatibleResume = (process: StoreProcess): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const initial = yield* makeGit("incompatible")
    expect((yield* process((store) => invoke(store, initial.git, "run")))._tag).toBe("PublicationRetained")
    expect(yield* Ref.get(initial.calls)).toMatchObject({ custody: 0, observations: 1, preparations: [], pushes: [] })
    const beforeResume = yield* process((store) => store.read(runId))
    expect(publicationOrdinals(beforeResume)).toEqual([])

    const request = requestFor("resume-incompatible-unchanged")
    const unchanged = yield* makeGit("incompatible")
    expect(yield* process((store) => invoke(store, unchanged.git, { request }))).toMatchObject({
      _tag: "PublicationRetained",
      cause: { _tag: "IncompatibleLineage" }
    })
    expect(yield* Ref.get(unchanged.calls)).toMatchObject({ custody: 0, observations: 1, preparations: [], pushes: [] })

    const afterResume = yield* process((store) => store.read(runId))
    const events = publicationEvents(afterResume)
    expect(deriveRemotePublicationState(events)).toMatchObject({
      _tag: "PublicationRetained",
      cause: { _tag: "IncompatibleLineage", remoteHead: GitCommitSha.make("cccccccccccccccccccccccccccccccccccccccc") },
      authorization: { _tag: "ResumeRequest", requestId: request.requestId }
    })
    expect(publicationOrdinals(afterResume)).toEqual([])
    expect(afterResume.filter(({ event }) => event._tag === "RemotePublicationResumeRequested")).toEqual([
      expect.objectContaining({ event: expect.objectContaining({ request }) })
    ])
    const retained = afterResume.filter(({ event }) => event._tag === "RemotePublicationRetained")
    expect(retained).toHaveLength(2)
    expect(retained.map(({ event }) => (event._tag === "RemotePublicationRetained" ? event.cause._tag : ""))).toEqual([
      "IncompatibleLineage",
      "IncompatibleLineage"
    ])
    expect(retained.at(-1)?.event).toMatchObject({
      authorization: { _tag: "ResumeRequest", requestId: request.requestId },
      correlation: { qualifiedCandidate: candidate, target }
    })
    expect(afterResume.filter(({ event }) => event._tag === "IntegratorRunStarted").length).toBe(
      beforeResume.filter(({ event }) => event._tag === "IntegratorRunStarted").length
    )
    expect(afterResume.filter(({ event }) => event._tag === "IntegratorSessionFixed").length).toBe(
      beforeResume.filter(({ event }) => event._tag === "IntegratorSessionFixed").length
    )
  })

const exerciseRepairedIncompatibleResume = (process: StoreProcess): Effect.Effect<void, unknown> =>
  Effect.gen(function* () {
    const initial = yield* makeGit("incompatible")
    expect((yield* process((store) => invoke(store, initial.git, "run")))._tag).toBe("PublicationRetained")
    expect(publicationOrdinals(yield* process((store) => store.read(runId)))).toEqual([])

    const request = requestFor("resume-incompatible-repaired-current")
    const repaired = yield* makeGit("candidate-current")
    const resumed = yield* process((store) => invoke(store, repaired.git, { request }))
    expect(resumed).toMatchObject({
      _tag: "PublicationSucceeded",
      proof: { _tag: "ReconciledCandidateCurrent", attemptOrdinal: 1, remoteHead: candidate.candidateCommit }
    })
    expect(yield* Ref.get(repaired.calls)).toMatchObject({ custody: 0, observations: 1, preparations: [1], pushes: [] })

    const afterResume = yield* process((store) => store.read(runId))
    const events = publicationEvents(afterResume)
    expect(deriveRemotePublicationState(events)).toMatchObject({
      _tag: "PublicationSucceeded",
      proof: { _tag: "ReconciledCandidateCurrent", attemptOrdinal: 1, remoteHead: candidate.candidateCommit }
    })
    expect(publicationOrdinals(afterResume)).toEqual([1])
    expect(afterResume.filter(({ event }) => event._tag === "RemotePublicationResumeRequested")).toEqual([
      expect.objectContaining({ event: expect.objectContaining({ request }) })
    ])
    expect(afterResume.at(-1)?.event).toMatchObject({
      _tag: "RemotePublicationSucceeded",
      correlation: { qualifiedCandidate: candidate, target },
      proof: { _tag: "ReconciledCandidateCurrent", attemptOrdinal: 1, remoteHead: candidate.candidateCommit }
    })
  })

it.effect("deduplicates one resume identity and allows a later distinct repair request within the same allowance", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* memoryFresh(exerciseDistinctResumeRequests)
      yield* sqliteFresh(exerciseDistinctResumeRequests)
    })
  )
)

it.effect("keeps unchanged incompatible lineage retained with no push in memory and reopened SQLite", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* memoryFresh(exerciseUnchangedIncompatibleResume)
      yield* sqliteFresh(exerciseUnchangedIncompatibleResume)
    })
  )
)

it.effect("uses repaired compatible facts to prove the same candidate in memory and reopened SQLite", () =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* memoryFresh(exerciseRepairedIncompatibleResume)
      yield* sqliteFresh(exerciseRepairedIncompatibleResume)
    })
  )
)

it.effect("does not retry a throttled publication through a retained resume request", () =>
  memoryFresh((process) =>
    Effect.gen(function* () {
      const throttle = yield* makeGit("throttled")
      expect((yield* process((store) => invoke(store, throttle.git, "run")))._tag).toBe("PublicationRetained")
      const beforeResume = yield* process((store) => store.read(runId))
      const resume = yield* makeGit("applied")
      expect(
        (yield* process((store) => invoke(store, resume.git, { request: requestFor("no-throttle-retry") })))._tag
      ).toBe("PublicationRetained")
      expect(yield* Ref.get(resume.calls)).toEqual(emptyCalls())
      const afterResume = yield* process((store) => store.read(runId))
      expect(recordTags(afterResume)).toEqual(recordTags(beforeResume))
      expect(publicationOrdinals(afterResume)).toEqual([1])
    })
  )
)

it.effect("a persistent denial stops at the accepted attempt limit and cannot be resumed again", () =>
  memoryFresh((process) =>
    Effect.gen(function* () {
      const first = yield* makeGit("denied")
      yield* process((store) => invoke(store, first.git, "run"))
      const second = yield* makeGit("denied")
      yield* process((store) => invoke(store, second.git, { request: requestFor("denied-resume-2") }))
      const third = yield* makeGit("denied")
      expect(
        (yield* process((store) => invoke(store, third.git, { request: requestFor("denied-resume-3") })))._tag
      ).toBe("PublicationRetained")
      expect(publicationOrdinals(yield* process((store) => store.read(runId)))).toEqual([1, 2, 3])

      const beforeExhaustedReplay = yield* process((store) => store.read(runId))
      const fourth = yield* makeGit("applied")
      expect(
        (yield* process((store) => invoke(store, fourth.git, { request: requestFor("denied-resume-4") })))._tag
      ).toBe("PublicationRetained")
      expect(yield* Ref.get(fourth.calls)).toEqual(emptyCalls())
      expect(recordTags(yield* process((store) => store.read(runId)))).toEqual(recordTags(beforeExhaustedReplay))
      expect(
        (yield* process((store) => store.read(runId))).filter(
          ({ event }) => event._tag === "RemotePublicationResumeRequested"
        )
      ).toHaveLength(2)
    })
  )
)

it.effect("a permitted reconciliation phase retains the same attempt when the sender phase is interrupted", () =>
  memoryFresh((process) =>
    Effect.gen(function* () {
      const first = yield* makeGit("denied")
      yield* process((store) => invoke(store, first.git, "run"))
      const permittedReconciliation: RemotePublicationPhaseBoundary = {
        runObservation: (phase) => phase,
        runSender: (_phase) => Effect.interrupt
      }
      const request = requestFor("resume-during-pause")
      const reconciledGit = yield* makeGit("applied")
      expect(
        (yield* Effect.exit(
          process((store) => invoke(store, reconciledGit.git, { request }, undefined, permittedReconciliation))
        ))._tag
      ).toBe("Failure")
      expect(yield* Ref.get(reconciledGit.calls)).toMatchObject({
        custody: 1,
        observations: 1,
        preparations: [],
        pushes: []
      })
      expect((yield* Ref.get(reconciledGit.calls)).timeline).toEqual([
        `custody:1`,
        `observe:${candidate.run.session.expectedTargetHead}`
      ])
      expect(publicationOrdinals(yield* process((store) => store.read(runId)))).toEqual([1])

      const blockedSenderReplay = yield* makeGit("applied")
      expect(
        (yield* Effect.exit(
          process((store) => invoke(store, blockedSenderReplay.git, { request }, undefined, permittedReconciliation))
        ))._tag
      ).toBe("Failure")
      expect((yield* Ref.get(blockedSenderReplay.calls)).pushes).toEqual([])
      expect((yield* Ref.get(blockedSenderReplay.calls)).preparations).toEqual([])
      expect(
        (yield* process((store) => store.read(runId))).filter(
          ({ event }) => event._tag === "RemotePublicationResumeRequested"
        )
      ).toHaveLength(1)

      const permittedSender = yield* makeGit("applied")
      expect((yield* process((store) => invoke(store, permittedSender.git, { request })))._tag).toBe(
        "PublicationSucceeded"
      )
      expect(yield* Ref.get(permittedSender.calls)).toMatchObject({ preparations: [2], pushes: [2] })
    })
  )
)

it.effect("a permitted reconciliation phase records exact proof without preparing or sending", () =>
  memoryFresh((process) =>
    Effect.gen(function* () {
      const first = yield* makeGit("denied")
      yield* process((store) => invoke(store, first.git, "run"))
      const permittedReconciliation: RemotePublicationPhaseBoundary = {
        runObservation: (phase) => phase,
        runSender: (_phase) => Effect.interrupt
      }
      const receipt = requestFor("resume-observed-published-under-pause")
      const observed = yield* makeGit("candidate-current")
      expect(
        (yield* process((store) =>
          invoke(store, observed.git, { request: receipt }, undefined, permittedReconciliation)
        ))._tag
      ).toBe("PublicationSucceeded")
      expect(yield* Ref.get(observed.calls)).toMatchObject({
        custody: 1,
        observations: 1,
        preparations: [],
        pushes: []
      })
      const records = yield* process((store) => store.read(runId))
      expect(publicationOrdinals(records)).toEqual([1])
      expect(recordTags(records).slice(-2)).toEqual(["RemotePublicationResumeRequested", "RemotePublicationSucceeded"])
      const proof = records.at(-1)?.event
      expect(proof).toMatchObject({
        _tag: "RemotePublicationSucceeded",
        proof: { _tag: "ReconciledCandidateCurrent", attemptOrdinal: 1, remoteHead: candidate.candidateCommit }
      })
      expect(recordTags(records).filter((tag) => tag === "WorkflowRunBegan")).toHaveLength(1)
    })
  )
)

it.effect("application Exit interrupts resume before observation or a new publication attempt", () =>
  memoryFresh((process) =>
    Effect.gen(function* () {
      const first = yield* makeGit("denied")
      yield* process((store) => invoke(store, first.git, "run"))
      const exiting: RemotePublicationPhaseBoundary = {
        runObservation: (_phase) => Effect.interrupt,
        runSender: (_phase) => Effect.interrupt
      }
      const exitingGit = yield* makeGit("applied")
      const request = requestFor("resume-during-exit")
      const priorRecords = yield* process((store) => store.read(runId))
      expect(
        (yield* Effect.exit(process((store) => invoke(store, exitingGit.git, { request }, undefined, exiting))))._tag
      ).toBe("Failure")
      expect(yield* Ref.get(exitingGit.calls)).toEqual(emptyCalls())
      const records = yield* process((store) => store.read(runId))
      expect(publicationOrdinals(records)).toEqual([1])
      expect(records.filter(({ event }) => event._tag === "RemotePublicationResumeRequested")).toHaveLength(1)
      expect(recordTags(records).filter((tag) => tag === "WorkflowRunBegan")).toHaveLength(
        recordTags(priorRecords).filter((tag) => tag === "WorkflowRunBegan").length
      )
    })
  )
)
