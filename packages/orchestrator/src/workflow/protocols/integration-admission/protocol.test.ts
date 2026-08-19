import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { GitRepositoryLocator, IntegrationTarget, IntegrationTargetRef } from "@dalph/contracts"
import { integrationFinalityFixture } from "../integration-finality/fixtures.js"
import {
  AcceptedResultNotDurable,
  IntegrationTargetSelection,
  QueuedIntegrationResponsibility,
  StartedIntegrationResponsibility,
  deriveUnqueuedAcceptedResults,
  integrationTargetSelectionLayer,
  queueAcceptedResultIntegrationResponsibility,
  selectStartableIntegrationResponsibilities,
  startQueuedIntegration
} from "./protocol.js"
import { IntegrationResponsibilityBeganEvent } from "./events.js"
import {
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptExecutorWorkResponsibilityBeganEvent
} from "../planned-attempt-executor-work/events.js"
import { JournalPosition, JournalRecordKey } from "../../../workflow-journal/identity.js"
import {
  InRunJournal,
  JournalRecord,
  type JournalRecord as JournalRecordType
} from "../../../workflow-journal/store.js"
import { workflowJournalEventVersion } from "../../kernel/event.js"
import { acceptedResultEquivalence } from "./responsibility.js"

const fixture = integrationFinalityFixture

const journalWith = (records: ReadonlyArray<JournalRecordType>): InRunJournal["Service"] => ({
  append: (_runId, _key, event) =>
    Effect.succeed({
      event,
      key: JournalRecordKey.make("appended"),
      position: JournalPosition.make(records.length + 1),
      runId: fixture.runId
    }),
  read: (_runId) => Effect.succeed(records)
})

const queued = (queuedAt: number): QueuedIntegrationResponsibility =>
  QueuedIntegrationResponsibility.make({
    acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
    integrationTarget: fixture.integrationTarget,
    plannedAttempt: fixture.plannedAttempt,
    preIntegrationCancellation: {
      attemptId: fixture.plannedAttempt.attemptId,
      queuedAt: JournalPosition.make(queuedAt),
      runId: fixture.runId
    },
    queuedAt: JournalPosition.make(queuedAt)
  })

it.effect("provides the exact configured integration target to the settlement runtime", () =>
  Effect.gen(function* () {
    expect(yield* IntegrationTargetSelection).toEqual(fixture.integrationTarget)
  }).pipe(Effect.provide(integrationTargetSelectionLayer(fixture.integrationTarget)))
)

it.effect("rejects queue admission until the exact accepted executor result is durable", () =>
  Effect.gen(function* () {
    const failure = yield* queueAcceptedResultIntegrationResponsibility(
      fixture.plannedAttempt,
      fixture.qualifiedCandidate.run.session.acceptedResult,
      fixture.integrationTarget
    ).pipe(Effect.provideService(InRunJournal, journalWith([])), Effect.flip)

    expect(failure).toEqual(
      new AcceptedResultNotDurable({ attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId })
    )
  })
)

it.effect("crosses the integration cutoff once for an exact queued responsibility", () =>
  Effect.gen(function* () {
    const responsibility = queued(4)
    const started = yield* startQueuedIntegration(responsibility).pipe(
      Effect.provideService(InRunJournal, journalWith([]))
    )

    expect(started).toEqual(
      StartedIntegrationResponsibility.make({
        acceptedResult: responsibility.acceptedResult,
        integrationTarget: responsibility.integrationTarget,
        plannedAttempt: responsibility.plannedAttempt,
        queuedAt: responsibility.queuedAt,
        startedAt: JournalPosition.make(1)
      })
    )
  })
)

it("selects only the first queued responsibility for each integration target", () => {
  const first = queued(2)
  const second = queued(3)
  const otherTarget = QueuedIntegrationResponsibility.make({
    ...second,
    integrationTarget: IntegrationTarget.make({
      ref: IntegrationTargetRef.make("refs/heads/main"),
      repository: GitRepositoryLocator.make("/repositories/other.git")
    })
  })
  const started = StartedIntegrationResponsibility.make({
    acceptedResult: first.acceptedResult,
    integrationTarget: first.integrationTarget,
    plannedAttempt: first.plannedAttempt,
    queuedAt: first.queuedAt,
    startedAt: JournalPosition.make(4)
  })

  expect(selectStartableIntegrationResponsibilities({ responsibilities: [first, second, otherTarget] })).toEqual([
    first,
    otherTarget
  ])
  expect(selectStartableIntegrationResponsibilities({ responsibilities: [started, second, otherTarget] })).toEqual([
    otherTarget
  ])
})

it("derives one unqueued accepted result from matching executor responsibility and terminal report", () => {
  const responsibility = JournalRecord.make({
    event: PlannedAttemptExecutorWorkResponsibilityBeganEvent.make({
      plannedAttempt: fixture.plannedAttempt,
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make("responsibility"),
    position: JournalPosition.make(1),
    runId: fixture.runId
  })
  const report = JournalRecord.make({
    event: PlannedAttemptExecutorWorkReportedEvent.make({
      ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
      report: {
        _tag: "Terminal",
        correlation: { attemptId: fixture.plannedAttempt.attemptId, runId: fixture.runId },
        result: { _tag: "Accepted", acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult }
      },
      version: workflowJournalEventVersion
    }),
    key: JournalRecordKey.make("accepted"),
    position: JournalPosition.make(2),
    runId: fixture.runId
  })

  const [result] = deriveUnqueuedAcceptedResults([responsibility, report])
  expect(result).toBeDefined()
  expect(result?.plannedAttempt).toEqual(fixture.plannedAttempt)
  expect(
    result === undefined
      ? false
      : acceptedResultEquivalence(result.acceptedResult, fixture.qualifiedCandidate.run.session.acceptedResult)
  ).toBe(true)
})

it("retains the journal event shape used for queued responsibility", () => {
  const event = IntegrationResponsibilityBeganEvent.make({
    acceptedResult: fixture.qualifiedCandidate.run.session.acceptedResult,
    integrationTarget: fixture.integrationTarget,
    plannedAttempt: fixture.plannedAttempt,
    version: workflowJournalEventVersion
  })
  expect(event._tag).toBe("IntegrationResponsibilityBegan")
})
