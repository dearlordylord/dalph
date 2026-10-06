import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification
} from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Context, Effect, Layer, Option } from "effect"
import { expect } from "vitest"
import { makeExecutingAttemptHistory } from "../../test/support/executing-attempt-history.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { ActiveTaskClaim } from "../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import { liveJournalTestLayer } from "../coordination/delivery/live-journal-test-layer.js"
import { WorkflowOperation, makeTaskAttemptPlanOperation } from "../workflow/registry/operation.js"
import { AttemptBasePolicy } from "../workflow/protocols/task-attempt-planning/base.js"
import { taskAttemptBaseReadOperationIdFor } from "../workflow/protocols/task-attempt-planning/base-read-identity.js"
import { OperationId } from "../workflow/identity.js"
import {
  WorkflowRunBeganEvent,
  TaskAttemptBaseReadIntendedEvent,
  TaskAttemptBaseObservedEvent,
  taskTrackerReadIntent,
  TaskAttemptPlannedEvent
} from "../workflow/registry/event.js"

import { Journal } from "../coordination/delivery/journal.js"
import { Task, TrackerRevision } from "../authorities/task-tracker/task.js"
import { projectTrackerSnapshot } from "../authorities/task-tracker/graph.js"
import { describeJournalEvent } from "../workflow/registry/event-descriptor.js"
import { workflowJournalEventVersion } from "../workflow/kernel/event.js"
import {
  ApplyTaskAttemptBaseRetryRequest,
  TaskAttemptBaseRetryRequestId
} from "../workflow/protocols/task-attempt-planning/retry-data.js"
import {
  applyTaskAttemptBaseRetry,
  readTaskAttemptBaseRetryRequest
} from "../workflow/protocols/task-attempt-planning/retry.js"
import { baseRetryWorkflowStep } from "../coordination/run/base-retry-workflow.js"
import { freshAttemptBaseReadLineageWasAccepted } from "../coordination/admission/fresh-attempt-lineage.js"
import {
  makeCompleteTaskTrackerFactsObserved,
  makeFocusedTaskClaimFactsObserved,
  makeFocusedTaskWorkSpecificationFactsObserved,
  taskTrackerFactsObservedEvent
} from "../workflow/task-tracker-facts/observation.js"
import { projectWorkflowOccurrences } from "../workflow/registry/occurrence-projection.js"
import { journalRecordsAfter } from "./record-evidence.js"

const runId = RunId.make("qualified-base-journal")
const taskId = TaskId.make("dependant")
const target = FixtureTarget.make("qualified-base-journal")
const anchor = GitCommitSha.make("1".repeat(40))
const selected = GitCommitSha.make("2".repeat(40))
const specification = makeTaskWorkSpecification({ taskId, title: "Evaluator", body: "Use delivered prerequisites" })
const plan = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("qualified-base-attempt"),
  baseSha: anchor,
  branch: TaskBranchRef.make("refs/heads/dalph/qualified-base"),
  executor: TaskExecutorLocator.make("executor:qualified-base"),
  runId,
  taskId,
  taskRevision: specification.fingerprint,
  worktree: WorktreeLocator.make("/worktrees/qualified-base")
})
const history = makeExecutingAttemptHistory({
  runId,
  trackerTarget: target,
  plannedAttempt: plan,
  taskSpecification: specification,
  activeClaim: ActiveTaskClaim.make({
    operationId: OperationId.make("qualified-base-claim"),
    owner: ClaimOwner.make("dalph"),
    taskId,
    token: ClaimToken.make("qualified-base-claim-token")
  })
})
const policy = AttemptBasePolicy.cases.QualifiedCurrentIntegrationHead.make({
  executionRepository: GitRepositoryLocator.make("/execution"),
  integrationTarget: {
    repository: GitRepositoryLocator.make("/target.git"),
    ref: IntegrationTargetRef.make("refs/heads/master")
  },
  lineageAnchor: anchor
})
const prefix = history.records
  .slice(
    0,
    history.records.findIndex(({ event }) => event._tag === "TaskAttemptPlanned")
  )
  .map((record) =>
    record.event._tag === "WorkflowRunBegan"
      ? { ...record, event: WorkflowRunBeganEvent.make({ ...record.event, attemptBasePolicy: policy }) }
      : record
  )
const operation = WorkflowOperation.cases.ReadTaskAttemptBase.make({
  claimOperationId: history.activeClaim.operationId,
  operationId: taskAttemptBaseReadOperationIdFor(
    history.activeClaim.operationId,
    history.specificationOperation.operationId
  ),
  policy,
  predecessorOperationIds: [history.specificationOperation.operationId],
  taskId,
  taskRevision: specification.fingerprint
})

const task = Task.make({ id: taskId, lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] })
const projected = projectTrackerSnapshot({ revision: TrackerRevision.make("retry-graph"), tasks: [task] })
const graph = Option.getOrThrow(projected._tag === "Valid" ? Option.some(projected.snapshot) : Option.none())
const retry = ApplyTaskAttemptBaseRetryRequest.make({
  requestId: TaskAttemptBaseRetryRequestId.make("operator-retry"),
  subject: { runId, taskId, refusedReadOperationId: operation.operationId }
})
const append = (journal: Journal["Service"], event: Parameters<Journal["Service"]["append"]>[2]) =>
  journal.append(runId, describeJournalEvent(event).expectedKey, event)
const beginRead = (journal: Journal["Service"]) =>
  append(
    journal,
    TaskAttemptBaseReadIntendedEvent.make({
      operation,
      initiatedBy: { _tag: "DalphCoordinator" },
      occurrenceClassification: "InitiatedAction",
      version: workflowJournalEventVersion
    })
  )
const refuseRead = (journal: Journal["Service"]) =>
  append(
    journal,
    TaskAttemptBaseObservedEvent.make({
      operationId: operation.operationId,
      observation: { _tag: "Refused", boundary: "ExecutionCommit", detail: "missing" },
      occurrenceClassification: "NonActionOccurrence",
      version: workflowJournalEventVersion
    })
  )
const withJournal = <A, E>(effect: (journal: Journal["Service"]) => Effect.Effect<A, E>, records = prefix) =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(liveJournalTestLayer({ runId, target, records }))
      return yield* effect(Context.get(context, Journal))
    })
  )

it.effect("records only explicit settled-refusal retries and redelivers the original receipt", () =>
  withJournal((journal) =>
    Effect.gen(function* () {
      expect(yield* applyTaskAttemptBaseRetry(journal, runId, retry).pipe(Effect.result)).toMatchObject({
        _tag: "Failure",
        failure: { reason: "NotRefused" }
      })
      yield* beginRead(journal)
      expect(yield* applyTaskAttemptBaseRetry(journal, runId, retry).pipe(Effect.result)).toMatchObject({
        _tag: "Failure",
        failure: { reason: "NotRefused" }
      })
      yield* refuseRead(journal)
      expect(baseRetryWorkflowStep((yield* journal.state.get).prefix, task)).toBeUndefined()
      const accepted = yield* applyTaskAttemptBaseRetry(journal, runId, retry)
      expect(yield* applyTaskAttemptBaseRetry(journal, runId, retry)).toEqual(accepted)
      expect(
        yield* applyTaskAttemptBaseRetry(journal, runId, { ...retry, requestId: "other" }).pipe(Effect.result)
      ).toMatchObject({ _tag: "Failure", failure: { reason: "AlreadyRequested" } })
      const occurrences = yield* projectWorkflowOccurrences(
        Array.from(journalRecordsAfter((yield* journal.state.get).prefix, null))
      )
      expect(
        occurrences.occurrences.some(
          (item) => item._tag === "TaskAttemptBaseRetryRequested" && item.requestId === retry.requestId
        )
      ).toBe(true)
    })
  )
)

it.effect("refreshes graph then exact claim then specification before one causal successor", () =>
  withJournal((journal) =>
    Effect.gen(function* () {
      yield* beginRead(journal)
      yield* refuseRead(journal)
      yield* applyTaskAttemptBaseRetry(journal, runId, retry)
      for (const expected of ["ReadTrackerGraph", "ReadTaskClaim", "ReadTaskWorkSpecification"]) {
        const stage = baseRetryWorkflowStep((yield* journal.state.get).prefix, task)?.step
        if (stage?._tag !== "ReadTaskAttemptBaseRetryFacts") return yield* Effect.die("missing retry fact step")
        const read = stage.operation
        expect(read._tag).toBe(expected)
        yield* append(journal, taskTrackerReadIntent(read))
        expect(baseRetryWorkflowStep((yield* journal.state.get).prefix, task)?.step).toEqual(stage)
        const facts =
          read._tag === "ReadTrackerGraph"
            ? makeCompleteTaskTrackerFactsObserved(read, graph)
            : read._tag === "ReadTaskClaim"
              ? makeFocusedTaskClaimFactsObserved(read, history.activeClaim)
              : makeFocusedTaskWorkSpecificationFactsObserved(read, specification)
        yield* append(journal, taskTrackerFactsObservedEvent(read.operationId, facts))
      }
      const stage = baseRetryWorkflowStep((yield* journal.state.get).prefix, task)?.step
      if (stage?._tag !== "ReadTaskAttemptBase") return yield* Effect.die("missing successor")
      const successor = WorkflowOperation.cases.ReadTaskAttemptBase.make({
        ...(stage.retryRequestId === undefined ? {} : { retryRequestId: stage.retryRequestId }),
        operationId: stage.operationId,
        claimOperationId: stage.claimOperationId,
        policy: stage.policy,
        taskId,
        taskRevision: specification.fingerprint,
        predecessorOperationIds: [stage.predecessorOperationId]
      })
      expect(freshAttemptBaseReadLineageWasAccepted((yield* journal.state.get).prefix, successor)).toBe(true)
      const { retryRequestId: _requestId, ...withoutRetryAuthority } = successor
      expect(freshAttemptBaseReadLineageWasAccepted((yield* journal.state.get).prefix, withoutRetryAuthority)).toBe(
        false
      )
      yield* append(
        journal,
        TaskAttemptBaseReadIntendedEvent.make({
          operation: successor,
          initiatedBy: { _tag: "DalphCoordinator" },
          occurrenceClassification: "InitiatedAction",
          version: workflowJournalEventVersion
        })
      )
      yield* append(
        journal,
        TaskAttemptBaseObservedEvent.make({
          operationId: successor.operationId,
          observation: { _tag: "Qualified", baseSha: selected },
          occurrenceClassification: "NonActionOccurrence",
          version: workflowJournalEventVersion
        })
      )
      expect(
        yield* applyTaskAttemptBaseRetry(journal, runId, {
          requestId: "qualified-retry",
          subject: { ...retry.subject, refusedReadOperationId: successor.operationId }
        }).pipe(Effect.result)
      ).toMatchObject({ _tag: "Failure", failure: { reason: "NotRefused" } })
      const planned = makeTaskAttemptPlanOperation({
        operationId: OperationId.make("successor-plan"),
        plannedAttempt: { ...plan, baseSha: selected },
        predecessorOperationIds: [successor.operationId]
      })
      yield* append(journal, TaskAttemptPlannedEvent.make({ operation: planned, version: workflowJournalEventVersion }))
      expect(yield* applyTaskAttemptBaseRetry(journal, runId, retry)).toMatchObject({ requestId: retry.requestId })
    })
  )
)

it.effect("refuses changed tracker authority before the successor Git read", () =>
  Effect.gen(function* () {
    for (const change of ["Graph", "Claim", "Specification"] as const)
      yield* withJournal((journal) =>
        Effect.gen(function* () {
          yield* beginRead(journal)
          yield* refuseRead(journal)
          yield* applyTaskAttemptBaseRetry(journal, runId, retry)
          for (const family of ["Graph", "Claim", "Specification"] as const) {
            const stage = baseRetryWorkflowStep((yield* journal.state.get).prefix, task)?.step
            if (stage?._tag !== "ReadTaskAttemptBaseRetryFacts") return yield* Effect.die("missing tracker stage")
            const read = stage.operation
            yield* append(journal, taskTrackerReadIntent(read))
            const changedProjection = projectTrackerSnapshot({
              revision: TrackerRevision.make("changed"),
              tasks: [{ ...task, lifecycle: { _tag: "TerminalWithoutSuccess" } }]
            })
            const changedGraph = Option.getOrThrow(
              changedProjection._tag === "Valid" ? Option.some(changedProjection.snapshot) : Option.none()
            )
            const facts =
              read._tag === "ReadTrackerGraph"
                ? makeCompleteTaskTrackerFactsObserved(read, change === family ? changedGraph : graph)
                : read._tag === "ReadTaskClaim"
                  ? makeFocusedTaskClaimFactsObserved(
                      read,
                      change === family
                        ? { ...history.activeClaim, token: ClaimToken.make("foreign") }
                        : history.activeClaim
                    )
                  : makeFocusedTaskWorkSpecificationFactsObserved(
                      read,
                      change === family
                        ? makeTaskWorkSpecification({ ...specification, body: "changed" })
                        : specification
                    )
            yield* append(journal, taskTrackerFactsObservedEvent(read.operationId, facts))
            if (change === family) {
              expect(baseRetryWorkflowStep((yield* journal.state.get).prefix, task)).toEqual({ step: undefined })
              break
            }
          }
        })
      )
  })
)

it.effect("reconstructs every accepted retry tracker cut without another request or changed read identity", () =>
  withJournal((journal) =>
    Effect.gen(function* () {
      yield* beginRead(journal)
      yield* refuseRead(journal)
      const receipt = yield* applyTaskAttemptBaseRetry(journal, runId, retry)
      const reopensExactly = Effect.gen(function* () {
        const records = Array.from(journalRecordsAfter((yield* journal.state.get).prefix, null))
        const before = baseRetryWorkflowStep(records, task)
        yield* withJournal(
          (reopened) =>
            Effect.gen(function* () {
              expect(baseRetryWorkflowStep((yield* reopened.state.get).prefix, task)).toEqual(before)
              expect(yield* applyTaskAttemptBaseRetry(reopened, runId, retry)).toEqual(receipt)
              expect(Array.from(journalRecordsAfter((yield* reopened.state.get).prefix, null))).toHaveLength(
                records.length
              )
            }),
          records
        )
      })
      yield* reopensExactly
      for (const expected of ["ReadTrackerGraph", "ReadTaskClaim", "ReadTaskWorkSpecification"]) {
        const step = baseRetryWorkflowStep((yield* journal.state.get).prefix, task)?.step
        if (step?._tag !== "ReadTaskAttemptBaseRetryFacts") return yield* Effect.die("missing retry tracker step")
        const read = step.operation
        expect(read._tag).toBe(expected)
        yield* append(journal, taskTrackerReadIntent(read))
        yield* reopensExactly
        const facts =
          read._tag === "ReadTrackerGraph"
            ? makeCompleteTaskTrackerFactsObserved(read, graph)
            : read._tag === "ReadTaskClaim"
              ? makeFocusedTaskClaimFactsObserved(read, history.activeClaim)
              : makeFocusedTaskWorkSpecificationFactsObserved(read, specification)
        yield* append(journal, taskTrackerFactsObservedEvent(read.operationId, facts))
        yield* reopensExactly
      }
    })
  )
)

it.effect("reads an exact retry receipt without writing and refuses reused request identity", () =>
  withJournal((journal) =>
    Effect.gen(function* () {
      expect(yield* readTaskAttemptBaseRetryRequest(journal, runId, retry)).toEqual({ _tag: "NotRecorded" })
      yield* beginRead(journal)
      yield* refuseRead(journal)
      const receipt = yield* applyTaskAttemptBaseRetry(journal, runId, retry)
      const before = Array.from(journalRecordsAfter((yield* journal.state.get).prefix, null))
      expect(yield* readTaskAttemptBaseRetryRequest(journal, runId, retry)).toEqual({ _tag: "Recorded", ...receipt })
      expect(
        yield* readTaskAttemptBaseRetryRequest(journal, runId, { ...retry, requestId: "unrecorded-retry" })
      ).toEqual({ _tag: "NotRecorded" })
      expect(
        yield* readTaskAttemptBaseRetryRequest(journal, runId, {
          ...retry,
          subject: { ...retry.subject, taskId: "foreign-task" }
        }).pipe(Effect.result)
      ).toMatchObject({ _tag: "Failure", failure: { reason: "RequestIdentityConflict" } })
      expect(Array.from(journalRecordsAfter((yield* journal.state.get).prefix, null))).toEqual(before)
    })
  )
)
