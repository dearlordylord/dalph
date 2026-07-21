import { expect, it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import type { TrackerTarget, TrackerTask } from "../src/domain.js"
import { TrackerGraphReader } from "../src/tracker-graph-reader.js"

interface ContractScenario {
  readonly complete: {
    readonly expectedTasks: ReadonlyArray<TrackerTask>
    readonly forbiddenTaskIdFragments: ReadonlyArray<string>
    readonly layer: Layer.Layer<TrackerGraphReader>
    readonly target: TrackerTarget
  }
  readonly failures: ReadonlyArray<{
    readonly expectedErrorTag: string
    readonly layer: Layer.Layer<TrackerGraphReader>
    readonly name: string
    readonly target: TrackerTarget
  }>
  readonly name: string
}

/** Shared black-box contract for every tracker graph reader implementation. */
export const trackerGraphReaderContract = (
  scenario: ContractScenario
): void => {
  it.effect(`${scenario.name} returns one complete opaque task snapshot`, () =>
    Effect.gen(function*() {
      const reader = yield* TrackerGraphReader
      const snapshot = yield* reader.read(scenario.complete.target)
      expect(snapshot.toWire().tasks).toEqual(scenario.complete.expectedTasks)
      for (const taskId of snapshot.taskIds()) {
        for (const fragment of scenario.complete.forbiddenTaskIdFragments) {
          expect(taskId).not.toContain(fragment)
        }
      }
    }).pipe(Effect.provide(scenario.complete.layer)))

  for (const failure of scenario.failures) {
    it.effect(`${scenario.name} exposes no snapshot for ${failure.name}`, () =>
      Effect.gen(function*() {
        const reader = yield* TrackerGraphReader
        const error = yield* reader.read(failure.target).pipe(
          Effect.flip,
          Effect.orDie
        )
        expect(error._tag).toBe(failure.expectedErrorTag)
      }).pipe(Effect.provide(failure.layer)))
  }
}
