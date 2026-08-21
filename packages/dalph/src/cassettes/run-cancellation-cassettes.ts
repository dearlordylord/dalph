import { Option, Schema } from "effect"
import { AuthoredScenarioCassette } from "./authored.js"
import { AuthoredCassetteStoryItem as AuthoredCassetteStoryItemSchema } from "./authored-domain.js"
import type { AuthoredCassetteStoryItem } from "./authored-domain.js"
import { deliveryFinalitySpineAuthoredCassette, singletonTaskCompletesAuthoredCassette } from "./catalog.js"

const decodeStoryItem = Schema.decodeUnknownSync(AuthoredCassetteStoryItemSchema)
const lastStoryItemOffset = -1
const missingStoryItemIndex = -1

/**
 * Alice cancels an idle Run after its first complete graph read.  The graph is
 * deliberately not all-successful so the fresh post-cancellation read proves
 * the `Cancelled` disposition rather than allowing `Completed` to win.
 */
export const idleRunCancellationAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
  _tag: "AuthoredScenarioCassette",
  name: "Alice cancels an idle Run after the durable direction and fresh graph read",
  schemaVersion: 1,
  startingFacts: {
    executorWork: "NoPriorReport",
    journal: "Empty",
    taskClaims: [],
    taskWorkSpecifications: [],
    trackerGraph: {
      revision: "cancel-idle-before-success",
      rootTaskId: "A",
      tasks: [
        { id: "A", lifecycle: { _tag: "TerminalWithoutSuccess" }, parentTaskId: null, prerequisiteIds: [] },
        { id: "B", lifecycle: { _tag: "Open" }, parentTaskId: "A", prerequisiteIds: ["A"] }
      ]
    },
    worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
  },
  story: [
    { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 1 } },
    {
      _tag: "RunCoordinator",
      baseSha: "1111111111111111111111111111111111111111",
      claimOwner: "cancel-idle-owner",
      claimTokenPrefix: "cancel-idle-claim",
      executor: "executor:cancel-idle",
      integrationTarget: { repository: "/dalph/cassettes/cancel-idle.git", ref: "refs/heads/master" },
      target: "cancel-idle-target",
      worktreeRoot: "/dalph/cassettes/cancel-idle"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cancel-idle-target" } },
    {
      _tag: "TrackerGraphReadReturned",
      graph: {
        revision: "cancel-idle-before-success",
        rootTaskId: "A",
        tasks: [
          { id: "A", lifecycle: { _tag: "TerminalWithoutSuccess" }, parentTaskId: null, prerequisiteIds: [] },
          { id: "B", lifecycle: { _tag: "Open" }, parentTaskId: "A", prerequisiteIds: ["A"] }
        ]
      }
    },
    { _tag: "OperatorAppliesRunCancellation" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cancel-idle-target" } },
    {
      _tag: "TrackerGraphReadReturned",
      graph: {
        revision: "cancel-idle-before-success",
        rootTaskId: "A",
        tasks: [
          { id: "A", lifecycle: { _tag: "TerminalWithoutSuccess" }, parentTaskId: null, prerequisiteIds: [] },
          { id: "B", lifecycle: { _tag: "Open" }, parentTaskId: "A", prerequisiteIds: ["A"] }
        ]
      }
    },
    { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMayTerminate" } },
    {
      _tag: "ExpectedBehavior",
      orchestration: null,
      protocol: [{ _tag: "RunCancellationApplied" }],
      taskWork: {
        absences: [
          { _tag: "NoPlannedWorkUndertakenForTask", taskId: "A" },
          { _tag: "NoPlannedWorkUndertakenForTask", taskId: "B" }
        ],
        results: []
      }
    }
  ]
})

const singletonRunningExecutorReportAt = singletonTaskCompletesAuthoredCassette.story.findIndex(
  (item) => item._tag === "PlannedAttemptExecutorWorkReported" && item.report._tag === "Running"
)

const singletonRunningPrefix = singletonTaskCompletesAuthoredCassette.story.slice(0, singletonRunningExecutorReportAt)

/**
 * Alice cancels while A's exact executor attempt is still running.  The
 * authored chronology continues through the real suspend, cancellation
 * relinquishment, focused claim read/release, and fresh final graph read.
 */
export const runningAttemptRunCancellationAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
  ...singletonTaskCompletesAuthoredCassette,
  name: "Alice cancels while the exact executor attempt is running",
  story: [
    ...singletonRunningPrefix,
    { _tag: "OperatorAppliesRunCancellationWhileExecutorRequestInFlight", duringAttemptId: "attempt:A:0" },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", attemptId: "attempt:A:0" },
      request: "StartOrContinue"
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "SafelySuspended", attemptId: "attempt:A:0" },
      request: "Suspend"
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
    { _tag: "DalphSelects", operation: { _tag: "ReleaseTaskClaim", taskId: "A" } },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    { _tag: "TrackerGraphReadReturned", graph: singletonTaskCompletesAuthoredCassette.startingFacts.trackerGraph },
    { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMayTerminate" } },
    { _tag: "ExpectedBehavior", orchestration: null, protocol: null, taskWork: { absences: [], results: [] } }
  ]
})

/** The same running-attempt cancellation proves that a foreign claim is observed and never released by Dalph. */
export const runningAttemptRunCancellationForeignClaimAuthoredCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  ...runningAttemptRunCancellationAuthoredCassette,
  name: "Alice cancels a running exact attempt whose claim is already foreign",
  story: runningAttemptRunCancellationAuthoredCassette.story.flatMap(
    (item): ReadonlyArray<AuthoredCassetteStoryItem> => {
      if (item._tag === "TaskClaimCurrentReadReturned") {
        return [
          decodeStoryItem({
            _tag: "TaskClaimReadReturned" as const,
            observation: {
              _tag: "ActiveTaskClaim" as const,
              operationId: "foreign-operation",
              owner: "foreign-owner",
              taskId: item.taskId,
              token: "foreign-token"
            }
          })
        ]
      }
      if (item._tag === "DalphSelects" && item.operation._tag === "ReleaseTaskClaim") return []
      return [item]
    }
  )
})

const deliveryFinalityAcquireBAt = deliveryFinalitySpineAuthoredCassette.story.findIndex(
  (item) => item._tag === "DalphSelects" && item.operation._tag === "AcquireTaskClaim" && item.operation.taskId === "B"
)
const deliveryFinalityExpectedBehavior = Option.getOrThrow(
  Option.fromUndefinedOr(deliveryFinalitySpineAuthoredCassette.story.at(lastStoryItemOffset)).pipe(
    Option.filter(
      (item): item is Extract<AuthoredCassetteStoryItem, { readonly _tag: "ExpectedBehavior" }> =>
        item._tag === "ExpectedBehavior"
    )
  )
)
const deliveryFinalityAcquireBStoryPosition = Option.getOrThrow(
  Option.some(deliveryFinalityAcquireBAt).pipe(Option.filter((index) => index !== missingStoryItemIndex))
)

/**
 * Alice cancels after A's admitted integration compare-and-set.  The existing
 * completion-finality tail settles A and releases its exact completion claim;
 * the fresh graph still leaves B open, so cancellation terminates the Run
 * without acquiring B or replacing A's integration.
 */
export const integrationRunCancellationAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
  ...deliveryFinalitySpineAuthoredCassette,
  name: "Alice cancels while A's admitted integration has settled",
  story: [
    ...deliveryFinalitySpineAuthoredCassette.story
      .slice(0, deliveryFinalityAcquireBStoryPosition)
      .flatMap((item) =>
        item._tag === "CompletionClaimDeletionApplied" ? [item, { _tag: "OperatorAppliesRunCancellation" }] : [item]
      ),
    { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMayTerminate" } },
    {
      ...deliveryFinalityExpectedBehavior,
      orchestration:
        deliveryFinalityExpectedBehavior.orchestration === null
          ? null
          : deliveryFinalityExpectedBehavior.orchestration.filter(
              (evidence) => !("attemptId" in evidence && evidence.attemptId === "attempt:B:0")
            ),
      taskWork: {
        ...deliveryFinalityExpectedBehavior.taskWork,
        results: deliveryFinalityExpectedBehavior.taskWork.results.filter((result) => result.taskId !== "B")
      }
    }
  ]
})
