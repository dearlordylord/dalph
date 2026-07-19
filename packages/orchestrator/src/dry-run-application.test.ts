import { it } from "@effect/vitest"
import { Effect, FileSystem, Ref, Sink, Stdio } from "effect"
import type { Stdio as StdioService } from "effect/Stdio"
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
    const target = new URL("../fixtures/singleton.json", import.meta.url).pathname
    const stdioLayer = Stdio.layerTest({
      args: Effect.succeed(["run", "--dry", target]),
      stdout: () =>
        Sink.forEach((chunk: string | Uint8Array) =>
          Ref.update(chunks, (current) => [
            ...current,
            typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk)
          ])
        )
    })

    yield* dryRunCliApplication.pipe(Effect.provide(stdioLayer))

    expect(dryApplicationEnvironmentIsNarrow).toBe(true)
    expect(yield* Ref.get(chunks)).toHaveLength(5)
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
