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
    lastControlResult: Schema.Unknown,
    membershipProof: Schema.Unknown,
    pauseAtRequest: Schema.Struct({
      runPaused: Schema.Boolean,
      taskAPaused: Schema.Boolean,
      taskBPaused: Schema.Boolean
    }),
    pendingRequest: Schema.Unknown,
    runPaused: Schema.Boolean,
    taskAMembership: Schema.Unknown,
    taskAPaused: Schema.Boolean,
    taskBMembership: Schema.Unknown,
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
  if (tag === "NoRequest" || tag === "NoAppliedDirection" || tag === "NoControlResult") return tag
  const fields = variantValue(value)
  if (typeof fields !== "object" || fields === null) return tag
  return `${tag}:${variantTag(Reflect.get(fields, "subject"))}:${variantTag(Reflect.get(fields, "direction"))}`
}

const normalizedMembershipProof = (value: unknown): string => {
  const tag = variantTag(value)
  if (tag === "NoMembershipProof") return tag
  const fields = variantValue(value)
  if (typeof fields !== "object" || fields === null) return tag
  return `${tag}:${variantTag(Reflect.get(fields, "subject"))}`
}

type Subject = "RunSubject" | "TaskASubject" | "TaskBSubject"
type Direction = "Pause" | "Unpause"
type TaskMembership = "CurrentMember" | "OutsideTarget" | "UnreadableMembership"
type PauseSnapshot = { readonly runPaused: boolean; readonly taskAPaused: boolean; readonly taskBPaused: boolean }

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
    applyCurrentTaskPending: {},
    applyPending: {},
    applyRunPending: {},
    crashAndRestart: {},
    failUnreadableTaskA: {},
    failUnreadableTaskB: {},
    init: {},
    proveCurrentTaskA: {},
    proveCurrentTaskB: {},
    receiveRunPause: {},
    receiveRunUnpause: {},
    receiveTaskAPause: {},
    receiveTaskAUnpause: {},
    receiveTaskBPause: {},
    receiveTaskBUnpause: {},
    rejectStaleTaskA: {},
    rejectStaleTaskB: {},
    taskALeavesTarget: {},
    taskAReadBecomesUnreadable: {}
  },
  () => {
    let records: ReadonlyArray<JournalRecord> = [beganRecord]
    let pending: { readonly direction: Direction; readonly subject: Subject } | undefined
    let lastApplied: { readonly direction: Direction; readonly subject: Subject } | undefined
    let lastControlResult:
      | {
          readonly _tag: "DirectionApplied" | "MembershipReadFailed" | "StaleTaskRejected"
          readonly direction: Direction
          readonly subject: Subject
        }
      | undefined
    let membershipProof: Subject | undefined
    let pauseAtRequest: PauseSnapshot = { runPaused: false, taskAPaused: false, taskBPaused: false }
    let taskAMembership: TaskMembership = "CurrentMember"
    let taskBMembership: TaskMembership = "CurrentMember"
    const pauseSnapshot = (): PauseSnapshot => {
      const history = reduceWorkflowJournalHistory(runId, records)
      if (history._tag !== "ValidWorkflowJournalHistory") {
        throw new Error("control-direction conformance fixture produced invalid history")
      }
      const taskPauses =
        history.runState.pause.tasks._tag === "TaskPauses"
          ? new Set(history.runState.pause.tasks.taskIds)
          : new Set<TaskId>()
      return {
        runPaused: history.runState.pause.run._tag === "RunPaused",
        taskAPaused: taskPauses.has(taskA),
        taskBPaused: taskPauses.has(taskB)
      }
    }
    const receive = (subject: Subject, direction: Direction) =>
      Effect.sync(() => {
        pauseAtRequest = pauseSnapshot()
        pending = { direction, subject }
        membershipProof = undefined
        lastControlResult = undefined
      })
    const proveCurrent = (subject: "TaskASubject" | "TaskBSubject") =>
      Effect.sync(() => {
        const membership = subject === "TaskASubject" ? taskAMembership : taskBMembership
        if (pending?.subject === subject && membership === "CurrentMember") membershipProof = subject
      })
    const completeWithoutApplication = (
      subject: "TaskASubject" | "TaskBSubject",
      membership: Exclude<TaskMembership, "CurrentMember">,
      result: "MembershipReadFailed" | "StaleTaskRejected"
    ) =>
      Effect.sync(() => {
        const actualMembership = subject === "TaskASubject" ? taskAMembership : taskBMembership
        if (pending?.subject !== subject || actualMembership !== membership) return
        lastControlResult = { _tag: result, direction: pending.direction, subject }
        pending = undefined
        membershipProof = undefined
      })
    const applyPending = () =>
      Effect.sync(() => {
        if (pending === undefined) return
        if (pending.subject !== "RunSubject" && membershipProof !== pending.subject) return
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
        lastControlResult = { _tag: "DirectionApplied", direction: pending.direction, subject: pending.subject }
        pending = undefined
        membershipProof = undefined
      })
    return {
      init: () =>
        Effect.sync(() => {
          records = [beganRecord]
          pending = undefined
          lastApplied = undefined
          lastControlResult = undefined
          membershipProof = undefined
          pauseAtRequest = { runPaused: false, taskAPaused: false, taskBPaused: false }
          taskAMembership = "CurrentMember"
          taskBMembership = "CurrentMember"
        }),
      receiveRunPause: () => receive("RunSubject", "Pause"),
      receiveRunUnpause: () => receive("RunSubject", "Unpause"),
      receiveTaskAPause: () => receive("TaskASubject", "Pause"),
      receiveTaskAUnpause: () => receive("TaskASubject", "Unpause"),
      receiveTaskBPause: () => receive("TaskBSubject", "Pause"),
      receiveTaskBUnpause: () => receive("TaskBSubject", "Unpause"),
      proveCurrentTaskA: () => proveCurrent("TaskASubject"),
      proveCurrentTaskB: () => proveCurrent("TaskBSubject"),
      rejectStaleTaskA: () => completeWithoutApplication("TaskASubject", "OutsideTarget", "StaleTaskRejected"),
      rejectStaleTaskB: () => completeWithoutApplication("TaskBSubject", "OutsideTarget", "StaleTaskRejected"),
      failUnreadableTaskA: () =>
        completeWithoutApplication("TaskASubject", "UnreadableMembership", "MembershipReadFailed"),
      failUnreadableTaskB: () =>
        completeWithoutApplication("TaskBSubject", "UnreadableMembership", "MembershipReadFailed"),
      taskALeavesTarget: () =>
        Effect.sync(() => {
          taskAMembership = "OutsideTarget"
        }),
      taskAReadBecomesUnreadable: () =>
        Effect.sync(() => {
          taskAMembership = "UnreadableMembership"
        }),
      crashAndRestart: () =>
        Effect.sync(() => {
          pending = undefined
          membershipProof = undefined
          lastControlResult = undefined
        }),
      applyCurrentTaskPending: applyPending,
      applyPending,
      applyRunPending: applyPending,
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
            // Saturates to mirror the model's counter (specs/controlDirectionApplication.qnt).
            // The spec keeps only the 0 vs >0 distinction, so an exact count here
            // diverges from step two onward.
            appliedCount: Math.min(records.length - 1, 1),
            executorInterrupted: false,
            executorResumed: false,
            finalPausePhaseClaimed: false,
            lastApplied:
              lastApplied === undefined
                ? "NoAppliedDirection"
                : `Applied:${lastApplied.subject}:${lastApplied.direction}`,
            lastAppliedWasOperatorInitiated: lastApplied !== undefined,
            lastControlResult:
              lastControlResult === undefined
                ? "NoControlResult"
                : `${lastControlResult._tag}:${lastControlResult.subject}:${lastControlResult.direction}`,
            membershipProof:
              membershipProof === undefined ? "NoMembershipProof" : `CurrentMembershipProved:${membershipProof}`,
            pauseAtRequest,
            pendingRequest: pending === undefined ? "NoRequest" : `Requested:${pending.subject}:${pending.direction}`,
            runPaused: history.runState.pause.run._tag === "RunPaused",
            taskAMembership,
            taskAPaused: taskPauses.has(taskA),
            taskBMembership,
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
            lastControlResult: normalizedDirection(state.lastControlResult),
            membershipProof: normalizedMembershipProof(state.membershipProof),
            pendingRequest: normalizedDirection(state.pendingRequest),
            taskAMembership: variantTag(state.taskAMembership),
            taskBMembership: variantTag(state.taskBMembership)
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
        spec.lastControlResult === implementation.lastControlResult &&
        spec.membershipProof === implementation.membershipProof &&
        spec.pauseAtRequest.runPaused === implementation.pauseAtRequest.runPaused &&
        spec.pauseAtRequest.taskAPaused === implementation.pauseAtRequest.taskAPaused &&
        spec.pauseAtRequest.taskBPaused === implementation.pauseAtRequest.taskBPaused &&
        spec.pendingRequest === implementation.pendingRequest &&
        spec.runPaused === implementation.runPaused &&
        spec.taskAMembership === implementation.taskAMembership &&
        spec.taskAPaused === implementation.taskAPaused &&
        spec.taskBMembership === implementation.taskBMembership &&
        spec.taskBPaused === implementation.taskBPaused &&
        spec.trackerReread === implementation.trackerReread
    )
  },
  30_000
)
