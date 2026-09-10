import { it } from "@effect/vitest"
import { Effect } from "effect"
import { expect } from "vitest"
import { issue268ControlledDeliveryCharacterization as scenario } from "../../test-support/issue-268-controlled-characterization-catalog.js"
import { runIssue349AcceptedPublicationObserver } from "../../test-support/issue-268-controlled-characterization.js"

// #349 steps 1–4: accepted G4 active refresh -> returned activation -> one trailing Ordinary -> exact waiting C1.
it.effect(
  "accepted publication from active refresh starts one trailing ordinary activation",
  () =>
    Effect.gen(function* () {
      const result = yield* runIssue349AcceptedPublicationObserver

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
