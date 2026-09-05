import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { plannedAttemptExecutorCorrelation } from "@dalph/contracts"
import { evaluateDeliveryRuntimeInputBundle, type DeliveryRelationInputBundle } from "@dalph/orchestrator"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  runIssue268Ds01Characterization,
  runIssue268Ds02Characterization,
  runIssue268Ds03Characterization,
  runIssue268Ds04Characterization
} from "../../test-support/issue-268-controlled-characterization.js"
import { issue268ControlledDeliveryCharacterization as controlledScenario } from "../../test-support/issue-268-controlled-characterization-catalog.js"
import { maintainedAuthoredCassetteCatalog, runAuthoredScenarioCassette } from "../../src/cassettes/index.js"

const lastItemIndex = -1
const capstoneTimeout = 600_000
const cachedRun = Effect.runSync(
  Effect.cached(
    runAuthoredScenarioCassette(maintainedAuthoredCassetteCatalog.deliveryInvariantStory).pipe(
      Effect.provide(NodeCrypto.layer)
    )
  )
)

const contributedTaskIds = (publications: ReadonlyArray<DeliveryRelationInputBundle>) =>
  publications.flatMap(({ actionInputs }) =>
    actionInputs.proposalContributions.ticketDelivery.flatMap(({ order }) => ("taskId" in order ? [order.taskId] : []))
  )

it.effect("DS-01 derives A, B, and C inside capacity while D and E stay outside", () =>
  Effect.gen(function* () {
    const run = yield* runIssue268Ds01Characterization
    const establishedBundle = run.publications.find(({ publication }) => publication.graph._tag === "GraphEstablished")
    if (establishedBundle === undefined) return expect.fail("DS-01 must publish the established G0 graph")
    const established = yield* evaluateDeliveryRuntimeInputBundle(establishedBundle)
    const placements = established.current.ticketDeliveries.source.placements.map(({ placement, taskId }) => ({
      placement: placement._tag,
      taskId
    }))
    const selected = established.current.ticketDeliveries.deliveries.map(({ taskId }) => taskId)
    const candidates = establishedBundle.actionInputs.freshTaskCandidates.map(({ taskId }) => taskId)
    const forbiddenStages = new Set([
      "AcquireTaskClaim",
      "ReadPostClaimGraph",
      "ReadTaskWorkSpecification",
      "RecordTaskAttemptPlan",
      "ReconcileTaskWorktree",
      "BeginPlannedAttemptExecutorWork",
      "ObservePlannedAttemptExecutorWork"
    ])
    const forbiddenEvents = new Set([
      "TaskClaimAcquisitionIntended",
      "TaskClaimAcquired",
      "TaskAttemptPlanned",
      "TaskWorktreeReconciliationIntended",
      "PlannedAttemptExecutorWorkResponsibilityBegan",
      "PlannedAttemptExecutorCommandIntended"
    ])

    expect(placements).toEqual([
      { placement: "Selected", taskId: "A" },
      { placement: "Selected", taskId: "B" },
      { placement: "Selected", taskId: "C" },
      { placement: "EligibleOutsideBound", taskId: "D" },
      { placement: "EligibleOutsideBound", taskId: "E" }
    ])
    expect(candidates).toEqual(["A", "B", "C", "D", "E"])
    expect(selected).toEqual(["A", "B", "C"])
    expect(run.pendingClaimTaskIds).toHaveLength(3)
    expect(new Set(run.pendingClaimTaskIds)).toEqual(new Set(["A", "B", "C"]))
    expect(run.executedActions.filter(({ stage }) => forbiddenStages.has(stage))).toEqual([])
    expect(run.records.filter(({ event }) => forbiddenEvents.has(event._tag))).toEqual([])
    expect(run.claimRequests).toEqual([])
    expect(run.commands).toEqual([])
    expect(run.plans).toEqual([])
  })
)

it.effect("DS-02 starts only A, B, and C through the production workflow algebra", () =>
  Effect.gen(function* () {
    const run = yield* runIssue268Ds02Characterization
    const begun = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
        ? [`${event.plannedAttempt.taskId}:${event.plannedAttempt.attemptId}`]
        : []
    )
    const claimed = run.records.flatMap(({ event }) =>
      event._tag === "TaskClaimAcquisitionIntended" ? [event.operation.acquisition.taskId] : []
    )
    const planned = run.records.flatMap(({ event }) =>
      event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt.taskId] : []
    )
    const prematureOutsideBoundWork = run.records.flatMap(({ event, position }) => {
      const taskId =
        event._tag === "TaskClaimAcquisitionIntended"
          ? event.operation.acquisition.taskId
          : event._tag === "TaskClaimAcquired"
            ? event.claim.taskId
            : event._tag === "TaskAttemptPlanned" || event._tag === "TaskWorktreeReconciliationIntended"
              ? event.operation.plannedAttempt.taskId
              : undefined
      return taskId === "D" || taskId === "E" ? [{ event: event._tag, position, taskId }] : []
    })
    const finalPublication = run.publications.at(-1)
    const expectedStages = [
      "ReadCurrentTaskGraph",
      "AcquireTaskClaim",
      "ReadPostClaimGraph",
      "ReadTaskWorkSpecification",
      "RecordTaskAttemptPlan",
      "ReconcileTaskWorktree",
      "BeginPlannedAttemptExecutorWork",
      "ObservePlannedAttemptExecutorWork"
    ]
    const stagesByTask = Object.fromEntries(
      ["A", "B", "C", "D", "E"].map((taskId) => [
        taskId,
        run.executedActions.filter((action) => action.taskId === taskId).map(({ stage }) => stage)
      ])
    )
    const commandIntents = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandIntended"
        ? [{ attemptId: event.plannedAttempt.attemptId, command: event.command, ordinal: event.ordinal }]
        : []
    )
    const commandResponses = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorCommandResponseObserved"
        ? [{ attemptId: event.plannedAttempt.attemptId, ordinal: event.commandOrdinal, report: event.report }]
        : []
    )
    const acceptedExecutorReports = run.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported"
        ? [{ attemptId: event.report.correlation.attemptId, ordinal: event.ordinal, report: event.report }]
        : []
    )
    const acquiredClaims = run.records.flatMap(({ event }) => (event._tag === "TaskClaimAcquired" ? [event.claim] : []))
    const durablePlans = run.records.flatMap(({ event }) =>
      event._tag === "TaskAttemptPlanned" ? [event.operation.plannedAttempt] : []
    )

    expect(run.commands).toEqual([
      { attemptId: "attempt:A:1", command: "Begin" },
      { attemptId: "attempt:B:1", command: "Begin" },
      { attemptId: "attempt:C:1", command: "Begin" }
    ])
    expect(begun).toEqual(["A:attempt:A:1", "B:attempt:B:1", "C:attempt:C:1"])
    expect(prematureOutsideBoundWork).toEqual([])
    expect(new Set(contributedTaskIds(run.publications))).toEqual(new Set(["A", "B", "C"]))
    expect(claimed).toHaveLength(3)
    expect(new Set(claimed)).toEqual(new Set(["A", "B", "C"]))
    expect(planned).toEqual(["A", "B", "C"])
    expect(stagesByTask).toEqual({ A: expectedStages, B: expectedStages, C: expectedStages, D: [], E: [] })
    expect(run.claimRequests).toHaveLength(3)
    expect(run.claimRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ owner: "issue-268-controlled-owner", taskId: "A" }),
        expect.objectContaining({ owner: "issue-268-controlled-owner", taskId: "B" }),
        expect.objectContaining({ owner: "issue-268-controlled-owner", taskId: "C" })
      ])
    )
    expect(run.claimReleaseOrder).toEqual(["A", "B", "C"])
    expect(
      run.claimRequests.every(
        ({ operationId, taskId, token }) => token === `issue-268-controlled-claim:${taskId}:${operationId}`
      )
    ).toBe(true)
    expect(acquiredClaims).toEqual(run.claimRequests.map((request) => ({ _tag: "ActiveTaskClaim", ...request })))
    expect(run.plans).toEqual([
      expect.objectContaining({
        attemptId: "attempt:A:1",
        baseSha: controlledScenario.baseSha,
        branch: "refs/heads/dalph/issue-268-a-1",
        executor: "executor:issue-268-controlled",
        runId: controlledScenario.runId,
        taskId: "A",
        taskRevision: controlledScenario.specifications.F1.A.fingerprint,
        worktree: "/dalph/controlled-characterization/issue-268/A-1"
      }),
      expect.objectContaining({
        attemptId: "attempt:B:1",
        baseSha: controlledScenario.baseSha,
        branch: "refs/heads/dalph/issue-268-b-1",
        executor: "executor:issue-268-controlled",
        runId: controlledScenario.runId,
        taskId: "B",
        taskRevision: controlledScenario.specifications.F1.B.fingerprint,
        worktree: "/dalph/controlled-characterization/issue-268/B-1"
      }),
      expect.objectContaining({
        attemptId: "attempt:C:1",
        baseSha: controlledScenario.baseSha,
        branch: "refs/heads/dalph/issue-268-c-1",
        executor: "executor:issue-268-controlled",
        runId: controlledScenario.runId,
        taskId: "C",
        taskRevision: controlledScenario.specifications.F1.C.fingerprint,
        worktree: "/dalph/controlled-characterization/issue-268/C-1"
      })
    ])
    expect(durablePlans).toEqual(run.plans)
    expect(run.worktreeCreateRequests).toEqual(run.plans)
    expect(commandIntents).toEqual([
      { attemptId: "attempt:A:1", command: "Begin", ordinal: 1 },
      { attemptId: "attempt:B:1", command: "Begin", ordinal: 1 },
      { attemptId: "attempt:C:1", command: "Begin", ordinal: 1 }
    ])
    const expectedCommandResponses = run.plans.map((plan) => ({
      attemptId: plan.attemptId,
      ordinal: 1,
      report: { _tag: "ExecutorWorkExecuting" as const, correlation: plannedAttemptExecutorCorrelation(plan) }
    }))
    expect(commandResponses).toEqual(expectedCommandResponses)
    expect(acceptedExecutorReports).toEqual(commandResponses)
    for (const attemptId of ["attempt:A:1", "attempt:B:1", "attempt:C:1"]) {
      const plan = run.plans.find((candidate) => candidate.attemptId === attemptId)
      if (plan === undefined) return expect.fail(`missing exact plan ${attemptId}`)
      const worktreeIntent = run.records.filter(
        ({ event }) =>
          event._tag === "TaskWorktreeReconciliationIntended" && event.operation.plannedAttempt.attemptId === attemptId
      )
      expect(worktreeIntent).toHaveLength(1)
      const worktreeOperationId = worktreeIntent[0]?.event
      if (worktreeOperationId?._tag !== "TaskWorktreeReconciliationIntended") {
        return expect.fail(`missing exact worktree intent ${attemptId}`)
      }
      const worktreeObservations = run.records.filter(
        ({ event }) =>
          event._tag === "TaskWorktreeReady" && event.operationId === worktreeOperationId.operation.operationId
      )
      expect(worktreeObservations).toHaveLength(1)
      expect(worktreeObservations[0]?.event).toMatchObject({
        proof: {
          _tag: "PlannedWorktreeReady",
          baseSha: plan.baseSha,
          branch: plan.branch,
          headSha: plan.baseSha,
          worktree: plan.worktree
        }
      })
      const responsibilityAt = run.records.findIndex(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" && event.plannedAttempt.attemptId === attemptId
      )
      const beginIntentAt = run.records.findIndex(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandIntended" &&
          event.plannedAttempt.attemptId === attemptId &&
          event.command === "Begin"
      )
      expect(responsibilityAt).toBeGreaterThanOrEqual(0)
      expect(beginIntentAt).toBeGreaterThan(responsibilityAt)
    }
    expect(
      finalPublication?.actionInputs.runtimeFacts.taskWork.held
        .map(({ correlation }) => correlation.attemptId)
        .toSorted()
    ).toEqual(["attempt:A:1", "attempt:B:1", "attempt:C:1"])
    expect(run.decision).toMatchObject({ _tag: "RunMustRemainActive" })
  })
)

it.effect("DS-03 accepts Alice's B/F2 and G1 tracker edit without triggering Dalph work", () =>
  Effect.gen(function* () {
    const run = yield* runIssue268Ds03Characterization
    const ds03 = run.ds03
    const executingAttempts = ds03.before.records.flatMap(({ event }) =>
      event._tag === "PlannedAttemptExecutorWorkReported" && event.report._tag === "ExecutorWorkExecuting"
        ? [event.report.correlation.attemptId]
        : []
    )
    const heldAttempts = ds03.before.publications
      .at(-1)
      ?.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId)
      .toSorted()

    expect(executingAttempts).toEqual(["attempt:A:1", "attempt:B:1", "attempt:C:1"])
    expect(heldAttempts).toEqual(["attempt:A:1", "attempt:B:1", "attempt:C:1"])
    expect(controlledScenario.specifications.F1.B.fingerprint).not.toBe(
      controlledScenario.specifications.F2.B.fingerprint
    )
    expect(ds03.edit).toEqual({
      graphRevision: controlledScenario.graphs.G1.revision,
      nextFingerprint: controlledScenario.specifications.F2.B.fingerprint,
      priorFingerprint: controlledScenario.specifications.F1.B.fingerprint,
      taskId: "B"
    })
    expect(ds03.after).toEqual(ds03.before)
    expect(
      ds03.after.publications.some(
        ({ publication }) =>
          publication.graph._tag === "GraphEstablished" &&
          publication.graph.observation.snapshot.revision === controlledScenario.graphs.G1.revision
      )
    ).toBe(false)
    expect(ds03.after.commands).toEqual([
      { attemptId: "attempt:A:1", command: "Begin" },
      { attemptId: "attempt:B:1", command: "Begin" },
      { attemptId: "attempt:C:1", command: "Begin" }
    ])
  })
)

it.effect(
  "DS-04 refreshes B from the bounded timer when its notification is lost",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268Ds04Characterization
      const ds04 = run.ds04
      const newRecords = ds04.after.records.slice(ds04.beforeTimer.records.length)
      const authorityGraphReads = newRecords.filter(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.cause._tag === "ExecutingWorkAuthorityCheck"
      )
      const acceptedG1 = newRecords.find(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "CompleteTaskTrackerFacts" &&
          event.observation.factFamilies.some(
            (family) => family.contentIdentity === controlledScenario.graphs.G1.revision
          )
      )
      const specificationReads = newRecords.flatMap(({ event, position }) =>
        event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskWorkSpecificationFacts"
          ? [
              {
                fingerprint: event.observation.factFamily.fingerprint,
                position,
                taskId: event.observation.factFamily.taskId
              }
            ]
          : []
      )
      const claimReads = newRecords.flatMap(({ event }) =>
        event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskClaimFacts"
          ? [event.observation.coverage.taskId]
          : []
      )
      const gitReads = newRecords.flatMap(({ event }) =>
        event._tag === "GitReadIntentRecorded"
          ? [{ read: event.operation._tag, taskId: event.operation.plannedAttempt.taskId }]
          : []
      )
      const suspendIntents = newRecords.flatMap(({ event, position }) =>
        event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Suspend"
          ? [{ attemptId: event.plannedAttempt.attemptId, ordinal: event.ordinal, position }]
          : []
      )
      const suspendResponses = newRecords.flatMap(({ event, position }) =>
        event._tag === "PlannedAttemptExecutorCommandResponseObserved" && event.commandOrdinal === 2
          ? [{ attemptId: event.plannedAttempt.attemptId, position, report: event.report._tag }]
          : []
      )
      const newActions = ds04.after.executedActions.slice(ds04.beforeTimer.executedActions.length)
      const outsideBoundActions = newActions.filter(({ taskId }) => taskId === "D" || taskId === "E")
      const timerPublications = ds04.after.publications.slice(ds04.beforeTimer.publications.length)
      const heldAttemptsByPublication = timerPublications.map(({ actionInputs }) =>
        actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId).toSorted()
      )
      const bSuspensionPublications = timerPublications.filter(({ publication }) =>
        publication.exactEvidence.some(
          (evidence) =>
            evidence._tag === "ResponsibilityFacts" &&
            evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
            evidence.facts.responsibility.plannedAttempt.attemptId === controlledScenario.attempts.B1 &&
            evidence.facts.disposition._tag === "PlannedAttemptExecutorSuspensionRequested"
        )
      )
      const heldAttempts = ds04.after.publications
        .at(-1)
        ?.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId)
        .toSorted()
      const releaseEvidence = newRecords.filter(({ event }) =>
        event._tag === "PlannedAttemptExecutorWorkReported" ||
        event._tag === "PlannedAttemptExecutorCommandResponseObserved"
          ? event.report._tag === "ExecutorWorkSafelySuspended" || event.report._tag === "ExecutorWorkTerminal"
          : false
      )
      const duplicateExecutingReports = newRecords.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          [controlledScenario.attempts.A1, controlledScenario.attempts.B1, controlledScenario.attempts.C1].includes(
            event.report.correlation.attemptId
          ) &&
          event.report._tag === "ExecutorWorkExecuting"
      )
      const bSpecification = specificationReads.find(({ taskId }) => taskId === controlledScenario.taskIds.B)

      expect(ds04.activeRefreshSources).toEqual(["Timer"])
      expect(ds04.activeRefreshCount).toBe(1)
      expect(authorityGraphReads).toHaveLength(1)
      expect(acceptedG1).toBeDefined()
      expect(specificationReads).toHaveLength(3)
      expect(specificationReads).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ fingerprint: controlledScenario.specifications.F1.A.fingerprint, taskId: "A" }),
          expect.objectContaining({ fingerprint: controlledScenario.specifications.F2.B.fingerprint, taskId: "B" }),
          expect.objectContaining({ fingerprint: controlledScenario.specifications.F1.C.fingerprint, taskId: "C" })
        ])
      )
      expect(claimReads).toHaveLength(2)
      expect(new Set(claimReads)).toEqual(new Set(["A", "C"]))
      expect(gitReads).toHaveLength(4)
      expect(gitReads).toEqual(
        expect.arrayContaining([
          { read: "ReadTaskWorktree", taskId: "A" },
          { read: "ReadTargetLineage", taskId: "A" },
          { read: "ReadTaskWorktree", taskId: "C" },
          { read: "ReadTargetLineage", taskId: "C" }
        ])
      )
      for (const taskId of ["A", "C"]) {
        expect(gitReads.findIndex((read) => read.taskId === taskId && read.read === "ReadTaskWorktree")).toBeLessThan(
          gitReads.findIndex((read) => read.taskId === taskId && read.read === "ReadTargetLineage")
        )
      }
      expect(suspendIntents).toEqual([expect.objectContaining({ attemptId: "attempt:B:1", ordinal: 2 })])
      expect(suspendResponses).toEqual([
        expect.objectContaining({ attemptId: "attempt:B:1", report: "ExecutorWorkExecuting" })
      ])
      expect(suspendResponses[0]?.position).toBeGreaterThan(suspendIntents[0]?.position ?? 0)
      expect(bSpecification?.position).toBeGreaterThan(acceptedG1?.position ?? 0)
      expect(suspendIntents[0]?.position).toBeGreaterThan(bSpecification?.position ?? 0)
      expect(run.commands).toEqual([
        { attemptId: "attempt:A:1", command: "Begin" },
        { attemptId: "attempt:B:1", command: "Begin" },
        { attemptId: "attempt:C:1", command: "Begin" },
        { attemptId: "attempt:B:1", command: "Suspend" }
      ])
      expect(outsideBoundActions).toEqual([])
      expect(heldAttemptsByPublication.length).toBeGreaterThan(0)
      expect(heldAttemptsByPublication).toEqual(
        heldAttemptsByPublication.map(() => ["attempt:A:1", "attempt:B:1", "attempt:C:1"])
      )
      expect(bSuspensionPublications.length).toBeGreaterThan(0)
      expect(heldAttempts).toEqual(["attempt:A:1", "attempt:B:1", "attempt:C:1"])
      expect(releaseEvidence).toEqual([])
      expect(duplicateExecutingReports).toEqual([])
    }),
  capstoneTimeout
)

it.effect(
  "consumes a staggered graph while restart-added X waits for recovered capacity",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedRun
      const established = run.deliveryFrames.filter(({ graph }) => graph._tag === "Established")
      const completeTopology = established.find(
        ({ graph }) => graph._tag === "Established" && graph.tasks.length === 10
      )
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
      expect(
        run.deliveryFrames.every(({ capacity, heldPositions }) => capacity === 2 && heldPositions.length <= 2)
      ).toBe(true)
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
    }),
  capstoneTimeout
)

it.effect(
  "preserves the double-diamond middle positions across coordinator restart",
  () =>
    Effect.gen(function* () {
      const run = yield* cachedRun
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
      expect(run.deliveryFrames[xHeld]?.heldPositions.some(({ taskId }) => taskId === "B" || taskId === "C")).toBe(
        false
      )
    }),
  capstoneTimeout
)
