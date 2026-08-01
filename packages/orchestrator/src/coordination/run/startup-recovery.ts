import { type IntegrationTarget, PlannedAttemptExecutor, RunId } from "@dalph/contracts"
import { Context, Effect, Layer, Schema } from "effect"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { JournalBoundaryDecodeIssue } from "../../workflow-journal/recovery-model.js"
import { JournalStore } from "../../workflow-journal/store.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import {
  hasUnfinishedRunResponsibility,
  makeJournaledFreshRunRecoveryActivation,
  makeRunRecoveryActivation,
  RunRecoveryActivation
} from "./recovery-activation.js"
import {
  type CandidateContinuationLimit,
  type CandidateCorrectionLimit,
  IntegrationCandidateAgent,
  IntegrationCandidateGit
} from "../../workflow/protocols/integration-candidate-construction/protocol.js"
import { reduceWorkflowJournalHistory } from "../reconstruction/history.js"
import {
  DuplicateUnfinishedTaskAttemptIssue,
  WorkflowJournalHistoryIdentityIssue,
  WorkflowJournalHistorySemanticIssue
} from "../reconstruction/history-result.js"
import { TaskWorkCapacityControl } from "../../control/task-work-capacity.js"
import { IntegrationTargetSelection } from "../../workflow/protocols/integration-admission/protocol.js"

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
export const startupRecoveryLayer = (
  runId: RunId,
  integrationTarget?: IntegrationTarget,
  candidateCorrectionLimit?: CandidateCorrectionLimit,
  candidateContinuationLimit?: CandidateContinuationLimit
) =>
  Layer.effectContext(
    Effect.gen(function* () {
      yield* CoordinatorOwnership
      const journal = yield* JournalStore
      const interpreter = yield* WorkflowInterpreter
      const executor = yield* PlannedAttemptExecutor
      const trace = yield* WorkflowTrace
      const taskWorkCapacityControl = yield* TaskWorkCapacityControl
      const ambient = yield* Effect.context<never>()
      const candidateAgent = Context.getOption(ambient, IntegrationCandidateAgent)
      const candidateGit = Context.getOption(ambient, IntegrationCandidateGit)
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
          ? yield* makeJournaledFreshRunRecoveryActivation(
              runId,
              integrationTarget,
              candidateCorrectionLimit,
              candidateContinuationLimit
            )
          : yield* makeRunRecoveryActivation(
              runId,
              integrationTarget,
              candidateCorrectionLimit,
              candidateContinuationLimit
            )
      let context = Context.empty().pipe(
        Context.add(WorkflowInterpreter, interpreter),
        Context.add(RunRecoveryActivation, recovery),
        Context.add(PlannedAttemptExecutor, executor),
        Context.add(JournalStore, journal),
        Context.add(TaskWorkCapacityControl, taskWorkCapacityControl),
        Context.add(WorkflowTrace, trace)
      )
      if (candidateAgent._tag === "Some")
        context = Context.add(context, IntegrationCandidateAgent, candidateAgent.value)
      if (candidateGit._tag === "Some") context = Context.add(context, IntegrationCandidateGit, candidateGit.value)
      /* v8 ignore next -- @preserve Production startup installs its configured integration target; targetless composition is covered at frontier configuration wait. */
      return integrationTarget === undefined
        ? context
        : Context.add(context, IntegrationTargetSelection, integrationTarget)
    })
  )
