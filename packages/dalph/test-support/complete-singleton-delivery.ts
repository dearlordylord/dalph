import { Schema } from "effect"
import { AuthoredScenarioCassette, maintainedAuthoredCassetteCatalog } from "../src/cassettes/index.js"

export const completeSingletonDeliveryCassette = (() => {
  const promoted = maintainedAuthoredCassetteCatalog.targetPromotionSuccess
  const completedGraph = {
    revision: "authored-finality-success",
    rootTaskId: "A",
    tasks: [{ id: "A", lifecycle: { _tag: "CompletedSuccessfully" }, parentTaskId: null, prerequisiteIds: [] }]
  } as const
  const settledGraph = { ...completedGraph, revision: "authored-finality-settled" } as const
  return Schema.decodeUnknownSync(AuthoredScenarioCassette)({
    ...promoted,
    startingFacts: {
      ...promoted.startingFacts,
      trackerGraph: { ...promoted.startingFacts.trackerGraph, rootTaskId: "A" }
    },
    story: promoted.story.flatMap(
      (item): ReadonlyArray<unknown> =>
        item._tag !== "ExpectedBehavior"
          ? [item._tag === "TrackerGraphReadReturned" ? { ...item, graph: { ...item.graph, rootTaskId: "A" } } : item]
          : [
              { _tag: "CompletionClaimReadReturned", claim: "Active", taskId: "A" },
              { _tag: "CompletionClaimReplacementApplied", taskId: "A" },
              {
                _tag: "CompletionTaskFocusedReadReturned",
                lifecycle: "Open",
                taskId: "A",
                unfinishedPrerequisiteTaskIds: []
              },
              {
                _tag: "TargetPromotionGitReadReturned",
                candidateCommit: "cccccccccccccccccccccccccccccccccccccccc",
                observation: { _tag: "CandidateCurrent", currentHeadSha: "cccccccccccccccccccccccccccccccccccccccc" },
                repository: "/dalph/cassettes/integration.git"
              },
              { _tag: "CompletionTaskRequestReturned", outcome: "Acknowledged", taskId: "A" },
              {
                _tag: "CompletionTaskFocusedReadReturned",
                lifecycle: "CompletedSuccessfully",
                taskId: "A",
                unfinishedPrerequisiteTaskIds: []
              },
              { _tag: "CompletionClaimReadReturned", claim: "CompletionMarker", taskId: "A" },
              { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
              { _tag: "DalphSelects", operation: { _tag: "ReleaseTaskClaim", taskId: "A" } },
              { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
              { _tag: "CompletionClaimReadReturned", claim: "CompletionMarker", taskId: "A" },
              { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
              { _tag: "CompletionClaimDeletionApplied", taskId: "A" },
              { _tag: "CompletionClaimReadReturned", claim: "CompletionMarkerAbsent", taskId: "A" },
              { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
              {
                _tag: "CoordinatorActivationReturned",
                decision: { _tag: "RunMustRemainActive", reason: "TrackerTargetUnsettled" }
              },
              { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
              { _tag: "TrackerGraphReadReturned", graph: completedGraph },
              { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
              { _tag: "TrackerGraphReadReturned", graph: settledGraph },
              { _tag: "CoordinatorActivationReturned", decision: { _tag: "RunMayTerminate" } },
              item
            ]
    )
  })
})()
