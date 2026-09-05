import { it } from "@effect/vitest"
import { RunId, TaskId, TaskRevision } from "@dalph/contracts"
import { Effect } from "effect"
import { expect } from "vitest"
import { TaskLifecycle, type Task } from "../../authorities/task-tracker/task.js"
import { projectTrackerSnapshot, taskRevisionFor } from "../../authorities/task-tracker/graph.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { OperationId } from "../../workflow/identity.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { intentRecordKey, outcomeRecordKey } from "../../workflow-journal/record-key.js"
import type { CurrentDeliveryFrame } from "../run/current-delivery-frame.js"
import { RunActivationOpportunity } from "../run/run-activation-opportunity.js"
import { RunnableFrontierTransition } from "../frontier/frontier.js"
import {
  deriveFreshTaskCandidateEvaluation,
  freshTaskCandidateDecisionIssues,
  isFreshTaskCandidateFrontier
} from "./fresh-task-candidate.js"
import { FreshWorkflowStep } from "./fresh-workflow-step.js"
import { freshTaskCandidateObservationOf } from "./relations.js"
import { makeFreshTaskCandidateFrontierForTest } from "../../../test/support/fresh-task-candidate.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { makeTrackerGraphObservationOperation } from "../../workflow/registry/operation.js"
import {
  taskTrackerFactsObservedEvent,
  makeCompleteTaskTrackerFactsObserved
} from "../../workflow/task-tracker-facts/observation.js"
import { taskTrackerReadIntent } from "../../workflow/registry/event.js"

const runId = RunId.make("fresh-candidate-run")
const freshTaskCandidateFrontierOf = (input: Parameters<typeof makeFreshTaskCandidateFrontierForTest>[0]) =>
  Effect.succeed(makeFreshTaskCandidateFrontierForTest(input))

const task = (id: string): Task => ({
  id: TaskId.make(id),
  lifecycle: TaskLifecycle.cases.Open.make({}),
  parentTaskId: null,
  prerequisiteIds: []
})

const decision = (id: string, revision: string, step: "ReadCurrentTaskGraph" | "AcquireTaskClaim") => {
  const candidateTask = {
    ...task(id),
    prerequisiteIds: revision.endsWith("r2") ? [TaskId.make(`${id}-prerequisite`)] : []
  }
  const predecessorOperationId = OperationId.make(`fresh-candidate:${id}:graph`)
  return {
    step:
      step === "ReadCurrentTaskGraph"
        ? FreshWorkflowStep.ReadCurrentTaskGraph({ predecessorOperationId, task: candidateTask })
        : FreshWorkflowStep.AcquireTaskClaim({ predecessorOperationId, task: candidateTask }),
    transition:
      step === "ReadCurrentTaskGraph"
        ? RunnableFrontierTransition.ContinueFreshWorkflowOperation({
            operationId: predecessorOperationId,
            taskId: candidateTask.id
          })
        : RunnableFrontierTransition.CommitFreshTaskClaimIntent({
            taskId: candidateTask.id,
            taskRevision: taskRevisionFor(candidateTask)
          })
  }
}

it.effect("keeps one revision-bound candidate identity across the pre-intent graph and claim stages", () =>
  Effect.gen(function* () {
    const beforeGraph = yield* freshTaskCandidateFrontierOf({
      decisions: [decision("A", "A-r1", "ReadCurrentTaskGraph")],
      runId
    })
    const beforeClaim = yield* freshTaskCandidateFrontierOf({
      decisions: [decision("A", "A-r1", "AcquireTaskClaim")],
      runId
    })

    expect(beforeClaim.candidates[0]?.id).toBe(beforeGraph.candidates[0]?.id)
    expect(beforeClaim.candidates[0]?.decision.step._tag).toBe("AcquireTaskClaim")
  })
)

it.effect("keeps candidate identity when only the current-graph predecessor changes", () =>
  Effect.gen(function* () {
    const candidateTask = task("A")
    const graphDecision = (operation: string) => {
      const predecessorOperationId = OperationId.make(operation)
      return {
        step: FreshWorkflowStep.ReadCurrentTaskGraph({ predecessorOperationId, task: candidateTask }),
        transition: RunnableFrontierTransition.ContinueFreshWorkflowOperation({
          operationId: predecessorOperationId,
          taskId: candidateTask.id
        })
      }
    }
    const before = yield* freshTaskCandidateFrontierOf({ decisions: [graphDecision("graph-before-B")], runId })
    const after = yield* freshTaskCandidateFrontierOf({ decisions: [graphDecision("accepted-B-graph")], runId })

    expect(after.candidates[0]?.id).toBe(before.candidates[0]?.id)
    expect(after.candidates[0]?.decision.step).not.toEqual(before.candidates[0]?.decision.step)
  })
)

it.effect("changes candidate identity when the tracker task revision changes", () =>
  Effect.gen(function* () {
    const first = yield* freshTaskCandidateFrontierOf({ decisions: [decision("A", "A-r1", "AcquireTaskClaim")], runId })
    const changed = yield* freshTaskCandidateFrontierOf({
      decisions: [decision("A", "A-r2", "AcquireTaskClaim")],
      runId
    })

    expect(changed.candidates[0]?.id).not.toBe(first.candidates[0]?.id)
  })
)

it.effect("preserves the graph-derived candidate order and rejects duplicate task candidates", () =>
  Effect.gen(function* () {
    const frontier = yield* freshTaskCandidateFrontierOf({
      decisions: ["A", "B", "C", "D", "E"].map((id) => decision(id, `${id}-r1`, "AcquireTaskClaim")),
      runId
    })

    expect(frontier.candidates.map(({ ordinal, taskId }) => [Number(ordinal), taskId])).toEqual([
      [0, "A"],
      [1, "B"],
      [2, "C"],
      [3, "D"],
      [4, "E"]
    ])

    const authoredOrder = yield* freshTaskCandidateFrontierOf({
      decisions: [decision("B", "B-r1", "AcquireTaskClaim"), decision("A", "A-r1", "AcquireTaskClaim")],
      runId
    })
    expect(authoredOrder.candidates.map(({ ordinal, taskId }) => [Number(ordinal), taskId])).toEqual([
      [0, "A"],
      [1, "B"]
    ])

    const duplicate = freshTaskCandidateDecisionIssues([
      decision("A", "A-r1", "ReadCurrentTaskGraph"),
      decision("A", "A-r1", "AcquireTaskClaim")
    ])
    expect(duplicate).toMatchObject({ duplicateTaskIds: ["A"] })
  })
)

it.effect("uses stable code-unit order for mixed-case and punctuation task IDs", () =>
  Effect.gen(function* () {
    const frontier = yield* freshTaskCandidateFrontierOf({
      decisions: ["a", "A", "a.", "a-", "A!"].map((id) => decision(id, `${id}-r1`, "AcquireTaskClaim")),
      runId
    })

    expect(frontier.candidates.map(({ taskId }) => taskId)).toEqual(["A", "A!", "a", "a-", "a."])
  })
)

it.effect("does not expose mutable complete-frontier collections after authority is minted", () =>
  Effect.gen(function* () {
    const frontier = yield* freshTaskCandidateFrontierOf({
      decisions: [decision("A", "A-r1", "AcquireTaskClaim")],
      runId
    })

    expect(isFreshTaskCandidateFrontier(frontier)).toBe(true)
    expect(() =>
      (frontier.candidates as Array<unknown>).push({ _tag: "FreshTaskCandidate", taskId: TaskId.make("fabricated") })
    ).toThrow()
    const candidate = frontier.candidates[0]
    if (candidate === undefined) return yield* Effect.die("missing candidate")
    expect(() =>
      Object.assign(candidate.decision, {
        step: FreshWorkflowStep.AcquireTaskClaim({
          predecessorOperationId: OperationId.make("fabricated-predecessor"),
          task: task("B")
        })
      })
    ).toThrow()
    expect("add" in frontier.entryCapableTaskIds).toBe(false)
    expect(frontier.candidates.map(({ taskId }) => taskId)).toEqual(["A"])
  })
)

it("rejects a reflected copy of genuine complete-frontier authority", () => {
  const frontier = makeFreshTaskCandidateFrontierForTest({
    decisions: [decision("A", "A-r1", "AcquireTaskClaim")],
    runId
  })
  const reflected = Object.freeze(Object.defineProperties({}, Object.getOwnPropertyDescriptors(frontier)))

  expect(isFreshTaskCandidateFrontier(frontier)).toBe(true)
  expect(isFreshTaskCandidateFrontier(reflected)).toBe(false)
})

it("rejects a graph read whose continuation names a different operation", () => {
  const graphDecision = decision("A", "A-r1", "ReadCurrentTaskGraph")
  const invalid = freshTaskCandidateDecisionIssues([
    {
      ...graphDecision,
      transition: RunnableFrontierTransition.ContinueFreshWorkflowOperation({
        operationId: OperationId.make("fresh-candidate:A:wrong-graph"),
        taskId: TaskId.make("A")
      })
    }
  ])

  expect(invalid).toMatchObject({ mismatchedPredecessorTaskIds: ["A"] })
})

it("rejects an entry transition with the right task but the wrong task revision", () => {
  const candidateTask = task("A")
  const predecessorOperationId = OperationId.make("fresh-candidate:revision-mismatch:graph")
  const invalid = freshTaskCandidateDecisionIssues([
    {
      step: FreshWorkflowStep.AcquireTaskClaim({ predecessorOperationId, task: candidateTask }),
      transition: RunnableFrontierTransition.CommitFreshTaskClaimIntent({
        taskId: candidateTask.id,
        taskRevision: TaskRevision.make("wrong-revision")
      })
    }
  ])

  expect(invalid).toMatchObject({ mismatchedTaskIds: ["A"] })
})

const hostileCandidateFrame = (): CurrentDeliveryFrame => {
  const candidateTask = task("A")
  const target = FixtureTarget.make("fresh-candidate-hostile-target")
  const graphProjection = projectTrackerSnapshot({
    revision: "fresh-candidate-hostile-revision",
    tasks: [candidateTask]
  })
  if (graphProjection._tag === "Invalid") return expect.fail("hostile candidate graph fixture must be valid")
  const graphOperation = makeTrackerGraphObservationOperation(
    { _tag: "WorkflowEstablishment" },
    OperationId.make("fresh-candidate-hostile-graph"),
    target,
    [],
    [candidateTask.id]
  )
  const records = [
    {
      event: taskTrackerReadIntent(graphOperation),
      key: intentRecordKey(graphOperation.operationId),
      position: JournalPosition.make(1),
      runId
    },
    {
      event: taskTrackerFactsObservedEvent(
        graphOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(graphOperation, graphProjection.snapshot)
      ),
      key: outcomeRecordKey(graphOperation.operationId),
      position: JournalPosition.make(2),
      runId
    }
  ]
  Object.defineProperty(graphProjection.snapshot, "eligibleTasks", { value: () => [candidateTask, candidateTask] })
  return {
    acceptedAt: JournalPosition.make(2),
    currentGraph: graphProjection.snapshot,
    currentGraphOperationId: graphOperation.operationId,
    pause: { run: { _tag: "RunUnpaused" }, tasks: { _tag: "NoTaskPauses" } },
    responsibility: { entries: [] },
    runControlPolicy: RunControlPolicy.make({
      revision: initialRunPolicyRevision,
      taskExecutionCapacity: TaskWorkCapacity.make(1)
    }),
    runId,
    workflowHistory: { records }
  }
}

it.effect("fails closed when a hostile graph supplies duplicate entry tasks or a different Run", () =>
  Effect.gen(function* () {
    const frame = hostileCandidateFrame()
    const invalid = yield* deriveFreshTaskCandidateEvaluation({
      acceptedAt: frame.acceptedAt,
      activeRefreshBoundaryReached: false,
      frame,
      opportunity: RunActivationOpportunity.OrdinaryRunEntry(),
      recoveredAttemptIds: new Set(),
      runId,
      target: FixtureTarget.make("fresh-candidate-hostile-target")
    }).pipe(Effect.flip)
    if (invalid._tag !== "FreshTaskCandidateFrontierInvalid") {
      return yield* Effect.die(`expected duplicate frontier rejection, received ${invalid._tag}`)
    }
    expect(invalid.duplicateTaskIds).toEqual([TaskId.make("A")])

    const mismatch = yield* deriveFreshTaskCandidateEvaluation({
      acceptedAt: frame.acceptedAt,
      activeRefreshBoundaryReached: false,
      frame,
      opportunity: RunActivationOpportunity.OrdinaryRunEntry(),
      recoveredAttemptIds: new Set(),
      runId: RunId.make("different-run"),
      target: FixtureTarget.make("fresh-candidate-hostile-target")
    }).pipe(Effect.flip)
    expect(mismatch._tag).toBe("FreshTaskCandidateRunMismatch")
  })
)

it.effect("withholds admission authority when the descriptive candidate view contradicts the complete frontier", () =>
  Effect.gen(function* () {
    const frontier = yield* freshTaskCandidateFrontierOf({
      decisions: [decision("A", "A-r1", "AcquireTaskClaim"), decision("B", "B-r1", "AcquireTaskClaim")],
      runId
    })

    expect(
      freshTaskCandidateObservationOf({
        _tag: "DeliveryProposalsAvailable",
        freshTaskCandidateFrontier: frontier,
        freshTaskCandidates: frontier.candidates.slice(1),
        isolatedIssues: [],
        proposals: []
      })
    ).toEqual({ _tag: "FreshTaskCandidateObservationUnavailable" })
    expect(
      freshTaskCandidateObservationOf({
        _tag: "DeliveryProposalsAvailable",
        freshTaskCandidateFrontier: frontier,
        freshTaskCandidates: frontier.candidates,
        isolatedIssues: [],
        proposals: []
      })
    ).toBe(frontier)
  })
)
