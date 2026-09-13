/* eslint-disable import/no-nodejs-modules -- These tests observe actual controlled Node children and SIGKILL pipe interruption. */
import nodeProcess from "node:process"
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { RunId } from "@dalph/contracts"
import { Cause, Effect, Exit, Fiber, MutableList, Option, PlatformError, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { expect } from "vitest"
import type { ProductionCliRecord } from "../src/application/production-cli.js"
import { HermeticChildOutputFramingFailure, makeHermeticChildOutput } from "./production-hermetic-child-output.js"

const record: ProductionCliRecord = {
  _tag: "RunSelected",
  runId: RunId.make("run:雪😀"),
  selection: "Allocated",
  version: 1
}
const encode = (value: string) => new TextEncoder().encode(value)
const publicFrame = `${JSON.stringify(record)}\n`
const controlDescriptor = 3

const interruptedChild = Effect.fn("HermeticChildOutputTest.spawn")(function* (complete: string) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  return yield* spawner.spawn(
    ChildProcess.make(
      nodeProcess.execPath,
      [
        "-e",
        "const fs = require('node:fs'); fs.writeSync(1, process.argv[1]); fs.writeSync(1, '{\"partial\":'); fs.writeSync(3, 'written'); setInterval(() => {}, 1000);",
        complete
      ],
      { additionalFds: { fd3: { type: "output" } } }
    )
  )
})

const written = (child: ChildProcessSpawner.ChildProcessHandle) =>
  child.getOutputFd(controlDescriptor).pipe(
    Stream.runHead,
    Effect.tap((ack) =>
      Effect.sync(() => {
        expect(Option.isSome(ack)).toBe(true)
        if (Option.isSome(ack)) expect(new TextDecoder().decode(ack.value)).toBe("written")
      })
    )
  )

it.live("observes actual controller SIGKILL separately, joins pipes and preserves only complete public records", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* interruptedChild(publicFrame)
      const records = MutableList.make<ProductionCliRecord>()
      const output = yield* makeHermeticChildOutput(child, (value) =>
        Effect.sync(() => MutableList.append(records, value))
      )
      const reader = yield* output.read().pipe(Effect.forkScoped)
      const stderr = yield* child.stderr.pipe(Stream.runDrain, Effect.forkScoped)
      yield* written(child)
      const killed = yield* output.kill()
      expect(Exit.isFailure(killed)).toBe(true)
      if (Exit.isFailure(killed)) {
        const failure = Cause.findErrorOption(killed.cause)
        expect(Option.isSome(failure)).toBe(true)
        if (Option.isSome(failure)) {
          expect(failure.value).toBeInstanceOf(PlatformError.PlatformError)
          if (failure.value instanceof PlatformError.PlatformError) {
            expect(failure.value.reason).toMatchObject({ _tag: "Unknown", module: "ChildProcess", method: "exitCode" })
            expect(failure.value.reason.cause).toBeInstanceOf(Error)
            if (failure.value.reason.cause instanceof Error)
              expect(failure.value.reason.cause.message).toBe("Process interrupted due to receipt of signal: 'SIGKILL'")
          }
        }
      }
      yield* Effect.all([Fiber.join(reader), Fiber.join(stderr)])
      expect(yield* child.isRunning).toBe(false)
      expect(MutableList.toArray(records)).toEqual([record])
    })
  ).pipe(Effect.provide(NodeServices.layer))
)

for (const complete of ["not JSON\n", '{"_tag":"RunSelected","version":99}\n']) {
  it.effect("rejects a malformed complete public frame at normal EOF", () =>
    Effect.gen(function* () {
      const output = yield* makeHermeticChildOutput(
        {
          stdout: Stream.make(encode(complete)),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
          kill: () => Effect.void
        },
        () => Effect.void
      )
      expect(yield* output.read().pipe(Effect.flip)).toMatchObject({ _tag: "SchemaError" })
    })
  )
  it.live("rejects a malformed complete public frame even when an actual SIGKILL follows", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const child = yield* interruptedChild(complete)
        const records = MutableList.make<ProductionCliRecord>()
        const output = yield* makeHermeticChildOutput(child, (value) =>
          Effect.sync(() => MutableList.append(records, value))
        )
        const reader = yield* output.read().pipe(Effect.forkScoped)
        const stderr = yield* child.stderr.pipe(Stream.runDrain, Effect.forkScoped)
        yield* written(child)
        yield* output.kill()
        const result = yield* Effect.exit(Fiber.join(reader))
        expect(Exit.isFailure(result)).toBe(true)
        if (Exit.isFailure(result)) {
          const failure = Cause.findErrorOption(result.cause)
          expect(Option.isSome(failure)).toBe(true)
          if (Option.isSome(failure)) expect(failure.value).toMatchObject({ _tag: "SchemaError" })
        }
        yield* Fiber.join(stderr)
        expect(MutableList.toArray(records)).toEqual([])
      })
    ).pipe(Effect.provide(NodeServices.layer))
  )
}

it.effect("preserves complete frames across split byte chunks and a split Unicode character", () =>
  Effect.gen(function* () {
    const bytes = encode(publicFrame)
    const records = MutableList.make<ProductionCliRecord>()
    const output = yield* makeHermeticChildOutput(
      {
        stdout: Stream.fromIterable(Array.from(bytes, (byte) => new Uint8Array([byte]))),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
        kill: () => Effect.void
      },
      (value) => Effect.sync(() => MutableList.append(records, value))
    )
    yield* output.read()
    expect(MutableList.toArray(records)).toEqual([record])
  })
)

for (const requestKill of [false, true]) {
  it.effect("rejects normal EOF fragments even if a kill was requested without observed signal termination", () =>
    Effect.gen(function* () {
      const output = yield* makeHermeticChildOutput(
        {
          stdout: Stream.make(encode(`${publicFrame}{"partial":`)),
          exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(0)),
          kill: () => Effect.void
        },
        () => Effect.void
      )
      if (requestKill) yield* output.kill()
      expect(yield* output.read().pipe(Effect.flip)).toBeInstanceOf(HermeticChildOutputFramingFailure)
    })
  )
}

it.live("rejects an unclassified actual signal EOF fragment without a controller SIGKILL request", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* interruptedChild(publicFrame)
      const output = yield* makeHermeticChildOutput(child, () => Effect.void)
      const reader = yield* output.read().pipe(Effect.forkScoped)
      const stderr = yield* child.stderr.pipe(Stream.runDrain, Effect.forkScoped)
      yield* written(child)
      yield* child.kill({ killSignal: "SIGTERM" })
      expect(yield* Fiber.join(reader).pipe(Effect.flip)).toBeInstanceOf(HermeticChildOutputFramingFailure)
      yield* Fiber.join(stderr)
    })
  ).pipe(Effect.provide(NodeServices.layer))
)
