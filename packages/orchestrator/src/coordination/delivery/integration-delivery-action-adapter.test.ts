import { it } from "@effect/vitest"
import { Effect, Ref, Stream } from "effect"
import { expect } from "vitest"
import { TaskRevision } from "@dalph/contracts"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
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
    acceptedOperationIds: new Set(),
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

const inertLease: DeliveryActionExecutionLease = {
  acceptIntegrationTargetOwnership: Effect.void,
  bindPreStartTaskWorkPosition: () => Effect.void,
  bindPreStartPlannedAttemptPosition: () => Effect.void,
  bindPlannedAttemptPosition: () => Effect.void,
  forwardBoundary: { _tag: "AtomicBoundary", execution: { run: (effect) => effect } },
  integrationTargets: {
    acquire: () => Effect.void,
    changes: Stream.empty,
    publishAcceptedOwnership: () => Effect.void,
    release: () => Effect.void,
    releaseAll: Effect.void,
    snapshot: Effect.succeed({ activeResponsibilityPositions: new Set(), heldResponsibilityPositions: new Set() }),
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
      yield* executeIntegrationAction(action, transition, inertLease, target).pipe(
        Effect.provideService(InRunJournal, journal)
      )
    ).toMatchObject({ _tag: "ActionDeferred", proposalId: proposal.id, reason: "CompletionTaskUnavailable" })
    expect(yield* Ref.get(records)).toEqual([])

    expect(
      yield* executeIntegrationAction(action, transition, inertLease, target).pipe(
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
    const records = yield* Ref.make<ReadonlyArray<JournalRecord>>([])
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

    const result = yield* executeIntegrationAction(action, transition, inertLease, target).pipe(
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
