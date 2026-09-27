import { it } from "@effect/vitest"
import { HashSet, Effect, Layer, Ref, Stream } from "effect"
import { expect } from "vitest"
import { GitCommitSha, RunId, TaskRevision } from "@dalph/contracts"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { AcceptedJournalReader } from "../../workflow-journal/accepted-reader.js"
import { acceptedJournalPrefixFromValidatedHistory } from "../../workflow-journal/accepted-prefix.js"
import {
  InRunJournal,
  InRunJournalRunMismatch,
  JournalHistoryInvalid,
  type JournalRecord
} from "../../workflow-journal/store.js"
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
  RemotePublicationRetainedCause,
  RemotePublicationRetainedEvent,
  RemotePublicationSucceededEvent,
  RemotePublicationGitObservation,
  RemotePublicationResumeRequest,
  RemotePublicationResumeRequestId,
  RemotePublicationResumeRequestedEvent,
  RemotePublicationGit,
  remotePublicationCorrelationFor,
  remotePublicationRefspecFor
} from "../../workflow/protocols/direct-publication/events.js"
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
import {
  automaticCompetingHeadRemoteBaselineCorrelationFor,
  LocalTargetCatchUpIntendedEvent,
  LocalTargetCatchUpObservedEvent,
  LocalTargetCatchUpResult,
  RemoteBaselineGit,
  RemoteBaselineObservation,
  RemoteBaselineObservedEvent,
  RemoteBaselineReadIntendedEvent,
  RemoteBaselineRound
} from "../../workflow/protocols/direct-publication/baseline-events.js"
import {
  integratorCompetingHeadSuccessorAuthorizationIdFor,
  IntegratorCompetingHeadSuccessorAuthorizedEvent
} from "../../workflow/protocols/integrator/automatic-successor-events.js"
import {
  IntegratorAutomaticSuccessorSessionFixedEvent,
  IntegratorCandidateResourceLocator,
  IntegratorSessionFixedEvent,
  IntegratorSessionId
} from "../../workflow/protocols/integrator/events.js"
import { integratorResponsibilityFactsFor } from "../../workflow/protocols/integrator/state.js"
import { IntegratorJournalContradiction } from "../../workflow/protocols/integrator/journal-errors.js"
import { makeSuccessorPrefix } from "../../../test/support/automatic-successor-history.js"
import { TargetLineageObservation } from "../../authorities/git/target-lineage.js"
import { OperationId } from "../../workflow/identity.js"
import { GitReadIntentRecordedEvent, TargetLineageObservedEvent } from "../../workflow/registry/event.js"
import { makeTargetLineageObservationOperation } from "../../workflow/registry/operation.js"

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

const appendableJournal = (
  records: Ref.Ref<ReadonlyArray<JournalRecord>>,
  crashAfterCompatibleRetainedAppend = false
) =>
  InRunJournal.of({
    append: (runId, key, event) =>
      Ref.modify(records, (current): [Effect.Effect<JournalRecord>, ReadonlyArray<JournalRecord>] => {
        const existing = current.find((record) => record.key === key)
        if (existing !== undefined) return [Effect.succeed(existing), current]
        const appended: JournalRecord = { event, key, position: JournalPosition.make(current.length + 1), runId }
        return [Effect.succeed(appended), [...current, appended]]
      }).pipe(
        Effect.flatten,
        Effect.flatMap((record) =>
          crashAfterCompatibleRetainedAppend &&
          event._tag === "RemotePublicationRetained" &&
          event.cause._tag === "CompatibleCompetingHead" &&
          event.authorization._tag === "ResumeRequest"
            ? Effect.die("process lost after compatible-head retained outcome committed")
            : Effect.succeed(record)
        )
      ),
    read: () => Ref.get(records)
  })

const acceptedJournal = (records: Ref.Ref<ReadonlyArray<JournalRecord>>) =>
  AcceptedJournalReader.of({
    readAccepted: (runId) =>
      Ref.get(records).pipe(Effect.map((current) => acceptedJournalPrefixFromValidatedHistory(runId, current)))
  })

const publicationAdapterLayer = (
  records: Ref.Ref<ReadonlyArray<JournalRecord>>,
  git: ReturnType<typeof RemotePublicationGit.of>,
  journal = appendableJournal(records),
  reader = acceptedJournal(records)
) =>
  Layer.merge(
    Layer.merge(
      Layer.merge(Layer.succeed(AcceptedJournalReader, reader), Layer.succeed(RemotePublicationGit, git)),
      Layer.succeed(InRunJournal, journal)
    ),
    Layer.merge(Layer.succeed(Journal, unusedJournal), Layer.succeed(RemoteBaselineGit, unusedRemoteBaselineGit))
  )

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

it.effect("preserves a typed accepted-journal read failure before retained-resume selection", () =>
  Effect.gen(function* () {
    const { records: initialRecords } = retainedResumePrefix()
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>(initialRecords)
    const transition = remotePublicationTransition()
    const proposal = proposalFor(transition)
    expect(proposal).toBeDefined()
    if (proposal === undefined) return yield* Effect.die("missing direct-publication proposal")
    const failure = new JournalHistoryInvalid({
      detail: "accepted prefix validation failed",
      position: JournalPosition.make(initialRecords.length),
      runId: fixture.runId
    })
    const reader = AcceptedJournalReader.of({ readAccepted: () => Effect.fail(failure) })

    const observed = yield* Effect.flip(
      executeIntegrationAction({ _tag: "IdentityFreeAction", proposal }, transition, inertLease, target).pipe(
        Effect.provide(publicationAdapterLayer(records, unusedRemotePublicationGit, undefined, reader))
      )
    )

    expect(observed).toEqual(failure)
    expect(yield* Ref.get(records)).toEqual(initialRecords)
  })
)

it.effect("preserves a typed accepted-journal read failure at the publication boundary", () =>
  Effect.gen(function* () {
    const { records: initialRecords } = retainedResumePrefix()
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>(initialRecords)
    const readCount = yield* Ref.make(0)
    const transition = remotePublicationTransition()
    const proposal = proposalFor(transition)
    expect(proposal).toBeDefined()
    if (proposal === undefined) return yield* Effect.die("missing direct-publication proposal")
    const failure = new InRunJournalRunMismatch({
      expectedRunId: RunId.make("another-run"),
      requestedRunId: fixture.runId
    })
    const reader = AcceptedJournalReader.of({
      readAccepted: (runId) =>
        Ref.modify(readCount, (count) => [count, count + 1] as const).pipe(
          Effect.flatMap((count) =>
            count < 3
              ? Ref.get(records).pipe(
                  Effect.map((current) => acceptedJournalPrefixFromValidatedHistory(runId, current))
                )
              : Effect.fail(failure)
          )
        )
    })

    const observed = yield* Effect.flip(
      executeIntegrationAction({ _tag: "IdentityFreeAction", proposal }, transition, inertLease, target).pipe(
        Effect.provide(publicationAdapterLayer(records, unusedRemotePublicationGit, undefined, reader))
      )
    )

    expect(observed).toEqual(failure)
    expect(yield* Ref.get(readCount)).toBe(4)
    expect(yield* Ref.get(records)).toEqual(initialRecords)
  })
)

it.effect("ordinary Run replay leaves the exact compatible head for the normal frontier selector", () =>
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
    const result = yield* executeIntegrationAction(action, transition, inertLease, target).pipe(
      Effect.provide(publicationAdapterLayer(records, git))
    )
    expect(result).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
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

it.effect("replays the retained compatible head through the ordinary Run selector after restart", () =>
  Effect.gen(function* () {
    const { records: initialRecords, request } = retainedResumePrefix()
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>(initialRecords)
    const transition = remotePublicationTransition()
    const proposal = proposalFor(transition)
    expect(proposal).toBeDefined()
    if (proposal === undefined) return yield* Effect.die("missing direct-publication proposal")
    const action: IdentityFreeAction = { _tag: "IdentityFreeAction", proposal }
    const remoteHead = GitCommitSha.make("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
    const boundaryCalls = yield* Ref.make<ReadonlyArray<string>>([])
    const firstGit = RemotePublicationGit.of({
      admit: () => Effect.die("resume does not re-admit the pinned target"),
      observe: () =>
        Ref.update(boundaryCalls, (current) => [...current, "observe"]).pipe(
          Effect.as(
            RemotePublicationGitObservation.cases.CompatibleCompetingHead.make({
              mergeBase: fixture.qualifiedCandidate.run.session.expectedTargetHead,
              remoteHead
            })
          )
        ),
      prepareSenderCustody: () => Effect.die("compatible head does not prepare a sender"),
      reconcileSenderCustody: () => Ref.update(boundaryCalls, (current) => [...current, "custody"]),
      push: () => Effect.die("compatible head does not push")
    })
    const interrupted = yield* Effect.exit(
      executeIntegrationAction(action, transition, inertLease, target).pipe(
        Effect.provide(publicationAdapterLayer(records, firstGit, appendableJournal(records, true)))
      )
    )
    expect(interrupted._tag).toBe("Failure")
    expect(yield* Ref.get(boundaryCalls)).toEqual(["custody", "observe"])
    const afterCrash = yield* Ref.get(records)
    expect(afterCrash.at(-1)?.event).toMatchObject({
      _tag: "RemotePublicationRetained",
      cause: {
        _tag: "CompatibleCompetingHead",
        mergeBase: fixture.qualifiedCandidate.run.session.expectedTargetHead,
        remoteHead
      },
      authorization: { _tag: "ResumeRequest", requestId: request.requestId }
    })

    const replayGit = RemotePublicationGit.of({
      admit: () => Effect.die("replay uses the retained handoff"),
      observe: () => Effect.die("replay uses the retained handoff"),
      prepareSenderCustody: () => Effect.die("replay uses the retained handoff"),
      reconcileSenderCustody: () => Effect.die("replay uses the retained handoff"),
      push: () => Effect.die("replay uses the retained handoff")
    })
    const replayed = yield* executeIntegrationAction(action, transition, inertLease, target).pipe(
      Effect.provide(publicationAdapterLayer(records, replayGit))
    )
    expect(replayed).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
    expect(yield* Ref.get(boundaryCalls)).toEqual(["custody", "observe"])
    const finalRecords = yield* Ref.get(records)
    expect(finalRecords.filter(({ event }) => event._tag === "RemotePublicationResumeRequested")).toHaveLength(1)
    expect(finalRecords.filter(({ event }) => event._tag === "RemotePublicationAttemptIntended")).toHaveLength(1)
    expect(finalRecords.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
    expect(finalRecords.filter(({ event }) => event._tag === "IntegratorRunStarted")).toHaveLength(0)
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
        Effect.provide(publicationAdapterLayer(records, git))
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
          Effect.provide(publicationAdapterLayer(records, git))
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
        authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
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

it.effect("rejects a foreign S2 authorization record returned by conditional append", () =>
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
      authorization: RemotePublicationAttemptAuthorization.cases.InitialAttempt.make({}),
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
    const transition = RunnableFrontierTransition.AuthorizeIntegratorCompetingHeadSuccessor({
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
    const proposal = proposalFor(transition)
    if (proposal === undefined) return yield* Effect.die("missing S2 authorization proposal")
    const action: IdentityFreeAction = { _tag: "IdentityFreeAction", proposal }
    const records = yield* Ref.make(initialRecords)
    const appendCalls = yield* Ref.make(0)
    const observationCalls = yield* Ref.make(0)
    const catchUpCalls = yield* Ref.make(0)
    const remoteGit = RemoteBaselineGit.of({
      observe: () =>
        Ref.update(observationCalls, (count) => count + 1).pipe(
          Effect.andThen(Effect.die("unexpected baseline observation"))
        ),
      catchUp: () =>
        Ref.update(catchUpCalls, (count) => count + 1).pipe(Effect.andThen(Effect.die("unexpected catch-up"))),
      reconcileCatchUp: () =>
        Ref.update(catchUpCalls, (count) => count + 1).pipe(
          Effect.andThen(Effect.die("unexpected catch-up reconciliation"))
        )
    })
    const journal = Journal.of({
      ...unusedJournal,
      appendIfAcceptedPrefixCurrent: (runId, _expectedPosition, key, event) => {
        const foreignRemoteHead = GitCommitSha.make("3333333333333333333333333333333333333333")
        const foreignEvent =
          event._tag === "IntegratorCompetingHeadSuccessorAuthorized"
            ? IntegratorCompetingHeadSuccessorAuthorizedEvent.make({
                authorizationId: integratorCompetingHeadSuccessorAuthorizationIdFor(
                  event.correlation.requestId,
                  event.remotePublicationRetainedAt,
                  event.mergeBase,
                  foreignRemoteHead
                ),
                correlation: event.correlation,
                initiatedBy: event.initiatedBy,
                mergeBase: event.mergeBase,
                occurrenceClassification: event.occurrenceClassification,
                remoteHead: foreignRemoteHead,
                remotePublicationRetainedAt: event.remotePublicationRetainedAt,
                version: event.version
              })
            : event
        return Ref.update(appendCalls, (count) => count + 1).pipe(
          Effect.as<ConditionalJournalAppendResult>({
            _tag: "Appended",
            record: { event: foreignEvent, key, position: JournalPosition.make(4), runId }
          })
        )
      },
      readAccepted: (runId) =>
        Ref.get(records).pipe(Effect.map((current) => acceptedJournalPrefixFromValidatedHistory(runId, current)))
    })
    const failure = yield* executeIntegrationAction(action, transition, inertLease, target).pipe(
      Effect.flip,
      Effect.provideService(Journal, journal),
      Effect.provideService(InRunJournal, appendableJournal(records)),
      Effect.provideService(AcceptedJournalReader, acceptedJournal(records)),
      Effect.provideService(RemoteBaselineGit, remoteGit),
      Effect.provideService(RemotePublicationGit, unusedRemotePublicationGit)
    )

    expect(failure).toBeInstanceOf(IntegratorJournalContradiction)
    expect(failure._tag).toBe("IntegratorJournalContradiction")
    expect(yield* Ref.get(appendCalls)).toBe(1)
    expect(yield* Ref.get(observationCalls)).toBe(0)
    expect(yield* Ref.get(catchUpCalls)).toBe(0)
    const after = yield* Ref.get(records)
    expect(after).toEqual(initialRecords)
    expect(after.map(({ event }) => event._tag)).not.toContain("RemoteBaselineReadIntended")
    expect(after.map(({ event }) => event._tag)).not.toContain("IntegratorAutomaticSuccessorSessionFixed")
    expect(after.map(({ event }) => event._tag)).not.toContain("IntegratorRunStarted")
  })
)

it.effect("replays exact S2 fixation after a lost acknowledgement and defers a concurrent Run Pause prefix", () =>
  Effect.gen(function* () {
    const prefix = makeSuccessorPrefix()
    const acceptedResponsibility = prefix.accepted.responsibility
    const transition = RunnableFrontierTransition.FixIntegratorAutomaticSuccessorSession({
      input: prefix.input,
      responsibility: acceptedResponsibility
    })
    const proposals = deliveryProposalsOf({
      acceptedOperationIds: HashSet.empty(),
      fresh: [],
      integrationResponsibilities: [acceptedResponsibility],
      responsibilities: [],
      runId: prefix.runId,
      transitions: [transition]
    })
    const proposal = [...proposals.ticketDelivery, ...proposals.deliverySettlement][0]
    expect(proposal).toBeDefined()
    if (proposal === undefined || !isIdentityFreeProposal(proposal))
      return yield* Effect.die("missing S2 fixation proposal")
    const action: IdentityFreeAction = { _tag: "IdentityFreeAction", proposal }

    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>(prefix.records())
    const prefixJournal = (append: Journal["Service"]["appendIfAcceptedPrefixCurrent"]) =>
      Journal.of({
        ...unusedJournal,
        appendIfAcceptedPrefixCurrent: append,
        readAccepted: (runId) =>
          Ref.get(records).pipe(Effect.map((current) => acceptedJournalPrefixFromValidatedHistory(runId, current)))
      })
    const appendThenLoseAcknowledgement: Journal["Service"]["appendIfAcceptedPrefixCurrent"] = (
      runId,
      _expectedPosition,
      key,
      event
    ) =>
      Ref.modify(records, (current): [JournalRecord, ReadonlyArray<JournalRecord>] => {
        const record: JournalRecord = { event, key, position: JournalPosition.make(current.length + 1), runId }
        return [record, [...current, record]]
      }).pipe(Effect.andThen(Effect.die("fixed-session append committed before its acknowledgement was lost")))
    const committedButUnacknowledged = yield* Effect.exit(
      executeIntegrationAction(action, transition, inertLease, prefix.accepted.trackerTarget).pipe(
        Effect.provideService(Journal, prefixJournal(appendThenLoseAcknowledgement)),
        Effect.provideService(InRunJournal, appendableJournal(records)),
        Effect.provideService(AcceptedJournalReader, acceptedJournal(records)),
        Effect.provideService(RemoteBaselineGit, unusedRemoteBaselineGit),
        Effect.provideService(RemotePublicationGit, unusedRemotePublicationGit)
      )
    )
    expect(committedButUnacknowledged._tag).toBe("Failure")
    const replayed = yield* executeIntegrationAction(
      action,
      transition,
      inertLease,
      prefix.accepted.trackerTarget
    ).pipe(
      Effect.provideService(
        Journal,
        prefixJournal(() => unexpectedJournalCall("duplicate fixation append"))
      ),
      Effect.provideService(InRunJournal, appendableJournal(records)),
      Effect.provideService(AcceptedJournalReader, acceptedJournal(records)),
      Effect.provideService(RemoteBaselineGit, unusedRemoteBaselineGit),
      Effect.provideService(RemotePublicationGit, unusedRemotePublicationGit)
    )
    expect(replayed).toMatchObject({ _tag: "ActionCompleted", proposalId: proposal.id })
    expect(
      (yield* Ref.get(records)).filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
    ).toHaveLength(1)

    const racingRecords = yield* Ref.make<ReadonlyArray<JournalRecord>>(prefix.records())
    const runPause = ControlDirectionAppliedEvent.make({
      direction: "Pause",
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      ordinal: ControlDirectionApplicationOrdinal.make(1),
      subject: { _tag: "Run", runId: prefix.runId },
      version: workflowJournalEventVersion
    })
    const appendRunPauseBeforeCas: Journal["Service"]["appendIfAcceptedPrefixCurrent"] = (runId, expectedPosition) =>
      Ref.modify(racingRecords, (current): [ConditionalJournalAppendResult, ReadonlyArray<JournalRecord>] => {
        const key = describeJournalEvent(runPause).expectedKey
        const record: JournalRecord = {
          event: runPause,
          key,
          position: JournalPosition.make(current.length + 1),
          runId
        }
        return [{ _tag: "PrefixAdvanced", currentPosition: record.position, expectedPosition }, [...current, record]]
      })
    const deferred = yield* executeIntegrationAction(
      action,
      transition,
      inertLease,
      prefix.accepted.trackerTarget
    ).pipe(
      Effect.provideService(
        Journal,
        Journal.of({
          ...unusedJournal,
          appendIfAcceptedPrefixCurrent: appendRunPauseBeforeCas,
          readAccepted: (runId) =>
            Ref.get(racingRecords).pipe(
              Effect.map((current) => acceptedJournalPrefixFromValidatedHistory(runId, current))
            )
        })
      ),
      Effect.provideService(InRunJournal, appendableJournal(racingRecords)),
      Effect.provideService(AcceptedJournalReader, acceptedJournal(racingRecords)),
      Effect.provideService(RemoteBaselineGit, unusedRemoteBaselineGit),
      Effect.provideService(RemotePublicationGit, unusedRemotePublicationGit)
    )
    expect(deferred).toMatchObject({
      _tag: "ActionDeferred",
      proposalId: proposal.id,
      reason: "ContinuationAuthorizationStale"
    })
    const afterRace = yield* Ref.get(racingRecords)
    expect(
      afterRace.some(
        ({ event }) =>
          event._tag === "ControlDirectionApplied" && event.subject._tag === "Run" && event.direction === "Pause"
      )
    ).toBe(true)
    expect(afterRace.filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")).toHaveLength(0)
  })
)

it.effect("defers an H2 fixation proposal after the accepted H3 refresh supersedes its baseline", () =>
  Effect.gen(function* () {
    const prefix = makeSuccessorPrefix()
    const transition = RunnableFrontierTransition.FixIntegratorAutomaticSuccessorSession({
      input: prefix.input,
      responsibility: prefix.accepted.responsibility
    })
    const proposal = proposalFor(transition)
    if (proposal === undefined) return yield* Effect.die("missing stale H2 fixation proposal")
    const action: IdentityFreeAction = { _tag: "IdentityFreeAction", proposal }
    const initial = prefix.records()
    const authorization = initial.find(({ event }) => event._tag === "IntegratorCompetingHeadSuccessorAuthorized")
    const firstRead = initial.find(({ event }) => event._tag === "RemoteBaselineReadIntended")
    if (
      authorization?.event._tag !== "IntegratorCompetingHeadSuccessorAuthorized" ||
      firstRead?.event._tag !== "RemoteBaselineReadIntended"
    ) {
      return yield* Effect.die("accepted H2 prefix must contain its authorization and ready baseline")
    }
    const h2 = authorization.event.remoteHead
    const h3 = GitCommitSha.make("8".repeat(40))
    const roundTwo = automaticCompetingHeadRemoteBaselineCorrelationFor(
      prefix.runId,
      firstRead.event.correlation.responsibility,
      firstRead.event.correlation.localTarget,
      firstRead.event.correlation.remoteTarget,
      authorization.position,
      RemoteBaselineRound.make(2)
    )
    prefix.append(
      RemoteBaselineReadIntendedEvent.make({
        correlation: roundTwo,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        version: workflowJournalEventVersion
      })
    )
    prefix.append(
      RemoteBaselineObservedEvent.make({
        correlation: roundTwo,
        observation: RemoteBaselineObservation.cases.LocalAncestor.make({ localHead: h2, remoteHead: h3 }),
        occurrenceClassification: "NonActionOccurrence",
        version: workflowJournalEventVersion
      })
    )
    prefix.append(
      LocalTargetCatchUpIntendedEvent.make({
        correlation: roundTwo,
        expectedLocalHead: h2,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        remoteHead: h3,
        version: workflowJournalEventVersion
      })
    )
    prefix.append(
      LocalTargetCatchUpObservedEvent.make({
        correlation: roundTwo,
        expectedLocalHead: h2,
        occurrenceClassification: "NonActionOccurrence",
        remoteHead: h3,
        result: LocalTargetCatchUpResult.cases.Applied.make({ newHead: h3 }),
        version: workflowJournalEventVersion
      })
    )
    const lineageOperation = makeTargetLineageObservationOperation({
      integrationTarget: prefix.accepted.integrationTarget,
      operationId: OperationId.make("stale-H2-fixation-after-H3-refresh"),
      plannedAttempt: prefix.input.predecessor.plannedAttempt,
      predecessorOperationIds: [prefix.accepted.targetLineageOperation.operationId]
    })
    const h3Lineage = TargetLineageObservation.make({
      plannedBaseIsAncestorOfTargetHead: true,
      plannedBaseSha: prefix.input.predecessor.plannedAttempt.baseSha,
      targetHeadSha: h3
    })
    prefix.append(
      GitReadIntentRecordedEvent.make({
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        operation: lineageOperation,
        version: workflowJournalEventVersion
      })
    )
    prefix.append(
      TargetLineageObservedEvent.make({
        observation: h3Lineage,
        occurrenceClassification: "NonActionOccurrence",
        operationId: lineageOperation.operationId,
        plannedAttempt: prefix.input.predecessor.plannedAttempt,
        version: workflowJournalEventVersion
      })
    )
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>(prefix.records())
    const appendCalls = yield* Ref.make(0)
    const baselineCalls = yield* Ref.make(0)
    const journal = Journal.of({
      ...unusedJournal,
      appendIfAcceptedPrefixCurrent: () =>
        Ref.update(appendCalls, (count) => count + 1).pipe(
          Effect.andThen(Effect.die("stale H2 fixation must not append"))
        ),
      readAccepted: (runId) =>
        Ref.get(records).pipe(Effect.map((current) => acceptedJournalPrefixFromValidatedHistory(runId, current)))
    })
    const baselineGit = RemoteBaselineGit.of({
      observe: () =>
        Ref.update(baselineCalls, (count) => count + 1).pipe(Effect.andThen(Effect.die("no baseline read"))),
      catchUp: () => Ref.update(baselineCalls, (count) => count + 1).pipe(Effect.andThen(Effect.die("no catch-up"))),
      reconcileCatchUp: () =>
        Ref.update(baselineCalls, (count) => count + 1).pipe(Effect.andThen(Effect.die("no reconciliation")))
    })
    const result = yield* executeIntegrationAction(action, transition, inertLease, prefix.accepted.trackerTarget).pipe(
      Effect.provideService(Journal, journal),
      Effect.provideService(InRunJournal, appendableJournal(records)),
      Effect.provideService(AcceptedJournalReader, acceptedJournal(records)),
      Effect.provideService(RemoteBaselineGit, baselineGit),
      Effect.provideService(RemotePublicationGit, unusedRemotePublicationGit)
    )
    expect(result).toMatchObject({
      _tag: "ActionDeferred",
      proposalId: proposal.id,
      reason: "ContinuationAuthorizationStale"
    })
    expect(yield* Ref.get(appendCalls)).toBe(0)
    expect(yield* Ref.get(baselineCalls)).toBe(0)
    expect(
      prefix.records().filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
    ).toHaveLength(0)
  })
)

it.effect("rejects a foreign fixed-session record returned by automatic S2 fixation append", () =>
  Effect.gen(function* () {
    const prefix = makeSuccessorPrefix()
    const transition = RunnableFrontierTransition.FixIntegratorAutomaticSuccessorSession({
      input: prefix.input,
      responsibility: prefix.accepted.responsibility
    })
    const proposal = proposalFor(transition)
    if (proposal === undefined) return yield* Effect.die("missing S2 fixation proposal")
    const action: IdentityFreeAction = { _tag: "IdentityFreeAction", proposal }
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>(prefix.records())
    const appendCalls = yield* Ref.make(0)
    const journal = Journal.of({
      ...unusedJournal,
      appendIfAcceptedPrefixCurrent: (runId, _expectedPosition, key, event) => {
        if (event._tag !== "IntegratorAutomaticSuccessorSessionFixed") {
          return Effect.die("fixation append must contain the exact automatic S2 event")
        }
        const foreignEvent = IntegratorAutomaticSuccessorSessionFixedEvent.make({
          ...event,
          successor: {
            ...event.successor,
            candidateResource: IntegratorCandidateResourceLocator.make("foreign-automatic-successor-resource"),
            sessionId: IntegratorSessionId.make("foreign-automatic-successor-session")
          }
        })
        return Ref.update(appendCalls, (count) => count + 1).pipe(
          Effect.as<ConditionalJournalAppendResult>({
            _tag: "Appended",
            record: { event: foreignEvent, key, position: JournalPosition.make(prefix.records().length + 1), runId }
          })
        )
      },
      readAccepted: (runId) =>
        Ref.get(records).pipe(Effect.map((current) => acceptedJournalPrefixFromValidatedHistory(runId, current)))
    })
    const failure = yield* executeIntegrationAction(action, transition, inertLease, prefix.accepted.trackerTarget).pipe(
      Effect.flip,
      Effect.provideService(Journal, journal),
      Effect.provideService(InRunJournal, appendableJournal(records)),
      Effect.provideService(AcceptedJournalReader, acceptedJournal(records)),
      Effect.provideService(RemoteBaselineGit, unusedRemoteBaselineGit),
      Effect.provideService(RemotePublicationGit, unusedRemotePublicationGit)
    )
    expect(failure).toBeInstanceOf(IntegratorJournalContradiction)
    expect(failure._tag).toBe("IntegratorJournalContradiction")
    expect(yield* Ref.get(appendCalls)).toBe(1)
    expect(
      (yield* Ref.get(records)).filter(({ event }) => event._tag === "IntegratorAutomaticSuccessorSessionFixed")
    ).toHaveLength(0)
  })
)
