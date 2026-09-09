import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { issue275ActiveGraphRefreshCassetteCatalog } from "../../test-support/issue-275-active-graph-refresh-cassette.js"

it.effect("observes F and G without admitting either while B C and D retain every exact position", () =>
  Effect.gen(function* () {
    const result = yield* issue275ActiveGraphRefreshCassetteCatalog.issue275ActiveGraphRefresh.run
    expect(result.maximumGraphReads).toBe(1)
    expect(result.graphReads).toBe(1)
    expect(result.sources).toHaveLength(1)
    const before = result.before.publications.at(-1)
    if (before?.publication.graph._tag !== "GraphEstablished") return expect.fail("missing initial G4")
    expect(before.publication.graph.observation.snapshot.taskIds()).toEqual(["A", "B", "C", "D", "E"])
    expect(
      before.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId).toSorted()
    ).toEqual(["attempt:B:1", "attempt:C:1", "attempt:D:1"])
    const suffix = result.after.records.slice(result.before.records.length)
    const intents = suffix.flatMap(({ event, position }) =>
      event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTrackerGraph"
        ? [{ operation: event.operation, position }]
        : []
    )
    expect(intents.map(({ operation }) => operation.cause._tag)).toEqual(["ExecutingWorkAuthorityCheck"])
    expect(new Set(intents.map(({ operation }) => operation.operationId)).size).toBe(1)
    const intent = intents[0]
    if (intent === undefined) return expect.fail("missing exact G5 intent")
    const observation = suffix.find(
      ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === intent.operation.operationId
    )
    if (
      observation?.event._tag !== "TaskTrackerFactsObserved" ||
      observation.event.observation._tag !== "CompleteTaskTrackerFacts"
    )
      return expect.fail("missing exact complete G5 outcome")
    expect(observation.position).toBeGreaterThan(intent.position)
    expect(observation.event.observation.factFamilies[0].taskIds).toEqual(["A", "B", "C", "D", "E", "F", "G"])
    for (const attemptId of ["attempt:B:1", "attempt:C:1", "attempt:D:1"]) {
      const report = result.before.records.findLast(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === attemptId
      )
      if (report?.event._tag !== "PlannedAttemptExecutorWorkReported") return expect.fail("missing exact held report")
      expect(report.event.report._tag).toBe("ExecutorWorkExecuting")
      expect(report.position).toBeLessThan(intent.position)
    }
    expect(suffix.filter(({ event }) => event._tag === "WorkflowRunTerminated")).toEqual([])
    expect(suffix.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toEqual([])
    expect(result.after.commands).toEqual(result.before.commands)
    expect(result.after.claimRequests).toEqual(result.before.claimRequests)
    expect(result.after.plans).toEqual(result.before.plans)
    expect(result.after.worktreeCreateRequests).toEqual(result.before.worktreeCreateRequests)
    const final = result.after.publications.at(-1)
    if (final?.publication.graph._tag !== "GraphEstablished") return expect.fail("missing accepted G5")
    expect(final.publication.graph.observation.snapshot.revision).toBe("G5")
    expect(final.publication.graph.observation.snapshot.taskIds()).toEqual(["A", "B", "C", "D", "E", "F", "G"])
    for (const publication of result.after.publications.slice(result.before.publications.length)) {
      expect(publication.actionInputs.runtimeFacts.taskWork.capacity).toBe(3)
      expect(
        publication.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId).toSorted()
      ).toEqual(["attempt:B:1", "attempt:C:1", "attempt:D:1"])
    }
    expect(
      suffix.some(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "TaskTrackerFactsReadFailed"
      )
    ).toBe(false)
  })
)
