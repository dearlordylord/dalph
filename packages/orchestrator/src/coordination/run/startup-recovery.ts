import { type IntegrationTarget, PlannedAttemptExecutor, RunId } from "@dalph/contracts"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { CoordinatorOwnership } from "../../authorities/coordinator-ownership/ownership.js"
import { JournalBoundaryDecodeIssue } from "../../workflow-journal/recovery-model.js"
import { InRunJournal, type RunLifecycleJournalService } from "../../workflow-journal/store.js"
import { WorkflowInterpreter, WorkflowTrace } from "../../workflow/interpretation/interpreter.js"
import { ControlDirectionApplication } from "../../workflow/protocols/control-direction-application/protocol.js"
import { TaskClaimReacquisitionControl } from "../../workflow/protocols/task-claim-reacquisition/control.js"
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

/** Validates all preserved Runs and selects the requested Run without constructing an appending service. */
export const inspectStartupRecovery = Effect.fn("StartupRecovery.inspect")(function* (
  runId: RunId,
  journal: RunLifecycleJournalService
) {
  const scan = yield* journal.scan()
  const reductions = scan.runs.map((history) => reduceWorkflowJournalHistory(history.runId, history.records))
  const issues = [
    ...scan.issues,
    ...reductions.flatMap((reduction) => (reduction._tag === "InvalidWorkflowJournalHistory" ? reduction.issues : []))
  ]
  if (issues.length > 0) return yield* new StartupRecoveryBlocked({ issues })
  const otherUnfinishedRun = reductions.find(
    (reduction) =>
      reduction._tag === "ValidWorkflowJournalHistory" &&
      reduction.runId !== runId &&
      (runBeganWithoutTermination(reduction) || hasUnfinishedRunResponsibility(reduction.runState))
  )
  if (otherUnfinishedRun?._tag === "ValidWorkflowJournalHistory") {
    return yield* new StartupRecoveryBlocked({
      issues: [{ _tag: "OtherUnfinishedRunIssue", requestedRunId: runId, unfinishedRunId: otherUnfinishedRun.runId }]
    })
  }
  return reductions.find((reduction) => reduction._tag === "ValidWorkflowJournalHistory" && reduction.runId === runId)
})

const makeStartupRecoveryContext = Effect.fn("StartupRecovery.makeContext")(function* (
  runId: RunId,
  integrationTarget: IntegrationTarget | undefined,
  candidateCorrectionLimit: CandidateCorrectionLimit | undefined,
  candidateContinuationLimit: CandidateContinuationLimit | undefined,
  startup: "Fresh" | "Recovered",
  freshRecoveryTrace: "Emit" | "Suppress"
) {
  yield* CoordinatorOwnership
  const inRunJournal = yield* InRunJournal
  const interpreter = yield* WorkflowInterpreter
  const executor = yield* PlannedAttemptExecutor
  const trace = yield* WorkflowTrace
  const taskWorkCapacityControl = yield* TaskWorkCapacityControl
  const controlDirectionApplication = yield* ControlDirectionApplication
  const taskClaimReacquisitionControl = yield* TaskClaimReacquisitionControl
  const ambient = yield* Effect.context<never>()
  const candidateAgent = Context.getOption(ambient, IntegrationCandidateAgent)
  const candidateGit = Context.getOption(ambient, IntegrationCandidateGit)
  const recovery =
    startup === "Fresh"
      ? yield* makeJournaledFreshRunRecoveryActivation(
          runId,
          integrationTarget,
          candidateCorrectionLimit,
          candidateContinuationLimit,
          { workflowTrace: freshRecoveryTrace === "Emit" ? Option.some(trace) : Option.none() }
        )
      : yield* makeRunRecoveryActivation(runId, integrationTarget, candidateCorrectionLimit, candidateContinuationLimit)
  let context = Context.empty().pipe(
    Context.add(WorkflowInterpreter, interpreter),
    Context.add(RunRecoveryActivation, recovery),
    Context.add(PlannedAttemptExecutor, executor),
    Context.add(InRunJournal, inRunJournal),
    Context.add(ControlDirectionApplication, controlDirectionApplication),
    Context.add(TaskWorkCapacityControl, taskWorkCapacityControl),
    Context.add(TaskClaimReacquisitionControl, taskClaimReacquisitionControl),
    Context.add(WorkflowTrace, trace)
  )
  if (candidateAgent._tag === "Some") context = Context.add(context, IntegrationCandidateAgent, candidateAgent.value)
  if (candidateGit._tag === "Some") context = Context.add(context, IntegrationCandidateGit, candidateGit.value)
  /* v8 ignore next -- @preserve Production startup installs its configured integration target; targetless composition is covered at frontier configuration wait. */
  return integrationTarget === undefined ? context : Context.add(context, IntegrationTargetSelection, integrationTarget)
})

/** Builds ordinary in-Run services after bootstrap has already validated the complete accepted prefix. */
export const validatedStartupRecoveryLayer = (
  runId: RunId,
  integrationTarget: IntegrationTarget | undefined,
  startup: "Fresh" | "Recovered",
  candidateCorrectionLimit?: CandidateCorrectionLimit,
  candidateContinuationLimit?: CandidateContinuationLimit,
  options?: { readonly freshRecoveryTrace?: "Emit" | "Suppress" }
) =>
  Layer.effectContext(
    makeStartupRecoveryContext(
      runId,
      integrationTarget,
      candidateCorrectionLimit,
      candidateContinuationLimit,
      startup,
      options?.freshRecoveryTrace ?? "Emit"
    )
  )
