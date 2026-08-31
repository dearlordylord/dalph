import { makeTaskWorkSpecification, TaskId } from "@dalph/contracts"
import { Schema } from "effect"
import { AuthoredScenarioCassette, type AuthoredScenarioCassette as ScenarioCassette } from "./authored.js"

const taskIds = ["A", "B", "C", "D", "E"] as const
type TaskIdText = (typeof taskIds)[number]

const graph = (revision: string, closedTaskIds: ReadonlySet<TaskIdText> = new Set()) => ({
  revision,
  rootTaskId: "A" as const,
  tasks: taskIds.map((id) => ({
    id,
    lifecycle: { _tag: closedTaskIds.has(id) ? ("TerminalWithoutSuccess" as const) : ("Open" as const) },
    parentTaskId: null,
    prerequisiteIds: []
  }))
})

const graphG0 = graph("delivery-story-G0")
const graphG1 = graph("delivery-story-G1")
const graphG2 = graph("delivery-story-G2", new Set(["C"]))

const specification = (taskId: TaskIdText) => ({
  body: `Implement delivery-story task ${taskId}.`,
  taskId: TaskId.make(taskId),
  title: `Implement ${taskId}`
})

const changedBSpecification = {
  body: "Alice changed delivery-story task B.",
  taskId: TaskId.make("B"),
  title: "Implement changed B"
}
const changedBRevision = makeTaskWorkSpecification(changedBSpecification).fingerprint

const attempts = {
  a: { attemptId: "attempt:A:0", taskId: "A" },
  b: { attemptId: "attempt:B:1", taskId: "B" },
  c: { attemptId: "attempt:C:2", taskId: "C" },
  d: { attemptId: "attempt:D:3", taskId: "D" },
  e: { attemptId: "attempt:E:4", taskId: "E" }
} as const

const graphRead = (value: ReturnType<typeof graph>) => [
  { _tag: "DalphSelects" as const, operation: { _tag: "ReadTrackerGraph" as const, target: "delivery-story-target" } },
  { _tag: "TrackerGraphReadReturned" as const, graph: value }
]

const specificationRead = (taskId: TaskIdText, changed = false) => [
  { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskWorkSpecification" as const, taskId } },
  {
    _tag: "TaskWorkSpecificationReadReturned" as const,
    ...(changed && taskId === "B" ? changedBSpecification : specification(taskId))
  }
]

const claimRead = (taskId: TaskIdText) => [
  { _tag: "DalphSelects" as const, operation: { _tag: "ReadTaskClaim" as const, taskId } },
  { _tag: "TaskClaimCurrentReadReturned" as const, taskId }
]

const worktreeRead = ({ attemptId, taskId }: (typeof attempts)[keyof typeof attempts]) => ({
  _tag: "DalphSelects" as const,
  operation: { _tag: "ReadTaskWorktree" as const, attemptId, taskId }
})

const lineageRead = ({ attemptId, taskId }: (typeof attempts)[keyof typeof attempts]) => ({
  _tag: "DalphSelects" as const,
  operation: { _tag: "ReadTargetLineage" as const, attemptId, taskId }
})

const acquireClaim = (taskId: TaskIdText) => ({
  _tag: "DalphSelects" as const,
  operation: { _tag: "AcquireTaskClaim" as const, taskId }
})

const plan = (
  { attemptId, taskId }: (typeof attempts)[keyof typeof attempts],
  occurrenceRole: string
) => ({
  _tag: "DalphSelects" as const,
  causalAnchor: { occurrenceRole },
  operation: { _tag: "RecordTaskAttemptPlan" as const, attemptId, taskId }
})

const prepareWorktree = ({ attemptId, taskId }: (typeof attempts)[keyof typeof attempts]) => ({
  _tag: "DalphSelects" as const,
  operation: { _tag: "ReconcileTaskWorktree" as const, attemptId, taskId }
})

const executorReport = (
  attempt: (typeof attempts)[keyof typeof attempts],
  request: "Begin" | "Resume" | "Suspend",
  report: "Executing" | "Safe"
) => ({
  _tag: "PlannedAttemptExecutorWorkReported" as const,
  report:
    report === "Executing"
      ? { _tag: "ExecutorWorkExecuting" as const, attemptId: attempt.attemptId }
      : { _tag: "ExecutorWorkSafelySuspended" as const, attemptId: attempt.attemptId },
  request
})

const executorProjection = ({ attemptId }: (typeof attempts)[keyof typeof attempts]) => ({
  _tag: "PlannedAttemptExecutorProjectionReturned" as const,
  report: { _tag: "ExecutorWorkExecuting" as const, attemptId }
})

/** The maintained capstone composes DS-01 through DS-13 and stops before integration. */
export const deliveryStoryCapstoneAuthoredCassette: ScenarioCassette = Schema.decodeUnknownSync(
  AuthoredScenarioCassette
)({
  _tag: "AuthoredScenarioCassette",
  name: "Alice changes B while A C and D survive capacity contraction and restart before retained B resumes",
  processLifecycle: { _tag: "ReactivationOwnerProcessGenerations" },
  schemaVersion: 1,
  startingFacts: {
    executorWork: "NoPriorReport",
    journal: "Empty",
    taskClaims: [],
    taskWorkSpecifications: taskIds.map(specification),
    trackerGraph: graphG0,
    worktreeObservation: { _tag: "PlannedWorktreeAbsent" }
  },
  story: [
    { _tag: "InitialControlPolicy", policy: { taskExecutionCapacity: 3 } },
    {
      _tag: "RunCoordinator",
      baseSha: "1111111111111111111111111111111111111111",
      claimOwner: "delivery-story-owner",
      claimTokenPrefix: "delivery-story-claim",
      executor: "executor:delivery-story",
      integrationTarget: { repository: "/dalph/cassettes/delivery-story.git", ref: "refs/heads/master" },
      target: "delivery-story-target",
      worktreeRoot: "/dalph/cassettes/delivery-story"
    },
    ...Array.from({ length: 6 }, () => graphRead(graphG0)).flat(),
    acquireClaim("A"),
    acquireClaim("B"),
    acquireClaim("C"),
    acquireClaim("D"),
    acquireClaim("E"),
    ...Array.from({ length: 5 }, () => graphRead(graphG0)).flat(),
    ...taskIds.flatMap((taskId) => specificationRead(taskId)),
    plan(attempts.a, "plan-A-F1"),
    plan(attempts.b, "plan-B-F1"),
    plan(attempts.c, "plan-C-F1"),
    plan(attempts.d, "plan-D-F1"),
    plan(attempts.e, "plan-E-F1"),
    prepareWorktree(attempts.a),
    prepareWorktree(attempts.b),
    prepareWorktree(attempts.c),
    prepareWorktree(attempts.d),
    prepareWorktree(attempts.e),
    executorReport(attempts.a, "Begin", "Executing"),
    executorReport(attempts.b, "Begin", "Executing"),
    executorReport(attempts.c, "Begin", "Executing"),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    {
      _tag: "CassetteOffersRunReactivationHints",
      hints: ["TrackerNotification", "Timer", "TrackerNotification", "Timer"]
    },
    {
      _tag: "DalphSelects",
      causal: { occurrenceRole: "B-edit-active-G1", predecessorRoles: ["plan-A-F1", "plan-B-F1", "plan-C-F1"] },
      operation: { _tag: "ReadTrackerGraph", target: "delivery-story-target" }
    },
    { _tag: "TrackerGraphReadReturned", graph: graphG1 },
    {
      _tag: "ConcurrentTrackerReadBatch",
      members: [
        {
          causal: { occurrenceRole: "B-edit-A-F1", predecessorRoles: ["plan-A-F1", "B-edit-active-G1"] },
          operation: { _tag: "ReadTaskWorkSpecification", taskId: "A" },
          result: { _tag: "TaskWorkSpecificationReadReturned", ...specification("A") }
        },
        {
          causal: { occurrenceRole: "B-edit-B-F2", predecessorRoles: ["plan-B-F1", "B-edit-active-G1"] },
          operation: { _tag: "ReadTaskWorkSpecification", taskId: "B" },
          result: { _tag: "TaskWorkSpecificationReadReturned", ...changedBSpecification }
        },
        {
          causal: { occurrenceRole: "B-edit-C-F1", predecessorRoles: ["plan-C-F1", "B-edit-active-G1"] },
          operation: { _tag: "ReadTaskWorkSpecification", taskId: "C" },
          result: { _tag: "TaskWorkSpecificationReadReturned", ...specification("C") }
        }
      ]
    },
    ...claimRead("A"),
    worktreeRead(attempts.a),
    lineageRead(attempts.a),
    ...claimRead("C"),
    worktreeRead(attempts.c),
    lineageRead(attempts.c),
    executorReport(attempts.b, "Suspend", "Executing"),
    {
      _tag: "PlannedAttemptExecutorPassiveLifecycleChanged",
      report: { _tag: "ExecutorWorkSafelySuspended", attemptId: attempts.b.attemptId }
    },
    executorReport(attempts.d, "Begin", "Executing"),
    executorProjection(attempts.d),
    ...graphRead(graphG1),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    { _tag: "SetTaskExecutionCapacity", capacity: 2 },
    { _tag: "CoordinatorProcessDies" },
    ...graphRead(graphG1),
    ...specificationRead("A"),
    ...specificationRead("C"),
    ...specificationRead("D"),
    ...claimRead("A"),
    ...claimRead("C"),
    ...claimRead("D"),
    worktreeRead(attempts.a),
    worktreeRead(attempts.c),
    worktreeRead(attempts.d),
    lineageRead(attempts.a),
    lineageRead(attempts.c),
    lineageRead(attempts.d),
    {
      _tag: "CassetteOffersRunReactivationHints",
      hints: ["TrackerNotification", "Timer"]
    },
    ...graphRead(graphG2),
    ...specificationRead("A"),
    ...specificationRead("D"),
    ...claimRead("A"),
    ...claimRead("D"),
    worktreeRead(attempts.a),
    worktreeRead(attempts.d),
    lineageRead(attempts.a),
    lineageRead(attempts.d),
    executorReport(attempts.c, "Suspend", "Safe"),
    {
      _tag: "OperatorContinuesAttempt",
      attemptId: attempts.b.attemptId,
      expected: { _tag: "Applied" },
      observedTaskRevision: changedBRevision,
      requestNonce: "continue-delivery-story-B",
      taskId: attempts.b.taskId
    },
    ...graphRead(graphG2),
    ...specificationRead("B", true),
    ...claimRead("B"),
    worktreeRead(attempts.b),
    lineageRead(attempts.b),
    {
      _tag: "PlannedAttemptExecutorPassiveLifecycleChanged",
      report: {
        _tag: "ExecutorWorkTerminal",
        attemptId: attempts.a.attemptId,
        result: { _tag: "Accepted", acceptedResult: { commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } }
      }
    },
    executorReport(attempts.b, "Resume", "Executing"),
    ...graphRead(graphG2),
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    {
      _tag: "ExpectedBehavior",
      orchestration: null,
      protocol: null,
      taskWork: {
        absences: [],
        results: [{ _tag: "PlannedWorkForTaskAccepted", commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", taskId: "A" }]
      }
    }
  ]
})
