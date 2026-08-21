import { it as effectIt } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { expect, it } from "vitest"
import {
  CompletionClaimBoundary,
  CompletionClaimDeletionFailure,
  CompletionClaimDeletionReadObservedEvent,
  CompletionClaimDeletionReadPurpose,
  CompletionClaimCleanupReadOrdinal,
  CompletionClaimDeletionRequest,
  CompletionClaimRequestOrdinal,
  CompletionClaimReplacementFailure,
  CompletionTaskClaim,
  CompletionTaskAuthorizationReadOrdinal,
  CompletionTaskConfirmationReadOrdinal,
  CompletionTaskFocusedReadPurpose,
  CompletionTaskRequestOrdinal,
  CompletionTaskRequest,
  completionSuccessObservationEquals,
  completionClaimDeletionRequestFor,
  completionClaimReplacementRequestFor,
  completionTaskFocusedReadPurposeEquals,
  PostPromotionBlockerCandidateAncestryObservedEvent,
  PostPromotionBlockerCandidateAncestryReadIntendedEvent,
  PostPromotionBlockerClearAuthorization,
  postPromotionBlockerAncestryOperationIdFor,
  FocusedCompletedTaskObservation,
  FocusedTaskCompletionFacts
} from "./events.js"
import { controlledCompletionClaimBoundaryLayerFrom } from "./controlled-boundaries.js"
import { integrationFinalityFixture as fixture } from "./fixtures.js"
import { ActiveTaskClaim, UnclaimedTask } from "../../../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../authorities/task-tracker/claim.js"
import { TrackerRevision } from "../../../authorities/task-tracker/task.js"
import { OperationId } from "../../identity.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { TaskId, TaskRevision } from "@dalph/contracts"
import { JournalPosition } from "../../../workflow-journal/identity.js"

it("validates post-promotion blocker chronology and deterministic Git-read identity", () => {
  const authorization = PostPromotionBlockerClearAuthorization.make({
    blockerClearedAt: JournalPosition.make(2),
    blockerObservedAt: JournalPosition.make(1),
    claim: fixture.claim
  })
  expect(Schema.is(PostPromotionBlockerClearAuthorization)(authorization)).toBe(true)
  expect(
    Schema.is(PostPromotionBlockerClearAuthorization)({ ...authorization, blockerClearedAt: JournalPosition.make(1) })
  ).toBe(false)
  const operationId = postPromotionBlockerAncestryOperationIdFor(authorization)
  const intent = PostPromotionBlockerCandidateAncestryReadIntendedEvent.make({
    authorization,
    operationId,
    version: workflowJournalEventVersion
  })
  const outcome = PostPromotionBlockerCandidateAncestryObservedEvent.make({
    authorization,
    observation: { _tag: "Unreadable", detail: "Git unavailable" },
    operationId,
    version: workflowJournalEventVersion
  })
  expect(Schema.is(PostPromotionBlockerCandidateAncestryReadIntendedEvent)(intent)).toBe(true)
  expect(Schema.is(PostPromotionBlockerCandidateAncestryObservedEvent)(outcome)).toBe(true)
  expect(
    Schema.is(PostPromotionBlockerCandidateAncestryReadIntendedEvent)({
      ...intent,
      operationId: OperationId.make("forged-post-promotion-operation")
    })
  ).toBe(false)
  expect(
    Schema.is(PostPromotionBlockerCandidateAncestryObservedEvent)({
      ...outcome,
      operationId: OperationId.make("forged-post-promotion-operation")
    })
  ).toBe(false)
})

const useBoundary = <A, E>(
  initial: ReadonlyArray<
    Parameters<typeof controlledCompletionClaimBoundaryLayerFrom>[0] extends ReadonlyArray<infer C> ? C : never
  >,
  effect: Effect.Effect<A, E, CompletionClaimBoundary>
) => effect.pipe(Effect.provide(controlledCompletionClaimBoundaryLayerFrom(initial)))

it("uses stable default operation identities for replacement and deletion requests", () => {
  const replacement = completionClaimReplacementRequestFor(fixture.claim)
  const deletion = completionClaimDeletionRequestFor(fixture.claim, fixture.successObservation)
  expect(String(replacement.operationId)).toBe(`completion-claim-replacement:${fixture.promotionCorrelation.requestId}`)
  expect(String(deletion.operationId)).toBe(`completion-claim-deletion:${fixture.promotionCorrelation.requestId}`)
  expect(completionClaimReplacementRequestFor(fixture.claim, OperationId.make("custom-replacement")).operationId).toBe(
    "custom-replacement"
  )
  expect(
    completionClaimDeletionRequestFor(fixture.claim, fixture.successObservation, OperationId.make("custom-deletion"))
      .operationId
  ).toBe("custom-deletion")
})

it("preserves focused completion evidence when constructing a deletion request", () => {
  const focused = FocusedCompletedTaskObservation.make({
    claim: fixture.claim,
    lifecycle: "CompletedSuccessfully",
    observedAt: fixture.successObservation.observedAt,
    operationId: fixture.successObservation.operationId,
    taskId: fixture.taskId,
    taskRevision: fixture.plannedAttempt.taskRevision,
    trackerRevision: fixture.trackerRevision,
    target: fixture.target
  })

  expect(completionClaimDeletionRequestFor(fixture.claim, focused).successObservation).toEqual(focused)
})

it("rejects completion claims and deletion proofs that bind a different task", () => {
  const foreignTaskId = TaskId.make("foreign-finality-schema-task")
  expect(
    Schema.is(CompletionTaskClaim)({
      ...fixture.claim,
      originalClaim: { ...fixture.activeClaim, taskId: foreignTaskId }
    })
  ).toBe(false)
  expect(
    Schema.is(CompletionClaimDeletionRequest)({
      ...completionClaimDeletionRequestFor(fixture.claim, fixture.successObservation),
      successObservation: { ...fixture.successObservation, taskId: foreignTaskId }
    })
  ).toBe(false)
})

it("rejects a deletion proof bound to a different completion claim for the same task", () => {
  const foreignActiveClaim = ActiveTaskClaim.make({
    ...fixture.activeClaim,
    operationId: OperationId.make("foreign-same-task-deletion-proof"),
    owner: ClaimOwner.make("dalph:foreign-same-task-deletion-proof"),
    token: ClaimToken.make("foreign-same-task-deletion-proof-token")
  })
  const foreignCompletionClaim = CompletionTaskClaim.make({ ...fixture.claim, originalClaim: foreignActiveClaim })
  const foreignSuccessObservation = FocusedCompletedTaskObservation.make({
    ...fixture.successObservation,
    claim: foreignCompletionClaim
  })

  expect(
    Schema.is(CompletionClaimDeletionRequest)({
      ...completionClaimDeletionRequestFor(fixture.claim, fixture.successObservation),
      successObservation: foreignSuccessObservation
    })
  ).toBe(false)
})

it("validates both cleanup-read observation variants and the final-attempt boundary", () => {
  const request = completionClaimDeletionRequestFor(fixture.claim, fixture.successObservation)
  const purpose = CompletionClaimDeletionReadPurpose.cases.BeforeDeletionAttempt.make({
    attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
    readOrdinal: CompletionClaimCleanupReadOrdinal.make(1)
  })
  const absent = UnclaimedTask.make({ taskId: fixture.taskId })
  const observed = {
    _tag: "CompletionClaimDeletionReadObserved" as const,
    observation: absent,
    purpose,
    replacementOperationId: OperationId.make("events-cleanup-replacement"),
    request,
    version: workflowJournalEventVersion
  }

  expect(Schema.is(CompletionClaimDeletionReadObservedEvent)(observed)).toBe(true)
  expect(
    Schema.is(CompletionClaimDeletionReadObservedEvent)({
      ...observed,
      observation: UnclaimedTask.make({ taskId: TaskId.make("foreign-cleanup-read-task") })
    })
  ).toBe(false)
  expect(
    Schema.is(CompletionClaimDeletionReadPurpose)({
      _tag: "AfterDeletionAttemptsExhausted",
      attemptOrdinal: CompletionClaimRequestOrdinal.make(1),
      readOrdinal: CompletionClaimCleanupReadOrdinal.make(1)
    })
  ).toBe(false)
})

it("rejects Q operation substitution and compares every focused cleanup-proof identity", () => {
  expect(
    Schema.is(CompletionTaskRequest)({
      ...fixture.completionRequest,
      operationId: OperationId.make("forged-completion-request")
    })
  ).toBe(false)
  expect(completionSuccessObservationEquals(fixture.successObservation, fixture.successObservation)).toBe(true)
  expect(
    completionSuccessObservationEquals(fixture.successObservation, {
      ...fixture.successObservation,
      taskId: TaskId.make("foreign-cleanup-proof-task")
    })
  ).toBe(false)
  expect(
    completionSuccessObservationEquals(fixture.successObservation, {
      ...fixture.successObservation,
      trackerRevision: TrackerRevision.make("foreign-cleanup-proof-revision")
    })
  ).toBe(false)
})

it("rejects focused success that names another task or task revision", () => {
  const focused = FocusedCompletedTaskObservation.make({
    claim: fixture.claim,
    lifecycle: "CompletedSuccessfully",
    observedAt: fixture.successObservation.observedAt,
    operationId: fixture.successObservation.operationId,
    taskId: fixture.taskId,
    taskRevision: fixture.plannedAttempt.taskRevision,
    trackerRevision: fixture.trackerRevision,
    target: fixture.target
  })

  expect(
    Schema.is(FocusedCompletedTaskObservation)({ ...focused, taskId: TaskId.make("foreign-focused-success-task") })
  ).toBe(false)
  expect(
    Schema.is(FocusedCompletedTaskObservation)({
      ...focused,
      taskRevision: TaskRevision.make("foreign-focused-success-revision")
    })
  ).toBe(false)
})

it("represents target membership and non-membership as complete focused facts", () => {
  expect(Schema.is(FocusedTaskCompletionFacts)(fixture.focusedSuccessFactsEvent.observation.facts)).toBe(true)
  expect(
    Schema.is(FocusedTaskCompletionFacts)({
      ...fixture.focusedSuccessFactsEvent.observation.facts,
      targetMembership: "NotMember"
    })
  ).toBe(true)
})

it("compares focused read purposes exhaustively by variant and ordinal", () => {
  const first = CompletionTaskRequestOrdinal.make(1)
  const second = CompletionTaskRequestOrdinal.make(2)
  const firstAuthorization = CompletionTaskAuthorizationReadOrdinal.make(1)
  const authorization = CompletionTaskFocusedReadPurpose.cases.Authorization.make({
    attemptOrdinal: first,
    authorizationOrdinal: firstAuthorization
  })
  const sameAuthorization = CompletionTaskFocusedReadPurpose.cases.Authorization.make({
    attemptOrdinal: first,
    authorizationOrdinal: firstAuthorization
  })
  const laterAuthorization = CompletionTaskFocusedReadPurpose.cases.Authorization.make({
    attemptOrdinal: second,
    authorizationOrdinal: firstAuthorization
  })
  const confirmation = CompletionTaskFocusedReadPurpose.cases.Confirmation.make({
    attemptOrdinal: first,
    confirmationOrdinal: CompletionTaskConfirmationReadOrdinal.make(1)
  })
  const sameConfirmation = CompletionTaskFocusedReadPurpose.cases.Confirmation.make({
    attemptOrdinal: first,
    confirmationOrdinal: CompletionTaskConfirmationReadOrdinal.make(1)
  })

  expect(completionTaskFocusedReadPurposeEquals(authorization, sameAuthorization)).toBe(true)
  expect(completionTaskFocusedReadPurposeEquals(authorization, laterAuthorization)).toBe(false)
  expect(completionTaskFocusedReadPurposeEquals(authorization, confirmation)).toBe(false)
  expect(completionTaskFocusedReadPurposeEquals(confirmation, sameConfirmation)).toBe(true)
  expect(completionTaskFocusedReadPurposeEquals(confirmation, authorization)).toBe(false)
})

effectIt.effect("fails closed for absent or foreign claims and preserves exact boundary ownership", () =>
  Effect.gen(function* () {
    const replacement = completionClaimReplacementRequestFor(fixture.claim)
    const absentReplacement = yield* Effect.flip(
      useBoundary(
        [],
        Effect.gen(function* () {
          const boundary = yield* CompletionClaimBoundary
          return yield* boundary.replaceTaskClaim(replacement)
        })
      )
    )
    expect(absentReplacement).toBeInstanceOf(CompletionClaimReplacementFailure)

    const foreignActive = ActiveTaskClaim.make({
      operationId: OperationId.make("foreign-events-active"),
      owner: ClaimOwner.make("dalph:foreign-events"),
      taskId: fixture.taskId,
      token: ClaimToken.make("foreign-events-token")
    })
    const foreignReplacement = yield* Effect.flip(
      useBoundary(
        [foreignActive],
        Effect.gen(function* () {
          const boundary = yield* CompletionClaimBoundary
          return yield* boundary.replaceTaskClaim(replacement)
        })
      )
    )
    expect(foreignReplacement).toBeInstanceOf(CompletionClaimReplacementFailure)

    const foreignClaim = CompletionTaskClaim.make({
      originalClaim: foreignActive,
      plannedAttempt: fixture.plannedAttempt,
      promotionCorrelation: fixture.promotionCorrelation
    })
    const deletion = completionClaimDeletionRequestFor(fixture.claim, fixture.successObservation)
    const foreignDeletion = yield* Effect.flip(
      useBoundary(
        [foreignClaim],
        Effect.gen(function* () {
          const boundary = yield* CompletionClaimBoundary
          return yield* boundary.deleteTaskClaim(deletion)
        })
      )
    )
    expect(foreignDeletion).toBeInstanceOf(CompletionClaimDeletionFailure)
  })
)

effectIt.effect("recognizes an exact completion claim, deletes it, and makes repeated absence harmless", () =>
  Effect.gen(function* () {
    const replacement = completionClaimReplacementRequestFor(fixture.claim)
    const deletion = completionClaimDeletionRequestFor(fixture.claim, fixture.successObservation)
    const observations = yield* useBoundary(
      [fixture.activeClaim],
      Effect.gen(function* () {
        const boundary = yield* CompletionClaimBoundary
        const replaced = yield* boundary.replaceTaskClaim(replacement)
        const replayed = yield* boundary.replaceTaskClaim(replacement)
        yield* boundary.deleteTaskClaim(deletion)
        yield* boundary.deleteTaskClaim(deletion)
        const absent = yield* boundary.readTaskClaim(fixture.taskId)
        return { absent, replaced, replayed }
      })
    )
    expect(observations.replaced).toEqual(fixture.claim)
    expect(observations.replayed).toEqual(fixture.claim)
    expect(observations.absent._tag).toBe("UnclaimedTask")
  })
)
