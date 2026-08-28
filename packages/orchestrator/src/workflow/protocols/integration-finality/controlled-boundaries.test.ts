import { it } from "@effect/vitest"
import { TaskId, TaskRevision } from "@dalph/contracts"
import { Effect } from "effect"
import { expect } from "vitest"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { ActiveTaskClaim, UnclaimedTask } from "../../../authorities/task-tracker/claim-mutation.js"
import { FixtureTarget } from "../../../authorities/task-tracker/fixture/target.js"
import { OperationId } from "../../identity.js"
import { completionBoundaryContract } from "../../../../test/contracts/completion-boundary-contract.js"
import {
  controlledCompletionClaimBoundaryLayerFrom,
  controlledCompletionTaskBoundaryLayerFrom
} from "./controlled-boundaries.js"
import {
  CompletionClaimBoundary,
  CompletionClaimDeletionFailure,
  CompletionClaimReplacementFailure,
  CompletionTaskBoundary,
  CompletionTaskClaim,
  CompletionTaskRequest,
  CompletionTaskRequestFailure,
  FocusedTaskCompletionFacts,
  FocusedTaskCompletionReadRequest,
  FocusedTaskCompletionReadFailure,
  completionClaimDeletionRequestFor,
  completionClaimReadRequestFor,
  completionClaimReplacementRequestFor,
  completionTaskRequestEquals
} from "./events.js"
import { integrationFinalityFixture as fixture } from "./fixtures.js"

const openFacts = FocusedTaskCompletionFacts.make({
  ...fixture.focusedSuccessFactsEvent.observation.facts,
  lifecycle: "Open",
  operationId: OperationId.make("controlled-completion-initial-facts")
})

const focusedReadRequest = (taskId: TaskId, target: typeof fixture.target, operationId: OperationId) =>
  FocusedTaskCompletionReadRequest.make({ expectedClaim: fixture.claim, operationId, target, taskId })

completionBoundaryContract({
  expectedOpenFacts: openFacts,
  layer: controlledCompletionTaskBoundaryLayerFrom([openFacts]),
  name: "controlled",
  request: fixture.completionRequest,
  target: fixture.target
})

const rejectAndReadCurrentFacts = (currentFacts: FocusedTaskCompletionFacts) =>
  Effect.gen(function* () {
    const boundary = yield* CompletionTaskBoundary
    const failure = yield* boundary.completeTask(fixture.completionRequest).pipe(Effect.flip)
    const readOperationId = OperationId.make("controlled-completion-rejected-state-read")
    const observed = yield* boundary.readFocusedTaskCompletion(
      focusedReadRequest(fixture.taskId, fixture.target, readOperationId)
    )
    return { failure, observed, readOperationId }
  }).pipe(Effect.provide(controlledCompletionTaskBoundaryLayerFrom([currentFacts])))

it.effect("correlates a focused completion read to its operation and rejects absent or foreign-target facts", () =>
  Effect.gen(function* () {
    const readOperationId = OperationId.make("controlled-completion-focused-read")
    yield* Effect.gen(function* () {
      const boundary = yield* CompletionTaskBoundary
      const observed = yield* boundary.readFocusedTaskCompletion(
        focusedReadRequest(fixture.taskId, fixture.target, readOperationId)
      )
      expect(observed).toEqual({ ...openFacts, operationId: readOperationId })

      const wrongTarget = yield* boundary
        .readFocusedTaskCompletion(
          FocusedTaskCompletionReadRequest.make({
            expectedClaim: fixture.claim,
            operationId: readOperationId,
            target: FixtureTarget.make("controlled-completion-foreign-target"),
            taskId: fixture.taskId
          })
        )
        .pipe(Effect.flip)
      expect(wrongTarget).toBeInstanceOf(FocusedTaskCompletionReadFailure)
      expect(wrongTarget.taskId).toBe(fixture.taskId)
    }).pipe(Effect.provide(controlledCompletionTaskBoundaryLayerFrom([openFacts])))

    const missing = yield* Effect.gen(function* () {
      return yield* (yield* CompletionTaskBoundary)
        .readFocusedTaskCompletion(focusedReadRequest(fixture.taskId, fixture.target, readOperationId))
        .pipe(Effect.flip)
    }).pipe(Effect.provide(controlledCompletionTaskBoundaryLayerFrom([])))
    expect(missing).toBeInstanceOf(FocusedTaskCompletionReadFailure)
    expect(missing.taskId).toBe(fixture.taskId)
  })
)

it.effect("completes only the exact task request and exposes success through a later focused read", () =>
  Effect.gen(function* () {
    const boundary = yield* CompletionTaskBoundary
    const acknowledgement = yield* boundary.completeTask(fixture.completionRequest)
    expect(acknowledgement).toEqual({ operationId: fixture.completionRequest.operationId, taskId: fixture.taskId })

    const confirmationOperationId = OperationId.make("controlled-completion-confirmation-read")
    const confirmed = yield* boundary.readFocusedTaskCompletion(
      focusedReadRequest(fixture.taskId, fixture.target, confirmationOperationId)
    )
    expect(confirmed).toEqual({
      ...openFacts,
      lifecycle: "CompletedSuccessfully",
      operationId: confirmationOperationId
    })
  }).pipe(Effect.provide(controlledCompletionTaskBoundaryLayerFrom([openFacts])))
)

it.effect("returns NotMember as complete focused facts and does not mutate it", () =>
  Effect.gen(function* () {
    const notMemberFacts = FocusedTaskCompletionFacts.make({ ...openFacts, targetMembership: "NotMember" })
    const { failure, observed, readOperationId } = yield* rejectAndReadCurrentFacts(notMemberFacts)

    expect(failure).toMatchObject({
      detail: "current task is not a member of the completion target",
      outcome: "DefinitelyNotApplied",
      request: fixture.completionRequest
    })
    expect(observed).toEqual({ ...notMemberFacts, operationId: readOperationId })
  })
)

it.effect("does not mutate a task whose current lifecycle is already terminal", () =>
  Effect.gen(function* () {
    for (const lifecycle of ["CompletedSuccessfully", "TerminalWithoutSuccess"] as const) {
      const terminalFacts = FocusedTaskCompletionFacts.make({ ...openFacts, lifecycle })
      const { failure, observed, readOperationId } = yield* rejectAndReadCurrentFacts(terminalFacts)

      expect(failure).toMatchObject({
        detail: `current task lifecycle is ${lifecycle}, not Open`,
        outcome: "DefinitelyNotApplied",
        request: fixture.completionRequest
      })
      expect(observed).toEqual({ ...terminalFacts, operationId: readOperationId })
    }
  })
)

it.effect("does not mutate a task with unfinished prerequisites", () =>
  Effect.gen(function* () {
    const blockedFacts = FocusedTaskCompletionFacts.make({
      ...openFacts,
      unfinishedPrerequisiteTaskIds: [TaskId.make("controlled-completion-unfinished-prerequisite")]
    })
    const { failure, observed, readOperationId } = yield* rejectAndReadCurrentFacts(blockedFacts)

    expect(failure).toMatchObject({
      detail: "current task has unfinished prerequisites",
      outcome: "DefinitelyNotApplied",
      request: fixture.completionRequest
    })
    expect(observed).toEqual({ ...blockedFacts, operationId: readOperationId })
  })
)

it.effect("does not mutate a task whose revision differs from the completion request", () =>
  Effect.gen(function* () {
    const changedRevisionFacts = FocusedTaskCompletionFacts.make({
      ...openFacts,
      taskRevision: TaskRevision.make("controlled-completion-changed-revision")
    })
    const { failure, observed, readOperationId } = yield* rejectAndReadCurrentFacts(changedRevisionFacts)

    expect(failure).toMatchObject({
      detail: "current task revision does not match the completion request",
      outcome: "DefinitelyNotApplied",
      request: fixture.completionRequest
    })
    expect(observed).toEqual({ ...changedRevisionFacts, operationId: readOperationId })
  })
)

it.effect("does not mutate a task whose current claim is not exact KC", () =>
  Effect.gen(function* () {
    const foreignActiveClaim = ActiveTaskClaim.make({
      ...fixture.activeClaim,
      operationId: OperationId.make("controlled-completion-foreign-active-claim"),
      owner: ClaimOwner.make("dalph:controlled-completion-foreign-owner"),
      token: ClaimToken.make("controlled-completion-foreign-token")
    })
    const foreignCompletionClaim = CompletionTaskClaim.make({ ...fixture.claim, originalClaim: foreignActiveClaim })
    const foreignCompletionClaimFacts = FocusedTaskCompletionFacts.make({
      ...openFacts,
      currentClaim: foreignCompletionClaim
    })
    const activeClaimFacts = FocusedTaskCompletionFacts.make({ ...openFacts, currentClaim: fixture.activeClaim })

    for (const currentFacts of [activeClaimFacts, foreignCompletionClaimFacts]) {
      const { failure, observed, readOperationId } = yield* rejectAndReadCurrentFacts(currentFacts)

      expect(failure).toMatchObject({
        detail: "current claim is not the exact completion claim",
        outcome: "DefinitelyNotApplied",
        request: fixture.completionRequest
      })
      expect(observed).toEqual({ ...currentFacts, operationId: readOperationId })
    }
  })
)

it.effect("rejects completion when current focused task facts are absent", () =>
  Effect.gen(function* () {
    const boundary = yield* CompletionTaskBoundary
    const failure = yield* boundary.completeTask(fixture.completionRequest).pipe(Effect.flip)

    expect(failure).toBeInstanceOf(CompletionTaskRequestFailure)
    expect(failure).toMatchObject({
      detail: "current task completion facts are absent",
      outcome: "DefinitelyNotApplied",
      request: fixture.completionRequest
    })
  }).pipe(Effect.provide(controlledCompletionTaskBoundaryLayerFrom([])))
)

it.effect("reports an unseen exact Q NotApplied and an applied exact Q Applied", () =>
  Effect.gen(function* () {
    const boundary = yield* CompletionTaskBoundary
    const unseen = yield* boundary.readCompletionRequest(fixture.completionRequest)
    yield* boundary.completeTask(fixture.completionRequest)
    const applied = yield* boundary.readCompletionRequest(fixture.completionRequest)
    const repeated = yield* boundary.readCompletionRequest(fixture.completionRequest)

    expect([unseen._tag, applied._tag, repeated._tag]).toEqual(["NotApplied", "Applied", "Applied"])
    expect(
      [unseen, applied, repeated].every(({ request }) =>
        completionTaskRequestEquals(request, fixture.completionRequest)
      )
    ).toBe(true)
  }).pipe(Effect.provide(controlledCompletionTaskBoundaryLayerFrom([openFacts])))
)

it.effect("repeats one exact Q but rejects a different request reusing its operation identity", () =>
  Effect.gen(function* () {
    const boundary = yield* CompletionTaskBoundary
    yield* boundary.completeTask(fixture.completionRequest)
    const repeated = yield* boundary.completeTask(fixture.completionRequest)
    expect(repeated).toMatchObject({
      operationId: fixture.completionRequest.operationId,
      taskId: fixture.completionRequest.taskId
    })

    const contradictoryOriginalClaim = ActiveTaskClaim.make({
      ...fixture.completionRequest.claim.originalClaim,
      operationId: OperationId.make("controlled-completion-contradictory-original-claim")
    })
    const contradictoryClaim = CompletionTaskClaim.make({
      ...fixture.completionRequest.claim,
      originalClaim: contradictoryOriginalClaim
    })
    const contradictoryRequest = CompletionTaskRequest.make({ ...fixture.completionRequest, claim: contradictoryClaim })
    const failure = yield* boundary.completeTask(contradictoryRequest).pipe(Effect.flip)
    expect(failure).toMatchObject({
      detail: "completion operation identity is already bound to another request",
      outcome: "DefinitelyNotApplied",
      request: contradictoryRequest
    })
    expect(yield* boundary.readCompletionRequest(contradictoryRequest)).toMatchObject({
      _tag: "Unreadable",
      detail: "controlled request identity contradicts an already applied request"
    })
  }).pipe(Effect.provide(controlledCompletionTaskBoundaryLayerFrom([openFacts])))
)

it.effect("reports a configured exact-Q lookup as unreadable without inventing application state", () =>
  Effect.gen(function* () {
    const boundary = yield* CompletionTaskBoundary
    const first = yield* boundary.readCompletionRequest(fixture.completionRequest)
    const second = yield* boundary.readCompletionRequest(fixture.completionRequest)

    expect(first).toMatchObject({ _tag: "Unreadable", detail: "controlled request lookup unreadable" })
    expect(second).toEqual(first)
  }).pipe(
    Effect.provide(
      controlledCompletionTaskBoundaryLayerFrom([], {
        unreadableRequestOperationIds: new Set([fixture.completionRequest.operationId])
      })
    )
  )
)

it.effect("fails closed for the remaining explicit unclaimed and mismatched claim states", () =>
  Effect.gen(function* () {
    const replacement = completionClaimReplacementRequestFor(fixture.claim)
    const deletion = completionClaimDeletionRequestFor(fixture.claim, fixture.successObservation)
    const unclaimed = UnclaimedTask.make({ taskId: fixture.taskId })
    const explicitlyUnclaimed = yield* Effect.gen(function* () {
      const boundary = yield* CompletionClaimBoundary
      expect(yield* boundary.readTaskClaim(completionClaimReadRequestFor(fixture.claim))).toEqual(unclaimed)
      const failure = yield* boundary.replaceTaskClaim(replacement).pipe(Effect.flip)
      yield* boundary.deleteTaskClaim(deletion)
      return failure
    }).pipe(Effect.provide(controlledCompletionClaimBoundaryLayerFrom([unclaimed])))
    expect(explicitlyUnclaimed).toBeInstanceOf(CompletionClaimReplacementFailure)

    const activeDeletion = yield* Effect.gen(function* () {
      const boundary = yield* CompletionClaimBoundary
      expect(yield* boundary.readTaskClaim(completionClaimReadRequestFor(fixture.claim))).toEqual(fixture.activeClaim)
      return yield* boundary.deleteTaskClaim(deletion).pipe(Effect.flip)
    }).pipe(Effect.provide(controlledCompletionClaimBoundaryLayerFrom([fixture.activeClaim])))
    expect(activeDeletion).toBeInstanceOf(CompletionClaimDeletionFailure)

    const foreignActiveClaim = ActiveTaskClaim.make({
      ...fixture.activeClaim,
      operationId: OperationId.make("controlled-replacement-foreign-active-claim")
    })
    const foreignCompletionClaim = CompletionTaskClaim.make({ ...fixture.claim, originalClaim: foreignActiveClaim })
    const completionReplacement = yield* Effect.gen(function* () {
      const boundary = yield* CompletionClaimBoundary
      return yield* boundary.replaceTaskClaim(replacement).pipe(Effect.flip)
    }).pipe(Effect.provide(controlledCompletionClaimBoundaryLayerFrom([foreignCompletionClaim])))
    expect(completionReplacement).toBeInstanceOf(CompletionClaimReplacementFailure)
  })
)
