import { describe, expect, it } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import {
  TaskLifecycle,
  TrackerRevision,
  TrackerSnapshot,
  type TaskLifecycle as TaskLifecycleType,
  type TrackerTask
} from "../../authorities/task-tracker/task.js"
import { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { OperationId } from "../../workflow/identity.js"
import { ClaimOwner, ClaimToken } from "../../authorities/task-tracker/claim.js"
import { TaskClaimAcquisition } from "../../authorities/task-tracker/claim-mutation.js"
import { ResponsibilityDisposition, type ResponsibilityFreshFacts } from "../frontier/fresh-facts.js"
import { WorkflowResponsibilityEntry } from "../reconstruction/state.js"
import { makeTaskWorktreeReconciliationOperation } from "../../workflow/registry/operation.js"
import {
  TrackerGraphState,
  type DeliveryGraphPublication,
  type ExactTicketDeliveryEvidence,
  type TicketDeliveryEvidence
} from "./relations.js"
import { makeTestAcceptedTrackerGraphObservation } from "../../../test/accepted-graph-observation.js"
import {
  boundedParallelTicketsOf,
  frontierOf,
  selectedTicketIds,
  ticketDeliveriesOf
} from "./ticket-delivery-projection.js"

const task = (
  id: string,
  lifecycle: TaskLifecycleType = TaskLifecycle.cases.Open.make({}),
  prerequisiteIds: ReadonlyArray<TaskId> = []
): TrackerTask => ({ id: TaskId.make(id), lifecycle, parentTaskId: null, prerequisiteIds })

const graph = (tasks: ReadonlyArray<TrackerTask>, revision = "graph-1") => {
  const projected = TaskDagSnapshot.project(TrackerSnapshot.make({ revision: TrackerRevision.make(revision), tasks }))
  if (projected._tag === "Invalid") return expect.fail(`invalid test graph: ${JSON.stringify(projected.issues)}`)
  const operationId = OperationId.make(`fixture:${revision}`)
  return TrackerGraphState.cases.GraphEstablished.make({
    observation: makeTestAcceptedTrackerGraphObservation({
      snapshot: projected.snapshot,
      operationId,
      acceptedAt: JournalPosition.make(1)
    })
  })
}

const policy = (capacity: number) =>
  RunControlPolicy.make({ revision: initialRunPolicyRevision, taskExecutionCapacity: TaskWorkCapacity.make(capacity) })

const publication = (currentGraph: TrackerGraphState, currentPolicy: RunControlPolicy): DeliveryGraphPublication => ({
  exactEvidence: [],
  graph: currentGraph,
  policy: currentPolicy
})

const boundedTickets = (currentGraph: TrackerGraphState, currentPolicy: RunControlPolicy) =>
  boundedParallelTicketsOf(frontierOf(publication(currentGraph, currentPolicy)))

const project = (
  tasks: ReadonlyArray<TrackerTask>,
  capacity: number,
  evidence: ReadonlyArray<TicketDeliveryEvidence> = []
) => ticketDeliveriesOf(boundedTickets(graph(tasks), policy(capacity)), evidence)

const plannedAttempt = (taskId: TaskId) =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`attempt:${taskId}`),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/dalph/${taskId}`),
    executor: TaskExecutorLocator.make("executor:fake"),
    runId: RunId.make("run-181"),
    taskId,
    taskRevision: TaskRevision.make(`revision:${taskId}`),
    worktree: WorktreeLocator.make(`/worktrees/${taskId}`)
  })

type ExactExecutorEvidence = {
  readonly _tag: "ResponsibilityFacts"
  readonly facts: Extract<ResponsibilityFreshFacts, { readonly _tag: "PlannedAttemptExecutorFreshFacts" }>
}

const exactExecutorEvidence = (taskId: TaskId): ExactExecutorEvidence => ({
  _tag: "ResponsibilityFacts",
  facts: {
    _tag: "PlannedAttemptExecutorFreshFacts",
    disposition: ResponsibilityDisposition.Ready(),
    responsibility: {
      _tag: "PlannedAttemptExecutorWorkResponsibility",
      beganAt: JournalPosition.make(4),
      plannedAttempt: plannedAttempt(taskId)
    }
  }
})

const exactClaimEvidence = (taskId: TaskId): ExactTicketDeliveryEvidence => ({
  _tag: "ResponsibilityFacts",
  facts: {
    _tag: "WorkflowOperationFreshFacts",
    disposition: ResponsibilityDisposition.Ready(),
    responsibility: WorkflowResponsibilityEntry.cases.TaskClaimResponsibility.make({
      acquisition: TaskClaimAcquisition.make({
        operationId: OperationId.make(`claim:${taskId}`),
        owner: ClaimOwner.make("dalph"),
        taskId,
        token: ClaimToken.make(`token:${taskId}`)
      }),
      beganAt: JournalPosition.make(2),
      taskId
    })
  }
})

const exactWorktreeEvidence = (taskId: TaskId): ExactTicketDeliveryEvidence => ({
  _tag: "ResponsibilityFacts",
  facts: {
    _tag: "WorkflowOperationFreshFacts",
    disposition: ResponsibilityDisposition.Ready(),
    responsibility: WorkflowResponsibilityEntry.cases.TaskWorktreeResponsibility.make({
      beganAt: JournalPosition.make(3),
      operation: makeTaskWorktreeReconciliationOperation({
        operationId: OperationId.make(`worktree:${taskId}`),
        plannedAttempt: plannedAttempt(taskId),
        predecessorOperationIds: []
      }),
      taskId
    })
  }
})

describe("#181 graph and bounded projections", () => {
  it("keeps graph and policy in one publication value", () => {
    const currentGraph = graph([task("A")], "stage-graph")
    const currentPolicy = policy(1)
    const currentPublication = publication(currentGraph, currentPolicy)
    const frontier = frontierOf(currentPublication)
    const tickets = boundedParallelTicketsOf(frontier)

    expect(frontier.source).toBe(currentGraph)
    expect(frontier.standings).toMatchObject([{ _tag: "Eligible", taskId: "A" }])
    expect(selectedTicketIds(tickets)).toEqual([TaskId.make("A")])
    expect(tickets.policy).toBe(currentPolicy)
    expect(frontier.publication).toBe(currentPublication)
  })

  it("partitions every established graph task with exact exclusion evidence", () => {
    const prerequisite = TaskId.make("P")
    const currentGraph = graph([
      task("A"),
      task("B", TaskLifecycle.cases.Open.make({}), [prerequisite]),
      task("C", TaskLifecycle.cases.CompletedSuccessfully.make({})),
      task("D", TaskLifecycle.cases.TerminalWithoutSuccess.make({})),
      task("P", TaskLifecycle.cases.TerminalWithoutSuccess.make({}))
    ])
    const frontier = frontierOf(publication(currentGraph, policy(1)))

    expect(frontier.standings).toMatchObject([
      { _tag: "Eligible", taskId: "A" },
      { _tag: "Excluded", reasons: [{ _tag: "PrerequisitesIncomplete", prerequisiteTaskIds: ["P"] }], taskId: "B" },
      { _tag: "Excluded", reasons: [{ _tag: "SuccessfulCompletion" }], taskId: "C" },
      { _tag: "Excluded", reasons: [{ _tag: "TerminalWithoutSuccess" }], taskId: "D" },
      { _tag: "Excluded", reasons: [{ _tag: "TerminalWithoutSuccess" }], taskId: "P" }
    ])
  })

  it("sorts multiple incomplete prerequisites into deterministic task order", () => {
    const prerequisiteB = TaskId.make("B")
    const prerequisiteC = TaskId.make("C")
    const currentGraph = graph([
      task("A", TaskLifecycle.cases.Open.make({}), [prerequisiteC, prerequisiteB]),
      task("B"),
      task("C")
    ])
    const frontier = frontierOf(publication(currentGraph, policy(1)))

    expect(frontier.standings.find(({ taskId }) => taskId === TaskId.make("A"))).toMatchObject({
      _tag: "Excluded",
      reasons: [{ _tag: "PrerequisitesIncomplete", prerequisiteTaskIds: [prerequisiteB, prerequisiteC] }]
    })
  })

  it("retains an exact responsibility when an unfinished prerequisite blocks its graph placement", () => {
    const blockedTask = TaskId.make("B")
    const result = project([task("A"), task("B", TaskLifecycle.cases.Open.make({}), [TaskId.make("A")])], 2, [
      exactExecutorEvidence(blockedTask)
    ])
    const retained = result.deliveries.find(({ taskId }) => taskId === blockedTask)

    expect(retained?.placement).toEqual({
      _tag: "GraphExcluded",
      reasons: [{ _tag: "PrerequisitesIncomplete", prerequisiteTaskIds: [TaskId.make("A")] }]
    })
    expect(retained?.obligations).toMatchObject([{ _tag: "WorkflowResponsibility" }])
  })

  it("selects deterministic lexical candidates and retains the complete outside-bound explanation", () => {
    const bounded = boundedTickets(graph([task("C"), task("A"), task("B")]), policy(2))

    expect(selectedTicketIds(bounded)).toEqual(["A", "B"])
    expect(bounded.placements).toMatchObject([
      { placement: { _tag: "Selected", rank: 0 }, taskId: "A" },
      { placement: { _tag: "Selected", rank: 1 }, taskId: "B" },
      { placement: { _tag: "EligibleOutsideBound", rank: 2 }, taskId: "C" }
    ])
  })
})

describe("#181 ticket-delivery positive and negative space", () => {
  it("retains exact evidence while the current graph is not established", () => {
    const taskA = TaskId.make("A")
    const currentGraph = TrackerGraphState.cases.GraphNotEstablished.make({})
    const tickets = boundedParallelTicketsOf(frontierOf(publication(currentGraph, policy(1))))
    const result = ticketDeliveriesOf(tickets, [exactExecutorEvidence(taskA)])

    expect(result.deliveries).toMatchObject([
      { obligations: [{ _tag: "WorkflowResponsibility" }], placement: { _tag: "GraphNotEstablished" }, taskId: "A" }
    ])
  })

  it("lets pre-intent desired work disappear when the graph no longer selects it", () => {
    const first = project([task("A"), task("B")], 1)
    const changed = project([task("B")], 1)

    expect(first.deliveries.map(({ taskId }) => taskId)).toEqual(["A"])
    expect(changed.deliveries.map(({ taskId }) => taskId)).toEqual(["B"])
  })

  it("removes unstarted C but preserves safely suspended B through ticket delivery", () => {
    const taskB = TaskId.make("B")
    const taskC = TaskId.make("C")
    const exact = exactExecutorEvidence(taskB)
    const safelySuspended: ExactTicketDeliveryEvidence = {
      ...exact,
      facts: {
        ...exact.facts,
        disposition: ResponsibilityDisposition.PlannedAttemptExecutorWorkSafelySuspended({
          correlation: {
            attemptId: exact.facts.responsibility.plannedAttempt.attemptId,
            runId: exact.facts.responsibility.plannedAttempt.runId
          }
        })
      }
    }
    const before = project([task("B"), task("C")], 2, [safelySuspended])
    const after = project([], 2, [safelySuspended])

    expect(before.deliveries.map(({ taskId }) => taskId)).toEqual([taskB, taskC])
    expect(after.deliveries.map(({ taskId }) => taskId)).toEqual([taskB])
    expect(after.deliveries[0]?.placement._tag).toBe("AbsentFromCurrentGraph")
  })

  it("retains an exact attempt across outside-bound, closed, and absent graph placements", () => {
    const taskB = TaskId.make("B")
    const evidence = [exactExecutorEvidence(taskB)]
    const cases = [
      project([task("A"), task("B")], 1, evidence),
      project([task("B", TaskLifecycle.cases.CompletedSuccessfully.make({}))], 1, evidence),
      project([], 1, evidence)
    ]

    expect(cases.map((result) => result.deliveries.find(({ taskId }) => taskId === taskB)?.placement._tag)).toEqual([
      "EligibleOutsideBound",
      "GraphExcluded",
      "AbsentFromCurrentGraph"
    ])
    expect(cases.every((result) => result.deliveries.some(({ taskId }) => taskId === taskB))).toBe(true)
  })

  it("retains exact claim, worktree, and executor obligations after their graph placement changes", () => {
    const taskA = TaskId.make("A")
    const taskB = TaskId.make("B")
    const taskC = TaskId.make("C")
    const result = project([], 1, [
      exactClaimEvidence(taskA),
      exactWorktreeEvidence(taskB),
      exactExecutorEvidence(taskC)
    ])

    expect(result.deliveries.map(({ taskId }) => taskId)).toEqual([taskA, taskB, taskC])
    expect(result.deliveries.map(({ obligations }) => obligations.map(({ _tag }) => _tag))).toEqual([
      ["WorkflowResponsibility"],
      ["WorkflowResponsibility"],
      ["WorkflowResponsibility"]
    ])
    expect(result.deliveries.every(({ placement }) => placement._tag === "AbsentFromCurrentGraph")).toBe(true)
  })

  it("keeps every active executor lifecycle disposition without inventing a new lifecycle label", () => {
    const taskA = TaskId.make("A")
    const responsibility = exactExecutorEvidence(taskA).facts
    const dispositions = [
      ResponsibilityDisposition.Ready(),
      ResponsibilityDisposition.PlannedAttemptExecutorSuspensionRequested(),
      ResponsibilityDisposition.PlannedAttemptExecutorWorkSafelySuspended({
        correlation: {
          attemptId: responsibility.responsibility.plannedAttempt.attemptId,
          runId: responsibility.responsibility.plannedAttempt.runId
        }
      }),
      ResponsibilityDisposition.TaskClaimMissingConstraint(),
      ResponsibilityDisposition.TaskClaimUnreadableWait(),
      ResponsibilityDisposition.TaskForeignClaimIsolation(),
      ResponsibilityDisposition.PlannedAttemptGitConstraint({ gitState: "WorktreeLost" }),
      ResponsibilityDisposition.TaskMembershipConstraint(),
      ResponsibilityDisposition.TaskLifecycleConstraint({ lifecycle: "TerminalWithoutSuccess" }),
      ResponsibilityDisposition.TaskSpecificationChangeConstraint({
        observedFingerprint: TaskRevision.make("observed:A"),
        plannedFingerprint: responsibility.responsibility.plannedAttempt.taskRevision
      })
    ]

    for (const disposition of dispositions) {
      const result = project([], 1, [{ _tag: "ResponsibilityFacts", facts: { ...responsibility, disposition } }])
      const delivery = result.deliveries[0]
      expect(delivery?.obligations).toHaveLength(1)
      expect(delivery?.standings).toEqual([
        { _tag: "ResponsibilitySituation", facts: { ...responsibility, disposition } }
      ])
    }
  })

  it("keeps A as an unreadable Git wait while independent B remains proposed", () => {
    const taskA = TaskId.make("A")
    const taskB = TaskId.make("B")
    const facts = exactExecutorEvidence(taskA).facts
    const result = project([task("A"), task("B")], 2, [
      {
        _tag: "ResponsibilityFacts",
        facts: {
          ...facts,
          disposition: ResponsibilityDisposition.PlannedAttemptGitConstraint({ gitState: "WorktreeLost" })
        }
      }
    ])

    expect(result.deliveries.find(({ taskId }) => taskId === taskA)?.standings[0]).toMatchObject({
      _tag: "ResponsibilitySituation",
      facts: { disposition: { _tag: "PlannedAttemptGitConstraint", gitState: "WorktreeLost" } }
    })
    expect(result.deliveries.find(({ taskId }) => taskId === taskB)?.standings).toEqual([{ _tag: "ProposedDelivery" }])
  })

  it("describes fresh C while A and B retain exact obligations across a capacity contraction", () => {
    const taskA = TaskId.make("A")
    const taskB = TaskId.make("B")
    const taskC = TaskId.make("C")
    const result = project([task("C")], 1, [exactExecutorEvidence(taskA), exactExecutorEvidence(taskB)])

    expect(result.deliveries.map(({ placement, taskId }) => ({ placement: placement._tag, taskId }))).toEqual([
      { placement: "AbsentFromCurrentGraph", taskId: taskA },
      { placement: "AbsentFromCurrentGraph", taskId: taskB },
      { placement: "Selected", taskId: taskC }
    ])
    expect(result.deliveries.slice(0, 2).every(({ obligations }) => obligations.length === 1)).toBe(true)
  })

  it("retains terminal knowledge only until the complete graph establishes success", () => {
    const taskA = TaskId.make("A")
    const responsibility = exactExecutorEvidence(taskA).facts
    const terminal = PlannedAttemptExecutorReport.cases.Terminal.make({
      correlation: {
        attemptId: responsibility.responsibility.plannedAttempt.attemptId,
        runId: responsibility.responsibility.plannedAttempt.runId
      },
      result: { _tag: "Completed" }
    })
    const evidence: ExactTicketDeliveryEvidence = {
      _tag: "ResponsibilityFacts",
      facts: {
        ...responsibility,
        disposition: ResponsibilityDisposition.PlannedAttemptExecutorWorkTerminal({ report: terminal })
      }
    }

    expect(project([], 1, [evidence]).deliveries.map(({ taskId }) => taskId)).toEqual([taskA])
    expect(project([task("A")], 1, [evidence]).deliveries[0]?.standings.map(({ _tag }) => _tag)).toEqual([
      "ResponsibilitySituation"
    ])
    expect(project([task("A", TaskLifecycle.cases.CompletedSuccessfully.make({}))], 1, [evidence]).deliveries).toEqual(
      []
    )
  })

  it("removes a synthetic Completed terminal after the complete graph establishes success", () => {
    const taskA = TaskId.make("A")
    const attempt = plannedAttempt(taskA)
    const evidence: TicketDeliveryEvidence = {
      _tag: "SyntheticExecutorFacts",
      plannedAttempt: attempt,
      report: PlannedAttemptExecutorReport.cases.Terminal.make({
        correlation: { attemptId: attempt.attemptId, runId: attempt.runId },
        result: { _tag: "Completed" }
      })
    }

    expect(project([], 1, [evidence]).deliveries.map(({ taskId }) => taskId)).toEqual([taskA])
    expect(project([task("A", TaskLifecycle.cases.CompletedSuccessfully.make({}))], 1, [evidence]).deliveries).toEqual(
      []
    )
  })

  it("lets a settled exact operation end while current graph selection remains descriptive", () => {
    const taskA = TaskId.make("A")
    const claim = exactClaimEvidence(taskA)
    if (claim._tag !== "ResponsibilityFacts" || claim.facts._tag !== "WorkflowOperationFreshFacts") {
      return expect.fail("claim evidence must be an operation")
    }
    const result = project([task("A")], 1, [
      {
        ...claim,
        facts: {
          ...claim.facts,
          disposition: ResponsibilityDisposition.Settled({ outcome: "ResponsibilityCompleted" })
        }
      }
    ])

    expect(result.deliveries[0]).toMatchObject({
      evidence: [],
      standings: [{ _tag: "ProposedDelivery" }],
      taskId: taskA
    })
  })

  it("retains workflow Pause, unreadable wait, final outcome, and relinquishment as distinct situations", () => {
    const taskA = TaskId.make("A")
    const claim = exactClaimEvidence(taskA)
    if (claim._tag !== "ResponsibilityFacts" || claim.facts._tag !== "WorkflowOperationFreshFacts") {
      return expect.fail("claim evidence must be an operation")
    }
    const dispositions = [
      ResponsibilityDisposition.Paused(),
      ResponsibilityDisposition.UnreadableFactWait({ boundary: "Git" }),
      ResponsibilityDisposition.FinalOutcome({ outcome: "Failed" }),
      ResponsibilityDisposition.Relinquished({ reason: "AuthorizedHandoff" })
    ]

    for (const disposition of dispositions) {
      const result = project([], 1, [{ ...claim, facts: { ...claim.facts, disposition } }])
      expect(result.deliveries[0]?.standings[0]).toMatchObject({
        _tag: "ResponsibilitySituation",
        facts: { disposition: { _tag: disposition._tag } }
      })
    }
  })

  it("isolates duplicate exact evidence on A while independent B remains deliverable", () => {
    const taskA = TaskId.make("A")
    const evidence = exactExecutorEvidence(taskA)
    const result = project([task("A"), task("B")], 2, [evidence, evidence])

    expect(result.deliveries.find(({ taskId }) => taskId === taskA)?.standings).toEqual(
      expect.arrayContaining([{ _tag: "ExactEvidenceConflict", evidenceIdentities: [expect.any(String)] }])
    )
    expect(result.deliveries.find(({ taskId }) => taskId === TaskId.make("B"))?.standings).toEqual([
      { _tag: "ProposedDelivery" }
    ])
  })

  it("reports each distinct duplicate evidence identity once", () => {
    const taskA = TaskId.make("A")
    const executor = exactExecutorEvidence(taskA)
    const claim = exactClaimEvidence(taskA)
    const result = project([task("A")], 1, [executor, executor, claim, claim])
    const conflict = result.deliveries[0]?.standings.find(({ _tag }) => _tag === "ExactEvidenceConflict")

    expect(conflict).toMatchObject({ _tag: "ExactEvidenceConflict" })
    if (conflict?._tag !== "ExactEvidenceConflict") return expect.fail("duplicate evidence must be isolated")
    expect(conflict.evidenceIdentities).toHaveLength(2)
    expect(new Set(conflict.evidenceIdentities).size).toBe(2)
  })
})
