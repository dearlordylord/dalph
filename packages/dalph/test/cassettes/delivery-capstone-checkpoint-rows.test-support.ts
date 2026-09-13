import type { AuthoredScenarioCassetteRun } from "../../src/cassettes/authored-runner.js"
import { expect } from "vitest"
import {
  attempts,
  commandFence,
  continuationPublicationFence,
  occurrenceFence,
  graphFence,
  initialCapacity,
  loweredCapacity,
  predecessorHead,
  recordFence,
  responseFence,
  settlementFence,
  suspendOrdinal,
  type Task,
  terminalFence,
  DS,
  type Fence,
  resumeOrdinal
} from "./delivery-capstone-checkpoint-boundaries.test-support.js"

export interface DeliveryCapstoneCheckpointRow {
  readonly beat: Exclude<(typeof DS)[keyof typeof DS], typeof DS.unavailable>
  readonly graph: string
  readonly capacity: number
  readonly held: ReadonlyArray<Task>
  readonly retained: ReadonlyArray<Task>
  readonly alice: ReadonlyArray<Task>
  readonly closedC?: boolean
  readonly after: Fence
  readonly before: Fence
}

export const rowsFor = (run: AuthoredScenarioCassetteRun): ReadonlyArray<DeliveryCapstoneCheckpointRow> => {
  const bSuspend = commandFence(run, "B", "Suspend")
  const bSuspended = responseFence(run, "B", suspendOrdinal)
  const cSuspend = commandFence(run, "C", "Suspend")
  const cSuspended = responseFence(run, "C", suspendOrdinal)
  const lower = occurrenceFence(
    run,
    (item) => item._tag === "SetTaskExecutionCapacity" && item.capacity === loweredCapacity
  )
  const higher = occurrenceFence(
    run,
    (item) => item._tag === "SetTaskExecutionCapacity" && item.capacity === initialCapacity
  )
  const death = occurrenceFence(run, (item) => item._tag === "CoordinatorProcessDies")
  const continueB = occurrenceFence(
    run,
    (item) => item._tag === "OperatorContinuesAttempt" && item.attemptId === attempts.B
  )
  const continuedB = recordFence(
    run,
    (event) =>
      event._tag === "AttemptChoiceApplied" &&
      event.subject.plannedAttempt.attemptId === attempts.B &&
      event.choice === "ContinueExistingAttempt"
  )
  const queueA = recordFence(
    run,
    (event) => event._tag === "IntegrationResponsibilityBegan" && event.plannedAttempt.attemptId === attempts.A
  )
  const fixedA = recordFence(
    run,
    (event) => event._tag === "IntegratorSessionFixed" && event.correlation.plannedAttempt.attemptId === attempts.A
  )
  const requestA = occurrenceFence(
    run,
    (item) =>
      item._tag === "IntegratorRequestReceived" && item.correlation.session.plannedAttempt.attemptId === attempts.A
  )
  const qualifiedA = recordFence(
    run,
    (event) =>
      event._tag === "IntegratorRunCandidateGitObserved" &&
      event.run.session.plannedAttempt.attemptId === attempts.A &&
      event.run.session.expectedTargetHead === predecessorHead
  )
  const rejectedA = occurrenceFence(
    run,
    (item) => item._tag === "TargetPromotionCompareAndSetReturned" && item.result._tag === "RejectedExpectedHead"
  )
  const staleA = recordFence(
    run,
    (event) =>
      event._tag === "TargetPromotionStale" &&
      event.correlation.qualifiedCandidate.run.session.plannedAttempt.attemptId === attempts.A
  )
  const fullRerun = occurrenceFence(run, (item) => item._tag === "OperatorAppliesIntegrationQuarantineDirection")
  const lastInitial = responseFence(run, "B")
  return [
    {
      beat: DS.entry,
      graph: "G0",
      capacity: initialCapacity,
      held: [],
      retained: [],
      alice: [],
      after: graphFence(run, "G0"),
      before: occurrenceFence(run, (item) => item._tag === "DalphSelects" && item.operation._tag === "AcquireTaskClaim")
    },
    {
      beat: DS.started,
      graph: "G0",
      capacity: initialCapacity,
      held: ["A", "B", "C"],
      retained: [],
      alice: [],
      after: lastInitial,
      before: graphFence(run, "G1")
    },
    {
      beat: DS.changedB,
      graph: "G1",
      capacity: initialCapacity,
      held: ["A", "B", "C"],
      retained: [],
      alice: [],
      after: occurrenceFence(
        run,
        (item) => item._tag === "TaskWorkSpecificationReadReturned" && item.taskId === "B" && item.title === "Changed B"
      ),
      before: bSuspend
    },
    {
      beat: DS.suspendB,
      graph: "G1",
      capacity: initialCapacity,
      held: ["A", "B", "C"],
      retained: [],
      alice: [],
      after: bSuspend,
      before: occurrenceFence(
        run,
        (item) =>
          item._tag === "PlannedAttemptExecutorWorkReported" &&
          item.request === "Suspend" &&
          item.report.attemptId === attempts.B
      )
    },
    {
      beat: DS.suspendedB,
      graph: "G1",
      capacity: initialCapacity,
      held: ["A", "C"],
      retained: ["B"],
      alice: ["B"],
      after: bSuspended,
      before: commandFence(run, "D", "Begin")
    },
    {
      beat: DS.startedD,
      graph: "G1",
      capacity: initialCapacity,
      held: ["A", "C", "D"],
      retained: ["B"],
      alice: ["B"],
      after: responseFence(run, "D"),
      before: lower
    },
    {
      beat: DS.lowered,
      graph: "G1",
      capacity: loweredCapacity,
      held: ["A", "C", "D"],
      retained: ["B"],
      alice: ["B"],
      after: recordFence(
        run,
        (event) => event._tag === "TaskWorkCapacityChanged" && event.capacity === loweredCapacity
      ),
      before: death
    },
    {
      beat: DS.recovered,
      graph: "G1",
      capacity: loweredCapacity,
      held: ["A", "C", "D"],
      retained: ["B"],
      alice: ["B"],
      after: occurrenceFence(
        run,
        (item) => item._tag === "PlannedAttemptExecutorProjectionReturned" && item.report.attemptId === attempts.D
      ),
      before: graphFence(run, "G2")
    },
    {
      beat: DS.suspendC,
      graph: "G2",
      capacity: loweredCapacity,
      held: ["A", "C", "D"],
      retained: ["B"],
      alice: ["B"],
      after: cSuspend,
      before: occurrenceFence(
        run,
        (item) =>
          item._tag === "PlannedAttemptExecutorWorkReported" &&
          item.request === "Suspend" &&
          item.report.attemptId === attempts.C
      )
    },
    {
      beat: DS.suspendedC,
      graph: "G2",
      capacity: loweredCapacity,
      held: ["A", "D"],
      retained: ["B", "C"],
      alice: ["B"],
      closedC: true,
      after: cSuspended,
      before: continueB
    },
    {
      beat: DS.continuedB,
      graph: "G2",
      capacity: loweredCapacity,
      held: ["A", "D"],
      retained: ["B", "C"],
      alice: [],
      closedC: true,
      after: continuedB,
      before: terminalFence(run, "A")
    },
    {
      beat: DS.resumedB,
      graph: "G2",
      capacity: loweredCapacity,
      held: ["B", "D"],
      retained: ["A", "C"],
      alice: [],
      closedC: true,
      after: responseFence(run, "B", resumeOrdinal),
      before: queueA
    },
    {
      beat: DS.queuedA,
      graph: "G2",
      capacity: loweredCapacity,
      held: ["B", "D"],
      retained: ["A", "C"],
      alice: [],
      closedC: true,
      after: fixedA,
      before: requestA
    },
    {
      beat: DS.qualifiedA,
      graph: "G2",
      capacity: loweredCapacity,
      held: ["B", "D"],
      retained: ["A", "C"],
      alice: [],
      closedC: true,
      after: qualifiedA,
      before: rejectedA
    },
    {
      beat: DS.staleA,
      graph: "G2",
      capacity: loweredCapacity,
      held: ["B", "D"],
      retained: ["A", "C"],
      alice: [],
      closedC: true,
      after: staleA,
      before: fullRerun
    },
    {
      beat: DS.settledA,
      graph: "G3",
      capacity: loweredCapacity,
      held: ["B", "D"],
      retained: ["C"],
      alice: [],
      closedC: true,
      after: graphFence(run, "G3"),
      before: graphFence(run, "G4")
    },
    {
      beat: DS.reopenedC,
      graph: "G4",
      capacity: loweredCapacity,
      held: ["B", "D"],
      retained: ["C"],
      alice: [],
      closedC: false,
      after: continuationPublicationFence(run),
      before: higher
    },
    {
      beat: DS.resumedC,
      graph: "G4",
      capacity: initialCapacity,
      held: ["B", "C", "D"],
      retained: [],
      alice: [],
      after: responseFence(run, "C", resumeOrdinal),
      before: graphFence(run, "G5")
    },
    {
      beat: DS.expanded,
      graph: "G5",
      capacity: initialCapacity,
      held: ["B", "C", "D"],
      retained: [],
      alice: [],
      after: graphFence(run, "G5"),
      before: terminalFence(run, "B")
    },
    {
      beat: DS.startedSuccessors,
      graph: "G5",
      capacity: initialCapacity,
      held: ["E", "F", "G"],
      retained: [],
      alice: [],
      after: [
        responseFence(run, "E"),
        responseFence(run, "F"),
        responseFence(run, "G"),
        settlementFence(run, "A"),
        settlementFence(run, "B"),
        settlementFence(run, "C"),
        settlementFence(run, "D")
      ].reduce((latest, current) => {
        if (latest.kind !== "Journal" || current.kind !== "Journal")
          return expect.fail("DS21 accepted Begin or settlement anchor not journal-backed")
        return current.record.position > latest.record.position ? current : latest
      }),
      before: terminalFence(run, "E")
    },
    {
      beat: DS.settled,
      graph: "G5",
      capacity: initialCapacity,
      held: [],
      retained: [],
      alice: [],
      after: settlementFence(run, "G"),
      before: graphFence(run, "Gfinal")
    }
  ]
}
