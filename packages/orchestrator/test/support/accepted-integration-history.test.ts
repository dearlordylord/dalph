import { describe, expect, it } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification,
  RunId
} from "@dalph/contracts"
import type { AcceptedResult, TaskWorkSpecification } from "@dalph/contracts"
import { ActiveTaskClaim } from "../../src/authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../src/authorities/task-tracker/claim.js"
import { FixtureTarget } from "../../src/authorities/task-tracker/fixture/target.js"
import { reduceWorkflowJournalHistory } from "../../src/coordination/reconstruction/history.js"
import { OperationId } from "../../src/workflow/identity.js"
import { workflowJournalEventVersion } from "../../src/workflow/kernel/event.js"
import { describeJournalEvent } from "../../src/workflow/registry/event-descriptor.js"
import { IntegratorSessionFixedEvent } from "../../src/workflow/protocols/integrator/events.js"
import { integratorCorrelationFor } from "../../src/workflow/protocols/integrator/session.js"
import { JournalPosition } from "../../src/workflow-journal/identity.js"
import { acceptedResultFixture } from "./evidence.js"
import { makeAcceptedIntegrationHistory } from "./accepted-integration-history.js"
import { makeExecutingAttemptHistory } from "./executing-attempt-history.js"
import { InitialControlPolicy } from "../../src/control/policy.js"
import { TaskWorkCapacity } from "../../src/coordination/admission/capacity.js"

const runId = RunId.make("accepted-integration-history-test")
const taskId = TaskId.make("accepted-integration-task")
const trackerTarget = FixtureTarget.make("accepted-integration-target")
const integrationTarget = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("/repositories/accepted-integration-history.git")
})
const specification: TaskWorkSpecification = makeTaskWorkSpecification({
  body: "Prepare an accepted integration fixture.",
  taskId,
  title: "Accepted integration fixture"
})
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("accepted-integration-attempt"),
  baseSha: GitCommitSha.make("a".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/accepted-integration"),
  executor: TaskExecutorLocator.make("executor:accepted-integration"),
  runId,
  taskId,
  taskRevision: specification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/accepted-integration")
})
const activeClaim = ActiveTaskClaim.make({
  operationId: OperationId.make("accepted-integration-claim"),
  owner: ClaimOwner.make("dalph:accepted-integration"),
  taskId,
  token: ClaimToken.make("accepted-integration-token")
})
const acceptedResult: AcceptedResult = acceptedResultFixture(GitCommitSha.make("b".repeat(40)))

const fixture = makeAcceptedIntegrationHistory({
  acceptedResult,
  activeClaim,
  integrationTarget,
  plannedAttempt,
  runId,
  targetHeadSha: GitCommitSha.make("c".repeat(40)),
  taskSpecification: specification,
  trackerTarget
})

describe("accepted integration history fixture", () => {
  it("builds one executing attempt without terminal or integration facts", () => {
    const history = makeExecutingAttemptHistory({
      activeClaim,
      plannedAttempt,
      runId,
      trackerTarget,
      taskSpecification: specification
    })
    expect(reduceWorkflowJournalHistory(runId, history.records)._tag).toBe("ValidWorkflowJournalHistory")
    expect(history.records.at(-1)?.event).toMatchObject({
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { _tag: "ExecutorWorkExecuting" }
    })
    expect(history.records.some(({ event }) => event._tag === "IntegrationResponsibilityBegan")).toBe(false)
  })

  it("continues a shared Run with a second independently authorized executing attempt", () => {
    const first = makeExecutingAttemptHistory({
      activeClaim,
      initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(2) }),
      plannedAttempt,
      runId,
      trackerTarget,
      taskSpecification: specification
    })
    const secondTask = TaskId.make("second-executing-task")
    const secondSpecification = makeTaskWorkSpecification({
      taskId: secondTask,
      body: "Second task",
      title: "Second task"
    })
    const second = makeExecutingAttemptHistory({
      activeClaim: ActiveTaskClaim.make({
        ...activeClaim,
        taskId: secondTask,
        operationId: OperationId.make("second-claim"),
        token: ClaimToken.make("second-token")
      }),
      plannedAttempt: PlannedTaskAttempt.make({
        ...plannedAttempt,
        taskId: secondTask,
        taskRevision: secondSpecification.fingerprint,
        attemptId: AttemptId.make("second-attempt"),
        branch: TaskBranchRef.make("refs/heads/dalph/second"),
        worktree: WorktreeLocator.make("/worktrees/second")
      }),
      runId,
      trackerTarget,
      taskSpecification: secondSpecification,
      priorRecords: first.records
    })
    expect(reduceWorkflowJournalHistory(runId, second.records)._tag).toBe("ValidWorkflowJournalHistory")
    expect(second.records.slice(0, first.records.length)).toEqual(first.records)
    expect(second.records.filter(({ event }) => event._tag === "WorkflowRunBegan")).toHaveLength(1)
    expect(
      second.records.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan")
    ).toHaveLength(2)
  })
  it("returns a reducer-accepted base with dynamic responsibility and lineage positions", () => {
    const reduced = reduceWorkflowJournalHistory(runId, fixture.records)
    expect(reduced._tag).toBe("ValidWorkflowJournalHistory")

    const queued = fixture.records.find(({ event }) => event._tag === "IntegrationResponsibilityBegan")
    const started = fixture.records.find(({ event }) => event._tag === "IntegrationStarted")
    const lineage = fixture.records.find(({ event }) => event._tag === "TargetLineageObserved")
    expect(queued?.position).toBe(fixture.responsibility.queuedAt)
    expect(started?.position).toBe(fixture.responsibility.startedAt)
    expect(lineage?.position).toBe(fixture.targetLineageObservedAt)
    expect(Number(fixture.responsibility.queuedAt)).toBeGreaterThan(1)
    expect(Number(fixture.responsibility.startedAt)).toBeGreaterThan(Number(fixture.responsibility.queuedAt))
    expect(Number(fixture.targetLineageObservedAt)).toBeGreaterThan(Number(fixture.responsibility.startedAt))
  })

  it("rejects a fixed session when the exact earlier integration start is absent", () => {
    const session = integratorCorrelationFor({
      responsibility: fixture.responsibility,
      targetLineage: fixture.targetLineage,
      targetLineageObservedAt: fixture.targetLineageObservedAt
    })
    const partial = fixture.records
      .filter(
        ({ event }) =>
          event._tag !== "IntegrationStarted" &&
          event._tag !== "TargetLineageObserved" &&
          event._tag !== "GitReadIntentRecorded"
      )
      .map((record, index) => ({ ...record, position: JournalPosition.make(index + 1) }))
    const fixed: (typeof partial)[number] = {
      event: IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion }),
      key: describeJournalEvent(
        IntegratorSessionFixedEvent.make({ correlation: session, version: workflowJournalEventVersion })
      ).expectedKey,
      position: JournalPosition.make(partial.length + 1),
      runId
    }
    const reduced = reduceWorkflowJournalHistory(runId, [...partial, fixed])
    expect(reduced._tag).toBe("InvalidWorkflowJournalHistory")
    if (reduced._tag !== "InvalidWorkflowJournalHistory") return
    expect(
      reduced.issues.some((issue) => "detail" in issue && issue.detail.includes("no exact earlier IntegrationStarted"))
    ).toBe(true)
  })
})
