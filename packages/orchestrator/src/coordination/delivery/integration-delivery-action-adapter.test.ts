import { it } from "@effect/vitest"
import { HashSet, Effect, Ref, Stream } from "effect"
import { expect } from "vitest"
import { GitCommitSha, TaskRevision } from "@dalph/contracts"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { AcceptedJournalReader } from "../../workflow-journal/accepted-reader.js"
import { acceptedJournalPrefixFromValidatedHistory } from "../../workflow-journal/accepted-prefix.js"
import { InRunJournal, type JournalRecord } from "../../workflow-journal/store.js"
import { StartedIntegrationResponsibility } from "../../workflow/protocols/integration-admission/protocol.js"
import {
  CompletionTaskBoundary,
  PostPromotionBlockerClearAuthorization,
  completionTaskRequestFor
} from "../../workflow/protocols/integration-finality/events.js"
import { integrationFinalityFixture as fixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { EvidenceStore } from "../../workflow/protocols/evidence-store.js"
import { TargetPromotionGitReadObservation } from "../../workflow/protocols/target-promotion/events.js"
import { TargetPromotionRuntime } from "../../workflow/protocols/target-promotion/runtime.js"
import { RunnableFrontierTransition, type RunnableFrontierTransition as Transition } from "../frontier/frontier.js"
import type { DeliveryActionExecutionLease, MaterializedDeliveryAction } from "./delivery-action-executor.js"
import type { DeliveryActionProposal, IdentityFreeDeliveryProposal } from "./delivery-action-proposal.js"
import { deliveryProposalsOf } from "./delivery-proposal.js"
import { executeIntegrationAction } from "./integration-delivery-action-adapter.js"
import { Journal } from "./journal.js"
import {
  RemotePublicationAttemptIntendedEvent,
  RemotePublicationAttemptOrdinal,
  RemotePublicationIntendedEvent,
  RemotePublicationProofBasis,
  RemotePublicationRetainedCause,
  RemotePublicationRetainedEvent,
  RemotePublicationSucceededEvent,
  RemotePublicationGit,
  remotePublicationCorrelationFor,
  remotePublicationRefspecFor
} from "../../workflow/protocols/direct-publication/events.js"
import { InitialControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../../coordination/admission/capacity.js"
import { makeWorkflowRunBeganRecord } from "../../workflow-journal/run-lifecycle.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import { remotePublicationTargetForTest } from "../../../test/support/direct-publication.js"
import {
  automaticCompetingHeadRemoteBaselineCorrelationFor,
  LocalTargetCatchUpResult,
  RemoteBaselineGit,
  RemoteBaselineObservation,
  RemoteBaselineRound
} from "../../workflow/protocols/direct-publication/baseline-events.js"
import { integratorCompetingHeadSuccessorAuthorizationIdFor } from "../../workflow/protocols/integrator/automatic-successor-events.js"
import { IntegratorSessionFixedEvent } from "../../workflow/protocols/integrator/events.js"
import { integratorResponsibilityFactsFor } from "../../workflow/protocols/integrator/state.js"

const target = FixtureTarget.make("integration-adapter-finality-target")
const responsibility = StartedIntegrationResponsibility.make({
  acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
  integrationTarget: fixture.integrationTarget,
  plannedAttempt: fixture.plannedAttempt,
  queuedAt: fixture.qualifiedCandidate.run.session.queuedAt,
  startedAt: fixture.qualifiedCandidate.run.session.startedAt
})

const isIdentityFreeProposal = (proposal: DeliveryActionProposal): proposal is IdentityFreeDeliveryProposal =>
  proposal.actionIdentity._tag === "NoWorkflowOperationIdentity"

const proposalFor = (transition: Transition): IdentityFreeDeliveryProposal | undefined => {
  const proposals = deliveryProposalsOf({
    acceptedOperationIds: HashSet.empty(),
    fresh: [],
    integrationResponsibilities: [responsibility],
    responsibilities: [],
    runId: fixture.runId,
    transitions: [transition]
  })
  const proposal = [...proposals.ticketDelivery, ...proposals.deliverySettlement][0]
  return proposal !== undefined && isIdentityFreeProposal(proposal) ? proposal : undefined
}

type IdentityFreeAction = Extract<MaterializedDeliveryAction, { readonly _tag: "IdentityFreeAction" }>
type ConditionalJournalAppendResult = Effect.Success<ReturnType<Journal["Service"]["appendIfAcceptedPrefixCurrent"]>>

const appendableJournal = (records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  InRunJournal.of({
    append: (runId, key, event) =>
      Ref.modify(records, (current): [Effect.Effect<JournalRecord>, ReadonlyArray<JournalRecord>] => {
        const existing = current.find((record) => record.key === key)
        if (existing !== undefined) return [Effect.succeed(existing), current]
        const appended: JournalRecord = { event, key, position: JournalPosition.make(current.length + 1), runId }
        return [Effect.succeed(appended), [...current, appended]]
      }).pipe(Effect.flatten),
    read: () => Ref.get(records)
  })

const acceptedJournal = (records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  AcceptedJournalReader.of({
    readAccepted: (runId) =>
      Ref.get(records).pipe(Effect.map((current) => acceptedJournalPrefixFromValidatedHistory(runId, current)))
  })

const inertLease: DeliveryActionExecutionLease = {
  acceptIntegrationTargetOwnership: Effect.void,
  bindPlannedAttemptPosition: () => Effect.void,
  forwardBoundary: { _tag: "AtomicBoundary", execution: { run: (effect) => effect } },
  integrationTargets: {
    acquire: () => Effect.void,
    changes: Stream.empty,
    isActive: () => Effect.succeed(false),
    isHeld: () => Effect.succeed(false),
    publishAcceptedOwnership: () => Effect.void,
    release: () => Effect.void,
    releaseAll: Effect.void,
    snapshot: Effect.succeed({ activeResponsibilities: [], heldResponsibilities: [] }),
    withPermit: (_responsibility, effect) => effect
  },
  recordIntent: () => Effect.void,
  releasePlannedAttemptPosition: () => Effect.void,
  withPlannedAttemptProtocol: () => Effect.die("integration finality adapter never uses the attempt protocol")
}

const promotionRuntime = TargetPromotionRuntime.of({
  git: {
    compareAndSet: () => Effect.die("blocker continuation and completion authorization never mutate Git"),
    read: () =>
      Effect.succeed(
        TargetPromotionGitReadObservation.cases.CandidateCurrent.make({
          currentHeadSha: fixture.qualifiedCandidate.candidateCommit
        })
      )
  }
})

const unexpectedJournalCall = <A>(operation: string): Effect.Effect<A> =>
  Effect.die(`unexpected Journal.${operation} call`)

const unusedJournal = Journal.of({
  append: () => unexpectedJournalCall("append"),
  appendIfAcceptedPrefixCurrent: () => unexpectedJournalCall("appendIfAcceptedPrefixCurrent"),
  read: () => unexpectedJournalCall("read"),
  readAccepted: () => unexpectedJournalCall("readAccepted"),
  state: {
    attach: unexpectedJournalCall("state.attach"),
    changes: Stream.fromEffect(unexpectedJournalCall("state.changes")),
    get: unexpectedJournalCall("state.get")
  },
  terminate: () => unexpectedJournalCall("terminate")
})

const unusedRemotePublicationGit = RemotePublicationGit.of({
  admit: () => Effect.die("remote publication is outside this adapter test"),
  observe: () => Effect.die("remote publication is outside this adapter test"),
  prepareSenderCustody: () => Effect.die("remote publication is outside this adapter test"),
  push: () => Effect.die("remote publication is outside this adapter test"),
  reconcileSenderCustody: () => Effect.die("remote publication is outside this adapter test")
})
const unusedRemoteBaselineGit = RemoteBaselineGit.of({
  catchUp: () => Effect.die("remote baseline is outside this adapter test"),
  observe: () => Effect.die("remote baseline is outside this adapter test"),
  reconcileCatchUp: () => Effect.die("remote baseline is outside this adapter test")
})

const provideRemoteGit = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provideService(RemotePublicationGit, unusedRemotePublicationGit),
    Effect.provideService(RemoteBaselineGit, unusedRemoteBaselineGit)
  )

const publishedRecordsFor = (): ReadonlyArray<JournalRecord> => {
  const began = makeWorkflowRunBeganRecord(
    fixture.runId,
    target,
    InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
    remotePublicationTargetForTest
  )
  const correlation = remotePublicationCorrelationFor(fixture.qualifiedCandidate, remotePublicationTargetForTest)
  const attemptOrdinal = RemotePublicationAttemptOrdinal.make(1)
  const events = [
    RemotePublicationIntendedEvent.make({
      correlation,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    }),
    RemotePublicationAttemptIntendedEvent.make({
      attemptOrdinal,
      correlation,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      refspec: remotePublicationRefspecFor(fixture.qualifiedCandidate.candidateCommit, correlation.target.branch),
      version: workflowJournalEventVersion
    }),
    RemotePublicationSucceededEvent.make({
      correlation,
      occurrenceClassification: "NonActionOccurrence",
      proof: RemotePublicationProofBasis.cases.PushApplied.make({
        attemptOrdinal,
        remoteHead: fixture.qualifiedCandidate.candidateCommit
      }),
      version: workflowJournalEventVersion
    })
  ] as const
  return [
    began,
    ...events.map((event, offset) => ({
      event,
      key: describeJournalEvent(event).expectedKey,
      position: JournalPosition.make(Number(began.position) + offset + 1),
      runId: fixture.runId
    }))
  ]
}

it.effect("defers blocker-clear ancestry without runtime and completes after the configured Git read", () =>
  Effect.gen(function* () {
    const authorization = PostPromotionBlockerClearAuthorization.make({
      blockerClearedAt: JournalPosition.make(12),
      blockerObservedAt: JournalPosition.make(11),
      claim: fixture.claim
    })
    const transition = RunnableFrontierTransition.ObservePromotedCandidateAncestryAfterBlockerClear({
      authorization,
      responsibility
    })
    const proposal = proposalFor(transition)
    expect(proposal).toBeDefined()
    if (proposal === undefined) return yield* Effect.die("missing blocker-continuation proposal")
    const action: IdentityFreeAction = { _tag: "IdentityFreeAction", proposal }
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
    const journal = appendableJournal(records)

    expect(
      yield* provideRemoteGit(executeIntegrationAction(action, transition, inertLease, target)).pipe(
        Effect.provideService(AcceptedJournalReader, acceptedJournal(records)),
        Effect.provideService(Journal, unusedJournal),
        Effect.provideService(InRunJournal, journal)
      )
    ).toMatchObject({ _tag: "ActionDeferred", proposalId: proposal.id, reason: "CompletionTaskUnavailable" })
    expect(yield* Ref.get(records)).toEqual([])

    expect(
      yield* provideRemoteGit(executeIntegrationAction(action, transition, inertLease, target)).pipe(
        Effect.provideService(AcceptedJournalReader, acceptedJournal(records)),
        Effect.provideService(Journal, unusedJournal),
        Effect.provideService(TargetPromotionRuntime, promotionRuntime),
        Effect.provideService(InRunJournal, journal)
      )
    ).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
    expect((yield* Ref.get(records)).map(({ event }) => event._tag)).toEqual([
      "PostPromotionBlockerCandidateAncestryReadIntended",
      "PostPromotionBlockerCandidateAncestryObserved"
    ])
  })
)

it.effect("translates a changed focused revision into a deferred completion action without tracker mutation", () =>
  Effect.gen(function* () {
    const request = completionTaskRequestFor(fixture.claim)
    const transition = RunnableFrontierTransition.CompletePromotedTask({ request, responsibility })
    const proposal = proposalFor(transition)
    expect(proposal).toBeDefined()
    if (proposal === undefined) return yield* Effect.die("missing completion-task proposal")
    const action: IdentityFreeAction = { _tag: "IdentityFreeAction", proposal }
    const completionCalls = yield* Ref.make(0)
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>(publishedRecordsFor())
    const boundary = CompletionTaskBoundary.of({
      completeTask: () =>
        Ref.update(completionCalls, (count) => count + 1).pipe(
          Effect.as({ operationId: request.operationId, taskId: request.taskId })
        ),
      readCompletionRequest: () => Effect.die("changed revision must stop before request lookup"),
      readFocusedTaskCompletion: ({ operationId }) =>
        Effect.succeed({
          ...fixture.focusedSuccessFactsEvent.observation.facts,
          currentClaim: request.claim,
          lifecycle: "CompletedSuccessfully",
          operationId,
          target,
          taskRevision: TaskRevision.make("integration-adapter-changed-revision")
        })
    })
    const evidenceStore = EvidenceStore.of({
      put: () => Effect.die("changed revision never publishes evidence"),
      read: () => Effect.die("changed revision stops before reading evidence")
    })

    const result = yield* provideRemoteGit(executeIntegrationAction(action, transition, inertLease, target)).pipe(
      Effect.provideService(AcceptedJournalReader, acceptedJournal(records)),
      Effect.provideService(Journal, unusedJournal),
      Effect.provideService(CompletionTaskBoundary, boundary),
      Effect.provideService(TargetPromotionRuntime, promotionRuntime),
      Effect.provideService(EvidenceStore, evidenceStore),
      Effect.provideService(InRunJournal, appendableJournal(records))
    )
    expect(result).toMatchObject({
      _tag: "ActionDeferred",
      proposalId: proposal.id,
      reason: {
        _tag: "IntegrationFinality.CompletionTaskAuthorizationConflict",
        reason: "TaskIdentityOrRevisionChanged"
      }
    })
    expect(yield* Ref.get(completionCalls)).toBe(0)
    expect((yield* Ref.get(records)).map(({ event }) => event._tag)).not.toContain("CompletionTaskAttemptIntended")
  })
)

it.effect(
  "appends automatic successor authorization before baseline and catch-up CAS and defers stale-prefix authorization without Git",
  () =>
    Effect.gen(function* () {
      const correlation = remotePublicationCorrelationFor(fixture.qualifiedCandidate, remotePublicationTargetForTest)
      const retainedAt = JournalPosition.make(3)
      const mergeBase = GitCommitSha.make("1111111111111111111111111111111111111111")
      const remoteHead = GitCommitSha.make("2222222222222222222222222222222222222222")
      const sessionFixed = IntegratorSessionFixedEvent.make({
        correlation: fixture.qualifiedCandidate.run.session,
        version: workflowJournalEventVersion
      })
      const retained = RemotePublicationRetainedEvent.make({
        cause: RemotePublicationRetainedCause.cases.CompatibleCompetingHead.make({ mergeBase, remoteHead }),
        correlation,
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      })
      const initialRecords: ReadonlyArray<JournalRecord> = [
        makeWorkflowRunBeganRecord(
          fixture.runId,
          target,
          InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
          remotePublicationTargetForTest
        ),
        {
          event: sessionFixed,
          key: describeJournalEvent(sessionFixed).expectedKey,
          position: JournalPosition.make(2),
          runId: fixture.runId
        },
        { event: retained, key: describeJournalEvent(retained).expectedKey, position: retainedAt, runId: fixture.runId }
      ]
      const authorization = RunnableFrontierTransition.AuthorizeIntegratorCompetingHeadSuccessor({
        authorizationId: integratorCompetingHeadSuccessorAuthorizationIdFor(
          correlation.requestId,
          retainedAt,
          mergeBase,
          remoteHead
        ),
        correlation,
        mergeBase,
        remoteHead,
        remotePublicationRetainedAt: retainedAt,
        responsibility
      })
      const authorizationProposal = proposalFor(authorization)
      expect(authorizationProposal).toBeDefined()
      if (authorizationProposal === undefined) return yield* Effect.die("missing authorization proposal")
      const authorizationAction: IdentityFreeAction = { _tag: "IdentityFreeAction", proposal: authorizationProposal }

      const records = yield* Ref.make(initialRecords)
      const trace = yield* Ref.make<ReadonlyArray<string>>([])
      const instrumentedJournal = (stalePrefix: boolean, journalRecords = records) =>
        Journal.of({
          ...unusedJournal,
          appendIfAcceptedPrefixCurrent: (runId, expectedPosition, key, event) =>
            Ref.modify(
              journalRecords,
              (current): [Effect.Effect<ConditionalJournalAppendResult>, ReadonlyArray<JournalRecord>] => {
                const last = current.at(-1)?.position ?? null
                if (stalePrefix || last !== expectedPosition) {
                  const advanced = JournalPosition.make((last === null ? 0 : Number(last)) + 1)
                  return [
                    Effect.succeed<ConditionalJournalAppendResult>({
                      _tag: "PrefixAdvanced",
                      currentPosition: advanced,
                      expectedPosition
                    }),
                    current
                  ]
                }
                const record: JournalRecord = { event, key, position: JournalPosition.make(Number(last) + 1), runId }
                return [
                  Effect.succeed<ConditionalJournalAppendResult>({ _tag: "Appended", record }),
                  [...current, record]
                ]
              }
            ).pipe(
              Effect.flatten,
              Effect.tap((result: ConditionalJournalAppendResult) =>
                result._tag === "Appended"
                  ? Ref.update(trace, (items) => [...items, "authorization-append"])
                  : Effect.void
              )
            ),
          readAccepted: (runId) =>
            Ref.get(journalRecords).pipe(
              Effect.map((current) => acceptedJournalPrefixFromValidatedHistory(runId, current))
            )
        })

      const missingRetainedRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>(
        initialRecords.filter(({ event }) => event._tag !== "RemotePublicationRetained")
      )
      const missingRetainedResult = yield* executeIntegrationAction(
        authorizationAction,
        authorization,
        inertLease,
        target
      ).pipe(
        Effect.provideService(Journal, instrumentedJournal(false, missingRetainedRecords)),
        Effect.provideService(InRunJournal, appendableJournal(missingRetainedRecords)),
        Effect.provideService(AcceptedJournalReader, acceptedJournal(missingRetainedRecords)),
        Effect.provideService(RemoteBaselineGit, unusedRemoteBaselineGit),
        Effect.provideService(RemotePublicationGit, unusedRemotePublicationGit)
      )
      expect(missingRetainedResult).toMatchObject({
        _tag: "ActionDeferred",
        proposalId: authorizationProposal.id,
        reason: "ContinuationAuthorizationStale"
      })

      const baseInRunJournal = appendableJournal(records)
      const loggedInRunJournal = InRunJournal.of({
        append: (runId, key, event) =>
          Ref.update(trace, (items) => [...items, "baseline-journal-append"]).pipe(
            Effect.andThen(baseInRunJournal.append(runId, key, event))
          ),
        read: baseInRunJournal.read
      })
      const remoteHeadSha = remoteHead
      const baselineGit = RemoteBaselineGit.of({
        catchUp: (correlation, expectedLocalHead, observedRemoteHead) =>
          Ref.update(trace, (items) => [...items, "git-baseline-catch-up"]).pipe(
            Effect.andThen(
              Effect.sync(() => {
                expect(correlation).toEqual(baselineCorrelation)
                expect(expectedLocalHead).toBe(fixture.qualifiedCandidate.run.session.expectedTargetHead)
                expect(observedRemoteHead).toBe(remoteHeadSha)
              })
            ),
            Effect.as(LocalTargetCatchUpResult.cases.Applied.make({ newHead: remoteHeadSha }))
          ),
        observe: () =>
          Ref.update(trace, (items) => [...items, "git-baseline-observe"]).pipe(
            Effect.as(
              RemoteBaselineObservation.cases.LocalAncestor.make({
                localHead: fixture.qualifiedCandidate.run.session.expectedTargetHead,
                remoteHead: remoteHeadSha
              })
            )
          ),
        reconcileCatchUp: () => Effect.die("aligned authorization baseline does not reconcile catch up")
      })

      const authorizationResult = yield* executeIntegrationAction(
        authorizationAction,
        authorization,
        inertLease,
        target
      ).pipe(
        Effect.provideService(Journal, instrumentedJournal(false)),
        Effect.provideService(InRunJournal, loggedInRunJournal),
        Effect.provideService(AcceptedJournalReader, acceptedJournal(records)),
        Effect.provideService(RemoteBaselineGit, baselineGit),
        Effect.provideService(RemotePublicationGit, unusedRemotePublicationGit)
      )
      expect(authorizationResult).toMatchObject({ _tag: "ActionCompleted", proposalId: authorizationProposal.id })
      const authorizationRecord = (yield* Ref.get(records)).find(
        ({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized"
      )
      expect(authorizationRecord?.position).toBe(JournalPosition.make(4))
      const replayedAuthorization = yield* executeIntegrationAction(
        authorizationAction,
        authorization,
        inertLease,
        target
      ).pipe(
        Effect.provideService(Journal, instrumentedJournal(false)),
        Effect.provideService(InRunJournal, loggedInRunJournal),
        Effect.provideService(AcceptedJournalReader, acceptedJournal(records)),
        Effect.provideService(RemoteBaselineGit, unusedRemoteBaselineGit),
        Effect.provideService(RemotePublicationGit, unusedRemotePublicationGit)
      )
      expect(replayedAuthorization).toMatchObject({ _tag: "ActionCompleted", proposalId: authorizationProposal.id })

      const baselineCorrelation = automaticCompetingHeadRemoteBaselineCorrelationFor(
        fixture.runId,
        integratorResponsibilityFactsFor(responsibility),
        responsibility.integrationTarget,
        remotePublicationTargetForTest,
        JournalPosition.make(4),
        RemoteBaselineRound.make(1)
      )
      const baseline = RunnableFrontierTransition.EstablishRemoteBaseline({
        correlation: baselineCorrelation,
        responsibility
      })
      const interruptibleLease: DeliveryActionExecutionLease = {
        ...inertLease,
        forwardBoundary: {
          _tag: "InterruptibleBoundary",
          execution: { run: (_intent, call, recordResult) => Effect.flatMap(call, recordResult) }
        }
      }
      const baselineProposal = proposalFor(baseline)
      expect(baselineProposal).toBeDefined()
      if (baselineProposal === undefined) return yield* Effect.die("missing authorization-baseline proposal")
      const baselineResult = yield* executeIntegrationAction(
        { _tag: "IdentityFreeAction", proposal: baselineProposal },
        baseline,
        interruptibleLease,
        target
      ).pipe(
        Effect.provideService(Journal, instrumentedJournal(false)),
        Effect.provideService(InRunJournal, loggedInRunJournal),
        Effect.provideService(AcceptedJournalReader, acceptedJournal(records)),
        Effect.provideService(RemoteBaselineGit, baselineGit),
        Effect.provideService(RemotePublicationGit, unusedRemotePublicationGit)
      )
      expect(baselineResult).toMatchObject({
        _tag: "ActionDeferred",
        proposalId: baselineProposal.id,
        reason: "RemoteBaselineReconciliationPending"
      })
      const observedRecords = yield* Ref.get(records)
      expect(observedRecords.map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "IntegratorSessionFixed",
        "RemotePublicationRetained",
        "IntegratorCompetingHeadSuccessorAuthorized",
        "RemoteBaselineReadIntended",
        "RemoteBaselineObserved"
      ])
      const catchUpTransition = RunnableFrontierTransition.EstablishRemoteBaseline({
        correlation: baselineCorrelation,
        responsibility
      })
      const catchUpResult = yield* executeIntegrationAction(
        { _tag: "IdentityFreeAction", proposal: baselineProposal },
        catchUpTransition,
        interruptibleLease,
        target
      ).pipe(
        Effect.provideService(Journal, instrumentedJournal(false)),
        Effect.provideService(InRunJournal, loggedInRunJournal),
        Effect.provideService(AcceptedJournalReader, acceptedJournal(records)),
        Effect.provideService(RemoteBaselineGit, baselineGit),
        Effect.provideService(RemotePublicationGit, unusedRemotePublicationGit)
      )
      expect(catchUpResult).toMatchObject({ _tag: "ActionCompleted", proposalId: baselineProposal.id })
      const caughtUpRecords = yield* Ref.get(records)
      expect(caughtUpRecords.map(({ event }) => event._tag)).toEqual([
        "WorkflowRunBegan",
        "IntegratorSessionFixed",
        "RemotePublicationRetained",
        "IntegratorCompetingHeadSuccessorAuthorized",
        "RemoteBaselineReadIntended",
        "RemoteBaselineObserved",
        "LocalTargetCatchUpIntended",
        "LocalTargetCatchUpObserved"
      ])
      const traceAfterCatchUp = yield* Ref.get(trace)
      expect(traceAfterCatchUp).toEqual([
        "authorization-append",
        "baseline-journal-append",
        "git-baseline-observe",
        "baseline-journal-append",
        "baseline-journal-append",
        "git-baseline-catch-up",
        "baseline-journal-append"
      ])
      const [authorizedRecord, readIntent, observed, catchUpIntent, catchUpObserved] = [
        caughtUpRecords.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized"),
        caughtUpRecords.find(({ event }) => event._tag === "RemoteBaselineReadIntended"),
        caughtUpRecords.find(({ event }) => event._tag === "RemoteBaselineObserved"),
        caughtUpRecords.find(({ event }) => event._tag === "LocalTargetCatchUpIntended"),
        caughtUpRecords.find(({ event }) => event._tag === "LocalTargetCatchUpObserved")
      ]
      expect(authorizedRecord?.position).toBeLessThan(readIntent?.position ?? 0)
      expect(readIntent?.position).toBeLessThan(observed?.position ?? 0)
      expect(observed?.position).toBeLessThan(catchUpIntent?.position ?? 0)
      expect(catchUpIntent?.position).toBeLessThan(catchUpObserved?.position ?? 0)

      const staleRecords = yield* Ref.make(initialRecords)
      const staleGitCalls = yield* Ref.make(0)
      const staleBaselineGit = RemoteBaselineGit.of({
        catchUp: () => Effect.die("stale authorization must not catch up"),
        observe: () =>
          Ref.update(staleGitCalls, (count) => count + 1).pipe(
            Effect.as(RemoteBaselineObservation.cases.Aligned.make({ localHead: remoteHead, remoteHead }))
          ),
        reconcileCatchUp: () => Effect.die("stale authorization must not reconcile catch up")
      })
      const staleTrace = yield* Ref.make<ReadonlyArray<string>>([])
      const staleJournal = Journal.of({
        ...unusedJournal,
        appendIfAcceptedPrefixCurrent: (_runId, expectedPosition) =>
          Ref.update(staleTrace, (items) => [...items, "stale-prefix"]).pipe(
            Effect.as({
              _tag: "PrefixAdvanced" as const,
              currentPosition: JournalPosition.make(Number(expectedPosition) + 1),
              expectedPosition
            })
          ),
        readAccepted: (runId) =>
          Ref.get(staleRecords).pipe(Effect.map((current) => acceptedJournalPrefixFromValidatedHistory(runId, current)))
      })
      const staleResult = yield* executeIntegrationAction(authorizationAction, authorization, inertLease, target).pipe(
        Effect.provideService(Journal, staleJournal),
        Effect.provideService(InRunJournal, appendableJournal(staleRecords)),
        Effect.provideService(AcceptedJournalReader, acceptedJournal(staleRecords)),
        Effect.provideService(RemoteBaselineGit, staleBaselineGit),
        Effect.provideService(RemotePublicationGit, unusedRemotePublicationGit)
      )
      expect(staleResult).toMatchObject({
        _tag: "ActionDeferred",
        proposalId: authorizationProposal.id,
        reason: "ContinuationAuthorizationStale"
      })
      expect(yield* Ref.get(staleGitCalls)).toBe(0)
      expect(yield* Ref.get(staleTrace)).toEqual(["stale-prefix"])
    })
)
