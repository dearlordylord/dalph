import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import { Effect, Schema } from "effect"
import { RunId, TaskId } from "@dalph/contracts"
import {
  ControlDirectionApplicationOrdinal,
  ControlDirectionAppliedEvent,
  describeJournalEvent,
  FixtureTarget,
  InitialControlPolicy,
  JournalPosition,
  type JournalRecord,
  reduceWorkflowJournalHistory,
  TaskWorkCapacity,
  WorkflowRunBeganEvent,
  workflowJournalEventVersion
} from "@dalph/orchestrator"

const runId = RunId.make("control-direction-model-run")
const taskA = TaskId.make("task-A")
const taskB = TaskId.make("task-B")

const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    appliedCount: ITFBigInt,
    executorInterrupted: Schema.Boolean,
    executorResumed: Schema.Boolean,
    finalPausePhaseClaimed: Schema.Boolean,
    lastApplied: Schema.Unknown,
    lastAppliedWasOperatorInitiated: Schema.Boolean,
    pendingRequest: Schema.Unknown,
    runPaused: Schema.Boolean,
    taskAPaused: Schema.Boolean,
    taskBPaused: Schema.Boolean,
    trackerReread: Schema.Boolean
  })
})

const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)

const variantValue = (value: unknown): unknown =>
  typeof value === "object" && value !== null && "value" in value ? value.value : undefined

const normalizedDirection = (value: unknown): string => {
  const tag = variantTag(value)
  if (tag === "NoRequest" || tag === "NoAppliedDirection") return tag
  const fields = variantValue(value)
  if (typeof fields !== "object" || fields === null) return tag
  return `${tag}:${variantTag(Reflect.get(fields, "subject"))}:${variantTag(Reflect.get(fields, "direction"))}`
}

type Subject = "RunSubject" | "TaskASubject" | "TaskBSubject"
type Direction = "Pause" | "Unpause"

const beganEvent = WorkflowRunBeganEvent.make({
  initialControlPolicy: InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
  initiatedBy: { _tag: "DalphCoordinator" },
  occurrenceClassification: "InitiatedAction",
  target: FixtureTarget.make("control-direction-model-target"),
  version: workflowJournalEventVersion
})

const beganRecord: JournalRecord = {
  event: beganEvent,
  key: describeJournalEvent(beganEvent).expectedKey,
  position: JournalPosition.make(1),
  runId
}

const controlDirectionDriver = defineDriver(
  {
    applyPending: {},
    crashAndRestart: {},
    init: {},
    receiveRunPause: {},
    receiveRunUnpause: {},
    receiveTaskAPause: {},
    receiveTaskAUnpause: {},
    receiveTaskBPause: {},
    receiveTaskBUnpause: {}
  },
  () => {
    let records: ReadonlyArray<JournalRecord> = [beganRecord]
    let pending: { readonly direction: Direction; readonly subject: Subject } | undefined
    let lastApplied: { readonly direction: Direction; readonly subject: Subject } | undefined
    const receive = (subject: Subject, direction: Direction) =>
      Effect.sync(() => {
        pending = { direction, subject }
      })
    return {
      init: () =>
        Effect.sync(() => {
          records = [beganRecord]
          pending = undefined
          lastApplied = undefined
        }),
      receiveRunPause: () => receive("RunSubject", "Pause"),
      receiveRunUnpause: () => receive("RunSubject", "Unpause"),
      receiveTaskAPause: () => receive("TaskASubject", "Pause"),
      receiveTaskAUnpause: () => receive("TaskASubject", "Unpause"),
      receiveTaskBPause: () => receive("TaskBSubject", "Pause"),
      receiveTaskBUnpause: () => receive("TaskBSubject", "Unpause"),
      crashAndRestart: () =>
        Effect.sync(() => {
          pending = undefined
        }),
      applyPending: () =>
        Effect.sync(() => {
          if (pending === undefined) return
          const ordinal = ControlDirectionApplicationOrdinal.make(records.length)
          const subject =
            pending.subject === "RunSubject"
              ? { _tag: "Run" as const, runId }
              : { _tag: "Task" as const, runId, taskId: pending.subject === "TaskASubject" ? taskA : taskB }
          const event = ControlDirectionAppliedEvent.make({
            direction: pending.direction,
            initiatedBy: { _tag: "Operator" },
            occurrenceClassification: "InitiatedAction",
            ordinal,
            subject,
            version: workflowJournalEventVersion
          })
          records = [
            ...records,
            {
              event,
              key: describeJournalEvent(event).expectedKey,
              position: JournalPosition.make(records.length + 1),
              runId
            }
          ]
          lastApplied = pending
          pending = undefined
        }),
      getState: () =>
        Effect.sync(() => {
          const history = reduceWorkflowJournalHistory(runId, records)
          if (history._tag !== "ValidWorkflowJournalHistory") {
            throw new Error("control-direction conformance fixture produced invalid history")
          }
          const taskPauses =
            history.runState.pause.tasks._tag === "TaskPauses"
              ? new Set(history.runState.pause.tasks.taskIds)
              : new Set<TaskId>()
          return {
            appliedCount: records.length - 1,
            executorInterrupted: false,
            executorResumed: false,
            finalPausePhaseClaimed: false,
            lastApplied:
              lastApplied === undefined
                ? "NoAppliedDirection"
                : `Applied:${lastApplied.subject}:${lastApplied.direction}`,
            lastAppliedWasOperatorInitiated: lastApplied !== undefined,
            pendingRequest: pending === undefined ? "NoRequest" : `Requested:${pending.subject}:${pending.direction}`,
            runPaused: history.runState.pause.run._tag === "RunPaused",
            taskAPaused: taskPauses.has(taskA),
            taskBPaused: taskPauses.has(taskB),
            trackerReread: false
          }
        })
    }
  }
)

quintIt(
  it.effect,
  "replays received and applied control directions through production history reconstruction",
  {
    backend: "typescript",
    driverFactory: controlDirectionDriver,
    maxSteps: 12,
    nTraces: 100,
    seed: "166",
    spec: "specs/controlDirectionApplication.qnt",
    stateCheck: stateCheck(
      (raw) =>
        Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
          Effect.map(({ state }) => ({
            ...state,
            appliedCount: Number(state.appliedCount),
            lastApplied: normalizedDirection(state.lastApplied),
            pendingRequest: normalizedDirection(state.pendingRequest)
          })),
          Effect.orDie
        ),
      (spec, implementation) =>
        spec.appliedCount === implementation.appliedCount &&
        spec.executorInterrupted === implementation.executorInterrupted &&
        spec.executorResumed === implementation.executorResumed &&
        spec.finalPausePhaseClaimed === implementation.finalPausePhaseClaimed &&
        spec.lastApplied === implementation.lastApplied &&
        spec.lastAppliedWasOperatorInitiated === implementation.lastAppliedWasOperatorInitiated &&
        spec.pendingRequest === implementation.pendingRequest &&
        spec.runPaused === implementation.runPaused &&
        spec.taskAPaused === implementation.taskAPaused &&
        spec.taskBPaused === implementation.taskBPaused &&
        spec.trackerReread === implementation.trackerReread
    )
  },
  30_000
)
