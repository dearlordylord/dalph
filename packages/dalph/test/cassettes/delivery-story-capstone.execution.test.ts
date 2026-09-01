import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Effect, Option } from "effect"
import { expect } from "vitest"
import {
  type AuthoredDeliveryFrame,
  type AuthoredScenarioCassetteRun,
  maintainedAuthoredCassetteCatalog,
  runAuthoredScenarioCassette
} from "../../src/cassettes/index.js"

const lastItemIndex = -1
const capstoneRun = Effect.runSync(
  Effect.cached(
    runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.autonomousExecutorDeliveryCapstone).pipe(
      Effect.provide(NodeCrypto.layer)
    )
  )
)

const expectedAttempts = [
  {
    attemptId: "attempt:A:0",
    baseSha: "1111111111111111111111111111111111111111",
    branch: "refs/heads/dalph/attempt-A-0",
    executor: "executor:delivery-story",
    taskId: "A",
    taskRevision: "tr1.eyJib2R5IjoiSW1wbGVtZW50IGRlbGl2ZXJ5LXN0b3J5IHRhc2sgQS4iLCJ0aXRsZSI6IkltcGxlbWVudCBBIn0",
    worktree: "/dalph/cassettes/delivery-story/attempt-A-0"
  },
  {
    attemptId: "attempt:B:1",
    baseSha: "1111111111111111111111111111111111111111",
    branch: "refs/heads/dalph/attempt-B-1",
    executor: "executor:delivery-story",
    taskId: "B",
    taskRevision: "tr1.eyJib2R5IjoiSW1wbGVtZW50IGRlbGl2ZXJ5LXN0b3J5IHRhc2sgQi4iLCJ0aXRsZSI6IkltcGxlbWVudCBCIn0",
    worktree: "/dalph/cassettes/delivery-story/attempt-B-1"
  },
  {
    attemptId: "attempt:C:2",
    baseSha: "1111111111111111111111111111111111111111",
    branch: "refs/heads/dalph/attempt-C-2",
    executor: "executor:delivery-story",
    taskId: "C",
    taskRevision: "tr1.eyJib2R5IjoiSW1wbGVtZW50IGRlbGl2ZXJ5LXN0b3J5IHRhc2sgQy4iLCJ0aXRsZSI6IkltcGxlbWVudCBDIn0",
    worktree: "/dalph/cassettes/delivery-story/attempt-C-2"
  },
  {
    attemptId: "attempt:D:3",
    baseSha: "1111111111111111111111111111111111111111",
    branch: "refs/heads/dalph/attempt-D-3",
    executor: "executor:delivery-story",
    taskId: "D",
    taskRevision: "tr1.eyJib2R5IjoiSW1wbGVtZW50IGRlbGl2ZXJ5LXN0b3J5IHRhc2sgRC4iLCJ0aXRsZSI6IkltcGxlbWVudCBEIn0",
    worktree: "/dalph/cassettes/delivery-story/attempt-D-3"
  },
  {
    attemptId: "attempt:E:4",
    baseSha: "1111111111111111111111111111111111111111",
    branch: "refs/heads/dalph/attempt-E-4",
    executor: "executor:delivery-story",
    taskId: "E",
    taskRevision: "tr1.eyJib2R5IjoiSW1wbGVtZW50IGRlbGl2ZXJ5LXN0b3J5IHRhc2sgRS4iLCJ0aXRsZSI6IkltcGxlbWVudCBFIn0",
    worktree: "/dalph/cassettes/delivery-story/attempt-E-4"
  }
] as const

const bF1 = expectedAttempts[1].taskRevision
const bF2 =
  "tr1.eyJib2R5IjoiQWxpY2UgY2hhbmdlZCBkZWxpdmVyeS1zdG9yeSB0YXNrIEIuIiwidGl0bGUiOiJJbXBsZW1lbnQgY2hhbmdlZCBCIn0"

const exactFrame = (
  run: AuthoredScenarioCassetteRun,
  label: string,
  predicate: (frame: AuthoredDeliveryFrame) => boolean
): AuthoredDeliveryFrame => run.deliveryFrames.find(predicate) ?? expect.fail(`missing ${label} delivery frame`)

const publicOccurrences = (run: AuthoredScenarioCassetteRun) =>
  run.observationMoments.flatMap((moment) =>
    moment._tag === "AuthoredStoryOccurrenceMoment" ? [moment.occurrence] : []
  )

const taskSet = (taskIds: ReadonlyArray<string>): string => taskIds.toSorted().join("+") || "—"

const heldTasks = (frame: AuthoredDeliveryFrame): string => taskSet(frame.heldPositions.map(({ taskId }) => taskId))

const retainedTasks = (frame: AuthoredDeliveryFrame): string => {
  const held = new Set(frame.heldPositions.map(({ taskId }) => taskId))
  return taskSet(
    frame.deliveries.flatMap(({ obligations, taskId }) =>
      !held.has(taskId) && obligations.some(({ attemptId }) => attemptId !== null) ? [taskId] : []
    )
  )
}

const establishedRevision = (frame: AuthoredDeliveryFrame): string =>
  frame.graph._tag === "Established" ? frame.graph.revision : "NotEstablished"

const reportLabel = (report: {
  readonly _tag: "ExecutorWorkExecuting" | "ExecutorWorkSafelySuspended" | "ExecutorWorkTerminal"
  readonly result?: { readonly _tag: string }
}): string => (report._tag === "ExecutorWorkTerminal" ? `${report._tag}:${report.result?._tag}` : report._tag)

const historicalRun = Effect.runSync(
  Effect.cached(
    runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.deliveryInvariantStory).pipe(
      Effect.provide(NodeCrypto.layer)
    )
  )
)

it.effect("emits the exact DS01 through DS13 delivery checkpoint table", () =>
  Effect.gen(function* () {
    const run = yield* capstoneRun
    const records = run.records
    const recordOf = (label: string, predicate: (record: (typeof records)[number]) => boolean) =>
      records.find(predicate) ?? expect.fail(`missing ${label} journal record`)
    const frameAfter = (
      label: string,
      position: number,
      predicate: (frame: AuthoredDeliveryFrame) => boolean
    ): AuthoredDeliveryFrame =>
      exactFrame(run, label, (frame) => frame.acceptedAt !== null && frame.acceptedAt >= position && predicate(frame))
    const attemptById = new Map(
      records.flatMap(({ event }) =>
        event._tag === "TaskAttemptPlanned"
          ? [[event.operation.plannedAttempt.attemptId, event.operation.plannedAttempt] as const]
          : []
      )
    )
    const acceptedOutcomes = (frame: AuthoredDeliveryFrame): string =>
      taskSet(
        records.flatMap(({ event, position }) =>
          frame.acceptedAt !== null &&
          position <= frame.acceptedAt &&
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report._tag === "ExecutorWorkTerminal" &&
          event.report.result._tag === "Accepted"
            ? [
                `${attemptById.get(event.report.correlation.attemptId)?.taskId}@${event.report.result.acceptedResult.commit}`
              ]
            : []
        )
      )
    const bSafe = recordOf(
      "B Safe",
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.attemptId === "attempt:B:1" &&
        event.report._tag === "ExecutorWorkSafelySuspended"
    )
    const continueB = recordOf(
      "Continue B",
      ({ event }) =>
        event._tag === "AttemptChoiceApplied" &&
        event.choice === "ContinueExistingAttempt" &&
        event.subject.plannedAttempt.attemptId === "attempt:B:1"
    )
    const awaitingAlice = (frame: AuthoredDeliveryFrame): string =>
      frame.acceptedAt !== null && bSafe.position <= frame.acceptedAt && frame.acceptedAt < continueB.position
        ? "B"
        : "—"
    const aliveCheckpoint = (beat: string, frame: AuthoredDeliveryFrame) => ({
      accepted: acceptedOutcomes(frame),
      awaitingAlice: awaitingAlice(frame),
      beat,
      capacity: frame.capacity,
      graph: establishedRevision(frame),
      held: heldTasks(frame),
      process: "Present",
      retained: retainedTasks(frame)
    })
    const exactHeld =
      (expected: string) =>
      (frame: AuthoredDeliveryFrame): boolean =>
        heldTasks(frame) === expected
    const g0 = (frame: AuthoredDeliveryFrame): boolean => establishedRevision(frame) === "delivery-story-G0"
    const g1 = (frame: AuthoredDeliveryFrame): boolean => establishedRevision(frame) === "delivery-story-G1"
    const g2 = (frame: AuthoredDeliveryFrame): boolean => establishedRevision(frame) === "delivery-story-G2"

    const ds01 = exactFrame(run, "DS-01", (frame) => g0(frame) && heldTasks(frame) === "—")
    const ds02 = exactFrame(run, "DS-02", (frame) => g0(frame) && heldTasks(frame) === "A+B+C")
    const ds03 = exactFrame(run, "DS-03", (frame) => g1(frame) && heldTasks(frame) === "A+B+C")
    const bSuspend = recordOf(
      "B Suspend intent",
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        event.command === "Suspend" &&
        event.plannedAttempt.attemptId === "attempt:B:1"
    )
    const ds04 = frameAfter("DS-04", bSuspend.position, (frame) => g1(frame) && exactHeld("A+B+C")(frame))
    const ds05 = frameAfter("DS-05", bSafe.position, (frame) => g1(frame) && exactHeld("A+C")(frame))
    const dExecuting = recordOf(
      "D Executing",
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.attemptId === "attempt:D:3" &&
        event.report._tag === "ExecutorWorkExecuting"
    )
    const ds06 = frameAfter("DS-06", dExecuting.position, (frame) => g1(frame) && exactHeld("A+C+D")(frame))
    const capacityChanged = recordOf("capacity revision two", ({ event }) => event._tag === "TaskWorkCapacityChanged")
    const ds07 = frameAfter(
      "DS-07",
      capacityChanged.position,
      (frame) => g1(frame) && frame.capacity === 2 && exactHeld("A+C+D")(frame)
    )
    const occurrences = publicOccurrences(run)
    const deathAt = occurrences.findIndex(({ _tag }) => _tag === "CoordinatorProcessDies")
    if (deathAt < 0) return expect.fail("missing the public coordinator-process-death occurrence")
    const deathMoment = run.observationMoments.find(
      (moment) => moment._tag === "AuthoredStoryOccurrenceMoment" && moment.occurrence._tag === "CoordinatorProcessDies"
    )
    if (deathMoment?.deliveryFrame === null || deathMoment === undefined) {
      return expect.fail("process death must retain its last public durable delivery view")
    }
    const restartActivation = Math.min(
      ...run.deliveryFrames
        .filter(({ activationOrdinal }) => activationOrdinal > ds07.activationOrdinal)
        .map(({ activationOrdinal }) => activationOrdinal)
    )
    const ds09 = exactFrame(
      run,
      "DS-09",
      (frame) =>
        frame.activationOrdinal === restartActivation && g1(frame) && frame.capacity === 2 && exactHeld("A+C+D")(frame)
    )
    const cSuspend = recordOf(
      "C Suspend intent",
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        event.command === "Suspend" &&
        event.plannedAttempt.attemptId === "attempt:C:2"
    )
    const ds10 = frameAfter("DS-10", cSuspend.position, (frame) => g2(frame) && exactHeld("A+C+D")(frame))
    const cSafe = recordOf(
      "C Safe",
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.attemptId === "attempt:C:2" &&
        event.report._tag === "ExecutorWorkSafelySuspended"
    )
    const ds11 = frameAfter("DS-11", cSafe.position, (frame) => g2(frame) && exactHeld("A+D")(frame))
    const ds12 = frameAfter("DS-12", continueB.position, (frame) => g2(frame) && exactHeld("A+D")(frame))
    const aAccepted = recordOf(
      "A Accepted",
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.attemptId === "attempt:A:0" &&
        event.report._tag === "ExecutorWorkTerminal" &&
        event.report.result._tag === "Accepted"
    )
    const bResumed = recordOf(
      "B resumed Executing",
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.attemptId === "attempt:B:1" &&
        event.report._tag === "ExecutorWorkExecuting" &&
        event.ordinal === 3
    )
    const ds13 = frameAfter(
      "DS-13",
      Math.max(aAccepted.position, bResumed.position),
      (frame) => g2(frame) && exactHeld("B+D")(frame)
    )
    if (ds01.graph._tag !== "Established") return expect.fail("DS-01 must have an established graph")
    expect(ds01.graph.tasks.map(({ id, prerequisiteIds }) => ({ id, prerequisiteIds }))).toEqual(
      ["A", "B", "C", "D", "E"].map((id) => ({ id, prerequisiteIds: [] }))
    )
    expect(ds01.frontier.map(({ standing, taskId }) => ({ standing, taskId }))).toEqual(
      ["A", "B", "C", "D", "E"].map((taskId) => ({ standing: "Eligible", taskId }))
    )
    const checkpointTable = [
      aliveCheckpoint("DS-01", ds01),
      aliveCheckpoint("DS-02", ds02),
      aliveCheckpoint("DS-03", ds03),
      aliveCheckpoint("DS-04", ds04),
      aliveCheckpoint("DS-05", ds05),
      aliveCheckpoint("DS-06", ds06),
      aliveCheckpoint("DS-07", ds07),
      {
        accepted: "—",
        awaitingAlice: "—",
        beat: "DS-08",
        capacity: deathMoment.deliveryFrame.capacity,
        graph: establishedRevision(deathMoment.deliveryFrame),
        held: "—",
        process: "Absent",
        retained: "—"
      },
      aliveCheckpoint("DS-09", ds09),
      aliveCheckpoint("DS-10", ds10),
      aliveCheckpoint("DS-11", ds11),
      aliveCheckpoint("DS-12", ds12),
      aliveCheckpoint("DS-13", ds13)
    ]

    expect(checkpointTable).toEqual([
      {
        accepted: "—",
        awaitingAlice: "—",
        beat: "DS-01",
        capacity: 3,
        graph: "delivery-story-G0",
        held: "—",
        process: "Present",
        retained: "—"
      },
      {
        accepted: "—",
        awaitingAlice: "—",
        beat: "DS-02",
        capacity: 3,
        graph: "delivery-story-G0",
        held: "A+B+C",
        process: "Present",
        retained: "—"
      },
      {
        accepted: "—",
        awaitingAlice: "—",
        beat: "DS-03",
        capacity: 3,
        graph: "delivery-story-G1",
        held: "A+B+C",
        process: "Present",
        retained: "—"
      },
      {
        accepted: "—",
        awaitingAlice: "—",
        beat: "DS-04",
        capacity: 3,
        graph: "delivery-story-G1",
        held: "A+B+C",
        process: "Present",
        retained: "—"
      },
      {
        accepted: "—",
        awaitingAlice: "B",
        beat: "DS-05",
        capacity: 3,
        graph: "delivery-story-G1",
        held: "A+C",
        process: "Present",
        retained: "B"
      },
      {
        accepted: "—",
        awaitingAlice: "B",
        beat: "DS-06",
        capacity: 3,
        graph: "delivery-story-G1",
        held: "A+C+D",
        process: "Present",
        retained: "B"
      },
      {
        accepted: "—",
        awaitingAlice: "B",
        beat: "DS-07",
        capacity: 2,
        graph: "delivery-story-G1",
        held: "A+C+D",
        process: "Present",
        retained: "B"
      },
      {
        accepted: "—",
        awaitingAlice: "—",
        beat: "DS-08",
        capacity: 2,
        graph: "delivery-story-G1",
        held: "—",
        process: "Absent",
        retained: "—"
      },
      {
        accepted: "—",
        awaitingAlice: "B",
        beat: "DS-09",
        capacity: 2,
        graph: "delivery-story-G1",
        held: "A+C+D",
        process: "Present",
        retained: "B"
      },
      {
        accepted: "—",
        awaitingAlice: "B",
        beat: "DS-10",
        capacity: 2,
        graph: "delivery-story-G2",
        held: "A+C+D",
        process: "Present",
        retained: "B"
      },
      {
        accepted: "—",
        awaitingAlice: "B",
        beat: "DS-11",
        capacity: 2,
        graph: "delivery-story-G2",
        held: "A+D",
        process: "Present",
        retained: "B+C"
      },
      {
        accepted: "—",
        awaitingAlice: "—",
        beat: "DS-12",
        capacity: 2,
        graph: "delivery-story-G2",
        held: "A+D",
        process: "Present",
        retained: "B+C"
      },
      {
        accepted: "A@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        awaitingAlice: "—",
        beat: "DS-13",
        capacity: 2,
        graph: "delivery-story-G2",
        held: "B+D",
        process: "Present",
        retained: "A+C"
      }
    ])
  })
)

it.effect("retains exact Run attempt claim and resource identities across DS01 through DS13", () =>
  Effect.gen(function* () {
    const run = yield* capstoneRun
    const plannedAttempts = run.records
      .flatMap(({ event }) => (event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt] : []))
      .toSorted((left, right) => left.taskId.localeCompare(right.taskId))
    const acquiredClaims = run.records.flatMap(({ event }) => (event._tag === "TaskClaimAcquired" ? [event.claim] : []))
    const claimIntents = run.records.flatMap(({ event }) =>
      event._tag === "TaskClaimAcquisitionIntended" ? [event.operation.acquisition] : []
    )
    const executorCorrelationRunIds = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" ? [event.report.correlation.runId] : []
    )
    const publicRunIds = [
      run.runId,
      ...run.records.map(({ runId }) => runId),
      ...plannedAttempts.map(({ runId }) => runId),
      ...executorCorrelationRunIds,
      ...run.deliveryFrames.flatMap(({ heldPositions }) => heldPositions.map(({ runId }) => runId))
    ]

    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    expect(new Set(publicRunIds)).toEqual(new Set([run.runId]))
    expect(plannedAttempts.map(({ runId: _runId, ...plannedAttempt }) => plannedAttempt)).toEqual(expectedAttempts)
    expect(plannedAttempts.every(({ runId }) => runId === run.runId)).toBe(true)
    expect(acquiredClaims.map(({ owner, taskId }) => ({ owner, taskId }))).toEqual(
      ["A", "B", "C", "D", "E"].map((taskId) => ({ owner: "delivery-story-owner", taskId }))
    )
    expect(acquiredClaims).toEqual(claimIntents)
    expect(
      acquiredClaims.every(
        ({ operationId, taskId, token }) => token === `delivery-story-claim:${taskId}:${operationId}`
      )
    ).toBe(true)
    expect(new Set(acquiredClaims.map(({ token }) => token)).size).toBe(5)
    expect(
      run.deliveryFrames
        .flatMap(({ heldPositions }) => heldPositions)
        .every(({ attemptId, runId, taskId }) => {
          const planned = plannedAttempts.find((attempt) => attempt.taskId === taskId)
          return planned?.attemptId === attemptId && runId === run.runId
        })
    ).toBe(true)
  })
)

it.effect("records B's F1-to-F2 choice and one same-attempt Continue and Resume", () =>
  Effect.gen(function* () {
    const run = yield* capstoneRun
    const bSpecificationFingerprints = run.records.flatMap(({ event }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
      event.observation.factFamily.taskId === "B"
        ? [event.observation.factFamily.fingerprint]
        : []
    )
    const choices = run.records.flatMap(({ event }) => (event._tag === "AttemptChoiceApplied" ? [event] : []))
    const resumeIntents = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Resume" ? [event] : []
    )
    const reports = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported"
        ? [{ attemptId: event.report.correlation.attemptId, ordinal: event.ordinal, report: reportLabel(event.report) }]
        : []
    )

    expect(new Set(bSpecificationFingerprints)).toEqual(new Set([bF1, bF2]))
    expect(choices).toHaveLength(1)
    expect(choices[0]).toMatchObject({
      choice: "ContinueExistingAttempt",
      requestId: { nonce: "continue-delivery-story-B", runId: run.runId },
      subject: {
        observedTaskRevision: bF2,
        plannedAttempt: { attemptId: "attempt:B:1", runId: run.runId, taskId: "B", taskRevision: bF1 }
      }
    })
    expect(resumeIntents).toHaveLength(1)
    expect(resumeIntents[0]?.plannedAttempt).toEqual(choices[0]?.subject.plannedAttempt)
    expect(
      expectedAttempts.map(({ attemptId }) => ({
        attemptId,
        reports: reports
          .filter((report) => report.attemptId === attemptId)
          .map(({ ordinal, report }) => ({ ordinal, report }))
      }))
    ).toEqual([
      {
        attemptId: "attempt:A:0",
        reports: [
          { ordinal: 1, report: "ExecutorWorkExecuting" },
          { ordinal: 2, report: "ExecutorWorkTerminal:Accepted" }
        ]
      },
      {
        attemptId: "attempt:B:1",
        reports: [
          { ordinal: 1, report: "ExecutorWorkExecuting" },
          { ordinal: 2, report: "ExecutorWorkSafelySuspended" },
          { ordinal: 3, report: "ExecutorWorkExecuting" }
        ]
      },
      {
        attemptId: "attempt:C:2",
        reports: [
          { ordinal: 1, report: "ExecutorWorkExecuting" },
          { ordinal: 2, report: "ExecutorWorkSafelySuspended" }
        ]
      },
      { attemptId: "attempt:D:3", reports: [{ ordinal: 1, report: "ExecutorWorkExecuting" }] },
      { attemptId: "attempt:E:4", reports: [] }
    ])
  })
)

it.effect("observes reduced capacity revision two before the authored restart cut", () =>
  Effect.gen(function* () {
    const run = yield* capstoneRun
    const changes = run.records.flatMap(({ event }) =>
      event._tag === "TaskWorkCapacityChanged"
        ? [{ capacity: event.capacity, previousRevision: event.previousRevision, revision: event.revision }]
        : []
    )
    const began = run.records.find(({ event }) => event._tag === "WorkflowRunBegan")
    const occurrences = publicOccurrences(run)
    const capacityAt = occurrences.findIndex(({ _tag }) => _tag === "SetTaskExecutionCapacity")
    const deathAt = occurrences.findIndex(({ _tag }) => _tag === "CoordinatorProcessDies")

    expect(began?.event).toMatchObject({ _tag: "WorkflowRunBegan", initialControlPolicy: { taskExecutionCapacity: 3 } })
    expect(changes).toEqual([{ capacity: 2, previousRevision: 1, revision: 2 }])
    expect(capacityAt).toBeGreaterThanOrEqual(0)
    expect(deathAt).toBeGreaterThan(capacityAt)
    expect(run.history._tag).toBe("ValidWorkflowJournalHistory")
    if (run.history._tag !== "ValidWorkflowJournalHistory") return
    expect(Option.getOrThrow(run.history.runState.controlPolicy)).toEqual({ revision: 2, taskExecutionCapacity: 2 })
    expect(
      run.deliveryFrames.some(
        (frame) =>
          frame.capacity === 2 &&
          frame.heldPositions
            .map(({ taskId }) => taskId)
            .toSorted()
            .join("+") === "A+C+D"
      )
    ).toBe(true)
  })
)

it.effect("records exactly one C2 Safe ordinal before Continue B", () =>
  Effect.gen(function* () {
    const run = yield* capstoneRun
    const cReports = run.records.flatMap(({ event, position }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === "attempt:C:2"
        ? [{ ordinal: event.ordinal, position, report: reportLabel(event.report) }]
        : []
    )
    const continueAt = run.records.find(
      ({ event }) =>
        event._tag === "AttemptChoiceApplied" &&
        event.choice === "ContinueExistingAttempt" &&
        event.subject.plannedAttempt.attemptId === "attempt:B:1"
    )

    expect(cReports.map(({ ordinal, report }) => ({ ordinal, report }))).toEqual([
      { ordinal: 1, report: "ExecutorWorkExecuting" },
      { ordinal: 2, report: "ExecutorWorkSafelySuspended" }
    ])
    expect(continueAt).toBeDefined()
    expect(cReports[1]?.position).toBeLessThan(continueAt?.position ?? 0)
    expect(cReports.some(({ ordinal }) => ordinal === 3)).toBe(false)
  })
)

it.effect(
  "runs reconstructed ordinary activation through strict exact projections before returning unsettled responsibility",
  () =>
    Effect.gen(function* () {
      const run = yield* capstoneRun
      const occurrences = publicOccurrences(run)
      const deathAt = occurrences.findIndex(({ _tag }) => _tag === "CoordinatorProcessDies")
      const returnOffset = occurrences
        .slice(deathAt + 1)
        .findIndex(({ _tag }) => _tag === "CoordinatorActivationReturned")
      if (deathAt < 0 || returnOffset < 0) return expect.fail("missing the accepted restart cut")
      const returnAt = deathAt + 1 + returnOffset
      const restart = occurrences.slice(deathAt + 1, returnAt + 1).map((occurrence): string => {
        if (occurrence._tag === "DalphSelects" && occurrence.operation._tag === "ReadTrackerGraph") {
          return "tracker-graph:selected"
        }
        if (occurrence._tag === "TrackerGraphReadReturned") return `tracker-graph:${occurrence.graph.revision}`
        if (occurrence._tag === "PlannedAttemptExecutorProjectionReturned") {
          return `executor-projection:${occurrence.report.attemptId}:${occurrence.report._tag}`
        }
        if (occurrence._tag === "CoordinatorActivationReturned") {
          return occurrence.decision._tag === "RunMustRemainActive"
            ? `activation-return:${occurrence.decision._tag}:${occurrence.decision.reason}`
            : `activation-return:${occurrence.decision._tag}`
        }
        return occurrence._tag
      })
      const firstAfterReturn = occurrences[returnAt + 1]

      expect(run.reactivationOwnerProcessGenerationCount).toBe(2)
      expect(occurrences.filter(({ _tag }) => _tag === "CoordinatorProcessDies")).toHaveLength(1)
      expect(restart).toEqual([
        "tracker-graph:selected",
        "tracker-graph:delivery-story-G1",
        "executor-projection:attempt:A:0:ExecutorWorkExecuting",
        "executor-projection:attempt:C:2:ExecutorWorkExecuting",
        "executor-projection:attempt:D:3:ExecutorWorkExecuting",
        "tracker-graph:selected",
        "tracker-graph:delivery-story-G1",
        "activation-return:RunMustRemainActive:UnsettledResponsibility"
      ])
      expect(firstAfterReturn).toEqual({
        _tag: "CassetteOffersRunReactivationHints",
        hints: ["TrackerNotification", "Timer"]
      })
      expect(
        occurrences
          .slice(deathAt + 1, returnAt)
          .some(
            (occurrence) =>
              (occurrence._tag === "DalphSelects" &&
                ["ReadTaskWorkSpecification", "ReadTaskClaim", "ReadTaskWorktree", "ReadTargetLineage"].includes(
                  occurrence.operation._tag
                )) ||
              occurrence._tag === "PlannedAttemptExecutorWorkReported"
          )
      ).toBe(false)
    })
)

it.effect("preserves the post-hint A D authority group without weakening the thirteen-beat story", () =>
  Effect.gen(function* () {
    const run = yield* capstoneRun
    const occurrences = publicOccurrences(run)
    const groups = occurrences.flatMap((occurrence, index) =>
      occurrence._tag === "ConcurrentInteractionGroup" ? [{ group: occurrence, index }] : []
    )
    const initial = groups.find(({ group }) => group.members.some(({ role }) => role === "S_B"))
    const later = groups.find(
      ({ group }) =>
        group.members.some(({ role }) => role === "S_D") && !group.members.some(({ role }) => role === "S_B")
    )
    if (initial === undefined || later === undefined)
      return expect.fail("missing an accepted authority group occurrence")
    const deathAt = occurrences.findIndex(({ _tag }) => _tag === "CoordinatorProcessDies")
    const postRestartHintsAt = occurrences.findIndex(
      (occurrence, index) =>
        index > deathAt &&
        occurrence._tag === "CassetteOffersRunReactivationHints" &&
        occurrence.hints.length === 2 &&
        occurrence.hints[0] === "TrackerNotification" &&
        occurrence.hints[1] === "Timer"
    )

    expect(initial.group.members.map(({ predecessorRoles, role }) => ({ predecessorRoles, role }))).toEqual([
      { predecessorRoles: [], role: "S_A" },
      { predecessorRoles: ["S_A"], role: "T_A" },
      { predecessorRoles: ["T_A"], role: "Q_A" },
      { predecessorRoles: ["Q_A"], role: "R_A" },
      { predecessorRoles: ["R_A"], role: "W_A" },
      { predecessorRoles: ["W_A"], role: "L_A" },
      { predecessorRoles: [], role: "S_B" },
      { predecessorRoles: ["S_B"], role: "T_B" },
      { predecessorRoles: [], role: "S_C" },
      { predecessorRoles: ["S_C"], role: "T_C" },
      { predecessorRoles: ["T_C"], role: "Q_C" },
      { predecessorRoles: ["Q_C"], role: "R_C" },
      { predecessorRoles: ["R_C"], role: "W_C" },
      { predecessorRoles: ["W_C"], role: "L_C" }
    ])
    expect(later.group.members.map(({ predecessorRoles, role }) => ({ predecessorRoles, role }))).toEqual([
      { predecessorRoles: [], role: "S_A" },
      { predecessorRoles: ["S_A"], role: "T_A" },
      { predecessorRoles: ["T_A"], role: "Q_A" },
      { predecessorRoles: ["Q_A"], role: "R_A" },
      { predecessorRoles: ["R_A"], role: "W_A" },
      { predecessorRoles: ["W_A"], role: "L_A" },
      { predecessorRoles: [], role: "S_D" },
      { predecessorRoles: ["S_D"], role: "T_D" },
      { predecessorRoles: ["T_D"], role: "Q_D" },
      { predecessorRoles: ["Q_D"], role: "R_D" },
      { predecessorRoles: ["R_D"], role: "W_D" },
      { predecessorRoles: ["W_D"], role: "L_D" }
    ])
    expect(occurrences[initial.index + 1]).toMatchObject({
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { attemptId: "attempt:B:1" },
      request: "Suspend"
    })
    expect(occurrences[later.index + 1]).toMatchObject({
      _tag: "PlannedAttemptExecutorWorkReported",
      report: { attemptId: "attempt:C:2" },
      request: "Suspend"
    })
    expect(deathAt).toBeGreaterThanOrEqual(0)
    expect(postRestartHintsAt).toBeGreaterThan(deathAt)
    expect(later.index).toBeGreaterThan(postRestartHintsAt)
    expect(occurrences[later.index - 1]).toMatchObject({
      _tag: "TrackerGraphReadReturned",
      graph: { revision: "delivery-story-G2" }
    })
    expect(later.index).toBeGreaterThan(initial.index)
  })
)

it.effect("admits retained B ahead of unstarted E after A releases its position", () =>
  Effect.gen(function* () {
    const run = yield* capstoneRun
    const aAcceptedAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.attemptId === "attempt:A:0" &&
        event.report._tag === "ExecutorWorkTerminal" &&
        event.report.result._tag === "Accepted"
    )
    const bResumeAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        event.command === "Resume" &&
        event.plannedAttempt.attemptId === "attempt:B:1"
    )
    const eStarts = run.records.filter(
      ({ event }) =>
        (event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.taskId === "E") ||
        (event._tag === "PlannedAttemptExecutorCommandIntended" && event.plannedAttempt.taskId === "E")
    )
    const final = exactFrame(
      run,
      "DS-13 admission",
      (frame) => heldTasks(frame) === "B+D" && retainedTasks(frame) === "A+C"
    )

    expect(aAcceptedAt).toBeGreaterThanOrEqual(0)
    expect(bResumeAt).toBeGreaterThan(aAcceptedAt)
    expect(eStarts).toEqual([])
    expect(final.capacity).toBe(2)
  })
)

it.effect("consumes a staggered graph while restart-added X waits for recovered capacity", () =>
  Effect.gen(function* () {
    const run = yield* historicalRun
    const established = run.deliveryFrames.filter(({ graph }) => graph._tag === "Established")
    const completeTopology = established.find(({ graph }) => graph._tag === "Established" && graph.tasks.length === 10)
    const edges =
      completeTopology?.graph._tag === "Established"
        ? completeTopology.graph.tasks.flatMap(({ id, prerequisiteIds }) =>
            prerequisiteIds.map((prerequisiteId) => `${prerequisiteId}->${id}`)
          )
        : []
    const heldSets = run.deliveryFrames.map(({ heldPositions }) =>
      heldPositions
        .map(({ taskId }) => taskId)
        .toSorted()
        .join("+")
    )
    const eligibleSets = established.map(({ frontier }) =>
      frontier
        .filter(({ standing }) => standing === "Eligible")
        .map(({ taskId }) => taskId)
        .toSorted()
        .join("+")
    )
    const expectedFrontiers = ["A", "B+C", "B+C+X", "D+X", "E+F", "H+I", "G", ""]
    let previousFrontier = lastItemIndex
    const frontierPositions = expectedFrontiers.map((frontier) => {
      previousFrontier = eligibleSets.indexOf(frontier, previousFrontier + 1)
      return previousFrontier
    })
    const expectedOverlaps = ["B+C", "C", "X", "D", "E+F", "F", "H+I", "I", "G"]
    let previousOverlap = lastItemIndex
    const overlapPositions = expectedOverlaps.map((overlap) => {
      previousOverlap = heldSets.indexOf(overlap, previousOverlap + 1)
      return previousOverlap
    })
    const taskByAttempt = new Map(
      run.records.flatMap(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
          ? [[event.plannedAttempt.attemptId, event.plannedAttempt.taskId] as const]
          : []
      )
    )
    const taskWork = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
        ? [`began:${event.plannedAttempt.taskId}`]
        : event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkTerminal"
          ? [`terminal:${taskByAttempt.get(event.report.correlation.attemptId)}`]
          : []
    )
    const taskIds = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "X"]
    const expectedExecutionOrder = ["A", "B", "C", "X", "D", "E", "F", "H", "I", "G"]
    const currentTaskGraphReads = run.records.flatMap(({ event }) =>
      event._tag === "TaskTrackerReadIntentRecorded" &&
      event.operation._tag === "ReadTrackerGraph" &&
      event.operation.cause._tag === "WorkflowEstablishment" &&
      event.operation.predecessorOperationIds.length === 0 &&
      event.operation.readShape.explicitlyCoveredTaskIds.length === 1
        ? event.operation.readShape.explicitlyCoveredTaskIds
        : []
    )
    const claimIntents = run.records.flatMap(({ event }) =>
      event._tag === "TaskClaimAcquisitionIntended" ? [event.operation.acquisition.taskId] : []
    )

    expect(completeTopology).toBeDefined()
    expect(edges.toSorted()).toEqual([
      "A->B",
      "A->C",
      "A->X",
      "B->D",
      "C->D",
      "D->E",
      "D->F",
      "E->H",
      "F->I",
      "H->G",
      "I->G",
      "X->G"
    ])
    expect(completeTopology?.frontier).toHaveLength(10)
    expect(overlapPositions.every((position) => position >= 0)).toBe(true)
    expect(frontierPositions.every((position) => position >= 0)).toBe(true)
    expect(run.deliveryFrames.every(({ capacity, heldPositions }) => capacity === 2 && heldPositions.length <= 2)).toBe(
      true
    )
    expect(taskWork.toSorted()).toEqual(
      taskIds.flatMap((taskId) => [`began:${taskId}`, `terminal:${taskId}`]).toSorted()
    )
    expect(currentTaskGraphReads).toEqual(expectedExecutionOrder)
    expect(claimIntents).toEqual(expectedExecutionOrder)
    const aSettledAt = run.records.findIndex(
      ({ event }) => event._tag === "IntegrationFinalitySettled" && event.claim.plannedAttempt.taskId === "A"
    )
    const bBeganAt = run.records.findIndex(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.taskId === "B"
    )
    expect(aSettledAt).toBeGreaterThanOrEqual(0)
    expect(bBeganAt).toBeGreaterThan(aSettledAt)
    expect(
      run.records.flatMap(({ event }) =>
        event._tag === "IntegrationFinalitySettled" ? [event.claim.plannedAttempt.taskId] : []
      )
    ).toEqual(["A", "B", "C", "X", "D", "E", "F", "H", "I", "G"])
    expect(
      run.records.some(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report._tag === "ExecutorWorkTerminal" &&
          event.report.result._tag === "Completed"
      )
    ).toBe(false)
    expect(run.records.at(lastItemIndex)?.event._tag).toBe("WorkflowRunTerminated")
    expect(run.deliveryFrames.at(lastItemIndex)?.heldPositions).toEqual([])
    expect(run.cassette.story.at(lastItemIndex)?._tag).toBe("ExpectedBehavior")
  })
)

it.effect("preserves the double-diamond middle positions across coordinator restart", () =>
  Effect.gen(function* () {
    const run = yield* historicalRun
    const initial = run.deliveryFrames.find(
      ({ heldPositions }) =>
        heldPositions.some(({ taskId }) => taskId === "B") && heldPositions.some(({ taskId }) => taskId === "C")
    )
    const later = run.deliveryFrames.find(
      ({ activationOrdinal }) => initial !== undefined && activationOrdinal > initial.activationOrdinal
    )
    const correlations = (frame: NonNullable<typeof initial>) =>
      frame.heldPositions
        .filter(({ taskId }) => taskId === "B" || taskId === "C")
        .map(({ attemptId, runId, taskId }) => `${taskId}:${runId}:${attemptId}`)
        .toSorted()

    expect(initial).toBeDefined()
    expect(later).toBeDefined()
    if (initial === undefined || later === undefined) return
    expect(later.heldPositions.map(({ taskId }) => taskId).toSorted()).toEqual(["B", "C"])
    expect(correlations(later)).toEqual(correlations(initial))
    const xObservedWithBothPositions = run.deliveryFrames.findIndex(
      ({ graph, heldPositions }) =>
        graph._tag === "Established" &&
        graph.tasks.some(({ id }) => id === "X") &&
        ["B", "C"].every((taskId) => heldPositions.some((position) => position.taskId === taskId))
    )
    const xHeld = run.deliveryFrames.findIndex(({ heldPositions }) =>
      heldPositions.some(({ taskId }) => taskId === "X")
    )
    expect(xObservedWithBothPositions).toBeGreaterThanOrEqual(0)
    expect(xHeld).toBeGreaterThan(xObservedWithBothPositions)
    expect(run.deliveryFrames[xHeld]?.heldPositions.some(({ taskId }) => taskId === "B" || taskId === "C")).toBe(false)
  })
)
