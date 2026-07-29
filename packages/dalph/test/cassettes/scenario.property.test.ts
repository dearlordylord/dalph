import { Effect } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import {
  projectRecordedCassette,
  runAuthoredScenarioCassette,
  verifyRecordedCassetteRoundTrip
} from "../../src/cassettes/index.js"

const taskIdsArbitrary = fc.uniqueArray(fc.stringMatching(/^[a-z][a-z0-9-]{0,5}$/), { maxLength: 4, minLength: 1 })

const generatedCassette = (unsortedTaskIds: ReadonlyArray<string>, suffix: string) => {
  const taskIds = [...unsortedTaskIds].sort()
  const activeTaskId = taskIds.at(-1) ?? "generated-active-task"
  const graph = {
    revision: `generated-revision-${suffix}`,
    tasks: taskIds.map((id, index) => ({
      id,
      lifecycle: { _tag: id === activeTaskId ? "Open" : "CompletedSuccessfully" },
      parentTaskId: null,
      prerequisiteIds: taskIds.slice(Math.max(0, index - 1), index)
    }))
  }
  const runId = `generated-cassette-${suffix}`
  const graphReturns = Array.from({ length: 3 }, () => ({ _tag: "TrackerGraphReadReturned", graph }))
  const specificationReturns = [
    {
      _tag: "TaskWorkSpecificationReadReturned",
      body: `Implement generated task ${activeTaskId}.`,
      taskId: activeTaskId,
      title: `Generated task ${activeTaskId}`
    }
  ]
  const correlation = { attemptId: `attempt:${activeTaskId}:0`, runId }
  const executorReports = [
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Running", correlation },
      request: "StartOrContinue"
    },
    {
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "Terminal", correlation, result: { _tag: "Completed" } },
      request: "StartOrContinue"
    }
  ]
  return {
    _tag: "AuthoredScenarioCassette",
    actorCommands: [
      {
        _tag: "RunCoordinator",
        baseSha: "2222222222222222222222222222222222222222",
        capacity: 1,
        claimOwner: "generated-owner",
        claimTokenPrefix: "generated-claim",
        executor: "executor:controlled-fake",
        runId,
        target: `generated-target-${suffix}`,
        worktreeRoot: "/dalph/generated-cassettes"
      }
    ],
    expectedDecisions: [
      { _tag: "ReadTrackerGraph", target: `generated-target-${suffix}` },
      { _tag: "ReadTrackerGraph", target: `generated-target-${suffix}` },
      { _tag: "AcquireTaskClaim", taskId: activeTaskId },
      { _tag: "ReadTrackerGraph", target: `generated-target-${suffix}` },
      { _tag: "ReadTaskWorkSpecification", taskId: activeTaskId },
      { _tag: "RecordTaskAttemptPlan", attemptId: `attempt:${activeTaskId}:0`, taskId: activeTaskId },
      { _tag: "ReconcileTaskWorktree", attemptId: `attempt:${activeTaskId}:0`, taskId: activeTaskId }
    ],
    expectedVisibleBehavior: {
      forbiddenJournalOccurrenceTags: ["ControlCommandRecorded"],
      journalHistory: "ValidWorkflowJournalHistory",
      plannedAttemptExecutorReports: executorReports.map(({ report }) => report)
    },
    name: `generated flat graph ${suffix}`,
    outsideOccurrences: [...graphReturns, ...specificationReturns, ...executorReports],
    schemaVersion: 1,
    startingFacts: {
      taskWorkSpecifications: specificationReturns.map(({ body, taskId, title }) => ({ body, taskId, title })),
      trackerGraph: graph
    }
  }
}

it("generated valid authored cassettes produce valid journals and checkpoint-equivalent recordings", async () => {
  await fc.assert(
    fc.asyncProperty(taskIdsArbitrary, fc.stringMatching(/^[a-z][a-z0-9]{0,5}$/), async (taskIds, suffix) => {
      await Effect.runPromise(
        Effect.gen(function* () {
          const run = yield* runAuthoredScenarioCassette(generatedCassette(taskIds, suffix))
          const recorded = yield* projectRecordedCassette(run.records)
          const checkpoints = verifyRecordedCassetteRoundTrip(run.records, recorded)

          expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
          expect(checkpoints).toHaveLength(run.records.length)
          expect(
            checkpoints.every(
              ({ decisionsEquivalent, stateEquivalent, workflowHistoryEquivalent }) =>
                decisionsEquivalent && stateEquivalent && workflowHistoryEquivalent
            )
          ).toBe(true)
        })
      )
    }),
    { numRuns: 10 }
  )
})
