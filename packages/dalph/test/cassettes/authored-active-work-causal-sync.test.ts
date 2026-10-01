import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Cause, Deferred, Effect, Exit, Fiber, Option, Ref, Schema, Stream } from "effect"
import { expect } from "vitest"
import {
  AttemptId,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorReport,
  RunId,
  TaskId,
  passiveLifecycleObservationPurpose,
  plannedAttemptExecutorCorrelationKey
} from "@dalph/contracts"
import {
  FixtureTarget,
  OperationId,
  TrackerRevision,
  makeTaskWorkSpecificationObservationOperation,
  makeTrackerGraphObservationOperation
} from "@dalph/orchestrator"
import {
  type AuthoredCassetteDecision,
  AuthoredCausalWindow,
  AuthoredCassetteStoryItem,
  AuthoredCausalSelection,
  AuthoredScenarioCassette
} from "../../src/cassettes/authored-domain.js"
import {
  AuthoredCausalSelectionFailure,
  type AuthoredOperationCausalContext,
  type StoryCursor,
  makeStoryCursor
} from "../../src/cassettes/authored-cursor.js"
import { authorCausalWindow, type AuthoredCausalBoundaryNode } from "../../src/cassettes/authored-causal-authoring.js"
import {
  AuthoredOccurrenceId,
  authoredOccurrence,
  parallelAuthored,
  sequenceAuthored
} from "../../src/cassettes/authored-causal-graph.js"
import { controlledExecutorLayer, controlledTrace } from "../../src/cassettes/authored-adapters.js"
import {
  consumeControlledTaskWorkSpecification,
  consumeControlledTrackerGraph
} from "../../src/cassettes/authored-tracker-read-results.js"
import {
  activeWorkF2SafelySuspendsAuthoredCassette,
  runAuthoredScenarioCassette,
  singletonTaskCompletesAuthoredCassette
} from "../../src/cassettes/index.js"

const taskB = TaskId.make("B")
const target = FixtureTarget.make("active-work-target")
const readGraph = { _tag: "ReadTrackerGraph" as const, target }
const readBSpecification = { _tag: "ReadTaskWorkSpecification" as const, taskId: taskB }

const graph = (revision: string) => ({
  revision: TrackerRevision.make(revision),
  rootTaskId: taskB,
  tasks: [{ id: taskB, lifecycle: { _tag: "Open" as const }, parentTaskId: null, prerequisiteIds: [] }]
})

const causal = Schema.decodeUnknownSync(AuthoredCausalSelection)
const causalContext = (
  operationId: string,
  predecessorOperationIds: ReadonlyArray<string>
): AuthoredOperationCausalContext => ({
  operationId: OperationId.make(operationId),
  predecessorOperationIds: predecessorOperationIds.map((operationId) => OperationId.make(operationId))
})

const selection = (
  occurrenceRole: string,
  predecessorRoles: ReadonlyArray<string>,
  operation: AuthoredCassetteDecision = readGraph
) =>
  AuthoredCassetteStoryItem.cases.DalphSelects.make({ causal: causal({ occurrenceRole, predecessorRoles }), operation })

const anchorSelection = (occurrenceRole: string, operation: AuthoredCassetteDecision = readGraph) =>
  Schema.decodeUnknownSync(AuthoredCassetteStoryItem.cases.DalphSelects)({
    _tag: "DalphSelects",
    causalAnchor: { occurrenceRole },
    operation
  })

const graphResult = (revision: string) =>
  AuthoredCassetteStoryItem.cases.TrackerGraphReadReturned.make({ graph: graph(revision) })

const terminal = AuthoredCassetteStoryItem.cases.ExpectedBehavior.make({
  orchestration: null,
  protocol: null,
  taskWork: { absences: [], results: [] }
})

const causalPrefix = [
  selection("independent-G0", []),
  graphResult("G0"),
  selection("active-G1", []),
  graphResult("G1")
] as const

const sameShapeWindow = authorCausalWindow(
  4,
  parallelAuthored<AuthoredCausalBoundaryNode>(
    sequenceAuthored<AuthoredCausalBoundaryNode>(
      authoredOccurrence(AuthoredOccurrenceId.make("independent-B-F1"), {
        item: selection("independent-B-F1", ["independent-G0"], readBSpecification)
      }),
      authoredOccurrence(AuthoredOccurrenceId.make("independent-B-F1:result"), {
        item: AuthoredCassetteStoryItem.cases.TaskWorkSpecificationReadReturned.make({
          body: "Implement B from F1.",
          taskId: taskB,
          title: "B F1"
        }),
        ownerRole: AuthoredOccurrenceId.make("independent-B-F1")
      })
    ),
    sequenceAuthored<AuthoredCausalBoundaryNode>(
      authoredOccurrence(AuthoredOccurrenceId.make("active-B-F2"), {
        item: selection("active-B-F2", ["active-G1"], readBSpecification)
      }),
      authoredOccurrence(AuthoredOccurrenceId.make("active-B-F2:result"), {
        item: AuthoredCassetteStoryItem.cases.TaskWorkSpecificationReadReturned.make({
          body: "Implement B from F2.",
          taskId: taskB,
          title: "B F2"
        }),
        ownerRole: AuthoredOccurrenceId.make("active-B-F2")
      })
    )
  )
)
const sameShapeStory = [...causalPrefix, ...sameShapeWindow.story, terminal]
const sameShapeOptions = { causalWindows: [sameShapeWindow.window] }

const bindCausalPrefix = Effect.fn("AuthoredCassetteTest.bindCausalPrefix")(function* (cursor: StoryCursor) {
  yield* cursor.consumeDalphSelectionFor(readGraph, causalContext("operation:G0", []))
  yield* cursor.consumeTrackerGraphFor(target, causalContext("operation:G0", []))
  yield* cursor.consumeDalphSelectionFor(readGraph, causalContext("operation:G1", []))
  yield* cursor.consumeTrackerGraphFor(target, causalContext("operation:G1", []))
})

it.effect("replays opposite graph, specification, and worktree selection orders from one causal window", () =>
  Effect.gen(function* () {
    const worktree = { _tag: "ReconcileTaskWorktree" as const, taskId: taskB, attemptId: AttemptId.make("B2") }
    const specificationResult = AuthoredCassetteStoryItem.cases.TaskWorkSpecificationReadReturned.make({
      body: "Implement changed B.",
      taskId: taskB,
      title: "B F2"
    })
    const window = Schema.decodeUnknownSync(AuthoredCausalWindow)({
      startIndex: 0,
      endIndex: 5,
      occurrences: [
        { id: "G", storyIndex: 0, predecessorIds: [] },
        { id: "G-result", storyIndex: 1, predecessorIds: ["G"], ownerRole: "G" },
        { id: "F", storyIndex: 2, predecessorIds: [] },
        { id: "F-result", storyIndex: 3, predecessorIds: ["F"], ownerRole: "F" },
        { id: "W", storyIndex: 4, predecessorIds: ["F-result"] }
      ]
    })
    const story = [
      AuthoredCassetteStoryItem.cases.DalphSelects.make({ operation: readGraph }),
      graphResult("G2"),
      AuthoredCassetteStoryItem.cases.DalphSelects.make({ operation: readBSpecification }),
      specificationResult,
      AuthoredCassetteStoryItem.cases.DalphSelects.make({ operation: worktree }),
      terminal
    ]
    const early = yield* makeStoryCursor(story, { causalWindows: [window] })
    const blocked = yield* Effect.flip(early.consumeDalphSelectionFor(worktree, causalContext("operation:W:early", [])))
    expect(blocked).toBeInstanceOf(AuthoredCausalSelectionFailure)
    if (blocked instanceof AuthoredCausalSelectionFailure)
      expect(blocked.detail).toContain("unmet predecessors: F-result")
    yield* early.consumeDalphSelectionFor(readBSpecification, causalContext("operation:F:early", []))
    const wrongOwner = yield* Effect.flip(
      early.consumeTaskWorkSpecificationFor(taskB, causalContext("operation:G:foreign", []))
    )
    expect(wrongOwner).toBeInstanceOf(AuthoredCausalSelectionFailure)
    if (wrongOwner instanceof AuthoredCausalSelectionFailure)
      expect(wrongOwner.detail).toContain("requires exact selected owner F")
    const wrongTarget = yield* makeStoryCursor(story, { causalWindows: [window] })
    const graphOwner = causalContext("operation:G:target", [])
    yield* wrongTarget.consumeDalphSelectionFor(readGraph, graphOwner)
    const targetFailure = yield* Effect.flip(
      wrongTarget.consumeTrackerGraphFor(FixtureTarget.make("another-target"), graphOwner)
    )
    expect(targetFailure).toBeInstanceOf(AuthoredCausalSelectionFailure)
    if (targetFailure instanceof AuthoredCausalSelectionFailure) {
      expect(targetFailure.detail).toContain("different boundary request")
    }
    expect((yield* wrongTarget.consumeTrackerGraphFor(target, graphOwner))._tag).toBe("TrackerGraphReadReturned")
    for (const order of [
      ["F", "F-result", "W", "G", "G-result"],
      ["G", "F", "G-result", "F-result", "W"]
    ]) {
      const cursor = yield* makeStoryCursor(story, { causalWindows: [window] })
      const contexts = {
        F: causalContext("operation:F", []),
        G: causalContext("operation:G", []),
        W: causalContext("operation:W", [])
      }
      for (const step of order) {
        switch (step) {
          case "F":
            yield* cursor.consumeDalphSelectionFor(readBSpecification, contexts.F)
            break
          case "F-result":
            expect((yield* cursor.consumeTaskWorkSpecificationFor(taskB, contexts.F)).title).toBe("B F2")
            break
          case "G":
            yield* cursor.consumeDalphSelectionFor(readGraph, contexts.G)
            break
          case "G-result":
            expect((yield* cursor.consumeTrackerGraphFor(target, contexts.G))._tag).toBe("TrackerGraphReadReturned")
            break
          case "W":
            yield* cursor.consumeDalphSelectionFor(worktree, contexts.W)
            break
        }
      }
      expect(yield* cursor.storyPosition).toBe(5)
      yield* cursor.consumeTerminalAssertions
    }
  })
)

it.effect("records concurrent causal claims in the same order as atomic consumption", () =>
  Effect.gen(function* () {
    const firstCaptured = yield* Deferred.make<void>()
    const releaseFirst = yield* Deferred.make<void>()
    const secondStarted = yield* Deferred.make<void>()
    const captureOrder: Array<string> = []
    const first = { _tag: "AcquireTaskClaim" as const, taskId: TaskId.make("A") }
    const second = { _tag: "AcquireTaskClaim" as const, taskId: TaskId.make("B") }
    const authored = authorCausalWindow(
      0,
      parallelAuthored<AuthoredCausalBoundaryNode>(
        authoredOccurrence(AuthoredOccurrenceId.make("A"), { item: selection("A", [], first) }),
        authoredOccurrence(AuthoredOccurrenceId.make("B"), { item: selection("B", [], second) })
      )
    )
    const cursor = yield* makeStoryCursor([...authored.story, terminal], {
      causalWindows: [authored.window],
      onOccurrence: ({ occurrenceId }) =>
        Effect.gen(function* () {
          if (occurrenceId === "A") {
            yield* Deferred.succeed(firstCaptured, undefined)
            yield* Deferred.await(releaseFirst)
          }
          if (occurrenceId !== undefined) captureOrder.push(occurrenceId)
        })
    })
    const firstFiber = yield* cursor
      .consumeDalphSelectionFor(first, causalContext("operation:A", []))
      .pipe(Effect.forkChild)
    yield* Deferred.await(firstCaptured)
    const secondFiber = yield* Effect.gen(function* () {
      yield* Deferred.succeed(secondStarted, undefined)
      return yield* cursor.consumeDalphSelectionFor(second, causalContext("operation:B", []))
    }).pipe(Effect.forkChild)
    yield* Deferred.await(secondStarted)
    yield* Deferred.succeed(releaseFirst, undefined)
    yield* Fiber.join(firstFiber)
    yield* Fiber.join(secondFiber)
    expect(captureOrder).toEqual(["A", "B"])
  })
)

it.effect("replays independent A-E boundary chains in opposite valid interleavings", () =>
  Effect.gen(function* () {
    const names = ["A", "B", "C", "D", "E"] as const
    const id = (name: string, step: string) => AuthoredOccurrenceId.make(`${name}:${step}`)
    const operation = (name: string, step: string) => {
      const taskId = TaskId.make(name)
      const attemptId = AttemptId.make(`attempt:${name}:0`)
      switch (step) {
        case "claim":
          return { _tag: "AcquireTaskClaim" as const, taskId }
        case "graph":
          return readGraph
        case "spec":
          return { _tag: "ReadTaskWorkSpecification" as const, taskId }
        case "plan":
          return { _tag: "RecordTaskAttemptPlan" as const, taskId, attemptId }
        default:
          return { _tag: "ReconcileTaskWorktree" as const, taskId, attemptId }
      }
    }
    const chain = (name: (typeof names)[number]) =>
      sequenceAuthored<AuthoredCausalBoundaryNode>(
        authoredOccurrence(id(name, "claim"), { item: selection(`${name}:claim`, [], operation(name, "claim")) }),
        authoredOccurrence(id(name, "graph"), {
          item: selection(`${name}:graph`, [`${name}:claim`], operation(name, "graph"))
        }),
        authoredOccurrence(id(name, "graph-result"), { item: graphResult(`G-${name}`), ownerRole: id(name, "graph") }),
        authoredOccurrence(id(name, "spec"), {
          item: selection(`${name}:spec`, [`${name}:graph`], operation(name, "spec"))
        }),
        authoredOccurrence(id(name, "spec-result"), {
          item: AuthoredCassetteStoryItem.cases.TaskWorkSpecificationReadReturned.make({
            taskId: TaskId.make(name),
            title: name,
            body: name
          }),
          ownerRole: id(name, "spec")
        }),
        authoredOccurrence(id(name, "plan"), {
          item: AuthoredCassetteStoryItem.cases.DalphSelects.make({ operation: operation(name, "plan") })
        }),
        authoredOccurrence(id(name, "worktree"), {
          item: AuthoredCassetteStoryItem.cases.DalphSelects.make({ operation: operation(name, "worktree") })
        }),
        authoredOccurrence(id(name, "executor"), {
          item: AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorWorkReported.make({
            request: "Begin",
            report: { _tag: "ExecutorWorkExecuting", attemptId: AttemptId.make(`attempt:${name}:0`) }
          })
        })
      )
    const authored = authorCausalWindow(
      0,
      parallelAuthored<AuthoredCausalBoundaryNode>(chain("A"), chain("B"), chain("C"), chain("D"), chain("E"))
    )
    const premature = yield* makeStoryCursor([...authored.story, terminal], { causalWindows: [authored.window] })
    for (const [step, predecessor] of [
      ["plan", "A:spec-result"],
      ["worktree", "A:plan"]
    ] as const) {
      const failure = yield* Effect.flip(
        premature.consumeDalphSelectionFor(operation("A", step), causalContext(`operation:A:${step}:early`, []))
      )
      expect(failure).toBeInstanceOf(AuthoredCausalSelectionFailure)
      if (failure instanceof AuthoredCausalSelectionFailure) {
        expect(failure.detail).toContain(`unmet predecessors: ${predecessor}`)
      }
    }
    const unfinished = yield* Effect.flip(premature.consumeTerminalAssertions)
    expect(unfinished).toBeInstanceOf(AuthoredCausalSelectionFailure)
    if (unfinished instanceof AuthoredCausalSelectionFailure) {
      expect(unfinished.detail).toContain("unconsumed required occurrences: A:claim")
      expect(unfinished.detail).toContain("E:executor")
    }
    const play = (order: ReadonlyArray<(typeof names)[number]>) =>
      Effect.gen(function* () {
        const cursor = yield* makeStoryCursor([...authored.story, terminal], { causalWindows: [authored.window] })
        for (const name of order) {
          const claim = causalContext(`operation:${name}:claim`, [])
          const graphContext = causalContext(`operation:${name}:graph`, [`operation:${name}:claim`])
          const spec = causalContext(`operation:${name}:spec`, [`operation:${name}:graph`])
          yield* cursor.consumeDalphSelectionFor(operation(name, "claim"), claim)
          yield* cursor.consumeDalphSelectionFor(readGraph, graphContext)
          yield* cursor.consumeTrackerGraphFor(target, graphContext)
          yield* cursor.consumeDalphSelectionFor(operation(name, "spec"), spec)
          yield* cursor.consumeTaskWorkSpecificationFor(TaskId.make(name), spec)
          yield* cursor.consumeDalphSelectionFor(operation(name, "plan"), causalContext(`operation:${name}:plan`, []))
          yield* cursor.consumeDalphSelectionFor(
            operation(name, "worktree"),
            causalContext(`operation:${name}:worktree`, [])
          )
          yield* cursor.consumeExecutorReportFor("Begin", AttemptId.make(`attempt:${name}:0`))
        }
        expect(yield* cursor.storyPosition).toBe(authored.story.length)
        yield* cursor.consumeTerminalAssertions
      })
    yield* play(names)
    yield* play([...names].reverse())
  })
)

it.effect("distinguishes equal-shaped graph reads by cause and exact response owner", () =>
  Effect.gen(function* () {
    const id = (value: string) => AuthoredOccurrenceId.make(value)
    const selection = AuthoredCassetteStoryItem.cases.DalphSelects.make({ operation: readGraph })
    const authored = authorCausalWindow(
      0,
      parallelAuthored<AuthoredCausalBoundaryNode>(
        sequenceAuthored<AuthoredCausalBoundaryNode>(
          authoredOccurrence(id("restart"), { item: selection, graphReadCause: "AttemptRestartAuthorityCheck" }),
          authoredOccurrence(id("restart-result"), { item: graphResult("restart"), ownerRole: id("restart") })
        ),
        sequenceAuthored<AuthoredCausalBoundaryNode>(
          authoredOccurrence(id("activation"), { item: selection, graphReadCause: "WorkflowEstablishment" }),
          authoredOccurrence(id("activation-result"), { item: graphResult("activation"), ownerRole: id("activation") })
        )
      )
    )
    for (const order of [
      ["restart", "activation"],
      ["activation", "restart"]
    ]) {
      const captured: Array<{
        readonly storyPosition: number
        readonly authoredStoryIndex?: number
        readonly occurrenceId?: string
      }> = []
      const cursor = yield* makeStoryCursor([...authored.story, terminal], {
        causalWindows: [authored.window],
        onOccurrence: (observed) =>
          Effect.sync(() => {
            captured.push(observed)
          })
      })
      const contexts = {
        restart: { ...causalContext("operation:restart", []), graphReadCause: "AttemptRestartAuthorityCheck" as const },
        activation: { ...causalContext("operation:activation", []), graphReadCause: "WorkflowEstablishment" as const }
      }
      for (const role of order) {
        const context = contexts[role as keyof typeof contexts]
        yield* cursor.consumeDalphSelectionFor(readGraph, context)
        const returned = yield* cursor.consumeTrackerGraphFor(target, context)
        expect(returned._tag).toBe("TrackerGraphReadReturned")
        if (returned._tag === "TrackerGraphReadReturned") expect(returned.graph.revision).toBe(role)
      }
      yield* cursor.consumeTerminalAssertions
      expect(captured.map(({ storyPosition }) => storyPosition)).toEqual(
        order[0] === "restart" ? [1, 2, 3, 4, 5] : [0, 0, 1, 4, 5]
      )
      expect(captured.slice(0, 4).map(({ authoredStoryIndex }) => authoredStoryIndex)).toEqual(
        order[0] === "restart" ? [0, 1, 2, 3] : [2, 3, 0, 1]
      )
      expect(captured.slice(0, 4).every(({ occurrenceId }) => occurrenceId !== undefined)).toBe(true)
    }
  })
)

it.effect("rejects a claim response from a different selected operation", () =>
  Effect.gen(function* () {
    const readClaim = { _tag: "ReadTaskClaim" as const, taskId: taskB }
    const window = Schema.decodeUnknownSync(AuthoredCausalWindow)({
      startIndex: 0,
      endIndex: 2,
      occurrences: [
        { id: "claim-selection", storyIndex: 0, predecessorIds: [] },
        { id: "claim-result", storyIndex: 1, predecessorIds: ["claim-selection"], ownerRole: "claim-selection" }
      ]
    })
    const cursor = yield* makeStoryCursor(
      [
        AuthoredCassetteStoryItem.cases.DalphSelects.make({ operation: readClaim }),
        AuthoredCassetteStoryItem.cases.TaskClaimCurrentReadReturned.make({ taskId: taskB }),
        terminal
      ],
      { causalWindows: [window] }
    )
    const owner = causalContext("operation:claim-owner", [])
    yield* cursor.consumeDalphSelectionFor(readClaim, owner)
    const wrongOwner = yield* Effect.flip(cursor.consumeTaskClaimReadFor(taskB, causalContext("operation:other", [])))
    expect(wrongOwner.detail).toContain("requires exact selected owner claim-selection")
    const result = yield* cursor.consumeTaskClaimReadFor(taskB, owner)
    expect(Option.isSome(result) && result.value._tag === "TaskClaimCurrentReadReturned").toBe(true)
    yield* cursor.consumeTerminalAssertions
  })
)

it.effect("runs a catalog cassette with a causally authored tracker boundary", () =>
  Effect.gen(function* () {
    const original = singletonTaskCompletesAuthoredCassette
    const window = Schema.decodeUnknownSync(AuthoredCausalWindow)({
      startIndex: 2,
      endIndex: 4,
      occurrences: [
        { id: "initial-graph", storyIndex: 2, predecessorIds: [] },
        { id: "initial-graph-result", storyIndex: 3, predecessorIds: ["initial-graph"], ownerRole: "initial-graph" }
      ]
    })
    const cassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({ ...original, causalWindows: [window] })
    const run = yield* runAuthoredScenarioCassette(cassette)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    const causalCaptures = run.observationCaptures.flatMap((capture) =>
      capture._tag === "AuthoredStoryOccurrenceCaptured" && capture.occurrenceId !== undefined ? [capture] : []
    )
    expect(causalCaptures.map(({ occurrenceId }) => occurrenceId)).toEqual(["initial-graph", "initial-graph-result"])
    expect(causalCaptures.map(({ authoredStoryIndex }) => authoredStoryIndex)).toEqual([2, 3])
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("rejects duplicate causal occurrence IDs before the first boundary call", () =>
  Effect.gen(function* () {
    const duplicate = Schema.decodeUnknownSync(AuthoredCausalWindow)({
      startIndex: 0,
      endIndex: 2,
      occurrences: [
        { id: "same", storyIndex: 0, predecessorIds: [] },
        { id: "same", storyIndex: 1, predecessorIds: [] }
      ]
    })
    const exit = yield* Effect.exit(
      makeStoryCursor([selection("first", []), selection("second", []), terminal], { causalWindows: [duplicate] })
    )
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("AuthoredOccurrenceGraphFailure")
  })
)

it.effect("rejects two enabled same-shaped concurrent reads without choosing array order", () =>
  Effect.gen(function* () {
    const ambiguous = authorCausalWindow(
      0,
      parallelAuthored<AuthoredCausalBoundaryNode>(
        authoredOccurrence(AuthoredOccurrenceId.make("first"), {
          item: AuthoredCassetteStoryItem.cases.DalphSelects.make({ operation: readGraph })
        }),
        authoredOccurrence(AuthoredOccurrenceId.make("second"), {
          item: AuthoredCassetteStoryItem.cases.DalphSelects.make({ operation: readGraph })
        })
      )
    )
    const cursor = yield* makeStoryCursor([...ambiguous.story, terminal], { causalWindows: [ambiguous.window] })
    const failure = yield* Effect.flip(cursor.consumeDalphSelectionFor(readGraph, causalContext("operation:G0", [])))
    expect(failure).toBeInstanceOf(AuthoredCausalSelectionFailure)
    if (failure instanceof AuthoredCausalSelectionFailure) {
      expect(failure.detail).toContain("ambiguous enabled occurrences: first, second")
    }
    expect(yield* cursor.storyPosition).toBe(0)
  })
)

it.effect("binds an exact operation anchor without revalidating its earlier Journal-owned ancestry", () =>
  Effect.gen(function* () {
    const checked = authorCausalWindow(
      1,
      sequenceAuthored<AuthoredCausalBoundaryNode>(
        authoredOccurrence(AuthoredOccurrenceId.make("active-G1"), { item: selection("active-G1", ["plan-B-F1"]) }),
        authoredOccurrence(AuthoredOccurrenceId.make("active-G1:result"), {
          item: graphResult("G1"),
          ownerRole: AuthoredOccurrenceId.make("active-G1")
        })
      )
    )
    const story = [anchorSelection("plan-B-F1", readBSpecification), ...checked.story, terminal]
    const options = { causalWindows: [checked.window] }
    const cursor = yield* makeStoryCursor(story, options)
    const plan = causalContext("operation:plan-B", ["operation:historical-graph", "operation:claim-B"])
    yield* cursor.consumeDalphSelectionFor(readBSpecification, plan)
    yield* cursor.consumeDalphSelectionFor(readGraph, causalContext("operation:G1", ["operation:plan-B"]))
    const returned = yield* cursor.consumeTrackerGraphFor(target, causalContext("operation:G1", ["operation:plan-B"]))
    expect(returned._tag).toBe("TrackerGraphReadReturned")
    if (returned._tag === "TrackerGraphReadReturned") expect(returned.graph.revision).toBe("G1")

    for (const predecessors of [
      ["operation:unknown"],
      ["operation:plan-B", "operation:extra"],
      ["operation:historical-graph"]
    ]) {
      const failing = yield* makeStoryCursor(story, options)
      yield* failing.consumeDalphSelectionFor(readBSpecification, plan)
      const exit = yield* Effect.exit(
        failing.consumeDalphSelectionFor(readGraph, causalContext("operation:G1:invalid", predecessors))
      )
      expect(Exit.isFailure(exit), predecessors.join(",")).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain(AuthoredCausalSelectionFailure.name)
    }
  })
)

it.effect("binds authored roles at the real operation-selection trace seam", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor(sameShapeStory, sameShapeOptions)
    const trace = controlledTrace(cursor)
    const g0 = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make("operation:G0"),
      target
    )
    const g1 = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make("operation:G1"),
      target
    )
    const f1 = makeTaskWorkSpecificationObservationOperation(OperationId.make("operation:B:F1"), target, taskB, [
      g0.operationId
    ])
    const f2 = makeTaskWorkSpecificationObservationOperation(OperationId.make("operation:B:F2"), target, taskB, [
      g1.operationId
    ])
    const contextOf = (operation: typeof g0 | typeof f1): AuthoredOperationCausalContext => ({
      operationId: operation.operationId,
      predecessorOperationIds: operation.predecessorOperationIds
    })

    yield* trace.emit({ _tag: "OperationSelected", operation: g0 })
    expect((yield* consumeControlledTrackerGraph(cursor, target, contextOf(g0))).revision).toBe("G0")
    yield* trace.emit({ _tag: "OperationSelected", operation: g1 })
    expect((yield* consumeControlledTrackerGraph(cursor, target, contextOf(g1))).revision).toBe("G1")
    const boundaryOrder: Array<string> = []
    yield* trace.emit({ _tag: "OperationSelected", operation: f1 })
    boundaryOrder.push("Select F1")
    yield* trace.emit({ _tag: "OperationSelected", operation: f2 })
    boundaryOrder.push("Select F2")
    expect((yield* consumeControlledTaskWorkSpecification(cursor, taskB, contextOf(f2))).title).toBe("B F2")
    boundaryOrder.push("Return F2")
    expect((yield* consumeControlledTaskWorkSpecification(cursor, taskB, contextOf(f1))).title).toBe("B F1")
    boundaryOrder.push("Return F1")
    expect(boundaryOrder).toEqual(["Select F1", "Select F2", "Return F2", "Return F1"])
    expect(yield* cursor.storyPosition).toBe(causalPrefix.length + sameShapeWindow.story.length)
  })
)

it.effect("selects F1 then F2 and pairs reverse-completing reads with their exact initiating operations", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor(sameShapeStory, sameShapeOptions)
    yield* bindCausalPrefix(cursor)

    const activeF2 = causalContext("operation:B:F2", ["operation:G1"])
    const independentF1 = causalContext("operation:B:F1", ["operation:G0"])
    const boundaryOrder: Array<string> = []
    const independentSelection = yield* cursor.consumeDalphSelectionFor(readBSpecification, independentF1)
    boundaryOrder.push("Select F1")
    const activeSelection = yield* cursor.consumeDalphSelectionFor(readBSpecification, activeF2)
    boundaryOrder.push("Select F2")

    expect(independentSelection.operation).toEqual(readBSpecification)
    expect(activeSelection.operation).toEqual(readBSpecification)
    expect((yield* cursor.consumeTaskWorkSpecificationFor(taskB, activeF2)).title).toBe("B F2")
    boundaryOrder.push("Return F2")
    expect((yield* cursor.consumeTaskWorkSpecificationFor(taskB, independentF1)).title).toBe("B F1")
    boundaryOrder.push("Return F1")
    expect(boundaryOrder).toEqual(["Select F1", "Select F2", "Return F2", "Return F1"])
    expect(yield* cursor.storyPosition).toBe(causalPrefix.length + sameShapeWindow.story.length)

    const duplicate = yield* Effect.exit(cursor.consumeDalphSelectionFor(readBSpecification, activeF2))
    expect(Exit.isFailure(duplicate)).toBe(true)
    if (Exit.isFailure(duplicate)) {
      expect(Cause.pretty(duplicate.cause)).toContain("AuthoredCassetteInteractionMismatch")
    }
    expect(yield* cursor.consumeTerminalAssertions).toEqual(terminal)
  })
)

it.effect("fails closed for missing crossed foreign and duplicate causal relationships", () =>
  Effect.gen(function* () {
    const cases = [
      undefined,
      causalContext("operation:B:crossed", ["operation:G0", "operation:G1"]),
      causalContext("operation:B:foreign", ["operation:foreign"])
    ]

    for (const context of cases) {
      const cursor = yield* makeStoryCursor(sameShapeStory, sameShapeOptions)
      yield* bindCausalPrefix(cursor)
      const exit = yield* Effect.exit(cursor.consumeDalphSelectionFor(readBSpecification, context))
      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain(AuthoredCausalSelectionFailure.name)
      expect(yield* cursor.storyPosition).toBe(causalPrefix.length)
    }

    const duplicateOwner = yield* makeStoryCursor(sameShapeStory, sameShapeOptions)
    yield* bindCausalPrefix(duplicateOwner)
    const first = causalContext("operation:B:duplicate", ["operation:G1"])
    yield* duplicateOwner.consumeDalphSelectionFor(readBSpecification, first)
    const duplicate = yield* Effect.exit(
      duplicateOwner.consumeDalphSelectionFor(
        readBSpecification,
        causalContext("operation:B:duplicate", ["operation:G0"])
      )
    )
    expect(Exit.isFailure(duplicate)).toBe(true)
    if (Exit.isFailure(duplicate)) expect(Cause.pretty(duplicate.cause)).toContain(AuthoredCausalSelectionFailure.name)
  })
)

it.effect("drains repeatedly forked exact read operations without resetting the story position", () =>
  Effect.gen(function* () {
    for (const activeFirst of [true, false, true, false]) {
      const cursor = yield* makeStoryCursor(sameShapeStory, sameShapeOptions)
      yield* bindCausalPrefix(cursor)
      const activeF2 = causalContext(`operation:B:F2:${activeFirst}`, ["operation:G1"])
      const independentF1 = causalContext(`operation:B:F1:${activeFirst}`, ["operation:G0"])
      const order = activeFirst ? ([activeF2, independentF1] as const) : ([independentF1, activeF2] as const)
      yield* Effect.forEach(
        order,
        (context) =>
          Effect.gen(function* () {
            yield* cursor.consumeDalphSelectionFor(readBSpecification, context)
            yield* cursor.consumeTaskWorkSpecificationFor(taskB, context)
          }),
        { concurrency: "unbounded" }
      )

      expect(yield* cursor.storyPosition).toBe(causalPrefix.length + sameShapeWindow.story.length)
      expect(yield* cursor.consumeTerminalAssertions).toEqual(terminal)
    }
  })
)

const observeThroughControlledExecutor = (
  cursor: StoryCursor,
  runId: RunId,
  correlation: { readonly attemptId: AttemptId; readonly runId: RunId },
  reports: Ref.Ref<ReadonlyMap<string, PlannedAttemptExecutorReport>>
) =>
  Effect.gen(function* () {
    const unresolved = yield* Ref.make<ReadonlySet<string>>(new Set())
    return yield* Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      return yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    }).pipe(Effect.provide(controlledExecutorLayer(cursor, runId, () => Effect.void, reports, unresolved)))
  })

const attachThroughControlledExecutor = (
  cursor: StoryCursor,
  runId: RunId,
  correlation: { readonly attemptId: AttemptId; readonly runId: RunId },
  reports: Ref.Ref<ReadonlyMap<string, PlannedAttemptExecutorReport>>
) =>
  Effect.gen(function* () {
    const unresolved = yield* Ref.make<ReadonlySet<string>>(new Set())
    return yield* Effect.gen(function* () {
      const lifecycle = yield* PlannedAttemptExecutorLifecycleObservation
      return yield* lifecycle.attach(correlation)
    }).pipe(Effect.provide(controlledExecutorLayer(cursor, runId, () => Effect.void, reports, unresolved)))
  })

it.effect("reobserves B1 executing without advancing or manufacturing another report", () =>
  Effect.gen(function* () {
    const runId = RunId.make("active-work-run")
    const correlation = { attemptId: AttemptId.make("attempt:B:1"), runId }
    const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(
      new Map([[plannedAttemptExecutorCorrelationKey(correlation), executing]])
    )
    const cursor = yield* makeStoryCursor([terminal])

    expect((yield* attachThroughControlledExecutor(cursor, runId, correlation, reports)).current).toEqual({
      _tag: "Exact",
      report: executing
    })
    expect((yield* attachThroughControlledExecutor(cursor, runId, correlation, reports)).current).toEqual({
      _tag: "Exact",
      report: executing
    })
    expect(yield* cursor.storyPosition).toBe(0)
  })
)

it.effect("allows only B1 safe or terminal observations to consume B1's lifecycle result", () =>
  Effect.gen(function* () {
    for (const report of [
      { _tag: "ExecutorWorkSafelySuspended" as const, attemptId: AttemptId.make("attempt:B:1") },
      {
        _tag: "ExecutorWorkTerminal" as const,
        attemptId: AttemptId.make("attempt:B:1"),
        result: { _tag: "Completed" as const }
      }
    ]) {
      const runId = RunId.make(`active-work-${report._tag}`)
      const b = { attemptId: report.attemptId, runId }
      const foreign = { attemptId: AttemptId.make("attempt:C:1"), runId }
      const cursor = yield* makeStoryCursor([
        AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorPassiveLifecycleChanged.make({ report }),
        terminal
      ])
      const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())

      const foreignSubscription = yield* attachThroughControlledExecutor(cursor, runId, foreign, reports)
      expect(foreignSubscription.current._tag).toBe("NoReport")
      const foreignChange = yield* Stream.runHead(foreignSubscription.changes).pipe(Effect.forkChild)
      expect(yield* cursor.storyPosition).toBe(0)
      const bSubscription = yield* attachThroughControlledExecutor(cursor, runId, b, reports)
      expect(bSubscription.current._tag).toBe("NoReport")
      const bChange = yield* Stream.runHead(bSubscription.changes)
      expect(Option.getOrUndefined(bChange)?._tag).toBe("Exact")
      expect(yield* cursor.storyPosition).toBe(1)
      expect(foreignChange.pollUnsafe()).toBeUndefined()
      yield* Fiber.interrupt(foreignChange)
    }
  })
)

it.effect("keeps requested executor projections ordered even in a causal tracker story", () =>
  Effect.gen(function* () {
    const runId = RunId.make("active-work-requested-projection")
    const b = { attemptId: AttemptId.make("attempt:B:1"), runId }
    const foreign = { attemptId: AttemptId.make("attempt:C:1"), runId }
    const cursor = yield* makeStoryCursor([
      anchorSelection("causal-only"),
      AuthoredCassetteStoryItem.cases.PlannedAttemptExecutorProjectionReturned.make({
        report: { _tag: "ExecutorWorkSafelySuspended", attemptId: b.attemptId }
      }),
      terminal
    ])
    yield* cursor.consumeDalphSelectionFor(readGraph, causalContext("operation:causal-only", []))
    const reports = yield* Ref.make<ReadonlyMap<string, PlannedAttemptExecutorReport>>(new Map())

    expect((yield* observeThroughControlledExecutor(cursor, runId, foreign, reports))._tag).toBe(
      "CorrelationContradiction"
    )
    expect(yield* cursor.storyPosition).toBe(2)
  })
)

it.effect("coalesces notification and timer hints then retains B1 until its exact safe report", () =>
  Effect.gen(function* () {
    const run = yield* runAuthoredScenarioCassette(activeWorkF2SafelySuspendsAuthoredCassette)
    const bAttemptId = AttemptId.make("attempt:B:1")
    const bReports = run.records.flatMap(({ event, position }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === bAttemptId
        ? [{ position, report: event.report._tag }]
        : []
    )
    const suspends = run.records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        event.command === "Suspend" &&
        event.plannedAttempt.attemptId === bAttemptId
    )
    const suspend = suspends[0]
    const changedF2 = run.records.find(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
        event.observation.factFamily.taskId === taskB &&
        event.observation.factFamily.body === "Implement changed B from F2."
    )

    expect(run.cassette).toStrictEqual(activeWorkF2SafelySuspendsAuthoredCassette)
    expect(run.activationOrdinals).toEqual([1, 2, 3])
    expect(suspends).toHaveLength(1)
    expect(bReports.map(({ report }) => report)).toEqual(["ExecutorWorkExecuting", "ExecutorWorkSafelySuspended"])
    expect(changedF2?.position).toBeDefined()
    expect(suspend?.position).toBeDefined()
    expect(changedF2 !== undefined && suspend !== undefined && changedF2.position < suspend.position).toBe(true)
    const finalBReport = bReports.at(-1)
    expect(finalBReport).toBeDefined()
    expect(suspend !== undefined && finalBReport !== undefined && suspend.position < finalBReport.position).toBe(true)
    expect(run.observedBehavior.taskWorkResults).toEqual([])
  }).pipe(Effect.provide(NodeCrypto.layer))
)
