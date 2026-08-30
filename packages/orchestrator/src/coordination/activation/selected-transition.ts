import { RunId, TaskId } from "@dalph/contracts"
import { Schema } from "effect"
import { type RunnableFrontierTransition, runnableTransitionTaskId } from "../frontier/frontier.js"

/** Fingerprints the immutable inputs of one process-local selected transition. */
export const SelectedTransitionFingerprint = Schema.NonEmptyString.pipe(Schema.brand("SelectedTransitionFingerprint"))
export type SelectedTransitionFingerprint = typeof SelectedTransitionFingerprint.Type

/** Identifies one exact process-local selector result before operation intent. */
export const SelectedTransitionIdentity = Schema.Struct({
  decisionFingerprint: SelectedTransitionFingerprint,
  runId: RunId,
  subjectTaskId: TaskId,
  transitionTag: Schema.NonEmptyString
}).pipe(Schema.brand("SelectedTransitionIdentity"))
export type SelectedTransitionIdentity = typeof SelectedTransitionIdentity.Type

const fingerprintInput = (runId: RunId, transition: RunnableFrontierTransition) =>
  transition._tag === "ObservePlannedAttemptExecutorWork" ||
  transition._tag === "ReconcilePlannedAttemptExecutorWork" ||
  transition._tag === "ObservePlannedAttemptContinuationGraph" ||
  transition._tag === "ObservePlannedAttemptContinuationSpecification" ||
  transition._tag === "BeginPlannedAttemptExecutorWork" ||
  transition._tag === "SuspendPlannedAttemptExecutorWork"
    ? { attemptId: transition.plannedAttempt.attemptId, runId: transition.plannedAttempt.runId }
    : { runId, transition }

/** Builds the exact structural identity of one immutable selector result. */
export const makeSelectedTransitionIdentity = (
  runId: RunId,
  transition: RunnableFrontierTransition
): SelectedTransitionIdentity =>
  SelectedTransitionIdentity.make({
    decisionFingerprint: SelectedTransitionFingerprint.make(JSON.stringify(fingerprintInput(runId, transition))),
    runId,
    subjectTaskId: runnableTransitionTaskId(transition),
    transitionTag:
      transition._tag === "BeginPlannedAttemptExecutorWork" || transition._tag === "SuspendPlannedAttemptExecutorWork"
        ? "ObservePlannedAttemptExecutorWork"
        : transition._tag
  })

export const selectedTransitionKey = (selected: SelectedTransitionIdentity): string => JSON.stringify(selected)
