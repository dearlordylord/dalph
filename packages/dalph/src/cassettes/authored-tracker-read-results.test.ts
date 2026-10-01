import { expect, it } from "@effect/vitest"
import { TaskId } from "@dalph/contracts"
import { FixtureTarget, TrackerGraphReader } from "@dalph/orchestrator"
import { Cause, Effect, Exit, Option, Result } from "effect"
import { AuthoredCassetteInteractionMismatch, makeStoryCursor } from "./authored-cursor.js"
import { controlledTrackerGraphReaderLayer } from "./authored-adapters.js"
import {
  consumeControlledTaskWorkSpecification,
  consumeControlledTrackerGraph
} from "./authored-tracker-read-results.js"

it.effect("reports an authored tracker graph mismatch as a cassette defect", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor([])
    const exit = yield* Effect.exit(consumeControlledTrackerGraph(cursor, FixtureTarget.make("mismatch")))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Result.getOrUndefined(Cause.findDefect(exit.cause))).toBeInstanceOf(AuthoredCassetteInteractionMismatch)
      expect(Option.isNone(Cause.findErrorOption(exit.cause))).toBe(true)
    }
  })
)

it.effect("reports an authored specification mismatch as a cassette defect", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor([])
    const exit = yield* Effect.exit(consumeControlledTaskWorkSpecification(cursor, TaskId.make("A")))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Result.getOrUndefined(Cause.findDefect(exit.cause))).toBeInstanceOf(AuthoredCassetteInteractionMismatch)
      expect(Option.isNone(Cause.findErrorOption(exit.cause))).toBe(true)
    }
  })
)

it.effect("keeps a direct tracker adapter cassette mismatch out of provider failures", () =>
  Effect.gen(function* () {
    const cursor = yield* makeStoryCursor([])
    const reader = yield* TrackerGraphReader.pipe(Effect.provide(controlledTrackerGraphReaderLayer(cursor)))
    const exit = yield* Effect.exit(reader.read(FixtureTarget.make("direct-mismatch")))
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(Result.getOrUndefined(Cause.findDefect(exit.cause))).toBeInstanceOf(AuthoredCassetteInteractionMismatch)
      expect(Option.isNone(Cause.findErrorOption(exit.cause))).toBe(true)
    }
  })
)
