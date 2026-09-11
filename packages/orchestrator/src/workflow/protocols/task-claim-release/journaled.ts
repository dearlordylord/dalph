import type { RunId } from "@dalph/contracts"
import { Effect } from "effect"
import { InRunJournal } from "../../../workflow-journal/store.js"
import { AcceptedJournalReader } from "../../../workflow-journal/accepted-reader.js"
import { journalRecordByKey } from "../../../workflow-journal/record-evidence.js"
import { intentRecordKey, outcomeRecordKey } from "../../../workflow-journal/record-key.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { TaskClaimReleaseIntendedEvent, TaskClaimReleasedEvent } from "../../registry/event.js"
import type { WorkflowOperation } from "../../registry/operation.js"
import { AuthoritativeTaskClaimReleased } from "./protocol.js"
import {
  InterruptibleWorkflowBoundaryIntent,
  runInterruptibleBoundary,
  type InterruptibleWorkflowBoundaryExecution
} from "../../interpretation/interruptible-boundary.js"

type TaskClaimReleaseOperation = typeof WorkflowOperation.cases.ReleaseTaskClaim.Type

const releaseEquals = (
  left: TaskClaimReleaseOperation["release"],
  right: TaskClaimReleaseOperation["release"]
): boolean =>
  left.operationId === right.operationId &&
  left.claim.operationId === right.claim.operationId &&
  left.claim.owner === right.claim.owner &&
  left.claim.taskId === right.claim.taskId &&
  left.claim.token === right.claim.token

/**
 * Records one generic exact-claim cleanup intent, runs the shared reread-before-
 * retry protocol, and records absence only after the tracker proves it.
 */
export const runJournaledTaskClaimRelease = Effect.fn("TaskClaimRelease.runJournaledTaskClaimRelease")(function* <E, R>(
  runId: RunId,
  operation: TaskClaimReleaseOperation,
  release: Effect.Effect<typeof AuthoritativeTaskClaimReleased.Type, E, R>,
  options: {
    readonly boundaryIntent?: InterruptibleWorkflowBoundaryIntent
    readonly execution?: InterruptibleWorkflowBoundaryExecution | undefined
    readonly onIntentRecorded?: Effect.Effect<void>
  } = {}
) {
  const journal = yield* InRunJournal
  const acceptedJournal = yield* AcceptedJournalReader
  yield* Effect.uninterruptible(
    journal
      .append(
        runId,
        intentRecordKey(operation.release.operationId),
        TaskClaimReleaseIntendedEvent.make({ operation, version: workflowJournalEventVersion })
      )
      .pipe(Effect.andThen(options.onIntentRecorded ?? Effect.void))
  )
  const existing = journalRecordByKey(
    yield* acceptedJournal.readAccepted(runId),
    outcomeRecordKey(operation.release.operationId)
  )
  if (existing?.event._tag === "TaskClaimReleased" && releaseEquals(existing.event.release, operation.release))
    return AuthoritativeTaskClaimReleased.make({ release: operation.release })
  const intent =
    options.boundaryIntent ?? InterruptibleWorkflowBoundaryIntent.TaskClaimCleanup({ family: "TaskTracker", operation })
  return yield* runInterruptibleBoundary(options.execution, intent, release, (result) =>
    journal
      .append(
        runId,
        outcomeRecordKey(operation.release.operationId),
        TaskClaimReleasedEvent.make({ release: operation.release, version: workflowJournalEventVersion })
      )
      .pipe(Effect.as(result))
  )
})
