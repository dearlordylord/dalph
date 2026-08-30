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
import { memoryJournalTestLayer } from "../../../workflow-journal/adapters/memory-store.js"
import { JournalStore } from "../../../workflow-journal/store.js"
import { reconstructRunState } from "../../../coordination/reconstruction/reduce.js"
import { requiredPlannedAttemptPositionsOf } from "../../../coordination/run/required-planned-attempt-positions.js"
import {
  beginPlannedAttemptExecutorWork,
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
  | "ExactBegin"
  | "ForeignBegin"
  | "ExecutingThenSafeSuspension"
  | "ForeignSuspension"
  | "UnavailableSuspension"
  | "TerminalSuspension"
  | "ExactProjection"
  | "ForeignProjection"
  | "MissingProjection"

type BoundaryCall =
  | { readonly _tag: "Observe"; readonly correlation: PlannedAttemptExecutorCorrelation }
  | { readonly _tag: "Begin" | "Resume"; readonly correlation: PlannedAttemptExecutorCorrelation }
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

const executing = (value: PlannedAttemptExecutorCorrelation = correlation) =>
  ExecutorReport.cases.ExecutorWorkExecuting.make({ correlation: value })
const safelySuspended = ExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
const terminal = ExecutorReport.cases.ExecutorWorkTerminal.make({ correlation, result: { _tag: "Completed" } })

const reportsFor = (
  scenario: ConformanceScenario
): {
  readonly projection: PlannedAttemptExecutorProjection
  readonly begins: ReadonlyArray<PlannedAttemptExecutorReport>
  readonly suspensions: ReadonlyArray<PlannedAttemptExecutorReport>
} => {
  switch (scenario) {
    case "ExactBegin":
      return {
        projection: PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
        begins: [executing()],
        suspensions: []
      }
    case "ForeignBegin":
      return {
        projection: PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
        begins: [executing(foreignCorrelation)],
        suspensions: []
      }
    case "ExecutingThenSafeSuspension":
      return {
        projection: PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
        begins: [executing()],
        suspensions: [executing(), safelySuspended]
      }
    case "ForeignSuspension":
      return {
        projection: PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
        begins: [executing()],
        suspensions: [executing(foreignCorrelation)]
      }
    case "UnavailableSuspension":
      return {
        projection: PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
        begins: [executing()],
        suspensions: []
      }
    case "TerminalSuspension":
      return {
        projection: PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
        begins: [executing()],
        suspensions: [terminal]
      }
    case "ExactProjection":
      return {
        projection: PlannedAttemptExecutorProjection.cases.Exact.make({ report: executing() }),
        begins: [],
        suspensions: []
      }
    case "ForeignProjection":
      return {
        projection: PlannedAttemptExecutorProjection.cases.CorrelationContradiction.make({
          expected: correlation,
          observed: executing(foreignCorrelation)
        }),
        begins: [],
        suspensions: []
      }
    case "MissingProjection":
      return {
        projection: PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }),
        begins: [],
        suspensions: []
      }
  }
}

const unexpectedCall = (command: "Begin" | "Resume" | "Suspend") =>
  new PlannedAttemptExecutorCommandFailure({ command, correlation, detail: `unexpected ${command} conformance call` })

/** A request-script implementation consumes a separate ordered response cassette for each command. */
const requestScriptImplementation: ConformanceImplementation = {
  name: "request-script implementation",
  make: (scenario, onBoundary) =>
    Effect.gen(function* () {
      const behavior = reportsFor(scenario)
      const calls = yield* Ref.make<ReadonlyArray<BoundaryCall>>([])
      const begins = yield* Ref.make(behavior.begins)
      const suspensions = yield* Ref.make(behavior.suspensions)
      const record = (call: BoundaryCall) =>
        Ref.update(calls, (current) => [...current, call]).pipe(Effect.andThen(onBoundary(call)))
      const consume = (
        command: "Begin" | "Resume" | "Suspend",
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
          observe: (requested) => {
            const call = { _tag: "Observe", correlation: requested } as const
            return record(call).pipe(Effect.as(behavior.projection))
          },
          requestSuspension: () => consume("Suspend", suspensions),
          begin: () => consume("Begin", begins),
          resume: () => unexpectedCall("Resume")
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
        command: "Begin" | "Resume" | "Suspend",
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
          observe: (requested) => {
            const call = { _tag: "Observe", correlation: requested } as const
            return record(call).pipe(Effect.as(behavior.projection))
          },
          requestSuspension: () => transition("Suspend", suspensionPhase, behavior.suspensions),
          begin: () => transition("Begin", startPhase, behavior.begins),
          resume: () => unexpectedCall("Resume")
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
    it.effect("records Begin intent before one exact boundary call and report", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        const harness = yield* implementation.make("ExactBegin", () =>
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
          yield* beginPlannedAttemptExecutorWork(plannedAttempt, specification).pipe(
            Effect.provideService(PlannedAttemptExecutor, harness.executor)
          )
        ).toEqual(executing())
        expect(yield* harness.calls).toEqual([{ _tag: "Begin", correlation }])
        expect(yield* eventTags).toEqual([
          "PlannedAttemptExecutorWorkResponsibilityBegan",
          "PlannedAttemptExecutorCommandIntended",
          "PlannedAttemptExecutorCommandResponseObserved",
          "PlannedAttemptExecutorWorkReported"
        ])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
    )

    it.effect("records a foreign Begin response without advancing the exact attempt", () =>
      Effect.gen(function* () {
        const harness = yield* implementation.make("ForeignBegin", () => Effect.void)
        const failure = yield* beginPlannedAttemptExecutorWork(plannedAttempt, specification).pipe(
          Effect.provideService(PlannedAttemptExecutor, harness.executor),
          Effect.flip
        )
        expect(failure).toMatchObject({ _tag: "PlannedAttemptExecutorCorrelationMismatch", expected: correlation })
        expect(yield* harness.calls).toEqual([{ _tag: "Begin", correlation }])
        expect(yield* eventTags).toEqual([
          "PlannedAttemptExecutorWorkResponsibilityBegan",
          "PlannedAttemptExecutorCommandIntended",
          "PlannedAttemptExecutorCommandResponseContradicted"
        ])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
    )

    it.effect("uses only Suspend until executing work becomes exact safe evidence", () =>
      Effect.gen(function* () {
        const harness = yield* implementation.make("ExecutingThenSafeSuspension", () => Effect.void)
        expect(
          yield* beginPlannedAttemptExecutorWork(plannedAttempt, specification).pipe(
            Effect.provideService(PlannedAttemptExecutor, harness.executor)
          )
        ).toEqual(executing())
        expect(
          yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
            Effect.provideService(PlannedAttemptExecutor, harness.executor)
          )
        ).toEqual(executing())
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
          { _tag: "Begin", correlation },
          { _tag: "Suspend", correlation },
          { _tag: "Suspend", correlation }
        ])
        expect(yield* eventTags).toEqual([
          "PlannedAttemptExecutorWorkResponsibilityBegan",
          "PlannedAttemptExecutorCommandIntended",
          "PlannedAttemptExecutorCommandResponseObserved",
          "PlannedAttemptExecutorWorkReported",
          "PlannedAttemptExecutorCommandIntended",
          "PlannedAttemptExecutorCommandResponseObserved",
          "PlannedAttemptExecutorCommandIntended",
          "PlannedAttemptExecutorCommandResponseObserved",
          "PlannedAttemptExecutorWorkReported"
        ])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
    )

    it.effect("accepts Terminal from Suspend after accepted executing work", () =>
      Effect.gen(function* () {
        const harness = yield* implementation.make("TerminalSuspension", () => Effect.void)
        yield* beginPlannedAttemptExecutorWork(plannedAttempt, specification).pipe(
          Effect.provideService(PlannedAttemptExecutor, harness.executor)
        )
        const report = yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, harness.executor)
        )
        expect(report._tag).toBe("ExecutorWorkTerminal")
        if (report._tag === "ExecutorWorkTerminal") {
          expect(report.result._tag).toBe(implementation.terminalResultTag ?? "Completed")
        }
        expect(yield* harness.calls).toEqual([
          { _tag: "Begin", correlation },
          { _tag: "Suspend", correlation }
        ])
        expect(yield* requiredTaskWorkPositions).toEqual([])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
    )

    it.effect("records a foreign Suspend response without proving safety", () =>
      Effect.gen(function* () {
        const harness = yield* implementation.make("ForeignSuspension", () => Effect.void)
        yield* beginPlannedAttemptExecutorWork(plannedAttempt, specification).pipe(
          Effect.provideService(PlannedAttemptExecutor, harness.executor)
        )
        const failure = yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, harness.executor),
          Effect.flip
        )
        expect(failure).toMatchObject({ _tag: "PlannedAttemptExecutorCorrelationMismatch", expected: correlation })
        expect(yield* harness.calls).toEqual([
          { _tag: "Begin", correlation },
          { _tag: "Suspend", correlation }
        ])
        expect(yield* eventTags).toEqual([
          "PlannedAttemptExecutorWorkResponsibilityBegan",
          "PlannedAttemptExecutorCommandIntended",
          "PlannedAttemptExecutorCommandResponseObserved",
          "PlannedAttemptExecutorWorkReported",
          "PlannedAttemptExecutorCommandIntended",
          "PlannedAttemptExecutorCommandResponseContradicted"
        ])
        expect(yield* requiredTaskWorkPositions).toEqual([
          { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }
        ])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
    )

    it.effect("retains the exact task-work position when Suspend returns no report", () =>
      Effect.gen(function* () {
        const harness = yield* implementation.make("UnavailableSuspension", () => Effect.void)
        yield* beginPlannedAttemptExecutorWork(plannedAttempt, specification).pipe(
          Effect.provideService(PlannedAttemptExecutor, harness.executor)
        )
        const failure = yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, harness.executor),
          Effect.flip
        )
        expect(failure).toMatchObject({ _tag: "PlannedAttemptExecutorCommandFailure", command: "Suspend", correlation })
        expect(yield* harness.calls).toEqual([
          { _tag: "Begin", correlation },
          { _tag: "Suspend", correlation }
        ])
        expect(yield* eventTags).toEqual([
          "PlannedAttemptExecutorWorkResponsibilityBegan",
          "PlannedAttemptExecutorCommandIntended",
          "PlannedAttemptExecutorCommandResponseObserved",
          "PlannedAttemptExecutorWorkReported",
          "PlannedAttemptExecutorCommandIntended"
        ])
        expect(yield* requiredTaskWorkPositions).toEqual([
          { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }
        ])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
    )

    it.effect("rejects an exact first projection without Begin and preserves responsibility", () =>
      Effect.gen(function* () {
        const journal = yield* JournalStore
        yield* beginPlannedAttemptExecutorResponsibility(plannedAttempt)
        const missing = yield* implementation.make("MissingProjection", () => Effect.void)
        const unavailable = yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, missing.executor),
          Effect.flip
        )
        expect(unavailable).toMatchObject({ _tag: "PlannedAttemptExecutorStateNoCurrentReport", correlation })
        expect(yield* missing.calls).toEqual([{ _tag: "Observe", correlation }])
        expect((yield* journal.read(plannedAttempt.runId))[0]?.event._tag).toBe(
          "PlannedAttemptExecutorWorkResponsibilityBegan"
        )
        expect(yield* requiredTaskWorkPositions).toEqual([
          { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }
        ])

        const exact = yield* implementation.make("ExactProjection", () => Effect.void)
        expect(
          yield* observePlannedAttemptExecutorState(plannedAttempt).pipe(
            Effect.provideService(PlannedAttemptExecutor, exact.executor),
            Effect.flip
          )
        ).toMatchObject({ _tag: "PlannedAttemptExecutorInitialReportCausalityContradiction", observed: executing() })
        expect(yield* exact.calls).toEqual([{ _tag: "Observe", correlation }])
        expect(yield* requiredTaskWorkPositions).toEqual([
          { attemptId: plannedAttempt.attemptId, runId: plannedAttempt.runId, taskId: plannedAttempt.taskId }
        ])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
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
        expect(yield* harness.calls).toEqual([{ _tag: "Observe", correlation }])
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer))
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
        observed: executing(foreignCorrelation)
      })
    ],
    (untrustedProjection) =>
      Effect.gen(function* () {
        const projections = yield* Ref.make<ReadonlyArray<PlannedAttemptExecutorProjection>>([
          PlannedAttemptExecutorProjection.cases.Exact.make({ report: safelySuspended }),
          untrustedProjection
        ])
        const executor = PlannedAttemptExecutor.of({
          observe: () =>
            Ref.modify(projections, (remaining) => [remaining[0], remaining.slice(1)] as const).pipe(
              Effect.map((projection) => projection ?? untrustedProjection)
            ),
          requestSuspension: () => Effect.succeed(safelySuspended),
          begin: () => Effect.succeed(executing()),
          resume: () => unexpectedCall("Resume")
        })
        yield* beginPlannedAttemptExecutorWork(plannedAttempt, specification).pipe(
          Effect.provideService(PlannedAttemptExecutor, executor)
        )
        yield* requestPlannedAttemptExecutorSuspension(plannedAttempt).pipe(
          Effect.provideService(PlannedAttemptExecutor, executor)
        )
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
      }).pipe(Effect.provide(plannedAttemptProtocolControllerLayer), Effect.provide(memoryJournalTestLayer)),
    { discard: true }
  )
)
