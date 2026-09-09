import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  evaluatePlannedAttemptContinuationAuthorization,
  evaluateDeliveryRuntimeInputBundle,
  reduceWorkflowJournalHistory
} from "@dalph/orchestrator"
import {
  issue274RetainedCCassetteCatalog,
  runIssue274RetainedCCassette
} from "../../test-support/issue-274-retained-c-cassette.js"
import { issue268ControlledDeliveryCharacterization as scenario } from "../../test-support/issue-268-controlled-characterization-catalog.js"
import { runIssue274CrashCheckpoint } from "../../test-support/issue-268-controlled-characterization.js"

it.effect(
  "reopens C and resumes its original attempt only after accepted capacity three",
  () =>
    Effect.gen(function* () {
      const result = yield* runIssue274RetainedCCassette(issue274RetainedCCassetteCatalog.issue274LifecycleReopen)
      expect(result.reopened.actionInputs.runtimeFacts.taskWork.capacity).toBe(scenario.policies.P2)
      expect(
        result.beforeCapacity.commands.filter(
          ({ attemptId, command }) => attemptId === scenario.attempts.C1 && command === "Resume"
        )
      ).toEqual([])
      const beforeCapacitySuffix = result.beforeCapacity.records.slice(result.retained.length)
      expect(
        beforeCapacitySuffix.filter(({ event }) => {
          if (event._tag === "GitReadIntentRecorded")
            return event.operation.plannedAttempt.attemptId === scenario.attempts.C1
          if (event._tag !== "TaskTrackerReadIntentRecorded") return false
          return (
            (event.operation._tag === "ReadTaskWorkSpecification" || event.operation._tag === "ReadTaskClaim") &&
            event.operation.taskId === scenario.taskIds.C
          )
        })
      ).toEqual([])
      expect(
        result.after.commands.filter(
          ({ attemptId, command }) => attemptId === scenario.attempts.C1 && command === "Resume"
        )
      ).toHaveLength(1)
      expect(result.policy.taskExecutionCapacity).toBe(scenario.policies.P1.taskExecutionCapacity)
      expect(result.policy.revision).toBe(3)
      expect(result.resumed).toBeDefined()
      expect(
        result.after.records
          .slice(result.retained.length)
          .some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkReported" &&
              event.report._tag === "ExecutorWorkExecuting" &&
              event.report.correlation.runId === scenario.runId &&
              event.report.correlation.attemptId === scenario.attempts.C1
          )
      ).toBe(true)
      expect(
        result.after.publications
          .at(-1)
          ?.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId)
          .toSorted()
      ).toEqual([scenario.attempts.B1, scenario.attempts.C1, scenario.attempts.D1])
      expect(result.after.plans).toEqual(result.beforeCapacity.plans)
      expect(result.after.worktreeCreateRequests).toEqual(result.beforeCapacity.worktreeCreateRequests)
      expect(result.after.claimRequests).toEqual([])
      expect(result.resourcesAfter).toEqual(result.resourcesBefore)
      expect(result.resourcesBefore.wip).toEqual({
        plan: result.resourcesBefore.plan,
        bytes: `unfinished private edits for ${scenario.attempts.C1}\n`
      })
      expect(result.resourcesBefore.claim).toMatchObject({ _tag: "ActiveTaskClaim", taskId: scenario.taskIds.C })
      expect(result.resourcesBefore.worktree).toMatchObject({
        _tag: "PlannedWorktreeReady",
        worktree: result.resourcesBefore.plan.worktree
      })
      const runtime = yield* evaluateDeliveryRuntimeInputBundle(result.reopened)
      expect(runtime.taskWork.held.map(({ correlation }) => correlation.attemptId).toSorted()).toEqual([
        scenario.attempts.B1,
        scenario.attempts.D1
      ])
      const suffix = result.after.records.slice(result.retained.length)
      expect(suffix.filter(({ event }) => event._tag === "ControlDirectionApplied")).toEqual([])
      expect(suffix.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toEqual([])
      const authorization = suffix.find(
        ({ event }) =>
          event._tag === "PlannedAttemptContinuationAuthorized" &&
          event.plannedAttempt.attemptId === scenario.attempts.C1
      )
      const resumeIntent = suffix.find(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Resume"
      )
      if (
        authorization?.event._tag !== "PlannedAttemptContinuationAuthorized" ||
        resumeIntent?.event._tag !== "PlannedAttemptExecutorCommandIntended"
      )
        return expect.fail("expected exact C authorization and Resume intent")
      const originalPlan = result.retained.find(
        ({ event }) =>
          event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.attemptId === scenario.attempts.C1
      )
      if (originalPlan?.event._tag !== "TaskAttemptPlanned") return expect.fail("expected original C plan")
      expect(resumeIntent.event.plannedAttempt).toEqual(originalPlan.event.operation.plannedAttempt)
      expect(resumeIntent.position).toBeGreaterThan(authorization.position)
      const witness = authorization.event.witness
      const witnessIds = [
        witness.activeTaskContinuationRead.graphObservationOperationId,
        witness.activeTaskContinuationRead.taskWorkSpecificationObservationOperationId,
        witness.activeTaskContinuationRead.taskClaimObservationOperationId,
        witness.worktreeObservationOperationId,
        witness.targetLineageObservationOperationId
      ]
      const facts = witnessIds.map((id) =>
        suffix.find(
          ({ event }) =>
            "operationId" in event &&
            event.operationId === id &&
            ["TaskTrackerFactsObserved", "PlannedAttemptWorktreeObserved", "TargetLineageObserved"].includes(event._tag)
        )
      )
      expect(facts.every((record) => record !== undefined && record.position < authorization.position)).toBe(true)
      const factPositions = facts.flatMap((record) => (record === undefined ? [] : [record.position]))
      expect(factPositions).toEqual(factPositions.toSorted((left, right) => left - right))
      const beforeAuthorization = result.after.records.filter(({ position }) => position < authorization.position)
      expect(
        evaluatePlannedAttemptContinuationAuthorization(
          beforeAuthorization,
          originalPlan.event.operation.plannedAttempt,
          witness
        )
      ).toEqual({ _tag: "Authorized" })
      for (const fact of facts) {
        if (fact === undefined) return expect.fail("missing exact fact")
        expect(
          evaluatePlannedAttemptContinuationAuthorization(
            beforeAuthorization.filter(({ position }) => position !== fact.position),
            originalPlan.event.operation.plannedAttempt,
            witness
          )._tag
        ).toBe("Rejected")
      }
    }),
  120_000
)

for (const checkpoint of [
  "G4",
  "Capacity",
  "Reservation",
  "Specification",
  "Claim",
  "Worktree",
  "Lineage",
  "Authorization",
  "ResumeIntent"
] as const) {
  it.effect(
    `recovers the real ${checkpoint} crash before resuming exactly retained C1`,
    () =>
      Effect.gen(function* () {
        const result = yield* runIssue274CrashCheckpoint(checkpoint)
        expect(result.cut).toBeDefined()
        expect(result.before.commands).toEqual([])
        expect(result.waiting?.commands ?? []).toEqual([])
        if (checkpoint === "G4") {
          expect(result.reopened?.actionInputs.runtimeFacts.taskWork.capacity).toEqual(scenario.policies.P2)
          expect(
            result.reopened?.actionInputs.runtimeFacts.taskWork.held
              .map(({ correlation }) => correlation.attemptId)
              .toSorted()
          ).toEqual([scenario.attempts.B1, scenario.attempts.D1])
        }
        expect(result.after.commands).toEqual([{ attemptId: scenario.attempts.C1, command: "Resume" }])
        expect(result.after.plans).toEqual([])
        expect(result.after.claimRequests).toEqual([])
        expect(result.after.worktreeCreateRequests).toEqual(result.before.worktreeCreateRequests)
        const original = result.retained.find(
          ({ event }) =>
            event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.attemptId === scenario.attempts.C1
        )
        if (original?.event._tag !== "TaskAttemptPlanned") return expect.fail("missing original C1")
        const suffix = result.after.records.slice(result.before.records.length)
        const resume = (checkpoint === "ResumeIntent" ? result.before.records : suffix).findLast(
          ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Resume"
        )
        if (resume?.event._tag !== "PlannedAttemptExecutorCommandIntended")
          return expect.fail("missing recovered Resume")
        expect(resume.event.plannedAttempt).toEqual(original.event.operation.plannedAttempt)
        expect(suffix.filter(({ event }) => event._tag === "TaskAttemptPlanned")).toEqual([])
        expect(
          suffix.some(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorWorkReported" &&
              event.report._tag === "ExecutorWorkExecuting" &&
              event.report.correlation.attemptId === scenario.attempts.C1
          )
        ).toBe(true)
        if (checkpoint === "ResumeIntent") {
          const projection = suffix.find(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
              event.plannedAttempt.attemptId === scenario.attempts.C1
          )
          expect(projection).toBeDefined()
          const redelivery = suffix.find(({ event }) => event._tag === "PlannedAttemptExecutorResumeRedeliveryIntended")
          if (redelivery?.event._tag !== "PlannedAttemptExecutorResumeRedeliveryIntended")
            return expect.fail("missing exact Resume redelivery intent")
          expect(redelivery.event.commandOrdinal).toBe(resume.event.ordinal)
          expect(redelivery.event.plannedAttempt).toEqual(original.event.operation.plannedAttempt)
          expect(projection?.position).toBeLessThan(redelivery.position)
          expect(suffix.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toEqual([])
        }
      }),
    120_000
  )
}

it.effect(
  "preserves Alice's independently applied Pause when G4 reopens C even at capacity three",
  () =>
    Effect.gen(function* () {
      const result = yield* runIssue274CrashCheckpoint("Pause")
      expect(
        result.retained.some(
          ({ event }) =>
            event._tag === "ControlDirectionApplied" &&
            event.direction === "Pause" &&
            event.subject._tag === "Task" &&
            event.subject.taskId === scenario.taskIds.C
        )
      ).toBe(true)
      expect(result.before.commands).toEqual([])
      expect(result.after.commands).toEqual([])
      expect(result.after.plans).toEqual([])
      expect(result.after.claimRequests).toEqual([])
      expect(result.resourcesAfter).toEqual(result.resourcesBefore)
      expect(result.resourcesBefore.wip).toEqual({
        plan: result.resourcesBefore.plan,
        bytes: `unfinished private edits for ${scenario.attempts.C1}\n`
      })
      expect(result.resourcesBefore.claim).toMatchObject({ _tag: "ActiveTaskClaim", taskId: scenario.taskIds.C })
      expect(result.resourcesBefore.worktree).toMatchObject({
        _tag: "PlannedWorktreeReady",
        worktree: result.resourcesBefore.plan.worktree
      })
      expect(result.after.worktreeCreateRequests).toEqual(result.before.worktreeCreateRequests)
      expect(
        result.after.records
          .slice(result.retained.length)
          .filter(({ event }) => event._tag === "ControlDirectionApplied")
      ).toEqual([])
      expect(result.after.publications.at(-1)?.actionInputs.runtimeFacts.taskWork.capacity).toBe(3)
      expect(
        result.after.publications
          .at(-1)
          ?.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId)
          .toSorted()
      ).toEqual([scenario.attempts.B1, scenario.attempts.D1])
    }),
  120_000
)

it.effect(
  "reconciles C's lost Resume response after restart without another Begin or Resume",
  () =>
    Effect.gen(function* () {
      const result = yield* runIssue274RetainedCCassette(issue274RetainedCCassetteCatalog.issue274LostResumeResponse)
      expect(result.after.commands).toEqual([{ attemptId: scenario.attempts.C1, command: "Resume" }])
      expect(result.recovered).toBeDefined()
      expect(result.recovered?.commands).toEqual([])
      expect(result.recovered?.plans).toEqual([])
      expect(result.recovered?.worktreeCreateRequests).toEqual(result.after.worktreeCreateRequests)
      if (result.recovered === undefined) return expect.fail("expected recovered C")
      const intent = result.after.records.findLast(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandIntended" &&
          event.command === "Resume" &&
          event.plannedAttempt.attemptId === scenario.attempts.C1
      )
      if (intent?.event._tag !== "PlannedAttemptExecutorCommandIntended")
        return expect.fail("expected unresolved C Resume")
      expect(
        result.after.records.filter(
          ({ event, position }) =>
            position > intent.position && event._tag === "PlannedAttemptExecutorCommandResponseObserved"
        )
      ).toEqual([])
      const recoverySuffix = result.recovered.records.slice(result.after.records.length)
      const projection = recoverySuffix.find(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandProjectionObserved" &&
          event.plannedAttempt.attemptId === scenario.attempts.C1
      )
      if (projection?.event._tag !== "PlannedAttemptExecutorCommandProjectionObserved")
        return expect.fail("expected exact executor reread")
      expect(projection.event.commandOrdinal).toBe(intent.event.ordinal)
      expect(projection.event.plannedAttempt).toEqual(intent.event.plannedAttempt)
      expect(projection.event.observation).toMatchObject({
        _tag: "ExactExecutorReport",
        report: {
          _tag: "ExecutorWorkExecuting",
          correlation: { runId: scenario.runId, attemptId: scenario.attempts.C1 }
        }
      })
      expect(recoverySuffix.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toEqual([])
      expect(reduceWorkflowJournalHistory(scenario.runId, result.recovered.records)._tag).toBe(
        "ValidWorkflowJournalHistory"
      )
    }),
  120_000
)
