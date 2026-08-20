import { RunId, TaskId } from "@dalph/contracts"
import { expect, it } from "vitest"
import { InitialControlPolicy } from "../control/policy.js"
import { TaskWorkCapacity } from "../coordination/admission/capacity.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import {
  RunFinalityEvidence,
  RunFinalityReadShape,
  requiredRunFinalityFactFamilies
} from "../coordination/frontier/run-finality.js"
import { OperationId } from "../workflow/identity.js"
import { TrackerRevision } from "../authorities/task-tracker/task.js"
import { JournalPosition } from "./identity.js"
import { decideWorkflowRunTermination, makeWorkflowRunBeganRecord } from "./run-lifecycle.js"

const runId = RunId.make("lifecycle-evidence-run")
const target = FixtureTarget.make("lifecycle-evidence-target")
const policy = InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) })

const evidence = (overrides: Partial<RunFinalityEvidence> = {}): RunFinalityEvidence =>
  RunFinalityEvidence.make({
    blockedTaskIds: [],
    complete: true,
    contentIdentity: TrackerRevision.make("lifecycle-revision"),
    coverage: { _tag: "CompleteTargetClosure", explicitlyCoveredTaskIds: [TaskId.make("root")], target },
    graphOutcome: "AllTasksSucceeded",
    operationId: OperationId.make("lifecycle-read"),
    readShape: RunFinalityReadShape.make({ explicitlyCoveredTaskIds: [] }),
    requiredFactFamilies: requiredRunFinalityFactFamilies,
    rootPresent: true,
    runId,
    target,
    terminalTaskIds: [],
    observedAt: JournalPosition.make(2),
    ...overrides
  })

it("rejects terminal storage when evidence names another Run", () => {
  const began = makeWorkflowRunBeganRecord(runId, target, policy)
  const decision = decideWorkflowRunTermination(
    [began],
    runId,
    "Completed",
    evidence({ runId: RunId.make("foreign-run") })
  )

  expect(decision._tag).toBe("LifecycleTransitionRejected")
  if (decision._tag === "LifecycleTransitionRejected") {
    expect(decision.failure).toMatchObject({
      _tag: "WorkflowRunTerminationEvidenceInvalid",
      detail: expect.stringContaining("journal Run")
    })
  }
})

it("rejects terminal storage when the exact graph read is absent", () => {
  const began = makeWorkflowRunBeganRecord(runId, target, policy)
  const decision = decideWorkflowRunTermination([began], runId, "Completed", evidence())

  expect(decision._tag).toBe("LifecycleTransitionRejected")
  if (decision._tag === "LifecycleTransitionRejected") {
    expect(decision.failure).toMatchObject({
      _tag: "WorkflowRunTerminationEvidenceInvalid",
      detail: expect.stringContaining("complete or unchanged tracker observation")
    })
  }
})
