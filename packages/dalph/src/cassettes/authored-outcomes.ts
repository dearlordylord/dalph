import { Effect, Option, Schema } from "effect"
import { type AttemptId, type PlannedAttemptExecutorReport, type TaskId } from "@dalph/contracts"
import { type JournalRecord } from "@dalph/orchestrator"
import {
  AuthoredObservedOutcome,
  type AuthoredObservedOutcome as ObservedOutcome,
  type AuthoredCassetteStoryItem
} from "./authored-domain.js"

export class AuthoredCassetteOutcomeMismatch extends Schema.TaggedErrorClass<AuthoredCassetteOutcomeMismatch>()(
  "AuthoredCassetteOutcomeMismatch",
  { actual: Schema.Array(AuthoredObservedOutcome), expected: Schema.Array(AuthoredObservedOutcome) }
) {}

const reportOutcome = (
  report: PlannedAttemptExecutorReport
): Extract<ObservedOutcome, { readonly _tag: "ExecutorReported" }> => ({
  _tag: "ExecutorReported",
  attemptId: report.correlation.attemptId,
  report:
    report._tag === "Terminal"
      ? report.result._tag === "Completed"
        ? "TerminalCompleted"
        : "TerminalFailed"
      : report._tag
})

const worktreeOutcome = (
  event: Extract<JournalRecord["event"], { readonly _tag: "TaskWorktreeReady" }>,
  worktreeAttemptByOperation: ReadonlyMap<string, { readonly attemptId: AttemptId; readonly taskId: TaskId }>
): ReadonlyArray<ObservedOutcome> => {
  const plannedAttempt = Option.getOrThrow(Option.fromUndefinedOr(worktreeAttemptByOperation.get(event.operationId)))
  return [{ _tag: "TaskWorktreeReady", attemptId: plannedAttempt.attemptId, taskId: plannedAttempt.taskId }]
}

const observedOutcomeFor = (
  event: JournalRecord["event"],
  worktreeAttemptByOperation: ReadonlyMap<string, { readonly attemptId: AttemptId; readonly taskId: TaskId }>
): ReadonlyArray<ObservedOutcome> => {
  if (event._tag === "TaskClaimAcquired") return [{ _tag: "TaskClaimed", taskId: event.claim.taskId }]
  if (event._tag === "TaskAttemptPlanned") {
    return [
      {
        _tag: "TaskAttemptPrepared",
        attemptId: event.operation.plannedAttempt.attemptId,
        taskId: event.operation.plannedAttempt.taskId
      }
    ]
  }
  if (event._tag === "TaskWorktreeReady") return worktreeOutcome(event, worktreeAttemptByOperation)
  if (event._tag === "PlannedAttemptExecutorWorkReported") {
    return [reportOutcome(event.report)]
  }
  return []
}

const observedOutcomes = (records: ReadonlyArray<JournalRecord>): ReadonlyArray<ObservedOutcome> => {
  const worktreeAttemptByOperation = new Map(
    records.flatMap(({ event }) =>
      event._tag === "TaskWorktreeReconciliationIntended"
        ? [[event.operation.operationId, event.operation.plannedAttempt] as const]
        : []
    )
  )
  return records.flatMap(({ event }) => observedOutcomeFor(event, worktreeAttemptByOperation))
}

const encodedOutcomes = (outcomes: ReadonlyArray<ObservedOutcome>): string =>
  JSON.stringify(Schema.encodeUnknownSync(Schema.Array(AuthoredObservedOutcome))(outcomes))

export const assertAuthoredObservedOutcomes = Effect.fn("AuthoredCassette.assertObservedOutcomes")(function* (
  records: ReadonlyArray<JournalRecord>,
  assertions: Extract<AuthoredCassetteStoryItem, { readonly _tag: "ExpectedObservedOutcomes" }>
) {
  const actual = observedOutcomes(records)
  if (
    encodedOutcomes(assertions.expected) !== encodedOutcomes(actual) ||
    assertions.forbidden.some((forbidden) =>
      actual.some((outcome) => encodedOutcomes([outcome]) === encodedOutcomes([forbidden]))
    )
  ) {
    return yield* new AuthoredCassetteOutcomeMismatch({ actual, expected: assertions.expected })
  }
  return actual
})
