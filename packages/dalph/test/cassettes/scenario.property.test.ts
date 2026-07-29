import { Effect } from "effect"
import * as fc from "fast-check"
import { expect, it } from "vitest"
import { TaskId } from "@dalph/contracts"
import { makeTaskWorkSpecification } from "@dalph/orchestrator"
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
  const baseSha = "2222222222222222222222222222222222222222"
  const target = `generated-target-${suffix}`
  const resourceSegment = `attempt-${encodeURIComponent(activeTaskId)}-0`
  const branch = `refs/heads/dalph/${resourceSegment}`
  const worktree = `/dalph/generated-cassettes/${resourceSegment}`
  const graphReturns = Array.from({ length: 3 }, () => ({ _tag: "TrackerGraphReadReturned", graph }))
  const specification = {
    _tag: "TaskWorkSpecificationReadReturned",
    body: `Implement generated task ${activeTaskId}.`,
    taskId: activeTaskId,
    title: `Generated task ${activeTaskId}`
  }
  const specificationReturns = [specification]
  const taskRevision = makeTaskWorkSpecification({
    ...specification,
    taskId: TaskId.make(specification.taskId)
  }).fingerprint
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
        baseSha,
        capacity: 1,
        claimOwner: "generated-owner",
        claimTokenPrefix: "generated-claim",
        executor: "executor:controlled-fake",
        runId,
        target,
        worktreeRoot: "/dalph/generated-cassettes"
      }
    ],
    expectedDecisions: [
      { _tag: "ReadTrackerGraph", target },
      { _tag: "ReadTrackerGraph", target },
      { _tag: "AcquireTaskClaim", taskId: activeTaskId },
      { _tag: "ReadTrackerGraph", target },
      { _tag: "ReadTaskWorkSpecification", taskId: activeTaskId },
      { _tag: "RecordTaskAttemptPlan", attemptId: `attempt:${activeTaskId}:0`, taskId: activeTaskId },
      { _tag: "ReconcileTaskWorktree", attemptId: `attempt:${activeTaskId}:0`, taskId: activeTaskId }
    ],
    expectedOutcomes: [
      { _tag: "DalphObservesTaskTrackerGraph", graph, observationCount: 3, target },
      { _tag: "DalphClaimsTask", owner: "generated-owner", taskId: activeTaskId },
      {
        _tag: "DalphRecordsTaskAttemptPlan",
        attemptId: correlation.attemptId,
        baseSha,
        branch,
        executor: "executor:controlled-fake",
        runId,
        taskId: activeTaskId,
        taskRevision,
        worktree
      },
      {
        _tag: "GitShowsWorktreeReadyForAttempt",
        attemptId: correlation.attemptId,
        proof: { _tag: "PlannedWorktreeReady", baseSha, branch, headSha: baseSha, worktree },
        taskId: activeTaskId
      },
      {
        _tag: "DalphRecordsExecutorReportsForAttempt",
        attemptId: correlation.attemptId,
        reports: executorReports.map(({ report }) => report)
      },
      { _tag: "DalphReconstructsValidWorkflowJournalHistory" }
    ],
    forbiddenOutcomes: [
      { _tag: "DalphMustNotRecordControlCommand" },
      { _tag: "DalphMustNotClaimAnyOtherTask", allowedTaskIds: [activeTaskId] },
      { _tag: "DalphMustNotRecordAnyOtherTaskAttemptPlan", allowedAttemptIds: [correlation.attemptId] },
      { _tag: "DalphMustNotReconcileAnyOtherAttemptWorktree", allowedAttemptIds: [correlation.attemptId] },
      {
        _tag: "DalphMustNotAssumeExecutorWorkResponsibilityForAnyOtherAttempt",
        allowedAttemptIds: [correlation.attemptId]
      },
      { _tag: "DalphMustNotRecordExecutorReportsForAnyOtherAttempt", allowedAttemptIds: [correlation.attemptId] }
    ],
    name: `generated flat graph ${suffix}`,
    outsideOccurrences: [...graphReturns, ...specificationReturns, ...executorReports],
    schemaVersion: 1,
    startingFacts: {
      executorWork: "NoPriorReport",
      journal: "Empty",
      taskClaims: [],
      taskWorkSpecifications: specificationReturns.map(({ body, taskId, title }) => ({ body, taskId, title })),
      trackerGraph: graph,
      worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
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
