/* eslint-disable import/no-nodejs-modules -- This file also guards the accepted literal source shape. */
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutorReport,
  PlannedAttemptExecutorResult,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect, Exit, Option, Schema, Stream } from "effect"
import { expect } from "vitest"
import { TaskDagSnapshot } from "../../authorities/task-tracker/graph.js"
import { FixtureTarget } from "../../authorities/task-tracker/fixture/target.js"
import { TaskLifecycle, TrackerRevision, TrackerSnapshot } from "../../authorities/task-tracker/task.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { initialRunPolicyRevision, RunControlPolicy } from "../../control/policy.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import { ResponsibilityDisposition } from "../frontier/fresh-facts.js"
import { deliveryRuntime } from "./delivery-runtime-adapter.js"
import {
  acceptedTrackerGraphObservationOf,
  TrackerGraphRelation,
  boundedParallelTickets,
  currentSignalOf,
  deliveryFinalityOf,
  deliverySettlements,
  executorResponsibilities,
  mapCurrentSignal,
  PlannedAttemptExecutorTerminalEvidence,
  TrackerGraphState
} from "./relations.js"
import {
  deterministicDeliveryRuntimeSupport,
  makeDeliveryRelationsLayer as makeDeliveryRelationsLayerWithRuntime
} from "./in-memory-relations.js"
import { trackerGraphReadProposalOf } from "./delivery-proposal.js"
import { frontierOf } from "./ticket-delivery-projection.js"

const policy = RunControlPolicy.make({
  revision: initialRunPolicyRevision,
  taskExecutionCapacity: TaskWorkCapacity.make(1)
})

const makeDeliveryRelationsLayer = (
  input: Omit<
    Parameters<typeof makeDeliveryRelationsLayerWithRuntime>[0],
    "evaluationConsistency" | "invalidate" | "runtimeFacts"
  >
) => makeDeliveryRelationsLayerWithRuntime({ ...deterministicDeliveryRuntimeSupport(policy), ...input })

const acceptedGraph = (revision: string, taskIds: ReadonlyArray<TaskId> = []) => {
  const projected = TaskDagSnapshot.project(
    TrackerSnapshot.make({
      revision: TrackerRevision.make(revision),
      tasks: taskIds.map((id) => ({
        id,
        lifecycle: TaskLifecycle.cases.Open.make({}),
        parentTaskId: null,
        prerequisiteIds: []
      }))
    })
  )
  if (projected._tag === "Invalid") return expect.fail("test graph must be valid")
  return projected.snapshot
}

const acceptedGraphState = (snapshot: ReturnType<typeof acceptedGraph>) =>
  TrackerGraphState.cases.GraphEstablished.make({ observation: acceptedTrackerGraphObservationOf(snapshot) })

const exactAttemptEvidence = (taskId: TaskId) => ({
  _tag: "ResponsibilityFacts" as const,
  facts: {
    _tag: "PlannedAttemptExecutorFreshFacts" as const,
    disposition: ResponsibilityDisposition.Ready(),
    responsibility: {
      _tag: "PlannedAttemptExecutorWorkResponsibility" as const,
      beganAt: JournalPosition.make(2),
      plannedAttempt: PlannedTaskAttempt.make({
        attemptId: AttemptId.make(`attempt:${taskId}`),
        baseSha: GitCommitSha.make("1".repeat(40)),
        branch: TaskBranchRef.make(`refs/heads/dalph/${taskId}`),
        executor: TaskExecutorLocator.make("executor:fake"),
        runId: RunId.make("run-reactive-delivery"),
        taskId,
        taskRevision: TaskRevision.make(`revision:${taskId}`),
        worktree: WorktreeLocator.make(`/worktrees/${taskId}`)
      })
    }
  }
})
it.effect("assembles the literal delivery relation with honestly empty settlements", () =>
  Effect.gen(function* () {
    const layer = makeDeliveryRelationsLayer({
      graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    })
    const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))

    const first = Array.from(yield* Stream.runCollect(relation.current.changes))
    const second = Array.from(yield* Stream.runCollect(relation.current.changes))

    expect(first).toHaveLength(1)
    expect(second).toEqual(first)
    expect(first[0]?.ticketDeliveries.deliveries).toEqual([])
    expect(first[0]?.settlements.settlements).toEqual([])
  })
)

it.effect("rejects nonterminal executor reports as terminal delivery evidence", () =>
  Effect.gen(function* () {
    const correlation = { attemptId: AttemptId.make("attempt-A"), runId: RunId.make("run-A") }
    const reports = [
      PlannedAttemptExecutorReport.cases.Running.make({ correlation }),
      PlannedAttemptExecutorReport.cases.SafelySuspended.make({ correlation })
    ]

    for (const report of reports) {
      const decoded = yield* Effect.exit(
        Schema.decodeUnknownEffect(PlannedAttemptExecutorTerminalEvidence)({
          _tag: "PlannedAttemptExecutorTerminal",
          report
        })
      )
      expect(Exit.isFailure(decoded)).toBe(true)
    }
  })
)

it.effect("treats only an accepted synthetic terminal report as unsettled delivery", () =>
  Effect.gen(function* () {
    const taskId = TaskId.make("synthetic-finality")
    const current = Option.getOrThrow(
      yield* deliveryRuntime.pipe(
        Effect.provide(
          makeDeliveryRelationsLayer({
            exactEvidence: currentSignalOf([]),
            graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
            policy: currentSignalOf(policy)
          })
        ),
        Effect.flatMap((relation) => relation.current.changes.pipe(Stream.runHead))
      )
    )
    const correlation = { attemptId: AttemptId.make("synthetic-finality-attempt"), runId: RunId.make("synthetic") }
    const finalityFor = (result: PlannedAttemptExecutorResult) =>
      deliveryFinalityOf(
        {
          ...current,
          ticketDeliveries: {
            ...current.ticketDeliveries,
            deliveries: [
              {
                _tag: "TicketDelivery",
                evidence: [],
                obligations: [],
                placement: { _tag: "GraphNotEstablished" },
                standings: [
                  {
                    _tag: "SyntheticExecutorSituation",
                    plannedAttempt: exactAttemptEvidence(taskId).facts.responsibility.plannedAttempt,
                    report: PlannedAttemptExecutorReport.cases.Terminal.make({ correlation, result })
                  }
                ],
                taskId
              }
            ]
          }
        },
        { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] },
        { _tag: "QuiescencePassive", reason: "ProbeNotRequired" }
      )

    expect(finalityFor(PlannedAttemptExecutorResult.cases.Completed.make({}))).toEqual({
      _tag: "RunMustRemainActive",
      reason: "TrackerTargetUnsettled"
    })
    expect(
      finalityFor(
        PlannedAttemptExecutorResult.cases.Accepted.make({
          acceptedResult: { commit: GitCommitSha.make("3".repeat(40)) }
        })
      )
    ).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
  })
)

it.effect("keeps a settled accepted graph active while the Run is paused", () =>
  Effect.gen(function* () {
    const layer = makeDeliveryRelationsLayer({
      exactEvidence: currentSignalOf([]),
      graph: currentSignalOf(acceptedGraphState(acceptedGraph("paused-settled"))),
      policy: currentSignalOf(policy)
    })
    const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))
    const current = Option.getOrThrow(yield* relation.current.changes.pipe(Stream.runHead))

    expect(
      deliveryFinalityOf(
        current,
        { _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] },
        { _tag: "QuiescencePassive", reason: "RunPaused" }
      )
    ).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
  })
)

it.effect("keeps every descriptive subscription action-free", () =>
  Effect.gen(function* () {
    const layer = makeDeliveryRelationsLayer({
      graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    })
    const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))

    const first = Array.from(yield* Stream.runCollect(relation.proposedActions.changes))
    const second = Array.from(yield* Stream.runCollect(relation.proposedActions.changes))
    yield* relation.invalidate({ _tag: "AcceptedFactsChanged" })

    expect(first).toEqual([{ _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] }])
    expect(second).toEqual(first)
  })
)

it.effect("exposes each lower proposal stream without performing an action", () =>
  Effect.gen(function* () {
    const layer = makeDeliveryRelationsLayer({
      graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    })
    const lower = yield* Effect.gen(function* () {
      const tracker = yield* TrackerGraphRelation
      const tickets = yield* boundedParallelTickets(mapCurrentSignal(tracker.signal, frontierOf))
      const responsibilities = yield* executorResponsibilities(tickets)
      const settlements = yield* deliverySettlements(responsibilities)
      return { responsibilities, settlements }
    }).pipe(Effect.provide(layer))

    expect(Array.from(yield* Stream.runCollect(lower.responsibilities.proposedActions.changes))).toEqual([[]])
    expect(Array.from(yield* Stream.runCollect(lower.settlements.proposedActions.changes))).toEqual([[]])
  })
)

it.effect("cannot carry an initial graph-read proposal into an established graph revision", () =>
  Effect.gen(function* () {
    const proposal = trackerGraphReadProposalOf({
      acceptedAt: JournalPosition.make(1),
      purpose: "EstablishCurrentGraph",
      runId: RunId.make("causal-tracker-proposal"),
      target: FixtureTarget.make("causal-tracker-proposal-target")
    })
    const relation = yield* deliveryRuntime.pipe(
      Effect.provide(
        makeDeliveryRelationsLayer({
          exactEvidence: currentSignalOf([]),
          graph: {
            changes: Stream.make(
              TrackerGraphState.cases.GraphNotEstablished.make({}),
              acceptedGraphState(acceptedGraph("causal-established"))
            )
          },
          policy: currentSignalOf(policy),
          trackerGraphProposals: currentSignalOf([proposal])
        })
      )
    )

    const frontiers = Array.from(yield* Stream.runCollect(relation.proposedActions.changes))

    expect(frontiers[0]).toMatchObject({
      _tag: "DeliveryProposalsAvailable",
      proposals: [{ id: proposal.id, route: { purpose: "EstablishCurrentGraph" } }]
    })
    expect(frontiers.at(-1)).toEqual({ _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] })
  })
)

it.effect("fails closed when two lower relations claim one exact proposal identity", () =>
  Effect.gen(function* () {
    const proposal = trackerGraphReadProposalOf({
      acceptedAt: JournalPosition.make(1),
      purpose: "EstablishCurrentGraph",
      runId: RunId.make("proposal-conflict"),
      target: FixtureTarget.make("proposal-conflict-target")
    })
    const layer = makeDeliveryRelationsLayer({
      exactEvidence: currentSignalOf([]),
      graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
      policy: currentSignalOf(policy),
      proposalContributions: currentSignalOf({
        deliverySettlement: [{ ...proposal, owner: "DeliverySettlement" }],
        issues: [],
        ticketDelivery: [{ ...proposal, owner: "TicketDelivery" }]
      }),
      trackerGraphProposals: currentSignalOf([proposal])
    })
    const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))

    const frontier = Option.getOrThrow(yield* relation.proposedActions.changes.pipe(Stream.runHead))
    const evaluation = Option.getOrThrow(yield* relation.evaluations.changes.pipe(Stream.runHead))

    expect(frontier).toEqual({
      _tag: "DeliveryProposalOwnershipConflict",
      conflicts: [{ id: proposal.id, owners: ["TrackerGraph", "TicketDelivery", "DeliverySettlement"] }]
    })
    expect(evaluation.finality).toEqual({ _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" })
  })
)

it.effect("carries every lower owner's pure proposal through the literal delivery composition", () =>
  Effect.gen(function* () {
    const target = FixtureTarget.make("proposal-composition-target")
    const proposalFor = (
      position: number,
      owner: "DeliveryReflection" | "DeliverySettlement" | "TicketDelivery" | "TrackerGraph"
    ) => ({
      ...trackerGraphReadProposalOf({
        acceptedAt: JournalPosition.make(position),
        purpose: position === 1 ? "EstablishCurrentGraph" : "QuiescenceProbe",
        runId: RunId.make("proposal-composition"),
        target: FixtureTarget.make(`proposal-composition-target-${position}`)
      }),
      owner
    })
    const tracker = trackerGraphReadProposalOf({
      acceptedAt: JournalPosition.make(1),
      purpose: "EstablishCurrentGraph",
      runId: RunId.make("proposal-composition"),
      target
    })
    const ticket = proposalFor(2, "TicketDelivery")
    const settlement = proposalFor(3, "DeliverySettlement")
    const reflection = proposalFor(4, "DeliveryReflection")
    const relation = yield* deliveryRuntime.pipe(
      Effect.provide(
        makeDeliveryRelationsLayer({
          exactEvidence: currentSignalOf([]),
          graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
          policy: currentSignalOf(policy),
          proposalContributions: currentSignalOf({
            deliverySettlement: [settlement],
            issues: [],
            ticketDelivery: [ticket]
          }),
          reflectionProposals: currentSignalOf([reflection]),
          trackerGraphProposals: currentSignalOf([tracker])
        })
      )
    )

    const frontier = Option.getOrThrow(yield* relation.proposedActions.changes.pipe(Stream.runHead))

    expect(frontier._tag).toBe("DeliveryProposalsAvailable")
    if (frontier._tag === "DeliveryProposalsAvailable") {
      expect(new Set(frontier.proposals.map(({ owner }) => owner))).toEqual(
        new Set(["TrackerGraph", "TicketDelivery", "DeliverySettlement", "DeliveryReflection"])
      )
    }
  })
)

it.effect("keeps empty settlements action-free after reconstructing the relation on restart", () =>
  Effect.gen(function* () {
    const input = {
      graph: currentSignalOf(TrackerGraphState.cases.GraphNotEstablished.make({})),
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    }
    const evaluate = Effect.gen(function* () {
      const relation = yield* deliveryRuntime.pipe(Effect.provide(makeDeliveryRelationsLayer(input)))
      return {
        actions: Array.from(yield* Stream.runCollect(relation.proposedActions.changes)),
        current: Array.from(yield* Stream.runCollect(relation.current.changes))
      }
    })

    const beforeStop = yield* evaluate
    const afterRestart = yield* evaluate

    expect(beforeStop.actions).toEqual([{ _tag: "DeliveryProposalsAvailable", isolatedIssues: [], proposals: [] }])
    expect(afterRestart).toEqual(beforeStop)
    expect(afterRestart.current[0]?.settlements.settlements).toEqual([])
  })
)

it.effect("preserves each causal graph revision through final reflection", () =>
  Effect.gen(function* () {
    const graphOne = acceptedGraphState(acceptedGraph("graph-1"))
    const graphTwo = acceptedGraphState(acceptedGraph("graph-2"))
    const layer = makeDeliveryRelationsLayer({
      graph: { changes: Stream.fromIterable([graphOne, graphTwo]) },
      exactEvidence: currentSignalOf([]),
      policy: currentSignalOf(policy)
    })
    const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))

    const reflections = Array.from(yield* Stream.runCollect(relation.current.changes))

    expect(reflections.map(({ trackerGraph }) => trackerGraph)).toEqual([graphOne, graphTwo])
  })
)

it.effect("recomputes the same flat relation when the current policy changes", () =>
  Effect.gen(function* () {
    const taskA = TaskId.make("A")
    const taskB = TaskId.make("B")
    const capacityTwo = RunControlPolicy.make({
      revision: initialRunPolicyRevision,
      taskExecutionCapacity: TaskWorkCapacity.make(2)
    })
    const layer = makeDeliveryRelationsLayer({
      graph: currentSignalOf(acceptedGraphState(acceptedGraph("graph-policy", [taskA, taskB]))),
      exactEvidence: currentSignalOf([]),
      policy: { changes: Stream.make(policy, capacityTwo).pipe(Stream.rechunk(1)) }
    })
    const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))

    const reflections = Array.from(yield* Stream.runCollect(relation.current.changes))

    expect(reflections.map(({ ticketDeliveries }) => ticketDeliveries.deliveries.map(({ taskId }) => taskId))).toEqual([
      [taskA],
      [taskA, taskB]
    ])
  })
)

it.effect("recomputes the same flat relation when exact responsibility evidence changes", () =>
  Effect.gen(function* () {
    const taskA = TaskId.make("A")
    const taskB = TaskId.make("B")
    const layer = makeDeliveryRelationsLayer({
      graph: currentSignalOf(acceptedGraphState(acceptedGraph("graph-evidence", [taskA, taskB]))),
      exactEvidence: { changes: Stream.make([], [exactAttemptEvidence(taskB)]).pipe(Stream.rechunk(1)) },
      policy: currentSignalOf(policy)
    })
    const relation = yield* deliveryRuntime.pipe(Effect.provide(layer))

    const reflections = Array.from(yield* Stream.runCollect(relation.current.changes))

    expect(reflections.map(({ ticketDeliveries }) => ticketDeliveries.deliveries.map(({ taskId }) => taskId))).toEqual([
      [taskA],
      [taskA, taskB]
    ])
    expect(reflections[1]?.ticketDeliveries.deliveries.find(({ taskId }) => taskId === taskB)?.placement._tag).toBe(
      "EligibleOutsideBound"
    )
  })
)

it("keeps the production delivery Effect flat and free of runtime-coloured coordination", () => {
  const deliverySource = readFileSync(fileURLToPath(new URL("./delivery.ts", import.meta.url)), "utf8")
  const relationSource = readFileSync(fileURLToPath(new URL("./relations.ts", import.meta.url)), "utf8")
  const projectionSource = readFileSync(
    fileURLToPath(new URL("./ticket-delivery-projection.ts", import.meta.url)),
    "utf8"
  )
  const proposalSource = readFileSync(fileURLToPath(new URL("./delivery-proposal.ts", import.meta.url)), "utf8")
  const proposalModelSource = readFileSync(
    fileURLToPath(new URL("./delivery-action-proposal.ts", import.meta.url)),
    "utf8"
  )
  const proposalDerivationSource = readFileSync(
    fileURLToPath(new URL("./delivery-proposal-derivation.ts", import.meta.url)),
    "utf8"
  )
  const proposalRouteSource = readFileSync(
    fileURLToPath(new URL("./delivery-proposal-route.ts", import.meta.url)),
    "utf8"
  )
  const runSource = readFileSync(fileURLToPath(new URL("../run/run.ts", import.meta.url)), "utf8")

  const outerEffect = deliverySource.slice(deliverySource.indexOf("export const delivery"))
  expect(outerEffect).toBe(`export const delivery = Effect.gen(function* () {
  const trackerGraph = yield* TrackerGraphRelation

  const graph = trackerGraph.signal
  const frontier = mapCurrentSignal(graph, frontierOf)
  const tickets = yield* boundedParallelTickets(frontier)
  const responsibilities = yield* executorResponsibilities(tickets)
  const settlements = yield* deliverySettlements(responsibilities)

  return yield* reflectDeliverySettlements(settlements)
})
`)

  const completeDeliverySource = `${deliverySource}\n${relationSource}\n${projectionSource}\n${proposalSource}\n${proposalModelSource}\n${proposalDerivationSource}\n${proposalRouteSource}`
  const importedModules = Array.from(
    deliverySource.matchAll(/^import\s+(?:(?:.|\n)*?\s+from\s+)?"([^"]+)"\s*$/gm),
    ([, moduleName]) => moduleName
  )
  expect(importedModules).toEqual(["effect", "./relations.js", "./ticket-delivery-projection.js"])
  expect(completeDeliverySource).not.toMatch(
    /\b(?:JournalStore|WorkflowInterpreter|RunRecoveryActivation|TaskAdmissionController|makeActivationCoordinator|Queue|Ref|Semaphore|fork|runDeliveryActivation)\b/
  )
  expect(projectionSource).not.toMatch(/coordination\/(?:admission|frontier|run)/)
  expect(`${proposalSource}\n${proposalModelSource}\n${proposalDerivationSource}\n${proposalRouteSource}`).not.toMatch(
    /(?:\.\.\/admission\/controller|\.\.\/run\/|\b(?:Effect|Queue|Ref|Semaphore|WorkflowInterpreter)\b)/
  )
  expect(runSource.match(/\bdeliveryRuntime\.pipe\(/g)).toHaveLength(1)
  expect(runSource.match(/\brunDeliveryRuntime\(/g)).toHaveLength(1)
})

it("keeps the live action dispatcher free of workflow protocol implementations", () => {
  const dispatcherSource = readFileSync(
    fileURLToPath(new URL("./live-delivery-action-executor.ts", import.meta.url)),
    "utf8"
  )

  expect(dispatcherSource).not.toMatch(/workflow\/protocols|coordination\/run|workflow\/registry/)
  expect(dispatcherSource).toContain('from "./fresh-delivery-action-adapter.js"')
  expect(dispatcherSource).toContain('from "./recovered-delivery-action-adapter.js"')
  expect(dispatcherSource).toContain('from "./planned-attempt-delivery-action-adapter.js"')
  expect(dispatcherSource).toContain('from "./integration-delivery-action-adapter.js"')
})
