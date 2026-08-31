import {
  AttemptId,
  PlannedTaskAttempt,
  type RunId,
  TaskBranchRef,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { TaskLifecycle, type Task } from "../../src/authorities/task-tracker/task.js"
import { FreshWorkflowStep } from "../../src/coordination/delivery/fresh-workflow-step.js"
import { deliveryProposalsOf } from "../../src/coordination/delivery/delivery-proposal.js"
import { RunnableFrontierTransition } from "../../src/coordination/frontier/frontier.js"

/** Production-derived prepared Begin facts shared by vertical runtime tests. */
export const makePreparedBeginFixture = (base: PlannedTaskAttempt, namespace: string, name: string) => {
  const taskId = TaskId.make(`${namespace}-${name}`)
  const specification = makeTaskWorkSpecification({ body: `${name} body`, taskId, title: `${name} title` })
  const task = {
    id: taskId,
    lifecycle: TaskLifecycle.cases.Open.make({}),
    parentTaskId: null,
    prerequisiteIds: []
  } satisfies Task
  const attempt = PlannedTaskAttempt.make({
    ...base,
    attemptId: AttemptId.make(`${namespace}-${name}-attempt`),
    branch: TaskBranchRef.make(`refs/heads/dalph/${namespace}-${name}`),
    taskId,
    taskRevision: specification.fingerprint,
    worktree: WorktreeLocator.make(`/${namespace}/${name}`)
  })
  const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt: attempt })
  return {
    attempt,
    fresh: {
      step: FreshWorkflowStep.BeginPlannedAttemptExecutorWork({ plannedAttempt: attempt, specification, task }),
      transition
    },
    task,
    transition
  }
}

export const preparedBeginProposalsOf = (
  runId: RunId,
  fixtures: ReadonlyArray<ReturnType<typeof makePreparedBeginFixture>>
) =>
  deliveryProposalsOf({
    acceptedOperationIds: new Set(),
    fresh: fixtures.map(({ fresh }) => fresh),
    runId,
    transitions: fixtures.map(({ transition }) => transition)
  }).ticketDelivery
