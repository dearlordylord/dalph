import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, ITFMap, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import { Context, Effect, Layer, Schema } from "effect"
import { JournalStore, memoryJournalStoreLayer } from "../../src/journal-store.js"
import { makeFrontierRecoveryReconstructionControls } from "./frontier-recovery-reconstruction.js"

const actionSchema = {
  commitFirstIntent: { task: ITFBigInt },
  crash: {},
  init: {},
  observeTask: { task: ITFBigInt },
  reconstructionStep: {},
  restart: {}
}

const ModelProjection = Schema.Struct({
  state: Schema.Struct({
    control: Schema.Struct({
      runPaused: Schema.Boolean,
      taskPaused: ITFMap(ITFBigInt, Schema.Boolean)
    }),
    coordinator: Schema.Struct({ running: Schema.Boolean }),
    knowledge: ITFMap(
      ITFBigInt,
      Schema.Struct({ observation: Schema.Unknown })
    ),
    workflow: ITFMap(
      ITFBigInt,
      Schema.Struct({ responsibility: Schema.Unknown })
    )
  })
})

const variantTag = (value: unknown): string => {
  if (typeof value === "string") return value
  if (typeof value === "object" && value !== null && "tag" in value) {
    return String(value.tag)
  }
  return String(value)
}

const sortedBigInts = (values: Iterable<bigint>): ReadonlyArray<bigint> =>
  [...values].sort((left, right) => left < right ? -1 : left > right ? 1 : 0)

const reconstructionDriver = defineDriver(
  actionSchema,
  () => {
    const services = Effect.runSync(
      Layer.build(memoryJournalStoreLayer).pipe(Effect.scoped)
    )
    const journal = Context.get(services, JournalStore)
    const controls = Effect.runSync(
      makeFrontierRecoveryReconstructionControls({
        coordinatorRunning: true,
        journal
      }).pipe(Effect.orDie)
    )
    return {
      commitFirstIntent: ({ task }) => controls.commitFirstIntent(task),
      crash: () => controls.crash(),
      getState: controls.getState,
      init: () => controls.init(),
      observeTask: ({ task }) => controls.observeTask(task),
      reconstructionStep: () => controls.reconstructionStep(),
      restart: () => controls.restart()
    }
  }
)

quintIt(it.effect, "replays the M2 reconstruction slice through production reducers", {
  backend: "typescript",
  driverFactory: reconstructionDriver,
  maxSteps: 2,
  nTraces: 8,
  seed: "144",
  spec: "specs/frontierRecovery.qnt",
  step: "reconstructionStep",
  stateCheck: stateCheck(
    (raw) =>
      Schema.decodeUnknownEffect(ModelProjection)(raw).pipe(
        Effect.map(({ state }) => {
          const responsibleModelTaskIds = sortedBigInts(
            [...state.workflow]
              .filter(([, workflow]) => variantTag(workflow.responsibility) === "Outstanding")
              .map(([task]) => task)
          )
          return {
            coordinatorRunning: state.coordinator.running,
            knownModelTaskIds: sortedBigInts(state.knowledge.keys()),
            pause: {
              run: { _tag: state.control.runPaused ? "RunPaused" : "RunUnpaused" },
              tasks: {
                _tag: [...state.control.taskPaused.values()].some(Boolean)
                  ? "SomeTaskPauses"
                  : "NoTaskPauses"
              }
            },
            responsibleModelTaskIds,
            workflowEventTags: responsibleModelTaskIds.length === 0
              ? [
                "TrackerGraphObservationIntentRecorded",
                "TrackerGraphOutcomeObserved"
              ]
              : [
                "TrackerGraphObservationIntentRecorded",
                "TrackerGraphOutcomeObserved",
                "TaskClaimAcquisitionIntended"
              ]
          }
        }),
        Effect.orDie
      ),
    (model, implementation) =>
      model.coordinatorRunning === implementation.coordinatorRunning
      && model.knownModelTaskIds.join(",") === implementation.knownModelTaskIds.join(",")
      && model.responsibleModelTaskIds.join(",")
        === implementation.responsibleModelTaskIds.join(",")
      && JSON.stringify(model.pause) === JSON.stringify(implementation.pause)
      && model.workflowEventTags.join(",") === implementation.workflowEventTags.join(",")
  )
}, 30_000)
