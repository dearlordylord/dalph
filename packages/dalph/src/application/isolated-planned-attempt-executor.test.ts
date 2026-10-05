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
  PlannedAttemptExecutorWriterCustody,
  PlannedAttemptResultRecoveryAuthorization,
  PlannedAttemptResultResponseCount,
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

it.effect("renews only a stopped rejected owner for a new Continue permission after old attachments leave", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const subject = correlation("rejected-a")
      const specification = makeTaskWorkSpecification({
        body: "recover retained work",
        title: "recovery",
        taskId: TaskId.make("recovery-task")
      })
      const plannedAttempt = PlannedTaskAttempt.make({
        ...subject,
        baseSha: GitCommitSha.make("a".repeat(40)),
        branch: TaskBranchRef.make("refs/heads/dalph/recovery"),
        executor: TaskExecutorLocator.make("codex:production"),
        taskId: specification.taskId,
        taskRevision: specification.fingerprint,
        worktree: WorktreeLocator.make("/tmp/recovery")
      })
      const request = PlannedAttemptExecutorRequest.make({ plannedAttempt, specification })
      const authorization = PlannedAttemptResultRecoveryAuthorization.make({
        nonce: "fresh-cycle",
        correlation: subject
      })
      const acquired: Array<string> = []
      const closed: Array<string> = []
      const continued: Array<string> = []
      const layer = isolatedPlannedAttemptExecutorLayer(
        (ownerSubject) =>
          Effect.gen(function* () {
            const key = `${ownerSubject.attemptId}:${acquired.length + 1}`
            acquired.push(key)
            yield* Effect.addFinalizer(() =>
              Effect.sync(() => {
                closed.push(key)
              })
            )
            const report =
              ownerSubject.attemptId === subject.attemptId && key.endsWith(":1")
                ? PlannedAttemptExecutorReport.cases.ExecutorWorkResultRejected.make({
                    correlation: ownerSubject,
                    reason: "ResultEnvelopeInvalid",
                    recoveryCause: "CorrectionExhausted",
                    responseCount: PlannedAttemptResultResponseCount.make(3),
                    custody: { _tag: "Stopped" }
                  })
                : PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation: ownerSubject })
            const current = PlannedAttemptExecutorProjection.cases.Exact.make({ report })
            return Context.make(PlannedAttemptExecutor, {
              observe: () => Effect.succeed(current),
              begin: () => Effect.succeed(report),
              requestSuspension: () => Effect.succeed(report),
              resume: () => Effect.succeed(report),
              continueRejectedResult: () =>
                Effect.sync(() => {
                  expect(key).not.toBe("rejected-a:1")
                  continued.push(key)
                  return report
                })
            }).pipe(
              Context.add(PlannedAttemptExecutorLifecycleObservation, {
                attach: () => Effect.succeed({ current, changes: Stream.empty, close: Effect.void })
              })
            )
          }),
        () => "acquisition unavailable"
      )
      yield* Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        const observations = yield* PlannedAttemptExecutorLifecycleObservation
        if (executor.continueRejectedResult === undefined) return yield* Effect.die("recovery must be exposed")
        const foreign = PlannedAttemptResultRecoveryAuthorization.make({
          nonce: "foreign",
          correlation: correlation("foreign")
        })
        expect((yield* executor.continueRejectedResult(request, foreign).pipe(Effect.result))._tag).toBe("Failure")
        expect(acquired).toEqual([])
        const attachment = yield* observations.attach(subject)
        yield* executor.observe(correlation("neighbour-b"), passiveLifecycleObservationPurpose)
        expect((yield* executor.continueRejectedResult(request, authorization).pipe(Effect.result))._tag).toBe(
          "Failure"
        )
        expect(acquired).toEqual(["rejected-a:1", "neighbour-b:2"])
        expect(continued).toEqual([])
        expect(closed).toEqual([])
        yield* attachment.close
        expect(closed).toEqual([])
        yield* executor.continueRejectedResult(request, authorization)
        yield* executor.continueRejectedResult(request, authorization)
        expect(acquired).toEqual(["rejected-a:1", "neighbour-b:2", "rejected-a:3"])
        expect(closed).toEqual(["rejected-a:1"])
        expect(continued).toEqual(["rejected-a:3", "rejected-a:3"])
        yield* executor.observe(correlation("neighbour-b"), passiveLifecycleObservationPurpose)
        expect(acquired).toHaveLength(3)
      }).pipe(Effect.provide(layer))
    })
  )
)

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
        const specification = makeTaskWorkSpecification({
          body: "retain historical terminal custody",
          title: "historical custody",
          taskId: TaskId.make("historical-task")
        })
        const plannedAttempt = PlannedTaskAttempt.make({
          ...subject,
          baseSha: GitCommitSha.make("a".repeat(40)),
          branch: TaskBranchRef.make("refs/heads/dalph/historical"),
          executor: TaskExecutorLocator.make("codex:production"),
          taskId: specification.taskId,
          taskRevision: specification.fingerprint,
          worktree: WorktreeLocator.make("/tmp/historical")
        })
        // Scope retirement and a Failed seal do not prove native writer absence.
        if (executor.observeWriterCustody === undefined) return yield* Effect.die("missing custody observer")
        expect(yield* executor.observeWriterCustody(plannedAttempt)).toEqual(
          PlannedAttemptExecutorWriterCustody.cases.Unresolved.make({
            plannedAttempt,
            detail: "isolated attempt owner does not expose writer custody observation"
          })
        )
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
              resume: (input) => record("Resume", input.plannedAttempt).pipe(Effect.as(report)),
              observeWriterCustody: (input) =>
                record("Custody", input).pipe(
                  Effect.as(PlannedAttemptExecutorWriterCustody.cases.Stopped.make({ plannedAttempt: input }))
                ),
              continueRejectedResult: (input, authorization) =>
                record("ContinueRejectedResult", input.plannedAttempt).pipe(
                  Effect.tap(() => Effect.sync(() => expect(authorization.correlation).toEqual(subject))),
                  Effect.as(report)
                )
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
        if (executor.observeWriterCustody === undefined || executor.continueRejectedResult === undefined)
          return yield* Effect.die("isolated owner must expose recovery boundaries")
        expect(yield* executor.observeWriterCustody(plannedAttempt)).toEqual(
          PlannedAttemptExecutorWriterCustody.cases.Stopped.make({ plannedAttempt })
        )
        yield* executor.continueRejectedResult(
          request,
          PlannedAttemptResultRecoveryAuthorization.make({
            nonce: "isolated-continue",
            correlation: correlation("routing-attempt")
          })
        )
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
        expect(yield* Ref.get(calls)).toEqual([
          "Begin",
          "Suspend",
          "Resume",
          "Custody",
          "ContinueRejectedResult",
          "Replace"
        ])
      }).pipe(Effect.provide(layer))
    })
  )
)

it.effect("scopes fresh recovery custody separately from a retired terminal routing owner", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const subject = correlation("retired-custody")
      const specification = makeTaskWorkSpecification({
        body: "recover",
        title: "recover",
        taskId: TaskId.make("retired")
      })
      const plannedAttempt = PlannedTaskAttempt.make({
        ...subject,
        baseSha: GitCommitSha.make("a".repeat(40)),
        branch: TaskBranchRef.make("refs/heads/dalph/retired"),
        executor: TaskExecutorLocator.make("codex:production"),
        taskId: specification.taskId,
        taskRevision: specification.fingerprint,
        worktree: WorktreeLocator.make("/tmp/retired")
      })
      const acquired = yield* Ref.make(0)
      const closed = yield* Ref.make(0)
      const custodyAcquired = yield* Ref.make(0)
      const custodyClosed = yield* Ref.make(0)
      const report = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
        correlation: subject,
        result: { _tag: "Failed" }
      })
      const layer = isolatedPlannedAttemptExecutorLayer(
        () =>
          Effect.gen(function* () {
            yield* Ref.update(acquired, (n) => n + 1)
            yield* Effect.addFinalizer(() => Ref.update(closed, (n) => n + 1))
            return Context.make(PlannedAttemptExecutor, {
              observe: () => Effect.succeed(PlannedAttemptExecutorProjection.cases.Exact.make({ report })),
              begin: () => Effect.succeed(report),
              requestSuspension: () => Effect.succeed(report),
              resume: () => Effect.succeed(report)
            }).pipe(
              Context.add(PlannedAttemptExecutorLifecycleObservation, { attach: () => Effect.die("unused attachment") })
            )
          }),
        () => "acquisition failed",
        (input) =>
          Effect.gen(function* () {
            expect(yield* Ref.get(closed)).toBe(1)
            yield* Ref.update(custodyAcquired, (n) => n + 1)
            yield* Effect.addFinalizer(() => Ref.update(custodyClosed, (n) => n + 1))
            return PlannedAttemptExecutorWriterCustody.cases.Stopped.make({ plannedAttempt: input })
          })
      )
      yield* Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.observe(subject, passiveLifecycleObservationPurpose)
        if (executor.observeWriterCustody === undefined) return yield* Effect.die("missing custody observer")
        expect(yield* executor.observeWriterCustody(plannedAttempt)).toEqual(
          PlannedAttemptExecutorWriterCustody.cases.Stopped.make({ plannedAttempt })
        )
        expect(yield* Ref.get(custodyAcquired)).toBe(1)
        expect(yield* Ref.get(custodyClosed)).toBe(1)
        yield* executor.observe(subject, passiveLifecycleObservationPurpose)
        expect(yield* Ref.get(acquired)).toBe(1)
        expect(yield* Ref.get(custodyAcquired)).toBe(1)
      }).pipe(Effect.provide(layer))
    })
  )
)
