import { GitTaskAttemptBaseUnsettled } from "../authorities/git/task-attempt-base.js"
import { journalRecordsAfter } from "./record-evidence.js"
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
import { Context, Effect, Layer } from "effect"
import { expect } from "vitest"
import { makeExecutingAttemptHistory } from "../../test/support/executing-attempt-history.js"
import { FixtureTarget } from "../authorities/task-tracker/fixture/target.js"
import { ActiveTaskClaim } from "../authorities/task-tracker/claim-mutation.js"
import { ClaimOwner, ClaimToken } from "../authorities/task-tracker/claim.js"
import { liveJournalTestLayer } from "../coordination/delivery/live-journal-test-layer.js"
import { WorkflowInterpreter, type WorkflowInterpreterService } from "../workflow/interpretation/interpreter.js"
import { WorkflowOperation, makeTaskAttemptPlanOperation } from "../workflow/registry/operation.js"
import { AttemptBasePolicy, TaskAttemptBaseObservation } from "../workflow/protocols/task-attempt-planning/base.js"
import { taskAttemptBaseReadOperationIdFor } from "../workflow/protocols/task-attempt-planning/base-read-identity.js"
import { OperationId } from "../workflow/identity.js"
import { WorkflowRunBeganEvent } from "../workflow/registry/event.js"
import { AcceptedJournalReader } from "./accepted-reader.js"
import { InRunJournal, JournalStorageUnavailable } from "./store.js"
import { journaledWorkflowInterpreterLayer } from "./journaled-interpreter.js"

const runId = RunId.make("qualified-base-journal")
const taskId = TaskId.make("dependant")
const target = FixtureTarget.make("qualified-base-journal")
const anchor = GitCommitSha.make("1".repeat(40))
const selected = GitCommitSha.make("2".repeat(40))
const later = GitCommitSha.make("3".repeat(40))
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
const unused = () => Effect.die("unexpected unrelated boundary")
const provider = (readTaskAttemptBase: WorkflowInterpreterService["readTaskAttemptBase"]) =>
  WorkflowInterpreter.of({
    acquireTaskClaim: unused,
    readTaskClaim: unused,
    readTaskWorkSpecification: unused,
    readTaskWorktree: unused,
    readTargetLineage: unused,
    readTrackerGraph: unused,
    recordTaskAttemptPlan: unused,
    reconcileTaskWorktree: unused,
    releaseTaskClaim: unused,
    readTaskAttemptBase
  })

it.effect("records the Base intent before Git and reuses the selected head after acknowledgement loss", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(liveJournalTestLayer({ runId, target, records: prefix }))
      const journal = Context.get(context, InRunJournal)
      const accepted = Context.get(context, AcceptedJournalReader)
      let reads = 0
      let loseObservationAcknowledgement = true
      let losePlanAcknowledgement = true
      const uncertainJournal = InRunJournal.of({
        ...journal,
        append: (requestedRunId, key, event) =>
          journal.append(requestedRunId, key, event).pipe(
            Effect.flatMap((record) => {
              if (event._tag === "TaskAttemptBaseObserved" && loseObservationAcknowledgement) {
                loseObservationAcknowledgement = false
                return Effect.fail(
                  new JournalStorageUnavailable({
                    detail: "lost observation acknowledgement",
                    operation: "JournalStore.append"
                  })
                )
              }
              if (event._tag === "TaskAttemptPlanned" && losePlanAcknowledgement) {
                losePlanAcknowledgement = false
                return Effect.fail(
                  new JournalStorageUnavailable({
                    detail: "lost plan acknowledgement",
                    operation: "JournalStore.append"
                  })
                )
              }
              return Effect.succeed(record)
            })
          )
      })
      const raw = provider((request) =>
        Effect.gen(function* () {
          reads += 1
          expect(request).toEqual(operation)
          expect(
            Array.from(journalRecordsAfter(yield* accepted.readAccepted(runId).pipe(Effect.orDie), null)).at(-1)?.event
          ).toMatchObject({ _tag: "TaskAttemptBaseReadIntended", operation })
          return TaskAttemptBaseObservation.cases.Qualified.make({ baseSha: selected })
        })
      )
      const open = (implementation: WorkflowInterpreterService) =>
        WorkflowInterpreter.pipe(
          Effect.provide(journaledWorkflowInterpreterLayer(runId, Layer.succeed(WorkflowInterpreter, implementation))),
          Effect.provide(Context.add(context, InRunJournal, uncertainJournal))
        )
      const first = yield* open(raw)
      expect(yield* first.readTaskAttemptBase(operation).pipe(Effect.result)).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "JournalStorageUnavailable" }
      })
      const reopened = yield* open(
        provider(() =>
          Effect.sync(() => {
            reads += 1
            return TaskAttemptBaseObservation.cases.Qualified.make({ baseSha: later })
          })
        )
      )
      expect(yield* reopened.readTaskAttemptBase(operation)).toEqual({ _tag: "Qualified", baseSha: selected })
      expect(reads).toBe(1)
      const selectedPlan = makeTaskAttemptPlanOperation({
        operationId: OperationId.make("qualified-base-plan"),
        plannedAttempt: { ...plan, baseSha: selected },
        predecessorOperationIds: [operation.operationId]
      })
      expect(yield* reopened.recordTaskAttemptPlan(selectedPlan).pipe(Effect.result)).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "JournalStorageUnavailable" }
      })
      const afterPlanCrash = yield* open(raw)
      const acknowledgement = yield* afterPlanCrash.recordTaskAttemptPlan(selectedPlan)
      expect(yield* afterPlanCrash.recordTaskAttemptPlan(selectedPlan)).toEqual(acknowledgement)
      expect(
        yield* reopened
          .recordTaskAttemptPlan({
            ...selectedPlan,
            plannedAttempt: { ...selectedPlan.plannedAttempt, baseSha: later }
          })
          .pipe(Effect.result)
      ).toMatchObject({ _tag: "Failure" })
      expect(
        Array.from(journalRecordsAfter(yield* accepted.readAccepted(runId), null)).filter(
          ({ event }) => event._tag === "TaskAttemptPlanned"
        )
      ).toHaveLength(1)
    })
  )
)

it.effect("reconciles an unobserved Base read using the same intent and records a refusal without a plan", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(liveJournalTestLayer({ runId, target, records: prefix }))
      const first = yield* WorkflowInterpreter.pipe(
        Effect.provide(
          journaledWorkflowInterpreterLayer(
            runId,
            Layer.succeed(
              WorkflowInterpreter,
              provider(() => Effect.die("controlled process loss after intent"))
            )
          )
        ),
        Effect.provide(context)
      )
      yield* first.readTaskAttemptBase(operation).pipe(Effect.exit)
      let reads = 0
      const recovered = yield* WorkflowInterpreter.pipe(
        Effect.provide(
          journaledWorkflowInterpreterLayer(
            runId,
            Layer.succeed(
              WorkflowInterpreter,
              provider((request) =>
                Effect.sync(() => {
                  expect(request.operationId).toBe(operation.operationId)
                  reads += 1
                  return TaskAttemptBaseObservation.cases.Refused.make({
                    boundary: "ExecutionCommit",
                    detail: "head unavailable"
                  })
                })
              )
            )
          )
        ),
        Effect.provide(context)
      )
      expect(yield* recovered.readTaskAttemptBase(operation)).toMatchObject({
        _tag: "Refused",
        boundary: "ExecutionCommit"
      })
      expect(yield* recovered.readTaskAttemptBase(operation)).toMatchObject({ _tag: "Refused" })
      expect(reads).toBe(1)
      const records = Array.from(
        journalRecordsAfter(yield* Context.get(context, AcceptedJournalReader).readAccepted(runId), null)
      )
      expect(records.filter(({ event }) => event._tag === "TaskAttemptBaseReadIntended")).toHaveLength(1)
      expect(records.filter(({ event }) => event._tag === "TaskAttemptBaseObserved")).toHaveLength(1)
      expect(
        records.some(
          ({ event }) => event._tag === "TaskAttemptPlanned" || event._tag === "TaskWorktreeReconciliationIntended"
        )
      ).toBe(false)
    })
  )
)

it.effect("retains the Base intent without an observation when stopped Git custody is unproven", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const context = yield* Layer.build(liveJournalTestLayer({ runId, target, records: prefix }))
      const interpreter = yield* WorkflowInterpreter.pipe(
        Effect.provide(
          journaledWorkflowInterpreterLayer(
            runId,
            Layer.succeed(
              WorkflowInterpreter,
              provider(() => Effect.fail(new GitTaskAttemptBaseUnsettled({ reason: "SenderStopUnproven" })))
            )
          )
        ),
        Effect.provide(context)
      )
      expect(yield* interpreter.readTaskAttemptBase(operation).pipe(Effect.result)).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "GitTaskAttemptBaseUnsettled", reason: "SenderStopUnproven" }
      })
      const records = Array.from(
        journalRecordsAfter(yield* Context.get(context, AcceptedJournalReader).readAccepted(runId), null)
      )
      expect(records.filter(({ event }) => event._tag === "TaskAttemptBaseReadIntended")).toHaveLength(1)
      expect(
        records.some(({ event }) => event._tag === "TaskAttemptBaseObserved" || event._tag === "TaskAttemptPlanned")
      ).toBe(false)
    })
  )
)
