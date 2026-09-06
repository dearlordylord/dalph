import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  makeTaskWorkSpecification,
  RunId,
  TaskId
} from "@dalph/contracts"
import {
  FixtureTarget,
  InitialControlPolicy,
  projectTrackerSnapshot,
  TaskLifecycle,
  TaskWorkCapacity,
  TrackerRevision
} from "@dalph/orchestrator"
import { Effect } from "effect"

// eslint-disable-next-line no-magic-numbers -- P1's accepted task-work capacity is exactly three.
const initialCapacity = TaskWorkCapacity.make(3)
// eslint-disable-next-line no-magic-numbers -- P2's accepted task-work capacity is exactly two.
const contractedCapacity = TaskWorkCapacity.make(2)
const taskIds = ["A", "B", "C", "D", "E"] as const

const taskIdByName = {
  A: TaskId.make("A"),
  B: TaskId.make("B"),
  C: TaskId.make("C"),
  D: TaskId.make("D"),
  E: TaskId.make("E")
}

const openTask = (name: (typeof taskIds)[number]) => ({
  id: taskIdByName[name],
  lifecycle: TaskLifecycle.cases.Open.make({}),
  parentTaskId: null,
  prerequisiteIds: []
})

const graph = (revision: string, closedTask?: "C") => {
  const projected = projectTrackerSnapshot({
    revision: TrackerRevision.make(revision),
    rootTaskId: taskIdByName.A,
    tasks: taskIds.map((name) =>
      name === closedTask
        ? { ...openTask(name), lifecycle: TaskLifecycle.cases.TerminalWithoutSuccess.make({}) }
        : openTask(name)
    )
  })
  if (projected._tag === "Invalid") {
    return Effect.runSync(Effect.die(`invalid issue 268 controlled graph ${revision}`))
  }
  return projected.snapshot
}

const initialSpecification = (name: (typeof taskIds)[number]) =>
  makeTaskWorkSpecification({
    body: `Implement controlled delivery task ${name}.`,
    taskId: taskIdByName[name],
    title: `Implement ${name}`
  })

const initialSpecifications = {
  A: initialSpecification("A"),
  B: initialSpecification("B"),
  C: initialSpecification("C"),
  D: initialSpecification("D"),
  E: initialSpecification("E")
}

const changedBSpecification = makeTaskWorkSpecification({
  body: "Alice changed controlled delivery task B.",
  taskId: taskIdByName.B,
  title: "Implement changed B"
})

/** Controlled provider facts and outside stimuli; observed workflow order is deliberately absent. */
export const issue268ControlledDeliveryCharacterization = {
  attempts: {
    A1: AttemptId.make("attempt:A:1"),
    B1: AttemptId.make("attempt:B:1"),
    C1: AttemptId.make("attempt:C:1"),
    D1: AttemptId.make("attempt:D:1")
  },
  baseSha: GitCommitSha.make("1111111111111111111111111111111111111111"),
  graphs: { G0: graph("G0"), G1: graph("G1"), G2: graph("G2", "C") },
  integrationTarget: IntegrationTarget.make({
    repository: GitRepositoryLocator.make("/dalph/controlled-characterization/issue-268.git"),
    ref: IntegrationTargetRef.make("refs/heads/main")
  }),
  policies: { P1: InitialControlPolicy.make({ taskExecutionCapacity: initialCapacity }), P2: contractedCapacity },
  runId: RunId.make("run:issue-268-controlled"),
  specifications: { F1: initialSpecifications, F2: { ...initialSpecifications, B: changedBSpecification } },
  target: FixtureTarget.make("fixture:issue-268"),
  taskIds: taskIdByName
} as const

export const controlledCharacterizationCatalog = {
  issue268ControlledDelivery: issue268ControlledDeliveryCharacterization
} as const

export type ControlledCharacterizationCatalogEntry = typeof issue268ControlledDeliveryCharacterization
