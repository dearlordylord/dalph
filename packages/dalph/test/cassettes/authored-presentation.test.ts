import { AttemptId, TaskId } from "@dalph/contracts"
import { IntegratorCandidateText, IntegratorNotPreparedDetail } from "@dalph/orchestrator"
import { describe, expect, it } from "vitest"
import { AuthoredCassetteStoryItem } from "../../src/cassettes/authored-domain.js"
import {
  renderAuthoredStoryItemLandmark,
  renderAuthoredStoryItemLyric
} from "../../src/cassettes/authored-presentation.js"
import {
  contractedCapacityRetainsTwoAttemptsAuthoredCassette,
  maintainedAuthoredCassetteCatalog
} from "../../src/cassettes/catalog.js"

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
        duringAttemptId: AttemptId.make("attempt:A:0"),
        outcome: { _tag: "Applied" },
        subject: { _tag: "Task", taskId: TaskId.make("A") }
      }),
      AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirectionWhileExecutorRequestInFlight.make({
        direction: "Pause",
        duringAttemptId: AttemptId.make("attempt:A:0"),
        outcome: { _tag: "Applied" },
        subject: { _tag: "Run" }
      }),
      AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported.make({
        report: { _tag: "ExecutorWorkExecuting", attemptId: AttemptId.make("attempt:A:0") },
        request: "Begin"
      }),
      AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported.make({
        report: { _tag: "ExecutorWorkSafelySuspended", attemptId: AttemptId.make("attempt:A:0") },
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
      "Attempt attempt:A:0 reported ExecutorWorkExecuting",
      "Attempt attempt:A:0 reported ExecutorWorkSafelySuspended; its held position can now be released",
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

  it("renders control, Integrator, and protocol variants at the presentation boundary", () => {
    const unpause = Object.values(maintainedAuthoredCassetteCatalog)
      .flatMap(({ story }) => story)
      .find(
        (
          item
        ): item is typeof AuthoredCassetteStoryItem.cases.OperatorUnpausesWhileExecutorRequestInFlightAfterQueuedPauseWaiting.Type =>
          item._tag === "OperatorUnpausesWhileExecutorRequestInFlightAfterQueuedPauseWaiting"
      )
    if (unpause === undefined) return expect.fail("maintained catalog lacks an in-flight Unpause story item")

    const beforeAdmissionTask =
      AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirectionBeforeDeliveryActionAdmission.make({
        direction: "Pause",
        subject: { _tag: "Task", taskId: TaskId.make("A") }
      })
    const beforeAdmissionRun =
      AuthoredCassetteStoryItem.cases.OperatorAppliesControlDirectionBeforeDeliveryActionAdmission.make({
        direction: "Unpause",
        subject: { _tag: "Run" }
      })
    const cancellationWhileInFlight =
      AuthoredCassetteStoryItem.cases.OperatorAppliesRunCancellationWhileExecutorRequestInFlight.make({
        duringAttemptId: AttemptId.make("attempt:A:0")
      })
    const notPrepared = AuthoredCassetteStoryItem.cases.IntegratorResultReturned.make({
      result: {
        _tag: "NotPrepared",
        detail: IntegratorNotPreparedDetail.make("the provider did not prepare a candidate")
      }
    })
    const prepared = AuthoredCassetteStoryItem.cases.IntegratorResultReturned.make({
      result: { _tag: "PreparedCandidate", candidateText: IntegratorCandidateText.make("refs/heads/candidate") }
    })
    const failedGit = AuthoredCassetteStoryItem.cases.IntegratorGitObservationFailed.make({
      candidateText: IntegratorCandidateText.make("refs/heads/candidate"),
      detail: "candidate read unavailable"
    })
    const expected = AuthoredCassetteStoryItem.cases.ExpectedBehavior.make({
      orchestration: null,
      protocol: [
        { _tag: "RunCancellationApplied" },
        {
          _tag: "PlannedAttemptReplaced",
          priorAttemptId: AttemptId.make("attempt:A:0"),
          successorAttemptId: AttemptId.make("attempt:A:1"),
          taskId: TaskId.make("A")
        }
      ],
      taskWork: { absences: [], results: [] }
    })

    expect(renderAuthoredStoryItemLyric(beforeAdmissionTask)).toContain("task A before delivery-action admission")
    expect(renderAuthoredStoryItemLyric(beforeAdmissionRun)).toContain("the Run before delivery-action admission")
    expect(renderAuthoredStoryItemLyric(cancellationWhileInFlight)).toContain("whole-Run cancellation")
    expect(renderAuthoredStoryItemLyric(notPrepared)).toContain("NotPrepared: the provider did not prepare a candidate")
    expect(renderAuthoredStoryItemLyric(prepared)).toContain("PreparedCandidate refs/heads/candidate")
    expect(renderAuthoredStoryItemLyric(failedGit)).toBe(
      "Git cannot observe reported candidate refs/heads/candidate: candidate read unavailable"
    )
    expect(renderAuthoredStoryItemLyric(AuthoredCassetteStoryItem.cases.OperatorAppliesRunCancellation.make({}))).toBe(
      "Operator applies whole-Run cancellation."
    )
    expect(renderAuthoredStoryItemLyric(expected)).toContain("whole-Run cancellation exactly once")
    expect(renderAuthoredStoryItemLyric(expected)).toContain(
      "atomically replace attempt attempt:A:0 with clean attempt attempt:A:1"
    )
    expect(renderAuthoredStoryItemLyric({ ...unpause, subject: { _tag: "Run" } })).toContain("unpauses the Run")
    expect(renderAuthoredStoryItemLyric({ ...unpause, subject: { _tag: "Task", taskId: TaskId.make("A") } })).toContain(
      "unpauses task A"
    )
    expect(
      renderAuthoredStoryItemLyric(
        AuthoredCassetteStoryItem.cases.OperatorSubscribesToPauseObservation.make({ subject: { _tag: "Run" } })
      )
    ).toContain("subscribes to Pause progress for the Run")
    expect(
      renderAuthoredStoryItemLyric(
        AuthoredCassetteStoryItem.cases.OperatorSubscribesToPauseObservation.make({
          subject: { _tag: "Task", taskId: TaskId.make("A") }
        })
      )
    ).toContain("subscribes to Pause progress for task A")
  })
})
