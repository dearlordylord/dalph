import { Clock, Duration, Effect, Layer, Random, Schema } from "effect"
import { TrackerGraphReader } from "./tracker-graph-reader.js"
import { WorkflowInterpreter, WorkflowOutcome } from "./workflow.js"

// Dry-run demonstration pacing policy: https://github.com/dearlordylord/dalph/issues/99
const minimumSimulatedTaskDurationMillis = 5

// Dry-run demonstration pacing policy: https://github.com/dearlordylord/dalph/issues/99
const maximumSimulatedTaskDurationMillis = 25

/**
 * Fictional dry-run pacing used only by the simulator. It is not tracker
 * authority, production configuration, an estimate, or a workflow fact.
 */
const SimulatedTaskDuration = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(minimumSimulatedTaskDurationMillis),
  Schema.isLessThanOrEqualTo(maximumSimulatedTaskDurationMillis)
).pipe(Schema.brand("SimulatedTaskDuration"))
type SimulatedTaskDuration = typeof SimulatedTaskDuration.Type

const simulatedTaskDuration = Effect.fn(
  "DryRunSimulator.simulatedTaskDuration"
)(function*(random: typeof Random.Random.Service) {
  return yield* Random.nextIntBetween(
    minimumSimulatedTaskDurationMillis,
    maximumSimulatedTaskDurationMillis
  ).pipe(
    Effect.provideService(Random.Random, random),
    Effect.map(SimulatedTaskDuration.make)
  )
})

export const dryRunWorkflowInterpreterLayer: Layer.Layer<
  WorkflowInterpreter,
  never,
  TrackerGraphReader
> = Layer.effect(
  WorkflowInterpreter,
  Effect.gen(function*() {
    const random = yield* Random.Random
    const reader = yield* TrackerGraphReader
    const readTrackerGraph = Effect.fn(
      "WorkflowInterpreter.DryRun.readTrackerGraph"
    )(function*(operation) {
      return yield* reader.read(operation.target)
    })
    const executeTask = Effect.fn("WorkflowInterpreter.DryRun.executeTask")(function*(
      _operation
    ) {
      const duration = yield* simulatedTaskDuration(random)
      yield* Clock.clockWith((clock) => clock.sleep(Duration.millis(duration)))
      return WorkflowOutcome.cases.TaskExecuted.make({})
    })

    return WorkflowInterpreter.of({ executeTask, readTrackerGraph })
  })
)
