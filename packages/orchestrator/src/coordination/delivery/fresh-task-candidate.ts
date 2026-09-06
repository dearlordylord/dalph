import {
  compareTaskIds,
  RunId,
  TaskId,
  type AttemptId,
  type PlannedTaskAttempt,
  type TaskRevision
} from "@dalph/contracts"
import { Effect, Schema } from "effect"
import type { RunnableFrontierTransition } from "../frontier/frontier.js"
import type { FreshWorkflowStep } from "./fresh-workflow-step.js"
import { taskRevisionFor } from "../../authorities/task-tracker/graph.js"
import type { TrackerTarget } from "../../authorities/task-tracker/target.js"
import type { JournalPosition } from "../../workflow-journal/identity.js"
import type { CurrentDeliveryFrame } from "../run/current-delivery-frame.js"
import {
  deriveFreshWorkflowDecisions,
  deriveFreshWorkflowEntryCapableTaskIds,
  type FreshWorkflowDecision
} from "../run/fresh-workflow.js"
import {
  activeWorkAuthorityRefreshSubjectsContain,
  type RunActivationOpportunity
} from "../run/run-activation-opportunity.js"

/** Stable identity of one graph-derived fresh-entry candidate at an exact tracker task revision. */
export const FreshTaskCandidateId = Schema.NonEmptyString.pipe(Schema.brand("FreshTaskCandidateId"))
export type FreshTaskCandidateId = typeof FreshTaskCandidateId.Type

const FreshTaskCandidateTypeId: unique symbol = Symbol("@dalph/FreshTaskCandidate")
const FreshTaskCandidateFrontierTypeId: unique symbol = Symbol("@dalph/FreshTaskCandidateFrontier")
const issuedFreshTaskCandidateFrontiers = new WeakSet<object>()

/** Zero-based position in the current deterministic fresh-entry candidate order. */
const FreshTaskCandidateOrdinal = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("FreshTaskCandidateOrdinal")
)
type FreshTaskCandidateOrdinal = typeof FreshTaskCandidateOrdinal.Type

type FreshEntryStep = Extract<FreshWorkflowStep, { readonly _tag: "AcquireTaskClaim" | "ReadCurrentTaskGraph" }>
type FreshEntryTransition = Extract<
  RunnableFrontierTransition,
  { readonly _tag: "CommitFreshTaskClaimIntent" | "ContinueFreshWorkflowOperation" }
>

/** The latest admissible pre-intent step for one still-uncommitted tracker task. */
export interface FreshTaskEntryDecision {
  readonly step: FreshEntryStep
  readonly transition: FreshEntryTransition
}

/** Descriptive fresh-entry possibility; possessing it grants no operation or proposal authority. */
export interface FreshTaskCandidate {
  readonly [FreshTaskCandidateTypeId]: typeof FreshTaskCandidateTypeId
  readonly _tag: "FreshTaskCandidate"
  readonly decision: FreshTaskEntryDecision
  readonly id: FreshTaskCandidateId
  readonly ordinal: FreshTaskCandidateOrdinal
  readonly runId: RunId
  readonly taskId: TaskId
  readonly taskRevision: TaskRevision
}

/**
 * Complete stable candidate order for one coherent runtime evaluation.
 *
 * The private brand prevents a caller from presenting an arbitrary candidate
 * subset as the current selection authority. Runtime admission consumes this
 * whole value and chooses the next candidate itself.
 */
export interface FreshTaskCandidateFrontier {
  readonly [FreshTaskCandidateFrontierTypeId]: typeof FreshTaskCandidateFrontierTypeId
  readonly _tag: "FreshTaskCandidateFrontier"
  /** Journal prefix shared with the admission basis from this coherent evaluation. */
  readonly acceptedAt: JournalPosition | null
  readonly candidates: ReadonlyArray<FreshTaskCandidate>
  /** Complete current-graph proof of which tasks may still occupy a fresh-entry position. */
  readonly entryCapableTaskIds: ReadonlySet<TaskId>
  readonly runId: RunId
}

/** No complete candidate observation is available, so local idle entry state cannot be retired. */
interface FreshTaskCandidateObservationUnavailable {
  readonly _tag: "FreshTaskCandidateObservationUnavailable"
}

export type FreshTaskCandidateObservation = FreshTaskCandidateFrontier | FreshTaskCandidateObservationUnavailable

/** Exposes Set reads without exposing the mutable Set instance that owns the complete graph fact. */
const immutableTaskIdSet = (values: Iterable<TaskId>): ReadonlySet<TaskId> => {
  const source = new Set(values)
  const view: ReadonlySet<TaskId> = {
    get size() {
      return source.size
    },
    entries: () => source.entries(),
    forEach: (callback, thisArg) => source.forEach((value) => callback.call(thisArg, value, value, view)),
    has: (value) => source.has(value),
    keys: () => source.keys(),
    values: () => source.values(),
    [Symbol.iterator]: () => source[Symbol.iterator]()
  }
  return Object.freeze(view)
}

/** Runtime check for the private complete-frontier authority; casts and serialized copies fail closed. */
export const isFreshTaskCandidateFrontier = (value: unknown): value is FreshTaskCandidateFrontier =>
  typeof value === "object" && value !== null && issuedFreshTaskCandidateFrontiers.has(value)

export const freshTaskCandidateObservationUnavailable: FreshTaskCandidateObservationUnavailable = Object.freeze({
  _tag: "FreshTaskCandidateObservationUnavailable"
})

/** Candidate derivation contained duplicate tasks or a step for a different task than its transition. */
export class FreshTaskCandidateFrontierInvalid extends Schema.TaggedError<FreshTaskCandidateFrontierInvalid>()(
  "FreshTaskCandidateFrontierInvalid",
  {
    duplicateTaskIds: Schema.Array(TaskId),
    mismatchedPredecessorTaskIds: Schema.Array(TaskId),
    mismatchedTaskIds: Schema.Array(TaskId)
  }
) {}

/** A coherent delivery frame was presented as candidate authority for a different Run. */
export class FreshTaskCandidateRunMismatch extends Schema.TaggedError<FreshTaskCandidateRunMismatch>()(
  "FreshTaskCandidateRunMismatch",
  { actualRunId: RunId, expectedRunId: RunId }
) {}

/** Stable identity calculation exposed for controlled test values; it grants no frontier authority. */
const freshTaskCandidateIdFor = (runId: RunId, taskId: TaskId, taskRevision: TaskRevision): FreshTaskCandidateId =>
  FreshTaskCandidateId.make(JSON.stringify(["fresh-task-candidate", runId, taskId, taskRevision]))

interface FreshTaskCandidateDecisionIssues {
  readonly duplicateTaskIds: ReadonlyArray<TaskId>
  readonly mismatchedPredecessorTaskIds: ReadonlyArray<TaskId>
  readonly mismatchedTaskIds: ReadonlyArray<TaskId>
}

/** Checks raw entry decisions without converting them into runtime admission authority. */
export const freshTaskCandidateDecisionIssues = (
  decisions: ReadonlyArray<FreshTaskEntryDecision>
): FreshTaskCandidateDecisionIssues => {
  const taskIds = decisions.map(({ step }) => step.task.id)
  const duplicateTaskIds = [...new Set(taskIds.filter((taskId, index) => taskIds.indexOf(taskId) !== index))].toSorted(
    compareTaskIds
  )
  const mismatchedTaskIds = [
    ...new Set(
      decisions.flatMap((decision) => {
        const taskId = decision.step.task.id
        const tagsMatch =
          (decision.step._tag === "ReadCurrentTaskGraph" &&
            decision.transition._tag === "ContinueFreshWorkflowOperation") ||
          (decision.step._tag === "AcquireTaskClaim" &&
            decision.transition._tag === "CommitFreshTaskClaimIntent" &&
            decision.transition.taskRevision === taskRevisionFor(decision.step.task))
        return decision.transition.taskId !== taskId || !tagsMatch ? [taskId] : []
      })
    )
  ].toSorted(compareTaskIds)
  const mismatchedPredecessorTaskIds = [
    ...new Set(
      decisions.flatMap(({ step, transition }) =>
        step._tag === "ReadCurrentTaskGraph" &&
        transition._tag === "ContinueFreshWorkflowOperation" &&
        step.predecessorOperationId !== transition.operationId
          ? [step.task.id]
          : []
      )
    )
  ].toSorted(compareTaskIds)
  return { duplicateTaskIds, mismatchedPredecessorTaskIds, mismatchedTaskIds }
}

const freshTaskCandidateFrontierOfCompleteDecisions = Effect.fn("FreshTaskCandidate.frontierOfCompleteDecisions")(
  function* (
    acceptedAt: JournalPosition | null,
    decisions: ReadonlyArray<FreshTaskEntryDecision>,
    entryCapableTaskIds: ReadonlySet<TaskId>,
    runId: RunId
  ) {
    const issues = freshTaskCandidateDecisionIssues(decisions)
    if (
      issues.duplicateTaskIds.length > 0 ||
      issues.mismatchedTaskIds.length > 0 ||
      issues.mismatchedPredecessorTaskIds.length > 0
    ) {
      return yield* new FreshTaskCandidateFrontierInvalid({
        duplicateTaskIds: issues.duplicateTaskIds,
        mismatchedPredecessorTaskIds: issues.mismatchedPredecessorTaskIds,
        mismatchedTaskIds: issues.mismatchedTaskIds
      })
    }
    const candidates = [...decisions]
      .toSorted((left, right) => compareTaskIds(left.step.task.id, right.step.task.id))
      .map(({ step, transition }, ordinal): FreshTaskCandidate => {
        const taskRevision = taskRevisionFor(step.task)
        const task = Object.freeze({
          ...step.task,
          lifecycle: Object.freeze({ ...step.task.lifecycle }),
          prerequisiteIds: Object.freeze([...step.task.prerequisiteIds])
        })
        const immutableStep = Object.freeze({ ...step, task })
        const decision = Object.freeze({ step: immutableStep, transition: Object.freeze({ ...transition }) })
        const candidate = {
          [FreshTaskCandidateTypeId]: FreshTaskCandidateTypeId,
          _tag: "FreshTaskCandidate" as const,
          decision,
          id: freshTaskCandidateIdFor(runId, step.task.id, taskRevision),
          ordinal: FreshTaskCandidateOrdinal.make(ordinal),
          runId,
          taskId: step.task.id,
          taskRevision
        } satisfies FreshTaskCandidate
        return Object.freeze(candidate)
      })
    const frontier: FreshTaskCandidateFrontier = {
      [FreshTaskCandidateFrontierTypeId]: FreshTaskCandidateFrontierTypeId,
      _tag: "FreshTaskCandidateFrontier",
      acceptedAt,
      candidates,
      entryCapableTaskIds: immutableTaskIdSet(entryCapableTaskIds),
      runId
    }
    Object.freeze(candidates)
    issuedFreshTaskCandidateFrontiers.add(frontier)
    return Object.freeze(frontier)
  }
)

const transitionHasPlannedAttempt = (
  transition: RunnableFrontierTransition
): transition is RunnableFrontierTransition & { readonly plannedAttempt: PlannedTaskAttempt } =>
  Object.hasOwn(transition, "plannedAttempt")

const isFreshTaskEntryDecision = (decision: FreshWorkflowDecision): decision is FreshTaskEntryDecision =>
  (decision.step._tag === "ReadCurrentTaskGraph" && decision.transition._tag === "ContinueFreshWorkflowOperation") ||
  (decision.step._tag === "AcquireTaskClaim" && decision.transition._tag === "CommitFreshTaskClaimIntent")

interface FreshTaskCandidateEvaluationInput {
  readonly acceptedAt: JournalPosition | null
  readonly activeRefreshBoundaryReached: boolean
  readonly frame: CurrentDeliveryFrame | undefined
  readonly opportunity: RunActivationOpportunity
  readonly recoveredAttemptIds: ReadonlySet<AttemptId>
  readonly runId: RunId
  readonly target: TrackerTarget
}

/**
 * Derives the complete fresh workflow decision set and its entry frontier from
 * one coherent production frame. No caller can replace that set with a
 * selected candidate subset while retaining frontier authority.
 */
export const deriveFreshTaskCandidateEvaluation = Effect.fn("FreshTaskCandidate.deriveEvaluation")(function* (
  input: FreshTaskCandidateEvaluationInput
) {
  if (input.frame !== undefined && input.frame.runId !== input.runId) {
    return yield* new FreshTaskCandidateRunMismatch({ actualRunId: input.frame.runId, expectedRunId: input.runId })
  }
  const derived =
    input.frame === undefined ? [] : deriveFreshWorkflowDecisions(input.frame, input.recoveredAttemptIds, input.target)
  const decisions = (() => {
    if (!input.activeRefreshBoundaryReached || input.opportunity._tag !== "ActiveWorkAuthorityRefresh") {
      return derived
    }
    const subjects = input.opportunity.subjects
    return derived.filter(
      ({ transition }) =>
        !transitionHasPlannedAttempt(transition) ||
        !activeWorkAuthorityRefreshSubjectsContain(subjects, transition.plannedAttempt)
    )
  })()
  const frontier = yield* freshTaskCandidateFrontierOfCompleteDecisions(
    input.acceptedAt,
    decisions.filter(isFreshTaskEntryDecision),
    input.frame === undefined
      ? new Set()
      : deriveFreshWorkflowEntryCapableTaskIds(input.frame, input.target, input.recoveredAttemptIds),
    input.runId
  )
  return { decisions, frontier } as const
})
