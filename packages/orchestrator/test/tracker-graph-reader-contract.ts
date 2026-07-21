import { expect, it } from "@effect/vitest"
import { Effect, type Layer } from "effect"
import type { TaskId, TrackerTarget } from "../src/domain.js"
import { TrackerGraphReader } from "../src/tracker-graph-reader.js"

interface ContractScenario {
  readonly complete: {
    readonly expectedTaskIds: ReadonlyArray<TaskId>
    readonly layer: Layer.Layer<TrackerGraphReader>
    readonly target: TrackerTarget
  }
  readonly incomplete: {
    readonly expectedErrorTag: string
    readonly layer: Layer.Layer<TrackerGraphReader>
    readonly target: TrackerTarget
  }
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
      expect(snapshot.taskIds()).toEqual(scenario.complete.expectedTaskIds)
    }).pipe(Effect.provide(scenario.complete.layer)))

  it.effect(`${scenario.name} exposes no snapshot when its observation is incomplete`, () =>
    Effect.gen(function*() {
      const reader = yield* TrackerGraphReader
      const error = yield* reader.read(scenario.incomplete.target).pipe(
        Effect.flip,
        Effect.orDie
      )
      expect(error._tag).toBe(scenario.incomplete.expectedErrorTag)
    }).pipe(Effect.provide(scenario.incomplete.layer)))
}
