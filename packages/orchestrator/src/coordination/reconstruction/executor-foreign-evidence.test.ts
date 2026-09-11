import { expect, it } from "vitest"
import { AttemptId, RunId, PlannedAttemptExecutorReport, makeTaskWorkSpecification } from "@dalph/contracts"
import { makeExecutingAttemptHistory } from "../../../test/support/executing-attempt-history.js"
import { integrationFinalityFixture } from "../../workflow/protocols/integration-finality/fixtures.js"
import { TaskWorkCapacityChangedEvent } from "../../workflow/registry/event.js"
import { describeJournalEvent } from "../../workflow/registry/event-descriptor.js"
import { workflowJournalEventVersion } from "../../workflow/kernel/event.js"
import {
  PlannedAttemptExecutorCommandIntendedEvent,
  PlannedAttemptExecutorCommandOrdinal,
  PlannedAttemptExecutorCommandProjectionObservedEvent,
  PlannedAttemptExecutorCommandProjectionOrdinal,
  PlannedAttemptExecutorCommandResponseContradictedEvent,
  PlannedAttemptExecutorCommandResponseObservedEvent,
  PlannedAttemptExecutorStateObservedEvent,
  PlannedAttemptExecutorStateObservationOrdinal
} from "../../workflow/protocols/planned-attempt-executor-work/events.js"
import { RunPolicyRevision } from "../../control/policy.js"
import { TaskWorkCapacity } from "../admission/capacity.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import type { JournalRecord } from "../../workflow-journal/store.js"
import { observeJournalRecordSequenceOperations } from "../../workflow-journal/record-sequence.js"
import {
  journalRetainedExecutorResponsibilitySubjects,
  lastJournalRecordForAttemptKind
} from "../../workflow-journal/record-evidence.js"
import {
  advanceWorkflowJournalHistory,
  reduceWorkflowJournalHistory,
  reduceUnindexedWorkflowJournalHistoryForTesting
} from "./history.js"

for (const boundary of ["Begin", "Suspend", "State", "Projection"] as const) {
  it(`retains a foreign-run ${boundary} response as contradiction evidence without accepting its authority`, () => {
    const costs: Array<number> = []
    for (const count of [64, 256]) {
      const fixture = integrationFinalityFixture
      const specification = makeTaskWorkSpecification({
        body: "foreign evidence",
        title: "Foreign evidence",
        taskId: fixture.taskId
      })
      const plannedAttempt = { ...fixture.plannedAttempt, taskRevision: specification.fingerprint }
      const { records: executing } = makeExecutingAttemptHistory({
        activeClaim: fixture.activeClaim,
        plannedAttempt,
        runId: fixture.runId,
        trackerTarget: fixture.target,
        taskSpecification: specification
      })
      const begin = executing.find((record) => record.event._tag === "PlannedAttemptExecutorCommandIntended")
      if (begin === undefined) return expect.fail("fixture must contain Begin")
      const records: Array<JournalRecord> =
        boundary === "Begin" ? executing.filter(({ position }) => position <= begin.position) : [...executing]
      const recordOf = (event: JournalRecord["event"]): JournalRecord => ({
        event,
        key: describeJournalEvent(event).expectedKey,
        position: JournalPosition.make(records.length + 1),
        runId: fixture.runId
      })
      for (let ordinal = 2; ordinal <= count; ordinal += 1) {
        records.push(
          recordOf(
            TaskWorkCapacityChangedEvent.make({
              capacity: TaskWorkCapacity.make(1),
              initiatedBy: { _tag: "Operator" },
              occurrenceClassification: "InitiatedAction",
              previousRevision: RunPolicyRevision.make(ordinal - 1),
              revision: RunPolicyRevision.make(ordinal),
              version: workflowJournalEventVersion
            })
          )
        )
      }
      const commandOrdinal = PlannedAttemptExecutorCommandOrdinal.make(boundary === "Begin" ? 1 : 2)
      if (boundary === "Suspend" || boundary === "Projection")
        records.push(
          recordOf(
            PlannedAttemptExecutorCommandIntendedEvent.make({
              command: "Suspend",
              initiatedBy: { _tag: "DalphCoordinator" },
              occurrenceClassification: "InitiatedAction",
              ordinal: commandOrdinal,
              plannedAttempt,
              version: workflowJournalEventVersion
            })
          )
        )
      const prior = reduceWorkflowJournalHistory(fixture.runId, records)
      if (prior._tag !== "ValidWorkflowJournalHistory") return expect.fail(JSON.stringify(prior.issues))
      const observed = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
        result: { _tag: "Completed" },
        correlation: {
          runId: RunId.make("foreign-evidence-run"),
          attemptId: AttemptId.make("foreign-evidence-attempt")
        }
      })
      const candidate = recordOf(
        boundary === "State"
          ? PlannedAttemptExecutorStateObservedEvent.make({
              observation: { _tag: "ExecutorReportContradiction", observed },
              occurrenceClassification: "NonActionOccurrence",
              ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
              plannedAttempt,
              version: workflowJournalEventVersion
            })
          : boundary === "Projection"
            ? PlannedAttemptExecutorCommandProjectionObservedEvent.make({
                commandOrdinal,
                observation: { _tag: "ExecutorReportContradiction", observed },
                occurrenceClassification: "NonActionOccurrence",
                plannedAttempt,
                projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
                version: workflowJournalEventVersion
              })
            : PlannedAttemptExecutorCommandResponseContradictedEvent.make({
                commandOrdinal,
                observed,
                occurrenceClassification: "NonActionOccurrence",
                plannedAttempt,
                version: workflowJournalEventVersion
              })
      )
      const cold = reduceUnindexedWorkflowJournalHistoryForTesting(fixture.runId, [...records, candidate])
      expect(cold._tag).toBe("ValidWorkflowJournalHistory")
      let visits = 0
      let materializations = 0
      const stop = observeJournalRecordSequenceOperations((operation) => {
        if (operation._tag === "IndexedRecordVisit") visits += 1
        if (operation._tag === "HistoricalMaterialization") materializations += 1
      })
      const warm = (() => {
        try {
          return advanceWorkflowJournalHistory(prior, candidate)
        } finally {
          stop()
        }
      })()
      if (warm._tag !== "ValidWorkflowJournalHistory") return expect.fail(JSON.stringify(warm.issues))
      expect(materializations).toBe(0)
      costs.push(visits)
      expect(Array.from(journalRetainedExecutorResponsibilitySubjects(warm.prefix, fixture.runId))).toEqual(
        Array.from(journalRetainedExecutorResponsibilitySubjects(prior.prefix, fixture.runId))
      )
      expect(
        lastJournalRecordForAttemptKind(warm.prefix, plannedAttempt.attemptId, "PlannedAttemptExecutorWorkReported")
      ).toBe(
        lastJournalRecordForAttemptKind(prior.prefix, plannedAttempt.attemptId, "PlannedAttemptExecutorWorkReported")
      )
      const falseAuthority = recordOf(
        boundary === "State"
          ? PlannedAttemptExecutorStateObservedEvent.make({
              observation: { _tag: "ExactExecutorReport", report: observed },
              occurrenceClassification: "NonActionOccurrence",
              ordinal: PlannedAttemptExecutorStateObservationOrdinal.make(1),
              plannedAttempt,
              version: workflowJournalEventVersion
            })
          : boundary === "Projection"
            ? PlannedAttemptExecutorCommandProjectionObservedEvent.make({
                commandOrdinal,
                observation: { _tag: "ExactExecutorReport", report: observed },
                occurrenceClassification: "NonActionOccurrence",
                plannedAttempt,
                projectionOrdinal: PlannedAttemptExecutorCommandProjectionOrdinal.make(1),
                version: workflowJournalEventVersion
              })
            : PlannedAttemptExecutorCommandResponseObservedEvent.make({
                commandOrdinal,
                report: observed,
                occurrenceClassification: "NonActionOccurrence",
                plannedAttempt,
                version: workflowJournalEventVersion
              })
      )
      expect(advanceWorkflowJournalHistory(prior, falseAuthority)._tag).toBe("InvalidWorkflowJournalHistory")
      expect(reduceUnindexedWorkflowJournalHistoryForTesting(fixture.runId, [...records, falseAuthority])._tag).toBe(
        "InvalidWorkflowJournalHistory"
      )
    }
    expect(costs[0]).toBe(costs[1])
  })
}
