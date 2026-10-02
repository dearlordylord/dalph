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
  beginOrdinal,
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
  const bSuspend = commandFence(run, "B", "Suspend", attempts.B1)
  const bSuspended = responseFence(run, "B", suspendOrdinal, attempts.B1)
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
  const restartB = occurrenceFence(
    run,
    (item) => item._tag === "OperatorRestartsAttempt" && item.attemptId === attempts.B1
  )
  const replacedB = recordFence(
    run,
    (event) => event._tag === "PlannedAttemptReplaced" && event.subject.plannedAttempt.attemptId === attempts.B1
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
  const initialBegins = (["A", "B", "C"] as const).map((task) =>
    responseFence(run, task, beginOrdinal, task === "B" ? attempts.B1 : attempts[task])
  )
  const lastInitial = initialBegins.reduce((latest, fence) => {
    if (latest.kind !== "Journal" || fence.kind !== "Journal") return expect.fail("initial Begin fence is not durable")
    return fence.record.position > latest.record.position ? fence : latest
  })
  const ds21After = [
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
  })
  if (ds21After.kind !== "Journal") return expect.fail("DS21 lower fence is not journal-backed")
  const eTerminalAcceptedByDs21 = run.records.some(
    ({ event, position }) =>
      position <= ds21After.record.position &&
      event._tag === "PlannedAttemptExecutorWorkReported" &&
      event.report._tag === "ExecutorWorkTerminal" &&
      event.report.correlation.attemptId === attempts.E &&
      event.report.correlation.runId === run.runId
  )
  const ds21Held: ReadonlyArray<Task> = eTerminalAcceptedByDs21 ? ["F", "G"] : ["E", "F", "G"]
  const ds21Retained: ReadonlyArray<Task> = eTerminalAcceptedByDs21 ? ["E"] : []
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
        (item) =>
          item._tag === "TaskWorkSpecificationReadReturned" &&
          item.taskId === "B" &&
          item.title === "Implement B F2" &&
          item.body === "Implement changed B from F2."
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
          item.report.attemptId === attempts.B1
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
      before: restartB
    },
    {
      beat: DS.restartedB,
      graph: "G2",
      capacity: loweredCapacity,
      held: ["A", "D"],
      retained: ["B", "C"],
      alice: [],
      closedC: true,
      after: replacedB,
      before: terminalFence(run, "A")
    },
    {
      beat: DS.startedB,
      graph: "G2",
      capacity: loweredCapacity,
      held: ["B", "D"],
      retained: ["A", "C"],
      alice: [],
      closedC: true,
      after: responseFence(run, "B", beginOrdinal, attempts.B2),
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
      held: ds21Held,
      retained: ds21Retained,
      alice: [],
      after: ds21After,
      before: terminalFence(run, "F")
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
