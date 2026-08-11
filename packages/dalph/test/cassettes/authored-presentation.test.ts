import { AttemptId, TaskId } from "@dalph/contracts"
import { describe, expect, it } from "vitest"
import { AuthoredCassetteStoryItem } from "../../src/cassettes/authored-domain.js"
import {
  renderAuthoredStoryItemLandmark,
  renderAuthoredStoryItemLyric
} from "../../src/cassettes/authored-presentation.js"
import { contractedCapacityRetainsTwoAttemptsAuthoredCassette } from "../../src/cassettes/catalog.js"

describe("authored delivery landmarks", () => {
  const graph = contractedCapacityRetainsTwoAttemptsAuthoredCassette.startingFacts.trackerGraph

  it("projects every landmark kind from typed authored boundary occurrences", () => {
    const landmarks = [
      AuthoredCassetteStoryItem.cases.TrackerGraphReadReturned.make({ graph }),
      AuthoredCassetteStoryItem.cases.TrackerGraphReadReturned.make({ graph: { ...graph, tasks: [] } }),
      AuthoredCassetteStoryItem.cases.RunActivationFinalTrackerGraphReadReturned.make({ graph }),
      AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirection.make({
        direction: "Pause",
        subject: { _tag: "Run" }
      }),
      AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirection.make({
        direction: "Unpause",
        subject: { _tag: "Task", taskId: TaskId.make("A") }
      }),
      AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirectionWhileExecutorRequestInFlight.make({
        direction: "Unpause",
        subject: { _tag: "Task", taskId: TaskId.make("A") }
      }),
      AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirectionWhileExecutorRequestInFlight.make({
        direction: "Pause",
        subject: { _tag: "Run" }
      }),
      AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported.make({
        report: { _tag: "Running", attemptId: AttemptId.make("attempt:A:0") },
        request: "StartOrContinue"
      }),
      AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported.make({
        report: { _tag: "SafelySuspended", attemptId: AttemptId.make("attempt:A:0") },
        request: "Suspend"
      }),
      AuthoredCassetteStoryItem.cases.CoordinatorProcessDies.make({}),
      AuthoredCassetteStoryItem.cases.TrackerGraphReadFailed.make({ reason: "IncompleteSnapshot" })
    ].map(renderAuthoredStoryItemLandmark)

    expect(landmarks).toEqual([
      expect.stringMatching(/^Tracker returned graph .+: task A /u),
      expect.stringMatching(/^Tracker returned graph .+ with no tasks$/u),
      expect.stringMatching(/^Activation-final tracker read returned graph .+: task A /u),
      "Operator paused the Run",
      "Operator unpaused task A",
      "Operator unpaused task A while its executor request was in flight",
      "Operator paused the Run while its executor request was in flight",
      "Attempt attempt:A:0 reported Running",
      "Attempt attempt:A:0 reported SafelySuspended; its held position can now be released",
      "The coordinator process died; the next activation reconstructs accepted journal history",
      null
    ])
  })

  it("explains the tracker's classification of an ambiguous completion request", () => {
    const item = AuthoredCassetteStoryItem.cases.CompletionTaskRequestLookupReturned.make({
      outcome: "NotApplied",
      taskId: TaskId.make("B")
    })

    expect(renderAuthoredStoryItemLyric(item)).toBe(
      "The task tracker classifies the exact completion request for task B as NotApplied."
    )
  })
})
