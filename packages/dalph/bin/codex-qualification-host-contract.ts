import { PlannedAttemptExecutorProjection, PlannedAttemptExecutorReport } from "@dalph/contracts"
import { ApplicationExitResult, PlannedAttemptExecutorCommandOrdinal } from "@dalph/orchestrator"
import { Schema } from "effect"

/** Commands accepted by the disposable built host used to qualify issue #75. */
export const CodexQualificationAction = Schema.Literals([
  "allocate",
  "associate",
  "workflow-association-cut",
  "workflow-begin",
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

/** Number of Begin intents observed in one qualification journal snapshot. */
const BeginIntentCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("CodexQualificationBeginIntentCount")
)
/** Number of Begin responses observed in one qualification journal snapshot. */
const BeginResponseCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).pipe(
  Schema.brand("CodexQualificationBeginResponseCount")
)

/** Public, thread-id-free observation emitted by one built qualification host invocation. */
export const CodexQualificationHostEvent = Schema.Union([
  Schema.Struct({ event: Schema.Literal("ready"), pid: Schema.Int }),
  Schema.Struct({ event: Schema.Literal("allocated"), worktree: Schema.String, threadMaterialized: Schema.Boolean }),
  Schema.Struct({ event: Schema.Literal("associated"), worktree: Schema.String, threadMaterialized: Schema.Boolean }),
  Schema.Struct({ event: Schema.Literal("association-write-started") }),
  Schema.Struct({
    event: Schema.Literal("begin-journal"),
    beginIntents: BeginIntentCount,
    beginOrdinal: PlannedAttemptExecutorCommandOrdinal,
    beginResponses: BeginResponseCount
  }),
  Schema.Struct({
    event: Schema.Literal("report"),
    command: Schema.Literals(["Begin", "Observe", "Resume", "Suspend"]),
    report: PlannedAttemptExecutorReport
  }),
  Schema.Struct({ event: Schema.Literal("projection"), projection: PlannedAttemptExecutorProjection }),
  Schema.Struct({ event: Schema.Literal("suspension-ready") }),
  Schema.Struct({ event: Schema.Literal("suspension-requested") }),
  Schema.Struct({ event: Schema.Literal("suspension-unresolved"), detail: Schema.String }),
  Schema.Struct({ event: Schema.Literal("exit-trace"), detail: Schema.String }),
  Schema.Struct({ event: Schema.Literal("exit-result"), exitResult: ApplicationExitResult }),
  Schema.Struct({ event: Schema.Literal("closed") }),
  Schema.Struct({ event: Schema.Literal("failure"), detail: Schema.String })
]).annotate({ parseOptions: { onExcessProperty: "error" } })
export type CodexQualificationHostEvent = typeof CodexQualificationHostEvent.Type
