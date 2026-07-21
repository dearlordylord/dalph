import { it } from "@effect/vitest"
import type { Duration } from "effect"
import { Clock, Effect, Fiber, FileSystem, Layer, Queue, Ref, Sink, Stdio } from "effect"
import type { Stdio as StdioService } from "effect/Stdio"
import { TestClock } from "effect/testing"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { expect } from "vitest"
import { dryCliEnvironmentLayer, dryRunCliApplication } from "./dry-run-application.js"

type IsExactly<A, B> = [A] extends [B] ? [B] extends [A] ? true
  : false
  : false
type Assert<T extends true> = T
type DryApplicationRequiresOnlyStdio = Assert<
  IsExactly<Effect.Services<typeof dryRunCliApplication>, StdioService>
>

const dryApplicationEnvironmentIsNarrow: DryApplicationRequiresOnlyStdio = true

it.effect("runs the complete dry CLI with only Stdio left to supply", () =>
  Effect.gen(function*() {
    const chunks = yield* Ref.make<ReadonlyArray<string>>([])
    const testClock = yield* TestClock.testClockWith(Effect.succeed)
    const clock = yield* Clock.Clock
    const sleeps = yield* Queue.unbounded<Duration.Duration>()
    const controlledClock = {
      ...clock,
      sleep: (duration: Duration.Duration) =>
        Queue.offer(sleeps, duration).pipe(
          Effect.andThen(clock.sleep(duration))
        )
    }
    const target = new URL("../fixtures/singleton.json", import.meta.url).pathname
    const stdioLayer = Stdio.layerTest({
      args: Effect.succeed(["run", "--dry", target]),
      stdout: () =>
        Sink.forEach((chunk: string | Uint8Array) => {
          const text = typeof chunk === "string"
            ? chunk
            : new TextDecoder().decode(chunk)
          return Ref.update(chunks, (current) => [...current, text])
        })
    })

    const run = yield* dryRunCliApplication.pipe(
      Effect.provide(stdioLayer),
      Effect.provide(Layer.succeed(Clock.Clock, controlledClock)),
      Effect.forkScoped
    )
    const duration = yield* Queue.take(sleeps)
    yield* testClock.adjust(duration)
    yield* Fiber.join(run)

    expect(dryApplicationEnvironmentIsNarrow).toBe(true)
    expect(yield* Ref.get(chunks)).toHaveLength(4)
  }))

it.effect("denies Effect CLI filesystem and child-process operations", () =>
  Effect.gen(function*() {
    const fileSystem = yield* FileSystem.FileSystem
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const fileError = yield* fileSystem.remove("not-authorized").pipe(
      Effect.flip,
      Effect.orDie
    )
    const processError = yield* spawner.exitCode(
      ChildProcess.make("not-authorized")
    ).pipe(Effect.flip, Effect.orDie)

    expect(fileError._tag).toBe("PlatformError")
    expect(processError._tag).toBe("PlatformError")
    expect(fileError.reason._tag).toBe("PermissionDenied")
    expect(processError.reason._tag).toBe("PermissionDenied")
  }).pipe(Effect.provide(dryCliEnvironmentLayer)))
