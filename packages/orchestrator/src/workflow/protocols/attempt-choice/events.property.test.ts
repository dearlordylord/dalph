import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Effect } from "effect"
import * as fc from "fast-check"
import { decodeJournalEvent, encodeJournalEvent } from "../../../workflow-journal/event-codec.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { AttemptChoiceAppliedEvent, AttemptChoiceRequestId } from "./events.js"

const identityText = fc.stringMatching(/^[a-z][a-z0-9-]{0,16}$/)

it("round-trips every generated applied attempt choice through the journal codec", async () => {
  await fc.assert(
    fc.asyncProperty(
      identityText,
      identityText,
      fc.constantFrom("ContinueExistingAttempt" as const, "StopTaskImplementation" as const),
      async (requestIdentity, subjectIdentity, choice) => {
        const plannedAttempt = PlannedTaskAttempt.make({
          attemptId: AttemptId.make(`attempt-${subjectIdentity}`),
          baseSha: GitCommitSha.make("1".repeat(40)),
          branch: TaskBranchRef.make(`refs/heads/dalph/${subjectIdentity}`),
          executor: TaskExecutorLocator.make(`executor:${subjectIdentity}`),
          runId: RunId.make(`run-${subjectIdentity}`),
          taskId: TaskId.make(`task-${subjectIdentity}`),
          taskRevision: TaskRevision.make(`planned-${subjectIdentity}`),
          worktree: WorktreeLocator.make(`/worktrees/${subjectIdentity}`)
        })
        const event = AttemptChoiceAppliedEvent.make({
          choice,
          initiatedBy: { _tag: "Operator" },
          occurrenceClassification: "InitiatedAction",
          requestId: AttemptChoiceRequestId.make({ nonce: `request-${requestIdentity}`, runId: plannedAttempt.runId }),
          subject: { observedTaskRevision: TaskRevision.make(`observed-${subjectIdentity}`), plannedAttempt },
          version: workflowJournalEventVersion
        })

        const decoded = await Effect.runPromise(decodeJournalEvent(encodeJournalEvent(event)))
        return JSON.stringify(decoded) === JSON.stringify(event)
      }
    ),
    { numRuns: 200 }
  )
})
