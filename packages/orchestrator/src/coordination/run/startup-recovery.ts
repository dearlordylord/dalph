import { PlannedAttemptExecutor, RunId } from "@dalph/contracts"
import { Context, Effect, Layer, Schema } from "effect"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { JournalBoundaryDecodeIssue } from "../../workflow-journal/recovery-model.js"
import { JournalStore } from "../../workflow-journal/store.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { PlannedAttemptRecoveryAuthority } from "./recovery-authority.js"
import {
  hasUnfinishedRunResponsibility,
  makeJournaledFreshRunRecoveryActivation,
  makeRunRecoveryActivation,
  RunRecoveryActivation
} from "./recovery-activation.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import {
  DuplicateUnfinishedTaskAttemptIssue,
  WorkflowJournalHistoryIdentityIssue,
  WorkflowJournalHistorySemanticIssue
} from "../reconstruction/history-result.js"

export const StartupRecoveryIssue = Schema.Union([
  DuplicateUnfinishedTaskAttemptIssue,
  JournalBoundaryDecodeIssue,
  WorkflowJournalHistoryIdentityIssue,
  WorkflowJournalHistorySemanticIssue,
  Schema.TaggedStruct("OtherUnfinishedRunIssue", { requestedRunId: RunId, unfinishedRunId: RunId })
])
export type StartupRecoveryIssue = typeof StartupRecoveryIssue.Type

/** Startup found preserved history that cannot be reconstructed safely. */
export class StartupRecoveryBlocked extends Schema.TaggedErrorClass<StartupRecoveryBlocked>()(
  "StartupRecoveryBlocked",
  { issues: Schema.Array(StartupRecoveryIssue) }
) {}

const runBeganWithoutTermination = (
  reduction: Extract<ReturnType<typeof reduceWorkflowJournalHistory>, { readonly _tag: "ValidWorkflowJournalHistory" }>
): boolean =>
  reduction.records.some(({ event }) => event._tag === "WorkflowRunBegan") &&
  !reduction.records.some(({ event }) => event._tag === "WorkflowRunTerminated")

/** Discovers journaled work before exposing the production run environment. */
export const startupRecoveryLayer = (runId: RunId) =>
  Layer.effectContext(
    Effect.gen(function* () {
      yield* CoordinatorOwnership
      const journal = yield* JournalStore
      const interpreter = yield* WorkflowInterpreter
      const executor = yield* PlannedAttemptExecutor
      const recoveryAuthority = yield* PlannedAttemptRecoveryAuthority
      const trace = yield* WorkflowTrace
      const scan = yield* journal.scan()
      const reductions = scan.runs.map((history) => reduceWorkflowJournalHistory(history.runId, history.records))
      const issues = [
        ...scan.issues,
        ...reductions.flatMap((reduction) =>
          reduction._tag === "InvalidWorkflowJournalHistory" ? reduction.issues : []
        )
      ]
      if (issues.length > 0) {
        return yield* new StartupRecoveryBlocked({ issues })
      }
      const otherUnfinishedRun = reductions.find(
        (reduction) =>
          reduction._tag === "ValidWorkflowJournalHistory" &&
          reduction.runId !== runId &&
          (runBeganWithoutTermination(reduction) || hasUnfinishedRunResponsibility(reduction.runState))
      )
      if (otherUnfinishedRun?._tag === "ValidWorkflowJournalHistory") {
        return yield* new StartupRecoveryBlocked({
          issues: [
            { _tag: "OtherUnfinishedRunIssue", requestedRunId: runId, unfinishedRunId: otherUnfinishedRun.runId }
          ]
        })
      }
      const currentRun = reductions.find(
        (reduction) => reduction._tag === "ValidWorkflowJournalHistory" && reduction.runId === runId
      )
      const recovery =
        currentRun === undefined
          ? yield* makeJournaledFreshRunRecoveryActivation(runId)
          : yield* makeRunRecoveryActivation(runId)
      return Context.empty().pipe(
        Context.add(WorkflowInterpreter, interpreter),
        Context.add(RunRecoveryActivation, recovery),
        Context.add(PlannedAttemptExecutor, executor),
        Context.add(JournalStore, journal),
        Context.add(PlannedAttemptRecoveryAuthority, recoveryAuthority),
        Context.add(WorkflowTrace, trace)
      )
    })
  )
