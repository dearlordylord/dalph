import { RunId, TaskId } from "@dalph/contracts"
import { makeApplicationExitLifecycle, makeProductionHostApplicationExitShell } from "@dalph/orchestrator"
import { it } from "@effect/vitest"
import { Deferred, Effect, Fiber, Ref } from "effect"
import { TestClock } from "effect/testing"
import { expect } from "vitest"
import { makeRunningHostCommandOwnership } from "./running-host-command-ownership.js"
import { HostInstanceId, RequestId } from "./running-host-contract.js"

for (const operation of [
  { _tag: "StartWork" },
  { _tag: "Refresh", interest: { _tag: "WholeGraph" } },
  { _tag: "Refresh", interest: { _tag: "AdvisoryTasks", taskIds: [TaskId.make("C"), TaskId.make("E")] } }
] as const) {
  it.effect(
    `the host completes admitted ${operation._tag} ${"interest" in operation ? operation.interest._tag : ""} after its client stops waiting`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const lifecycle = yield* makeApplicationExitLifecycle()
          const entered = yield* Deferred.make<void>()
          const release = yield* Deferred.make<void>()
          const completed = yield* Deferred.make<void>()
          const command = yield* makeRunningHostCommandOwnership(
            HostInstanceId.make("host"),
            lifecycle.admission,
            Effect.never,
            () =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.andThen(Deferred.succeed(completed, undefined)),
                Effect.as(
                  operation._tag === "Refresh"
                    ? { _tag: "RefreshSubmitted" as const, interest: operation.interest }
                    : { _tag: "WakeSubmitted" as const }
                )
              )
          )
          const waiting = yield* command({
            protocolVersion: 1,
            hostInstanceId: HostInstanceId.make("host"),
            requestId: RequestId.make("request"),
            runId: RunId.make("R"),
            operation
          }).pipe(Effect.forkChild)
          yield* Deferred.await(entered)
          yield* Fiber.interrupt(waiting)
          expect((yield* lifecycle.admission.snapshot).registeredOwnerCount).toBe(1)
          yield* Deferred.succeed(release, undefined)
          yield* Deferred.await(completed)
        })
      )
  )

  it.effect(
    `Exit rejects later ${operation._tag} ${"interest" in operation ? operation.interest._tag : ""} before its operation starts`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const lifecycle = yield* makeApplicationExitLifecycle()
          const executions = yield* Ref.make(0)
          const command = yield* makeRunningHostCommandOwnership(
            HostInstanceId.make("host"),
            lifecycle.admission,
            lifecycle.awaitExitResult.pipe(Effect.asVoid),
            () =>
              Ref.update(executions, (count) => count + 1).pipe(
                Effect.as(
                  operation._tag === "Refresh"
                    ? { _tag: "RefreshSubmitted" as const, interest: operation.interest }
                    : { _tag: "WakeSubmitted" as const }
                )
              )
          )
          yield* lifecycle.requestExit
          expect(
            yield* command({
              protocolVersion: 1,
              hostInstanceId: HostInstanceId.make("host"),
              requestId: RequestId.make("late"),
              runId: RunId.make("R"),
              operation
            }).pipe(Effect.flip)
          ).toEqual({ _tag: "HostClosing", hostInstanceId: "host", cutoff: "AdmissionClosed" })
          expect(yield* Ref.get(executions)).toBe(0)
          expect((yield* lifecycle.admission.snapshot).registeredOwnerCount).toBe(0)
        })
      )
  )
}

it.effect(
  "an admitted command uses the original five-second Exit drain and reports unknown if it does not finish",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const shell = yield* makeProductionHostApplicationExitShell()
        const entered = yield* Deferred.make<void>()
        const stopped = yield* Deferred.make<void>()
        const command = yield* makeRunningHostCommandOwnership(
          HostInstanceId.make("host"),
          shell.admission,
          shell.awaitExitResult.pipe(Effect.asVoid),
          () =>
            Deferred.succeed(entered, undefined).pipe(
              Effect.andThen(Effect.never),
              Effect.ensuring(Deferred.succeed(stopped, undefined))
            )
        )
        const waiting = yield* command({
          protocolVersion: 1,
          hostInstanceId: HostInstanceId.make("host"),
          requestId: RequestId.make("stuck"),
          runId: RunId.make("R"),
          operation: { _tag: "Unpause" }
        }).pipe(Effect.result, Effect.forkChild)
        yield* Deferred.await(entered)
        const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
        yield* shell.awaitExitRequested
        yield* TestClock.adjust("5 seconds")
        expect(yield* Fiber.join(exiting)).toMatchObject({ _tag: "TimedOut" })
        expect(yield* Fiber.join(waiting)).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "CommandOutcomeUnknown",
            operation: "Unpause",
            requestId: "stuck",
            phase: "AdmittedCompletionUnconfirmed"
          }
        })
        yield* Deferred.await(stopped)
        expect((yield* shell.admission.snapshot).registeredOwnerCount).toBe(0)
      })
    )
)

it.effect("an admitted command retains its known failure while the original Exit drains", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const shell = yield* makeProductionHostApplicationExitShell()
      const entered = yield* Deferred.make<void>()
      const release = yield* Deferred.make<void>()
      const command = yield* makeRunningHostCommandOwnership(
        HostInstanceId.make("host"),
        shell.admission,
        shell.awaitExitResult.pipe(Effect.asVoid),
        () =>
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
            Effect.andThen(
              Effect.fail({
                _tag: "CommandFailed" as const,
                operation: "StartWork" as const,
                stage: "BeforeApplication" as const,
                causeTag: "ControlledFailure",
                detail: "controlled"
              })
            )
          )
      )
      const waiting = yield* command({
        protocolVersion: 1,
        hostInstanceId: HostInstanceId.make("host"),
        requestId: RequestId.make("failing"),
        runId: RunId.make("R"),
        operation: { _tag: "StartWork" }
      }).pipe(Effect.result, Effect.forkChild)
      yield* Deferred.await(entered)
      const exiting = yield* shell.requestBoundary.requestExit.pipe(Effect.forkChild)
      yield* shell.awaitExitRequested
      yield* Deferred.succeed(release, undefined)
      expect(yield* Fiber.join(waiting)).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CommandFailed", causeTag: "ControlledFailure" }
      })
      expect(yield* Fiber.join(exiting)).toMatchObject({ _tag: "Succeeded" })
      expect((yield* shell.admission.snapshot).registeredOwnerCount).toBe(0)
    })
  )
)
