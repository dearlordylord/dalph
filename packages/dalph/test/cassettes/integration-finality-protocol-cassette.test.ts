import { it } from "@effect/vitest"
import { NodeCrypto } from "@effect/platform-node"
import { Cause, Effect, Exit, Schema } from "effect"
import { expect } from "vitest"
import {
  AttemptQuiescenceProof,
  type JournalRecord,
  PlannedAttemptExecutorWorkReportedEvent,
  TraceOutputError,
  reduceWorkflowJournalHistory
} from "@dalph/orchestrator"
import {
  AuthoredScenarioCassette,
  maintainedAuthoredCassetteCatalog,
  maintainedIntegrationFinalityProtocolCassetteCatalog,
  runAuthoredScenarioCassette,
  runIntegrationFinalityProtocolCassetteFromPromotedRecords,
  useAuthoredScenarioCassette
} from "../../src/cassettes/index.js"
import { IntegrationFinalityProtocolCassette } from "../../src/cassettes/integration-finality-protocol-cassette-domain.js"

const runAuthored = (input: unknown) => runAuthoredScenarioCassette(input).pipe(Effect.provide(NodeCrypto.layer))

const useAuthored = <A, E, R>(
  input: unknown,
  use: (run: Effect.Success<ReturnType<typeof runAuthoredScenarioCassette>>) => Effect.Effect<A, E, R>
) => useAuthoredScenarioCassette(input, use).pipe(Effect.provide(NodeCrypto.layer))

const replacementBase = maintainedAuthoredCassetteCatalog.changedAttemptRestartsCleanly
const replacementChoice = replacementBase.story.find((item) => item._tag === "OperatorRestartsAttempt")
if (replacementChoice?._tag !== "OperatorRestartsAttempt") {
  expect.fail("replacement fixture requires its accepted Restart choice")
}
const replacementRevision = replacementChoice.observedTaskRevision
const acceptedCommit = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
const expectedHead = "2222222222222222222222222222222222222222"
const candidateCommit = "cccccccccccccccccccccccccccccccccccccccc"
const integrationTarget = { repository: "/dalph/cassettes/repository.git", ref: "refs/heads/master" }
const successorAttempt = {
  attemptId: "attempt:A:1",
  baseSha: "2222222222222222222222222222222222222222",
  branch: "refs/heads/dalph/attempt-A-1",
  executor: "executor:cassette",
  runId: "$authored-run",
  taskId: "A",
  taskRevision: replacementRevision,
  worktree: "/dalph/cassettes/attempt-A-1"
}
const integrationSessionSuffix = `$authored-run:attempt:A:1:57:61:${expectedHead}:${acceptedCommit}:/dalph/cassettes/repository.git:refs/heads/master`
const integrationCorrelation = {
  ordinal: 1,
  session: {
    acceptedResult: {
      commit: acceptedCommit,
      evidenceManifest: { byteLength: 273, digest: "1111111111111111111111111111111111111111111111111111111111111111" }
    },
    candidateResource: `integrator-resource:${integrationSessionSuffix}`,
    expectedTargetHead: expectedHead,
    integrationTarget,
    plannedAttempt: successorAttempt,
    queuedAt: 56,
    sessionId: `integrator-session:${integrationSessionSuffix}`,
    startedAt: 57,
    targetLineageObservedAt: 61
  }
}

const replacementPromotedAuthoredCassette = Schema.decodeUnknownSync(AuthoredScenarioCassette)({
  ...replacementBase,
  name: "a valid same-Run replacement successor reaches target promotion",
  startingFacts: {
    ...replacementBase.startingFacts,
    targetLineageObservations: [
      replacementBase.startingFacts.targetLineageObservation,
      { plannedBaseIsAncestorOfTargetHead: true, plannedBaseSha: expectedHead, targetHeadSha: expectedHead }
    ]
  },
  story: [
    ...replacementBase.story.slice(0, -2),
    {
      _tag: "PlannedAttemptExecutorProjectionReturned",
      report: {
        _tag: "ExecutorWorkTerminal",
        attemptId: "attempt:A:1",
        result: { _tag: "Accepted", acceptedResult: { commit: acceptedCommit } }
      }
    },
    { _tag: "CoordinatorProcessDies" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    {
      _tag: "TrackerGraphReadReturned",
      graph: {
        revision: "singleton-revision",
        tasks: [{ id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
      }
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTaskClaim", taskId: "A" } },
    { _tag: "TaskClaimCurrentReadReturned", taskId: "A" },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    {
      _tag: "TrackerGraphReadReturned",
      graph: {
        revision: "singleton-revision",
        tasks: [{ id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
      }
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTargetLineage", attemptId: "attempt:A:1", taskId: "A" } },
    { _tag: "IntegratorRequestReceived", correlation: integrationCorrelation },
    {
      _tag: "IntegratorResultReturned",
      result: { _tag: "PreparedCandidate", candidateText: "refs/heads/dalph/integrator-candidate-A" }
    },
    {
      _tag: "IntegratorGitObservationReturned",
      candidateText: "refs/heads/dalph/integrator-candidate-A",
      observation: {
        _tag: "Commit",
        candidateText: "refs/heads/dalph/integrator-candidate-A",
        commit: candidateCommit,
        directParents: [expectedHead, acceptedCommit]
      }
    },
    {
      _tag: "TargetPromotionGitReadReturned",
      candidateCommit,
      observation: { _tag: "CandidateNotInAncestry", currentHeadSha: expectedHead },
      repository: integrationTarget.repository
    },
    {
      _tag: "TargetPromotionCompareAndSetReturned",
      request: { candidateCommit, expectedTargetHead: expectedHead, integrationTarget },
      result: { _tag: "Applied" }
    },
    {
      _tag: "CoordinatorActivationReturned",
      decision: { _tag: "RunMustRemainActive", reason: "UnsettledResponsibility" }
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    {
      _tag: "TrackerGraphReadReturned",
      graph: {
        revision: "singleton-revision",
        tasks: [{ id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
      }
    },
    { _tag: "DalphSelects", operation: { _tag: "ReadTrackerGraph", target: "cassette-target" } },
    {
      _tag: "TrackerGraphReadReturned",
      graph: {
        revision: "singleton-revision",
        tasks: [{ id: "A", lifecycle: { _tag: "Open" }, parentTaskId: null, prerequisiteIds: [] }]
      }
    },
    {
      _tag: "ExpectedBehavior",
      orchestration: null,
      protocol: null,
      taskWork: { absences: [], results: [{ _tag: "PlannedWorkForTaskAccepted", commit: acceptedCommit, taskId: "A" }] }
    }
  ]
})

type ReplacementRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptReplaced" }>
}

type ExecutorWorkReportedRecord = JournalRecord & {
  readonly event: Extract<JournalRecord["event"], { readonly _tag: "PlannedAttemptExecutorWorkReported" }>
}

const replacementRecordFor = Effect.fn("IntegrationFinalityProtocolCassetteTest.replacementRecordFor")(function* (
  records: ReadonlyArray<JournalRecord>
) {
  const replacement = records.findLast(
    (record): record is ReplacementRecord => record.event._tag === "PlannedAttemptReplaced"
  )
  if (replacement?.event._tag !== "PlannedAttemptReplaced") {
    return yield* Effect.die("replacement fixture did not record its replacement event")
  }
  return replacement
})

it.effect("accepts a promoted history containing a replacement plan while selecting the promoted plan", () =>
  useAuthored(replacementPromotedAuthoredCassette, (promoted) =>
    Effect.gen(function* () {
      const replacement = yield* replacementRecordFor(promoted.records)
      const promotion = promoted.records.findLast(({ event }) => event._tag === "TargetPromotionObservedSuccess")?.event
      if (promotion?._tag !== "TargetPromotionObservedSuccess") {
        return yield* Effect.die("replacement fixture did not promote its valid successor")
      }
      expect(replacement.runId).toBe(promoted.runId)
      expect(promotion.correlation.qualifiedCandidate.run.session.plannedAttempt).toEqual(
        replacement.event.successorPlan.plannedAttempt
      )
      expect(promoted.history._tag).toBe("ValidWorkflowJournalHistory")
      expect(promoted.activationOrdinals).toEqual([1, 2, 3, 4])
      expect(
        promoted.observationCaptures.filter((capture) => capture._tag === "AuthoredStoryOccurrenceCaptured")
      ).toHaveLength(replacementPromotedAuthoredCassette.story.length)
      expect(promotion.correlation.qualifiedCandidate.run.session).toMatchObject({
        queuedAt: 56,
        startedAt: 57,
        targetLineageObservedAt: 61
      })
      const finalized = yield* runIntegrationFinalityProtocolCassetteFromPromotedRecords(
        maintainedIntegrationFinalityProtocolCassetteCatalog.deletesOnlyTheExactCompletionClaimAfterFocusedTaskSuccess,
        promoted.runId
      )

      expect(finalized.failureTag).toBeNull()
      expect(finalized.records.filter(({ event }) => event._tag === "IntegrationFinalitySettled")).toHaveLength(1)
      expect(finalized.boundaryCalls.filter((call) => call === "deleteTaskClaim")).toHaveLength(1)
    })
  )
)

it.effect("rejects omitting the replacement promotion activation return before the next tracker read", () =>
  Effect.gen(function* () {
    const returnAt = replacementPromotedAuthoredCassette.story.findLastIndex(
      (item) => item._tag === "CoordinatorActivationReturned"
    )
    expect(returnAt).toBe(44)
    expect(replacementPromotedAuthoredCassette.story[returnAt - 1]?._tag).toBe("TargetPromotionCompareAndSetReturned")
    expect(replacementPromotedAuthoredCassette.story[returnAt + 1]?._tag).toBe("DalphSelects")
    const result = yield* runAuthored({
      ...replacementPromotedAuthoredCassette,
      story: replacementPromotedAuthoredCassette.story.filter((_, index) => index !== returnAt)
    }).pipe(Effect.exit)
    expect(Exit.isFailure(result)).toBe(true)
    if (Exit.isFailure(result)) {
      expect(result.cause.reasons.filter(Cause.isDieReason).map((reason) => reason.defect)).toEqual([
        "coordinator activation stopped at story position 44 before the authored terminal assertions"
      ])
    }
  })
)

it.effect(
  "rejects omitting the next activation's owed reconfirmation graph before replacement terminal assertions",
  () =>
    Effect.gen(function* () {
      const expectedAt = replacementPromotedAuthoredCassette.story.findLastIndex(
        (item) => item._tag === "ExpectedBehavior"
      )
      const graphAt = expectedAt - 2
      expect(graphAt).toBe(47)
      expect(replacementPromotedAuthoredCassette.story[graphAt]?._tag).toBe("DalphSelects")
      expect(replacementPromotedAuthoredCassette.story[graphAt + 1]?._tag).toBe("TrackerGraphReadReturned")
      const failure = yield* runAuthored({
        ...replacementPromotedAuthoredCassette,
        story: replacementPromotedAuthoredCassette.story.filter(
          (_, index) => index !== graphAt && index !== graphAt + 1
        )
      }).pipe(Effect.flip)
      if (!Schema.is(TraceOutputError)(failure))
        return yield* Effect.die("omitted G2 must fail at the exact trace boundary")
      expect(failure.detail).toBe(
        'AuthoredCassetteInteractionMismatch at story position 47: expected ExpectedBehavior, received {"_tag":"ReadTrackerGraph","target":"cassette-target"} while emitting {"_tag":"ReadTrackerGraph","target":"cassette-target"}'
      )
    })
)

it.effect("rejects Executing and terminal reports as replacement quiescence witnesses", () =>
  Effect.gen(function* () {
    const safelyReplaced = yield* runAuthored(maintainedAuthoredCassetteCatalog.changedAttemptRestartsCleanly)
    const replacement = yield* replacementRecordFor(safelyReplaced.records)
    const executing = safelyReplaced.records.find(
      (record): record is ExecutorWorkReportedRecord =>
        record.event._tag === "PlannedAttemptExecutorWorkReported" &&
        record.event.report._tag === "ExecutorWorkExecuting"
    )
    const safelySuspended = safelyReplaced.records.find(
      (record): record is ExecutorWorkReportedRecord =>
        record.event._tag === "PlannedAttemptExecutorWorkReported" &&
        record.event.report._tag === "ExecutorWorkSafelySuspended"
    )
    if (
      executing === undefined ||
      safelySuspended === undefined ||
      safelySuspended.event.report._tag !== "ExecutorWorkSafelySuspended"
    ) {
      return yield* Effect.die("replacement fixture did not record its executor lifecycle reports")
    }

    const executingWitness = safelyReplaced.records.map((record) =>
      record === replacement
        ? {
            ...record,
            event: {
              ...replacement.event,
              witness: {
                ...replacement.event.witness,
                quiescenceProof: Schema.decodeUnknownSync(AttemptQuiescenceProof)({
                  _tag: "AcceptedReport",
                  reportOrdinal: executing.event.ordinal
                })
              }
            }
          }
        : record
    )
    const executingReduction = reduceWorkflowJournalHistory(safelyReplaced.runId, executingWitness)
    expect(executingReduction).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("current unbroken accepted Safe suspension") })
      ])
    })

    const terminal = yield* runAuthored(maintainedAuthoredCassetteCatalog.targetPromotionSuccess)
    const terminalReport = terminal.records.find(
      (record): record is ExecutorWorkReportedRecord =>
        record.event._tag === "PlannedAttemptExecutorWorkReported" &&
        record.event.report._tag === "ExecutorWorkTerminal" &&
        record.event.report.result._tag === "Accepted"
    )
    if (
      terminalReport === undefined ||
      terminalReport.event.report._tag !== "ExecutorWorkTerminal" ||
      terminalReport.event.report.result._tag !== "Accepted"
    ) {
      return yield* Effect.die("terminal fixture did not record its accepted terminal report")
    }
    const terminalWitness = safelyReplaced.records.map((record) => {
      if (
        record.event._tag !== "PlannedAttemptExecutorWorkReported" ||
        record.event.report._tag !== "ExecutorWorkSafelySuspended"
      ) {
        return record
      }
      const event = Schema.decodeUnknownSync(PlannedAttemptExecutorWorkReportedEvent)({
        ...record.event,
        report: { ...terminalReport.event.report, correlation: record.event.report.correlation }
      })
      return { ...record, event }
    })
    const terminalReduction = reduceWorkflowJournalHistory(safelyReplaced.runId, terminalWitness)
    expect(terminalReduction).toMatchObject({
      _tag: "InvalidWorkflowJournalHistory",
      issues: expect.arrayContaining([
        expect.objectContaining({ detail: expect.stringContaining("current unbroken accepted Safe suspension") })
      ])
    })
  })
)

it("rejects active-record absence as a completion-marker absence result", () => {
  const exact =
    maintainedIntegrationFinalityProtocolCassetteCatalog.deletesOnlyTheExactCompletionClaimAfterFocusedTaskSuccess
  const collapsed = {
    ...exact,
    boundaryResults: exact.boundaryResults.map((result) =>
      result._tag === "ReadCompletionMarkerAbsent" ? { _tag: "ReadUnclaimed" } : result
    )
  }

  expect(() => Schema.decodeUnknownSync(IntegrationFinalityProtocolCassette)(collapsed)).toThrow()
})
