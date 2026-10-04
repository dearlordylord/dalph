import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  PlannedAttemptExecutorRequest,
  makeTaskWorkSpecification,
  RunId,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  PlannedAttemptExecutorCorrelation,
  passiveLifecycleObservationPurpose
} from "@dalph/contracts"
import { Context, Deferred, Effect, Ref, Stream } from "effect"
import { expect } from "vitest"
import { ActiveTaskClaim, ClaimOwner, ClaimToken, OperationId } from "@dalph/orchestrator"
import {
  CodexProviderWorkUnitReplacement,
  CodexProviderWorkUnitReplacementRequest
} from "./codex-planned-attempt-executor.js"
import { CodexReplacementRequestId } from "./codex-attempt-store.js"
import { isolatedPlannedAttemptExecutorLayer } from "./isolated-planned-attempt-executor.js"

const correlation = (id: string) =>
  PlannedAttemptExecutorCorrelation.make({ runId: RunId.make("isolated-run"), attemptId: AttemptId.make(id) })

it.effect("reuses one exact execution owner across concurrent observation and attachment", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const acquired = yield* Ref.make(0)
      const layer = isolatedPlannedAttemptExecutorLayer(
        (subject) =>
          Effect.gen(function* () {
            yield* Ref.update(acquired, (n) => n + 1)
            const current = PlannedAttemptExecutorProjection.cases.Exact.make({
              report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation: subject })
            })
            return Context.make(PlannedAttemptExecutor, {
              observe: () => Effect.succeed(current),
              begin: () => Effect.succeed(current.report),
              requestSuspension: () => Effect.succeed(current.report),
              resume: () => Effect.succeed(current.report)
            }).pipe(
              Context.add(PlannedAttemptExecutorLifecycleObservation, {
                attach: () => Effect.succeed({ current, changes: Stream.empty, close: Effect.void })
              })
            )
          }),
        () => "controlled acquisition failure"
      )
      yield* Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        const observation = yield* PlannedAttemptExecutorLifecycleObservation
        const a = correlation("attempt-a")
        const [first, second] = yield* Effect.all(
          [executor.observe(a, passiveLifecycleObservationPurpose), observation.attach(a)],
          { concurrency: "unbounded" }
        )
        expect(second.current).toEqual(first)
        yield* executor.observe(a, passiveLifecycleObservationPurpose)
        expect(yield* Ref.get(acquired)).toBe(1)
        yield* executor.observe(correlation("attempt-b"), passiveLifecycleObservationPurpose)
        expect(yield* Ref.get(acquired)).toBe(2)
      }).pipe(Effect.provide(layer))
    })
  )
)

it.effect(
  "preserves another attempt when one execution owner becomes unreadable and finalizes all owners on host Exit",
  () =>
    Effect.gen(function* () {
      const stopped = yield* Ref.make<ReadonlyArray<string>>([])
      const failed = yield* Deferred.make<void>()
      const layer = isolatedPlannedAttemptExecutorLayer(
        (subject) =>
          Effect.gen(function* () {
            yield* Effect.addFinalizer(() => Ref.update(stopped, (ids) => [...ids, subject.attemptId]))
            const report = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation: subject })
            const read =
              subject.attemptId === "attempt-a"
                ? Deferred.isDone(failed).pipe(
                    Effect.map((done) =>
                      done
                        ? PlannedAttemptExecutorProjection.cases.Unreadable.make({
                            correlation: subject,
                            detail: "owned containment stopped"
                          })
                        : PlannedAttemptExecutorProjection.cases.Exact.make({ report })
                    )
                  )
                : Effect.succeed(PlannedAttemptExecutorProjection.cases.Exact.make({ report }))
            return Context.make(PlannedAttemptExecutor, {
              observe: () => read,
              begin: () => Effect.succeed(report),
              requestSuspension: () => Effect.succeed(report),
              resume: () => Effect.succeed(report)
            }).pipe(
              Context.add(PlannedAttemptExecutorLifecycleObservation, {
                attach: () =>
                  read.pipe(Effect.map((current) => ({ current, changes: Stream.empty, close: Effect.void })))
              })
            )
          }),
        () => "controlled failure"
      )
      yield* Effect.scoped(
        Effect.gen(function* () {
          const executor = yield* PlannedAttemptExecutor
          yield* executor.observe(correlation("attempt-a"), passiveLifecycleObservationPurpose)
          yield* executor.observe(correlation("attempt-b"), passiveLifecycleObservationPurpose)
          yield* Deferred.succeed(failed, undefined)
          expect((yield* executor.observe(correlation("attempt-a"), passiveLifecycleObservationPurpose))._tag).toBe(
            "Unreadable"
          )
          expect((yield* executor.observe(correlation("attempt-b"), passiveLifecycleObservationPurpose))._tag).toBe(
            "Exact"
          )
          expect(yield* Ref.get(stopped)).toEqual([])
        }).pipe(Effect.provide(layer))
      )
      expect((yield* Ref.get(stopped)).toSorted()).toEqual(["attempt-a", "attempt-b"])
    })
)

it.effect("closes a failed acquisition before returning a safe projection and does not retain the failed owner", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const released = yield* Ref.make(0)
      const layer = isolatedPlannedAttemptExecutorLayer(
        () => Effect.addFinalizer(() => Ref.update(released, (n) => n + 1)).pipe(Effect.andThen(Effect.fail("denied"))),
        () => "custody unavailable"
      )
      yield* Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        for (let i = 0; i < 2; i += 1) {
          expect(yield* executor.observe(correlation("attempt-a"), passiveLifecycleObservationPurpose)).toEqual(
            PlannedAttemptExecutorProjection.cases.Unreadable.make({
              correlation: correlation("attempt-a"),
              detail: "custody unavailable"
            })
          )
        }
        expect(yield* Ref.get(released)).toBe(2)
      }).pipe(Effect.provide(layer))
    })
  )
)

it.effect("retires a terminal owner only after its last attachment closes and closes each attachment once", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const stopped = yield* Ref.make(0)
      const acquired = yield* Ref.make(0)
      const detached = yield* Ref.make(0)
      const terminal = yield* Ref.make(false)
      const layer = isolatedPlannedAttemptExecutorLayer(
        (subject) =>
          Effect.gen(function* () {
            yield* Ref.update(acquired, (count) => count + 1)
            yield* Effect.addFinalizer(() => Ref.update(stopped, (count) => count + 1))
            const executing = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation: subject })
            const finished = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
              correlation: subject,
              result: { _tag: "Failed" }
            })
            const read = Ref.get(terminal).pipe(
              Effect.map((done) =>
                PlannedAttemptExecutorProjection.cases.Exact.make({ report: done ? finished : executing })
              )
            )
            return Context.make(PlannedAttemptExecutor, {
              observe: () => read,
              begin: () => Effect.succeed(executing),
              requestSuspension: () => Effect.succeed(executing),
              resume: () => Effect.succeed(executing)
            }).pipe(
              Context.add(PlannedAttemptExecutorLifecycleObservation, {
                attach: () =>
                  read.pipe(
                    Effect.map((current) => ({
                      current,
                      changes: Stream.empty,
                      close: Ref.update(detached, (count) => count + 1)
                    }))
                  )
              })
            )
          }),
        () => "controlled failure"
      )
      yield* Effect.gen(function* () {
        const observation = yield* PlannedAttemptExecutorLifecycleObservation
        const executor = yield* PlannedAttemptExecutor
        const subject = correlation("terminal-attempt")
        const first = yield* observation.attach(subject)
        const second = yield* observation.attach(subject)
        yield* Ref.set(terminal, true)
        yield* executor.observe(subject, passiveLifecycleObservationPurpose)
        expect(yield* Ref.get(stopped)).toBe(0)
        yield* first.close
        yield* first.close
        expect(yield* Ref.get(stopped)).toBe(0)
        expect(yield* Ref.get(detached)).toBe(1)
        yield* second.close
        expect(yield* Ref.get(stopped)).toBe(1)
        expect(yield* Ref.get(detached)).toBe(2)
        yield* executor.observe(subject, passiveLifecycleObservationPurpose)
        yield* executor.observe(subject, passiveLifecycleObservationPurpose)
        expect(yield* Ref.get(acquired)).toBe(1)
        expect(yield* Ref.get(stopped)).toBe(1)
      }).pipe(Effect.provide(layer))
    })
  )
)

it.effect("routes Begin, Suspend, Resume and work-unit replacement through the same exact attempt owner", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const specification = makeTaskWorkSpecification({
        body: "route exact owner",
        title: "routing",
        taskId: TaskId.make("routing-task")
      })
      const plannedAttempt = PlannedTaskAttempt.make({
        ...correlation("routing-attempt"),
        baseSha: GitCommitSha.make("a".repeat(40)),
        branch: TaskBranchRef.make("refs/heads/dalph/routing"),
        executor: TaskExecutorLocator.make("codex:production"),
        taskId: specification.taskId,
        taskRevision: specification.fingerprint,
        worktree: WorktreeLocator.make("/tmp/routing")
      })
      const request = PlannedAttemptExecutorRequest.make({ plannedAttempt, specification })
      const calls = yield* Ref.make<ReadonlyArray<string>>([])
      const acquired = yield* Ref.make(0)
      const layer = isolatedPlannedAttemptExecutorLayer(
        (subject) =>
          Effect.gen(function* () {
            yield* Ref.update(acquired, (count) => count + 1)
            const report = PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation: subject })
            const current = PlannedAttemptExecutorProjection.cases.Exact.make({ report })
            const record = (name: string, attempt: PlannedTaskAttempt) =>
              Effect.sync(() => {
                expect(attempt.attemptId).toBe(subject.attemptId)
                expect(attempt.runId).toBe(subject.runId)
              }).pipe(Effect.andThen(Ref.update(calls, (values) => [...values, name])))
            return Context.make(PlannedAttemptExecutor, {
              observe: () => Effect.succeed(current),
              begin: (input) => record("Begin", input.plannedAttempt).pipe(Effect.as(report)),
              requestSuspension: (input) => record("Suspend", input).pipe(Effect.as(report)),
              resume: (input) => record("Resume", input.plannedAttempt).pipe(Effect.as(report))
            }).pipe(
              Context.add(PlannedAttemptExecutorLifecycleObservation, {
                attach: () => Effect.succeed({ current, changes: Stream.empty, close: Effect.void })
              }),
              Context.add(CodexProviderWorkUnitReplacement, {
                replacePurgedProviderWorkUnit: (input) =>
                  record("Replace", input.plannedAttempt).pipe(
                    Effect.as({ _tag: "TaskWorkSessionAbsent", detail: "controlled absent session" })
                  )
              })
            )
          }),
        () => "controlled acquisition failure"
      )
      yield* Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        const replacement = yield* CodexProviderWorkUnitReplacement
        yield* executor.begin(request, { _tag: "InitialDelivery" })
        yield* executor.requestSuspension(plannedAttempt)
        yield* executor.resume(request)
        yield* replacement.replacePurgedProviderWorkUnit(
          CodexProviderWorkUnitReplacementRequest.make({
            claim: ActiveTaskClaim.make({
              operationId: OperationId.make("routing-claim"),
              owner: ClaimOwner.make("routing-owner"),
              taskId: specification.taskId,
              token: ClaimToken.make("routing-token")
            }),
            plannedAttempt,
            specification,
            requestId: CodexReplacementRequestId.make("routing-replacement")
          })
        )
        expect(yield* Ref.get(acquired)).toBe(1)
        expect(yield* Ref.get(calls)).toEqual(["Begin", "Suspend", "Resume", "Replace"])
      }).pipe(Effect.provide(layer))
    })
  )
)
