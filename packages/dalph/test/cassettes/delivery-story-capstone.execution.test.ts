import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { deriveRunnableFrontier, WorkflowResponsibilityState } from "@dalph/orchestrator"
import { Effect, Option } from "effect"
import { expect } from "vitest"
import {
  type AuthoredDeliveryFrame,
  type AuthoredScenarioCassetteRun,
  maintainedAuthoredCassetteCatalog,
  runAuthoredScenarioCassette
} from "../../src/cassettes/index.js"
import {
  type InternalAuthoredRuntimeEvaluationCapture,
  type InternalAuthoredScenarioCassetteRun,
  runAuthoredScenarioCassetteWithRuntimeEvaluations
} from "../../src/cassettes/authored-runner.js"

const lastItemIndex = -1
const capstoneRun = Effect.runSync(
  Effect.cached(
    runAuthoredScenarioCassetteWithRuntimeEvaluations(
      maintainedAuthoredCassetteCatalog.autonomousExecutorDeliveryCapstone
    ).pipe(Effect.provide(NodeCrypto.layer))
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

type ObservationMoment = AuthoredScenarioCassetteRun["observationMoments"][number]
type StoryMoment = Extract<ObservationMoment, { readonly _tag: "AuthoredStoryOccurrenceMoment" }>
type PublicationMoment = Extract<ObservationMoment, { readonly _tag: "DeliveryPublicationMoment" }>
type RuntimeEvaluationCapture = InternalAuthoredRuntimeEvaluationCapture

const bSpecificationConstraintsFrom = (capture: RuntimeEvaluationCapture) => {
  const facts =
    capture.evaluation.current.ticketDeliveries.deliveries
      .find(({ taskId }) => taskId === "B")
      ?.standings.flatMap((standing) =>
        standing._tag === "ResponsibilitySituation" &&
        standing.facts._tag === "PlannedAttemptExecutorFreshFacts" &&
        standing.facts.disposition._tag === "TaskSpecificationChangeConstraint"
          ? [standing.facts]
          : []
      ) ?? []
  return facts.map((constraintFacts) => {
    const frontier = deriveRunnableFrontier({
      freshEligibleTasks: [],
      responsibility: WorkflowResponsibilityState.make({ entries: [constraintFacts.responsibility] }),
      responsibilityFacts: [constraintFacts]
    })
    expect(frontier.transitions).toEqual([])
    expect(frontier.explanations).toHaveLength(1)
    return frontier.explanations[0]
  })
}

const runtimeEvaluationCaptureAt = (
  run: InternalAuthoredScenarioCassetteRun,
  beat: string,
  frame: AuthoredDeliveryFrame
): RuntimeEvaluationCapture => {
  const captures = run.runtimeEvaluationCaptures.filter(
    (capture) =>
      capture.activationOrdinal === frame.activationOrdinal &&
      capture.storyPosition === frame.storyPosition &&
      capture.evaluation.acceptedAt === frame.acceptedAt
  )
  expect(captures, `${beat} production evaluation capture`).toHaveLength(1)
  return captures[0] ?? expect.fail(`${beat} lacks its exact production runtime evaluation`)
}

const storyMomentAfter = (
  run: AuthoredScenarioCassetteRun,
  label: string,
  afterCaptureOrder: number,
  predicate: (occurrence: StoryMoment["occurrence"]) => boolean
): StoryMoment =>
  run.observationMoments.find(
    (moment): moment is StoryMoment =>
      moment._tag === "AuthoredStoryOccurrenceMoment" &&
      moment.captureOrder > afterCaptureOrder &&
      predicate(moment.occurrence)
  ) ?? expect.fail(`missing ${label} public occurrence`)

const publicationAfter = (
  run: AuthoredScenarioCassetteRun,
  label: string,
  boundary: Pick<ObservationMoment, "captureOrder">,
  before: Pick<ObservationMoment, "captureOrder"> | null = null
): PublicationMoment =>
  run.observationMoments.find(
    (moment): moment is PublicationMoment =>
      moment._tag === "DeliveryPublicationMoment" &&
      moment.captureOrder > boundary.captureOrder &&
      (before === null || moment.captureOrder < before.captureOrder)
  ) ?? expect.fail(`missing ${label} public delivery publication`)

const exactFrame = (
  run: AuthoredScenarioCassetteRun,
  label: string,
  predicate: (frame: AuthoredDeliveryFrame) => boolean
): AuthoredDeliveryFrame => run.deliveryFrames.find(predicate) ?? expect.fail(`missing ${label} delivery frame`)

const causalCapstoneCheckpoints = (run: AuthoredScenarioCassetteRun) => {
  const ds01Boundary = storyMomentAfter(run, "DS-01 graph result", 0, ({ _tag }) => _tag === "TrackerGraphReadReturned")
  const ds02Boundary = storyMomentAfter(
    run,
    "DS-02 initial executor group",
    ds01Boundary.captureOrder,
    (occurrence) =>
      occurrence._tag === "ConcurrentInteractionGroup" &&
      ["X_A", "X_B", "X_C"].every((role) => occurrence.members.some((member) => member.role === role))
  )
  const initialHints = storyMomentAfter(
    run,
    "initial reactivation hints",
    ds02Boundary.captureOrder,
    ({ _tag }) => _tag === "CassetteOffersRunReactivationHints"
  )
  const ds03Boundary = storyMomentAfter(
    run,
    "DS-03 G1 graph result",
    initialHints.captureOrder,
    ({ _tag }) => _tag === "TrackerGraphReadReturned"
  )
  const ds04Boundary = storyMomentAfter(
    run,
    "DS-04 B Suspend result",
    ds03Boundary.captureOrder,
    (occurrence) =>
      occurrence._tag === "PlannedAttemptExecutorWorkReported" &&
      occurrence.request === "Suspend" &&
      occurrence.report.attemptId === "attempt:B:1"
  )
  const ds05Boundary = storyMomentAfter(
    run,
    "DS-05 B Safe publication",
    ds04Boundary.captureOrder,
    (occurrence) =>
      occurrence._tag === "PlannedAttemptExecutorPassiveLifecycleChanged" &&
      occurrence.report._tag === "ExecutorWorkSafelySuspended" &&
      occurrence.report.attemptId === "attempt:B:1"
  )
  const ds06Boundary = storyMomentAfter(
    run,
    "DS-06 D Begin result",
    ds05Boundary.captureOrder,
    (occurrence) =>
      occurrence._tag === "PlannedAttemptExecutorWorkReported" &&
      occurrence.request === "Begin" &&
      occurrence.report.attemptId === "attempt:D:3"
  )
  const ds07Boundary = storyMomentAfter(
    run,
    "DS-07 capacity application",
    ds06Boundary.captureOrder,
    ({ _tag }) => _tag === "SetTaskExecutionCapacity"
  )
  const ds08Boundary = storyMomentAfter(
    run,
    "DS-08 coordinator process death",
    ds07Boundary.captureOrder,
    ({ _tag }) => _tag === "CoordinatorProcessDies"
  )
  const ds09Boundary = storyMomentAfter(
    run,
    "DS-09 reconstructed activation return",
    ds08Boundary.captureOrder,
    ({ _tag }) => _tag === "CoordinatorActivationReturned"
  )
  const restartHints = storyMomentAfter(
    run,
    "post-restart reactivation hints",
    ds09Boundary.captureOrder,
    ({ _tag }) => _tag === "CassetteOffersRunReactivationHints"
  )
  const ds10Boundary = storyMomentAfter(
    run,
    "DS-10 G2 graph result",
    restartHints.captureOrder,
    ({ _tag }) => _tag === "TrackerGraphReadReturned"
  )
  const ds11Boundary = storyMomentAfter(
    run,
    "DS-11 C Safe result",
    ds10Boundary.captureOrder,
    (occurrence) =>
      occurrence._tag === "PlannedAttemptExecutorWorkReported" &&
      occurrence.request === "Suspend" &&
      occurrence.report._tag === "ExecutorWorkSafelySuspended" &&
      occurrence.report.attemptId === "attempt:C:2"
  )
  const ds12Boundary = storyMomentAfter(
    run,
    "DS-12 Continue B application",
    ds11Boundary.captureOrder,
    ({ _tag }) => _tag === "OperatorContinuesAttempt"
  )
  const ds13Boundary = storyMomentAfter(
    run,
    "DS-13 B Resume result",
    ds12Boundary.captureOrder,
    (occurrence) =>
      occurrence._tag === "PlannedAttemptExecutorWorkReported" &&
      occurrence.request === "Resume" &&
      occurrence.report.attemptId === "attempt:B:1"
  )
  const boundaryMoments = [
    ds01Boundary,
    ds02Boundary,
    ds03Boundary,
    ds04Boundary,
    ds05Boundary,
    ds06Boundary,
    ds07Boundary,
    ds08Boundary,
    ds09Boundary,
    ds10Boundary,
    ds11Boundary,
    ds12Boundary,
    ds13Boundary
  ]

  expect(boundaryMoments.map(({ captureOrder }) => captureOrder)).toEqual(
    boundaryMoments.map(({ captureOrder }) => captureOrder).toSorted((left, right) => left - right)
  )
  expect(new Set(boundaryMoments.map(({ captureOrder }) => captureOrder)).size).toBe(boundaryMoments.length)
  if (
    ds07Boundary.deliveryFrame === null ||
    ds08Boundary.deliveryFrame === null ||
    ds09Boundary.deliveryFrame === null
  ) {
    return expect.fail("capacity, process death, and reconstructed return must carry their last public delivery views")
  }

  return {
    boundaries: {
      ds01: ds01Boundary,
      ds02: ds02Boundary,
      ds03: ds03Boundary,
      ds04: ds04Boundary,
      ds05: ds05Boundary,
      ds06: ds06Boundary,
      ds07: ds07Boundary,
      ds08: ds08Boundary,
      ds09: ds09Boundary,
      ds10: ds10Boundary,
      ds11: ds11Boundary,
      ds12: ds12Boundary,
      ds13: ds13Boundary,
      initialHints,
      restartHints
    },
    frames: {
      ds01: publicationAfter(run, "DS-01", ds01Boundary, ds02Boundary).deliveryFrame,
      ds02: publicationAfter(run, "DS-02", ds02Boundary, ds03Boundary).deliveryFrame,
      ds03: publicationAfter(run, "DS-03", ds03Boundary, ds04Boundary).deliveryFrame,
      ds04: publicationAfter(run, "DS-04", ds04Boundary, ds05Boundary).deliveryFrame,
      ds05: publicationAfter(run, "DS-05", ds05Boundary, ds06Boundary).deliveryFrame,
      ds06: publicationAfter(run, "DS-06", ds06Boundary, ds07Boundary).deliveryFrame,
      ds07: ds07Boundary.deliveryFrame,
      ds08: ds08Boundary.deliveryFrame,
      ds09: ds09Boundary.deliveryFrame,
      ds10: publicationAfter(run, "DS-10", ds10Boundary, ds11Boundary).deliveryFrame,
      ds11: publicationAfter(run, "DS-11", ds11Boundary, ds12Boundary).deliveryFrame,
      ds12: publicationAfter(run, "DS-12", ds12Boundary, ds13Boundary).deliveryFrame,
      ds13: publicationAfter(run, "DS-13", ds13Boundary).deliveryFrame
    }
  }
}

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
    const { boundaries, frames } = causalCapstoneCheckpoints(run)
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
    const prefixAt = (beat: string, frame: AuthoredDeliveryFrame) => {
      const acceptedAt = frame.acceptedAt
      if (acceptedAt === null) return expect.fail(`${beat} must carry a committed Journal boundary`)
      return records.filter(({ position }) => position <= acceptedAt)
    }
    const attemptIdentitiesAt = (prefix: typeof records) =>
      prefix
        .flatMap(({ event }) =>
          event._tag === "TaskAttemptPlanned"
            ? [
                {
                  attemptId: event.operation.plannedAttempt.attemptId,
                  taskId: event.operation.plannedAttempt.taskId,
                  taskRevision: event.operation.plannedAttempt.taskRevision
                }
              ]
            : []
        )
        .toSorted((left, right) => left.taskId.localeCompare(right.taskId))
    const activeClaimsAt = (prefix: typeof records) => {
      const released = new Set(
        prefix.flatMap(({ event }) => (event._tag === "TaskClaimReleased" ? [event.release.claim.token] : []))
      )
      return prefix
        .flatMap(({ event }) =>
          event._tag === "TaskClaimAcquired" && !released.has(event.claim.token)
            ? [
                {
                  operationId: event.claim.operationId,
                  owner: event.claim.owner,
                  state: "Active" as const,
                  taskId: event.claim.taskId,
                  token: event.claim.token
                }
              ]
            : []
        )
        .toSorted((left, right) => left.taskId.localeCompare(right.taskId))
    }
    const resourcesAt = (prefix: typeof records) =>
      prefix
        .flatMap(({ event }) => {
          if (event._tag !== "TaskAttemptPlanned") return []
          const { plannedAttempt } = event.operation
          const reconciliation = prefix.find(
            ({ event: candidate }) =>
              candidate._tag === "TaskWorktreeReconciliationIntended" &&
              candidate.operation.plannedAttempt.attemptId === plannedAttempt.attemptId
          )
          const reconciliationOperationId =
            reconciliation?.event._tag === "TaskWorktreeReconciliationIntended"
              ? reconciliation.event.operation.operationId
              : undefined
          const ready =
            reconciliationOperationId === undefined
              ? undefined
              : prefix.find(
                  ({ event: candidate }) =>
                    candidate._tag === "TaskWorktreeReady" && candidate.operationId === reconciliationOperationId
                )
          return [
            {
              attemptId: plannedAttempt.attemptId,
              baseSha: plannedAttempt.baseSha,
              branch: plannedAttempt.branch,
              executor: plannedAttempt.executor,
              ready:
                ready?.event._tag === "TaskWorktreeReady"
                  ? {
                      baseSha: ready.event.proof.baseSha,
                      branch: ready.event.proof.branch,
                      worktree: ready.event.proof.worktree
                    }
                  : null,
              taskId: plannedAttempt.taskId,
              worktree: plannedAttempt.worktree
            }
          ]
        })
        .toSorted((left, right) => left.taskId.localeCompare(right.taskId))
    const currentFingerprintsAt = (prefix: typeof records) => {
      const current = new Map<string, string>()
      for (const { event } of prefix) {
        if (
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskWorkSpecificationFacts"
        ) {
          current.set(event.observation.factFamily.taskId, event.observation.factFamily.fingerprint)
        }
      }
      return [...current]
        .map(([taskId, fingerprint]) => ({ fingerprint, taskId }))
        .toSorted((left, right) => left.taskId.localeCompare(right.taskId))
    }
    const reportsAt = (prefix: typeof records) =>
      prefix
        .flatMap(({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported"
            ? [
                {
                  attemptId: event.report.correlation.attemptId,
                  ordinal: event.ordinal,
                  report: reportLabel(event.report)
                }
              ]
            : []
        )
        .toSorted((left, right) => left.attemptId.localeCompare(right.attemptId) || left.ordinal - right.ordinal)
    const awaitingAliceAt = (beat: string, prefix: typeof records, frame: AuthoredDeliveryFrame) => {
      const safe = prefix.some(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report.correlation.attemptId === "attempt:B:1" &&
          event.report._tag === "ExecutorWorkSafelySuspended"
      )
      const continued = prefix.some(
        ({ event }) =>
          event._tag === "AttemptChoiceApplied" &&
          event.subject.plannedAttempt.attemptId === "attempt:B:1" &&
          event.choice === "ContinueExistingAttempt"
      )
      if (safe && !continued) {
        const specificationConstraints = bSpecificationConstraintsFrom(runtimeEvaluationCaptureAt(run, beat, frame))
        if (specificationConstraints.length !== 1) {
          return expect.fail("B Safe must remain visible through its exact specification-change constraint")
        }
        return { _tag: "Demonstrated" as const, choices: specificationConstraints, taskIds: ["B"] }
      }
      if (continued && bSpecificationConstraintsFrom(runtimeEvaluationCaptureAt(run, beat, frame)).length !== 0) {
        return expect.fail("B's specification-change constraint must disappear after Continue is applied")
      }
      return { _tag: "Demonstrated" as const, choices: [], taskIds: [] as ReadonlyArray<string> }
    }
    const checkpoint = (beat: string, frame: AuthoredDeliveryFrame, capacity: number = frame.capacity) => {
      const prefix = prefixAt(beat, frame)
      const runIds = new Set(prefix.map(({ runId }) => runId))
      if (runIds.size !== 1) return expect.fail(`${beat} must carry one exact Run identity`)
      return {
        accepted: acceptedOutcomes(frame),
        attempts: attemptIdentitiesAt(prefix),
        awaitingAlice: awaitingAliceAt(beat, prefix, frame),
        beat,
        capacity,
        claims: activeClaimsAt(prefix),
        fingerprints: currentFingerprintsAt(prefix),
        graph: establishedRevision(frame),
        held: heldTasks(frame),
        reports: reportsAt(prefix),
        resources: resourcesAt(prefix),
        retained: retainedTasks(frame),
        runId: [...runIds][0]
      }
    }
    if (frames.ds01.graph._tag !== "Established") return expect.fail("DS-01 must have an established graph")
    expect(frames.ds01.graph.tasks.map(({ id, prerequisiteIds }) => ({ id, prerequisiteIds }))).toEqual(
      ["A", "B", "C", "D", "E"].map((id) => ({ id, prerequisiteIds: [] }))
    )
    expect(frames.ds01.frontier.map(({ standing, taskId }) => ({ standing, taskId }))).toEqual(
      ["A", "B", "C", "D", "E"].map((taskId) => ({ standing: "Eligible", taskId }))
    )
    expect(boundaries.ds08.occurrence._tag).toBe("CoordinatorProcessDies")
    expect(boundaries.ds08.liveOwners).toEqual([])
    const capacityChange = records.find(({ event }) => event._tag === "TaskWorkCapacityChanged")
    if (capacityChange?.event._tag !== "TaskWorkCapacityChanged") {
      return expect.fail("DS-07 lacks its exact durable capacity change")
    }
    expect(capacityChange.event).toMatchObject({
      _tag: "TaskWorkCapacityChanged",
      capacity: 2,
      previousRevision: 1,
      revision: 2
    })
    const checkpointTable = [
      checkpoint("DS-01", frames.ds01),
      checkpoint("DS-02", frames.ds02),
      checkpoint("DS-03", frames.ds03),
      checkpoint("DS-04", frames.ds04),
      checkpoint("DS-05", frames.ds05),
      checkpoint("DS-06", frames.ds06),
      checkpoint("DS-07", frames.ds07, capacityChange.event.capacity),
      checkpoint("DS-08", frames.ds08, capacityChange.event.capacity),
      checkpoint("DS-09", frames.ds09),
      checkpoint("DS-10", frames.ds10),
      checkpoint("DS-11", frames.ds11),
      checkpoint("DS-12", frames.ds12),
      checkpoint("DS-13", frames.ds13)
    ]

    const exactAttemptIdentities = expectedAttempts.map(({ attemptId, taskId, taskRevision }) => ({
      attemptId,
      taskId,
      taskRevision
    }))
    const exactReadyResources = expectedAttempts.map(({ attemptId, baseSha, branch, executor, taskId, worktree }) => ({
      attemptId,
      baseSha,
      branch,
      executor,
      ready: { baseSha, branch, worktree },
      taskId,
      worktree
    }))
    const exactInitialFingerprints = expectedAttempts.map(({ taskId, taskRevision: fingerprint }) => ({
      fingerprint,
      taskId
    }))
    const exactChangedFingerprints = exactInitialFingerprints.map((fingerprint) =>
      fingerprint.taskId === "B" ? { fingerprint: bF2, taskId: "B" } : fingerprint
    )
    // The cassette's six initial graph reads consume deterministic operation slots 0–5;
    // its literal sequential claim requests then consume 6, 7, 8, 10, and 12.
    const exactActiveClaims = [
      { operationOrdinal: 6, taskId: "A" },
      { operationOrdinal: 7, taskId: "B" },
      { operationOrdinal: 8, taskId: "C" },
      { operationOrdinal: 10, taskId: "D" },
      { operationOrdinal: 12, taskId: "E" }
    ].map(({ operationOrdinal, taskId }) => {
      const operationId = `cassette:${run.runId}:activation:1:operation:${operationOrdinal}`
      return {
        operationId,
        owner: "delivery-story-owner",
        state: "Active" as const,
        taskId,
        token: `delivery-story-claim:${taskId}:${operationId}`
      }
    })
    const noAwaitingAlice = { _tag: "Demonstrated", choices: [], taskIds: [] }
    const bAwaitingAlice = {
      _tag: "Demonstrated",
      choices: [
        {
          _tag: "PlannedAttemptTaskSpecificationChangeConstraint",
          availableResolutions: ["ContinueExistingAttempt", "RestartTaskImplementation", "StopTaskImplementation"],
          correlation: { attemptId: "attempt:B:1", runId: run.runId },
          observedFingerprint: bF2,
          plannedFingerprint: bF1,
          taskId: "B",
          wakeCondition: "TaskResolutionApplied"
        }
      ],
      taskIds: ["B"]
    }
    const initialReports = [
      { attemptId: "attempt:A:0", ordinal: 1, report: "ExecutorWorkExecuting" },
      { attemptId: "attempt:B:1", ordinal: 1, report: "ExecutorWorkExecuting" },
      { attemptId: "attempt:C:2", ordinal: 1, report: "ExecutorWorkExecuting" }
    ]
    const bSafeReports = [
      { attemptId: "attempt:A:0", ordinal: 1, report: "ExecutorWorkExecuting" },
      { attemptId: "attempt:B:1", ordinal: 1, report: "ExecutorWorkExecuting" },
      { attemptId: "attempt:B:1", ordinal: 2, report: "ExecutorWorkSafelySuspended" },
      { attemptId: "attempt:C:2", ordinal: 1, report: "ExecutorWorkExecuting" }
    ]
    const dRunningReports = [...bSafeReports, { attemptId: "attempt:D:3", ordinal: 1, report: "ExecutorWorkExecuting" }]
    const cSafeReports = [
      ...bSafeReports,
      { attemptId: "attempt:C:2", ordinal: 2, report: "ExecutorWorkSafelySuspended" },
      { attemptId: "attempt:D:3", ordinal: 1, report: "ExecutorWorkExecuting" }
    ]
    const resumedReports = [
      { attemptId: "attempt:A:0", ordinal: 1, report: "ExecutorWorkExecuting" },
      { attemptId: "attempt:A:0", ordinal: 2, report: "ExecutorWorkTerminal:Accepted" },
      { attemptId: "attempt:B:1", ordinal: 1, report: "ExecutorWorkExecuting" },
      { attemptId: "attempt:B:1", ordinal: 2, report: "ExecutorWorkSafelySuspended" },
      { attemptId: "attempt:B:1", ordinal: 3, report: "ExecutorWorkExecuting" },
      { attemptId: "attempt:C:2", ordinal: 1, report: "ExecutorWorkExecuting" },
      { attemptId: "attempt:C:2", ordinal: 2, report: "ExecutorWorkSafelySuspended" },
      { attemptId: "attempt:D:3", ordinal: 1, report: "ExecutorWorkExecuting" }
    ]

    expect(checkpointTable).toEqual([
      {
        accepted: "—",
        attempts: [],
        awaitingAlice: noAwaitingAlice,
        beat: "DS-01",
        capacity: 3,
        claims: [],
        fingerprints: [],
        graph: "delivery-story-G0",
        held: "—",
        reports: [],
        resources: [],
        retained: "—",
        runId: run.runId
      },
      {
        accepted: "—",
        attempts: exactAttemptIdentities,
        awaitingAlice: noAwaitingAlice,
        beat: "DS-02",
        capacity: 3,
        claims: exactActiveClaims,
        fingerprints: exactInitialFingerprints,
        graph: "delivery-story-G0",
        held: "A+B+C",
        reports: initialReports,
        resources: exactReadyResources,
        retained: "—",
        runId: run.runId
      },
      {
        accepted: "—",
        attempts: exactAttemptIdentities,
        awaitingAlice: noAwaitingAlice,
        beat: "DS-03",
        capacity: 3,
        claims: exactActiveClaims,
        fingerprints: exactInitialFingerprints,
        graph: "delivery-story-G1",
        held: "A+B+C",
        reports: initialReports,
        resources: exactReadyResources,
        retained: "—",
        runId: run.runId
      },
      {
        accepted: "—",
        attempts: exactAttemptIdentities,
        awaitingAlice: noAwaitingAlice,
        beat: "DS-04",
        capacity: 3,
        claims: exactActiveClaims,
        fingerprints: exactChangedFingerprints,
        graph: "delivery-story-G1",
        held: "A+B+C",
        reports: initialReports,
        resources: exactReadyResources,
        retained: "—",
        runId: run.runId
      },
      {
        accepted: "—",
        attempts: exactAttemptIdentities,
        awaitingAlice: bAwaitingAlice,
        beat: "DS-05",
        capacity: 3,
        claims: exactActiveClaims,
        fingerprints: exactChangedFingerprints,
        graph: "delivery-story-G1",
        held: "A+C",
        reports: bSafeReports,
        resources: exactReadyResources,
        retained: "B",
        runId: run.runId
      },
      {
        accepted: "—",
        attempts: exactAttemptIdentities,
        awaitingAlice: bAwaitingAlice,
        beat: "DS-06",
        capacity: 3,
        claims: exactActiveClaims,
        fingerprints: exactChangedFingerprints,
        graph: "delivery-story-G1",
        held: "A+C+D",
        reports: dRunningReports,
        resources: exactReadyResources,
        retained: "B",
        runId: run.runId
      },
      {
        accepted: "—",
        attempts: exactAttemptIdentities,
        awaitingAlice: bAwaitingAlice,
        beat: "DS-07",
        capacity: 2,
        claims: exactActiveClaims,
        fingerprints: exactChangedFingerprints,
        graph: "delivery-story-G1",
        held: "A+C+D",
        reports: dRunningReports,
        resources: exactReadyResources,
        retained: "B",
        runId: run.runId
      },
      {
        accepted: "—",
        attempts: exactAttemptIdentities,
        awaitingAlice: bAwaitingAlice,
        beat: "DS-08",
        capacity: 2,
        claims: exactActiveClaims,
        fingerprints: exactChangedFingerprints,
        graph: "delivery-story-G1",
        held: "A+C+D",
        reports: dRunningReports,
        resources: exactReadyResources,
        retained: "B",
        runId: run.runId
      },
      {
        accepted: "—",
        attempts: exactAttemptIdentities,
        awaitingAlice: bAwaitingAlice,
        beat: "DS-09",
        capacity: 2,
        claims: exactActiveClaims,
        fingerprints: exactChangedFingerprints,
        graph: "delivery-story-G1",
        held: "A+C+D",
        reports: dRunningReports,
        resources: exactReadyResources,
        retained: "B",
        runId: run.runId
      },
      {
        accepted: "—",
        attempts: exactAttemptIdentities,
        awaitingAlice: bAwaitingAlice,
        beat: "DS-10",
        capacity: 2,
        claims: exactActiveClaims,
        fingerprints: exactChangedFingerprints,
        graph: "delivery-story-G2",
        held: "A+C+D",
        reports: dRunningReports,
        resources: exactReadyResources,
        retained: "B",
        runId: run.runId
      },
      {
        accepted: "—",
        attempts: exactAttemptIdentities,
        awaitingAlice: bAwaitingAlice,
        beat: "DS-11",
        capacity: 2,
        claims: exactActiveClaims,
        fingerprints: exactChangedFingerprints,
        graph: "delivery-story-G2",
        held: "A+D",
        reports: cSafeReports,
        resources: exactReadyResources,
        retained: "B+C",
        runId: run.runId
      },
      {
        accepted: "—",
        attempts: exactAttemptIdentities,
        awaitingAlice: noAwaitingAlice,
        beat: "DS-12",
        capacity: 2,
        claims: exactActiveClaims,
        fingerprints: exactChangedFingerprints,
        graph: "delivery-story-G2",
        held: "A+D",
        reports: cSafeReports,
        resources: exactReadyResources,
        retained: "B+C",
        runId: run.runId
      },
      {
        accepted: "A@aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        attempts: exactAttemptIdentities,
        awaitingAlice: noAwaitingAlice,
        beat: "DS-13",
        capacity: 2,
        claims: exactActiveClaims,
        fingerprints: exactChangedFingerprints,
        graph: "delivery-story-G2",
        held: "B+D",
        reports: resumedReports,
        resources: exactReadyResources,
        retained: "A+C",
        runId: run.runId
      }
    ])
  })
)

it.effect("captures B's exact F1 F2 choices from each production runtime observation through Continue", () =>
  Effect.gen(function* () {
    const run = yield* capstoneRun
    const { frames } = causalCapstoneCheckpoints(run)
    const expected = {
      _tag: "PlannedAttemptTaskSpecificationChangeConstraint",
      availableResolutions: ["ContinueExistingAttempt", "RestartTaskImplementation", "StopTaskImplementation"],
      correlation: { attemptId: "attempt:B:1", runId: run.runId },
      observedFingerprint: bF2,
      plannedFingerprint: bF1,
      taskId: "B",
      wakeCondition: "TaskResolutionApplied"
    }

    const relevantCaptures = (
      [
        ["DS-05", frames.ds05, expected],
        ["DS-06", frames.ds06, expected],
        ["DS-07", frames.ds07, expected],
        ["DS-08", frames.ds08, expected],
        ["DS-09", frames.ds09, expected],
        ["DS-10", frames.ds10, expected],
        ["DS-11", frames.ds11, expected],
        ["DS-12", frames.ds12, undefined],
        ["DS-13", frames.ds13, undefined]
      ] as const satisfies ReadonlyArray<readonly [string, AuthoredDeliveryFrame, typeof expected | undefined]>
    ).map(([beat, frame, expectedConstraint]) => {
      const capture = runtimeEvaluationCaptureAt(run, beat, frame)
      expect(bSpecificationConstraintsFrom(capture), beat).toEqual(
        expectedConstraint === undefined ? [] : [expectedConstraint]
      )
      return {
        acceptedAt: frame.acceptedAt,
        activationOrdinal: capture.activationOrdinal,
        beat,
        captureCount: 1,
        storyPosition: capture.storyPosition
      }
    })

    expect(relevantCaptures.map(({ beat, captureCount }) => ({ beat, captureCount }))).toEqual([
      { beat: "DS-05", captureCount: 1 },
      { beat: "DS-06", captureCount: 1 },
      { beat: "DS-07", captureCount: 1 },
      { beat: "DS-08", captureCount: 1 },
      { beat: "DS-09", captureCount: 1 },
      { beat: "DS-10", captureCount: 1 },
      { beat: "DS-11", captureCount: 1 },
      { beat: "DS-12", captureCount: 1 },
      { beat: "DS-13", captureCount: 1 }
    ])
  })
)

it.effect("retains exact Run attempt claim and resource identities across DS01 through DS13", () =>
  Effect.gen(function* () {
    const run = yield* capstoneRun
    const { frames } = causalCapstoneCheckpoints(run)
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
    const reconciliationIntents = run.records.flatMap(({ event, position }) =>
      event._tag === "TaskWorktreeReconciliationIntended" ? [{ operation: event.operation, position }] : []
    )
    const readyWorktrees = reconciliationIntents.map(({ operation, position: intendedAt }) => {
      const ready = run.records.find(
        ({ event }) => event._tag === "TaskWorktreeReady" && event.operationId === operation.operationId
      )
      if (ready?.event._tag !== "TaskWorktreeReady") {
        return expect.fail(`missing ready worktree for ${operation.plannedAttempt.attemptId}`)
      }
      return {
        attemptId: operation.plannedAttempt.attemptId,
        intendedAt,
        plannedAttempt: operation.plannedAttempt,
        proof: ready.event.proof,
        readyAt: ready.position
      }
    })

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
      readyWorktrees
        .map(({ attemptId, plannedAttempt, proof }) => ({
          attemptId,
          branch: proof.branch,
          plannedBranch: plannedAttempt.branch,
          baseSha: proof.baseSha,
          plannedBaseSha: plannedAttempt.baseSha,
          worktree: proof.worktree,
          plannedWorktree: plannedAttempt.worktree
        }))
        .toSorted((left, right) => left.attemptId.localeCompare(right.attemptId))
    ).toEqual(
      expectedAttempts.map(({ attemptId, baseSha, branch, worktree }) => ({
        attemptId,
        branch,
        plannedBranch: branch,
        baseSha,
        plannedBaseSha: baseSha,
        worktree,
        plannedWorktree: worktree
      }))
    )
    expect(
      run.deliveryFrames
        .flatMap(({ heldPositions }) => heldPositions)
        .every(({ attemptId, runId, taskId }) => {
          const planned = plannedAttempts.find((attempt) => attempt.taskId === taskId)
          return planned?.attemptId === attemptId && runId === run.runId
        })
    ).toBe(true)
    expect(
      [
        { beat: "DS-05", frame: frames.ds05 },
        { beat: "DS-09", frame: frames.ds09 },
        { beat: "DS-11", frame: frames.ds11 },
        { beat: "DS-13", frame: frames.ds13 }
      ].map(({ beat, frame }) => {
        if (frame.acceptedAt === null) {
          return expect.fail(`${beat} lacks an accepted public delivery frame`)
        }
        const acceptedAt = frame.acceptedAt
        const prefix = run.records.filter(({ position }) => position <= acceptedAt)
        return {
          beat,
          claimReleases: prefix.filter(
            ({ event }) => event._tag === "TaskClaimReleaseIntended" || event._tag === "TaskClaimReleased"
          ).length,
          replacements: prefix.filter(({ event }) => event._tag === "PlannedAttemptReplaced").length,
          retained: retainedTasks(frame)
        }
      })
    ).toEqual([
      { beat: "DS-05", claimReleases: 0, replacements: 0, retained: "B" },
      { beat: "DS-09", claimReleases: 0, replacements: 0, retained: "B" },
      { beat: "DS-11", claimReleases: 0, replacements: 0, retained: "B+C" },
      { beat: "DS-13", claimReleases: 0, replacements: 0, retained: "A+C" }
    ])
    const ds11AcceptedAt = frames.ds11.acceptedAt
    if (ds11AcceptedAt === null) return expect.fail("DS-11 lacks an exact committed boundary")
    const ds11Prefix = run.records.filter(({ position }) => position <= ds11AcceptedAt)
    const cPlan = ds11Prefix.find(
      ({ event }) => event._tag === "TaskAttemptPlanned" && event.operation.plannedAttempt.attemptId === "attempt:C:2"
    )
    const cReconciliation = ds11Prefix.find(
      ({ event }) =>
        event._tag === "TaskWorktreeReconciliationIntended" &&
        event.operation.plannedAttempt.attemptId === "attempt:C:2"
    )
    const cReconciliationOperationId =
      cReconciliation?.event._tag === "TaskWorktreeReconciliationIntended"
        ? cReconciliation.event.operation.operationId
        : undefined
    const cReady =
      cReconciliationOperationId === undefined
        ? undefined
        : ds11Prefix.find(
            ({ event }) => event._tag === "TaskWorktreeReady" && event.operationId === cReconciliationOperationId
          )
    const cClaim = acquiredClaims.find(({ taskId }) => taskId === "C")
    const cClaimAtDs11 = ds11Prefix.find(
      ({ event }) => event._tag === "TaskClaimAcquired" && event.claim.taskId === "C"
    )
    const cSafe = ds11Prefix.find(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.attemptId === "attempt:C:2" &&
        event.report._tag === "ExecutorWorkSafelySuspended"
    )
    const cleanupEvents = ds11Prefix.filter(
      ({ event }) => event._tag.startsWith("WorktreeCleanup") || event._tag.startsWith("BranchCleanup")
    )
    const cReplacements = ds11Prefix.filter(
      ({ event }) => event._tag === "PlannedAttemptReplaced" && event.subject.plannedAttempt.attemptId === "attempt:C:2"
    )
    const cClaimReleases = ds11Prefix.filter(
      ({ event }) =>
        (event._tag === "TaskClaimReleaseIntended" && event.operation.release.claim.taskId === "C") ||
        (event._tag === "TaskClaimReleased" && event.release.claim.taskId === "C")
    )
    if (cPlan?.event._tag !== "TaskAttemptPlanned") return expect.fail("DS-11 lost C's exact attempt plan")
    if (cReady?.event._tag !== "TaskWorktreeReady") return expect.fail("DS-11 lost C's exact ready worktree")
    if (cSafe?.event._tag !== "PlannedAttemptExecutorWorkReported") return expect.fail("DS-11 lacks C2 Safe")
    if (cClaim === undefined || cClaimAtDs11?.event._tag !== "TaskClaimAcquired") {
      return expect.fail("DS-11 lost C's exact active claim")
    }
    const { runId: _cRunId, ...cPlanIdentity } = cPlan.event.operation.plannedAttempt

    expect({
      claim: cClaimAtDs11.event.claim,
      claimReleases: cClaimReleases,
      cleanupEvents,
      held: frames.ds11.heldPositions.some(({ taskId }) => taskId === "C"),
      plan: cPlanIdentity,
      replacements: cReplacements,
      retained: retainedTasks(frames.ds11).split("+").includes("C"),
      safe: {
        attemptId: cSafe.event.report.correlation.attemptId,
        ordinal: cSafe.event.ordinal,
        report: reportLabel(cSafe.event.report)
      },
      worktree: cReady.event.proof
    }).toEqual({
      claim: cClaim,
      claimReleases: [],
      cleanupEvents: [],
      held: false,
      plan: expectedAttempts[2],
      replacements: [],
      retained: true,
      safe: { attemptId: "attempt:C:2", ordinal: 2, report: "ExecutorWorkSafelySuspended" },
      worktree: {
        baseSha: expectedAttempts[2].baseSha,
        branch: expectedAttempts[2].branch,
        worktree: expectedAttempts[2].worktree
      }
    })
  })
)

it.effect("publishes B F2 through one active refresh and rereads G1 after Safe before D begins", () =>
  Effect.gen(function* () {
    const run = yield* capstoneRun
    const { boundaries, frames } = causalCapstoneCheckpoints(run)
    const activeGraphOperationId =
      frames.ds03.graph._tag === "Established"
        ? frames.ds03.graph.observation.operationId
        : expect.fail("DS-03 must carry the active G1 graph observation")
    const graphIntents = run.records.flatMap(({ event, position }) =>
      event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTrackerGraph"
        ? [{ operation: event.operation, position }]
        : []
    )
    const activeGraphIntent = graphIntents.find(({ operation }) => operation.operationId === activeGraphOperationId)
    if (activeGraphIntent === undefined) return expect.fail("missing the active G1 graph intent")
    const activeGraphOutcome = run.records.find(
      ({ event }) => event._tag === "TaskTrackerFactsObserved" && event.operationId === activeGraphOperationId
    )
    if (activeGraphOutcome === undefined) return expect.fail("missing the active G1 graph result")
    const bSpecifications = run.records.flatMap(({ event, position }) =>
      event._tag === "TaskTrackerFactsObserved" &&
      event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
      event.observation.factFamily.taskId === "B"
        ? [{ fingerprint: event.observation.factFamily.fingerprint, position }]
        : []
    )
    const bF2Observed = bSpecifications.find(
      ({ fingerprint, position }) => fingerprint === bF2 && position > activeGraphOutcome.position
    )
    if (bF2Observed === undefined) return expect.fail("missing B F2 after the active G1 graph")
    const priorBF1 = bSpecifications.filter(
      ({ fingerprint, position }) => fingerprint === bF1 && position < bF2Observed.position
    )
    const bSuspendIntents = run.records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" &&
        event.command === "Suspend" &&
        event.plannedAttempt.attemptId === "attempt:B:1"
    )
    const bSafeReports = run.records.filter(
      ({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" &&
        event.report.correlation.attemptId === "attempt:B:1" &&
        event.report._tag === "ExecutorWorkSafelySuspended"
    )
    expect(bSuspendIntents).toHaveLength(1)
    expect(bSafeReports).toHaveLength(1)
    const bSuspend = bSuspendIntents[0]
    const bSafe = bSafeReports[0]
    if (bSuspend === undefined || bSafe === undefined) return
    const stabilizations = graphIntents.filter(
      ({ operation, position }) =>
        position > bSafe.position &&
        position <
          (run.records.find(
            ({ event }) =>
              event._tag === "PlannedAttemptExecutorCommandIntended" &&
              event.command === "Begin" &&
              event.plannedAttempt.attemptId === "attempt:D:3"
          )?.position ?? 0) &&
        operation.cause._tag === "PostQuiescenceReconfirmation"
    )
    expect(stabilizations).toHaveLength(1)
    const stabilization = stabilizations[0]
    if (stabilization?.operation.cause._tag !== "PostQuiescenceReconfirmation") return
    const stabilizationOutcome = run.records.find(
      ({ event }) =>
        event._tag === "TaskTrackerFactsObserved" && event.operationId === stabilization.operation.operationId
    )
    if (stabilizationOutcome === undefined) return expect.fail("missing the post-Safe stabilization result")
    const activeCut = run.records.filter(
      ({ position }) => position > activeGraphOutcome.position && position < bSafe.position
    )
    const unchangedSubjects = ["attempt:A:0", "attempt:C:2"]

    expect(boundaries.initialHints.occurrence).toMatchObject({
      _tag: "CassetteOffersRunReactivationHints",
      hints: ["TrackerNotification", "Timer", "TrackerNotification", "Timer"]
    })
    expect(
      new Set(
        run.observationMoments.flatMap((moment) =>
          moment._tag === "DeliveryPublicationMoment" &&
          moment.captureOrder > boundaries.initialHints.captureOrder &&
          moment.captureOrder < boundaries.ds07.captureOrder
            ? [moment.activationOrdinal]
            : []
        )
      ).size
    ).toBe(1)
    expect(
      run.observationMoments.filter(
        (moment) =>
          moment._tag === "AuthoredStoryOccurrenceMoment" &&
          moment.captureOrder > boundaries.initialHints.captureOrder &&
          moment.captureOrder < boundaries.ds07.captureOrder &&
          moment.occurrence._tag === "CoordinatorActivationReturned"
      )
    ).toHaveLength(1)
    expect(activeGraphIntent.operation.cause._tag).toBe("ExecutingWorkAuthorityCheck")
    expect(priorBF1.length).toBeGreaterThan(0)
    expect(Math.max(...priorBF1.map(({ position }) => position))).toBeLessThan(bF2Observed.position)
    expect(activeGraphOutcome.position).toBeLessThan(bF2Observed.position)
    expect(bF2Observed.position).toBeLessThan(bSuspend.position)
    expect(bSuspend.position).toBeLessThan(bSafe.position)
    expect(bSafe.position).toBeLessThan(stabilization.position)
    expect(stabilization.position).toBeLessThan(stabilizationOutcome.position)
    expect(stabilization.operation.cause.quiescentGraphOperationId).toBe(activeGraphOperationId)
    expect(stabilization.operation.predecessorOperationIds).toContain(activeGraphOperationId)
    expect(
      activeCut.flatMap(({ event }) =>
        event._tag === "TaskTrackerFactsObserved" &&
        event.observation._tag === "FocusedTaskWorkSpecificationFacts" &&
        event.observation.factFamily.taskId === "B"
          ? [event.observation.factFamily.fingerprint]
          : []
      )
    ).toEqual([bF2])
    expect(
      activeCut.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandIntended" &&
          unchangedSubjects.includes(event.plannedAttempt.attemptId)
      )
    ).toEqual([])
    expect(
      activeCut.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          unchangedSubjects.includes(event.report.correlation.attemptId)
      )
    ).toEqual([])
    expect(
      activeCut.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorStateObserved" &&
          unchangedSubjects.includes(event.plannedAttempt.attemptId)
      )
    ).toEqual([])
    expect(heldTasks(frames.ds04)).toBe("A+B+C")
    expect(heldTasks(frames.ds05)).toBe("A+C")
    expect(retainedTasks(frames.ds05)).toBe("B")
  })
)

it.effect("records B's F1-to-F2 transition and one same-attempt Continue and Resume", () =>
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
    const commandIntents = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandIntended"
        ? [{ attemptId: event.plannedAttempt.attemptId, command: event.command, ordinal: event.ordinal }]
        : []
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
        commands: commandIntents
          .filter((intent) => intent.attemptId === attemptId)
          .map(({ command, ordinal }) => ({ command, ordinal }))
      }))
    ).toEqual([
      { attemptId: "attempt:A:0", commands: [{ command: "Begin", ordinal: 1 }] },
      {
        attemptId: "attempt:B:1",
        commands: [
          { command: "Begin", ordinal: 1 },
          { command: "Suspend", ordinal: 2 },
          { command: "Resume", ordinal: 3 }
        ]
      },
      {
        attemptId: "attempt:C:2",
        commands: [
          { command: "Begin", ordinal: 1 },
          { command: "Suspend", ordinal: 2 }
        ]
      },
      { attemptId: "attempt:D:3", commands: [{ command: "Begin", ordinal: 1 }] },
      { attemptId: "attempt:E:4", commands: [] }
    ])
    expect(commandIntents.filter(({ command }) => command === "Begin")).toHaveLength(4)
    expect(commandIntents.filter(({ command }) => command === "Resume")).toEqual([
      { attemptId: "attempt:B:1", command: "Resume", ordinal: 3 }
    ])
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
      const { frames } = causalCapstoneCheckpoints(run)
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
      const capacityAt = run.records.find(({ event }) => event._tag === "TaskWorkCapacityChanged")?.position
      if (capacityAt === undefined || frames.ds09.acceptedAt === null) {
        return expect.fail("restart boundaries must carry accepted Journal positions")
      }
      const restartAcceptedAt = frames.ds09.acceptedAt
      const restartRecords = run.records.filter(
        ({ position }) => position > capacityAt && position <= restartAcceptedAt
      )

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
      expect(
        restartRecords.filter(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorCommandIntended" &&
            (event.command === "Begin" || event.command === "Resume")
        )
      ).toEqual([])
      expect(
        restartRecords.filter(
          ({ event }) =>
            event._tag === "TaskTrackerReadIntentRecorded" &&
            event.operation._tag === "ReadTrackerGraph" &&
            event.operation.cause._tag === "ExecutingWorkAuthorityCheck"
        )
      ).toEqual([])
      expect(restart.some((step) => step === "CassetteOffersRunReactivationHints")).toBe(false)
      expect(restart.some((step) => step === "ConcurrentInteractionGroup")).toBe(false)
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
