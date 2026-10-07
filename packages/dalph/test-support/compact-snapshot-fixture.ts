import { Schema } from "effect"
import { RunningHostSnapshot } from "../src/application/running-host-snapshot.js"

export const compactFixturePrivateMarker = "PRIVATE-PAYLOAD-MUST-NOT-APPEAR"
const gitCommitHexLength = 40
const fixtureLifecycleKinds = ["Open", "CompletedSuccessfully", "TerminalWithoutSuccess"]
const fixtureTitlePadding = 512
export const compactSnapshotFixture = (
  taskCount = 500,
  taskId = "task-1"
): Extract<RunningHostSnapshot, { readonly _tag: "Ready" }> => {
  const runId = "compact-fixture-run"
  const plannedAttempt = {
    attemptId: "attempt-1",
    runId,
    taskId,
    taskRevision: "revision-1",
    baseSha: "1".repeat(gitCommitHexLength),
    branch: "refs/heads/fixture",
    executor: "executor:fixture",
    worktree: "/tmp/fixture"
  }
  const correlation = { attemptId: plannedAttempt.attemptId, runId }
  const rejection = {
    _tag: "ExecutorWorkResultRejected",
    correlation,
    reason: "ResultEnvelopeInvalid",
    recoveryCause: "WriterCustodyUnresolved",
    responseCount: 1,
    custody: { _tag: "Unresolved" }
  }
  const rejectedSubject = { _tag: "RejectedResult", plannedAttempt, reportOrdinal: 1 }
  const historicalSubject = { _tag: "HistoricalUnknownFailure", plannedAttempt, reportOrdinal: 1 }
  const subject = { _tag: "Task", runId, taskId }
  const base = { subject, classification: "Blocked" }
  const value = Schema.decodeUnknownSync(RunningHostSnapshot)({
    _tag: "Ready",
    runId,
    acceptedAt: { runId, position: 617 },
    graph: {
      _tag: "GraphEstablished",
      snapshot: {
        schemaVersion: 1,
        revision: "tracker-1",
        tasks: Array.from({ length: taskCount }, (_, index) => ({
          id: `task-${index + 1}`,
          parentTaskId: null,
          prerequisiteIds: [],
          lifecycle: { _tag: fixtureLifecycleKinds[index % fixtureLifecycleKinds.length] },
          descriptor: { title: compactFixturePrivateMarker + "x".repeat(fixtureTitlePadding) }
        }))
      }
    },
    frontier: { policy: { revision: 1, taskExecutionCapacity: 3 }, standings: [], placements: [] },
    delivery: {
      _tag: "DeliveryStatusAvailable",
      subject: { _tag: "Run", runId },
      acceptedAt: 617,
      entries: [
        {
          ...base,
          _tag: "ExecutorFailure",
          entryIdentity: "failure",
          plannedAttempt,
          obligationReference: "obligation-1",
          boundary: "PlannedAttemptExecutor",
          reason: { _tag: "Known", code: "ProviderFailed" },
          recovery: { _tag: "Unavailable", reason: "ExecutorFailureRecoveryNotImplemented" }
        },
        {
          ...base,
          _tag: "ExecutorResultRejected",
          entryIdentity: "rejected",
          plannedAttempt,
          obligationReference: "obligation-1",
          rejection,
          recoverySubject: rejectedSubject
        },
        {
          ...base,
          _tag: "TargetPromotionSafetyRefused",
          entryIdentity: "safety",
          taskId,
          boundary: "CompareAndSet",
          integrationTarget: { repository: "/tmp/repo", ref: "refs/heads/master" },
          candidateCommit: "2".repeat(gitCommitHexLength),
          refusal: { _tag: "InventoryUnreadable", detail: compactFixturePrivateMarker }
        },
        {
          ...base,
          _tag: "EvidenceUnavailable",
          entryIdentity: "unavailable",
          subject: { _tag: "Run", runId },
          obligationReference: null,
          evidence: { _tag: "ProposalDerivationIssue", issueKind: "FreshRouteProvenanceMissing", taskId }
        },
        {
          ...base,
          _tag: "EvidenceConflict",
          entryIdentity: "conflict",
          obligationReference: null,
          evidenceIdentities: ["evidence-1", "evidence-2"]
        },
        {
          _tag: "DependencyWait",
          subject,
          classification: "Waiting",
          entryIdentity: "dependency",
          taskId,
          prerequisiteTaskIds: ["task-2"],
          standingKind: "GraphExcluded",
          obligationReference: null
        },
        {
          _tag: "LiveDeliveryAction",
          subject,
          classification: "Progressing",
          entryIdentity: "live",
          proposalId: "proposal-1",
          lifecycle: "MaterializedDeliveryAction",
          operationId: "operation-1"
        }
      ],
      diagnostics: {
        runId,
        trackerWait: { _tag: "Throttled", observedAt: 617, retry: { _tag: "RetryAfterSeconds", seconds: 30 } },
        attemptBaseAdmission: {
          _tag: "QualificationRefused",
          refusals: [
            {
              taskId,
              operationId: "operation-1",
              observedAt: 617,
              boundary: "TargetHead",
              detail: compactFixturePrivateMarker
            }
          ]
        },
        tasks: [
          { phase: "Executing", failure: { _tag: "None" }, recovery: { _tag: "NotApplicable" } },
          {
            phase: "Failed",
            failure: { _tag: "Known", code: "ProviderFailed" },
            recovery: { _tag: "Unavailable", reason: "ExecutorFailureRecoveryNotImplemented" }
          },
          {
            phase: "Failed",
            failure: { _tag: "Unavailable" },
            recovery: { _tag: "RestartOnly", subject: historicalSubject }
          },
          {
            phase: "Rejected",
            failure: { _tag: "None" },
            recovery: { _tag: "ExplicitDirectionRequired", subject: rejectedSubject, rejection }
          }
        ].map((diagnostic) => ({
          ...diagnostic,
          taskId,
          identity: { _tag: "Unavailable" },
          lastSubstantiveAt: 617,
          retainedAttempt: plannedAttempt,
          candidateHead: { _tag: "Unavailable" }
        }))
      }
    },
    retained: ["WorkflowResponsibility", "AcceptedAwaitingIntegration", "QueuedIntegration", "StartedIntegration"].map(
      (kind, index) => ({ taskId, obligationReference: `retained-${index}`, kind, plannedAttempt })
    ),
    held: [{ taskId, correlation }]
  })
  if (value._tag !== "Ready") throw new Error("fixture must be Ready")
  return value
}
