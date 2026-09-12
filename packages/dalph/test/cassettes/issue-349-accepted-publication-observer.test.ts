import { it } from "@effect/vitest"
import { AttemptId, PlannedTaskAttempt } from "@dalph/contracts"
import {
  PlannedAttemptExecutorReportOrdinal,
  OperationId,
  TaskLifecycle,
  type MaterializedDeliveryAction
} from "@dalph/orchestrator"
import { Deferred, Effect } from "effect"
import { expect } from "vitest"
import { issue268ControlledDeliveryCharacterization as scenario } from "../../test-support/issue-268-controlled-characterization-catalog.js"
import {
  observeIssue268ActivationFailure,
  runIssue349AcceptedPublicationObserver,
  validateIssue268Ds13Action
} from "../../test-support/issue-268-controlled-characterization.js"

// #349 steps 1–4: accepted G4 active refresh -> returned activation -> one trailing Ordinary -> exact waiting C1.
it.effect(
  "accepted publication from active refresh starts one trailing ordinary activation",
  () =>
    Effect.gen(function* () {
      const result = yield* runIssue349AcceptedPublicationObserver

      // Inspect the actual selected observation and mutate its recorded route for the rejection controls.
      const observed = result.bObservations[0]
      expect(observed).toBeDefined()
      if (
        observed?._tag !== "IdentityFreeAction" ||
        observed.proposal.route._tag !== "FreshExecutorWorkflowRoute" ||
        observed.proposal.route.step._tag !== "ObservePlannedAttemptExecutorWork"
      ) {
        return yield* Effect.die("DS-13 requires an actual B1 observation")
      }
      const proposal = observed.proposal
      const step = observed.proposal.route.step
      expect(step.plannedAttempt.attemptId).toBe(scenario.attempts.B1)
      expect(step.acceptedProgress._tag).toBe("ExecutorReportAccepted")
      const rejected: ReadonlyArray<readonly [string, MaterializedDeliveryAction]> = [
        [
          "wrong B2",
          {
            _tag: "IdentityFreeAction",
            proposal: {
              ...proposal,
              route: {
                _tag: "FreshExecutorWorkflowRoute",
                step: {
                  ...step,
                  plannedAttempt: PlannedTaskAttempt.make({
                    ...step.plannedAttempt,
                    attemptId: AttemptId.make("unexpected-B2")
                  })
                }
              }
            }
          }
        ],
        [
          "foreign admission",
          {
            _tag: "IdentityFreeAction",
            proposal: {
              ...proposal,
              admission: {
                ...proposal.admission,
                taskWorkPosition: {
                  _tag: "TaskWorkPositionRequired",
                  mode: "ReserveOrReuse",
                  taskId: scenario.taskIds.C
                }
              }
            }
          }
        ],
        [
          "wrong progress",
          {
            _tag: "IdentityFreeAction",
            proposal: {
              ...proposal,
              route: {
                _tag: "FreshExecutorWorkflowRoute",
                step: {
                  ...step,
                  acceptedProgress: {
                    _tag: "ExecutorReportAccepted",
                    ordinal: PlannedAttemptExecutorReportOrdinal.make(999)
                  }
                }
              }
            }
          }
        ],
        [
          "unexpected B route",
          {
            _tag: "IdentityFreeAction",
            proposal: {
              ...proposal,
              route: {
                _tag: "FreshExecutorWorkflowRoute",
                step: {
                  _tag: "BeginPlannedAttemptExecutorWork",
                  claimOperationId: OperationId.make("unexpected-B-Begin-claim"),
                  plannedAttempt: step.plannedAttempt,
                  specification: scenario.specifications.F1.B,
                  task: {
                    id: scenario.taskIds.B,
                    lifecycle: TaskLifecycle.cases.Open.make({}),
                    parentTaskId: null,
                    prerequisiteIds: []
                  }
                }
              }
            }
          }
        ]
      ]
      for (const [name, action] of rejected) {
        const failed = yield* Deferred.make<unknown>()
        const exit = yield* Effect.exit(
          observeIssue268ActivationFailure(validateIssue268Ds13Action(action, undefined, result.bRecords), failed)
        )
        expect(exit._tag, name).toBe("Failure")
        if (exit._tag === "Failure") expect(yield* Deferred.await(failed), name).toBe(exit.cause)
      }

      expect(result.activationTimeline).toEqual([
        "ActiveWorkAuthorityRefresh:enter",
        "G4:accepted",
        "ActiveWorkAuthorityRefresh:return",
        "OwnerIdle:3",
        "TrailingOrdinary:enter",
        "C1:revalidation-published"
      ])
      expect(result.notificationCount).toBe(1)
      expect(result.activeRefreshCount).toBe(1)
      expect(result.ordinaryActivationCount).toBe(1)
      expect(result.trailingActivationCount).toBe(1)
      expect(result.establishmentPublication.publication.graph._tag).toBe("GraphNotEstablished")
      expect(result.establishmentPublication.actionInputs.trackerGraphProposals).toMatchObject([
        { route: { _tag: "TrackerGraphReadRoute", purpose: "EstablishCurrentGraph" } }
      ])
      expect(result.establishmentPublication.actionInputs.runtimeFacts.taskWork.safeContinuationRevalidations).toEqual(
        []
      )
      expect(result.reopened.publication.graph).toMatchObject({
        _tag: "GraphEstablished",
        observation: { snapshot: { revision: scenario.graphs.G4.revision } }
      })
      expect(result.reopened.actionInputs.runtimeFacts.taskWork.capacity).toBe(scenario.policies.P2)
      expect(
        result.reopened.actionInputs.runtimeFacts.taskWork.safeContinuationRevalidations.map(
          ({ plannedAttempt }) => plannedAttempt.attemptId
        )
      ).toEqual([scenario.attempts.C1])
      expect(result.after.commands).toEqual(result.before.commands)
      expect(
        result.after.commands
          .slice(result.before.commands.length)
          .filter(({ command }) => command === "Begin" || command === "Resume")
      ).toEqual([])
      expect(result.after.claimRequests).toEqual(result.before.claimRequests)
      expect(result.after.plans).toEqual(result.before.plans)
      expect(result.after.worktreeCreateRequests).toEqual(result.before.worktreeCreateRequests)
      expect(result.after.executedActions.filter(({ taskId }) => taskId === scenario.taskIds.E)).toEqual(
        result.before.executedActions.filter(({ taskId }) => taskId === scenario.taskIds.E)
      )

      const suffix = result.after.records.slice(result.before.records.length)
      expect(
        suffix.flatMap(({ event }) =>
          event._tag === "TaskTrackerReadIntentRecorded" && event.operation._tag === "ReadTrackerGraph"
            ? [{ cause: event.operation.cause._tag, covered: event.operation.readShape.explicitlyCoveredTaskIds }]
            : []
        )
      ).toEqual([
        { cause: "ExecutingWorkAuthorityCheck", covered: [scenario.taskIds.B, scenario.taskIds.D] },
        { cause: "AttemptContinuation", covered: [scenario.taskIds.C] }
      ])
      expect(
        suffix.filter(
          ({ event }) =>
            event._tag === "TaskTrackerFactsObserved" &&
            event.observation._tag === "CompleteTaskTrackerFacts" &&
            event.observation.factFamilies[0].contentIdentity === scenario.graphs.G4.revision
        )
      ).toHaveLength(1)
      expect(suffix.filter(({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended")).toEqual([])
    }),
  120_000
)
