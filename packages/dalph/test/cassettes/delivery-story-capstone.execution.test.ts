import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { plannedAttemptExecutorCorrelation } from "@dalph/contracts"
import {
  deliveryProposalOrderTaskId,
  deriveRunnableFrontier,
  evaluateDeliveryRuntimeInputBundle,
  type DeliveryRelationInputBundle,
  WorkflowResponsibilityState
} from "@dalph/orchestrator"
import { Effect } from "effect"
import { expect } from "vitest"
import {
  runIssue268Ds01Characterization,
  runIssue268Ds02Characterization,
  runIssue268Ds03Characterization,
  runIssue268Ds04Characterization,
  runIssue268Ds05Characterization,
  runIssue268Ds06Characterization,
  runIssue268Ds07Characterization,
  runIssue268Ds08Characterization,
  runIssue268Ds09Characterization,
  runIssue268Ds10Characterization,
  runIssue268Ds11Characterization
} from "../../test-support/issue-268-controlled-characterization.js"
import { issue268ControlledDeliveryCharacterization as controlledScenario } from "../../test-support/issue-268-controlled-characterization-catalog.js"
import { isIssue268RetainedBResponsibility } from "../../test-support/issue-268-controlled-ds06.js"
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
  "DS-05 accepts exact B1 Safe and releases only B1's position",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268Ds05Characterization
      const ds05 = run.ds05
      const newRecords = ds05.after.records.slice(ds05.beforeSafe.records.length)
      const safeObservations = newRecords.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorStateObserved" &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.B1 &&
          event.observation._tag === "ExactExecutorReport" &&
          event.observation.report._tag === "ExecutorWorkSafelySuspended"
      )
      const safeObservation = safeObservations[0]
      const safeReports = newRecords.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.report.correlation.attemptId === controlledScenario.attempts.B1 &&
          event.report._tag === "ExecutorWorkSafelySuspended"
      )
      const safeReport = safeReports[0]
      const priorSuspendResponse = ds05.beforeSafe.records.findLast(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.B1 &&
          event.commandOrdinal === 2 &&
          event.report._tag === "ExecutorWorkExecuting"
      )
      const beforeHeld = ds05.beforeSafe.publications
        .at(-1)
        ?.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId)
        .toSorted()
      const afterHeld = ds05.checkpointPublication.actionInputs.runtimeFacts.taskWork.held
        .map(({ correlation }) => correlation.attemptId)
        .toSorted()
      const runtime = yield* evaluateDeliveryRuntimeInputBundle(ds05.checkpointPublication)
      const bFacts = runtime.current.ticketDeliveries.deliveries
        .find(({ taskId }) => taskId === controlledScenario.taskIds.B)
        ?.standings.flatMap((standing) => (standing._tag === "ResponsibilitySituation" ? [standing.facts] : []))[0]
      if (bFacts === undefined) return expect.fail("DS-05 must retain B1 responsibility facts")
      const changedB = deriveRunnableFrontier({
        freshEligibleTasks: [],
        responsibility: WorkflowResponsibilityState.make({ entries: [bFacts.responsibility] }),
        responsibilityFacts: [bFacts]
      }).explanations.find(
        (explanation) =>
          explanation._tag === "PlannedAttemptTaskSpecificationChangeConstraint" &&
          explanation.taskId === controlledScenario.taskIds.B
      )
      const retainedB = run.plans.find(({ attemptId }) => attemptId === controlledScenario.attempts.B1)
      if (retainedB === undefined) return expect.fail("DS-05 must retain B1's exact durable plan")
      const beforeB = ds05.beforeSafe.plans.find(({ attemptId }) => attemptId === controlledScenario.attempts.B1)
      const afterB = ds05.after.plans.find(({ attemptId }) => attemptId === controlledScenario.attempts.B1)
      const newActions = ds05.after.executedActions.slice(ds05.beforeSafe.executedActions.length)
      const newCommands = ds05.after.commands.slice(ds05.beforeSafe.commands.length)
      const bClaimRecords = ds05.after.records.filter(
        ({ event }) => event._tag === "TaskClaimAcquired" && event.claim.taskId === controlledScenario.taskIds.B
      )
      const bPlanRecords = ds05.after.records.filter(
        ({ event }) =>
          event._tag === "TaskAttemptPlanned" &&
          event.operation.plannedAttempt.attemptId === controlledScenario.attempts.B1
      )
      const bWorktreeIntents = ds05.after.records.filter(
        ({ event }) =>
          event._tag === "TaskWorktreeReconciliationIntended" &&
          event.operation.plannedAttempt.attemptId === controlledScenario.attempts.B1
      )
      const bWorktreeOperationId = bWorktreeIntents[0]?.event
      const bWorktreeReady = ds05.after.records.filter(
        ({ event }) =>
          event._tag === "TaskWorktreeReady" &&
          bWorktreeOperationId?._tag === "TaskWorktreeReconciliationIntended" &&
          event.operationId === bWorktreeOperationId.operation.operationId
      )
      const forbiddenEvents = new Set([
        "TaskClaimReleased",
        "WorktreeCleanupAuthorized",
        "WorktreeCleanupMutationIntended",
        "WorktreeCleanupMutationResultRecorded",
        "WorktreeCleanupSettled",
        "PlannedAttemptExecutorCommandIntended"
      ])
      expect(priorSuspendResponse).toBeDefined()
      expect(safeObservations).toHaveLength(1)
      expect(safeReports).toHaveLength(1)
      expect(safeReport?.event._tag).toBe("PlannedAttemptExecutorWorkReported")
      if (safeReport?.event._tag === "PlannedAttemptExecutorWorkReported") expect(safeReport.event.ordinal).toBe(2)
      expect(safeObservation?.position).toBeGreaterThan(priorSuspendResponse?.position ?? 0)
      expect(safeReport?.position).toBeGreaterThan(safeObservation?.position ?? 0)
      // The release-path test proves publication-before-release at the boundary; this composed run proves
      // the accepted Safe position is present before the post-release A1/C1 projection is published.
      expect(ds05.checkpointPublication.actionInputs.runtimeFacts.acceptedAt).toBeGreaterThanOrEqual(
        safeReport?.position ?? Number.MAX_SAFE_INTEGER
      )
      expect(beforeHeld).toEqual(["attempt:A:1", "attempt:B:1", "attempt:C:1"])
      expect(afterHeld).toEqual(["attempt:A:1", "attempt:C:1"])
      expect(changedB).toMatchObject({
        availableResolutions: ["ContinueExistingAttempt", "RestartTaskImplementation", "StopTaskImplementation"],
        correlation: { attemptId: controlledScenario.attempts.B1, runId: controlledScenario.runId },
        observedFingerprint: controlledScenario.specifications.F2.B.fingerprint,
        plannedFingerprint: controlledScenario.specifications.F1.B.fingerprint,
        taskId: controlledScenario.taskIds.B
      })
      expect(retainedB).toMatchObject({
        attemptId: controlledScenario.attempts.B1,
        baseSha: controlledScenario.baseSha,
        runId: controlledScenario.runId,
        taskId: controlledScenario.taskIds.B,
        taskRevision: controlledScenario.specifications.F1.B.fingerprint
      })
      expect(afterB).toEqual(beforeB)
      expect(run.plans.filter(({ taskId }) => taskId === controlledScenario.taskIds.B)).toHaveLength(1)
      expect(bFacts.responsibility).toMatchObject({
        _tag: "PlannedAttemptExecutorWorkResponsibility",
        plannedAttempt: retainedB
      })
      expect(bClaimRecords).toHaveLength(1)
      expect(bClaimRecords[0]?.event).toMatchObject({
        claim: ds05.after.claimRequests.find(({ taskId }) => taskId === "B")
      })
      expect(bPlanRecords).toHaveLength(1)
      expect(bPlanRecords[0]?.event).toMatchObject({ operation: { plannedAttempt: retainedB } })
      expect(bWorktreeIntents).toHaveLength(1)
      expect(bWorktreeReady).toHaveLength(1)
      expect(bWorktreeReady[0]?.event).toMatchObject({
        proof: {
          _tag: "PlannedWorktreeReady",
          baseSha: retainedB.baseSha,
          branch: retainedB.branch,
          headSha: retainedB.baseSha,
          worktree: retainedB.worktree
        }
      })
      expect(ds05.after.claimRequests).toEqual(ds05.beforeSafe.claimRequests)
      expect(ds05.after.worktreeCreateRequests).toEqual(ds05.beforeSafe.worktreeCreateRequests)
      expect(ds05.lifecycleAttachAttemptIds.toSorted()).toEqual([
        controlledScenario.attempts.A1,
        controlledScenario.attempts.B1,
        controlledScenario.attempts.C1
      ])
      expect(run.ds04.activeRefreshCount).toBe(1)
      expect(newCommands).toEqual([])
      expect(newActions.filter(({ taskId }) => taskId === "D" || taskId === "E")).toEqual([])
      expect(
        newRecords.filter(
          ({ event }) =>
            event._tag === "GitReadIntentRecorded" ||
            (event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag !== "ReadTrackerGraph")
        )
      ).toEqual([])
      expect(
        newRecords.filter(
          ({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkReported" &&
            event.report.correlation.attemptId !== controlledScenario.attempts.B1 &&
            (event.report._tag === "ExecutorWorkSafelySuspended" || event.report._tag === "ExecutorWorkTerminal")
        )
      ).toEqual([])
      expect(newRecords.filter(({ event }) => forbiddenEvents.has(event._tag))).toEqual([])
    }),
  capstoneTimeout
)

it.effect(
  "DS-06 admits D only after B1 releases and keeps E outside every boundary",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268Ds06Characterization
      const ds06 = run.ds06
      const newRecords = ds06.after.records.slice(ds06.beforeD.records.length)
      const newActions = ds06.after.executedActions.slice(ds06.beforeD.executedActions.length)
      const newClaims = ds06.after.claimRequests.slice(ds06.beforeD.claimRequests.length)
      const newCommands = ds06.after.commands.slice(ds06.beforeD.commands.length)
      const newPlans = ds06.after.plans.slice(ds06.beforeD.plans.length)
      const newWorktrees = ds06.after.worktreeCreateRequests.slice(ds06.beforeD.worktreeCreateRequests.length)
      const dPlan = newPlans[0]
      if (dPlan === undefined) return expect.fail("DS-06 must record D1's exact plan")
      const beforeHeld = ds06.beforeD.publications
        .at(-1)
        ?.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId)
        .toSorted()
      const afterHeld = ds06.checkpointPublication.actionInputs.runtimeFacts.taskWork.held
        .map(({ correlation }) => correlation.attemptId)
        .toSorted()
      const beforeOutsideBoundActions = ds06.beforeD.executedActions.filter(
        ({ taskId }) => taskId === controlledScenario.taskIds.D || taskId === controlledScenario.taskIds.E
      )
      const claimIntent = newRecords.find(({ event }) => event._tag === "TaskClaimAcquisitionIntended")
      const acquiredClaim = newRecords.find(({ event }) => event._tag === "TaskClaimAcquired")
      const postClaimGraphIntent = newRecords.find(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.predecessorOperationIds.length === 1
      )
      const specificationIntent = newRecords.find(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTaskWorkSpecification"
      )
      const specificationObservation = newRecords.find(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskWorkSpecificationFacts"
      )
      const planRecord = newRecords.find(({ event }) => event._tag === "TaskAttemptPlanned")
      const worktreeIntent = newRecords.find(({ event }) => event._tag === "TaskWorktreeReconciliationIntended")
      const worktreeReady = newRecords.find(({ event }) => event._tag === "TaskWorktreeReady")
      const responsibility = newRecords.find(
        ({ event }) => event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan"
      )
      const beginIntent = newRecords.find(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")
      const beginResponse = newRecords.find(
        ({ event }) => event._tag === "PlannedAttemptExecutorCommandResponseObserved"
      )
      const acceptedExecuting = newRecords.find(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")
      const postClaimGraphObservation = newRecords.find(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          postClaimGraphIntent?.event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operationId === postClaimGraphIntent.event.operation.operationId
      )
      const forbiddenERecords = newRecords.filter(({ event }) => {
        if (event._tag === "TaskTrackerReadIntentRecorded") {
          return event.operation._tag === "ReadTaskWorkSpecification"
            ? event.operation.taskId === controlledScenario.taskIds.E
            : event.operation._tag === "ReadTrackerGraph"
              ? event.operation.readShape.explicitlyCoveredTaskIds.includes(controlledScenario.taskIds.E)
              : false
        }
        if (
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "FocusedTaskWorkSpecificationFacts"
        ) {
          return event.observation.factFamily.taskId === controlledScenario.taskIds.E
        }
        if (event._tag === "TaskClaimAcquisitionIntended") return event.operation.acquisition.taskId === "E"
        if (event._tag === "TaskClaimAcquired") return event.claim.taskId === "E"
        if (event._tag === "TaskAttemptPlanned" || event._tag === "TaskWorktreeReconciliationIntended") {
          return event.operation.plannedAttempt.taskId === "E"
        }
        if (
          event._tag === "PlannedAttemptExecutorWorkResponsibilityBegan" ||
          event._tag === "PlannedAttemptExecutorCommandIntended" ||
          event._tag === "PlannedAttemptExecutorCommandResponseObserved"
        ) {
          return event.plannedAttempt.taskId === "E"
        }
        return false
      })
      const forbiddenReleaseOrCleanup = newRecords.filter(({ event }) =>
        new Set([
          "TaskClaimReleased",
          "WorktreeCleanupAuthorized",
          "WorktreeCleanupMutationIntended",
          "WorktreeCleanupMutationResultRecorded",
          "WorktreeCleanupSettled"
        ]).has(event._tag)
      )
      const runtime = yield* evaluateDeliveryRuntimeInputBundle(ds06.checkpointPublication)
      const retainedB = runtime.current.ticketDeliveries.deliveries
        .find(({ taskId }) => taskId === controlledScenario.taskIds.B)
        ?.standings.flatMap((standing) => (standing._tag === "ResponsibilitySituation" ? [standing.facts] : []))[0]

      expect(ds06.r5ReleaseCount).toBe(1)
      expect(ds06.dActionAbsentBeforeBRelease).toBe(true)
      expect(beforeHeld).toEqual([controlledScenario.attempts.A1, controlledScenario.attempts.C1])
      expect(beforeOutsideBoundActions).toEqual([])
      expect(afterHeld).toEqual([
        controlledScenario.attempts.A1,
        controlledScenario.attempts.C1,
        controlledScenario.attempts.D1
      ])
      // A naturally occurring pre-claim graph read is inventory evidence, not a DS-06 requirement.
      expect(newActions.filter(({ stage }) => stage !== "ReadCurrentTaskGraph")).toEqual(
        [
          "AcquireTaskClaim",
          "ReadPostClaimGraph",
          "ReadTaskWorkSpecification",
          "RecordTaskAttemptPlan",
          "ReconcileTaskWorktree",
          "BeginPlannedAttemptExecutorWork"
        ].map((stage) => ({ stage, taskId: controlledScenario.taskIds.D }))
      )
      expect(newClaims).toEqual([
        expect.objectContaining({ owner: "issue-268-controlled-owner", taskId: controlledScenario.taskIds.D })
      ])
      expect(newClaims[0]?.token).toBe(`issue-268-controlled-claim:D:${newClaims[0]?.operationId}`)
      expect(newCommands).toEqual([{ attemptId: controlledScenario.attempts.D1, command: "Begin" }])
      expect(dPlan).toMatchObject({
        attemptId: controlledScenario.attempts.D1,
        baseSha: controlledScenario.baseSha,
        branch: "refs/heads/dalph/issue-268-d-1",
        executor: "executor:issue-268-controlled",
        runId: controlledScenario.runId,
        taskId: controlledScenario.taskIds.D,
        taskRevision: controlledScenario.specifications.F1.D.fingerprint,
        worktree: "/dalph/controlled-characterization/issue-268/D-1"
      })
      expect(newWorktrees).toEqual([dPlan])
      expect(claimIntent?.event).toMatchObject({ operation: { acquisition: newClaims[0] } })
      expect(acquiredClaim?.event).toMatchObject({ claim: { _tag: "ActiveTaskClaim", ...newClaims[0] } })
      expect(postClaimGraphIntent?.event).toMatchObject({
        operation: {
          predecessorOperationIds: [newClaims[0]?.operationId],
          readShape: { _tag: "CompleteTargetClosure", explicitlyCoveredTaskIds: [controlledScenario.taskIds.D] }
        }
      })
      expect(postClaimGraphObservation?.event).toMatchObject({
        observation: { _tag: "UnchangedTaskTrackerFactsReconfirmed" }
      })
      if (
        postClaimGraphObservation?.event._tag === "TaskTrackerFactsObserved" &&
        postClaimGraphObservation.event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
      ) {
        expect(
          postClaimGraphObservation.event.observation.factFamilies.every(
            ({ contentIdentity }) => contentIdentity === controlledScenario.graphs.G1.revision
          )
        ).toBe(true)
      }
      expect(specificationIntent?.event).toMatchObject({
        operation: {
          predecessorOperationIds: [
            postClaimGraphIntent?.event._tag === "TaskTrackerReadIntentRecorded"
              ? postClaimGraphIntent.event.operation.operationId
              : undefined
          ],
          taskId: controlledScenario.taskIds.D
        }
      })
      expect(specificationObservation?.event).toMatchObject({
        observation: {
          factFamily: {
            fingerprint: controlledScenario.specifications.F1.D.fingerprint,
            taskId: controlledScenario.taskIds.D
          }
        }
      })
      expect(planRecord?.event).toMatchObject({ operation: { plannedAttempt: dPlan } })
      expect(worktreeIntent?.event).toMatchObject({ operation: { plannedAttempt: dPlan } })
      expect(worktreeReady?.event).toMatchObject({
        operationId:
          worktreeIntent?.event._tag === "TaskWorktreeReconciliationIntended"
            ? worktreeIntent.event.operation.operationId
            : undefined,
        proof: {
          _tag: "PlannedWorktreeReady",
          baseSha: dPlan.baseSha,
          branch: dPlan.branch,
          headSha: dPlan.baseSha,
          worktree: dPlan.worktree
        }
      })
      expect(newRecords.filter(({ event }) => event._tag === "TaskWorktreeReady")).toHaveLength(1)
      expect(responsibility?.event).toMatchObject({ plannedAttempt: dPlan })
      expect(beginIntent?.event).toMatchObject({ command: "Begin", ordinal: 1, plannedAttempt: dPlan })
      expect(beginResponse?.event).toMatchObject({
        commandOrdinal: 1,
        plannedAttempt: dPlan,
        report: { _tag: "ExecutorWorkExecuting", correlation: plannedAttemptExecutorCorrelation(dPlan) }
      })
      expect(acceptedExecuting?.event).toMatchObject({
        ordinal: 1,
        report: { _tag: "ExecutorWorkExecuting", correlation: plannedAttemptExecutorCorrelation(dPlan) }
      })
      expect(newRecords.filter(({ event }) => event._tag === "PlannedAttemptExecutorWorkReported")).toHaveLength(1)
      expect(acquiredClaim?.position).toBeGreaterThan(claimIntent?.position ?? Number.MAX_SAFE_INTEGER)
      expect(postClaimGraphIntent?.position).toBeGreaterThan(acquiredClaim?.position ?? Number.MAX_SAFE_INTEGER)
      expect(postClaimGraphObservation?.position).toBeGreaterThan(
        postClaimGraphIntent?.position ?? Number.MAX_SAFE_INTEGER
      )
      expect(specificationIntent?.position).toBeGreaterThan(
        postClaimGraphObservation?.position ?? Number.MAX_SAFE_INTEGER
      )
      expect(specificationObservation?.position).toBeGreaterThan(
        specificationIntent?.position ?? Number.MAX_SAFE_INTEGER
      )
      expect(planRecord?.position).toBeGreaterThan(specificationObservation?.position ?? Number.MAX_SAFE_INTEGER)
      expect(worktreeIntent?.position).toBeGreaterThan(planRecord?.position ?? Number.MAX_SAFE_INTEGER)
      expect(worktreeReady?.position).toBeGreaterThan(worktreeIntent?.position ?? Number.MAX_SAFE_INTEGER)
      expect(responsibility?.position).toBeGreaterThan(worktreeReady?.position ?? Number.MAX_SAFE_INTEGER)
      expect(beginIntent?.position).toBeGreaterThan(responsibility?.position ?? Number.MAX_SAFE_INTEGER)
      expect(beginResponse?.position).toBeGreaterThan(beginIntent?.position ?? Number.MAX_SAFE_INTEGER)
      expect(acceptedExecuting?.position).toBeGreaterThan(beginResponse?.position ?? Number.MAX_SAFE_INTEGER)
      expect(ds06.checkpointPublication.actionInputs.runtimeFacts.acceptedAt).toBeGreaterThanOrEqual(
        acceptedExecuting?.position ?? Number.MAX_SAFE_INTEGER
      )
      expect(ds06.after.plans.filter(({ taskId }) => taskId === controlledScenario.taskIds.B)).toEqual(
        ds06.beforeD.plans.filter(({ taskId }) => taskId === controlledScenario.taskIds.B)
      )
      expect(ds06.after.worktreeCreateRequests.filter(({ taskId }) => taskId === controlledScenario.taskIds.B)).toEqual(
        ds06.beforeD.worktreeCreateRequests.filter(({ taskId }) => taskId === controlledScenario.taskIds.B)
      )
      expect(retainedB).toMatchObject({
        _tag: "PlannedAttemptExecutorFreshFacts",
        disposition: {
          _tag: "TaskSpecificationChangeConstraint",
          observedFingerprint: controlledScenario.specifications.F2.B.fingerprint,
          plannedFingerprint: controlledScenario.specifications.F1.B.fingerprint
        },
        responsibility: {
          _tag: "PlannedAttemptExecutorWorkResponsibility",
          plannedAttempt: ds06.beforeD.plans.find(({ attemptId }) => attemptId === controlledScenario.attempts.B1)
        }
      })
      expect(newActions.filter(({ taskId }) => taskId === controlledScenario.taskIds.E)).toEqual([])
      expect(newClaims.filter(({ taskId }) => taskId === controlledScenario.taskIds.E)).toEqual([])
      expect(newPlans.filter(({ taskId }) => taskId === controlledScenario.taskIds.E)).toEqual([])
      expect(newWorktrees.filter(({ taskId }) => taskId === controlledScenario.taskIds.E)).toEqual([])
      expect(forbiddenERecords).toEqual([])
      expect(forbiddenReleaseOrCleanup).toEqual([])
    }),
  capstoneTimeout
)

it.effect(
  "DS-07 applies P2 without evicting the three already-held attempts",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268Ds07Characterization
      const ds07 = run.ds07

      const newRecords = ds07.after.records.slice(ds07.beforeCapacity.records.length)
      const capacityRecords = newRecords.filter(({ event }) => event._tag === "TaskWorkCapacityChanged")
      const dExecuting = ds07.beforeCapacity.records.find(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.ordinal === 1 &&
          event.report._tag === "ExecutorWorkExecuting" &&
          event.report.correlation.attemptId === controlledScenario.attempts.D1
      )
      const ds06AcceptedAt = ds07.checkpointPublication.actionInputs.runtimeFacts.acceptedAt
      const p2Publications = ds07.after.publications.filter(
        ({ actionInputs }) =>
          actionInputs.runtimeFacts.acceptedAt !== null &&
          actionInputs.runtimeFacts.acceptedAt >= ds07.capacityRecord.position
      )
      const postCapacityActions = ds07.after.executedActions.slice(ds07.beforeCapacity.executedActions.length)
      const expectedHeld = [
        controlledScenario.attempts.A1,
        controlledScenario.attempts.C1,
        controlledScenario.attempts.D1
      ].toSorted()
      const latestHolderReports = expectedHeld.map((attemptId) =>
        ds07.beforeCapacity.records
          .flatMap(({ event }) =>
            event._tag === "PlannedAttemptExecutorWorkReported" && event.report.correlation.attemptId === attemptId
              ? [event]
              : []
          )
          .at(lastItemIndex)
      )
      const held = (publication: DeliveryRelationInputBundle) =>
        publication.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId).toSorted()
      const runtime = yield* evaluateDeliveryRuntimeInputBundle(ds07.p2Publication)
      const retainedB = runtime.current.ticketDeliveries.deliveries
        .find(({ taskId }) => taskId === controlledScenario.taskIds.B)
        ?.standings.flatMap((standing) => (standing._tag === "ResponsibilitySituation" ? [standing.facts] : []))[0]
      const ePlacement = runtime.current.ticketDeliveries.source.placements.find(
        ({ taskId }) => taskId === controlledScenario.taskIds.E
      )?.placement
      const forbiddenPostCapacityEvents = new Set([
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved",
        "GitReadIntentRecorded",
        "TaskClaimAcquisitionIntended",
        "TaskClaimAcquired",
        "TaskClaimReleased",
        "TaskAttemptPlanned",
        "TaskWorktreeReconciliationIntended",
        "TaskWorktreeReady",
        "PlannedAttemptExecutorWorkResponsibilityBegan",
        "PlannedAttemptExecutorCommandIntended",
        "PlannedAttemptExecutorCommandResponseObserved",
        "PlannedAttemptExecutorCommandProjectionObserved",
        "PlannedAttemptExecutorStateObserved",
        "PlannedAttemptExecutorWorkReported",
        "WorktreeCleanupAuthorized",
        "WorktreeCleanupMutationIntended",
        "WorktreeCleanupMutationResultRecorded",
        "WorktreeCleanupSettled"
      ])

      expect(ds07.p1).toEqual({ revision: 1, taskExecutionCapacity: 3 })
      expect(ds07.request).toEqual({
        capacity: controlledScenario.policies.P2,
        expectedRevision: ds07.p1.revision,
        runId: controlledScenario.runId
      })
      expect(ds07.returned).toEqual({ revision: 2, taskExecutionCapacity: 2 })
      expect(ds07.readback).toEqual(ds07.returned)
      expect(capacityRecords).toHaveLength(1)
      expect(ds07.capacityRecord).toEqual(capacityRecords[0])
      expect(ds07.capacityRecord.event).toMatchObject({
        _tag: "TaskWorkCapacityChanged",
        capacity: controlledScenario.policies.P2,
        initiatedBy: { _tag: "Operator" },
        occurrenceClassification: "InitiatedAction",
        previousRevision: 1,
        revision: 2
      })
      expect(dExecuting).toBeDefined()
      expect(ds06AcceptedAt).not.toBeNull()
      expect(ds06AcceptedAt).toBeGreaterThanOrEqual(dExecuting?.position ?? Number.MAX_SAFE_INTEGER)
      expect(ds07.capacityRecord.position).toBeGreaterThan(dExecuting?.position ?? Number.MAX_SAFE_INTEGER)
      expect(ds07.capacityRecord.position).toBeGreaterThan(ds06AcceptedAt ?? Number.MAX_SAFE_INTEGER)
      expect(newRecords).toEqual([ds07.capacityRecord])
      expect(ds07.beforeCapacity.publications.at(-1)).toEqual(ds07.checkpointPublication)
      expect(held(ds07.checkpointPublication)).toEqual(expectedHeld)
      expect(p2Publications.length).toBeGreaterThan(0)
      expect(p2Publications).toEqual(expect.arrayContaining([ds07.p2Publication]))
      for (const publication of p2Publications) {
        expect(publication.publication.policy).toEqual(ds07.returned)
        expect(held(publication)).toEqual(expectedHeld)
      }
      expect(held(ds07.p2Publication)).toEqual(expectedHeld)
      expect(runtime.taskWork.capacity).toBe(controlledScenario.policies.P2)
      expect(latestHolderReports).toMatchObject(
        expectedHeld.map((attemptId) => ({
          _tag: "PlannedAttemptExecutorWorkReported",
          ordinal: 1,
          report: { _tag: "ExecutorWorkExecuting", correlation: { attemptId } }
        }))
      )
      expect(ePlacement).toMatchObject({ _tag: "EligibleOutsideBound" })
      if (runtime.proposedActions._tag !== "DeliveryProposalsAvailable") {
        return expect.fail("DS-07 must retain one coherent, conflict-free proposal frontier")
      }
      expect(runtime.proposedActions.freshTaskCandidates.map(({ taskId }) => taskId)).toContain(
        controlledScenario.taskIds.E
      )
      expect(
        runtime.proposedActions.proposals.flatMap(({ admission }) =>
          admission.taskWorkPosition._tag === "TaskWorkPositionRequired" ? [admission.taskWorkPosition.taskId] : []
        )
      ).not.toContain(controlledScenario.taskIds.E)
      expect(retainedB).toMatchObject({
        _tag: "PlannedAttemptExecutorFreshFacts",
        disposition: {
          _tag: "TaskSpecificationChangeConstraint",
          observedFingerprint: controlledScenario.specifications.F2.B.fingerprint,
          plannedFingerprint: controlledScenario.specifications.F1.B.fingerprint
        },
        responsibility: {
          _tag: "PlannedAttemptExecutorWorkResponsibility",
          plannedAttempt: ds07.beforeCapacity.plans.find(
            ({ attemptId }) => attemptId === controlledScenario.attempts.B1
          )
        }
      })
      // The already-running D1 may be passively observed after P2. That positionless read neither admits work nor
      // commands the executor, and its presence is occurrence-inventory evidence rather than a DS-07 requirement.
      expect(
        postCapacityActions.every(
          ({ stage, taskId }) =>
            stage === "ObservePlannedAttemptExecutorWork" && taskId === controlledScenario.taskIds.D
        )
      ).toBe(true)
      expect(ds07.after.claimRequests.slice(ds07.beforeCapacity.claimRequests.length)).toEqual([])
      expect(ds07.after.plans.slice(ds07.beforeCapacity.plans.length)).toEqual([])
      expect(ds07.after.worktreeCreateRequests.slice(ds07.beforeCapacity.worktreeCreateRequests.length)).toEqual([])
      expect(ds07.after.commands.slice(ds07.beforeCapacity.commands.length)).toEqual([])
      expect(newRecords.filter(({ event }) => forbiddenPostCapacityEvents.has(event._tag))).toEqual([])
      expect(newRecords.filter(({ event }) => event._tag === "TaskWorkCapacityChanged")).toHaveLength(1)
      expect(postCapacityActions.filter(({ taskId }) => taskId === controlledScenario.taskIds.E)).toEqual([])
    }),
  capstoneTimeout
)

it.effect(
  "DS-08 interrupts the first coordinator after published P2 while the external executor state survives",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268Ds08Characterization
      const ds08 = run.ds08
      const before = ds08.beforeLoss.snapshot
      const after = ds08.afterLoss
      const expectedHeld = [
        controlledScenario.attempts.A1,
        controlledScenario.attempts.C1,
        controlledScenario.attempts.D1
      ].toSorted()
      const held = ds08.beforeLoss.ds07.p2Publication.actionInputs.runtimeFacts.taskWork.held
        .map(({ correlation }) => correlation.attemptId)
        .toSorted()
      const reportsByAttempt = new Map(
        [...ds08.projectedReports.values()].map((report) => [report.correlation.attemptId, report] as const)
      )
      const p2EraPublicationsAtCut = after.publications.filter(
        ({ actionInputs }) =>
          actionInputs.runtimeFacts.acceptedAt !== null &&
          actionInputs.runtimeFacts.acceptedAt >= ds08.beforeLoss.ds07.capacityRecord.position
      )
      expect(held).toEqual(expectedHeld)
      expect(ds08.beforeLoss.ds07.p2Publication.publication.policy).toEqual(ds08.beforeLoss.ds07.returned)
      expect(ds08.beforeLoss.ds07.after.records).toContainEqual(ds08.beforeLoss.ds07.capacityRecord)
      expect(ds08.firstProcessInterruptionCount).toBe(1)
      expect(ds08.childScopeFinalizationCount).toBe(1)
      expect(ds08.applicationBuildCount).toBe(1)
      expect(ds08.applicationExitTrace).toEqual([])
      expect(ds08.executorObserveCallsAfterLoss).toBe(ds08.executorObserveCallsBeforeLoss)
      expect(ds08.projectedReports).toEqual(ds08.beforeLoss.projectedReports)
      expect(after.records).toEqual(before.records)
      expect(p2EraPublicationsAtCut).toContainEqual(ds08.beforeLoss.ds07.p2Publication)
      for (const publication of p2EraPublicationsAtCut) {
        expect(publication.publication.policy).toEqual(ds08.beforeLoss.ds07.returned)
        expect(
          publication.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId).toSorted()
        ).toEqual(expectedHeld)
        expect(publication.actionInputs.runtimeFacts.acceptedAt).not.toBeNull()
        expect(publication.actionInputs.runtimeFacts.acceptedAt).toBeGreaterThanOrEqual(
          ds08.beforeLoss.ds07.capacityRecord.position
        )
        const tailRuntime = yield* evaluateDeliveryRuntimeInputBundle(publication)
        if (tailRuntime.proposedActions._tag !== "DeliveryProposalsAvailable") {
          return expect.fail("DS-08 must not leave a conflicting publication at the process-loss cut")
        }
        expect(
          tailRuntime.proposedActions.proposals.flatMap(({ admission }) =>
            admission.taskWorkPosition._tag === "TaskWorkPositionRequired" ? [admission.taskWorkPosition.taskId] : []
          )
        ).not.toContain(controlledScenario.taskIds.E)
      }
      expect(after.commands).toEqual(before.commands)
      expect(after.claimRequests).toEqual(before.claimRequests)
      expect(after.plans).toEqual(before.plans)
      expect(after.worktreeCreateRequests).toEqual(before.worktreeCreateRequests)
      expect(after.requestedTargets).toEqual(before.requestedTargets)
      expect(reportsByAttempt.get(controlledScenario.attempts.A1)).toMatchObject({
        _tag: "ExecutorWorkExecuting",
        correlation: { attemptId: controlledScenario.attempts.A1, runId: controlledScenario.runId }
      })
      expect(reportsByAttempt.get(controlledScenario.attempts.C1)).toMatchObject({
        _tag: "ExecutorWorkExecuting",
        correlation: { attemptId: controlledScenario.attempts.C1, runId: controlledScenario.runId }
      })
      expect(reportsByAttempt.get(controlledScenario.attempts.D1)).toMatchObject({
        _tag: "ExecutorWorkExecuting",
        correlation: { attemptId: controlledScenario.attempts.D1, runId: controlledScenario.runId }
      })
      expect(reportsByAttempt.get(controlledScenario.attempts.B1)).toMatchObject({
        _tag: "ExecutorWorkSafelySuspended",
        correlation: { attemptId: controlledScenario.attempts.B1, runId: controlledScenario.runId }
      })
      expect([...reportsByAttempt.keys()].toSorted()).toEqual(
        [
          controlledScenario.attempts.A1,
          controlledScenario.attempts.B1,
          controlledScenario.attempts.C1,
          controlledScenario.attempts.D1
        ].toSorted()
      )
    }),
  capstoneTimeout
)

it.effect(
  "reattaches three exact attempts after restart without Begin or Resume",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268Ds09Characterization
      const ds09 = run.ds09
      const expectedHeld = [
        controlledScenario.attempts.A1,
        controlledScenario.attempts.C1,
        controlledScenario.attempts.D1
      ].toSorted()
      const observations = ds09.executorObservations
      const secondPublications = ds09.after.publications
      const journalSuffix = ds09.after.records.slice(ds09.beforeLoss.snapshot.records.length)
      const trackerRequestSuffix = ds09.after.requestedTargets.slice(ds09.beforeLoss.snapshot.requestedTargets.length)
      const held = (publication: DeliveryRelationInputBundle) =>
        publication.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId).toSorted()
      const preLossPlans = new Map(
        ds09.beforeLoss.snapshot.plans.map((plannedAttempt) => [plannedAttempt.attemptId, plannedAttempt] as const)
      )

      expect(observations.map(({ correlation }) => correlation.attemptId)).toEqual([
        controlledScenario.attempts.A1,
        controlledScenario.attempts.C1,
        controlledScenario.attempts.D1
      ])
      expect(observations.every(({ purpose }) => purpose._tag === "PassiveLifecycleObservation")).toBe(true)
      for (const { currentGraphPublication } of observations) {
        expect(currentGraphPublication).toMatchObject({
          publication: {
            graph: { _tag: "GraphEstablished", observation: { snapshot: controlledScenario.graphs.G1 } },
            policy: ds09.beforeLoss.ds07.returned
          }
        })
      }
      expect(
        observations.map(({ projection }) =>
          projection._tag === "Exact"
            ? { attemptId: projection.report.correlation.attemptId, report: projection.report._tag }
            : projection
        )
      ).toEqual([
        { attemptId: controlledScenario.attempts.A1, report: "ExecutorWorkExecuting" },
        { attemptId: controlledScenario.attempts.C1, report: "ExecutorWorkExecuting" },
        { attemptId: controlledScenario.attempts.D1, report: "ExecutorWorkExecuting" }
      ])
      expect(observations.map(({ correlation }) => correlation.runId)).toEqual([
        controlledScenario.runId,
        controlledScenario.runId,
        controlledScenario.runId
      ])
      for (const observation of observations) {
        expect(observation.plannedAttempt).toEqual(preLossPlans.get(observation.correlation.attemptId))
        expect(observation.admission.taskWorkPosition).toEqual({
          _tag: "TaskWorkPositionRequired",
          mode: "ReserveOrReuse",
          taskId: observation.plannedAttempt.taskId
        })
        expect(observation.admission.plannedAttemptProtocolCorrelation).toEqual(observation.correlation)
      }
      expect(ds09.after.commands).toEqual([])
      expect(ds09.after.claimRequests).toEqual([])
      expect(ds09.after.plans).toEqual([])
      expect(ds09.after.worktreeCreateRequests).toEqual(ds09.beforeLoss.snapshot.worktreeCreateRequests)
      expect(journalSuffix.map(({ event }) => event._tag)).toEqual([
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved"
      ])
      expect(journalSuffix[0]?.event).toMatchObject({
        operation: { _tag: "ReadTrackerGraph", cause: { _tag: "WorkflowEstablishment" } }
      })
      expect(journalSuffix[1]?.event).toMatchObject({ observation: { _tag: "UnchangedTaskTrackerFactsReconfirmed" } })
      expect(trackerRequestSuffix).toEqual([controlledScenario.target])
      expect(secondPublications.length).toBeGreaterThan(0)
      for (const publication of secondPublications) {
        expect(publication.publication.policy).toEqual(ds09.beforeLoss.ds07.returned)
        expect(held(publication)).toEqual(expectedHeld)
        expect(publication.publication.exactEvidence.some(isIssue268RetainedBResponsibility)).toBe(true)
      }
    }),
  capstoneTimeout
)

it.effect(
  "returns RunnableTransition after strict restart projections before the later refresh",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268Ds09Characterization
      const ds09 = run.ds09
      expect(ds09.decision).toEqual({ _tag: "RunMustRemainActive", reason: "RunnableTransition" })
      expect(ds09.applicationBuildCount).toBe(2)
      expect(ds09.firstProcessInterruptionCount).toBe(1)
      expect(ds09.ordinaryOwnerActivationCount).toBe(1)
      expect(ds09.ordinaryOwnerActivationOpportunities).toEqual(["OrdinaryRunEntry"])
      expect(ds09.applicationExitTrace).toEqual([])
      expect(ds09.projectedReports).toEqual(ds09.beforeLoss.projectedReports)
      const expectedHeld = [
        controlledScenario.attempts.A1,
        controlledScenario.attempts.C1,
        controlledScenario.attempts.D1
      ].toSorted()
      const reportsByAttempt = new Map(
        [...ds09.projectedReports.values()].map((report) => [report.correlation.attemptId, report] as const)
      )
      expect(reportsByAttempt.get(controlledScenario.attempts.A1)).toMatchObject({
        _tag: "ExecutorWorkExecuting",
        correlation: { attemptId: controlledScenario.attempts.A1, runId: controlledScenario.runId }
      })
      expect(reportsByAttempt.get(controlledScenario.attempts.C1)).toMatchObject({
        _tag: "ExecutorWorkExecuting",
        correlation: { attemptId: controlledScenario.attempts.C1, runId: controlledScenario.runId }
      })
      expect(reportsByAttempt.get(controlledScenario.attempts.D1)).toMatchObject({
        _tag: "ExecutorWorkExecuting",
        correlation: { attemptId: controlledScenario.attempts.D1, runId: controlledScenario.runId }
      })
      expect(reportsByAttempt.get(controlledScenario.attempts.B1)).toMatchObject({
        _tag: "ExecutorWorkSafelySuspended",
        correlation: { attemptId: controlledScenario.attempts.B1, runId: controlledScenario.runId }
      })
      const publication = ds09.reconstructedPublication
      expect(
        publication.actionInputs.runtimeFacts.taskWork.held.map(({ correlation }) => correlation.attemptId).toSorted()
      ).toEqual(expectedHeld)
      const runtime = yield* evaluateDeliveryRuntimeInputBundle(publication)
      if (runtime.proposedActions._tag !== "DeliveryProposalsAvailable") {
        return expect.fail("DS-09 must retain a coherent capacity-blocked proposal frontier")
      }
      expect(runtime.proposedActions.freshTaskCandidates.map(({ taskId }) => taskId)).toContain(
        controlledScenario.taskIds.E
      )
      expect(
        runtime.proposedActions.proposals.filter(
          ({ order }) => deliveryProposalOrderTaskId(order) === controlledScenario.taskIds.E
        )
      ).toEqual([])
      const ePlacement = runtime.current.ticketDeliveries.source.placements.find(
        ({ taskId }) => taskId === controlledScenario.taskIds.E
      )?.placement
      expect(ePlacement).toMatchObject({ _tag: "EligibleOutsideBound" })
      expect(
        runtime.proposedActions.proposals.flatMap(({ admission }) =>
          admission.taskWorkPosition._tag === "TaskWorkPositionRequired" ? [admission.taskWorkPosition.taskId] : []
        )
      ).not.toContain(controlledScenario.taskIds.E)
    }),
  capstoneTimeout
)

it.effect(
  "refreshes closed C through the same owner and keeps its position",
  () =>
    Effect.gen(function* () {
      const run = yield* runIssue268Ds10Characterization
      const { ds09, ds10 } = run
      const recordSuffix = ds10.after.records.slice(ds09.after.records.length)
      const requestSuffix = ds10.after.requestedTargets.slice(ds09.after.requestedTargets.length)
      const commandSuffix = ds10.after.commands.slice(ds09.after.commands.length)
      const g2Facts = recordSuffix.filter(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "CompleteTaskTrackerFacts" &&
          event.observation.factFamilies.some(
            ({ contentIdentity }) => contentIdentity === controlledScenario.graphs.G2.revision
          )
      )
      const suspendIntent = recordSuffix.find(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandIntended" &&
          event.command === "Suspend" &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.C1
      )
      const suspendResponse = recordSuffix.find(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorCommandResponseObserved" &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.C1
      )
      const focusedTrackerRecords = recordSuffix.filter(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          (event.observation._tag === "FocusedTaskWorkSpecificationFacts" ||
            event.observation._tag === "FocusedTaskClaimFacts")
      )
      const focusedSpecificationTaskIds = focusedTrackerRecords.flatMap(({ event }) =>
        event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskWorkSpecificationFacts"
          ? [event.observation.factFamily.taskId]
          : []
      )
      const focusedClaimTaskIds = focusedTrackerRecords.flatMap(({ event }) =>
        event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "FocusedTaskClaimFacts"
          ? [event.observation.coverage.taskId]
          : []
      )
      const focusedGitReads = recordSuffix.flatMap(({ event }) =>
        event._tag === "GitReadIntentRecorded"
          ? [{ operation: event.operation._tag, taskId: event.operation.plannedAttempt.taskId }]
          : []
      )
      const gitIntentByOperationId = new Map(
        recordSuffix.flatMap(({ event }) =>
          event._tag === "GitReadIntentRecorded"
            ? [
                [
                  event.operation.operationId,
                  { operation: event.operation._tag, taskId: event.operation.plannedAttempt.taskId }
                ] as const
              ]
            : []
        )
      )
      const completedGitRecords = recordSuffix.filter(
        ({ event }) => event._tag === "PlannedAttemptWorktreeObserved" || event._tag === "TargetLineageObserved"
      )
      const completedGitReads = completedGitRecords.flatMap(({ event }) => {
        if (event._tag !== "PlannedAttemptWorktreeObserved" && event._tag !== "TargetLineageObserved") return []
        const intent = gitIntentByOperationId.get(event.operationId)
        return intent === undefined ? [] : [{ observation: event._tag, taskId: intent.taskId }]
      })
      const expectedFocusedTaskIds = [controlledScenario.taskIds.A, controlledScenario.taskIds.D]
      const expectedHeldAttemptIds = [
        controlledScenario.attempts.A1,
        controlledScenario.attempts.C1,
        controlledScenario.attempts.D1
      ].toSorted()

      expect(ds10.before).toEqual(ds09)
      expect(ds10.notificationCount).toBe(1)
      expect(ds10.activeRefreshCount).toBe(1)
      expect(ds10.activeRefreshDecision).toBeUndefined()
      expect(ds10.activeRefreshSources).toEqual(["TrackerNotification"])
      expect(ds10.executorObserveCallCount).toBe(
        ds09.beforeLoss.executorObserveCalls + ds09.executorObservations.length
      )
      expect(ds10.idleHandoffCount).toBe(1)
      expect(ds10.trailingActivationCount).toBe(0)
      expect(ds09.ordinaryOwnerActivationCount).toBe(1)
      expect(requestSuffix).toEqual([controlledScenario.target, controlledScenario.target, controlledScenario.target])
      expect(commandSuffix).toEqual([{ attemptId: controlledScenario.attempts.C1, command: "Suspend" }])
      expect(ds10.after.claimRequests).toEqual(ds09.after.claimRequests)
      expect(ds10.after.plans).toEqual(ds09.after.plans)
      expect(ds10.after.worktreeCreateRequests).toEqual(ds09.after.worktreeCreateRequests)
      expect(g2Facts).toHaveLength(1)
      expect(focusedSpecificationTaskIds).toEqual(expectedFocusedTaskIds)
      expect(focusedClaimTaskIds).toEqual(expectedFocusedTaskIds)
      expect(focusedGitReads).toEqual([
        { operation: "ReadTaskWorktree", taskId: controlledScenario.taskIds.A },
        { operation: "ReadTaskWorktree", taskId: controlledScenario.taskIds.D },
        { operation: "ReadTargetLineage", taskId: controlledScenario.taskIds.A },
        { operation: "ReadTargetLineage", taskId: controlledScenario.taskIds.D }
      ])
      expect(completedGitReads).toEqual([
        { observation: "PlannedAttemptWorktreeObserved", taskId: controlledScenario.taskIds.A },
        { observation: "PlannedAttemptWorktreeObserved", taskId: controlledScenario.taskIds.D },
        { observation: "TargetLineageObserved", taskId: controlledScenario.taskIds.A },
        { observation: "TargetLineageObserved", taskId: controlledScenario.taskIds.D }
      ])
      expect(suspendIntent?.event).toMatchObject({
        command: "Suspend",
        ordinal: 2,
        plannedAttempt: { attemptId: controlledScenario.attempts.C1, runId: controlledScenario.runId }
      })
      expect(suspendResponse?.event).toMatchObject({
        commandOrdinal: 2,
        report: {
          _tag: "ExecutorWorkExecuting",
          correlation: { attemptId: controlledScenario.attempts.C1, runId: controlledScenario.runId }
        }
      })
      expect(suspendIntent?.position).toBeGreaterThan(g2Facts[0]?.position ?? Number.MAX_SAFE_INTEGER)
      expect(
        focusedTrackerRecords.every(({ position }) => position < (suspendIntent?.position ?? Number.MIN_SAFE_INTEGER))
      ).toBe(true)
      expect(
        completedGitRecords.every(({ position }) => position < (suspendIntent?.position ?? Number.MIN_SAFE_INTEGER))
      ).toBe(true)
      expect(suspendResponse?.position).toBeGreaterThan(suspendIntent?.position ?? Number.MAX_SAFE_INTEGER)
      expect(
        ds10.checkpointPublication.actionInputs.runtimeFacts.taskWork.held
          .map(({ correlation }) => ({ attemptId: correlation.attemptId, runId: correlation.runId }))
          .toSorted((left, right) => left.attemptId.localeCompare(right.attemptId))
      ).toEqual(expectedHeldAttemptIds.map((attemptId) => ({ attemptId, runId: controlledScenario.runId })))
      expect(ds10.checkpointPublication.publication.policy).toEqual(ds09.beforeLoss.ds07.returned)
      expect(ds10.checkpointPublication.publication.graph).toMatchObject({
        _tag: "GraphEstablished",
        observation: { snapshot: controlledScenario.graphs.G2 }
      })
      expect(
        ds10.checkpointPublication.publication.exactEvidence.some(
          (evidence) =>
            evidence._tag === "ResponsibilityFacts" &&
            evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
            evidence.facts.responsibility.plannedAttempt.attemptId === controlledScenario.attempts.C1 &&
            evidence.facts.disposition._tag === "PlannedAttemptExecutorSuspensionRequested"
        )
      ).toBe(true)
      expect(ds10.checkpointPublication.publication.exactEvidence.some(isIssue268RetainedBResponsibility)).toBe(true)
      const runtime = yield* evaluateDeliveryRuntimeInputBundle(ds10.checkpointPublication)
      expect(
        runtime.current.ticketDeliveries.source.placements.find(({ taskId }) => taskId === controlledScenario.taskIds.E)
          ?.placement
      ).toMatchObject({ _tag: "EligibleOutsideBound" })
      if (runtime.proposedActions._tag !== "DeliveryProposalsAvailable") {
        return expect.fail("DS-10 must retain the capacity-blocked E candidate frontier")
      }
      expect(
        runtime.proposedActions.proposals.filter(
          ({ order }) => deliveryProposalOrderTaskId(order) === controlledScenario.taskIds.E
        )
      ).toEqual([])
    }),
  capstoneTimeout
)

it.effect(
  "accepts exact C1 Safe and releases only C1's position",
  () =>
    Effect.gen(function* () {
      const { ds10, ds11 } = yield* runIssue268Ds11Characterization
      const recordSuffix = ds11.after.records.slice(ds10.after.records.length)
      const safeObservations = recordSuffix.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorStateObserved" &&
          event.plannedAttempt.attemptId === controlledScenario.attempts.C1 &&
          event.plannedAttempt.runId === controlledScenario.runId &&
          event.observation._tag === "ExactExecutorReport" &&
          event.observation.report._tag === "ExecutorWorkSafelySuspended" &&
          event.observation.report.correlation.attemptId === controlledScenario.attempts.C1 &&
          event.observation.report.correlation.runId === controlledScenario.runId
      )
      const safeReports = recordSuffix.filter(
        ({ event }) =>
          event._tag === "PlannedAttemptExecutorWorkReported" &&
          event.ordinal === 2 &&
          event.report._tag === "ExecutorWorkSafelySuspended" &&
          event.report.correlation.attemptId === controlledScenario.attempts.C1 &&
          event.report.correlation.runId === controlledScenario.runId
      )
      const safeObservation = safeObservations[0]
      const safeReport = safeReports[0]
      const ds10G2 = ds10.after.records.findLast(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" &&
          event.observation._tag === "CompleteTaskTrackerFacts" &&
          event.observation.factFamilies.some(
            ({ contentIdentity }) => contentIdentity === controlledScenario.graphs.G2.revision
          )
      )
      const stabilizationIntents = recordSuffix.filter(
        ({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" &&
          event.operation._tag === "ReadTrackerGraph" &&
          event.operation.cause._tag === "PostQuiescenceReconfirmation"
      )
      const stabilizationIntent = stabilizationIntents[0]
      const stabilizationResults = recordSuffix.filter(
        ({ event }) =>
          event._tag === "TaskTrackerFactsObserved" && event.observation._tag === "UnchangedTaskTrackerFactsReconfirmed"
      )
      const stabilizationResult = stabilizationResults[0]
      const expectedHeld = [controlledScenario.attempts.A1, controlledScenario.attempts.D1].map((attemptId) => ({
        attemptId,
        runId: controlledScenario.runId
      }))
      const held = ds11.checkpointPublication.actionInputs.runtimeFacts.taskWork.held
        .map(({ correlation }) => ({ attemptId: correlation.attemptId, runId: correlation.runId }))
        .toSorted((left, right) => left.attemptId.localeCompare(right.attemptId))
      const cResponsibilityBefore = ds10.checkpointPublication.publication.exactEvidence.find(
        (evidence) =>
          evidence._tag === "ResponsibilityFacts" &&
          evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
          evidence.facts.responsibility.plannedAttempt.attemptId === controlledScenario.attempts.C1 &&
          evidence.facts.responsibility.plannedAttempt.runId === controlledScenario.runId
      )
      const cResponsibilityAfter = ds11.checkpointPublication.publication.exactEvidence.find(
        (evidence) =>
          evidence._tag === "ResponsibilityFacts" &&
          evidence.facts.responsibility._tag === "PlannedAttemptExecutorWorkResponsibility" &&
          evidence.facts.responsibility.plannedAttempt.attemptId === controlledScenario.attempts.C1 &&
          evidence.facts.responsibility.plannedAttempt.runId === controlledScenario.runId
      )

      expect(ds11.before).toEqual(ds10)
      expect(ds11.activeRefreshCount).toBe(1)
      expect(ds11.activeRefreshDecision).toBeUndefined()
      expect(ds11.executorObserveCallCount).toBe(ds10.executorObserveCallCount)
      expect(recordSuffix.map(({ event }) => event._tag)).toEqual([
        "PlannedAttemptExecutorStateObserved",
        "PlannedAttemptExecutorWorkReported",
        "TaskTrackerReadIntentRecorded",
        "TaskTrackerFactsObserved"
      ])
      expect(safeObservations).toHaveLength(1)
      expect(safeReports).toHaveLength(1)
      expect(stabilizationIntents).toHaveLength(1)
      expect(stabilizationResults).toHaveLength(1)
      expect(safeReport?.position).toBeGreaterThan(safeObservation?.position ?? Number.MAX_SAFE_INTEGER)
      expect(stabilizationIntent?.position).toBeGreaterThan(safeReport?.position ?? Number.MAX_SAFE_INTEGER)
      expect(stabilizationIntent?.event).toMatchObject({
        operation: {
          cause: {
            _tag: "PostQuiescenceReconfirmation",
            quiescentGraphOperationId:
              ds10G2?.event._tag === "TaskTrackerFactsObserved" ? ds10G2.event.observation.operationId : undefined
          },
          target: controlledScenario.target
        }
      })
      expect(stabilizationResult?.position).toBeGreaterThan(stabilizationIntent?.position ?? Number.MAX_SAFE_INTEGER)
      expect(stabilizationResult?.event).toMatchObject({
        observation: {
          _tag: "UnchangedTaskTrackerFactsReconfirmed",
          operationId:
            stabilizationIntent?.event._tag === "TaskTrackerReadIntentRecorded"
              ? stabilizationIntent.event.operation.operationId
              : undefined,
          priorFullObservationOperationId:
            ds10G2?.event._tag === "TaskTrackerFactsObserved" ? ds10G2.event.observation.operationId : undefined
        }
      })
      expect(ds11.checkpointPublication.actionInputs.runtimeFacts.acceptedAt).toBeGreaterThanOrEqual(
        stabilizationResult?.position ?? Number.MAX_SAFE_INTEGER
      )
      expect(held).toEqual(expectedHeld)
      expect(ds11.checkpointPublication.publication.graph).toMatchObject({
        _tag: "GraphEstablished",
        observation: { snapshot: controlledScenario.graphs.G2 }
      })
      expect(ds11.checkpointPublication.publication.policy).toEqual(ds10.checkpointPublication.publication.policy)
      expect(cResponsibilityAfter).toMatchObject({
        facts: {
          disposition: { _tag: "TaskLifecycleConstraint", lifecycle: "TerminalWithoutSuccess" },
          responsibility:
            cResponsibilityBefore?._tag === "ResponsibilityFacts"
              ? cResponsibilityBefore.facts.responsibility
              : undefined
        }
      })
      expect(ds11.checkpointPublication.publication.exactEvidence.some(isIssue268RetainedBResponsibility)).toBe(true)
      expect(cResponsibilityAfter).toBeDefined()
      expect(ds11.after.requestedTargets.slice(ds10.after.requestedTargets.length)).toEqual([controlledScenario.target])
      expect(ds11.after.claimRequests).toEqual(ds10.after.claimRequests)
      expect(ds11.after.commands).toEqual(ds10.after.commands)
      expect(ds11.after.executedActions).toEqual(ds10.after.executedActions)
      expect(ds11.after.worktreeCreateRequests).toEqual(ds10.after.worktreeCreateRequests)
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
