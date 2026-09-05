import { Schema } from "effect"
import { expect, it } from "vitest"
import type { AttemptId, GitCommitSha, TaskId } from "@dalph/contracts"
import {
  AuthoredCassetteStoryItem,
  type AuthoredCassetteStoryItem as AuthoredCassetteStoryItemType,
  AuthoredScenarioCassette,
  promotedCompletionReadHoldClosureIssue,
  promotedCompletionReadHoldKey,
  targetPromotionGitRequestAliasIssue,
  taskWorktreeSelectionHoldKey,
  taskWorktreeSelectionHoldClosureIssue
} from "../../src/cassettes/authored-domain.js"
import {
  deliveryFinalitySpineAuthoredCassette,
  deliveryInvariantStoryAuthoredCassette
} from "../../src/cassettes/catalog.js"

it("accepts an exact in-flight prefix of the completion-finality boundary chronology", () => {
  const withoutDeletion = {
    ...deliveryFinalitySpineAuthoredCassette,
    story: deliveryFinalitySpineAuthoredCassette.story
      .filter((item) => item._tag !== "CompletionClaimReadReturned" || item.claim === "Active")
      .filter((item) => item._tag !== "CompletionClaimDeletionApplied")
  }

  expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(withoutDeletion)).not.toThrow()
})

it("rejects a skipped step in the authored completion-finality boundary chronology", () => {
  const withoutReplacement = {
    ...deliveryFinalitySpineAuthoredCassette,
    story: deliveryFinalitySpineAuthoredCassette.story.filter(
      (item) => item._tag !== "CompletionClaimReplacementApplied"
    )
  }

  expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(withoutReplacement)).toThrow(
    /must be an exact prefix of active-record presence, replacement, two completion-marker presence reads, completion-marker deletion, and completion-marker absence/u
  )
})
it("keeps active-record absence distinct from completion-marker absence in authored finality", () => {
  const distinctMarkerReads = deliveryFinalitySpineAuthoredCassette

  expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(distinctMarkerReads)).not.toThrow()
  expect(() =>
    Schema.decodeUnknownSync(AuthoredScenarioCassette)({
      ...distinctMarkerReads,
      story: distinctMarkerReads.story.map((item) =>
        item._tag === "CompletionClaimReadReturned" && item.claim === "CompletionMarkerAbsent"
          ? { ...item, claim: "Unclaimed" }
          : item
      )
    })
  ).toThrow(/completion-marker absence/u)
})

it("rejects an authored Begin response that skips Executing", () => {
  const invalid = {
    ...deliveryFinalitySpineAuthoredCassette,
    story: deliveryFinalitySpineAuthoredCassette.story.map((item) =>
      item._tag === "PlannedAttemptExecutorWorkReported" && item.request === "Begin"
        ? {
            ...item,
            report: { _tag: "ExecutorWorkTerminal", attemptId: item.report.attemptId, result: { _tag: "Completed" } }
          }
        : item
    )
  }

  expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(invalid)).toThrow(
    /an authored Begin response must report ExecutorWorkExecuting/u
  )
})

it("accepts an active coordinator return whose diagnostic reason is outside the scenario claim", () => {
  expect(() =>
    Schema.decodeUnknownSync(AuthoredCassetteStoryItem)({
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActiveReasonUnasserted" }
    })
  ).not.toThrow()
})

it("does not carry a diagnostic reason in the reason-unasserted coordinator return", () => {
  const decoded = Schema.decodeUnknownSync(AuthoredCassetteStoryItem)({
    _tag: "CoordinatorActivationReturned",
    decision: { _tag: "RunMustRemainActiveReasonUnasserted" }
  })

  expect(decoded).toEqual({
    _tag: "CoordinatorActivationReturned",
    decision: { _tag: "RunMustRemainActiveReasonUnasserted" }
  })
})

it("accepts the exact promoted-completion-read hold and release chronology", () => {
  expect(promotedCompletionReadHoldClosureIssue(deliveryInvariantStoryAuthoredCassette.story)).toBeUndefined()
})

it("accepts the exact worktree-selection hold and release chronology", () => {
  expect(taskWorktreeSelectionHoldClosureIssue(deliveryInvariantStoryAuthoredCassette.story)).toBeUndefined()
})

it("keeps separator-containing exact hold identities distinct", () => {
  expect(taskWorktreeSelectionHoldKey("task:a:b" as TaskId, "attempt:c" as AttemptId)).not.toBe(
    taskWorktreeSelectionHoldKey("task:a" as TaskId, "b:attempt:c" as AttemptId)
  )
  expect(
    promotedCompletionReadHoldKey({
      promotedTaskId: "task:a:b" as TaskId,
      promotedAttemptId: "attempt:c" as AttemptId,
      releasedByTaskId: "task:d" as TaskId,
      releasedByAttemptId: "attempt:e" as AttemptId
    })
  ).not.toBe(
    promotedCompletionReadHoldKey({
      promotedTaskId: "task:a" as TaskId,
      promotedAttemptId: "b:attempt:c" as AttemptId,
      releasedByTaskId: "task:d" as TaskId,
      releasedByAttemptId: "attempt:e" as AttemptId
    })
  )
})

it("rejects an unreleased worktree-selection hold", () => {
  const story = deliveryInvariantStoryAuthoredCassette.story.filter(
    (item) => item._tag !== "CassetteReleasesHeldTaskWorktreeSelection"
  )

  expect(taskWorktreeSelectionHoldClosureIssue(story)).toMatch(/must be released before its exact/u)
})

it("rejects a worktree-selection release without an Applied promotion", () => {
  const story = deliveryInvariantStoryAuthoredCassette.story.map((item) =>
    item._tag === "TargetPromotionCompareAndSetReturned" && item.result._tag === "Applied"
      ? {
          ...item,
          result: { _tag: "RejectedExpectedHead" as const, observedHeadSha: "sha:not-applied" as GitCommitSha }
        }
      : item
  )

  expect(taskWorktreeSelectionHoldClosureIssue(story)).toMatch(/must immediately follow an Applied/u)
})

it("rejects a worktree-selection hold placed after its matching selection", () => {
  const story: ReadonlyArray<AuthoredCassetteStoryItemType> = deliveryInvariantStoryAuthoredCassette.story.flatMap(
    (item) =>
      item._tag === "CassetteHoldsTaskWorktreeSelectionBeforeTargetPromotion"
        ? [
            Schema.decodeUnknownSync(AuthoredCassetteStoryItem)({
              _tag: "DalphSelects",
              operation: { _tag: "ReconcileTaskWorktree", attemptId: item.attemptId, taskId: item.taskId }
            }),
            item
          ]
        : [item]
  )

  expect(taskWorktreeSelectionHoldClosureIssue(story)).toMatch(/must precede its first exact/u)
})

it("rejects a held worktree selection placed before its release", () => {
  const hold = deliveryInvariantStoryAuthoredCassette.story.find(
    (item) => item._tag === "CassetteHoldsTaskWorktreeSelectionBeforeTargetPromotion"
  )
  expect(hold?._tag).toBe("CassetteHoldsTaskWorktreeSelectionBeforeTargetPromotion")
  if (hold?._tag !== "CassetteHoldsTaskWorktreeSelectionBeforeTargetPromotion") return
  const selection = deliveryInvariantStoryAuthoredCassette.story.find(
    (item) =>
      item._tag === "DalphSelects" &&
      item.operation._tag === "ReconcileTaskWorktree" &&
      item.operation.taskId === hold.taskId &&
      item.operation.attemptId === hold.attemptId
  )
  expect(selection?._tag).toBe("DalphSelects")
  if (selection?._tag !== "DalphSelects" || selection.operation._tag !== "ReconcileTaskWorktree") return
  const withoutSelection = deliveryInvariantStoryAuthoredCassette.story.filter((item) => item !== selection)
  const releaseIndex = withoutSelection.findIndex((item) => item._tag === "CassetteReleasesHeldTaskWorktreeSelection")
  const story = [...withoutSelection.slice(0, releaseIndex), selection, ...withoutSelection.slice(releaseIndex)]

  expect(taskWorktreeSelectionHoldClosureIssue(story)).toMatch(/must be released before its exact/u)
})

it("rejects sequential reuse of one pre-armed worktree hold", () => {
  const hold = deliveryInvariantStoryAuthoredCassette.story.find(
    (item) => item._tag === "CassetteHoldsTaskWorktreeSelectionBeforeTargetPromotion"
  )
  const releaseIndex = deliveryInvariantStoryAuthoredCassette.story.findIndex(
    (item) => item._tag === "CassetteReleasesHeldTaskWorktreeSelection"
  )
  const promotion = deliveryInvariantStoryAuthoredCassette.story[releaseIndex - 1]
  const release = deliveryInvariantStoryAuthoredCassette.story[releaseIndex]
  expect(hold?._tag).toBe("CassetteHoldsTaskWorktreeSelectionBeforeTargetPromotion")
  expect(promotion?._tag).toBe("TargetPromotionCompareAndSetReturned")
  expect(release?._tag).toBe("CassetteReleasesHeldTaskWorktreeSelection")
  if (
    hold?._tag !== "CassetteHoldsTaskWorktreeSelectionBeforeTargetPromotion" ||
    promotion?._tag !== "TargetPromotionCompareAndSetReturned" ||
    release?._tag !== "CassetteReleasesHeldTaskWorktreeSelection"
  ) {
    return
  }
  const story = deliveryInvariantStoryAuthoredCassette.story.flatMap((item, index) =>
    index === releaseIndex ? [item, hold, promotion, release] : [item]
  )

  expect(taskWorktreeSelectionHoldClosureIssue(story)).toMatch(/is repeated/u)
})

it("rejects an unreleased promoted-completion-read hold", () => {
  const story = deliveryInvariantStoryAuthoredCassette.story.filter(
    (item) => item._tag !== "CassetteReleasesHeldPromotedTaskCompletionClaimRead"
  )

  expect(promotedCompletionReadHoldClosureIssue(story)).toMatch(/reaches terminal assertions unreleased/u)
})

it("rejects a promoted-completion-read release before the exact Begin response", () => {
  const story = deliveryInvariantStoryAuthoredCassette.story.flatMap((item) =>
    item._tag === "PlannedAttemptExecutorWorkReported" &&
    item.request === "Begin" &&
    item.report.attemptId === "attempt:X:0"
      ? []
      : [item]
  )

  expect(promotedCompletionReadHoldClosureIssue(story)).toMatch(
    /must immediately follow its exact executing Begin response/u
  )
})

it("rejects a promoted-completion-read release for the wrong attempt", () => {
  const story = deliveryInvariantStoryAuthoredCassette.story.map((item) =>
    item._tag === "CassetteReleasesHeldPromotedTaskCompletionClaimRead"
      ? { ...item, releasedByAttemptId: "attempt:X:wrong" }
      : item
  )

  expect(promotedCompletionReadHoldClosureIssue(story as typeof deliveryInvariantStoryAuthoredCassette.story)).toMatch(
    /has no matching hold/u
  )
})

it("rejects a promoted-completion hold whose Applied CAS belongs to another Integrator", () => {
  const story = deliveryInvariantStoryAuthoredCassette.story
  const holdIndex = story.findIndex(
    (item) => item._tag === "CassetteHoldsPromotedTaskCompletionClaimReadUntilTaskWorkBegins"
  )
  const integratorIndex = story.findIndex(
    (item, index) =>
      index > holdIndex && item._tag === "IntegratorRequestReceived" && item.correlation.plannedAttempt.taskId === "B"
  )
  const promotionIndex = story.findIndex(
    (item, index) => index > integratorIndex && item._tag === "TargetPromotionCompareAndSetReturned"
  )
  const foreignPromotion = story.find(
    (item, index) => index < integratorIndex && item._tag === "TargetPromotionCompareAndSetReturned"
  )
  expect(holdIndex).toBeGreaterThanOrEqual(0)
  expect(integratorIndex).toBeGreaterThan(holdIndex)
  expect(promotionIndex).toBeGreaterThan(integratorIndex)
  expect(foreignPromotion?._tag).toBe("TargetPromotionCompareAndSetReturned")
  if (promotionIndex < 0 || foreignPromotion?._tag !== "TargetPromotionCompareAndSetReturned") return

  const crossed = story.map((item, index) =>
    index === promotionIndex ? { ...item, request: foreignPromotion.request } : item
  ) as ReadonlyArray<AuthoredCassetteStoryItemType>
  expect(promotedCompletionReadHoldClosureIssue(crossed)).toMatch(/exact promotion request/u)
})

it("rejects any promoted-task completion-claim read before its pre-armed hold", () => {
  const story = deliveryInvariantStoryAuthoredCassette.story
  const holdIndex = story.findIndex(
    (item) => item._tag === "CassetteHoldsPromotedTaskCompletionClaimReadUntilTaskWorkBegins"
  )
  const hold = story[holdIndex]
  const laterMarkerRead = story.find(
    (item) =>
      item._tag === "CompletionClaimReadReturned" &&
      item.taskId ===
        (hold?._tag === "CassetteHoldsPromotedTaskCompletionClaimReadUntilTaskWorkBegins"
          ? hold.promotedTaskId
          : "B") &&
      item.claim !== "Active"
  )
  expect(holdIndex).toBeGreaterThanOrEqual(0)
  expect(laterMarkerRead?._tag).toBe("CompletionClaimReadReturned")
  if (holdIndex < 0 || laterMarkerRead?._tag !== "CompletionClaimReadReturned") return

  const earlyRead = [
    ...story.slice(0, holdIndex),
    laterMarkerRead,
    ...story.slice(holdIndex)
  ] as ReadonlyArray<AuthoredCassetteStoryItemType>
  expect(promotedCompletionReadHoldClosureIssue(earlyRead)).toMatch(/precedes its pre-armed hold marker/u)
})

it("rejects a sequential second promoted-completion hold for the same task", () => {
  const story = deliveryInvariantStoryAuthoredCassette.story
  const holdIndex = story.findIndex(
    (item) => item._tag === "CassetteHoldsPromotedTaskCompletionClaimReadUntilTaskWorkBegins"
  )
  const releaseIndex = story.findIndex(
    (item, index) => index > holdIndex && item._tag === "CassetteReleasesHeldPromotedTaskCompletionClaimRead"
  )
  const hold = story[holdIndex]
  expect(hold?._tag).toBe("CassetteHoldsPromotedTaskCompletionClaimReadUntilTaskWorkBegins")
  expect(releaseIndex).toBeGreaterThan(holdIndex)
  if (hold?._tag !== "CassetteHoldsPromotedTaskCompletionClaimReadUntilTaskWorkBegins" || releaseIndex < 0) return

  const repeated = [
    ...story.slice(0, releaseIndex + 1),
    hold,
    ...story.slice(releaseIndex + 1)
  ] as ReadonlyArray<AuthoredCassetteStoryItemType>
  expect(promotedCompletionReadHoldClosureIssue(repeated)).toMatch(/is repeated/u)
})

it("requires a worktree hold and release to carry the same exact promotion request", () => {
  const story = deliveryInvariantStoryAuthoredCassette.story
  const releaseIndex = story.findIndex((item) => item._tag === "CassetteReleasesHeldTaskWorktreeSelection")
  const release = story[releaseIndex]
  expect(release?._tag).toBe("CassetteReleasesHeldTaskWorktreeSelection")
  if (release?._tag !== "CassetteReleasesHeldTaskWorktreeSelection") return

  const mismatched = story.map((item, index) =>
    index === releaseIndex
      ? {
          ...item,
          promotionRequest: {
            ...release.promotionRequest,
            candidateCommit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as GitCommitSha
          }
        }
      : item
  ) as ReadonlyArray<AuthoredCassetteStoryItemType>
  expect(taskWorktreeSelectionHoldClosureIssue(mismatched)).toMatch(/must match its hold and predecessor/u)
})

it("rejects concurrent distinct Integrator correlations that alias one CAS request", () => {
  const story = deliveryInvariantStoryAuthoredCassette.story
  const integratorIndex = story.findIndex(
    (item) => item._tag === "IntegratorRequestReceived" && item.correlation.plannedAttempt.taskId === "B"
  )
  const observationIndex = story.findIndex(
    (item, index) =>
      index > integratorIndex && item._tag === "IntegratorGitObservationReturned" && item.observation._tag === "Commit"
  )
  const promotionIndex = story.findIndex(
    (item, index) => index > observationIndex && item._tag === "TargetPromotionCompareAndSetReturned"
  )
  const request = story[integratorIndex]
  const observation = story[observationIndex]
  const promotion = story[promotionIndex]
  expect(request?._tag).toBe("IntegratorRequestReceived")
  expect(observation?._tag).toBe("IntegratorGitObservationReturned")
  expect(promotion?._tag).toBe("TargetPromotionCompareAndSetReturned")
  if (
    request?._tag !== "IntegratorRequestReceived" ||
    observation?._tag !== "IntegratorGitObservationReturned" ||
    promotion?._tag !== "TargetPromotionCompareAndSetReturned"
  )
    return

  const aliasCorrelation = {
    ...request.correlation,
    plannedAttempt: {
      ...request.correlation.plannedAttempt,
      attemptId: "attempt:alias:0",
      branch: "refs/heads/dalph/attempt-alias-0",
      taskId: "Alias",
      worktree: "/dalph/cassettes/double-diamond/attempt-alias-0"
    }
  }
  const aliasItems = [
    { ...request, correlation: aliasCorrelation },
    {
      _tag: "IntegratorResultReturned" as const,
      result: { _tag: "PreparedCandidate" as const, candidateText: observation.candidateText }
    },
    observation
  ]
  const aliased = story.flatMap((item, index) =>
    index === promotionIndex ? [...aliasItems, item] : [item]
  ) as ReadonlyArray<AuthoredCassetteStoryItemType>

  expect(targetPromotionGitRequestAliasIssue(aliased)).toMatch(/aliases/u)
  expect(() =>
    Schema.decodeUnknownSync(AuthoredScenarioCassette)({ ...deliveryInvariantStoryAuthoredCassette, story: aliased })
  ).toThrow(/aliases/u)
})

it("does not report a sequential identical CAS request as an alias", () => {
  const story = deliveryInvariantStoryAuthoredCassette.story
  expect(targetPromotionGitRequestAliasIssue(story)).toBeUndefined()
})
