import { PlannedAttemptExecutorProjection, PlannedAttemptExecutorReport } from "@dalph/contracts"
import { ApplicationExitResult } from "@dalph/orchestrator"
import { Schema } from "effect"

/** Commands accepted by the disposable built host used to qualify issue #75. */
export const CodexQualificationAction = Schema.Literals([
  "allocate",
  "associate",
  "association-cut",
  "pre-thread-cut",
  "create",
  "resume",
  "project",
  "read",
  "suspend",
  "interrupt",
  "settle",
  "exercise-suspension",
  "exercise-terminal-suspension",
  "exit",
  "exit-stuck",
  "close",
  "wait"
])
export type CodexQualificationAction = typeof CodexQualificationAction.Type

/** Public, thread-id-free observation emitted by one built qualification host invocation. */
export const CodexQualificationHostEvent = Schema.Struct({
  event: Schema.Literals([
    "ready",
    "allocated",
    "associated",
    "association-write-started",
    "report",
    "projection",
    "suspension-ready",
    "suspension-requested",
    "suspension-unresolved",
    "exit-trace",
    "exit-result",
    "closed",
    "failure"
  ]),
  pid: Schema.optionalKey(Schema.Int),
  worktree: Schema.optionalKey(Schema.String),
  threadMaterialized: Schema.optionalKey(Schema.Boolean),
  command: Schema.optionalKey(Schema.Literals(["Begin", "Observe", "Resume", "Suspend"])),
  report: Schema.optionalKey(PlannedAttemptExecutorReport),
  projection: Schema.optionalKey(PlannedAttemptExecutorProjection),
  exitResult: Schema.optionalKey(ApplicationExitResult),
  detail: Schema.optionalKey(Schema.String)
})
export type CodexQualificationHostEvent = typeof CodexQualificationHostEvent.Type
