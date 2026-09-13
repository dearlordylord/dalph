import { expect } from "vitest"
import { Chunk, Effect } from "effect"
import {
  deliveryStatusOf,
  evaluateDeliveryRelationAndRuntimeInputBundle,
  type JournalRecord
} from "@dalph/orchestrator"
import {
  type AuthoredObservationCapture,
  type AuthoredScenarioCassetteRun
} from "../../src/cassettes/authored-runner.js"
import {
  afterFence,
  assertReopenedCapacityWait,
  assertSettledActionReleased,
  attempts,
  beforeFence,
  changedHead,
  coherentFor,
  DS,
  type DeliveryCapstoneCheckpoint,
  expectedPairs,
  executorStanding,
  frameFor,
  loweredCapacity,
  occurrenceFence,
  pair,
  predecessorHead,
  type Publication,
  recordFence,
  requireValue,
  sortPairs
} from "./delivery-capstone-checkpoint-boundaries.test-support.js"
import { rowsFor } from "./delivery-capstone-checkpoint-rows.test-support.js"
import { normalizeDeclaredIntegratorSession } from "./delivery-capstone-authored-correlations.test-support.js"
import {
  assertDeliveryCapstoneJournalCheckpoint,
  isDeliveryCapstoneJournalBeat,
  type DeliveryCapstoneJournalCheckpoint
} from "./delivery-capstone-journal-checkpoints.test-support.js"
export type { DeliveryCapstoneCheckpoint } from "./delivery-capstone-checkpoint-boundaries.test-support.js"
const unavailableCheckpoint = (
  run: AuthoredScenarioCassetteRun,
  preserved: DeliveryCapstoneJournalCheckpoint
): Extract<DeliveryCapstoneCheckpoint, { readonly process: "Unavailable" }> => {
  const death = occurrenceFence(run, (item) => item._tag === "CoordinatorProcessDies")
  if (death.kind !== "Occurrence") return expect.fail("DS08: missing exact process death")
  const next = requireValue(
    run.observationCaptures.find(
      (item) =>
        item.captureOrder > death.capture.captureOrder && item.activationOrdinal > death.capture.activationOrdinal
    ),
    `DS08: replacement activation missing; windows=${JSON.stringify(deliveryCapstoneCheckpointWindowInventory(run))}`
  )
  const closedOwners = requireValue(
    run.observationCaptures.find(
      (item): item is Extract<AuthoredObservationCapture, { readonly _tag: "DeliveryRuntimeOwnersCaptured" }> =>
        item._tag === "DeliveryRuntimeOwnersCaptured" &&
        item.captureOrder > death.capture.captureOrder &&
        item.captureOrder < next.captureOrder &&
        item.liveOwners.length === 0
    ),
    `DS08: owner-close interval missing; windows=${JSON.stringify(deliveryCapstoneCheckpointWindowInventory(run))}`
  )
  expect(preserved.beat).toBe(DS.lowered)
  return { beat: DS.unavailable, process: "Unavailable", death: death.capture, closedOwners, preserved }
}
export const deliveryCapstoneCheckpointWindowInventory = (run: AuthoredScenarioCassetteRun) => {
  const rows = rowsFor(run).map((row) => {
    const captures = run.observationCaptures.filter(
      (capture): capture is Publication =>
        capture._tag === "DeliveryPublicationCaptured" &&
        afterFence(capture, row.after) &&
        beforeFence(capture, row.before)
    )
    const coherent = captures.filter((capture) => coherentFor(run, capture))
    const first = coherent[0]
    const frame = first === undefined ? undefined : frameFor(run, first)
    return {
      beat: row.beat,
      lower:
        row.after.kind === "Journal"
          ? { journal: row.after.record.position }
          : { capture: row.after.capture.captureOrder },
      upper:
        row.before.kind === "Journal"
          ? { journal: row.before.record.position }
          : { capture: row.before.capture.captureOrder },
      captures: captures.length,
      coherent: coherent.length,
      first:
        frame === undefined
          ? null
          : {
              acceptedAt: frame.acceptedAt,
              graph:
                frame.graph._tag === "Established"
                  ? { revision: frame.graph.revision, observation: frame.graph.observation }
                  : null,
              capacity: frame.capacity,
              held: frame.heldPositions
            }
    }
  })
  const death = run.observationCaptures.find(
    (capture) =>
      capture._tag === "AuthoredStoryOccurrenceCaptured" && capture.occurrence._tag === "CoordinatorProcessDies"
  )
  const next =
    death === undefined
      ? undefined
      : run.observationCaptures.find(
          (capture) => capture.captureOrder > death.captureOrder && capture.activationOrdinal > death.activationOrdinal
        )
  const owners = run.observationCaptures.filter(
    (capture): capture is Extract<AuthoredObservationCapture, { readonly _tag: "DeliveryRuntimeOwnersCaptured" }> =>
      capture._tag === "DeliveryRuntimeOwnersCaptured" &&
      death !== undefined &&
      next !== undefined &&
      capture.captureOrder > death.captureOrder &&
      capture.captureOrder < next.captureOrder
  )
  return {
    rows,
    unavailable: {
      beat: DS.unavailable,
      lower: death?.captureOrder,
      upper: next?.captureOrder,
      captures: owners.length,
      empty: owners.filter((capture) => capture.liveOwners.length === 0).length,
      first: owners[0] ?? null
    }
  }
}
export const assertDeliveryCapstoneCheckpoints = Effect.fn("Test.assertDeliveryCapstoneCheckpoints")(function* (
  run: AuthoredScenarioCassetteRun
) {
  const publications = run.observationCaptures.filter(
    (capture): capture is Publication => capture._tag === "DeliveryPublicationCaptured"
  )
  const inventory = deliveryCapstoneCheckpointWindowInventory(run)
  let checkpoints = Chunk.empty<DeliveryCapstoneCheckpoint>()
  let previousOrder = 0
  let previousJournalPosition: JournalRecord["position"] | null = null
  for (const row of rowsFor(run)) {
    if (isDeliveryCapstoneJournalBeat(row.beat)) {
      if (row.after.kind !== "Journal") return expect.fail(`DS${row.beat}: transient lower fence is not journal-backed`)
      const checkpoint = assertDeliveryCapstoneJournalCheckpoint(run, { ...row, after: row.after, beat: row.beat })
      if (previousJournalPosition !== null)
        expect(checkpoint.cursor.position, `DS${row.beat}: journal chronology`).toBeGreaterThanOrEqual(
          previousJournalPosition
        )
      previousJournalPosition = checkpoint.cursor.position
      checkpoints = Chunk.append(checkpoints, checkpoint)
      if (row.beat === DS.reopenedC) assertReopenedCapacityWait(run, checkpoint.cursor)
      if (row.beat === DS.lowered) {
        const unavailable = unavailableCheckpoint(run, checkpoint)
        expect(unavailable.death.captureOrder).toBeGreaterThan(previousOrder)
        checkpoints = Chunk.append(checkpoints, unavailable)
        previousOrder = unavailable.closedOwners.captureOrder
      }
      continue
    }
    const capture = requireValue(
      publications.find(
        (publication) =>
          afterFence(publication, row.after) && beforeFence(publication, row.before) && coherentFor(run, publication)
      ),
      `DS${row.beat}: no coherent publication inside its exact boundary interval; windows=${JSON.stringify(inventory)}`
    )
    expect(capture.captureOrder, `DS${row.beat}: chronology`).toBeGreaterThan(previousOrder)
    const frame = frameFor(run, capture)
    if (frame.acceptedAt === null) return expect.fail(`DS${row.beat}: publication has no accepted journal coordinate`)
    if (previousJournalPosition !== null)
      expect(frame.acceptedAt, `DS${row.beat}: journal chronology`).toBeGreaterThanOrEqual(previousJournalPosition)
    previousJournalPosition = frame.acceptedAt
    expect(frame.graph).toMatchObject({ _tag: "Established", revision: row.graph })
    expect(frame.capacity).toBe(row.capacity)
    expect(sortPairs(frame.heldPositions)).toEqual(sortPairs(expectedPairs(run, row.held)))
    if (frame.graph._tag !== "Established") return expect.fail(`DS${row.beat}: graph not established`)
    const graph = frame.graph
    const graphRecord = requireValue(
      run.records.find(({ position }) => position === graph.observation.recordedAt),
      `DS${row.beat}: graph observation absent`
    )
    expect(graphRecord.event).toMatchObject({
      _tag: "TaskTrackerFactsObserved",
      operationId: graph.observation.operationId
    })
    expect(graph.observation.recordedAt).toBeLessThanOrEqual(Number(frame.acceptedAt))
    for (const task of [...row.held, ...row.retained]) {
      const accepted = requireValue(
        run.records.findLast(
          (record) =>
            Number(record.position) <= Number(frame.acceptedAt) &&
            record.event._tag === "PlannedAttemptExecutorWorkReported" &&
            record.event.report.correlation.attemptId === attempts[task] &&
            record.event.report.correlation.runId === run.runId
        ),
        `DS${row.beat}: missing accepted ${task} executor lifecycle`
      )
      if (accepted.event._tag !== "PlannedAttemptExecutorWorkReported")
        return expect.fail("executor lifecycle anchor changed")
      expect(accepted.event.report._tag).toBe(
        row.held.includes(task)
          ? "ExecutorWorkExecuting"
          : task === "A"
            ? "ExecutorWorkTerminal"
            : "ExecutorWorkSafelySuspended"
      )
    }
    const { consequences, runtime } = yield* evaluateDeliveryRelationAndRuntimeInputBundle(capture.publication.bundle)
    const exactAttempts = consequences.ticketDeliveries.deliveries.flatMap(({ obligations }) =>
      obligations.flatMap((obligation) => {
        if (obligation._tag === "AcceptedAwaitingIntegration") return [obligation.accepted.plannedAttempt]
        if (obligation._tag !== "WorkflowResponsibility") return [obligation.responsibility.plannedAttempt]
        return obligation.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility"
          ? [obligation.responsibility.plannedAttempt]
          : []
      })
    )
    const retained = [
      ...new Map(
        exactAttempts
          .filter(
            (attempt) =>
              !frame.heldPositions.some((held) => held.attemptId === attempt.attemptId && held.runId === attempt.runId)
          )
          .map((attempt) => [attempt.attemptId, pair(attempt)])
      ).values()
    ]
    expect(sortPairs(retained), `DS${row.beat}: retained attempts`).toEqual(sortPairs(expectedPairs(run, row.retained)))
    for (const task of row.alice) {
      const delivery = requireValue(
        consequences.ticketDeliveries.deliveries.find(({ taskId }) => taskId === task),
        `DS${row.beat}: missing ${task} delivery`
      )
      const disposition = executorStanding(delivery.standings, run, task)
      expect(disposition.facts.disposition._tag).toBe("TaskSpecificationChangeConstraint")
    }
    if (row.closedC !== undefined) {
      expect(frame.graph.tasks.find(({ id }) => id === "C")?.lifecycle).toBe(
        row.closedC ? "TerminalWithoutSuccess" : "Open"
      )
      const delivery = requireValue(
        consequences.ticketDeliveries.deliveries.find(({ taskId }) => taskId === "C"),
        `DS${row.beat}: missing C delivery`
      )
      const disposition = executorStanding(delivery.standings, run, "C")
      expect(disposition.facts.disposition._tag === "TaskLifecycleConstraint").toBe(row.closedC)
    }
    if (row.beat === DS.continuedB) {
      const moment = requireValue(
        run.observationMoments.find((item) => item.captureOrder === capture.captureOrder),
        "capacity wait has no captured owner view"
      )
      const status = deliveryStatusOf(
        { _tag: "Run", runId: run.runId },
        { _tag: "Ready", evaluation: runtime, liveOwners: moment.liveOwners }
      )
      if (!("_tag" in status) || status._tag !== "DeliveryStatusAvailable")
        return expect.fail(`DS${row.beat}: capacity status unavailable`)
      const wait = requireValue(
        status.entries.find((entry) => entry._tag === "TaskWorkCapacityWait" && entry.taskId === "B"),
        `DS${row.beat}: missing exact B capacity wait`
      )
      expect(wait).toMatchObject({
        _tag: "TaskWorkCapacityWait",
        scope: { runId: run.runId, capacity: loweredCapacity }
      })
      if (wait._tag !== "TaskWorkCapacityWait") return expect.fail("capacity wait anchor changed")
      expect(sortPairs(wait.holders.map(({ correlation, taskId }) => ({ taskId, ...correlation })))).toEqual(
        sortPairs(expectedPairs(run, row.held))
      )
    }
    if (row.beat >= DS.queuedA && row.beat <= DS.staleA) {
      const delivery = requireValue(
        consequences.ticketDeliveries.deliveries.find(({ taskId }) => taskId === "A"),
        "A integration delivery missing"
      )
      const integration = requireValue(
        delivery.standings.find(
          (standing) =>
            (standing._tag === "QueuedIntegration" || standing._tag === "StartedIntegration") &&
            standing.responsibility.plannedAttempt.runId === run.runId &&
            standing.responsibility.plannedAttempt.attemptId === attempts.A
        ),
        `DS${row.beat}: exact A integration responsibility missing`
      )
      if (integration._tag !== "QueuedIntegration" && integration._tag !== "StartedIntegration")
        return expect.fail("integration responsibility anchor changed")
      const began = recordFence(
        run,
        (event) => event._tag === "IntegrationResponsibilityBegan" && event.plannedAttempt.attemptId === attempts.A
      )
      if (began.kind !== "Journal" || began.record.event._tag !== "IntegrationResponsibilityBegan")
        return expect.fail("A queue anchor changed")
      expect(integration.responsibility.queuedAt).toBe(began.record.position)
      expect(integration.responsibility.acceptedResult).toEqual(began.record.event.acceptedResult)
      expect(integration.responsibility.integrationTarget).toEqual(began.record.event.integrationTarget)
      expect(integration._tag).toBe("StartedIntegration")
      const fixed = recordFence(
        run,
        (event) => event._tag === "IntegratorSessionFixed" && event.correlation.plannedAttempt.attemptId === attempts.A
      )
      if (fixed.kind !== "Journal" || fixed.record.event._tag !== "IntegratorSessionFixed")
        return expect.fail("A fixed session anchor changed")
      const session = fixed.record.event.correlation
      expect(session.plannedAttempt).toEqual(integration.responsibility.plannedAttempt)
      expect(session.queuedAt).toBe(integration.responsibility.queuedAt)
      expect(session.acceptedResult).toEqual(integration.responsibility.acceptedResult)
      expect(session.integrationTarget).toEqual(integration.responsibility.integrationTarget)
      if (integration._tag === "StartedIntegration")
        expect(session.startedAt).toBe(integration.responsibility.startedAt)
      const requested = occurrenceFence(
        run,
        (item) =>
          item._tag === "IntegratorRequestReceived" && item.correlation.session.plannedAttempt.attemptId === attempts.A
      )
      if (requested.kind !== "Occurrence" || requested.capture.occurrence._tag !== "IntegratorRequestReceived")
        return expect.fail("A Integrator request anchor changed")
      expect(normalizeDeclaredIntegratorSession(requested.capture.occurrence.correlation.session, run.runId)).toEqual(
        session
      )
      const prepared = requireValue(
        delivery.standings.find(
          (standing) =>
            standing._tag === "IntegratorPreparation" &&
            standing.state._tag === "GitQualifiedPrepared" &&
            standing.state.run.session.plannedAttempt.attemptId === attempts.A
        ),
        "A qualified predecessor standing missing"
      )
      if (prepared._tag !== "IntegratorPreparation" || prepared.state._tag !== "GitQualifiedPrepared")
        return expect.fail("A qualification anchor changed")
      const qualifiedState = prepared.state
      const qualified = recordFence(
        run,
        (event) =>
          event._tag === "IntegratorRunCandidateGitObserved" &&
          event.run.session.plannedAttempt.attemptId === attempts.A &&
          event.run.session.expectedTargetHead === predecessorHead
      )
      if (qualified.kind !== "Journal" || qualified.record.event._tag !== "IntegratorRunCandidateGitObserved")
        return expect.fail("A qualified candidate anchor changed")
      expect(qualifiedState.run).toEqual(qualified.record.event.run)
      expect(qualifiedState.qualifiedAt).toBe(qualified.record.position)
      expect(qualifiedState.candidateText).toBe(qualified.record.event.candidateText)
      if (qualified.record.event.observation._tag !== "Commit") return expect.fail("A qualification lacks commit facts")
      expect(qualifiedState.candidateCommit).toBe(qualified.record.event.observation.commit)
      expect(qualifiedState.observation.directParents).toEqual(qualified.record.event.observation.directParents)
      expect(qualifiedState.observation.directParents).toEqual([predecessorHead, session.acceptedResult.commit])
      expect(qualifiedState.run.session.queuedAt).toBe(integration.responsibility.queuedAt)
      expect(qualifiedState.run.session.expectedTargetHead).toBe(predecessorHead)
      if (integration._tag === "StartedIntegration")
        expect(qualifiedState.run.session.startedAt).toBe(integration.responsibility.startedAt)
      if (row.beat === DS.staleA) {
        const stale = requireValue(
          delivery.standings.find(
            (standing) =>
              standing._tag === "TargetPromotionStale" &&
              standing.state.correlation.qualifiedCandidate.run.session.plannedAttempt.attemptId === attempts.A
          ),
          "A rejected predecessor quarantine standing missing"
        )
        if (stale._tag !== "TargetPromotionStale") return expect.fail("A stale anchor changed")
        expect(stale.state.correlation.qualifiedCandidate).toEqual({
          candidateCommit: qualifiedState.candidateCommit,
          candidateText: qualifiedState.candidateText,
          directParents: qualifiedState.observation.directParents,
          qualifiedAt: qualifiedState.qualifiedAt,
          run: qualifiedState.run
        })
        const rejected = occurrenceFence(
          run,
          (item) =>
            item._tag === "TargetPromotionCompareAndSetReturned" &&
            item.result._tag === "RejectedExpectedHead" &&
            item.request.candidateCommit === qualifiedState.candidateCommit
        )
        if (
          rejected.kind !== "Occurrence" ||
          rejected.capture.occurrence._tag !== "TargetPromotionCompareAndSetReturned"
        )
          return expect.fail("A rejected exact-head offer anchor changed")
        expect(rejected.capture.occurrence.request).toMatchObject({
          candidateCommit: qualifiedState.candidateCommit,
          expectedTargetHead: predecessorHead,
          integrationTarget: session.integrationTarget
        })
        expect(rejected.capture.occurrence.result).toEqual({
          _tag: "RejectedExpectedHead",
          observedHeadSha: changedHead
        })
        expect(stale.state.observation).toEqual({ _tag: "CompareAndSetRejected", observedHeadSha: changedHead })
      }
    }
    checkpoints = Chunk.append(checkpoints, {
      beat: row.beat,
      frame,
      captureOrder:
        row.beat === DS.settled ? assertSettledActionReleased(run, capture).captureOrder : capture.captureOrder
    })
    previousOrder = capture.captureOrder
    if (row.beat === DS.expanded)
      expect(
        frame.frontier
          .filter(({ standing, taskId }) => (taskId === "F" || taskId === "G") && standing === "Eligible")
          .map(({ taskId }) => taskId)
          .toSorted()
      ).toEqual(["F", "G"])
  }
  const orderedCheckpoints = Chunk.toArray(checkpoints)
  expect(orderedCheckpoints.map(({ beat }) => beat)).toEqual(Object.values(DS))
  return orderedCheckpoints
})
