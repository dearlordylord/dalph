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
import { IntegrationResponsibilityIdentity } from "../../workflow/protocols/integration-admission/responsibility.js"
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
  RemotePublicationAttemptAuthorization,
  RemotePublicationAttemptIntendedEvent,
  RemotePublicationAttemptOrdinal,
  RemotePublicationIntendedEvent,
  RemotePublicationProofBasis,
  RemotePublicationSucceededEvent,
  RemotePublicationGitObservation,
  RemotePublicationRetainedCause,
  RemotePublicationRetainedEvent,
  RemotePublicationResumeRequest,
  RemotePublicationResumeRequestId,
  RemotePublicationResumeRequestedEvent,
  RemotePublicationGit,
  remotePublicationCorrelationFor,
  remotePublicationRefspecFor
} from "../../workflow/protocols/direct-publication/events.js"
import {
  ExistingSameCommitRecoveryOwner,
  RemotePublicationResumeRuntimeUnavailable,
  type ExistingSameCommitRecoveryInput
} from "../../workflow/protocols/direct-publication/resume-runtime.js"
import { type RunReactivationHint, RunReactivationOwner } from "../run/run-reactivation-owner.js"
import { RemoteBaselineGit } from "../../workflow/protocols/direct-publication/baseline-events.js"
import { InitialControlPolicy } from "../../control/policy.js"
import {
  ControlDirectionApplicationOrdinal,
  ControlDirectionAppliedEvent
} from "../../workflow/protocols/control-direction-application/events.js"
import { TaskWorkCapacity } from "../../coordination/admission/capacity.js"
import { makeWorkflowRunBeganRecord } from "../../workflow-journal/run-lifecycle.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import { WorkflowActor } from "../../workflow/registry/actor.js"
import { remotePublicationTargetForTest } from "../../../test/support/direct-publication.js"

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

const retainedResumePrefix = () => {
  const published = publishedRecordsFor()
  const prefix = published.slice(0, -1)
  const correlation = remotePublicationCorrelationFor(fixture.qualifiedCandidate, remotePublicationTargetForTest)
  const request = RemotePublicationResumeRequest.make({
    requestId: RemotePublicationResumeRequestId.make("integration-adapter-retained-resume"),
    responsibility: IntegrationResponsibilityIdentity.make({
      queuedAt: fixture.qualifiedCandidate.run.session.queuedAt,
      runId: fixture.runId
    }),
    runId: fixture.runId,
    schemaVersion: 1
  })
  const retained = RemotePublicationRetainedEvent.make({
    authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
    cause: RemotePublicationRetainedCause.cases.AuthenticationDenied.make({}),
    correlation,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  const receipt = RemotePublicationResumeRequestedEvent.make({
    correlation,
    initiatedBy: WorkflowActor.cases.Operator.make({}),
    occurrenceClassification: "InitiatedAction",
    request,
    version: workflowJournalEventVersion
  })
  const lastPosition = prefix.at(-1)?.position ?? JournalPosition.make(0)
  const tail = [retained, receipt].map((event, index) => ({
    event,
    key: describeJournalEvent(event).expectedKey,
    position: JournalPosition.make(Number(lastPosition) + index + 1),
    runId: fixture.runId
  }))
  return { records: [...prefix, ...tail], request }
}

const retainedAfterDeniedResume = () => {
  const { records, request } = retainedResumePrefix()
  const correlation = remotePublicationCorrelationFor(fixture.qualifiedCandidate, remotePublicationTargetForTest)
  const retry = RemotePublicationAttemptIntendedEvent.make({
    attemptOrdinal: RemotePublicationAttemptOrdinal.make(2),
    correlation,
    initiatedBy: { _tag: "DalphCoordinator" },
    occurrenceClassification: "InitiatedAction",
    refspec: remotePublicationRefspecFor(fixture.qualifiedCandidate.candidateCommit, correlation.target.branch),
    version: workflowJournalEventVersion
  })
  const retained = RemotePublicationRetainedEvent.make({
    authorization: RemotePublicationAttemptAuthorization.cases.ResumeRequest.make({ requestId: request.requestId }),
    cause: RemotePublicationRetainedCause.cases.AuthenticationDenied.make({}),
    correlation,
    occurrenceClassification: "NonActionOccurrence",
    version: workflowJournalEventVersion
  })
  return appendJournalEvents(records, [retry, retained])
}

const appendJournalEvents = (
  records: ReadonlyArray<JournalRecord>,
  events: ReadonlyArray<JournalRecord["event"]>
): ReadonlyArray<JournalRecord> => {
  const lastPosition = records.at(-1)?.position ?? JournalPosition.make(0)
  return [
    ...records,
    ...events.map((event, index) => ({
      event,
      key: describeJournalEvent(event).expectedKey,
      position: JournalPosition.make(Number(lastPosition) + index + 1),
      runId: fixture.runId
    }))
  ]
}

const remotePublicationTransition = () =>
  RunnableFrontierTransition.RunRemotePublication({
    candidate: fixture.qualifiedCandidate,
    responsibility,
    target: remotePublicationTargetForTest
  })

it.effect("ordinary Run replay hands the exact retained candidate to the existing same-commit owner", () =>
  Effect.gen(function* () {
    const { records: initialRecords, request } = retainedResumePrefix()
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>(initialRecords)
    const transition = remotePublicationTransition()
    const proposal = proposalFor(transition)
    expect(proposal).toBeDefined()
    if (proposal === undefined) return yield* Effect.die("missing direct-publication proposal")
    const action: IdentityFreeAction = { _tag: "IdentityFreeAction", proposal }
    const boundaryCalls = yield* Ref.make<ReadonlyArray<string>>([])
    const remoteHead = GitCommitSha.make("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
    const git = RemotePublicationGit.of({
      admit: () => Effect.die("resume does not re-admit the pinned target"),
      observe: () =>
        Ref.update(boundaryCalls, (calls) => [...calls, "observe"]).pipe(
          Effect.as(
            RemotePublicationGitObservation.cases.CompatibleCompetingHead.make({
              mergeBase: fixture.qualifiedCandidate.run.session.expectedTargetHead,
              remoteHead
            })
          )
        ),
      prepareSenderCustody: () => Ref.update(boundaryCalls, (calls) => [...calls, "prepare"]),
      reconcileSenderCustody: () => Ref.update(boundaryCalls, (calls) => [...calls, "custody"]),
      push: () =>
        Ref.update(boundaryCalls, (calls) => [...calls, "push"]).pipe(Effect.andThen(Effect.die("unexpected push")))
    })
    const handoffs = yield* Ref.make<ReadonlyArray<ExistingSameCommitRecoveryInput>>([])
    const recoveryOwner = ExistingSameCommitRecoveryOwner.of({
      recover: (input) => Ref.update(handoffs, (current) => [...current, input])
    })
    const hints = yield* Ref.make<ReadonlyArray<RunReactivationHint>>([])
    const result = yield* executeIntegrationAction(action, transition, inertLease, target).pipe(
      Effect.provideService(AcceptedJournalReader, acceptedJournal(records)),
      Effect.provideService(RemotePublicationGit, git),
      Effect.provideService(ExistingSameCommitRecoveryOwner, recoveryOwner),
      Effect.provideService(RunReactivationOwner, {
        hint: (hint) => Ref.update(hints, (current) => [...current, hint])
      }),
      Effect.provideService(InRunJournal, appendableJournal(records)),
      Effect.provideService(Journal, unusedJournal),
      Effect.provideService(RemoteBaselineGit, unusedRemoteBaselineGit)
    )
    expect(result).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
    expect(yield* Ref.get(handoffs)).toEqual([
      {
        candidate: fixture.qualifiedCandidate,
        target: remotePublicationTargetForTest,
        mergeBase: fixture.qualifiedCandidate.run.session.expectedTargetHead,
        remoteHead
      }
    ])
    expect(yield* Ref.get(hints)).toEqual([])
    expect(yield* Ref.get(boundaryCalls)).toEqual(["custody", "observe"])
    const finalRecords = yield* Ref.get(records)
    expect(finalRecords.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
    expect(finalRecords.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(0)
    expect(finalRecords.filter(({ event }) => event._tag === "RemotePublicationAttemptIntended")).toHaveLength(1)
    expect(finalRecords.filter(({ event }) => event._tag === "RemotePublicationResumeRequested")).toHaveLength(1)
    expect(finalRecords.at(-1)?.event).toMatchObject({
      _tag: "RemotePublicationRetained",
      cause: { _tag: "CompatibleCompetingHead" },
      authorization: { _tag: "ResumeRequest", requestId: request.requestId }
    })
  })
)

it.effect("fails closed on compatible competition when the existing same-commit owner is unavailable", () =>
  Effect.gen(function* () {
    const { records: initialRecords } = retainedResumePrefix()
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>(initialRecords)
    const transition = remotePublicationTransition()
    const proposal = proposalFor(transition)
    expect(proposal).toBeDefined()
    if (proposal === undefined) return yield* Effect.die("missing direct-publication proposal")
    const action: IdentityFreeAction = { _tag: "IdentityFreeAction", proposal }
    const remoteHead = GitCommitSha.make("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
    const git = RemotePublicationGit.of({
      admit: () => Effect.die("resume does not re-admit the pinned target"),
      observe: () =>
        Effect.succeed(
          RemotePublicationGitObservation.cases.CompatibleCompetingHead.make({
            mergeBase: fixture.qualifiedCandidate.run.session.expectedTargetHead,
            remoteHead
          })
        ),
      prepareSenderCustody: () => Effect.void,
      reconcileSenderCustody: () => Effect.void,
      push: () => Effect.die("compatible competition must not push")
    })
    const failure = yield* Effect.flip(
      executeIntegrationAction(action, transition, inertLease, target).pipe(
        Effect.provideService(AcceptedJournalReader, acceptedJournal(records)),
        Effect.provideService(RemotePublicationGit, git),
        Effect.provideService(InRunJournal, appendableJournal(records)),
        Effect.provideService(Journal, unusedJournal),
        Effect.provideService(RemoteBaselineGit, unusedRemoteBaselineGit)
      )
    )
    expect(failure).toBeInstanceOf(RemotePublicationResumeRuntimeUnavailable)
    expect((yield* Ref.get(records)).at(-1)?.event).toMatchObject({
      _tag: "RemotePublicationRetained",
      cause: { _tag: "CompatibleCompetingHead" }
    })
    expect(
      (yield* Ref.get(records)).filter(({ event }) => event._tag === "RemotePublicationAttemptIntended")
    ).toHaveLength(1)
  })
)

it.effect("a paused retained Run stops before custody, head observation, or publication boundaries", () =>
  Effect.gen(function* () {
    const { records: retainedRecords } = retainedResumePrefix()
    const pause = ControlDirectionAppliedEvent.make({
      direction: "Pause",
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: ControlDirectionApplicationOrdinal.make(1),
      subject: { _tag: "Run", runId: fixture.runId },
      version: workflowJournalEventVersion
    })
    const pausedRecords = appendJournalEvents(retainedRecords, [pause])
    const records = yield* Ref.make(pausedRecords)
    const calls = yield* Ref.make<ReadonlyArray<string>>([])
    const recordCall = (name: string) =>
      Ref.update(calls, (current) => [...current, name]).pipe(Effect.andThen(Effect.die(`unexpected ${name}`)))
    const git = RemotePublicationGit.of({
      admit: () => recordCall("admit"),
      observe: () => recordCall("observe"),
      prepareSenderCustody: () => recordCall("prepare"),
      reconcileSenderCustody: () => recordCall("custody"),
      push: () => recordCall("push")
    })
    const transition = remotePublicationTransition()
    const proposal = proposalFor(transition)
    expect(proposal).toBeDefined()
    if (proposal === undefined) return yield* Effect.die("missing direct-publication proposal")

    const exit = yield* Effect.exit(
      executeIntegrationAction({ _tag: "IdentityFreeAction", proposal }, transition, inertLease, target).pipe(
        Effect.provideService(AcceptedJournalReader, acceptedJournal(records)),
        Effect.provideService(RemotePublicationGit, git),
        Effect.provideService(InRunJournal, appendableJournal(records)),
        Effect.provideService(Journal, unusedJournal),
        Effect.provideService(RemoteBaselineGit, unusedRemoteBaselineGit)
      )
    )

    expect(exit._tag).toBe("Failure")
    expect(yield* Ref.get(calls)).toEqual([])
    expect(yield* Ref.get(records)).toEqual(pausedRecords)
    expect(pausedRecords.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
    expect(pausedRecords.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(0)
    expect(pausedRecords.filter(({ event }) => event._tag === "RemotePublicationAttemptIntended")).toHaveLength(1)
    expect(pausedRecords.filter(({ event }) => event._tag === "RemotePublicationResumeRequested")).toHaveLength(1)
  })
)

it.effect("ordinary publication replay preserves settled success and conclusive denial without provider work", () =>
  Effect.gen(function* () {
    const transition = remotePublicationTransition()
    const proposal = proposalFor(transition)
    expect(proposal).toBeDefined()
    if (proposal === undefined) return yield* Effect.die("missing direct-publication proposal")
    const action: IdentityFreeAction = { _tag: "IdentityFreeAction", proposal }
    const git = unusedRemotePublicationGit
    const runAction = (initial: ReadonlyArray<JournalRecord>) =>
      Effect.gen(function* () {
        const records = yield* Ref.make(initial)
        const result = yield* executeIntegrationAction(action, transition, inertLease, target).pipe(
          Effect.provideService(AcceptedJournalReader, acceptedJournal(records)),
          Effect.provideService(RemotePublicationGit, git),
          Effect.provideService(InRunJournal, appendableJournal(records)),
          Effect.provideService(Journal, unusedJournal),
          Effect.provideService(RemoteBaselineGit, unusedRemoteBaselineGit)
        )
        return { records: yield* Ref.get(records), result }
      })

    const settledBefore = publishedRecordsFor()
    const settled = yield* runAction(settledBefore)
    expect(settled.result).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
    expect(settled.records).toEqual(settledBefore)
    expect(settled.records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
    expect(settled.records.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(0)
    expect(settled.records.filter(({ event }) => event._tag === "RemotePublicationAttemptIntended")).toHaveLength(1)

    const retainedBefore = retainedAfterDeniedResume()
    const retained = yield* runAction(retainedBefore)
    expect(retained.result).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
    expect(retained.records).toEqual(retainedBefore)
    expect(retained.records.filter(({ event }) => event._tag === "RemotePublicationAttemptIntended")).toHaveLength(2)
    expect(retained.records.filter(({ event }) => event._tag === "RemotePublicationResumeRequested")).toHaveLength(1)
    expect(retained.records.at(-1)?.event).toMatchObject({
      _tag: "RemotePublicationRetained",
      cause: { _tag: "AuthenticationDenied" }
    })
  })
)

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
