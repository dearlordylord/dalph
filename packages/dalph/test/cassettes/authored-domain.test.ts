import { Schema } from "effect"
import { expect, it } from "vitest"
import { AuthoredCassetteStoryItem, AuthoredScenarioCassette } from "../../src/cassettes/authored-domain.js"
import {
  activeWorkF2SafelySuspendsAuthoredCassette,
  deliveryFinalitySpineAuthoredCassette
} from "../../src/cassettes/catalog.js"

const bWorktreeSelection = {
  _tag: "DalphSelects",
  operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:B:1", taskId: "B" }
} as const
const cWorktreeSelection = {
  _tag: "DalphSelects",
  operation: { _tag: "ReconcileTaskWorktree", attemptId: "attempt:C:2", taskId: "C" }
} as const
const aBeginExecuting = {
  _tag: "PlannedAttemptExecutorWorkReported",
  report: { _tag: "ExecutorWorkExecuting", attemptId: "attempt:A:0" },
  request: "Begin"
} as const
const concurrentGroup = (members: ReadonlyArray<unknown>) => ({ _tag: "ConcurrentInteractionGroup", members })

it("accepts only noncausal selections and Begin Executing reports in a concurrent interaction group", () => {
  expect(() =>
    Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(
      concurrentGroup([bWorktreeSelection, cWorktreeSelection, aBeginExecuting])
    )
  ).not.toThrow()
})

it("rejects empty duplicate and ambiguous concurrent interaction groups", () => {
  const invalidGroups = [
    concurrentGroup([]),
    concurrentGroup([bWorktreeSelection, bWorktreeSelection]),
    concurrentGroup([aBeginExecuting, { ...aBeginExecuting, report: { ...aBeginExecuting.report } }])
  ]

  for (const group of invalidGroups) {
    expect(() => Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(group)).toThrow()
  }
})

it("rejects valid terminal lifecycle control and result items as concurrent interaction members", () => {
  const closedLanguageExclusions = [
    { _tag: "ExpectedBehavior", orchestration: null, protocol: null, taskWork: { absences: [], results: [] } },
    { _tag: "CoordinatorProcessDies" },
    { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 1 } },
    {
      _tag: "IntegratorResultReturned",
      result: { _tag: "PreparedCandidate", candidateText: "candidate:closed-language-control" }
    }
  ]

  for (const item of closedLanguageExclusions) {
    expect(() => Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(item)).not.toThrow()
    expect(() => Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(concurrentGroup([item]))).toThrow()
  }
})

it("rejects causal selections and non-Begin-Executing reports inside a concurrent interaction group", () => {
  const invalidMembers = [
    { ...bWorktreeSelection, causal: { occurrenceRole: "B-worktree", predecessorRoles: [] } },
    { ...bWorktreeSelection, causalAnchor: { occurrenceRole: "B-worktree" } },
    { ...aBeginExecuting, request: "Resume" },
    { ...aBeginExecuting, report: { _tag: "ExecutorWorkSafelySuspended", attemptId: "attempt:A:0" } },
    { _tag: "CoordinatorProcessDies" },
    { _tag: "ConcurrentInteractionGroup", members: [bWorktreeSelection] }
  ]

  for (const member of invalidMembers) {
    expect(() => Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(concurrentGroup([member]))).toThrow()
  }
})

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
  expect(() =>
    Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(
      concurrentGroup([
        {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "ExecutorWorkTerminal", attemptId: "attempt:A:0", result: { _tag: "Completed" } },
          request: "Begin"
        }
      ])
    )
  ).toThrow()
})

it("requires an explicit process lifecycle for reactivation-owner inputs", () => {
  const { processLifecycle: _processLifecycle, ...withoutLifecycle } = activeWorkF2SafelySuspendsAuthoredCassette

  expect(() => Schema.decodeUnknownSync(AuthoredScenarioCassette)(withoutLifecycle)).toThrow(
    /reactivation-owner inputs require one explicit authored process lifecycle/u
  )
  expect(activeWorkF2SafelySuspendsAuthoredCassette.processLifecycle).toEqual({
    _tag: "CurrentFirstReactivationAfterProcessDeath"
  })
})
