import { join } from "node:path"
import { RunId, TaskId } from "@dalph/contracts"
import {
  ClaimOwner,
  ClaimToken,
  defaultTaskWorkCapacity,
  GithubIssueNumber,
  GithubIssueTarget,
  GithubRepositoryName,
  GithubRepositoryOwner,
  JournalDatabaseLocator,
  JournalStore,
  OperationId,
  TaskClaimAcquiredEvent,
  TaskClaimAcquisitionIntendedEvent,
  WorkflowOperation,
  intentRecordKey,
  outcomeRecordKey,
  sqliteJournalStoreLayer,
  workflowJournalEventVersion
} from "@dalph/orchestrator"
import { Effect } from "effect"
import { type AdapterName, type FaultPoint, type RecoveredDecision, fixture } from "../contracts.ts"
import {
  createClaim,
  closeApplicationExitAdmission,
  readClaim,
  readCurrentTaskFacts
} from "../controlled-world.ts"

interface JournalBaselineInput {
  readonly adapter: AdapterName
  readonly faultPoint: FaultPoint
  readonly processInstance: string
  readonly workspace: string
  readonly onExecutionStored: (executionId: string, attemptIds: ReadonlyArray<string>) => Promise<void>
  readonly onFault: (faultPoint: FaultPoint) => Promise<never>
}

const runId = RunId.make(fixture.runId)
const operationId = OperationId.make(fixture.claim.operationId)
const taskId = TaskId.make(fixture.claim.taskId)
const acquisition = {
  operationId,
  owner: ClaimOwner.make(fixture.claim.owner),
  taskId,
  token: ClaimToken.make(fixture.claim.token)
}
const acquisitionOperation = WorkflowOperation.cases.AcquireTaskClaim.make({
  acquisition,
  authority: { _tag: "TaskSelectionAuthority" },
  predecessorOperationIds: []
})
const target = GithubIssueTarget.make({
  issueNumber: GithubIssueNumber.make(232),
  owner: GithubRepositoryOwner.make("dearlordylord"),
  repository: GithubRepositoryName.make("dalph-evaluation-fixture")
})

const exactClaimMatches = (claim: typeof fixture.claim | null): boolean =>
  claim !== null &&
  claim.operationId === fixture.claim.operationId &&
  claim.owner === fixture.claim.owner &&
  claim.taskId === fixture.claim.taskId &&
  claim.token === fixture.claim.token

export const runJournalBaseline = async (input: JournalBaselineInput): Promise<RecoveredDecision> => {
  const context = {
    adapter: input.adapter,
    processInstance: input.processInstance,
    workspace: input.workspace
  }
  const layer = sqliteJournalStoreLayer({
    filename: JournalDatabaseLocator.make(join(input.workspace, "journal-baseline.sqlite"))
  })

  return Effect.runPromise(
    Effect.gen(function* () {
      const journal = yield* JournalStore
      const records = yield* journal.read(runId)
      if (records.length === 0) {
        yield* journal.beginRun(runId, target, { taskExecutionCapacity: defaultTaskWorkCapacity })
      }
      yield* Effect.promise(() => input.onExecutionStored(runId, []))
      if (input.faultPoint === "AfterExecutionStored" && input.processInstance === "process-1") {
        return yield* Effect.promise(() => input.onFault(input.faultPoint))
      }
      const history = yield* journal.read(runId)
      const intent = history.find(({ event }) => event._tag === "TaskClaimAcquisitionIntended")
      const outcome = history.find(({ event }) => event._tag === "TaskClaimAcquired")
      let claimAcquired = outcome !== undefined
      const recordAcquired = journal.append(
        runId,
        outcomeRecordKey(operationId),
        TaskClaimAcquiredEvent.make({
          claim: { _tag: "ActiveTaskClaim", ...acquisition },
          version: workflowJournalEventVersion
        })
      )

      if (intent === undefined) {
        const observed = yield* Effect.promise(() => readClaim(context))
        if (observed !== null && !exactClaimMatches(observed)) return "Wait" as const
        yield* journal.append(
          runId,
          intentRecordKey(operationId),
          TaskClaimAcquisitionIntendedEvent.make({
            operation: acquisitionOperation,
            version: workflowJournalEventVersion
          })
        )
        if (input.faultPoint === "AfterClaimIntentBeforeRequest") {
          return yield* Effect.promise(() => input.onFault(input.faultPoint))
        }
        if (input.faultPoint === "AfterExitCutoff") {
          yield* Effect.promise(() => closeApplicationExitAdmission(context))
          return yield* Effect.promise(() => input.onFault(input.faultPoint))
        }
        const replyDelivered = input.faultPoint !== "AfterClaimAppliedBeforeReplyRecorded"
        yield* Effect.promise(() => createClaim(context, fixture.claim, replyDelivered))
        if (input.faultPoint === "AfterClaimAppliedBeforeReplyRecorded") {
          return yield* Effect.promise(() => input.onFault(input.faultPoint))
        }
        if (input.faultPoint === "AfterClaimReplyDurableBeforeNextRead") {
          yield* recordAcquired
          return yield* Effect.promise(() => input.onFault(input.faultPoint))
        }
        yield* recordAcquired
        claimAcquired = true
      }

      if (!claimAcquired) {
        const observed = yield* Effect.promise(() => readClaim(context))
        if (observed === null) {
          yield* Effect.promise(() => createClaim(context, fixture.claim, true))
        } else if (!exactClaimMatches(observed)) {
          return "Wait" as const
        }
        yield* recordAcquired
      }

      const current = yield* Effect.promise(() => readCurrentTaskFacts(context))
      if (input.faultPoint === "AfterCleanCheckpoint" && current.trackerRevision === 2) {
        return yield* Effect.promise(() => input.onFault(input.faultPoint))
      }
      if (current.task.lifecycle !== "Open" || !current.task.targetMember) {
        return "Wait" as const
      }
      return "ContinueSameRun" as const
    }).pipe(Effect.provide(layer), Effect.scoped)
  )
}
