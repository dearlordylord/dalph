/* eslint-disable max-lines -- One adapter keeps the formal action-to-production admission map auditable. */
import { it } from "@effect/vitest"
import { defineDriver, ITFBigInt, ITFMap, stateCheck } from "@firfi/quint-connect/effect"
import { quintIt } from "@firfi/quint-connect/vitest"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { HashSet, Context, Effect, ManagedRuntime, Option, Result, Schema } from "effect"
import { expect } from "vitest"
import { exportWorkflowHistoryRecords } from "@dalph/orchestrator"
import { projectTrackerSnapshot } from "../../../orchestrator/src/authorities/task-tracker/graph.js"
import { ActiveTaskClaim, UnclaimedTask } from "../../../orchestrator/src/authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../../../orchestrator/src/authorities/task-tracker/claim.js"
import { PlannedWorktreeReady } from "../../../orchestrator/src/authorities/git/worktree.js"
import { FixtureTarget } from "../../../orchestrator/src/authorities/task-tracker/fixture/target.js"
import { TaskWorkCapacity } from "../../../orchestrator/src/coordination/admission/capacity.js"
import { makeFreshTaskAdmissionBasis } from "../../../orchestrator/src/coordination/admission/fresh-task-admission.js"
import {
  projectFreshTaskAdmission,
  projectFreshTaskCommitments
} from "../../../orchestrator/src/coordination/admission/fresh-task-admission-projection.js"
import { makeIntegrationTargetResourceController } from "../../../orchestrator/src/coordination/admission/integration-target-resource.js"
import { makeApplicationExitLifecycle } from "../../../orchestrator/src/coordination/application-exit/lifecycle.js"
import {
  makeDeliveryRuntimeAdmissionController,
  type DeliveryAdmissionReservation,
  type DeliveryRuntimeAdmissionController
} from "../../../orchestrator/src/coordination/delivery/delivery-runtime-admission.js"
import {
  DeliveryProposalId,
  freshContinuationDecisionsOf,
  trackerGraphReadProposalOf
} from "../../../orchestrator/src/coordination/delivery/delivery-proposal.js"
import {
  deliveryProposalsOf,
  deliveryProposalOfAcceptedFreshTask
} from "../../../orchestrator/src/coordination/delivery/delivery-proposal-derivation.js"
import {
  deriveFreshTaskCandidateEvaluation,
  type FreshTaskCandidateFrontier
} from "../../../orchestrator/src/coordination/delivery/fresh-task-candidate.js"
import { FreshWorkflowStep } from "../../../orchestrator/src/coordination/delivery/fresh-workflow-step.js"
import { RunnableFrontierTransition } from "../../../orchestrator/src/coordination/frontier/frontier.js"
import {
  InitialControlPolicy,
  RunPolicyRevision,
  initialRunPolicyRevision
} from "../../../orchestrator/src/control/policy.js"
import type { CurrentDeliveryFrame } from "../../../orchestrator/src/coordination/run/current-delivery-frame.js"
import { RunActivationOpportunity } from "../../../orchestrator/src/coordination/run/run-activation-opportunity.js"
import { deriveJournalResponsibilityFacts } from "../../../orchestrator/src/coordination/run/recovery-activation.js"
import { reconstructedTaskGraphFor } from "../../../orchestrator/src/coordination/reconstruction/graph-knowledge.js"
import {
  advanceWorkflowJournalHistory,
  observeWorkflowJournalValidationSteps,
  reduceWorkflowJournalHistory
} from "../../../orchestrator/src/coordination/reconstruction/history.js"
import { requiredPlannedAttemptPositionsOf } from "../../../orchestrator/src/coordination/run/required-planned-attempt-positions.js"
import { JournalPosition, type JournalRecordKey } from "../../../orchestrator/src/workflow-journal/identity.js"
import {
  InRunJournal,
  type AppendableWorkflowJournalEvent,
  type JournalRecord
} from "../../../orchestrator/src/workflow-journal/store.js"
import type { AcceptedJournalReader } from "../../../orchestrator/src/workflow-journal/accepted-reader.js"
import type { Journal } from "../../../orchestrator/src/coordination/delivery/journal.js"
import { liveJournalTestLayer } from "../../../orchestrator/src/coordination/delivery/live-journal-test-layer.js"
import {
  attemptPlanRecordKey,
  intentRecordKey,
  outcomeRecordKey,
  plannedAttemptExecutorCommandIntendedRecordKey,
  plannedAttemptExecutorCommandProjectionObservedRecordKey,
  plannedAttemptExecutorCommandResponseObservedRecordKey,
  plannedAttemptExecutorWorkReportedRecordKey,
  taskWorkCapacityPolicyRecordKey
} from "../../../orchestrator/src/workflow-journal/record-key.js"
import { makeWorkflowRunBeganRecord } from "../../../orchestrator/src/workflow-journal/run-lifecycle.js"
import { OperationId } from "../../../orchestrator/src/workflow/identity.js"
import {
  makeTaskClaimAcquisitionOperation,
  makeTaskClaimObservationOperation,
  makeTaskAttemptPlanOperation,
  makeTaskWorkSpecificationObservationOperation,
  makeTaskWorktreeObservationOperation,
  makeTargetLineageObservationOperation,
  makeTaskWorktreeReconciliationOperation,
  makeTrackerGraphObservationOperation
} from "../../../orchestrator/src/workflow/registry/operation.js"
import {
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  TaskClaimAcquisitionRejectedEvent,
  TaskWorkCapacityChangedEvent,
  TaskWorktreeReconciliationIntendedEvent,
  TaskWorktreeReadyEvent,
  taskTrackerReadIntent
} from "../../../orchestrator/src/workflow/registry/event.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../../../orchestrator/src/workflow/task-tracker-facts/observation.js"
import { workflowJournalEventVersion } from "../../../orchestrator/src/workflow/kernel/event.js"
import {
  PlannedAttemptProtocolController,
  makePlannedAttemptProtocolController
} from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/protocol-controller.js"
import { beginPlannedAttemptExecutorResponsibility } from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/responsibility.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionObservation,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent
} from "../../../orchestrator/src/workflow/protocols/planned-attempt-executor-work/events.js"

const taskTags = ["TaskA", "TaskB", "TaskC", "TaskD", "TaskE"] as const
type TaskTag = (typeof taskTags)[number]
const continuationWitnessTags = ["AuthoredSpecification", "ExactClaim", "PlannedWorktree", "TargetLineage"] as const
type ContinuationWitnessTag = (typeof continuationWitnessTags)[number]

const runId = RunId.make("fresh-task-admission-mbt-run")
const target = FixtureTarget.make("fresh-task-admission-mbt-target")
const initialPolicy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(3) })
const taskIds = new Map<TaskTag, TaskId>(taskTags.map((tag) => [tag, TaskId.make(tag.slice(-1))]))
const taskIdFor = (tag: TaskTag): TaskId => Option.getOrThrow(Option.fromUndefinedOr(taskIds.get(tag)))
const tagForTaskId = (taskId: TaskId): TaskTag => {
  const found = taskTags.find((tag) => taskIdFor(tag) === taskId)
  if (found === undefined) return Effect.runSync(Effect.die(`unknown MBT task ${taskId}`))
  return found
}
const variantTag = (value: unknown): string =>
  typeof value === "object" && value !== null && "tag" in value ? String(value.tag) : String(value)
const taskTagOf = (value: unknown): TaskTag => {
  const tag = variantTag(value)
  if (!taskTags.includes(tag as TaskTag)) return Effect.runSync(Effect.die(`unknown model task ${tag}`))
  return tag as TaskTag
}

const graph = (() => {
  const projected = projectTrackerSnapshot({
    revision: "fresh-task-admission-mbt-graph",
    tasks: taskTags.map((tag) => ({
      id: taskIdFor(tag),
      lifecycle: { _tag: "Open" as const },
      parentTaskId: null,
      prerequisiteIds: []
    }))
  })
  return Option.getOrThrow(Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined))
})()

const graphWithLifecycle = (tag: TaskTag, lifecycle: "Open" | "TerminalWithoutSuccess") => {
  const projected = projectTrackerSnapshot({
    revision: `fresh-task-admission-mbt-${tag}-${lifecycle}`,
    tasks: taskTags.map((candidate) => ({
      id: taskIdFor(candidate),
      lifecycle: { _tag: candidate === tag ? lifecycle : ("Open" as const) },
      parentTaskId: null,
      prerequisiteIds: []
    }))
  })
  return Option.getOrThrow(Option.fromUndefinedOr(projected._tag === "Valid" ? projected.snapshot : undefined))
}

const integrationTarget = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("/repositories/fresh-task-admission-mbt.git")
})

const specificationFor = (tag: TaskTag) => makeTaskWorkSpecification({ body: tag, taskId: taskIdFor(tag), title: tag })

const attemptFor = (tag: TaskTag): PlannedTaskAttempt =>
  PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`fresh-task-admission-${tag}`),
    baseSha: GitCommitSha.make(String(taskTags.indexOf(tag) + 1).repeat(40)),
    branch: TaskBranchRef.make(`refs/heads/dalph/fresh-task-admission-${tag}`),
    executor: TaskExecutorLocator.make("executor:fresh-task-admission-mbt"),
    runId,
    taskId: taskIdFor(tag),
    taskRevision: specificationFor(tag).fingerprint,
    worktree: WorktreeLocator.make(`/worktrees/fresh-task-admission-${tag}`)
  })

const Variant = Schema.Struct({ tag: Schema.String, value: Schema.Unknown })
const SpecProjection = Schema.Struct({
  state: Schema.Struct({
    admission: ITFMap(Variant, Variant),
    capacity: ITFBigInt,
    claimCycle: ITFMap(Variant, Variant),
    process: Variant
  })
})

interface AdmissionProjection {
  readonly capacity: bigint
  readonly occupied: ReadonlyArray<{
    readonly attemptId?: PlannedTaskAttempt["attemptId"]
    readonly claimOperationId?: OperationId
    readonly runId?: RunId
    readonly state: string
    readonly task: TaskTag
  }>
  readonly process: string
}

const projectionOfSpec = (raw: unknown): Effect.Effect<AdmissionProjection> =>
  Schema.decodeUnknownEffect(SpecProjection)(raw).pipe(
    Effect.map(({ state }) => {
      const claimCycles = new Map([...state.claimCycle].map(([task, cycle]) => [taskTagOf(task), variantTag(cycle)]))
      return {
        capacity: state.capacity,
        occupied: [...state.admission]
          .filter(([, admission]) => variantTag(admission) !== "Unoccupied")
          .map(([task, admission]) => {
            const taskTag = taskTagOf(task)
            const stateTag = variantTag(admission)
            if (stateTag === "FreshTaskCommitted") {
              const cycle = claimCycles.get(taskTag) === "NextClaimCycle" ? 2 : 1
              return {
                claimOperationId: OperationId.make(`fresh-task-admission-${taskTag}-claim-${cycle}`),
                state: stateTag,
                task: taskTag
              }
            }
            return stateTag === "ExactAttemptHeld" || stateTag === "ExistingResponsibilityReserved"
              ? { attemptId: attemptFor(taskTag).attemptId, runId, state: stateTag, task: taskTag }
              : { state: stateTag, task: taskTag }
          })
          .toSorted((left, right) => left.task.localeCompare(right.task)),
        process: variantTag(state.process)
      }
    }),
    Effect.orDie
  )

const actionNames = {
  acceptSafeReportFor: { task: Schema.Unknown },
  authorizeSafeContinuationFor: { task: Schema.Unknown },
  contractCapacity: {},
  crash: {},
  expandCapacity: {},
  handoffReadyResponsibilityFor: { task: Schema.Unknown },
  handoffToExecutorResponsibilityFor: { task: Schema.Unknown },
  init: {},
  loseExecutorResponsibilityAppendResponseFor: { task: Schema.Unknown },
  loseAcceptedClaimIntentAppendResponseFor: { task: Schema.Unknown },
  loseAcceptedExecutorResponsibilityAppendResponseFor: { task: Schema.Unknown },
  observeClaimIntentPresentFor: { task: Schema.Unknown },
  observeExecutorResponsibilityAppendAbsentFor: { task: Schema.Unknown },
  observeExecutorResponsibilityAppendPresentFor: { task: Schema.Unknown },
  observeForeignClaimClearedFor: { task: Schema.Unknown },
  observeLifecycleClosureFor: { task: Schema.Unknown },
  observeLifecycleReopenFor: { task: Schema.Unknown },
  readContinuationWitnessFor: { task: Schema.Unknown, witness: Schema.Unknown },
  reconcileResumeAsStillSafeFor: { task: Schema.Unknown },
  recordClaimIntentFor: { task: Schema.Unknown },
  projectAcceptedWorktreeReadyFor: { task: Schema.Unknown },
  projectForeignClaimRejectionFor: { task: Schema.Unknown },
  projectOrdinarySafeContinuationReadyFor: { task: Schema.Unknown },
  probeFreshEntryDeferredFor: { task: Schema.Unknown },
  recover: {},
  releaseHeldPositionNotReadyFor: { task: Schema.Unknown },
  releaseHeldPositionReadyFor: { task: Schema.Unknown },
  reserveFreshEntryFor: { task: Schema.Unknown },
  reserveReadyResponsibilityFor: { task: Schema.Unknown },
  rejectFreshBypassFor: { task: Schema.Unknown },
  rejectSafeContinuationAtCapacityFor: { task: Schema.Unknown },
  selectSafeContinuationFor: { task: Schema.Unknown }
} as const

/** Repeated driver observations may share only this exact journal root and visible cutoff's successful cold fold. */
const makeExactPrefixReductionReader = () => {
  type ValidReduction = Extract<
    ReturnType<typeof reduceWorkflowJournalHistory>,
    { readonly _tag: "ValidWorkflowJournalHistory" }
  >
  let success:
    | { readonly records: ReadonlyArray<JournalRecord>; readonly cutoff: number; readonly reduction: ValidReduction }
    | undefined
  return {
    read: (records: ReadonlyArray<JournalRecord>, cutoff: number): ValidReduction => {
      if (success?.records === records && success.cutoff === cutoff) return success.reduction
      const reduction = reduceWorkflowJournalHistory(runId, records.slice(0, cutoff))
      if (reduction._tag === "InvalidWorkflowJournalHistory") {
        return Effect.runSync(
          Effect.die(`fresh-task admission MBT constructed invalid history: ${JSON.stringify(reduction.issues)}`)
        )
      }
      success = { records, cutoff, reduction }
      return reduction
    },
    reset: () => {
      success = undefined
    }
  }
}

/** Only an acknowledged append or explicit reveal may advance these two independent driver-owned cold seeds. */
const makeDriverPrefixPreparation = () => {
  type Reduction = ReturnType<ReturnType<typeof makeExactPrefixReductionReader>["read"]>
  type Prepared = {
    readonly records: ReadonlyArray<JournalRecord>
    readonly cutoff: number
    readonly reduction: Reduction
  }
  const fullReader = makeExactPrefixReductionReader()
  const visibleReader = makeExactPrefixReductionReader()
  let full: Prepared | undefined
  let visible: Prepared | undefined
  const samePrefix = (prior: ReadonlyArray<JournalRecord>, records: ReadonlyArray<JournalRecord>, cutoff: number) => {
    if (records.length < cutoff) return false
    for (let index = 0; index < cutoff; index += 1) {
      if (prior[index] !== records[index]) return false
    }
    return true
  }
  const coldFull = (records: ReadonlyArray<JournalRecord>) => {
    full = { records, cutoff: records.length, reduction: fullReader.read(records, records.length) }
  }
  const coldVisible = (records: ReadonlyArray<JournalRecord>, cutoff: number) => {
    visible = { records, cutoff, reduction: visibleReader.read(records, cutoff) }
    return visible.reduction
  }
  const advanceVisible = (records: ReadonlyArray<JournalRecord>, cutoff: number) => {
    const prior = visible
    if (prior === undefined || cutoff < prior.cutoff || !samePrefix(prior.records, records, prior.cutoff)) {
      return coldVisible(records, cutoff)
    }
    let reduction = prior.reduction
    for (let index = prior.cutoff; index < cutoff; index += 1) {
      const record = records[index]
      if (record === undefined) return coldVisible(records, cutoff)
      const advanced = advanceWorkflowJournalHistory(reduction, record)
      if (advanced._tag === "InvalidWorkflowJournalHistory") return coldVisible(records, cutoff)
      reduction = advanced
    }
    visible = { records, cutoff, reduction }
    return reduction
  }
  return {
    seed: (records: ReadonlyArray<JournalRecord>, cutoff: number) => {
      coldFull(records)
      return coldVisible(records, cutoff)
    },
    read: (records: ReadonlyArray<JournalRecord>, cutoff: number) =>
      visible?.records === records && visible.cutoff === cutoff ? visible.reduction : coldVisible(records, cutoff),
    append: (
      oldRecords: ReadonlyArray<JournalRecord>,
      records: ReadonlyArray<JournalRecord>,
      acknowledged: JournalRecord,
      cutoff: number
    ) => {
      const prior = full
      if (
        prior?.records !== oldRecords ||
        records.length !== oldRecords.length + 1 ||
        records.at(-1) !== acknowledged ||
        !samePrefix(oldRecords, records, oldRecords.length)
      ) {
        coldFull(records)
        return coldVisible(records, cutoff)
      }
      const advanced = advanceWorkflowJournalHistory(prior.reduction, acknowledged)
      if (advanced._tag === "InvalidWorkflowJournalHistory") {
        coldFull(records)
        return coldVisible(records, cutoff)
      }
      full = { records, cutoff: records.length, reduction: advanced }
      return advanceVisible(records, cutoff)
    },
    reveal: (records: ReadonlyArray<JournalRecord>, cutoff: number) => {
      if (full?.records !== records) {
        coldFull(records)
        return coldVisible(records, cutoff)
      }
      return advanceVisible(records, cutoff)
    },
    reset: () => {
      full = undefined
      visible = undefined
      fullReader.reset()
      visibleReader.reset()
    }
  }
}

const prefixReaderFixture = (): ReadonlyArray<JournalRecord> => {
  const revision = RunPolicyRevision.make(initialRunPolicyRevision + 1)
  return [
    makeWorkflowRunBeganRecord(runId, target, initialPolicy),
    {
      event: TaskWorkCapacityChangedEvent.make({
        capacity: TaskWorkCapacity.make(2),
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        previousRevision: initialRunPolicyRevision,
        revision,
        version: workflowJournalEventVersion
      }),
      key: taskWorkCapacityPolicyRecordKey(revision),
      position: JournalPosition.make(2),
      runId
    }
  ]
}

it("reuses only an exact driver journal root and cutoff while retaining independent cold results", () => {
  const records = prefixReaderFixture()
  const earlierCold = reduceWorkflowJournalHistory(runId, records.slice(0, 1))
  const fullCold = reduceWorkflowJournalHistory(runId, records)
  const reader = makeExactPrefixReductionReader()
  let steps = 0
  const restore = observeWorkflowJournalValidationSteps(() => {
    steps += 1
  })
  try {
    const earlier = reader.read(records, 1)
    expect(earlier).toEqual(earlierCold)
    expect(reader.read(records, 1)).toBe(earlier)
    expect(steps).toBe(1)
    const full = reader.read(records, records.length)
    expect(full).toEqual(fullCold)
    expect(reader.read(records, records.length)).toBe(full)
    expect(steps).toBe(3)
    expect(reader.read([...records], records.length)).toEqual(fullCold)
    expect(steps).toBe(5)
    reader.reset()
    expect(reader.read(records, records.length)).toEqual(fullCold)
    expect(steps).toBe(7)
    expect(makeExactPrefixReductionReader().read(records, records.length)).toEqual(fullCold)
    expect(steps).toBe(9)
    expect(earlier).toEqual(earlierCold)
  } finally {
    restore()
  }
})

it("cold-validates a concealed malformed driver suffix when revealed and never reuses its failure", () => {
  const valid = prefixReaderFixture()
  const malformed = valid.map((record, index) =>
    index === 1 ? { ...record, position: JournalPosition.make(99) } : record
  )
  const earlierCold = reduceWorkflowJournalHistory(runId, malformed.slice(0, 1))
  let invalidColdSteps = 0
  const restoreColdObserver = observeWorkflowJournalValidationSteps(() => {
    invalidColdSteps += 1
  })
  const invalidCold = reduceWorkflowJournalHistory(runId, malformed)
  restoreColdObserver()
  expect(invalidCold._tag).toBe("InvalidWorkflowJournalHistory")
  const detail =
    invalidCold._tag === "InvalidWorkflowJournalHistory"
      ? JSON.stringify(invalidCold.issues)
      : "expected invalid fixture"
  const reader = makeExactPrefixReductionReader()
  let steps = 0
  const restore = observeWorkflowJournalValidationSteps(() => {
    steps += 1
  })
  try {
    const earlier = reader.read(malformed, 1)
    expect(earlier).toEqual(earlierCold)
    expect(reader.read(malformed, 1)).toBe(earlier)
    expect(steps).toBe(1)
    expect(() => reader.read(malformed, malformed.length)).toThrow(
      `fresh-task admission MBT constructed invalid history: ${detail}`
    )
    expect(steps).toBe(1 + invalidColdSteps)
    expect(() => reader.read(malformed, malformed.length)).toThrow(
      `fresh-task admission MBT constructed invalid history: ${detail}`
    )
    expect(steps).toBe(1 + 2 * invalidColdSteps)
    expect(reader.read(valid, 1)).toEqual(earlierCold)
    expect(steps).toBe(2 + 2 * invalidColdSteps)
    expect(earlier).toEqual(earlierCold)
  } finally {
    restore()
  }
})

const nextPrefixReaderRecord = (): JournalRecord => {
  const revision = RunPolicyRevision.make(initialRunPolicyRevision + 2)
  return {
    event: TaskWorkCapacityChangedEvent.make({
      capacity: TaskWorkCapacity.make(3),
      initiatedBy: { _tag: "Operator" },
      occurrenceClassification: "InitiatedAction",
      previousRevision: RunPolicyRevision.make(initialRunPolicyRevision + 1),
      revision,
      version: workflowJournalEventVersion
    }),
    key: taskWorkCapacityPolicyRecordKey(revision),
    position: JournalPosition.make(3),
    runId
  }
}

it("advances independent driver full and visible histories only for a proven append and reveal", () => {
  const records = prefixReaderFixture()
  const began = records.slice(0, 1)
  const acknowledged = Option.getOrThrow(Option.fromUndefinedOr(records[1]))
  const third = nextPrefixReaderRecord()
  const hidden = [...records, third]
  const earlierCold = reduceWorkflowJournalHistory(runId, began)
  const fullCold = reduceWorkflowJournalHistory(runId, records)
  const hiddenCold = reduceWorkflowJournalHistory(runId, hidden)
  const preparation = makeDriverPrefixPreparation()
  let steps = 0
  const restore = observeWorkflowJournalValidationSteps(() => {
    steps += 1
  })
  try {
    const earlier = preparation.seed(began, began.length)
    expect(steps).toBe(2)
    expect(preparation.append(began, records, acknowledged, records.length)).toEqual(fullCold)
    expect(steps).toBe(4)
    expect(preparation.read(records, records.length)).toEqual(fullCold)
    expect(steps).toBe(4)
    expect(preparation.append(records, hidden, third, records.length)).toEqual(fullCold)
    expect(steps).toBe(5)
    expect(preparation.reveal(hidden, hidden.length)).toEqual(hiddenCold)
    expect(steps).toBe(6)
    expect(preparation.read([...hidden], hidden.length)).toEqual(hiddenCold)
    expect(steps).toBe(9)
    preparation.reset()
    expect(preparation.seed(hidden, hidden.length)).toEqual(hiddenCold)
    expect(steps).toBe(15)
    expect(earlier).toEqual(earlierCold)
  } finally {
    restore()
  }
})

it.each(["rewrittenPrefix", "wrongAcknowledgment", "duplicate", "batched"] as const)(
  "cold-folds the complete driver append observation when %s invalidates its extension proof",
  (kind) => {
    const records = prefixReaderFixture()
    const began = records.slice(0, 1)
    const last = Option.getOrThrow(Option.fromUndefinedOr(records[1]))
    const third = nextPrefixReaderRecord()
    const observed =
      kind === "rewrittenPrefix"
        ? records.map((record, index) =>
            index === 0 ? { ...record, runId: RunId.make("rewritten-driver-run") } : record
          )
        : kind === "duplicate"
          ? [...began]
          : kind === "batched"
            ? [...records, third]
            : records
    const acknowledged =
      kind === "wrongAcknowledgment"
        ? { ...last }
        : kind === "duplicate"
          ? Option.getOrThrow(Option.fromUndefinedOr(began[0]))
          : kind === "batched"
            ? third
            : last
    let coldSteps = 0
    const restoreColdObserver = observeWorkflowJournalValidationSteps(() => {
      coldSteps += 1
    })
    const cold = reduceWorkflowJournalHistory(runId, observed)
    restoreColdObserver()
    const preparation = makeDriverPrefixPreparation()
    preparation.seed(began, began.length)
    let steps = 0
    const restore = observeWorkflowJournalValidationSteps(() => {
      steps += 1
    })
    try {
      if (cold._tag === "InvalidWorkflowJournalHistory") {
        expect(() => preparation.append(began, observed, acknowledged, observed.length)).toThrow(
          `fresh-task admission MBT constructed invalid history: ${JSON.stringify(cold.issues)}`
        )
        expect(steps).toBe(coldSteps)
      } else {
        expect(preparation.append(began, observed, acknowledged, observed.length)).toEqual(cold)
        expect(steps).toBe(2 * observed.length)
      }
    } finally {
      restore()
    }
    if (kind === "rewrittenPrefix" && cold._tag === "InvalidWorkflowJournalHistory") {
      const equalWidth = makeDriverPrefixPreparation()
      const retained = equalWidth.seed(records, records.length)
      const retainedCold = reduceWorkflowJournalHistory(runId, records)
      expect(observed).toHaveLength(records.length)
      let rewrittenSteps = 0
      const restoreRewriteObserver = observeWorkflowJournalValidationSteps(() => {
        rewrittenSteps += 1
      })
      try {
        const detail = `fresh-task admission MBT constructed invalid history: ${JSON.stringify(cold.issues)}`
        expect(() => equalWidth.append(records, observed, acknowledged, observed.length)).toThrow(detail)
        expect(rewrittenSteps).toBe(coldSteps)
        expect(() => equalWidth.read(observed, observed.length)).toThrow(detail)
        expect(rewrittenSteps).toBe(2 * coldSteps)
        expect(() => equalWidth.reveal(observed, observed.length)).toThrow(detail)
        expect(rewrittenSteps).toBe(3 * coldSteps)
        expect(retained).toEqual(retainedCold)
      } finally {
        restoreRewriteObserver()
      }
    }
  }
)

it("cold-folds full invalid successor diagnostics repeatedly and concealed malformed observations on reveal", () => {
  const valid = prefixReaderFixture()
  const began = valid.slice(0, 1)
  const malformed = valid.map((record, index) =>
    index === 1 ? { ...record, position: JournalPosition.make(99) } : record
  )
  const acknowledged = Option.getOrThrow(Option.fromUndefinedOr(malformed[1]))
  const cold = reduceWorkflowJournalHistory(runId, malformed)
  expect(cold._tag).toBe("InvalidWorkflowJournalHistory")
  const detail =
    cold._tag === "InvalidWorkflowJournalHistory" ? JSON.stringify(cold.issues) : "expected invalid fixture"
  const preparation = makeDriverPrefixPreparation()
  const earlier = preparation.seed(began, began.length)
  expect(() => preparation.append(began, malformed, acknowledged, malformed.length)).toThrow(
    `fresh-task admission MBT constructed invalid history: ${detail}`
  )
  expect(() => preparation.append(began, malformed, acknowledged, malformed.length)).toThrow(
    `fresh-task admission MBT constructed invalid history: ${detail}`
  )
  expect(preparation.read(malformed, 1)).toEqual(earlier)
  expect(() => preparation.reveal(malformed, malformed.length)).toThrow(
    `fresh-task admission MBT constructed invalid history: ${detail}`
  )
  expect(preparation.read(valid, 1)).toEqual(earlier)
})

/**
 * Scenario-to-test mapping:
 * - A–C enter from A–E while D/E remain incapable: reserveFreshEntryFor + production candidate evaluation/controller.
 * - Foreign rejection is task-local and ambiguity retains occupancy: rejection/ambiguous append actions + journal projector.
 * - Handoff has no gap and B release admits D: handoff/release actions + atomic controller synchronization.
 * - Contraction/expansion and ready-existing priority: policy actions and ready-responsibility controller reservation.
 * - Process loss reconstructs durable occupancy only: crash/recover + a new controller projected from Journal facts.
 * - Closed-at-Safe then reopened C reserves before focused reads; cap two rejects it and cap three blocks fresh E.
 * - Its one reservation survives four exact read routes and hands off only after Resume intent; retry Safe is rederived.
 */
const freshTaskAdmissionDriver = defineDriver(actionNames, () => {
  const prefixReader = makeDriverPrefixPreparation()
  let process: "ProcessDown" | "ProcessUp" = "ProcessUp"
  let records: ReadonlyArray<JournalRecord> = [makeWorkflowRunBeganRecord(runId, target, initialPolicy)]
  let controller: DeliveryRuntimeAdmissionController | undefined
  let sequence = 1
  let visiblePrefixLength = 1
  let graphSequence = 0
  let acceptedFrontier: FreshTaskCandidateFrontier | undefined
  const reservations = new Map<TaskTag, DeliveryAdmissionReservation>()
  const continuationReservations = new Map<TaskTag, DeliveryAdmissionReservation>()
  const claimCycles = new Map<TaskTag, number>()
  const ambiguousResponsibilityTags = new Set<TaskTag>()
  const acquireJournalRuntime = (initialRecords: ReadonlyArray<JournalRecord>) => {
    prefixReader.reset()
    const managed = ManagedRuntime.make(liveJournalTestLayer({ records: initialRecords, runId, target }))
    const context = managed.runSync(Effect.context<AcceptedJournalReader | InRunJournal | Journal>())
    return { context, journal: Context.get(context, InRunJournal), managed }
  }
  let journalRuntime: ReturnType<typeof acquireJournalRuntime> | undefined
  const requireJournalRuntime = () =>
    journalRuntime ?? Effect.runSync(Effect.die("fresh-task admission journal used before init"))
  const visibleRecords = () => records.slice(0, visiblePrefixLength)
  const currentReduction = () => prefixReader.read(records, visiblePrefixLength)
  const revealAcceptedSuffix = () => {
    visiblePrefixLength = records.length
    prefixReader.reveal(records, visiblePrefixLength)
  }

  const append = (
    event: AppendableWorkflowJournalEvent,
    key: JournalRecordKey,
    visibility: "AcceptedUnobserved" | "Visible" = "Visible"
  ): JournalRecord => {
    if (visibility === "Visible" && visiblePrefixLength !== records.length) {
      return Effect.runSync(Effect.die("cannot append after a process-unobserved accepted Journal suffix"))
    }
    const oldRecords = records
    const record = Effect.runSync(requireJournalRuntime().journal.append(runId, key, event).pipe(Effect.orDie))
    records = Effect.runSync(requireJournalRuntime().journal.read(runId).pipe(Effect.orDie))
    sequence = Number(record.position)
    if (visibility === "Visible") visiblePrefixLength = records.length
    prefixReader.append(oldRecords, records, record, visiblePrefixLength)
    return record
  }
  const appendGraph = (suffix: string, explicitlyCoveredTaskIds: ReadonlyArray<TaskId> = [], snapshot = graph) => {
    const operation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make(`fresh-task-admission-graph-${suffix}-${++graphSequence}`),
      target,
      [],
      explicitlyCoveredTaskIds
    )
    append(taskTrackerReadIntent(operation), intentRecordKey(operation.operationId))
    append(
      taskTrackerFactsObservedEvent(operation.operationId, makeCompleteTaskTrackerFactsObserved(operation, snapshot)),
      outcomeRecordKey(operation.operationId)
    )
    return operation
  }
  let currentGraphOperation: ReturnType<typeof appendGraph>
  const appendLifecycleGraph = (tag: TaskTag, lifecycle: "Open" | "TerminalWithoutSuccess") => {
    const operation = makeTrackerGraphObservationOperation(
      { _tag: "AttemptContinuation" },
      OperationId.make(`fresh-task-admission-${tag}-lifecycle-${lifecycle}-${++graphSequence}`),
      target,
      [OperationId.make(`fresh-task-admission-${tag}-plan`)],
      [taskIdFor(tag)]
    )
    append(taskTrackerReadIntent(operation), intentRecordKey(operation.operationId))
    append(
      taskTrackerFactsObservedEvent(
        operation.operationId,
        makeCompleteTaskTrackerFactsObserved(operation, graphWithLifecycle(tag, lifecycle))
      ),
      outcomeRecordKey(operation.operationId)
    )
    return operation
  }

  const frame = (): CurrentDeliveryFrame => {
    const { runState } = currentReduction()
    const currentGraph = Option.getOrUndefined(reconstructedTaskGraphFor(runState.graphKnowledge, target))
    const currentGraphOperationId = runState.graphKnowledge.taskTrackerFacts.findLast(
      (observation) =>
        observation._tag === "CompleteTaskTrackerFacts" || observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
    )?.operationId
    const runControlPolicy = Option.getOrUndefined(runState.controlPolicy)
    if (
      currentGraph === undefined ||
      currentGraphOperationId === undefined ||
      runControlPolicy === undefined ||
      runState.appliedThrough === null
    ) {
      return Effect.runSync(Effect.die("fresh-task admission MBT frame is not reconstructable"))
    }
    return {
      acceptedAt: runState.appliedThrough,
      currentGraph,
      currentGraphOperationId,
      pause: runState.pause,
      responsibility: runState.responsibility,
      runId,
      runControlPolicy,
      workflowHistory: runState.workflowHistory
    }
  }
  const frontier = () =>
    Effect.gen(function* () {
      const currentFrame = frame()
      const required = requiredPlannedAttemptPositionsOf(currentReduction().runState)
      return yield* deriveFreshTaskCandidateEvaluation({
        acceptedAt: currentFrame.acceptedAt,
        activeRefreshBoundaryReached: false,
        frame: currentFrame,
        opportunity: RunActivationOpportunity.OrdinaryRunEntry(),
        recoveredAttemptIds: new Set(required.map(({ attemptId }) => attemptId)),
        runId,
        target
      }).pipe(Effect.map(({ frontier }) => frontier))
    })
  const safeContinuationRevalidations = () =>
    deriveJournalResponsibilityFacts(
      currentReduction().runState,
      Option.none(),
      Option.none(),
      target,
      RunActivationOpportunity.OrdinaryRunEntry()
    ).flatMap((facts) =>
      facts._tag === "PlannedAttemptExecutorFreshFacts" && facts.safeContinuationRevalidationEligibility !== undefined
        ? [facts.safeContinuationRevalidationEligibility]
        : []
    )
  const basis = () => {
    const { runState } = currentReduction()
    const policy = Option.getOrUndefined(runState.controlPolicy)
    if (policy === undefined) return Effect.die("fresh-task admission MBT policy is not reconstructable")
    const freshAdmission = projectFreshTaskAdmission(runId, exportWorkflowHistoryRecords(runState.workflowHistory))
    if (freshAdmission._tag === "FreshTaskAdmissionProjectionInvalid") return Effect.die(freshAdmission)
    return makeFreshTaskAdmissionBasis({
      acceptedAt: runState.appliedThrough,
      capacity: policy.taskExecutionCapacity,
      entries: [],
      projection: freshAdmission,
      runId,
      safeContinuationRevalidations: safeContinuationRevalidations()
    })
  }
  const makeController = Effect.fn("FreshTaskAdmissionMBT.makeController")(function* () {
    const protocol = yield* makePlannedAttemptProtocolController()
    return yield* makeDeliveryRuntimeAdmissionController(
      yield* basis(),
      yield* makeIntegrationTargetResourceController(),
      (yield* makeApplicationExitLifecycle()).admission
    ).pipe(Effect.provideService(PlannedAttemptProtocolController, protocol))
  })
  const requireController = () =>
    controller === undefined
      ? Effect.die("fresh-task admission MBT controller is not initialized")
      : Effect.succeed(controller)
  const assertNoOutsideFreshAdmissionWhenSelectedCommitmentsAreRetained = Effect.fn(
    "FreshTaskAdmissionMBT.assertNoOutsideFreshAdmissionWhenSelectedCommitmentsAreRetained"
  )(function* () {
    const snapshot = yield* (yield* requireController()).snapshot
    const selectedCommitmentsRetained = taskTags.slice(0, 3).every((tag) => snapshot.positions.has(taskIdFor(tag)))
    const outsideTaskAdmitted = taskTags.slice(3).some((tag) => snapshot.positions.has(taskIdFor(tag)))
    if (selectedCommitmentsRetained && outsideTaskAdmitted) {
      return yield* Effect.die("D/E fresh admission occurred while A-C commitments remained occupied")
    }
  })
  const synchronize = Effect.fn("FreshTaskAdmissionMBT.synchronize")(function* () {
    const admission = yield* requireController()
    const nextFrontier = yield* frontier()
    yield* admission.synchronize(yield* basis(), nextFrontier)
    acceptedFrontier = nextFrontier
    yield* assertNoOutsideFreshAdmissionWhenSelectedCommitmentsAreRetained()
  })
  const operationFor = (tag: TaskTag) => {
    const cycle = (claimCycles.get(tag) ?? 0) + 1
    claimCycles.set(tag, cycle)
    return makeTaskClaimAcquisitionOperation({
      acquisition: {
        operationId: OperationId.make(`fresh-task-admission-${tag}-claim-${cycle}`),
        owner: ClaimOwner.make("dalph"),
        taskId: taskIdFor(tag),
        token: ClaimToken.make(`fresh-task-admission-${tag}-token-${cycle}`)
      },
      predecessorOperationIds: [currentGraphOperation.operationId]
    })
  }
  const latestClaimOperationFor = (tag: TaskTag) => {
    const found = records.findLast(
      ({ event }) =>
        event._tag === "TaskClaimAcquisitionIntended" && event.operation.acquisition.taskId === taskIdFor(tag)
    )?.event
    return found?._tag === "TaskClaimAcquisitionIntended" ? found.operation : undefined
  }
  const acceptClaimIntent = (
    operation: ReturnType<typeof operationFor>,
    visibility: "AcceptedUnobserved" | "Visible" = "Visible"
  ) => {
    append(
      TaskClaimAcquisitionIntendedEvent.make({ operation, version: workflowJournalEventVersion }),
      intentRecordKey(operation.acquisition.operationId),
      visibility
    )
    const rejectedResurrections = projectFreshTaskCommitments(runId, records).filter(({ commitment }) =>
      records.some(
        ({ event }) =>
          event._tag === "TaskClaimAcquisitionRejected" &&
          event.operationId === commitment.operation.acquisition.operationId
      )
    )
    if (rejectedResurrections.length > 0) {
      return Effect.runSync(
        Effect.die(
          `commitment projector resurrected rejected operations ${rejectedResurrections
            .map(({ commitment }) => commitment.operation.acquisition.operationId)
            .join(",")}`
        )
      )
    }
    return operation
  }
  const completeReservation = Effect.fn("FreshTaskAdmissionMBT.completeReservation")(function* (tag: TaskTag) {
    const reservation = reservations.get(tag)
    if (reservation !== undefined) {
      yield* (yield* requireController()).complete(reservation)
      reservations.delete(tag)
    }
  })
  const appendAcceptedWorktreeReadyPrefix = (tag: TaskTag, operation: ReturnType<typeof operationFor>) => {
    const plannedAttempt = attemptFor(tag)
    const specification = specificationFor(tag)
    append(
      TaskClaimAcquiredEvent.make({
        claim: ActiveTaskClaim.make(operation.acquisition),
        version: workflowJournalEventVersion
      }),
      outcomeRecordKey(operation.acquisition.operationId)
    )
    const postClaimGraphOperation = makeTrackerGraphObservationOperation(
      { _tag: "WorkflowEstablishment" },
      OperationId.make(`fresh-task-admission-${tag}-post-claim-graph`),
      target,
      [operation.acquisition.operationId],
      [taskIdFor(tag)]
    )
    append(taskTrackerReadIntent(postClaimGraphOperation), intentRecordKey(postClaimGraphOperation.operationId))
    append(
      taskTrackerFactsObservedEvent(
        postClaimGraphOperation.operationId,
        makeCompleteTaskTrackerFactsObserved(postClaimGraphOperation, graph)
      ),
      outcomeRecordKey(postClaimGraphOperation.operationId)
    )
    currentGraphOperation = postClaimGraphOperation
    const specificationOperation = makeTaskWorkSpecificationObservationOperation(
      OperationId.make(`fresh-task-admission-${tag}-specification`),
      target,
      taskIdFor(tag),
      [postClaimGraphOperation.operationId]
    )
    append(taskTrackerReadIntent(specificationOperation), intentRecordKey(specificationOperation.operationId))
    append(
      taskTrackerFactsObservedEvent(
        specificationOperation.operationId,
        makeFocusedTaskWorkSpecificationFactsObserved(specificationOperation, specification)
      ),
      outcomeRecordKey(specificationOperation.operationId)
    )
    const plan = makeTaskAttemptPlanOperation({
      operationId: OperationId.make(`fresh-task-admission-${tag}-plan`),
      plannedAttempt,
      predecessorOperationIds: [specificationOperation.operationId]
    })
    append(
      TaskAttemptPlannedEvent.make({ operation: plan, version: workflowJournalEventVersion }),
      attemptPlanRecordKey(plannedAttempt.attemptId)
    )
    const worktree = makeTaskWorktreeReconciliationOperation({
      operationId: OperationId.make(`fresh-task-admission-${tag}-worktree`),
      plannedAttempt,
      predecessorOperationIds: [plan.operationId]
    })
    append(
      TaskWorktreeReconciliationIntendedEvent.make({ operation: worktree, version: workflowJournalEventVersion }),
      intentRecordKey(worktree.operationId)
    )
    append(
      TaskWorktreeReadyEvent.make({
        operationId: worktree.operationId,
        proof: PlannedWorktreeReady.make({
          baseSha: plannedAttempt.baseSha,
          branch: plannedAttempt.branch,
          headSha: plannedAttempt.baseSha,
          worktree: plannedAttempt.worktree
        }),
        version: workflowJournalEventVersion
      }),
      outcomeRecordKey(worktree.operationId)
    )
  }
  const appendAcceptedResponsibility = Effect.fn("FreshTaskAdmissionMBT.appendAcceptedResponsibility")(function* (
    tag: TaskTag,
    visibility: "AcceptedUnobserved" | "Visible" = "Visible"
  ) {
    const plannedAttempt = attemptFor(tag)
    const visibleBeforeAppend = visiblePrefixLength
    const acceptedResponsibility = yield* beginPlannedAttemptExecutorResponsibility(plannedAttempt).pipe(
      Effect.provide(requireJournalRuntime().context)
    )
    records = yield* requireJournalRuntime().journal.read(runId)
    sequence = Number(records.at(-1)?.position ?? 1)
    visiblePrefixLength = visibility === "Visible" ? records.length : visibleBeforeAppend
    const operation = latestClaimOperationFor(tag)
    if (operation === undefined) return yield* Effect.die(`missing accepted handoff claim for ${tag}`)
    if (
      projectFreshTaskCommitments(runId, visibility === "Visible" ? visibleRecords() : records).some(
        ({ commitment }) => commitment.operation.acquisition.operationId === operation.acquisition.operationId
      )
    ) {
      return yield* Effect.die(`accepted handoff did not dispose commitment ${operation.acquisition.operationId}`)
    }
    return acceptedResponsibility
  })
  const handoffFreshAttempt = Effect.fn("FreshTaskAdmissionMBT.handoffFreshAttempt")(function* (tag: TaskTag) {
    const admission = yield* requireController()
    const operation = latestClaimOperationFor(tag)
    if (operation === undefined) return yield* Effect.die(`missing handoff claim operation for ${tag}`)
    const plannedAttempt = attemptFor(tag)
    const task = Option.getOrThrow(
      Option.fromUndefinedOr(graph.eligibleTasks().find(({ id }) => id === taskIdFor(tag)))
    )
    const step = FreshWorkflowStep.BeginPlannedAttemptExecutorWork({
      claimOperationId: operation.acquisition.operationId,
      plannedAttempt,
      specification: makeTaskWorkSpecification({ body: tag, taskId: task.id, title: tag }),
      task
    })
    const transition = RunnableFrontierTransition.BeginPlannedAttemptExecutorWork({ plannedAttempt })
    const proposal = deliveryProposalsOf({
      acceptedOperationIds: HashSet.empty(),
      fresh: Result.getOrThrow(
        freshContinuationDecisionsOf(
          [{ step, transition }],
          projectFreshTaskCommitments(runId, visibleRecords()).map(({ commitment }) => commitment)
        )
      ),
      runId,
      transitions: [transition]
    }).ticketDelivery[0]
    if (proposal === undefined) return yield* Effect.die(`missing exact handoff proposal for ${tag}`)
    const result = yield* admission.tryReserve(proposal)
    if (result._tag !== "Admitted") return yield* Effect.die(`exact handoff proposal for ${tag} was deferred`)
    const acceptedResponsibility = yield* appendAcceptedResponsibility(tag)
    yield* admission.bindPlannedAttemptPosition(result.reservation, plannedAttempt, acceptedResponsibility)
    yield* admission.complete(result.reservation)
    yield* synchronize()
  })
  const commandIntentsFor = (tag: TaskTag) =>
    visibleRecords().flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.plannedAttempt.attemptId === attemptFor(tag).attemptId
        ? [event]
        : []
    )
  const commandResponsesFor = (tag: TaskTag) =>
    visibleRecords().flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
      event.plannedAttempt.attemptId === attemptFor(tag).attemptId
        ? [event]
        : []
    )
  const workReportsFor = (tag: TaskTag) =>
    visibleRecords().flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.report.correlation.attemptId === attemptFor(tag).attemptId
        ? [event]
        : []
    )
  const appendCommandIntent = (tag: TaskTag, command: "Begin" | "Resume" | "Suspend") => {
    const plannedAttempt = attemptFor(tag)
    const ordinal = PlannedAttemptExecutorCommandOrdinal.make(commandIntentsFor(tag).length + 1)
    append(
      PlannedAttemptExecutorCommandIntendedEvent.make({
        command,
        initiatedBy: { _tag: "DalphCoordinator" },
        occurrenceClassification: "InitiatedAction",
        ordinal,
        plannedAttempt,
        version: workflowJournalEventVersion
      }),
      plannedAttemptExecutorCommandIntendedRecordKey(plannedAttempt.attemptId, ordinal)
    )
    return ordinal
  }
  const appendCommandResponse = (
    tag: TaskTag,
    commandOrdinal: PlannedAttemptExecutorCommandOrdinal,
    report: PlannedAttemptExecutorReport
  ) => {
    const plannedAttempt = attemptFor(tag)
    append(
      PlannedAttemptExecutorCommandResponseObservedEvent.make({
        commandOrdinal,
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        report,
        version: workflowJournalEventVersion
      }),
      plannedAttemptExecutorCommandResponseObservedRecordKey(plannedAttempt.attemptId, commandOrdinal)
    )
    const reportOrdinal = PlannedAttemptExecutorReportOrdinal.make(workReportsFor(tag).length + 1)
    append(
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: reportOrdinal,
        report,
        version: workflowJournalEventVersion
      }),
      plannedAttemptExecutorWorkReportedRecordKey(plannedAttempt.attemptId, reportOrdinal)
    )
  }
  const appendSafeResumeReconciliation = (tag: TaskTag) => {
    const plannedAttempt = attemptFor(tag)
    const resume = commandIntentsFor(tag).findLast(({ command }) => command === "Resume")
    if (resume === undefined) return Effect.runSync(Effect.die(`missing Resume intent for ${tag}`))
    const projectionOrdinal = PlannedAttemptExecutorCommandProjectionOrdinal.make(1)
    append(
      PlannedAttemptExecutorCommandProjectionObservedEvent.make({
        commandOrdinal: resume.ordinal,
        observation: PlannedAttemptExecutorCommandProjectionObservation.cases.ExactExecutorReport.make({
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({
            correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
          })
        }),
        occurrenceClassification: "NonActionOccurrence",
        plannedAttempt,
        projectionOrdinal,
        version: workflowJournalEventVersion
      }),
      plannedAttemptExecutorCommandProjectionObservedRecordKey(
        plannedAttempt.attemptId,
        resume.ordinal,
        projectionOrdinal
      )
    )
  }
  const appendSafeReleaseEvidence = (tag: TaskTag) => {
    const plannedAttempt = attemptFor(tag)
    const correlation = plannedAttemptExecutorCorrelation(plannedAttempt)
    const latestIntent = commandIntentsFor(tag).at(-1)
    if (
      latestIntent === undefined ||
      commandResponsesFor(tag).some(({ commandOrdinal }) => commandOrdinal === latestIntent.ordinal)
    ) {
      const begin = appendCommandIntent(tag, "Begin")
      appendCommandResponse(tag, begin, PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation }))
    } else {
      appendCommandResponse(
        tag,
        latestIntent.ordinal,
        PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      )
    }
    const suspend = appendCommandIntent(tag, "Suspend")
    appendCommandResponse(
      tag,
      suspend,
      PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    )
  }
  const releaseHeld = Effect.fn("FreshTaskAdmissionMBT.releaseHeld")(function* (tag: TaskTag) {
    const admission = yield* requireController()
    appendSafeReleaseEvidence(tag)
    yield* admission.releasePlannedAttemptPosition(plannedAttemptExecutorCorrelation(attemptFor(tag)))
    yield* synchronize()
  })
  const safeContinuationEligibilityFor = (tag: TaskTag) =>
    safeContinuationRevalidations().find(({ plannedAttempt }) => plannedAttempt.attemptId === attemptFor(tag).attemptId)
  const continuationOperationIdsFor = (tag: TaskTag) => ({
    claim: OperationId.make(`fresh-task-admission-${tag}-continuation-claim`),
    graph: OperationId.make(`fresh-task-admission-${tag}-continuation-graph`),
    specification: OperationId.make(`fresh-task-admission-${tag}-continuation-specification`),
    targetLineage: OperationId.make(`fresh-task-admission-${tag}-continuation-target-lineage`),
    worktree: OperationId.make(`fresh-task-admission-${tag}-continuation-worktree`)
  })
  const continuationTransitionFor = (tag: TaskTag, witness: ContinuationWitnessTag | "Reservation" | "Resume") => {
    const plannedAttempt = attemptFor(tag)
    const operationIds = continuationOperationIdsFor(tag)
    const predecessors = [OperationId.make(`fresh-task-admission-${tag}-plan`)]
    if (witness === "Reservation") {
      const operation = makeTrackerGraphObservationOperation(
        { _tag: "AttemptContinuation" },
        operationIds.graph,
        target,
        predecessors,
        [plannedAttempt.taskId]
      )
      return RunnableFrontierTransition.ObservePlannedAttemptContinuationGraph({ operation, plannedAttempt })
    }
    if (witness === "AuthoredSpecification") {
      const operation = makeTaskWorkSpecificationObservationOperation(
        operationIds.specification,
        target,
        plannedAttempt.taskId,
        predecessors
      )
      return RunnableFrontierTransition.ObservePlannedAttemptContinuationSpecification({ operation, plannedAttempt })
    }
    if (witness === "ExactClaim") {
      const operation = makeTaskClaimObservationOperation(
        operationIds.claim,
        target,
        plannedAttempt.taskId,
        predecessors
      )
      return RunnableFrontierTransition.ObservePlannedAttemptContinuationClaim({ operation, plannedAttempt })
    }
    if (witness === "PlannedWorktree") {
      const operation = makeTaskWorktreeObservationOperation({
        operationId: operationIds.worktree,
        plannedAttempt,
        predecessorOperationIds: predecessors
      })
      return RunnableFrontierTransition.ObservePlannedAttemptContinuationWorktree({ operation, plannedAttempt })
    }
    if (witness === "TargetLineage") {
      const operation = makeTargetLineageObservationOperation({
        integrationTarget,
        operationId: operationIds.targetLineage,
        plannedAttempt,
        predecessorOperationIds: predecessors
      })
      return RunnableFrontierTransition.ObservePlannedAttemptContinuationTargetLineage({
        operation,
        operationIdentity: "Allocate",
        plannedAttempt
      })
    }
    const eligibility = safeContinuationEligibilityFor(tag)
    if (eligibility === undefined) return Effect.runSync(Effect.die(`missing safe continuation eligibility for ${tag}`))
    return RunnableFrontierTransition.ResumePlannedAttemptExecutorWorkAfterCurrentFacts({
      acceptedProgress: { _tag: "ExecutorReportAccepted", ordinal: eligibility.acceptedSafe.reportOrdinal },
      plannedAttempt,
      witness: {
        activeTaskContinuationRead: {
          graphObservationOperationId: operationIds.graph,
          taskClaimObservationOperationId: operationIds.claim,
          taskWorkSpecificationObservationOperationId: operationIds.specification
        },
        targetLineageObservationOperationId: operationIds.targetLineage,
        worktreeObservationOperationId: operationIds.worktree
      }
    })
  }
  const continuationProposalFor = (tag: TaskTag, witness: ContinuationWitnessTag | "Reservation" | "Resume") => {
    const eligibility = safeContinuationEligibilityFor(tag)
    if (eligibility === undefined) return Effect.runSync(Effect.die(`missing safe continuation eligibility for ${tag}`))
    const proposal = deliveryProposalsOf({
      acceptedAt: currentReduction().runState.appliedThrough,
      acceptedOperationIds: HashSet.empty(),
      fresh: [],
      responsibilities: currentReduction().runState.responsibility.entries,
      runId,
      safeContinuationRevalidations: [eligibility],
      transitions: [continuationTransitionFor(tag, witness)]
    }).ticketDelivery[0]
    if (proposal?.admission.safeContinuationRevalidation !== eligibility) {
      return Effect.runSync(Effect.die(`continuation ${witness} proposal for ${tag} lost exact eligibility`))
    }
    return proposal
  }
  const tagged = ({ task }: { readonly task: unknown }) => taskTagOf(task)
  const continuationWitnessTagOf = ({ witness }: { readonly witness: unknown }): ContinuationWitnessTag => {
    const tag = variantTag(witness)
    if (!continuationWitnessTags.includes(tag as ContinuationWitnessTag)) {
      return Effect.runSync(Effect.die(`unknown continuation witness ${tag}`))
    }
    return tag as ContinuationWitnessTag
  }
  const appendCapacityChange = (delta: -1 | 1) => {
    const policy = Option.getOrUndefined(currentReduction().runState.controlPolicy)
    if (policy === undefined) return Effect.runSync(Effect.die("cannot change an unreconstructed capacity"))
    const revision = RunPolicyRevision.make(policy.revision + 1)
    append(
      TaskWorkCapacityChangedEvent.make({
        capacity: TaskWorkCapacity.make(policy.taskExecutionCapacity + delta),
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        previousRevision: policy.revision,
        revision,
        version: workflowJournalEventVersion
      }),
      taskWorkCapacityPolicyRecordKey(revision)
    )
  }

  return {
    init: () =>
      Effect.gen(function* () {
        if (journalRuntime !== undefined) yield* journalRuntime.managed.disposeEffect
        process = "ProcessUp"
        prefixReader.reset()
        records = [makeWorkflowRunBeganRecord(runId, target, initialPolicy)]
        journalRuntime = acquireJournalRuntime(records)
        sequence = 1
        visiblePrefixLength = 1
        prefixReader.seed(records, visiblePrefixLength)
        graphSequence = 0
        reservations.clear()
        continuationReservations.clear()
        claimCycles.clear()
        ambiguousResponsibilityTags.clear()
        currentGraphOperation = appendGraph("initial", [...taskIds.values()])
        controller = yield* makeController()
        yield* synchronize()
      }),
    observeLifecycleClosureFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        currentGraphOperation = appendLifecycleGraph(tag, "TerminalWithoutSuccess")
        yield* synchronize()
      }),
    acceptSafeReportFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        appendSafeReleaseEvidence(tag)
        yield* (yield* requireController()).releasePlannedAttemptPosition(
          plannedAttemptExecutorCorrelation(attemptFor(tag))
        )
        yield* synchronize()
      }),
    observeLifecycleReopenFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        currentGraphOperation = appendLifecycleGraph(tag, "Open")
        yield* synchronize()
      }),
    selectSafeContinuationFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        yield* synchronize()
        if (safeContinuationEligibilityFor(tag) === undefined) {
          return yield* Effect.die(`production did not select reopened Safe continuation ${tag}`)
        }
      }),
    projectOrdinarySafeContinuationReadyFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        yield* synchronize()
        if (safeContinuationEligibilityFor(tag) !== undefined) {
          return yield* Effect.die(`ordinary Safe continuation ${tag} gained lifecycle-reopen eligibility`)
        }
      }),
    reserveFreshEntryFor: (input) =>
      Effect.gen(function* () {
        const expected = tagged(input)
        if (acceptedFrontier === undefined) return yield* Effect.die("fresh candidate frontier is not synchronized")
        const result = yield* (yield* requireController()).tryReserveFresh(
          acceptedFrontier,
          deliveryProposalOfAcceptedFreshTask
        )
        if (result._tag !== "Admitted") return yield* Effect.die(`model admitted ${expected}, production deferred it`)
        const candidate = result.reservation.freshTaskCandidate
        if (candidate === null) return yield* Effect.die(`production admission for ${expected} lost its candidate`)
        const actual = tagForTaskId(candidate.taskId)
        if (actual !== expected) return yield* Effect.die(`model admitted ${expected}, production admitted ${actual}`)
        reservations.set(expected, result.reservation)
      }),
    probeFreshEntryDeferredFor: (input) =>
      Effect.gen(function* () {
        const expected = tagged(input)
        if (acceptedFrontier === undefined) return yield* Effect.die("fresh candidate frontier is not synchronized")
        const result = yield* (yield* requireController()).tryReserveFresh(
          acceptedFrontier,
          deliveryProposalOfAcceptedFreshTask
        )
        if (result._tag !== "Deferred") {
          return yield* Effect.die(`production admitted ${expected}; expected a deferred fresh-entry attempt`)
        }
        if (reservations.has(expected)) {
          return yield* Effect.die(`deferred fresh-entry attempt for ${expected} left a reservation`)
        }
        yield* assertNoOutsideFreshAdmissionWhenSelectedCommitmentsAreRetained()
      }),
    recordClaimIntentFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const reservation = reservations.get(tag)
        if (reservation === undefined) return yield* Effect.die(`missing fresh reservation for ${tag}`)
        const operation = operationFor(tag)
        yield* (yield* requireController()).bindFreshTaskClaimOperation(reservation, operation.acquisition.operationId)
        acceptClaimIntent(operation)
        yield* completeReservation(tag)
        yield* synchronize()
      }),
    loseAcceptedClaimIntentAppendResponseFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const reservation = reservations.get(tag)
        if (reservation === undefined) return yield* Effect.die(`missing fresh reservation for ${tag}`)
        const operation = operationFor(tag)
        yield* (yield* requireController()).bindFreshTaskClaimOperation(reservation, operation.acquisition.operationId)
        acceptClaimIntent(operation, "AcceptedUnobserved")
      }),
    observeClaimIntentPresentFor: (input) => {
      const tag = tagged(input)
      const operation = latestClaimOperationFor(tag)
      if (operation === undefined) return Effect.die(`missing accepted claim intent for ${tag}`)
      revealAcceptedSuffix()
      return completeReservation(tag).pipe(Effect.andThen(synchronize()))
    },
    projectAcceptedWorktreeReadyFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const operation = latestClaimOperationFor(tag)
        if (operation === undefined) return yield* Effect.die(`missing accepted claim intent for ${tag}`)
        appendAcceptedWorktreeReadyPrefix(tag, operation)
        yield* synchronize()
      }),
    projectForeignClaimRejectionFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const operation = latestClaimOperationFor(tag)
        if (operation === undefined) return yield* Effect.die(`missing claim operation for ${tag}`)
        const observed = ActiveTaskClaim.make({
          operationId: OperationId.make(`fresh-task-admission-${tag}-foreign`),
          owner: ClaimOwner.make("foreign"),
          taskId: taskIdFor(tag),
          token: ClaimToken.make(`fresh-task-admission-${tag}-foreign-token`)
        })
        append(
          TaskClaimAcquisitionRejectedEvent.make({
            observed,
            operationId: operation.acquisition.operationId,
            reason: "ForeignClaim",
            version: workflowJournalEventVersion
          }),
          outcomeRecordKey(operation.acquisition.operationId)
        )
        yield* synchronize()
        const remaining = (yield* (yield* requireController()).snapshot).positions.get(taskIdFor(tag))
        if (remaining !== undefined) {
          return yield* Effect.die(`rejected ${tag} retained production position ${remaining._tag}`)
        }
      }),
    observeForeignClaimClearedFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const rejected = latestClaimOperationFor(tag)
        if (rejected === undefined) return yield* Effect.die(`missing rejected operation for ${tag}`)
        currentGraphOperation = appendGraph(`foreign-clear-${tag}`)
        const read = makeTaskClaimObservationOperation(
          OperationId.make(`fresh-task-admission-${tag}-unclaimed-read`),
          target,
          taskIdFor(tag),
          [rejected.acquisition.operationId, currentGraphOperation.operationId]
        )
        append(taskTrackerReadIntent(read), intentRecordKey(read.operationId))
        append(
          taskTrackerFactsObservedEvent(
            read.operationId,
            makeFocusedTaskClaimFactsObserved(read, UnclaimedTask.make({ taskId: taskIdFor(tag) }))
          ),
          outcomeRecordKey(read.operationId)
        )
        yield* synchronize()
      }),
    loseAcceptedExecutorResponsibilityAppendResponseFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const operation = latestClaimOperationFor(tag)
        if (operation === undefined) return yield* Effect.die(`missing accepted handoff claim for ${tag}`)
        yield* appendAcceptedResponsibility(tag, "AcceptedUnobserved")
      }),
    loseExecutorResponsibilityAppendResponseFor: (input) =>
      Effect.sync(() => {
        const tag = tagged(input)
        const operation = latestClaimOperationFor(tag)
        if (operation === undefined) return Effect.runSync(Effect.die(`missing accepted handoff claim for ${tag}`))
        if (
          records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
              event.plannedAttempt.taskId === taskIdFor(tag)
          )
        ) {
          return Effect.runSync(Effect.die(`responsibility append for ${tag} was not absent`))
        }
        ambiguousResponsibilityTags.add(tag)
      }),
    observeExecutorResponsibilityAppendAbsentFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        if (!ambiguousResponsibilityTags.has(tag)) {
          return yield* Effect.die(`missing ambiguous responsibility append for ${tag}`)
        }
        if (
          records.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" &&
              event.plannedAttempt.taskId === taskIdFor(tag)
          )
        ) {
          return yield* Effect.die(`responsibility append for ${tag} became present before absent observation`)
        }
        ambiguousResponsibilityTags.delete(tag)
        yield* synchronize()
      }),
    observeExecutorResponsibilityAppendPresentFor: (input) => {
      tagged(input)
      revealAcceptedSuffix()
      return synchronize()
    },
    handoffToExecutorResponsibilityFor: (input) => handoffFreshAttempt(tagged(input)),
    releaseHeldPositionNotReadyFor: (input) => releaseHeld(tagged(input)),
    releaseHeldPositionReadyFor: (input) => releaseHeld(tagged(input)),
    reserveReadyResponsibilityFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const plannedAttempt = attemptFor(tag)
        if (safeContinuationEligibilityFor(tag) !== undefined) {
          const result = yield* (yield* requireController()).tryReserve(continuationProposalFor(tag, "Reservation"))
          if (result._tag !== "Admitted") {
            return yield* Effect.die(`safe continuation responsibility ${tag} was deferred`)
          }
          yield* (yield* requireController()).complete(result.reservation)
          const position = (yield* (yield* requireController()).snapshot).positions.get(taskIdFor(tag))
          if (position?._tag !== "SafeContinuationReserved") {
            return yield* Effect.die(`safe continuation ${tag} did not retain its pre-read reservation`)
          }
          return
        }
        const proposal = {
          ...trackerGraphReadProposalOf({
            acceptedAt: JournalPosition.make(Math.max(sequence, 1)),
            purpose: "EstablishCurrentGraph",
            runId,
            target
          }),
          admission: {
            integrationTarget: { _tag: "NoIntegrationTargetResource" as const },
            plannedAttemptProtocol: {
              _tag: "PlannedAttemptProtocolRequired" as const,
              correlation: plannedAttemptExecutorCorrelation(plannedAttempt)
            },
            taskWorkPosition: {
              _tag: "TaskWorkPositionRequired" as const,
              mode: "ReserveOrReuse" as const,
              taskId: plannedAttempt.taskId
            }
          },
          id: DeliveryProposalId.make(`fresh-task-admission-ready-${tag}-${sequence}`)
        }
        const result = yield* (yield* requireController()).tryReserve(proposal)
        if (result._tag !== "Admitted") return yield* Effect.die(`ready responsibility ${tag} was deferred`)
        reservations.set(tag, result.reservation)
      }),
    rejectSafeContinuationAtCapacityFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const before = yield* (yield* requireController()).snapshot
        const result = yield* (yield* requireController()).tryReserve(continuationProposalFor(tag, "Reservation"))
        if (result._tag !== "Deferred") {
          return yield* Effect.die(`safe continuation ${tag} crossed its boundary at capacity`)
        }
        const after = yield* (yield* requireController()).snapshot
        if (after.positions.size !== before.positions.size || after.positions.has(taskIdFor(tag))) {
          return yield* Effect.die(`rejected safe continuation ${tag} changed occupancy`)
        }
      }),
    rejectFreshBypassFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        if (acceptedFrontier === undefined) return yield* Effect.die("fresh candidate frontier is not synchronized")
        const result = yield* (yield* requireController()).tryReserveFresh(
          acceptedFrontier,
          deliveryProposalOfAcceptedFreshTask
        )
        if (result._tag !== "Deferred") {
          return yield* Effect.die(`fresh ${tag} bypassed a waiting Safe continuation`)
        }
        if ((yield* (yield* requireController()).snapshot).positions.has(taskIdFor(tag))) {
          return yield* Effect.die(`rejected fresh bypass ${tag} changed occupancy`)
        }
      }),
    readContinuationWitnessFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const witness = continuationWitnessTagOf(input)
        const before = yield* (yield* requireController()).snapshot
        const result = yield* (yield* requireController()).tryReserve(continuationProposalFor(tag, witness))
        if (result._tag !== "Admitted") return yield* Effect.die(`continuation ${witness} read for ${tag} was deferred`)
        yield* (yield* requireController()).complete(result.reservation)
        const after = yield* (yield* requireController()).snapshot
        if (after.positions.get(taskIdFor(tag))?._tag !== "SafeContinuationReserved") {
          return yield* Effect.die(`continuation ${witness} read released ${tag}`)
        }
        if (after.positions.size !== before.positions.size) {
          return yield* Effect.die(`continuation ${witness} read double-occupied ${tag}`)
        }
      }),
    authorizeSafeContinuationFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const result = yield* (yield* requireController()).tryReserve(continuationProposalFor(tag, "Resume"))
        if (result._tag !== "Admitted") return yield* Effect.die(`continuation authorization for ${tag} was deferred`)
        yield* (yield* requireController()).bindPlannedAttemptPosition(result.reservation, attemptFor(tag))
        continuationReservations.set(tag, result.reservation)
        const snapshot = yield* (yield* requireController()).snapshot
        if (snapshot.positions.get(taskIdFor(tag))?._tag !== "SafeContinuationReserved") {
          return yield* Effect.die(`authorization prematurely handed off ${tag}`)
        }
      }),
    handoffReadyResponsibilityFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        const continuationReservation = continuationReservations.get(tag)
        if (continuationReservation !== undefined) {
          appendCommandIntent(tag, "Resume")
          yield* (yield* requireController()).complete(continuationReservation)
          continuationReservations.delete(tag)
          yield* synchronize()
          return
        }
        const reservation = reservations.get(tag)
        if (reservation === undefined) return yield* Effect.die(`missing ready responsibility reservation for ${tag}`)
        const admission = yield* requireController()
        appendCommandIntent(tag, "Resume")
        yield* admission.bindPlannedAttemptPosition(reservation, attemptFor(tag))
        yield* admission.complete(reservation)
        reservations.delete(tag)
        yield* synchronize()
      }),
    reconcileResumeAsStillSafeFor: (input) =>
      Effect.gen(function* () {
        const tag = tagged(input)
        appendSafeResumeReconciliation(tag)
        yield* (yield* requireController()).releasePlannedAttemptPosition(
          plannedAttemptExecutorCorrelation(attemptFor(tag))
        )
        yield* synchronize()
        const eligibility = safeContinuationEligibilityFor(tag)
        if (eligibility?.basis._tag !== "ReconciledResumeStillSafe") {
          return yield* Effect.die(`reconciled Resume for ${tag} did not regain exact Safe retry admission`)
        }
      }),
    contractCapacity: () => {
      appendCapacityChange(-1)
      return synchronize()
    },
    expandCapacity: () => {
      appendCapacityChange(1)
      return synchronize()
    },
    crash: () =>
      Effect.sync(() => {
        prefixReader.reset()
        process = "ProcessDown"
      }),
    recover: () =>
      Effect.gen(function* () {
        prefixReader.reset()
        revealAcceptedSuffix()
        controller = yield* makeController()
        reservations.clear()
        continuationReservations.clear()
        ambiguousResponsibilityTags.clear()
        process = "ProcessUp"
        yield* synchronize()
      }),
    getState: () =>
      Effect.gen(function* () {
        const snapshot = yield* (yield* requireController()).snapshot
        return {
          capacity: BigInt(snapshot.capacity),
          occupied: [...snapshot.positions]
            .map(([taskId, position]) => {
              const task = tagForTaskId(taskId)
              const state =
                position._tag === "FreshEntryRuntimePosition"
                  ? "FreshEntryReserved"
                  : position._tag === "SafeContinuationReserved"
                    ? "ExistingResponsibilityReserved"
                    : position._tag === "LocallyAcceptedAttemptPosition"
                      ? "ExactAttemptHeld"
                      : position._tag === "BoundRuntimePosition"
                        ? "ExistingResponsibilityReserved"
                        : position._tag
              if (position._tag === "BoundRuntimePosition") {
                return { attemptId: position.correlation.attemptId, runId: position.correlation.runId, state, task }
              }
              if (position._tag === "FreshTaskCommitted") {
                return { claimOperationId: position.commitment.operation.acquisition.operationId, state, task }
              }
              return position._tag === "ExistingResponsibilityReserved" ||
                position._tag === "ExactAttemptHeld" ||
                position._tag === "LocallyAcceptedAttemptPosition"
                ? { attemptId: position.plannedAttempt.attemptId, runId: position.plannedAttempt.runId, state, task }
                : { state, task }
            })
            .toSorted((left, right) => left.task.localeCompare(right.task)),
          process
        } satisfies AdmissionProjection
      })
  }
})

const freshTaskAdmissionStateCheck = stateCheck(
  projectionOfSpec,
  (spec, implementation) =>
    JSON.stringify(spec, (_, value) => (typeof value === "bigint" ? value.toString() : value)) ===
    JSON.stringify(implementation, (_, value) => (typeof value === "bigint" ? value.toString() : value))
)

const focusedConformance = (step: string, maxSteps: number) => ({
  backend: "typescript" as const,
  driverFactory: freshTaskAdmissionDriver,
  maxSamples: 1,
  maxSteps,
  nTraces: 1,
  seed: "315",
  spec: "specs/freshTaskAdmission.qnt",
  stateCheck: freshTaskAdmissionStateCheck,
  step
})

quintIt(
  it.effect,
  "reconstructs an accepted claim intent whose append response was lost",
  focusedConformance("acceptedClaimRecoveryMbtStep", 4)
)

quintIt(
  it.effect,
  "reconstructs accepted executor responsibility whose append response was lost",
  focusedConformance("acceptedResponsibilityRecoveryMbtStep", 6)
)

quintIt(
  it.effect,
  "retains the worktree commitment when an absent responsibility append is observed",
  focusedConformance("absentResponsibilityRecoveryMbtStep", 5)
)

it.effect("does not admit D or E while A-C commitments survive absent responsibility observation", () =>
  Effect.gen(function* () {
    const driver = yield* freshTaskAdmissionDriver.create()
    const action = <Name extends keyof typeof actionNames>(name: Name) =>
      Option.getOrThrowWith(Option.fromUndefinedOr(driver.actions[name]), () => new Error(`missing action ${name}`))
        .handler
    const task = (tag: TaskTag) => ({ task: tag })

    yield* action("init")({})
    for (const tag of taskTags.slice(0, 3)) {
      yield* action("reserveFreshEntryFor")(task(tag))
      yield* action("recordClaimIntentFor")(task(tag))
      yield* action("projectAcceptedWorktreeReadyFor")(task(tag))
    }
    yield* action("loseExecutorResponsibilityAppendResponseFor")(task("TaskA"))
    yield* action("observeExecutorResponsibilityAppendAbsentFor")(task("TaskA"))
    yield* action("probeFreshEntryDeferredFor")(task("TaskD"))
    yield* action("probeFreshEntryDeferredFor")(task("TaskE"))

    const getState = driver.getState
    if (getState === undefined) return yield* Effect.die("fresh admission driver must expose state")
    const state = yield* getState()
    const occupied = new Set(state.occupied.map(({ task: occupiedTask }) => occupiedTask))
    expect(occupied).toEqual(new Set(taskTags.slice(0, 3)))
    expect([...occupied].some((occupiedTask) => taskTags.slice(3).includes(occupiedTask))).toBe(false)
  })
)

quintIt(
  it.effect,
  "releases a held position from accepted safe executor evidence",
  focusedConformance("notReadyReleaseMbtStep", 6)
)

quintIt(
  it.effect,
  "rebinds a ready retained responsibility without an admission gap",
  focusedConformance("readyResponsibilityHandoffMbtStep", 8)
)

quintIt(
  it.effect,
  "reserves a lifecycle-reopened Safe continuation through exact focused reads and Resume intent",
  focusedConformance("lifecycleRevalidationMbtStep", 18)
)

it.effect("keeps C ahead of fresh E across the canonical cap-two lifecycle chronology", () =>
  Effect.gen(function* () {
    const driver = yield* freshTaskAdmissionDriver.create()
    const action = <Name extends keyof typeof actionNames>(name: Name) =>
      Option.getOrThrowWith(Option.fromUndefinedOr(driver.actions[name]), () => new Error(`missing action ${name}`))
        .handler
    const task = (tag: TaskTag) => ({ task: tag })

    yield* action("init")({})
    for (const tag of taskTags.slice(0, 3)) {
      yield* action("reserveFreshEntryFor")(task(tag))
      yield* action("recordClaimIntentFor")(task(tag))
      yield* action("projectAcceptedWorktreeReadyFor")(task(tag))
      yield* action("handoffToExecutorResponsibilityFor")(task(tag))
    }
    yield* action("acceptSafeReportFor")(task("TaskB"))
    yield* action("reserveFreshEntryFor")(task("TaskD"))
    yield* action("recordClaimIntentFor")(task("TaskD"))
    yield* action("projectAcceptedWorktreeReadyFor")(task("TaskD"))
    yield* action("handoffToExecutorResponsibilityFor")(task("TaskD"))
    yield* action("contractCapacity")({})
    yield* action("observeLifecycleClosureFor")(task("TaskC"))
    yield* action("acceptSafeReportFor")(task("TaskC"))
    yield* action("projectOrdinarySafeContinuationReadyFor")(task("TaskB"))
    yield* action("releaseHeldPositionNotReadyFor")(task("TaskA"))
    yield* action("reserveReadyResponsibilityFor")(task("TaskB"))
    yield* action("handoffReadyResponsibilityFor")(task("TaskB"))
    yield* action("observeLifecycleReopenFor")(task("TaskC"))
    yield* action("selectSafeContinuationFor")(task("TaskC"))
    yield* action("rejectSafeContinuationAtCapacityFor")(task("TaskC"))
    yield* action("expandCapacity")({})
    yield* action("rejectFreshBypassFor")(task("TaskE"))
    yield* action("reserveReadyResponsibilityFor")(task("TaskC"))
    for (const witness of continuationWitnessTags) {
      yield* action("readContinuationWitnessFor")({ task: "TaskC", witness })
    }
    yield* action("authorizeSafeContinuationFor")(task("TaskC"))
    yield* action("handoffReadyResponsibilityFor")(task("TaskC"))

    const getState = driver.getState
    if (getState === undefined) return yield* Effect.die("fresh admission driver must expose state")
    expect((yield* getState()).occupied).toMatchObject([
      { state: "ExactAttemptHeld", task: "TaskB" },
      { state: "ExactAttemptHeld", task: "TaskC" },
      { state: "ExactAttemptHeld", task: "TaskD" }
    ])
  })
)

it.effect("reconstructs a post-Resume-intent attempt before retrying its exact Safe continuation", () =>
  Effect.gen(function* () {
    const driver = yield* freshTaskAdmissionDriver.create()
    const action = <Name extends keyof typeof actionNames>(name: Name) =>
      Option.getOrThrowWith(Option.fromUndefinedOr(driver.actions[name]), () => new Error(`missing action ${name}`))
        .handler
    const task = { task: "TaskA" }

    yield* action("init")({})
    yield* action("reserveFreshEntryFor")(task)
    yield* action("recordClaimIntentFor")(task)
    yield* action("projectAcceptedWorktreeReadyFor")(task)
    yield* action("handoffToExecutorResponsibilityFor")(task)
    yield* action("observeLifecycleClosureFor")(task)
    yield* action("acceptSafeReportFor")(task)
    yield* action("observeLifecycleReopenFor")(task)
    yield* action("selectSafeContinuationFor")(task)
    yield* action("reserveReadyResponsibilityFor")(task)
    for (const witness of continuationWitnessTags) {
      yield* action("readContinuationWitnessFor")({ ...task, witness })
    }
    yield* action("authorizeSafeContinuationFor")(task)
    yield* action("handoffReadyResponsibilityFor")(task)
    yield* action("crash")({})
    yield* action("recover")({})

    const getState = driver.getState
    if (getState === undefined) return yield* Effect.die("fresh admission driver must expose state")
    expect((yield* getState()).occupied).toMatchObject([{ state: "ExactAttemptHeld", task: "TaskA" }])

    yield* action("reconcileResumeAsStillSafeFor")(task)
    expect((yield* getState()).occupied).toEqual([])
    yield* action("reserveReadyResponsibilityFor")(task)
    expect((yield* getState()).occupied).toMatchObject([{ state: "ExistingResponsibilityReserved", task: "TaskA" }])
  })
)

quintIt(
  it.effect,
  "keeps lifecycle continuation capacity decisions aligned across A-E",
  focusedConformance("lifecycleCapacityMbtStep", 45)
)

quintIt(
  it.effect,
  "keeps production admission and controller occupancy aligned with the canonical model",
  {
    backend: "typescript",
    driverFactory: freshTaskAdmissionDriver,
    maxSamples: 120,
    maxSteps: 45,
    nTraces: 120,
    seed: "315",
    spec: "specs/freshTaskAdmission.qnt",
    step: "mbtStep",
    stateCheck: freshTaskAdmissionStateCheck
  },
  180_000
)
