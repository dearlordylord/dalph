import { expect } from "vitest"
import { Effect } from "effect"
import { type PlannedTaskAttempt } from "@dalph/contracts"
import {
  deliveryStatusOf,
  evaluateDeliveryRelationAndRuntimeInputBundle,
  type DeliveryConsequences,
  type JournalRecord,
  type TraceCursor
} from "@dalph/orchestrator"
import { isSafeContinuationRevalidationEligibility } from "../../../orchestrator/src/coordination/frontier/safe-continuation-revalidation-eligibility.js"
import {
  type AuthoredDeliveryFrame,
  type AuthoredObservationCapture,
  type AuthoredScenarioCassetteRun
} from "../../src/cassettes/authored-runner.js"
import { type DeliveryCapstoneJournalCheckpoint } from "./delivery-capstone-journal-checkpoints.test-support.js"
import { assertExactOwnerRemoved } from "./delivery-capstone-owner-removal.test-support.js"

export const tasks = ["A", "B", "C", "D", "E", "F", "G"] as const
export type Task = (typeof tasks)[number]
export const attempts = {
  A: "attempt:A:0",
  B: "attempt:B:2",
  C: "attempt:C:1",
  D: "attempt:D:0",
  E: "attempt:E:0",
  F: "attempt:F:1",
  G: "attempt:G:0"
}
export type Occurrence = Extract<AuthoredObservationCapture, { readonly _tag: "AuthoredStoryOccurrenceCaptured" }>
export type Publication = Extract<AuthoredObservationCapture, { readonly _tag: "DeliveryPublicationCaptured" }>
export type Event = JournalRecord["event"]
export type TicketDeliveryStanding = DeliveryConsequences["ticketDeliveries"]["deliveries"][number]["standings"][number]

export const DS = {
  entry: 1,
  started: 2,
  changedB: 3,
  suspendB: 4,
  suspendedB: 5,
  startedD: 6,
  lowered: 7,
  unavailable: 8,
  recovered: 9,
  suspendC: 10,
  suspendedC: 11,
  continuedB: 12,
  resumedB: 13,
  queuedA: 14,
  qualifiedA: 15,
  staleA: 16,
  settledA: 17,
  reopenedC: 18,
  resumedC: 19,
  expanded: 20,
  startedSuccessors: 21,
  settled: 22
} as const
export const initialCapacity = 3
export const loweredCapacity = 2
export const beginOrdinal = 1
export const suspendOrdinal = 2
export const resumeOrdinal = 3
const gitObjectWidth = 40
export const predecessorHead = "1".repeat(gitObjectWidth)
export const changedHead = "2".repeat(gitObjectWidth)
export type Beat = Exclude<(typeof DS)[keyof typeof DS], typeof DS.unavailable>

/** Exact chronological fences; numbers here compare existing branded journal/capture coordinates. */
export type Fence =
  | { readonly kind: "Journal"; readonly record: JournalRecord }
  | { readonly kind: "Occurrence"; readonly capture: Occurrence }

/** DS08 describes an absent process, not an empty durable responsibility set. */
export type DeliveryCapstoneCheckpoint =
  | DeliveryCapstoneJournalCheckpoint
  | {
      readonly beat: Exclude<Beat, DeliveryCapstoneJournalCheckpoint["beat"]>
      readonly frame: AuthoredDeliveryFrame
      readonly captureOrder: Publication["captureOrder"]
    }
  | {
      readonly beat: typeof DS.unavailable
      readonly process: "Unavailable"
      readonly death: Occurrence
      readonly closedOwners: Extract<AuthoredObservationCapture, { readonly _tag: "DeliveryRuntimeOwnersCaptured" }>
      readonly preserved: DeliveryCapstoneJournalCheckpoint
    }

export const requireValue = <A>(value: A | undefined, detail: string): A => {
  if (value === undefined) return expect.fail(`capstone checkpoint evidence gap: ${detail}`)
  return value
}

/** The authored await seam checks the already latest actual publication, not a later frame. */
const continuationPublication = (run: AuthoredScenarioCassetteRun) => {
  const marker = requireValue(
    run.observationCaptures.find(
      (capture): capture is Occurrence =>
        capture._tag === "AuthoredStoryOccurrenceCaptured" &&
        capture.occurrence._tag === "CassetteAwaitsSafeContinuationRevalidationPublication"
    ),
    "DS18: authored continuation await absent"
  )
  const publication = requireValue(
    run.observationCaptures.findLast(
      (capture): capture is Publication =>
        capture._tag === "DeliveryPublicationCaptured" && capture.captureOrder < marker.captureOrder
    ),
    "DS18: latest actual publication before await absent"
  )
  return { marker, publication }
}

export const continuationPublicationFence = (run: AuthoredScenarioCassetteRun): Fence => {
  const { publication } = continuationPublication(run)
  const acceptedAt = publication.publication.bundle.actionInputs.runtimeFacts.acceptedAt
  return {
    kind: "Journal",
    record: requireValue(
      run.records.find(({ position }) => position === acceptedAt),
      "DS18: latest publication has no exact committed cut"
    )
  }
}

export const assertReopenedCapacityWait = (run: AuthoredScenarioCassetteRun, cursor: TraceCursor) => {
  const { marker, publication } = continuationPublication(run)
  const bundle = publication.publication.bundle
  expect(bundle.actionInputs.runtimeFacts.acceptedAt).toBe(cursor.position)
  expect(publication.activationOrdinal).toBe(marker.activationOrdinal)
  expect(bundle.publication.graph).toMatchObject({ _tag: "GraphEstablished" })
  if (bundle.publication.graph._tag !== "GraphEstablished") return expect.fail("DS18: actual publication graph absent")
  expect(bundle.publication.graph.observation.snapshot.revision).toBe("G4")
  const eligibility = requireValue(
    bundle.actionInputs.runtimeFacts.taskWork.safeContinuationRevalidations.find(
      ({ plannedAttempt }) => plannedAttempt.runId === run.runId && plannedAttempt.attemptId === attempts.C
    ),
    "DS18: exact retained C eligibility absent"
  )
  expect(isSafeContinuationRevalidationEligibility(eligibility)).toBe(true)
  expect(eligibility.basis._tag).toBe("LifecycleReopenAfterAcceptedSafe")
  const moment = requireValue(
    run.observationMoments.find((moment) => moment.captureOrder === publication.captureOrder),
    "DS18: exact owner view absent"
  )
  const { runtime } = Effect.runSync(evaluateDeliveryRelationAndRuntimeInputBundle(bundle))
  const status = deliveryStatusOf(
    { _tag: "Run", runId: run.runId },
    { _tag: "Ready", evaluation: runtime, liveOwners: moment.liveOwners }
  )
  if (!("_tag" in status) || status._tag !== "DeliveryStatusAvailable")
    return expect.fail("DS18: actual capacity status absent")
  const wait = requireValue(
    status.entries.find((entry) => entry._tag === "TaskWorkCapacityWait" && entry.taskId === "C"),
    "DS18: exact C capacity wait absent"
  )
  expect(wait).toMatchObject({ _tag: "TaskWorkCapacityWait", scope: { capacity: loweredCapacity, runId: run.runId } })
  if (wait._tag !== "TaskWorkCapacityWait") return expect.fail("DS18: capacity wait witness changed")
  expect(sortPairs(wait.holders.map(({ correlation, taskId }) => ({ taskId, ...correlation })))).toEqual(
    sortPairs(expectedPairs(run, ["B", "D"]))
  )
}

export const recordFence = (
  run: AuthoredScenarioCassetteRun,
  predicate: (event: Event) => boolean,
  ordinal = 0
): Fence => ({
  kind: "Journal",
  record: requireValue(run.records.filter(({ event }) => predicate(event))[ordinal], "missing exact durable anchor")
})

export const occurrenceFence = (
  run: AuthoredScenarioCassetteRun,
  predicate: (item: Occurrence["occurrence"]) => boolean,
  ordinal = 0
): Fence => ({
  kind: "Occurrence",
  capture: requireValue(
    run.observationCaptures.filter(
      (capture): capture is Occurrence =>
        capture._tag === "AuthoredStoryOccurrenceCaptured" && predicate(capture.occurrence)
    )[ordinal],
    "missing exact authored anchor"
  )
})

export const graphFence = (run: AuthoredScenarioCassetteRun, revision: string, ordinal = 0) =>
  occurrenceFence(run, (item) => item._tag === "TrackerGraphReadReturned" && item.graph.revision === revision, ordinal)

export const commandFence = (run: AuthoredScenarioCassetteRun, task: Task, command: "Begin" | "Resume" | "Suspend") =>
  recordFence(
    run,
    (event) =>
      event._tag === "PlannedAttemptExecutorCommandIntended" &&
      event.plannedAttempt.attemptId === attempts[task] &&
      event.command === command
  )

/** A command response is not lifecycle acceptance; keep the lower fence at its accepted report. */
export const responseFence = (run: AuthoredScenarioCassetteRun, task: Task, ordinal = beginOrdinal): Fence => {
  const response = requireValue(
    run.records.find(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
        event.plannedAttempt.attemptId === attempts[task] &&
        event.plannedAttempt.runId === run.runId &&
        event.commandOrdinal === ordinal
    ),
    `missing ${task} command response ordinal ${ordinal}`
  )
  if (response.event._tag !== "PlannedAttemptExecutorCommandResponseObserved")
    return expect.fail(`exact ${task} response ordinal ${ordinal} anchor changed`)
  const responsePosition = response.position
  const observed = response.event
  const accepted = requireValue(
    run.records.find(
      (record) =>
        record.position > responsePosition &&
        record.event._tag === "PlannedAttemptExecutorWorkReported" &&
        record.event.report.correlation.attemptId === observed.report.correlation.attemptId &&
        record.event.report.correlation.runId === observed.report.correlation.runId &&
        record.event.report._tag === observed.report._tag
    ),
    `missing accepted lifecycle for ${task} response ordinal ${ordinal}`
  )
  if (accepted.event._tag !== "PlannedAttemptExecutorWorkReported")
    return expect.fail("accepted lifecycle anchor changed")
  expect(accepted.event.report).toEqual(observed.report)
  return { kind: "Journal", record: accepted }
}

export const terminalFence = (run: AuthoredScenarioCassetteRun, task: Task) =>
  occurrenceFence(
    run,
    (item) =>
      item._tag === "PlannedAttemptExecutorPassiveLifecycleChanged" &&
      item.report.attemptId === attempts[task] &&
      item.report._tag === "ExecutorWorkTerminal"
  )

export const settlementFence = (run: AuthoredScenarioCassetteRun, task: Task) =>
  recordFence(
    run,
    (event) => event._tag === "IntegrationFinalitySettled" && event.claim.plannedAttempt.attemptId === attempts[task]
  )

/** Historical G5 settlement publication plus the exact correlated owner's subsequent same-activation removal. */
export const assertSettledActionReleased = (run: AuthoredScenarioCassetteRun, publication: Publication) => {
  const frame = frameFor(run, publication)
  expect(frame.settlements.map(({ taskId }) => taskId).toSorted()).toEqual(tasks)
  expect(frame.actionPlanning).toMatchObject({ _tag: "DeliveryProposalsAvailable", proposals: [] })
  expect(frame.quiescence._tag).toBe("TrackerReconfirmationAllowed")
  const finalRead = occurrenceFence(
    run,
    (item) => item._tag === "TrackerGraphReadReturned" && item.graph.revision === "Gfinal"
  )
  if (finalRead.kind !== "Occurrence") return expect.fail("DS22 final tracker response is not captured")
  const settlement = requireValue(
    run.records.find(
      ({ event }) => event._tag === "IntegrationFinalitySettled" && event.claim.plannedAttempt.attemptId === attempts.G
    ),
    "DS22 G settlement missing"
  )
  if (settlement.event._tag !== "IntegrationFinalitySettled") return expect.fail("DS22 settlement changed")
  const replacementOperationId = settlement.event.replacementOperationId
  const moment = requireValue(
    run.observationMoments.find((item) => item.captureOrder === publication.captureOrder),
    "DS22 settlement publication owner view missing"
  )
  const owner = requireValue(
    moment.liveOwners.find(({ proposal }) => {
      const route = proposal.route
      return (
        route._tag === "IdentityFreeWorkflowRoute" &&
        route.transition._tag === "DeleteCompletedTaskCompletionClaim" &&
        route.transition.replacementOperationId === replacementOperationId
      )
    }),
    "DS22 exact G completion-claim deletion owner missing"
  )
  expect(owner.proposal.owner).toBe("DeliverySettlement")
  const route = owner.proposal.route
  if (route._tag !== "IdentityFreeWorkflowRoute" || route.transition._tag !== "DeleteCompletedTaskCompletionClaim")
    return expect.fail("DS22 exact completion-claim deletion route changed")
  expect(route.transition.responsibility.plannedAttempt).toEqual(settlement.event.claim.plannedAttempt)
  const captures = run.observationCaptures.filter(
    (item): item is Extract<AuthoredObservationCapture, { readonly _tag: "DeliveryRuntimeOwnersCaptured" }> =>
      item._tag === "DeliveryRuntimeOwnersCaptured" &&
      item.captureOrder > publication.captureOrder &&
      item.captureOrder < finalRead.capture.captureOrder
  )
  return assertExactOwnerRemoved(captures, owner.proposal.id, publication.activationOrdinal)
}

export const afterFence = (publication: Publication, fence: Fence): boolean =>
  fence.kind === "Occurrence"
    ? publication.captureOrder > fence.capture.captureOrder
    : publication.publication.bundle.actionInputs.runtimeFacts.acceptedAt !== null &&
      Number(publication.publication.bundle.actionInputs.runtimeFacts.acceptedAt) >= fence.record.position

export const beforeFence = (publication: Publication, fence: Fence): boolean =>
  fence.kind === "Occurrence"
    ? publication.captureOrder < fence.capture.captureOrder
    : publication.publication.bundle.actionInputs.runtimeFacts.acceptedAt !== null &&
      Number(publication.publication.bundle.actionInputs.runtimeFacts.acceptedAt) < fence.record.position

export const frameFor = (run: AuthoredScenarioCassetteRun, publication: Publication) => {
  const moment = requireValue(
    run.observationMoments.find((item) => item.captureOrder === publication.captureOrder),
    "publication has no playback moment"
  )
  if (moment._tag !== "DeliveryPublicationMoment") return expect.fail("publication capture is not a publication moment")
  return moment.deliveryFrame
}

export const pair = (attempt: PlannedTaskAttempt) => ({
  runId: attempt.runId,
  taskId: attempt.taskId,
  attemptId: attempt.attemptId
})
export const expectedPairs = (run: AuthoredScenarioCassetteRun, names: ReadonlyArray<Task>) =>
  names.map((taskId) => ({ runId: run.runId, taskId, attemptId: attempts[taskId] }))
export const sortPairs = <A extends { readonly taskId: string }>(values: ReadonlyArray<A>) =>
  values.toSorted((a, b) => a.taskId.localeCompare(b.taskId))

export const executorStanding = (
  standings: ReadonlyArray<TicketDeliveryStanding>,
  run: AuthoredScenarioCassetteRun,
  task: Task
) =>
  requireValue(
    standings.find(
      (standing): standing is Extract<TicketDeliveryStanding, { readonly _tag: "ResponsibilitySituation" }> =>
        standing._tag === "ResponsibilitySituation" &&
        standing.facts._tag === "PlannedAttemptExecutorFreshFacts" &&
        standing.facts.responsibility.plannedAttempt.attemptId === attempts[task] &&
        standing.facts.responsibility.plannedAttempt.runId === run.runId
    ),
    `missing exact ${task} executor responsibility standing`
  )

/** Coherence selects a publication version, never a later matching held/wait state. */
export const coherentFor = (run: AuthoredScenarioCassetteRun, publication: Publication) => {
  const frame = frameFor(run, publication)
  const bundle = publication.publication.bundle
  const graph = bundle.publication.graph
  if (frame.graph._tag !== "Established" || graph._tag !== "GraphEstablished" || frame.acceptedAt === null) return false
  if (
    frame.activationOrdinal !== publication.activationOrdinal ||
    frame.storyPosition !== publication.storyPosition ||
    frame.acceptedAt !== bundle.actionInputs.runtimeFacts.acceptedAt ||
    frame.capacity !== bundle.actionInputs.runtimeFacts.taskWork.capacity ||
    frame.graph.revision !== graph.observation.snapshot.revision ||
    frame.graph.observation.operationId !== graph.observation.operationId ||
    frame.graph.observation.contentIdentity !== graph.observation.contentIdentity ||
    frame.graph.observation.recordedAt !== graph.observation.recordedAt
  )
    return false
  const observation = frame.graph.observation
  return run.records.some(
    (record) =>
      record.position === observation.recordedAt &&
      record.position <= Number(frame.acceptedAt) &&
      record.event._tag === "TaskTrackerFactsObserved" &&
      record.event.operationId === observation.operationId
  )
}
