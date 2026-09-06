import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Effect, Result, Stream } from "effect"
import { expect } from "vitest"
import { TaskLifecycle, type Task } from "../../authorities/task-tracker/task.js"
import type { IntegrationTargetResourceController } from "../admission/integration-target-resource.js"
import type { DeliveryActionExecutionLease } from "./delivery-action-executor.js"
import type { DeliveryActionProposal, IdentityFreeDeliveryProposal } from "./delivery-action-proposal.js"
import { deliveryProposalsOf, freshContinuationDecisionsOf } from "./delivery-proposal.js"
import { FreshWorkflowStep } from "./fresh-workflow-step.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { InRunJournal, JournalStorageUnavailable } from "../../workflow-journal/store.js"
import { executeFreshPlannedAttempt } from "./planned-attempt-delivery-action-adapter.js"
import {
  PassivePlannedAttemptObserver,
  PassivePlannedAttemptProjectionPublication
} from "../run/passive-planned-attempt-observer.js"
import { makeFreshTaskCommitmentForTest } from "../../../test/support/fresh-task-admission.js"

const runId = RunId.make("planned-attempt-adapter-failure-run")
const taskId = TaskId.make("planned-attempt-adapter-failure-task")
const task: Task = { id: taskId, lifecycle: TaskLifecycle.cases.Open.make({}), parentTaskId: null, prerequisiteIds: [] }
const specification = makeTaskWorkSpecification({
  body: "The executor must not be entered when responsibility cannot be recorded.",
  taskId,
  title: "Responsibility append failure"
})
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("planned-attempt-adapter-failure-attempt"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/planned-attempt-adapter-failure"),
  executor: TaskExecutorLocator.make("executor:planned-attempt-adapter-failure"),
  runId,
  taskId,
  taskRevision: TaskRevision.make(specification.fingerprint),
  worktree: WorktreeLocator.make("/worktrees/planned-attempt-adapter-failure")
})
const claimOperationId = OperationId.make("planned-attempt-adapter-claim")
const commitment = makeFreshTaskCommitmentForTest(taskId, claimOperationId, runId)

const isIdentityFreeProposal = (proposal: DeliveryActionProposal): proposal is IdentityFreeDeliveryProposal =>
  proposal.actionIdentity._tag === "NoWorkflowOperationIdentity"

const inertIntegrationTargets: IntegrationTargetResourceController = {
  acquire: () => Effect.void,
  changes: Stream.empty,
  publishAcceptedOwnership: () => Effect.void,
  release: () => Effect.void,
  releaseAll: Effect.void,
  snapshot: Effect.succeed({ activeResponsibilityPositions: new Set(), heldResponsibilityPositions: new Set() }),
  withPermit: (_responsibility, effect) => effect
}

const inertExecutor = PlannedAttemptExecutor.of({
  observe: () => Effect.die("the executor must not be observed after responsibility append failure"),
  requestSuspension: () => Effect.die("the executor must not be suspended after responsibility append failure"),
  begin: () => Effect.die("the executor must not begin after responsibility append failure"),
  resume: () => Effect.die("the executor must not resume after responsibility append failure")
})

const providePassiveObservation = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(
    Effect.provideService(
      PassivePlannedAttemptObserver,
      PassivePlannedAttemptObserver.of({ attach: () => Effect.die("passive observation must not begin") })
    ),
    Effect.provideService(
      PassivePlannedAttemptProjectionPublication,
      PassivePlannedAttemptProjectionPublication.of({
        publish: () => Effect.die("passive projection must not be published"),
        publishWithPermit: () => Effect.die("passive projection must not be published")
      })
    )
  )

it.effect("does not bind or enter the executor when responsibility append fails", () =>
  Effect.gen(function* () {
    const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })
    const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
      claimOperationId,
      plannedAttempt,
      specification,
      task
    })
    const [proposal] = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: Result.getOrThrow(freshContinuationDecisionsOf([{ step, transition }], [commitment])),
      runId,
      transitions: [transition]
    }).ticketDelivery
    if (
      proposal === undefined ||
      !isIdentityFreeProposal(proposal) ||
      proposal.route._tag !== "FreshExecutorWorkflowRoute"
    ) {
      return yield* Effect.die("missing identity-free fresh executor proposal")
    }

    let bindCalls = 0
    let protocolBoundaryCalls = 0
    const lease: DeliveryActionExecutionLease = {
      acceptIntegrationTargetOwnership: Effect.void,
      bindPlannedAttemptPosition: () =>
        Effect.sync(() => {
          bindCalls += 1
        }),
      forwardBoundary: { _tag: "AtomicBoundary", execution: { run: (effect) => effect } },
      integrationTargets: inertIntegrationTargets,
      recordIntent: () => Effect.void,
      releasePlannedAttemptPosition: () => Effect.void,
      withPlannedAttemptProtocol: () =>
        Effect.sync(() => {
          protocolBoundaryCalls += 1
        }).pipe(Effect.andThen(Effect.die("the executor protocol must not be entered")))
    }
    const journal = InRunJournal.of({
      append: () =>
        Effect.fail(
          new JournalStorageUnavailable({
            detail: "controlled responsibility append outage",
            operation: "JournalStore.append"
          })
        ),
      read: () => Effect.succeed([])
    })

    const failure = yield* Effect.flip(
      executeFreshPlannedAttempt({ _tag: "IdentityFreeAction", proposal }, proposal.route, lease).pipe(
        Effect.provideService(InRunJournal, journal),
        Effect.provideService(PlannedAttemptExecutor, inertExecutor),
        providePassiveObservation
      )
    )

    expect(failure).toMatchObject({ _tag: "JournalStorageUnavailable", operation: "JournalStore.append" })
    expect(bindCalls).toBe(0)
    expect(protocolBoundaryCalls).toBe(0)
  })
)

it.effect("does not enter the executor when binding follows a successful responsibility append but fails", () =>
  Effect.gen(function* () {
    const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })
    const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
      claimOperationId,
      plannedAttempt,
      specification,
      task
    })
    const [proposal] = deliveryProposalsOf({
      acceptedOperationIds: new Set(),
      fresh: Result.getOrThrow(freshContinuationDecisionsOf([{ step, transition }], [commitment])),
      runId,
      transitions: [transition]
    }).ticketDelivery
    if (
      proposal === undefined ||
      !isIdentityFreeProposal(proposal) ||
      proposal.route._tag !== "FreshExecutorWorkflowRoute"
    ) {
      return yield* Effect.die("missing identity-free fresh executor proposal")
    }

    let appendCalls = 0
    let bindCalls = 0
    let boundResponsibilityAcceptedAt: JournalPosition | undefined
    let boundResponsibilityAttempt: PlannedTaskAttempt | undefined
    let protocolBoundaryCalls = 0
    const lease: DeliveryActionExecutionLease = {
      acceptIntegrationTargetOwnership: Effect.void,
      bindPlannedAttemptPosition: (_boundAttempt, acceptedResponsibility) =>
        Effect.sync(() => {
          bindCalls += 1
          boundResponsibilityAcceptedAt = acceptedResponsibility?.acceptedAt
          boundResponsibilityAttempt = acceptedResponsibility?.plannedAttempt
        }).pipe(Effect.andThen(Effect.die("controlled planned-attempt bind failure"))),
      forwardBoundary: { _tag: "AtomicBoundary", execution: { run: (effect) => effect } },
      integrationTargets: inertIntegrationTargets,
      recordIntent: () => Effect.void,
      releasePlannedAttemptPosition: () => Effect.void,
      withPlannedAttemptProtocol: () =>
        Effect.sync(() => {
          protocolBoundaryCalls += 1
        }).pipe(Effect.andThen(Effect.die("the executor protocol must not be entered")))
    }
    const journal = InRunJournal.of({
      append: (appendRunId, key, event) =>
        Effect.sync(() => {
          appendCalls += 1
          return { event, key, position: JournalPosition.make(1), runId: appendRunId }
        }),
      read: () => Effect.succeed([])
    })

    const failure = yield* Effect.exit(
      executeFreshPlannedAttempt({ _tag: "IdentityFreeAction", proposal }, proposal.route, lease).pipe(
        Effect.provideService(InRunJournal, journal),
        Effect.provideService(PlannedAttemptExecutor, inertExecutor),
        providePassiveObservation
      )
    )

    expect(failure._tag).toBe("Failure")
    expect(appendCalls).toBe(1)
    expect(bindCalls).toBe(1)
    expect(boundResponsibilityAcceptedAt).toBe(JournalPosition.make(1))
    expect(boundResponsibilityAttempt).toEqual(plannedAttempt)
    expect(protocolBoundaryCalls).toBe(0)
  })
)
