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
const aSpecificationReturned = {
  _tag: "TaskWorkSpecificationReadReturned",
  body: "A body",
  taskId: "A",
  title: "A title"
} as const
const aCurrentClaimReturned = { _tag: "TaskClaimCurrentReadReturned", taskId: "A" } as const
const concurrentNode = (role: string, predecessorRoles: ReadonlyArray<string>, interaction: unknown) => ({
  interaction,
  predecessorRoles,
  role
})
const concurrentGroup = (members: ReadonlyArray<unknown>) => ({ _tag: "ConcurrentInteractionGroup", members })

it("accepts the four exact interaction forms in a causal concurrent group", () => {
  expect(() =>
    Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(
      concurrentGroup([
        concurrentNode("W_B", [], bWorktreeSelection),
        concurrentNode("W_C", [], cWorktreeSelection),
        concurrentNode("X_A", [], aBeginExecuting),
        concurrentNode("T_A", ["W_C"], aSpecificationReturned),
        concurrentNode("R_A", ["T_A"], aCurrentClaimReturned),
        concurrentNode("X_B", ["W_B"], {
          ...aBeginExecuting,
          report: { ...aBeginExecuting.report, attemptId: "attempt:B:1" }
        })
      ])
    )
  ).not.toThrow()
})

it("rejects invalid roles keys edges and member tags in a causal concurrent interaction group", () => {
  const invalidGroups = [
    concurrentGroup([]),
    concurrentGroup([concurrentNode("", [], bWorktreeSelection)]),
    concurrentGroup([concurrentNode("W_B", [], bWorktreeSelection), concurrentNode("W_B", [], cWorktreeSelection)]),
    concurrentGroup([
      concurrentNode("W_B", [], bWorktreeSelection),
      concurrentNode("W_B_again", [], bWorktreeSelection)
    ]),
    concurrentGroup([
      concurrentNode("X_A", [], aBeginExecuting),
      concurrentNode("X_A_again", [], { ...aBeginExecuting, report: { ...aBeginExecuting.report } })
    ]),
    concurrentGroup([
      concurrentNode("root", [], cWorktreeSelection),
      concurrentNode("W_B", ["root", "root"], bWorktreeSelection)
    ]),
    concurrentGroup([concurrentNode("W_B", ["missing"], bWorktreeSelection)]),
    concurrentGroup([concurrentNode("W_B", ["W_B"], bWorktreeSelection)]),
    concurrentGroup([
      concurrentNode("W_B", ["X_B"], bWorktreeSelection),
      concurrentNode("X_B", ["W_B"], aBeginExecuting)
    ]),
    concurrentGroup([
      concurrentNode("W_B", ["X_A"], bWorktreeSelection),
      concurrentNode("X_B", ["W_B"], cWorktreeSelection),
      concurrentNode("X_A", ["X_B"], aBeginExecuting)
    ])
  ]

  for (const group of invalidGroups) {
    expect(() => Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(group)).toThrow()
  }
})

it("rejects ambiguous specification and claim keys and every unsupported grouped interaction", () => {
  const duplicateKeyGroups = [
    concurrentGroup([
      concurrentNode("T_A_1", [], aSpecificationReturned),
      concurrentNode("T_A_2", [], { ...aSpecificationReturned, body: "Different body", title: "Different title" })
    ]),
    concurrentGroup([
      concurrentNode("R_A_1", [], aCurrentClaimReturned),
      concurrentNode("R_A_2", [], { ...aCurrentClaimReturned })
    ])
  ]
  for (const group of duplicateKeyGroups) {
    expect(() => Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(group)).toThrow(
      /each concurrent interaction claim key must be unique/u
    )
  }

  const unsupportedMembers = [
    { _tag: "TaskClaimReadReturned", observation: { _tag: "UnclaimedTask", taskId: "A" } },
    { _tag: "TaskClaimReadFailed", reason: "Unreadable", taskId: "A" },
    {
      _tag: "PlannedAttemptExecutorProjectionReturned",
      report: { _tag: "ExecutorWorkExecuting", attemptId: "attempt:A:0" }
    },
    {
      _tag: "ConcurrentTrackerReadBatch",
      members: [
        {
          causal: { occurrenceRole: "read-A", predecessorRoles: [] },
          operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" },
          result: aSpecificationReturned
        }
      ]
    },
    concurrentGroup([concurrentNode("nested", [], bWorktreeSelection)])
  ]
  for (const member of unsupportedMembers) {
    expect(() => Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(member)).not.toThrow()
    expect(() =>
      Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(concurrentGroup([concurrentNode("unsupported", [], member)]))
    ).toThrow()
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
    expect(() =>
      Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(concurrentGroup([concurrentNode("closed", [], item)]))
    ).toThrow()
  }
})

it("rejects causal selections and non-Begin-Executing reports inside a concurrent interaction group", () => {
  const invalidMembers = [
    { ...bWorktreeSelection, causal: { occurrenceRole: "B-worktree", predecessorRoles: [] } },
    { ...bWorktreeSelection, causalAnchor: { occurrenceRole: "B-worktree" } },
    { ...aBeginExecuting, request: "Resume" },
    { ...aBeginExecuting, report: { _tag: "ExecutorWorkSafelySuspended", attemptId: "attempt:A:0" } },
    { _tag: "CoordinatorProcessDies" }
  ]

  for (const member of invalidMembers) {
    expect(() =>
      Schema.decodeUnknownSync(AuthoredCassetteStoryItem)(concurrentGroup([concurrentNode("invalid", [], member)]))
    ).toThrow()
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
        concurrentNode("X_A", [], {
          _tag: "PlannedAttemptExecutorWorkReported",
          report: { _tag: "ExecutorWorkTerminal", attemptId: "attempt:A:0", result: { _tag: "Completed" } },
          request: "Begin"
        })
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
