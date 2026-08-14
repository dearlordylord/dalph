import { describe, it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorCommandFailure,
  PlannedAttemptExecutorProjection,
  type PlannedAttemptExecutorCorrelation,
  type PlannedAttemptExecutorReport,
  PlannedAttemptExecutorReport as ExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { Effect, Ref } from "effect"
import { expect } from "vitest"
import { legacyMemoryJournalStoreLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { reconstructRunState } from "../../../coordination/reconstruction/reduce.js"
import { requiredPlannedAttemptPositionsOf } from "../../../coordination/run/required-planned-attempt-positions.js"
import {
  continuePlannedAttemptExecutorWork,
  observePlannedAttemptExecutorState,
  requestPlannedAttemptExecutorSuspension
} from "./guarded-protocol.js"
import { beginPlannedAttemptExecutorResponsibility } from "./protocol.js"
import { plannedAttemptProtocolControllerLayer } from "./protocol-controller.js"

const specification = makeTaskWorkSpecification({
  body: "Opaque conformance body",
  taskId: TaskId.make("opaque-conformance-task"),
  title: "Opaque conformance task"
})
const plannedAttempt = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("attempt:opaque-conformance:0"),
  baseSha: GitCommitSha.make("1".repeat(40)),
  branch: TaskBranchRef.make("refs/heads/dalph/opaque-conformance"),
  executor: TaskExecutorLocator.make("executor:opaque-conformance"),
  runId: RunId.make("opaque-conformance-run"),
  taskId: TaskId.make("opaque-conformance-task"),
  taskRevision: specification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/opaque-conformance")
})

const correlation = { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId }
const foreignCorrelation = { attemptId: AttemptId.make("attempt:foreign:0"), runId: plannedAttempt.runId }

type ConformanceScenario =
  | "ExactStart"
  | "ForeignStart"
  | "RunningThenSafeSuspension"
  | "ForeignSuspension"
  | "UnavailableSuspension"
  | "TerminalSuspension"
  | "ExactProjection"
  | "ForeignProjection"
  | "MissingProjection"

type BoundaryCall =
  | { readonly _tag: "Project"; readonly correlation: PlannedAttemptExecutorCorrelation }
  | { readonly _tag: "StartOrContinue"; readonly correlation: PlannedAttemptExecutorCorrelation }
  | { readonly _tag: "Suspend"; readonly correlation: PlannedAttemptExecutorCorrelation }

interface ExecutorHarness {
  readonly calls: Effect.Effect<ReadonlyArray<BoundaryCall>>
  readonly executor: PlannedAttemptExecutor["Service"]
}

interface NamedConformanceImplementation {
  readonly name: string
  /** Provider-specific terminal tags remain normalized reports at this seam. */
  readonly terminalResultTag?: "Accepted" | "Completed" | "Failed"
}

interface ConformanceImplementation extends NamedConformanceImplementation {
  make(
    scenario: ConformanceScenario,
    onBoundary: (call: BoundaryCall) => Effect.Effect<void>
  ): Effect.Effect<ExecutorHarness>
}

const running = (value: PlannedAttemptExecutorCorrelation = correlation) =>
  ExecutorReport.cases.Running.make({ correlation: value })
const safelySuspended = ExecutorReport.cases.SafelySuspended.make({ correlation })
const terminal = ExecutorReport.cases.Terminal.make({ correlation, result: { _tag: "Completed" } })

const reportsFor = (
  scenario: ConformanceScenario
): {
  readonly projection: PlannedAttemptExecutorProjection
  readonly starts: ReadonlyArray<PlannedAttemptExecutorReport>
  readonly suspensions: ReadonlyArray<PlannedAttemptExecutorReport>
} => {
  switch (scenario) {
    case "ExactStart":
      return {
        projection: PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
        starts: [running()],
        suspensions: []
      }
    case "ForeignStart":
      return {
        projection: PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
        starts: [running(foreignCorrelation)],
        suspensions: []
      }
    case "RunningThenSafeSuspension":
      return {
        projection: PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
        starts: [],
        suspensions: [running(), safelySuspended]
      }
    case "ForeignSuspension":
      return {
        projection: PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
        starts: [],
        suspensions: [running(foreignCorrelation)]
      }
    case "UnavailableSuspension":
      return {
        projection: PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
        starts: [],
        suspensions: []
      }
    case "TerminalSuspension":
      return {
        projection: PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
        starts: [],
        suspensions: [terminal]
      }
    case "ExactProjection":
      return {
        projection: PlannedAttemptExecutorProjection.cases.Exact.make({ report: running() }),
        starts: [],
        suspensions: []
      }
    case "ForeignProjection":
      return {
        projection: PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
          expected: correlation,
          observed: running(foreignCorrelation)
        }),
        starts: [],
        suspensions: []
      }
    case "MissingProjection":
      return {
        projection: PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
        starts: [],
        suspensions: []
      }
  }
}

const unexpectedCall = (command: "StartOrContinue" | "Suspend") =>
  new PlannedAttemptExecutorCommandFailure({ command, correlation, detail: `unexpected ${command} conformance call` })

/** A request-script implementation consumes a separate ordered response cassette for each command. */
const requestScriptImplementation: ConformanceImplementation = {
  name: "request-script implementation",
  make: (scenario, onBoundary) =>
    Effect.gen(function* () {
      const behavior = reportsFor(scenario)
      const calls = yield* Ref.make<ReadonlyArray<BoundaryCall>>([])
      const starts = yield* Ref.make(behavior.starts)
      const suspensions = yield* Ref.make(behavior.suspensions)
      const record = (call: BoundaryCall) =>
        Ref.update(calls, (current) => [...current, call]).pipe(Effect.andThen(onBoundary(call)))
      const consume = (
        command: "StartOrContinue" | "Suspend",
        responses: Ref.Ref<ReadonlyArray<PlannedAttemptExecutorReport>>
      ) =>
        Effect.gen(function* () {
          const call = { _tag: command, correlation } as const
          yield* record(call)
          const response = yield* Ref.modify(responses, (current) => [current[0], current.slice(1)] as const)
          return response === undefined ? yield* unexpectedCall(command) : response
        })
      return {
        calls: Ref.get(calls),
        executor: PlannedAttemptExecutor.of({
          project: (requested) => {
            const call = { _tag: "Project", correlation: requested } as const
            return record(call).pipe(Effect.as(behavior.projection))
          },
          requestSuspension: () => consume("Suspend", suspensions),
          startOrContinue: () => consume("StartOrContinue", starts)
        })
      }
    })
}

/** A state-machine implementation derives responses from its current per-command phase rather than a cassette. */
const stateMachineImplementation: ConformanceImplementation = {
  name: "state-machine implementation",
  make: (scenario, onBoundary) =>
    Effect.gen(function* () {
      const behavior = reportsFor(scenario)
      const calls = yield* Ref.make<ReadonlyArray<BoundaryCall>>([])
      const startPhase = yield* Ref.make(0)
      const suspensionPhase = yield* Ref.make(0)
      const record = (call: BoundaryCall) =>
        Ref.update(calls, (current) => [...current, call]).pipe(Effect.andThen(onBoundary(call)))
      const transition = (
        command: "StartOrContinue" | "Suspend",
        phase: Ref.Ref<number>,
        responses: ReadonlyArray<PlannedAttemptExecutorReport>
      ) =>
        Effect.gen(function* () {
          const call = { _tag: command, correlation } as const
          yield* record(call)
          const index = yield* Ref.getAndUpdate(phase, (current) => current + 1)
          const response = responses[index]
          return response === undefined ? yield* unexpectedCall(command) : response
        })
      return {
        calls: Ref.get(calls),
        executor: PlannedAttemptExecutor.of({
          project: (requested) => {
            const call = { _tag: "Project", correlation: requested } as const
            return record(call).pipe(Effect.as(behavior.projection))
          },
          requestSuspension: () => transition("Suspend", suspensionPhase, behavior.suspensions),
          startOrContinue: () => transition("StartOrContinue", startPhase, behavior.starts)
        })
      }
    })
}

const eventTags = Effect.gen(function* () {
  return (yield* (yield* JournalStore).read(plannedAttempt.runId)).map(({ event }) => event._tag)
})

const requiredTaskWorkPositions = Effect.gen(function* () {
  const journal = yield* JournalStore
  const reconstruction = reconstructRunState(plannedAttempt.runId, yield* journal.read(plannedAttempt.runId))
  if (reconstruction._tag !== "ValidReconstructedRun") {
    return yield* Effect.die("executor conformance history must reconstruct")
  }
  return requiredPlannedAttemptPositionsOf(reconstruction.state)
})

/** Reusable black-box suite for an injected PlannedAttemptExecutor implementation. */
export const definePlannedAttemptExecutorConformanceSuite = (implementation: ConformanceImplementation) =>
  describe(implementation.name, () => {
    it.effect("records StartOrContinue intent before one exact boundary call and report", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const harness = yield* implementation.make("ExactStart", () =>
          journal.read(plannedAttempt.runId).pipe(
            Effect.map((records) => {
              expect(records.map(({ event }) => event._tag)).toEqual([
                "PlannedAttemptExecutorWorkResponsibilityBegan",
                "PlannedAttemptExecutorCommandIntended"
              ])
            }),
            Effect.catch((error) => Effect.die(error))
          )
        )

        expect(
          yield* continuePlannedAttemptExecutorWork(plannedAttempt, undefined, specification).pipe(
            Effect.provideService(PlannedAttemptExecutor, harness.executor)
          )
        ).toEqual(running())
        expect(yield* harness.calls).toEqual([{ _tag: "StartOrContinue", correlation }])
        expect(yield* eventTags).toEqual([
          "PlannedAttemptExecutorWorkResponsibilityBegan",
          "PlannedAttemptExecutorCommandIntended",
          "PlannedAttemptExecutorWorkReported"
        ])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
    )

    it.effect("records a foreign StartOrContinue response without advancing the exact attempt", () =>
      Effect.gen(function* () {
        const harness = yield* implementation.make("ForeignStart", () => Effect.void)
        const failure = yield* continuePlannedAttemptExecutorWork(plannedAttempt, undefined, specification).pipe(
          Effect.provideService(PlannedAttemptExecutor, harness.executor),
          Effect.flip
        )
        expect(failure).toMatchObject({ _tag: "PlannedAttemptExecutorCorrelationMismatch", expected: correlation })
        expect(yield* harness.calls).toEqual([{ _tag: "StartOrContinue", correlation }])
        expect(yield* eventTags).toEqual([
          "PlannedAttemptExecutorWorkResponsibilityBegan",
          "PlannedAttemptExecutorCommandIntended",
          "PlannedAttemptExecutorCommandResponseContradicted"
        ])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
    )

    it.effect("uses only Suspend until Running becomes exact safe evidence", () =>
      Effect.gen(function* () {
        const harness = yield* implementation.make("RunningThenSafeSuspension", () => Effect.void)
        expect(
          yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
            Effect.provideService(PlannedAttemptExecutor, harness.executor)
          )
        ).toEqual(running())
        expect(yield* requiredTaskWorkPositions).toEqual([
          { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }
        ])
        expect(
          yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
            Effect.provideService(PlannedAttemptExecutor, harness.executor)
          )
        ).toEqual(safelySuspended)
        expect(yield* requiredTaskWorkPositions).toEqual([])
        expect(yield* harness.calls).toEqual([
          { _tag: "Suspend", correlation },
          { _tag: "Suspend", correlation }
        ])
        expect(yield* eventTags).toEqual([
          "PlannedAttemptExecutorWorkResponsibilityBegan",
          "PlannedAttemptExecutorCommandIntended",
          "PlannedAttemptExecutorWorkReported",
          "PlannedAttemptExecutorCommandIntended",
          "PlannedAttemptExecutorWorkReported"
        ])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
    )

    it.effect("accepts Terminal from Suspend without issuing StartOrContinue", () =>
      Effect.gen(function* () {
        const harness = yield* implementation.make("TerminalSuspension", () => Effect.void)
        const report = yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, harness.executor)
        )
        expect(report._tag).toBe("Terminal")
        if (report._tag === "Terminal") {
          expect(report.result._tag).toBe(implementation.terminalResultTag ?? "Completed")
        }
        expect(yield* harness.calls).toEqual([{ _tag: "Suspend", correlation }])
        expect(yield* requiredTaskWorkPositions).toEqual([])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
    )

    it.effect("records a foreign Suspend response without proving safety", () =>
      Effect.gen(function* () {
        const harness = yield* implementation.make("ForeignSuspension", () => Effect.void)
        const failure = yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, harness.executor),
          Effect.flip
        )
        expect(failure).toMatchObject({ _tag: "PlannedAttemptExecutorCorrelationMismatch", expected: correlation })
        expect(yield* harness.calls).toEqual([{ _tag: "Suspend", correlation }])
        expect(yield* eventTags).toEqual([
          "PlannedAttemptExecutorWorkResponsibilityBegan",
          "PlannedAttemptExecutorCommandIntended",
          "PlannedAttemptExecutorCommandResponseContradicted"
        ])
        expect(yield* requiredTaskWorkPositions).toEqual([
          { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }
        ])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
    )

    it.effect("retains the exact task-work position when Suspend returns no report", () =>
      Effect.gen(function* () {
        const harness = yield* implementation.make("UnavailableSuspension", () => Effect.void)
        const failure = yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, harness.executor),
          Effect.flip
        )
        expect(failure).toMatchObject({ _tag: "PlannedAttemptExecutorCommandFailure", command: "Suspend", correlation })
        expect(yield* harness.calls).toEqual([{ _tag: "Suspend", correlation }])
        expect(yield* eventTags).toEqual([
          "PlannedAttemptExecutorWorkResponsibilityBegan",
          "PlannedAttemptExecutorCommandIntended"
        ])
        expect(yield* requiredTaskWorkPositions).toEqual([
          { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }
        ])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
    )

    it.effect("projects exact current state and preserves responsibility when no report exists", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* beginPlannedAttemptExecutorResponsibility(plannedAttempt)
        const missing = yield* implementation.make("MissingProjection", () => Effect.void)
        const unavailable = yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, missing.executor),
          Effect.flip
        )
        expect(unavailable).toMatchObject({ _tag: "PlannedAttemptExecutorStateNoCurrentReport", correlation })
        expect(yield* missing.calls).toEqual([{ _tag: "Project", correlation }])
        expect((yield* journal.read(plannedAttempt.runId))[0]?.event._tag).toBe(
          "PlannedAttemptExecutorWorkResponsibilityBegan"
        )
        expect(yield* requiredTaskWorkPositions).toEqual([
          { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }
        ])

        const exact = yield* implementation.make("ExactProjection", () => Effect.void)
        expect(
          yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
            Effect.provideService(PlannedAttemptExecutor, exact.executor)
          )
        ).toEqual(running())
        expect(yield* exact.calls).toEqual([{ _tag: "Project", correlation }])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
    )

    it.effect("rejects a foreign current-state projection", () =>
      Effect.gen(function* () {
        yield* beginPlannedAttemptExecutorResponsibility(plannedAttempt)
        const harness = yield* implementation.make("ForeignProjection", () => Effect.void)
        const failure = yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, harness.executor),
          Effect.flip
        )
        expect(failure).toMatchObject({ _tag: "PlannedAttemptExecutorCorrelationMismatch", expected: correlation })
        expect(yield* harness.calls).toEqual([{ _tag: "Project", correlation }])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer))
    )
  })

definePlannedAttemptExecutorConformanceSuite(requestScriptImplementation)
definePlannedAttemptExecutorConformanceSuite(stateMachineImplementation)

it.effect("reconstructs the task-work position when newer untrusted state invalidates an older safe report", () =>
  Effect.forEach(
    [
      PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
      PlannedAttemptExecutorProjection.cases.TemporarilyUnavailable.make({ correlation }),
      PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation }),
      PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
        expected: correlation,
        observed: running(foreignCorrelation)
      })
    ],
    (untrustedProjection) =>
      Effect.gen(function* () {
        const projections = yield* Ref.make<ReadonlyArray<PlannedAttemptExecutorProjection>>([
          PlannedAttemptExecutorProjection.cases.Exact.make({ report: safelySuspended }),
          untrustedProjection
        ])
        const executor = PlannedAttemptExecutor.of({
          project: () =>
            Ref.modify(projections, (remaining) => [remaining[0], remaining.slice(1)] as const).pipe(
              Effect.map((projection) => projection ?? untrustedProjection)
            ),
          requestSuspension: () => unexpectedCall("Suspend"),
          startOrContinue: () => unexpectedCall("StartOrContinue")
        })
        yield* beginPlannedAttemptExecutorResponsibility(plannedAttempt)
        yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, executor)
        )
        expect(yield* requiredTaskWorkPositions).toEqual([])
        yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, executor),
          Effect.exit
        )
        expect(yield* requiredTaskWorkPositions).toEqual([
          { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }
        ])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(legacyMemoryJournalStoreLayer)),
    { discard: true }
  )
)
