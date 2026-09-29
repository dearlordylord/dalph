import { NodeFileSystem, NodePath } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { expect } from "vitest"
import { Context, Effect, FileSystem, HashSet, Layer, Option, Path, Ref } from "effect"
import { GitCommitSha } from "@dalph/contracts"
import {
  IntegratorCandidateText,
  IntegratorGitObservation,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCandidateGitReadIntendedEvent,
  IntegratorRunOrdinal,
  IntegratorRunResultRecordedEvent,
  IntegratorRunStartedEvent,
  IntegratorResult
} from "./events.js"
import { Integrator, IntegratorGit, integratorRunCorrelationForSession } from "./protocol.js"
import { prepareIntegratorAutomaticSuccessorSessionAppend } from "./automatic-successor-session.js"
import { journalLayer, type JournalStorageBoundary } from "../../../coordination/delivery/journal.js"
import { reduceWorkflowJournalHistory } from "../../../coordination/reconstruction/history.js"
import { JournalDatabaseLocator } from "../../../workflow-journal/identity.js"
import { JournalStore, type JournalRecord } from "../../../workflow-journal/store.js"
import { memoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { sqliteJournalStoreLayer } from "../../../workflow-journal/adapters/sqlite-store.js"
import { RemoteBaselineGit } from "../direct-publication/baseline-events.js"
import { RemotePublicationGit } from "../direct-publication/events.js"
import { makeSuccessorPrefix } from "../../../../test/support/automatic-successor-history.js"
import {
  integratorAutomaticSuccessorSessionFixedRecordKey,
  integratorRunCandidateGitObservedRecordKey,
  integratorRunCandidateGitReadIntendedRecordKey,
  integratorRunResultRecordedRecordKey,
  integratorRunStartedRecordKey
} from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { deriveCurrentIntegratorState } from "./state.js"
import { makeIntegrationTargetResourceController } from "../../../coordination/admission/integration-target-resource.js"
import type { DeliveryActionExecutionLease } from "../../../coordination/delivery/delivery-action-executor.js"
import { deliveryProposalsOf } from "../../../coordination/delivery/delivery-proposal.js"
import type {
  DeliveryActionProposal,
  IdentityFreeDeliveryProposal
} from "../../../coordination/delivery/delivery-action-proposal.js"
import { RunnableFrontierTransition } from "../../../coordination/frontier/frontier.js"
import { executeIntegrationAction } from "../../../coordination/delivery/integration-delivery-action-adapter.js"

type OpenStore = <A>(use: (store: JournalStore["Service"]) => Effect.Effect<A, unknown>) => Effect.Effect<A, unknown>
type ResultAppendFailure = "BeforeCommit" | undefined

const isIdentityFreeProposal = (proposal: DeliveryActionProposal): proposal is IdentityFreeDeliveryProposal =>
  proposal.actionIdentity._tag === "NoWorkflowOperationIdentity"

const makeIntegratorActionLease = Effect.fn("AutomaticSuccessorResultRecoveryTest.makeActionLease")(function* (
  responsibility: ReturnType<typeof makeSuccessorPrefix>["accepted"]["responsibility"]
) {
  const integrationTargets = yield* makeIntegrationTargetResourceController()
  yield* integrationTargets.acquire(responsibility)
  yield* integrationTargets.publishAcceptedOwnership(responsibility)
  const lease: DeliveryActionExecutionLease = {
    acceptIntegrationTargetOwnership: Effect.void,
    bindPlannedAttemptPosition: () => Effect.void,
    forwardBoundary: { _tag: "AtomicBoundary", execution: { run: (effect) => effect } },
    integrationTargets,
    recordIntent: () => Effect.void,
    releasePlannedAttemptPosition: () => Effect.void,
    withPlannedAttemptProtocol: () => Effect.die("RunIntegrator does not use planned-attempt executor custody")
  }
  return lease
})

const integratorJournalInventory = (records: ReadonlyArray<JournalRecord>) =>
  records
    .filter(
      ({ event }) =>
        event._tag === "IntegratorSessionFixed" ||
        event._tag === "IntegratorAutomaticSuccessorSessionFixed" ||
        event._tag === "IntegratorRunStarted" ||
        event._tag === "IntegratorRunResultRecorded" ||
        event._tag === "IntegratorRunCandidateGitReadIntended" ||
        event._tag === "IntegratorRunCandidateGitObserved"
    )
    .map(({ event, key }) => ({ key, event }))

const seedAutomaticSuccessorHistory = Effect.fn("AutomaticSuccessorResultRecoveryTest.seedHistory")(function* (
  store: JournalStore["Service"],
  fixture: ReturnType<typeof makeSuccessorPrefix>
) {
  const records = fixture.records()
  const [beginning, ...remaining] = records
  if (beginning?.event._tag !== "WorkflowRunBegan") {
    return yield* Effect.die("automatic S2 recovery prefix must begin one Run")
  }
  yield* store.beginRun(
    fixture.runId,
    beginning.event.target,
    beginning.event.initialControlPolicy,
    beginning.event.remotePublicationTarget
  )
  for (const record of remaining) {
    if (record.event._tag === "WorkflowRunBegan" || record.event._tag === "WorkflowRunTerminated") {
      return yield* Effect.die("automatic S2 recovery prefix may not contain another Run lifecycle event")
    }
    yield* store.append(fixture.runId, record.key, record.event)
  }
})

const exerciseAutomaticSuccessorResultAppend = Effect.fn("AutomaticSuccessorResultRecoveryTest.exerciseResultAppend")(
  function* (failure: Exclude<ResultAppendFailure, undefined>, openStore: OpenStore) {
    const fixture = makeSuccessorPrefix()
    const preparedSession = yield* prepareIntegratorAutomaticSuccessorSessionAppend(
      fixture.input,
      fixture.reduction.prefix
    )
    if (preparedSession._tag !== "Append") {
      return yield* Effect.die("accepted S2 prefix must fix one automatic successor before provider contact")
    }
    fixture.append(preparedSession.event)
    const successor = preparedSession.event.successor
    const run = integratorRunCorrelationForSession(successor, IntegratorRunOrdinal.make(1))
    expect(successor.candidateResource).not.toEqual(preparedSession.event.predecessor.candidateResource)
    const candidateText = IntegratorCandidateText.make("refs/heads/dalph/automatic-successor-candidate")
    const candidateCommit = GitCommitSha.make("f".repeat(40))
    const candidateObservation = IntegratorGitObservation.cases.Commit.make({
      candidateText,
      commit: candidateCommit,
      directParents: [successor.expectedTargetHead, successor.acceptedResult.commit]
    })
    const providerResult = IntegratorResult.cases.PreparedCandidate.make({ candidateText, correlation: run })
    const runStarted = IntegratorRunStartedEvent.make({ run, version: workflowJournalEventVersion })
    const resultRecorded = IntegratorRunResultRecordedEvent.make({
      result: providerResult,
      run,
      version: workflowJournalEventVersion
    })
    const gitReadIntended = IntegratorRunCandidateGitReadIntendedEvent.make({
      candidateText,
      run,
      version: workflowJournalEventVersion
    })
    const gitObserved = IntegratorRunCandidateGitObservedEvent.make({
      candidateText,
      observation: candidateObservation,
      run,
      version: workflowJournalEventVersion
    })
    const runStartedKey = integratorRunStartedRecordKey(run)
    const resultRecordedKey = integratorRunResultRecordedRecordKey(run)
    const gitReadIntendedKey = integratorRunCandidateGitReadIntendedRecordKey(run, candidateText)
    const gitObservedKey = integratorRunCandidateGitObservedRecordKey(run, candidateText)
    const successorFixedKey = integratorAutomaticSuccessorSessionFixedRecordKey(
      preparedSession.event.predecessor,
      preparedSession.event.authorizationAt
    )
    const transition = RunnableFrontierTransition.RunIntegrator({
      lineage: fixture.input.targetLineage,
      lineageObservedAt: fixture.input.targetLineageObservedAt,
      responsibility: fixture.accepted.responsibility,
      run
    })
    const routed = deliveryProposalsOf({
      acceptedOperationIds: HashSet.empty(),
      fresh: [],
      integrationResponsibilities: [fixture.accepted.responsibility],
      responsibilities: [],
      runId: fixture.runId,
      transitions: [transition]
    })
    const proposal = [...routed.ticketDelivery, ...routed.deliverySettlement][0]
    if (proposal === undefined || !isIdentityFreeProposal(proposal)) {
      return yield* Effect.die("exact automatic S2 RunIntegrator transition must produce its ordinary proposal")
    }
    const action = { _tag: "IdentityFreeAction" as const, proposal }
    const providerCalls = yield* Ref.make<ReadonlyArray<typeof run>>([])
    const writerStarts = yield* Ref.make(0)
    const writerActive = yield* Ref.make(false)
    const cachedProviderResult = yield* Ref.make<Option.Option<IntegratorResult>>(Option.none())
    const gitReadCalls = yield* Ref.make(0)
    const resultAppendAttempts = yield* Ref.make(0)

    const provider = Integrator.of({
      prepare: (request) =>
        Effect.gen(function* () {
          if (JSON.stringify(request.correlation) !== JSON.stringify(run)) {
            return yield* Effect.die("provider retry must retain the exact automatic S2 session and run ordinal")
          }
          yield* Ref.update(providerCalls, (calls) => [...calls, request.correlation])
          const cached = yield* Ref.get(cachedProviderResult)
          if (Option.isSome(cached)) return cached.value
          if (yield* Ref.get(writerActive)) {
            return yield* Effect.die("automatic S2 may not overlap provider writers for one run")
          }
          yield* Ref.set(writerActive, true)
          yield* Ref.update(writerStarts, (count) => count + 1)
          yield* Ref.set(cachedProviderResult, Option.some(providerResult))
          yield* Ref.set(writerActive, false)
          return providerResult
        })
    })

    const git = IntegratorGit.of({
      readCandidate: (requestedTarget, requestedCandidate) =>
        Ref.update(gitReadCalls, (count) => count + 1).pipe(
          Effect.andThen(
            requestedCandidate === candidateText &&
              JSON.stringify(requestedTarget) === JSON.stringify(successor.integrationTarget)
              ? Effect.succeed(candidateObservation)
              : Effect.die("automatic S2 Git read must inspect the exact provider-reported candidate")
          )
        )
    })

    const unusedRemotePublicationGit = RemotePublicationGit.of({
      admit: () => Effect.die("automatic S2 result recovery never admits remote publication"),
      observe: () => Effect.die("automatic S2 result recovery never observes remote publication"),
      prepareSenderCustody: () => Effect.die("automatic S2 result recovery never prepares a remote sender"),
      push: () => Effect.die("automatic S2 result recovery never pushes"),
      reconcileSenderCustody: () => Effect.die("automatic S2 result recovery never reconciles a remote sender")
    })
    const unusedRemoteBaselineGit = RemoteBaselineGit.of({
      catchUp: () => Effect.die("automatic S2 result recovery never catches up a remote baseline"),
      observe: () => Effect.die("automatic S2 result recovery never observes a remote baseline"),
      reconcileCatchUp: () => Effect.die("automatic S2 result recovery never reconciles a remote baseline")
    })

    const storageBoundary = (
      store: JournalStore["Service"],
      appendFailure: ResultAppendFailure
    ): JournalStorageBoundary => ({
      append: (runId, key, event) => {
        if (event._tag !== "IntegratorRunResultRecorded") return store.append(runId, key, event)
        if (JSON.stringify(event.run) !== JSON.stringify(run)) {
          return Effect.die("result append must retain the exact automatic S2 run correlation")
        }
        return Ref.update(resultAppendAttempts, (count) => count + 1).pipe(
          Effect.andThen(
            appendFailure === "BeforeCommit"
              ? Effect.die("process stopped before automatic S2 result committed")
              : store.append(runId, key, event)
          )
        )
      },
      read: store.read,
      terminateRun: store.terminateRun
    })

    const activate = (store: JournalStore["Service"], appendFailure: ResultAppendFailure) =>
      Effect.scoped(
        Effect.gen(function* () {
          const stored = yield* store.read(fixture.runId)
          const history = reduceWorkflowJournalHistory(fixture.runId, stored)
          if (history._tag !== "ValidWorkflowJournalHistory") {
            return yield* Effect.die(
              `automatic S2 result recovery prefix is invalid: ${JSON.stringify(history.issues)}`
            )
          }
          const lease = yield* makeIntegratorActionLease(fixture.accepted.responsibility)
          return yield* executeIntegrationAction(action, transition, lease, fixture.accepted.trackerTarget).pipe(
            Effect.provide(
              journalLayer(
                fixture.runId,
                fixture.accepted.trackerTarget,
                history,
                storageBoundary(store, appendFailure)
              )
            ),
            Effect.provideService(Integrator, provider),
            Effect.provideService(IntegratorGit, git),
            Effect.provideService(RemotePublicationGit, unusedRemotePublicationGit),
            Effect.provideService(RemoteBaselineGit, unusedRemoteBaselineGit)
          )
        })
      )

    yield* openStore((store) => seedAutomaticSuccessorHistory(store, fixture))
    const beforeRecords = yield* openStore((store) => store.read(fixture.runId))
    const beforeInventory = integratorJournalInventory(beforeRecords)
    expect(beforeRecords.find(({ key }) => key === successorFixedKey)).toMatchObject({
      key: successorFixedKey,
      event: preparedSession.event
    })
    const first = yield* Effect.exit(openStore((store) => activate(store, failure)))
    expect(first._tag).toBe("Failure")
    expect(yield* Ref.get(resultAppendAttempts)).toBe(1)
    expect(yield* Ref.get(providerCalls)).toEqual([run])
    expect(yield* Ref.get(writerStarts)).toBe(1)
    expect(yield* Ref.get(writerActive)).toBe(false)
    expect(yield* Ref.get(gitReadCalls)).toBe(0)

    const interruptedRecords = yield* openStore((store) => store.read(fixture.runId))
    expect(integratorJournalInventory(interruptedRecords)).toEqual([
      ...beforeInventory,
      { key: runStartedKey, event: runStarted }
    ])

    const recovered = yield* openStore((store) => activate(store, undefined))
    expect(recovered).toEqual({ _tag: "ActionCompleted", proposalId: proposal.id })
    const records = yield* openStore((store) => store.read(fixture.runId))
    expect(integratorJournalInventory(records)).toEqual([
      ...beforeInventory,
      { key: runStartedKey, event: runStarted },
      { key: resultRecordedKey, event: resultRecorded },
      { key: gitReadIntendedKey, event: gitReadIntended },
      { key: gitObservedKey, event: gitObserved }
    ])
    const byKey = new Map(records.map((record) => [record.key, record]))
    const startRecord = byKey.get(runStartedKey)
    const resultRecord = byKey.get(resultRecordedKey)
    const gitIntentRecord = byKey.get(gitReadIntendedKey)
    const gitObservationRecord = byKey.get(gitObservedKey)
    expect(startRecord?.event).toEqual(runStarted)
    expect(resultRecord?.event).toEqual(resultRecorded)
    expect(gitIntentRecord?.event).toEqual(gitReadIntended)
    expect(gitObservationRecord?.event).toEqual(gitObserved)
    expect(startRecord?.position).toBeLessThan(resultRecord?.position ?? 0)
    expect(resultRecord?.position).toBeLessThan(gitIntentRecord?.position ?? 0)
    expect(gitIntentRecord?.position).toBeLessThan(gitObservationRecord?.position ?? 0)
    expect(records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toEqual(
      beforeRecords.filter(({ event }) => event._tag === "WorkflowRunBegan")
    )
    expect(records.filter(({ event }) => event._tag === "IntegrationResponsibilityBegan")).toEqual(
      beforeRecords.filter(({ event }) => event._tag === "IntegrationResponsibilityBegan")
    )
    expect(records.filter(({ event }) => event._tag === "IntegrationStarted")).toEqual(
      beforeRecords.filter(({ event }) => event._tag === "IntegrationStarted")
    )
    const taskBeginRecords = records.filter(
      ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Begin"
    )
    expect(taskBeginRecords).toHaveLength(1)
    expect(taskBeginRecords).toEqual(
      beforeRecords.filter(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Begin"
      )
    )
    const fixedS2SessionRecords = records.filter(
      ({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed"
    )
    expect(fixedS2SessionRecords).toHaveLength(1)
    expect(fixedS2SessionRecords).toEqual(
      beforeRecords.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
    )
    expect(records.filter(({ event }) => event._tag === "RemotePublicationAttemptIntended")).toEqual(
      beforeRecords.filter(({ event }) => event._tag === "RemotePublicationAttemptIntended")
    )
    expect(successor.acceptedResult).toEqual(fixture.accepted.responsibility.acceptedResult)
    expect(successor.plannedAttempt).toEqual(fixture.accepted.responsibility.plannedAttempt)
    expect(successor.integrationTarget).toEqual(fixture.accepted.responsibility.integrationTarget)
    expect(successor.queuedAt).toBe(fixture.accepted.responsibility.queuedAt)
    expect(successor.startedAt).toBe(fixture.accepted.responsibility.startedAt)
    expect(successor.expectedTargetHead).toBe(fixture.input.targetLineage.targetHeadSha)
    expect(yield* Ref.get(providerCalls)).toEqual([run, run])
    expect(yield* Ref.get(writerStarts)).toBe(1)
    expect(yield* Ref.get(writerActive)).toBe(false)
    expect(yield* Ref.get(gitReadCalls)).toBe(1)
    expect(yield* Ref.get(resultAppendAttempts)).toBe(2)
    expect(deriveCurrentIntegratorState(records, fixture.accepted.responsibility)).toMatchObject({
      _tag: "GitQualifiedPrepared",
      candidateCommit,
      candidateText,
      observation: { directParents: [successor.expectedTargetHead, successor.acceptedResult.commit] },
      run
    })
    expect(records.filter(({ event }) => event._tag === "IntegrationQuarantined")).toEqual(
      beforeRecords.filter(({ event }) => event._tag === "IntegrationQuarantined")
    )
  }
)

const memoryStoreOpener =
  (store: JournalStore["Service"]): OpenStore =>
  <A>(use: (store: JournalStore["Service"]) => Effect.Effect<A, unknown>) =>
    use(store)

const sqliteStoreOpener =
  (filename: JournalDatabaseLocator): OpenStore =>
  <A>(use: (store: JournalStore["Service"]) => Effect.Effect<A, unknown>) =>
    Effect.scoped(
      Effect.gen(function* () {
        const store = yield* JournalStore
        return yield* use(store)
      }).pipe(Effect.provide(sqliteJournalStoreLayer({ filename })))
    )

it.effect("recovers an automatic S2 result append failure before commit across memory and reopened SQLite", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-automatic-result-precommit-" })
      const filename = JournalDatabaseLocator.make(path.join(directory, "journal.sqlite"))
      const memoryContext = yield* Layer.build(memoryJournalStoreLayer)
      yield* exerciseAutomaticSuccessorResultAppend(
        "BeforeCommit",
        memoryStoreOpener(Context.get(memoryContext, JournalStore))
      )
      yield* exerciseAutomaticSuccessorResultAppend("BeforeCommit", sqliteStoreOpener(filename))
    }).pipe(Effect.provide(Layer.merge(NodeFileSystem.layer, NodePath.layer)))
  )
)
