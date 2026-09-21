import { remotePublicationTargetForTest } from "../../orchestrator/test/support/direct-publication.js"
/* eslint-disable import/no-nodejs-modules -- This qualification test executes and observes the real Node process boundary. */
import { spawn } from "node:child_process"
import { readFile } from "node:fs/promises"
import nodePath from "node:path"
import nodeProcess from "node:process"
import * as nodeTimers from "node:timers"
import { Effect, Exit, FileSystem, Layer, Option, Redacted } from "effect"
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import {
  AcceptedResult,
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedAttemptExecutorReport,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ActiveTaskClaim,
  ClaimOwner,
  ClaimToken,
  CompletionClaimDeletedEvent,
  CompletionTaskClaim,
  CompletionTaskAcknowledgedEvent,
  CompletionTaskCandidateAncestryObservedEvent,
  CompletionTaskRequestOrdinal,
  completionOriginalTaskClaimReleaseFor,
  completionTaskRequestFor,
  describeJournalEvent,
  FixtureTarget,
  FocusedCompletedTaskObservation,
  GitCommand,
  GithubGraphqlClient,
  InitialControlPolicy,
  IntegrationStartedEvent,
  JournalPosition,
  makeRunFinalityEvidence,
  makeTaskAttemptPlanOperation,
  makeTargetLineageObservationOperation,
  makeWorkflowRunBeganRecord,
  nodeGitCommandLayer,
  OperationId,
  PlannedAttemptExecutorReportOrdinal,
  PlannedAttemptExecutorWorkReportedEvent,
  PlannedAttemptWorktreeObservedEvent,
  PlannedWorktreeReady,
  RunFinalityReadShape,
  TargetLineageObservedEvent,
  TargetLineageObservation,
  TargetPromotionAttemptOrdinal,
  TargetPromotionObservedSuccessEvent,
  targetPromotionCorrelationFor,
  TaskAttemptPlannedEvent,
  TaskClaimAcquiredEvent,
  TaskClaimReleasedEvent,
  TaskDagSnapshot,
  TaskWorkCapacity,
  TrackerRevision,
  TrackerSnapshot,
  TrackerTask,
  workflowJournalEventVersion,
  type JournalRecord,
  type WorkflowJournalEvent
} from "@dalph/orchestrator"
import { ProductionLiveFixtureCleanup } from "../src/qualification/live-fixture-cleanup.js"
import {
  IntegratorCandidateResourceLocator,
  IntegratorCandidateText,
  IntegratorRunCandidateGitObservedEvent,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorRunQualifiedCandidate,
  IntegratorRunResultRecordedEvent,
  IntegratorSessionCorrelation,
  IntegratorSessionId
} from "../../orchestrator/src/workflow/protocols/integrator/events.js"
import { makeWorkflowRunTerminatedRecord } from "../../orchestrator/src/workflow-journal/run-lifecycle.js"
import { describe, expect, it } from "vitest"
import { launchExecutableMatches } from "../src/application/codex-app-server.js"
import {
  createProductionLiveLocalFixture,
  decodeProductionLiveQualificationManifest,
  decodeProductionLiveQualificationRetentionReport,
  deriveProductionLiveQualificationEvidenceObservations,
  generateProductionLiveControlledProviderCredential,
  productionLiveQualificationBoundaryObservations,
  productionLiveQualificationChronologyIsExact,
  productionLiveQualificationOperationCounts,
  replaceProductionLiveQualificationRetentionReportAtomically,
  runProductionLiveQualificationRuntime,
  writeProductionLiveQualificationFailureRetentionReport
} from "../src/qualification/live-qualification-runtime.js"
import { ProductionLiveResponsesEndpointLocator } from "../src/qualification/live-responses-endpoint.js"
import {
  ProductionLiveQualificationProcessId,
  type ProductionLiveQualificationCompletion
} from "../src/qualification/live-qualification-controller.js"
import type { ProductionLiveResponsesObservation } from "../src/qualification/live-responses-endpoint.js"
import { githubGraphqlTestClient } from "../../orchestrator/src/authorities/task-tracker/github/graphql-client.test-fixture.js"

const layer = nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer), Layer.merge(NodeCrypto.layer))
const processBoundMilliseconds = 5_000

const waitFor = async <A>(observe: () => Promise<A | undefined>): Promise<A> => {
  const attempts = processBoundMilliseconds / 20
  for (let attempt = 0; attempt < attempts; attempt++) {
    const observed = await observe()
    if (observed !== undefined) return observed
    await new Promise((resolve) => nodeTimers.setTimeout(resolve, 20))
  }
  throw new Error("bounded process observation timed out")
}

const stopChild = async (child: ReturnType<typeof spawn>): Promise<void> => {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise<void>((resolve, reject) => {
    child.once("exit", () => resolve())
    child.once("error", reject)
  })
  child.kill("SIGTERM")
  const timer = nodeTimers.setTimeout(() => child.kill("SIGKILL"), processBoundMilliseconds)
  try {
    await exited
  } finally {
    clearTimeout(timer)
  }
}
const formalPositions = (shard: number) =>
  Array.from({ length: 105 }, (_value, position) => position).filter((position) =>
    shard === 0
      ? position <= 36 ||
        (position >= 42 && position <= 46) ||
        (position >= 60 && position <= 64) ||
        (position >= 86 && position <= 90) ||
        position >= 100
      : (position >= 37 && position <= 41) ||
        (position >= 47 && position <= 59) ||
        (position >= 65 && position <= 85) ||
        (position >= 91 && position <= 99)
  )
const formalCommands = (offset: number) =>
  Array.from({ length: 105 }, (_value, position) => ({
    position,
    kind: "test",
    name: `formal command ${position}`,
    args: ["test", `formal-${position}.qnt`],
    verdict: {
      acceptedExitCodes: [0],
      witnesses: [],
      temporal: null,
      collectedReplacementTest: false,
      artifactPreparedAfter: false
    },
    result: "exit:0",
    obligationId: `00000000-0000-4000-8000-${String(offset * 1_000 + position + 1).padStart(12, "0")}`,
    durationMilliseconds: 1
  }))
const formalProfile = (profileKind: "dedicated" | "stressed", jobId: number) => ({
  profileKind,
  sourceSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  nodeVersion: "24.20.0",
  runId: 307,
  runAttempt: 1,
  profileDigest: "9".repeat(64),
  formalSeconds: 1,
  completeProfileSeconds: 2,
  shards: [0, 1].map((shard) => ({
    shard,
    condition:
      profileKind === "dedicated"
        ? { kind: "dedicated-hosted-job", runnerLabel: "ubuntu-24.04-arm", effectiveParallelism: 4 }
        : {
            kind: "cpu-affinity",
            runnerLabel: "ubuntu-latest",
            cpuList: "0-1",
            hostParallelism: 4,
            effectiveParallelism: 2
          },
    job: {
      workflow: "Production live qualification",
      runId: 307,
      runAttempt: 1,
      jobId: jobId + shard,
      name: `${profileKind === "dedicated" ? "Dedicated" : "Stressed"} formal evidence shard ${shard}`
    },
    reportDigest: String(jobId + shard)
      .slice(-1)
      .repeat(64),
    positions: formalPositions(shard),
    setupInstallSeconds: 1,
    formalSeconds: 1,
    completeJobSeconds: 2,
    remainingHostedSeconds: 958,
    hostedLimitSeconds: 960,
    startedAt: "2026-09-13T12:00:00.000Z",
    completedAt: "2026-09-13T12:00:02.000Z"
  })),
  commands: formalCommands(jobId),
  negativeControls: ["negative"]
})

const input = {
  schemaVersion: 1,
  invocationId: "live-q-307",
  sourceRepository: "/workspace/dalph",
  sourceBaseSha: "9cb9d7da650897c201c19f68d7a1c2caac87c5b1",
  builtEntry: "/workspace/dalph/packages/dalph/dist/bin/dalph.js",
  lockfile: "/workspace/dalph/pnpm-lock.yaml",
  codexExecutable: "/usr/local/bin/codex",
  codexJavaScriptEntry: "/usr/local/@openai/codex/bin/codex.js",
  publicationContainer: "/tmp/dalph-live-publication",
  artifact: "/tmp/dalph-live-publication/evidence.json",
  retentionReport: "/tmp/dalph-live-publication/retained-locators.json",
  repository: { owner: "dalph-live", name: "qualification" },
  createIssueOperationId: "019948d4-23ec-7222-8000-000000000307",
  hosted: {
    sourceSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    workflow: "Candidate qualification",
    runId: 307,
    runAttempt: 1,
    job: "live-qualification",
    protectedEnvironment: "live-qualification"
  },
  formal: {
    _tag: "DedicatedAndStressed",
    dedicated: formalProfile("dedicated", 312),
    stressed: formalProfile("stressed", 314)
  }
}

const completedEvidenceObservationFixture = () => {
  const runId = RunId.make("live-derivation-run")
  const taskId = TaskId.make("live-derivation-task")
  const target = FixtureTarget.make("live-derivation-target")
  const baseSha = GitCommitSha.make("1".repeat(40))
  const acceptedCommit = GitCommitSha.make("2".repeat(40))
  const candidateCommit = GitCommitSha.make("3".repeat(40))
  const taskRevision = TaskRevision.make("live-derivation-revision")
  const plannedAttempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("live-derivation-attempt"),
    baseSha,
    branch: TaskBranchRef.make("refs/heads/live-derivation"),
    executor: TaskExecutorLocator.make("executor:live-derivation"),
    runId,
    taskId,
    taskRevision,
    worktree: WorktreeLocator.make("/tmp/live-derivation-worktree")
  })
  const acceptedResult = AcceptedResult.make({
    commit: acceptedCommit,
    evidenceManifest: EvidenceReference.make({ digest: EvidenceDigest.make("4".repeat(64)), byteLength: 1 })
  })
  const integrationTarget = IntegrationTarget.make({
    repository: GitRepositoryLocator.make("/tmp/live-derivation-repository"),
    ref: IntegrationTargetRef.make("refs/heads/master")
  })
  const activeClaim = ActiveTaskClaim.make({
    operationId: OperationId.make("live-derivation-claim-operation"),
    owner: ClaimOwner.make("live-derivation-owner"),
    taskId,
    token: ClaimToken.make("live-derivation-token")
  })
  const session = IntegratorSessionCorrelation.make({
    acceptedResult,
    candidateResource: IntegratorCandidateResourceLocator.make("/tmp/live-derivation-candidate"),
    expectedTargetHead: baseSha,
    integrationTarget,
    plannedAttempt,
    queuedAt: JournalPosition.make(5),
    sessionId: IntegratorSessionId.make("live-derivation-session"),
    startedAt: JournalPosition.make(6),
    targetLineageObservedAt: JournalPosition.make(7)
  })
  const integratorRun = IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session })
  const candidateText = IntegratorCandidateText.make(candidateCommit)
  const candidate = IntegratorRunQualifiedCandidate.make({
    candidateCommit,
    candidateText,
    directParents: [baseSha, acceptedCommit],
    qualifiedAt: JournalPosition.make(10),
    run: integratorRun
  })
  const promotion = targetPromotionCorrelationFor(candidate)
  const completionClaim = CompletionTaskClaim.make({
    originalClaim: activeClaim,
    plannedAttempt,
    promotionCorrelation: promotion
  })
  const completionRequest = completionTaskRequestFor(completionClaim)
  const planOperation = makeTaskAttemptPlanOperation({
    operationId: OperationId.make("live-derivation-plan-operation"),
    plannedAttempt,
    predecessorOperationIds: [activeClaim.operationId]
  })
  const lineageOperation = makeTargetLineageObservationOperation({
    integrationTarget,
    operationId: OperationId.make("live-derivation-lineage-operation"),
    plannedAttempt,
    predecessorOperationIds: [planOperation.operationId]
  })
  const executorReport = PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
    correlation: { attemptId: plannedAttempt.attemptId, runId },
    result: { _tag: "Accepted", acceptedResult }
  })
  const completionObservation = FocusedCompletedTaskObservation.make({
    claim: completionRequest.claim,
    lifecycle: "CompletedSuccessfully",
    observedAt: JournalPosition.make(18),
    operationId: OperationId.make("live-derivation-completion-observation"),
    taskId,
    taskRevision,
    trackerRevision: TrackerRevision.make("live-derivation-tracker-revision"),
    target
  })
  const projection = TaskDagSnapshot.project(
    TrackerSnapshot.make({
      revision: TrackerRevision.make("live-derivation-finality-revision"),
      rootTaskId: taskId,
      tasks: [
        TrackerTask.make({
          id: taskId,
          lifecycle: { _tag: "CompletedSuccessfully" },
          parentTaskId: null,
          prerequisiteIds: []
        })
      ]
    })
  )
  if (projection._tag === "Invalid") return expect.fail("live derivation fixture graph must be valid")
  const readShape = RunFinalityReadShape.make({ explicitlyCoveredTaskIds: [taskId] })
  const finality = makeRunFinalityEvidence({
    operationId: OperationId.make("live-derivation-finality-operation"),
    readShape,
    rootTaskId: taskId,
    runId,
    snapshot: projection.snapshot,
    target,
    observedAt: JournalPosition.make(20)
  })
  const record = (position: number, event: WorkflowJournalEvent): JournalRecord => ({
    event,
    key: describeJournalEvent(event).expectedKey,
    position: JournalPosition.make(position),
    runId
  })
  const journal = [
    makeWorkflowRunBeganRecord(
      runId,
      target,
      InitialControlPolicy.make({ taskExecutionCapacity: TaskWorkCapacity.make(1) }),
      remotePublicationTargetForTest
    ),
    record(2, TaskClaimAcquiredEvent.make({ claim: activeClaim, version: workflowJournalEventVersion })),
    record(3, TaskAttemptPlannedEvent.make({ operation: planOperation, version: workflowJournalEventVersion })),
    record(
      4,
      PlannedAttemptExecutorWorkReportedEvent.make({
        ordinal: PlannedAttemptExecutorReportOrdinal.make(1),
        report: executorReport,
        version: workflowJournalEventVersion
      })
    ),
    record(
      5,
      IntegrationStartedEvent.make({
        acceptedResult,
        integrationTarget,
        plannedAttempt,
        responsibilityBeganAt: JournalPosition.make(5),
        version: workflowJournalEventVersion
      })
    ),
    record(
      6,
      PlannedAttemptWorktreeObservedEvent.make({
        observation: PlannedWorktreeReady.make({
          baseSha,
          branch: plannedAttempt.branch,
          headSha: acceptedCommit,
          worktree: plannedAttempt.worktree
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: OperationId.make("live-derivation-worktree-observation"),
        version: workflowJournalEventVersion
      })
    ),
    record(
      7,
      TargetLineageObservedEvent.make({
        observation: TargetLineageObservation.make({
          plannedBaseIsAncestorOfTargetHead: true,
          plannedBaseSha: baseSha,
          targetHeadSha: baseSha
        }),
        occurrenceClassification: "NonActionOccurrence",
        operationId: lineageOperation.operationId,
        plannedAttempt,
        version: workflowJournalEventVersion
      })
    ),
    record(
      8,
      IntegratorRunResultRecordedEvent.make({
        result: { _tag: "PreparedCandidate", candidateText, correlation: integratorRun },
        run: integratorRun,
        version: workflowJournalEventVersion
      })
    ),
    record(
      9,
      IntegratorRunCandidateGitObservedEvent.make({
        candidateText,
        observation: {
          _tag: "Commit",
          candidateText,
          commit: candidateCommit,
          directParents: [baseSha, acceptedCommit]
        },
        run: integratorRun,
        version: workflowJournalEventVersion
      })
    ),
    record(
      10,
      TargetPromotionObservedSuccessEvent.make({
        basis: { _tag: "AfterAttempt", attemptOrdinal: TargetPromotionAttemptOrdinal.make(1) },
        correlation: promotion,
        observation: { _tag: "CompareAndSetApplied", candidateAncestry: "Current", targetHeadSha: candidateCommit },
        version: workflowJournalEventVersion
      })
    ),
    record(
      11,
      CompletionTaskCandidateAncestryObservedEvent.make({
        attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
        observation: { _tag: "CandidateCurrent", currentHeadSha: candidateCommit },
        operationId: OperationId.make("live-derivation-candidate-observation"),
        request: completionRequest,
        version: workflowJournalEventVersion
      })
    ),
    record(
      12,
      CompletionTaskAcknowledgedEvent.make({
        acknowledgement: { operationId: completionRequest.operationId, taskId },
        attemptOrdinal: CompletionTaskRequestOrdinal.make(1),
        request: completionRequest,
        version: workflowJournalEventVersion
      })
    ),
    record(
      13,
      TaskClaimReleasedEvent.make({
        release: completionOriginalTaskClaimReleaseFor(completionRequest.claim),
        version: workflowJournalEventVersion
      })
    ),
    record(
      14,
      CompletionClaimDeletedEvent.make({
        claim: completionRequest.claim,
        operationId: OperationId.make("live-derivation-claim-deletion"),
        successObservation: completionObservation,
        version: workflowJournalEventVersion
      })
    ),
    makeWorkflowRunTerminatedRecord(runId, JournalPosition.make(15), "Completed", finality)
  ]
  const completion: ProductionLiveQualificationCompletion = {
    facts: {
      applicationServerCount: 1,
      github: {
        claim: "Unclaimed",
        lifecycle: "CompletedSuccessfully",
        responses: {
          counts: { executor: 2, integrator: 2, total: 4 },
          orderedTags: ["ExecutorRequest", "ExecutorGitReadHead", "IntegratorRequest", "IntegratorGitReadHead"]
        }
      },
      integrationTargetCount: 1,
      journal,
      targetHead: candidateCommit,
      remotePublicationHead: candidateCommit,
      taskWorktreeCount: 1
    },
    processId: ProductionLiveQualificationProcessId.make(307),
    processStatus: 0,
    records: [
      { _tag: "RunSelected", runId, selection: "Allocated", version: 1 },
      { _tag: "RunDisposition", disposition: "Completed", runId, version: 1 }
    ],
    runId
  }
  const responses: ProductionLiveResponsesObservation = {
    counts: { executor: 2, integrator: 2, total: 4 },
    orderedTags: ["ExecutorRequest", "ExecutorGitReadHead", "IntegratorRequest", "IntegratorGitReadHead"]
  }
  return { completion, responses, shippedGithub: ["ResolveIssue"] as const }
}

describe("#307 production live qualification runtime", () => {
  it("derives exact completed evidence observations and rejects one-fact mutations", () => {
    const fixture = completedEvidenceObservationFixture()
    const canonical = deriveProductionLiveQualificationEvidenceObservations(
      fixture.completion,
      fixture.shippedGithub,
      fixture.responses
    )
    expect(Option.isSome(canonical)).toBe(true)
    if (Option.isSome(canonical)) {
      expect(canonical.value.selectedRunsCompleted).toBe(true)
      expect(canonical.value.occurrences).toHaveLength(10)
      expect(canonical.value.orderedBoundaryTags.responses).toEqual(fixture.responses.orderedTags)
    }

    const withoutAcceptedResult = {
      ...fixture.completion,
      facts: {
        ...fixture.completion.facts,
        journal: fixture.completion.facts.journal.filter(
          ({ event }) => event._tag !== "PlannedAttemptExecutorWorkReported"
        )
      }
    }
    const withoutPromotion = {
      ...fixture.completion,
      facts: {
        ...fixture.completion.facts,
        journal: fixture.completion.facts.journal.filter(({ event }) => event._tag !== "TargetPromotionObservedSuccess")
      }
    }
    const invalidGithubCompletion = {
      ...fixture.completion,
      facts: {
        ...fixture.completion.facts,
        github: { lifecycle: "CompletedSuccessfully", claim: "Claimed", responses: fixture.completion.facts.github }
      }
    }
    const withApplicationExitDisposition = {
      ...fixture.completion,
      records: [
        ...fixture.completion.records,
        {
          _tag: "ApplicationExitDisposition" as const,
          disposition: { _tag: "Succeeded" as const, requestedStatus: 0 as const },
          runId: fixture.completion.runId,
          version: 1 as const
        }
      ]
    }
    const withoutGitObservations = {
      ...fixture.completion,
      facts: {
        ...fixture.completion.facts,
        journal: fixture.completion.facts.journal.filter(
          ({ event }) =>
            event._tag !== "PlannedAttemptWorktreeObserved" &&
            event._tag !== "TargetLineageObserved" &&
            event._tag !== "IntegratorRunCandidateGitObserved" &&
            event._tag !== "CompletionTaskCandidateAncestryObserved"
        )
      }
    }

    for (const changed of [
      withoutAcceptedResult,
      withoutPromotion,
      invalidGithubCompletion,
      withApplicationExitDisposition,
      withoutGitObservations
    ]) {
      expect(
        Option.isNone(
          deriveProductionLiveQualificationEvidenceObservations(changed, fixture.shippedGithub, fixture.responses)
        )
      ).toBe(true)
    }
    expect(
      Option.isNone(deriveProductionLiveQualificationEvidenceObservations(fixture.completion, [], fixture.responses))
    ).toBe(true)
  })

  it("runtime retains build measurement and child progress through its real checkpoint writer", async () => {
    const client = githubGraphqlTestClient((request) =>
      Effect.succeed({
        body:
          request._tag === "ResolveRepository"
            ? { data: { repository: { id: "repository-node" } } }
            : {
                data: {
                  createIssue: {
                    clientMutationId: input.createIssueOperationId,
                    issue: { id: "issue-node", number: 307, state: "OPEN", stateReason: null }
                  }
                }
              }
      })
    )
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const git = yield* GitCommand
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-live-runtime-progress-" })
          const sourceRepository = GitRepositoryLocator.make(`${directory}/source`)
          const bin = `${sourceRepository}/packages/dalph/dist/bin`
          yield* fs.makeDirectory(bin, { recursive: true })
          // This controlled child owns only stdout and an unsuccessful exit; it cannot contact providers.
          yield* fs.writeFileString(
            `${bin}/dalph.js`,
            'process.stdout.write(JSON.stringify({_tag:"RunSelected",runId:"run-progress",selection:"Allocated",version:1})+"\\n");process.exitCode=1;\n'
          )
          yield* fs.writeFileString(`${sourceRepository}/pnpm-lock.yaml`, "controlled lockfile\n")
          for (const args of [
            ["init", "--initial-branch=master"],
            ["config", "user.name", "Qualification Test"],
            ["config", "user.email", "qualification@example.invalid"],
            ["add", "."],
            ["commit", "-m", "fixture"]
          ])
            expect((yield* git.runInWorktree(sourceRepository, args)).exitCode).toBe(0)
          const manifest = yield* decodeProductionLiveQualificationManifest({
            ...input,
            sourceRepository,
            builtEntry: `${bin}/dalph.js`,
            lockfile: `${sourceRepository}/pnpm-lock.yaml`,
            publicationContainer: directory,
            artifact: `${directory}/qualification.json`,
            retentionReport: `${directory}/retained-locators.json`
          })
          const result = yield* runProductionLiveQualificationRuntime(manifest, {
            githubToken: Redacted.make("github-secret")
          })
          expect(result).toMatchObject({ _tag: "QualificationFailed", phase: "Execution" })
          const source = yield* fs.readFileString(manifest.retentionReport)
          const report = yield* decodeProductionLiveQualificationRetentionReport(JSON.parse(source))
          expect(report.progress?.map(({ _tag }) => _tag)).toEqual(
            expect.arrayContaining([
              "BuildMeasured",
              "ChildSpawned",
              "FirstCanonicalRecord",
              "RunSelected",
              "StdoutCompleted",
              "StderrCompleted",
              "ProcessCompleted"
            ])
          )
          expect(report.progress).toHaveLength(7)
          expect(report.progress?.[0]).toEqual({ _tag: "BuildMeasured" })
          expect(report.progress?.[1]).toMatchObject({ _tag: "ChildSpawned" })
          expect(report.progress).toContainEqual({ _tag: "RunSelected", runId: "run-progress" })
          expect(report.progress).toContainEqual({ _tag: "ProcessCompleted", exitCode: 1 })
          expect(source).not.toContain("github-secret")
          expect(yield* fs.exists(manifest.artifact)).toBe(false)
          const fixtureContainer = report.local[0]?.locator
          expect(fixtureContainer).toMatch(/^\/tmp\/dalph-live-live-q-307-/u)
          if (fixtureContainer !== undefined) yield* fs.remove(fixtureContainer, { recursive: true })
        })
      ).pipe(Effect.provide(layer), Effect.provideService(GithubGraphqlClient, client))
    )
  })

  it("generates distinct random controlled-provider credentials without serializing their bytes", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* generateProductionLiveControlledProviderCredential()
        const second = yield* generateProductionLiveControlledProviderCredential()
        const firstValue = Redacted.value(first)
        const secondValue = Redacted.value(second)
        expect(firstValue).toMatch(/^[0-9a-f]{64}$/u)
        expect(secondValue).toMatch(/^[0-9a-f]{64}$/u)
        expect(secondValue).not.toBe(firstValue)
        expect(JSON.stringify({ first, second })).not.toContain(firstValue)
        expect(JSON.stringify({ first, second })).not.toContain(secondValue)
      }).pipe(Effect.provide(layer))
    )
  })

  it("strictly decodes the one safe manifest and rejects extra keys", async () => {
    expect(await Effect.runPromise(decodeProductionLiveQualificationManifest(input))).toMatchObject(input)
    await expect(
      Effect.runPromise(decodeProductionLiveQualificationManifest({ ...input, githubToken: "must-not-be-here" }))
    ).rejects.toBeDefined()
    await expect(
      Effect.runPromise(decodeProductionLiveQualificationManifest({ ...input, codexExecutable: "relative/codex" }))
    ).rejects.toBeDefined()
    await expect(
      Effect.runPromise(
        decodeProductionLiveQualificationManifest({ ...input, sourceRepository: "relative/repository" })
      )
    ).rejects.toBeDefined()
  })

  it("rejects the outer controller as the shipped child and requires a distinct outside-Q retention report", async () => {
    await expect(
      Effect.runPromise(
        decodeProductionLiveQualificationManifest({
          ...input,
          builtEntry: "/workspace/dalph/packages/dalph/dist/bin/production-live-qualification.js"
        })
      )
    ).rejects.toBeDefined()
    await expect(
      Effect.runPromise(decodeProductionLiveQualificationManifest({ ...input, retentionReport: input.artifact }))
    ).rejects.toBeDefined()
  })

  it("does not claim completed-run cleanup from missing, duplicate, or reordered observations", () => {
    const exact = {
      selectedCount: 1,
      completedDispositionCount: 1,
      applicationExitDispositionCount: 0,
      orderedJournalIndices: [[1], [2], [3], [4]],
      processStatus: 0
    }
    expect(productionLiveQualificationChronologyIsExact(exact)).toBe(true)
    expect(productionLiveQualificationChronologyIsExact({ ...exact, orderedJournalIndices: [[1], [2, 3], [4]] })).toBe(
      false
    )
    expect(
      productionLiveQualificationChronologyIsExact({ ...exact, orderedJournalIndices: [[1], [3], [2], [4]] })
    ).toBe(false)
    expect(productionLiveQualificationChronologyIsExact({ ...exact, completedDispositionCount: 0 })).toBe(false)
  })

  it("records every final controller reread and Responses Git call as ordered per-operation evidence", () => {
    const boundaries = productionLiveQualificationBoundaryObservations(
      ["ReadIssue", "CreateClaimLabel", "FindClaimLabel"],
      [
        "ExecutorRequest",
        "ExecutorRequest",
        "ExecutorGitReadHead",
        "IntegratorRequest",
        "IntegratorRequest",
        "IntegratorGitReadHead"
      ]
    )
    expect(boundaries).toEqual({
      shippedGithub: ["ReadIssue", "CreateClaimLabel", "FindClaimLabel"],
      responses: [
        "ExecutorRequest",
        "ExecutorRequest",
        "ExecutorGitReadHead",
        "IntegratorRequest",
        "IntegratorRequest",
        "IntegratorGitReadHead"
      ],
      controllerFinal: [
        "GitReadTargetHead",
        "GitReadPublicationHead",
        "TaskTrackerReadGraph",
        "TaskTrackerReadClaim"
      ],
      process: ["Spawn", "Exit"]
    })
    expect(productionLiveQualificationOperationCounts(["Read", "Read"], ["RunSelected"], boundaries)).toEqual(
      expect.arrayContaining([
        { tag: "JournalEvent.Read", count: 2 },
        { tag: "ShippedGithub.ReadIssue", count: 1 },
        { tag: "ShippedGithub.CreateClaimLabel", count: 1 },
        { tag: "ShippedGithub.FindClaimLabel", count: 1 },
        { tag: "Responses.ExecutorGitReadHead", count: 1 },
        { tag: "Responses.IntegratorGitReadHead", count: 1 },
        { tag: "ControllerFinal.GitReadTargetHead", count: 1 },
        { tag: "ControllerFinal.GitReadPublicationHead", count: 1 },
        { tag: "ControllerFinal.TaskTrackerReadGraph", count: 1 },
        { tag: "ControllerFinal.TaskTrackerReadClaim", count: 1 }
      ])
    )
  })

  it("production live qualification fixture separates Codex home from executor private state", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const codexExecutable = nodePath.join(nodeProcess.cwd(), "node_modules/.bin/codex")
        const codexJavaScriptEntry = nodePath.join(nodeProcess.cwd(), "node_modules/@openai/codex/bin/codex.js")
        const fixture = yield* createProductionLiveLocalFixture(
          yield* decodeProductionLiveQualificationManifest({ ...input, codexExecutable, codexJavaScriptEntry }),
          { owner: "dalph-live", repository: "qualification", issueNumber: 307 },
          ProductionLiveResponsesEndpointLocator.make("http://127.0.0.1:4307/v1"),
          "http://127.0.0.1:4308/graphql",
          Redacted.make("github-secret")
        )
        const fs = yield* FileSystem.FileSystem
        expect(fixture.configuration.plannedAttemptBaseSha).toBe(fixture.initialTargetCommit)
        expect(fixture.configuration.claimOwner).toBe("dalph:q:9d733827aa1df60e")
        expect(fixture.localManifest.resources).toHaveLength(12)
        expect(fixture.publicationRepository).not.toBe(fixture.configuration.repository)
        expect(fixture.configuration.remotePublicationTarget).toEqual({
          branch: "refs/heads/master",
          endpoint: fixture.publicationRepository
        })
        expect(JSON.parse(yield* fs.readFileString(fixture.configurationPath)).remotePublicationTarget).toEqual({
          branch: "refs/heads/master",
          endpoint: fixture.publicationRepository
        })
        expect(fixture.codexHome).not.toBe(fixture.configuration.codexExecutorPrivateStateDirectory)
        const config = yield* fs.readFileString(`${fixture.codexHome}/config.toml`)
        expect(config).toContain('base_url = "http://127.0.0.1:4307/v1"')
        expect(config).toContain('env_key = "DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL"')
        expect(config.match(/^\[model_providers\./gmu)).toHaveLength(1)
        expect(config).toContain('model_provider = "dalph-live-qualification"')
        expect(config).toContain("request_max_retries = 0")
        expect(config).toContain("stream_max_retries = 0")
        expect(config.toLowerCase()).not.toContain("openai")
        expect(config).not.toContain("DALPH_CODEX_PROVIDER_CREDENTIAL")
        expect(fixture.configuration.codexExecutable).not.toBe(input.codexExecutable)
        const wrapper = yield* fs.readFileString(fixture.configuration.codexExecutable)
        expect(wrapper).toContain("#!/usr/bin/env bash")
        expect(wrapper).toContain('exec -a "$0"')
        expect(wrapper).toContain(codexJavaScriptEntry)
        expect(wrapper).toContain(`test -r '${codexJavaScriptEntry}'`)
        expect(wrapper).toContain('test "${1-}" = "app-server"')
        expect(
          launchExecutableMatches(fixture.configuration.codexExecutable, [
            fixture.configuration.codexExecutable,
            codexJavaScriptEntry,
            "app-server"
          ])
        ).toBe(true)
        expect(
          launchExecutableMatches(fixture.configuration.codexExecutable, [
            "node",
            "/workspace/dalph/node_modules/@openai/codex/bin/codex.js",
            "app-server"
          ])
        ).toBe(false)
        const child = spawn(fixture.configuration.codexExecutable, ["app-server"], {
          env: { ...nodeProcess.env, CODEX_HOME: fixture.codexHome },
          stdio: "ignore"
        })
        try {
          const observed = yield* Effect.promise(() =>
            waitFor(async () => {
              const source = await readFile(fixture.applicationServerObservationPath, "utf8")
              const match = /^linux:([^:]+):pid:(\d+)$/u.exec(source.trim())
              return match === null ? undefined : { startIdentity: match[1], pid: Number(match[2]) }
            })
          )
          expect(observed.pid).toBe(child.pid)
          const commandLine = yield* Effect.promise(() =>
            waitFor(async () => {
              const values = (await readFile(`/proc/${observed.pid}/cmdline`, "utf8")).split("\0").filter(Boolean)
              return values[0] === fixture.configuration.codexExecutable && values.includes("app-server")
                ? values
                : undefined
            })
          )
          const stat = (yield* Effect.promise(() => readFile(`/proc/${observed.pid}/stat`, "utf8"))).split(" ")
          expect(stat[21]).toBe(observed.startIdentity)
          expect(commandLine).toContain(codexJavaScriptEntry)
          expect(launchExecutableMatches(fixture.configuration.codexExecutable, commandLine)).toBe(true)
        } finally {
          yield* Effect.promise(() => stopChild(child))
        }
        const document = yield* fs.readFileString(fixture.configurationPath)
        expect(document).not.toContain("github-secret")
        yield* fs.remove(fixture.localManifest.container.locator, { recursive: true })
      }).pipe(Effect.provide(layer))
    )
  })

  it("the generated wrapper fails before process observation when its locked entry is missing", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fixture = yield* createProductionLiveLocalFixture(
          yield* decodeProductionLiveQualificationManifest({
            ...input,
            codexJavaScriptEntry: "/missing/@openai/codex/bin/codex.js"
          }),
          { owner: "dalph-live", repository: "qualification", issueNumber: 307 },
          ProductionLiveResponsesEndpointLocator.make("http://127.0.0.1:4307/v1"),
          "http://127.0.0.1:4308/graphql",
          Redacted.make("github-secret")
        )
        const child = spawn(fixture.configuration.codexExecutable, ["app-server"], { stdio: "ignore" })
        const exitCode = yield* Effect.promise(
          () =>
            new Promise<number | null>((resolve, reject) => {
              const timer = nodeTimers.setTimeout(() => {
                child.kill("SIGKILL")
                reject(new Error("missing-entry wrapper did not exit within its hard bound"))
              }, processBoundMilliseconds)
              child.once("error", reject)
              child.once("exit", (code) => {
                clearTimeout(timer)
                resolve(code)
              })
            })
        )
        expect(exitCode).not.toBe(0)
        expect(yield* (yield* FileSystem.FileSystem).readFileString(fixture.applicationServerObservationPath)).toBe("")
        yield* (yield* FileSystem.FileSystem).remove(fixture.localManifest.container.locator, { recursive: true })
      }).pipe(Effect.provide(layer))
    )
  })

  it("preserves the prior valid checkpoint if replacement is interrupted", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const directory = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-live-atomic-checkpoint-" })
          const locator = nodePath.join(directory, "retained-locators.json")
          yield* fs.writeFileString(locator, '{"checkpoint":"prior"}')
          const interrupted = yield* replaceProductionLiveQualificationRetentionReportAtomically(
            locator,
            '{"checkpoint":"replacement"}',
            Effect.interrupt
          ).pipe(Effect.exit)
          expect(Exit.isFailure(interrupted)).toBe(true)
          expect(yield* fs.readFileString(locator)).toBe('{"checkpoint":"prior"}')
          expect(yield* fs.exists(`${locator}.replacement`)).toBe(false)
          yield* replaceProductionLiveQualificationRetentionReportAtomically(locator, '{"checkpoint":"replacement"}')
          expect(yield* fs.readFileString(locator)).toBe('{"checkpoint":"replacement"}')
        })
      ).pipe(Effect.provide(layer))
    )
  })

  it("reports the exact Q container even when local setup fails before returning a fixture manifest", async () => {
    let observedContainer: string | undefined
    await Effect.runPromise(
      Effect.gen(function* () {
        const manifest = yield* decodeProductionLiveQualificationManifest(input)
        const failed = yield* createProductionLiveLocalFixture(
          manifest,
          { owner: "dalph-live", repository: "qualification", issueNumber: 307 },
          ProductionLiveResponsesEndpointLocator.make("http://127.0.0.1:4307/v1"),
          "not-an-http-endpoint",
          Redacted.make("github-secret"),
          (container) =>
            Effect.sync(() => {
              observedContainer = container
            })
        ).pipe(Effect.result)
        expect(failed._tag).toBe("Failure")
        expect(observedContainer).toBeDefined()
        if (observedContainer !== undefined)
          yield* (yield* FileSystem.FileSystem).remove(observedContainer, { recursive: true })
      }).pipe(Effect.provide(layer))
    )
  })

  it("persists the exact remote fixture before local setup or the shipped child can stall", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const output = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-live-remote-checkpoint-" })
          const publicationContainer = `${output}/Q`
          yield* fs.makeDirectory(publicationContainer)
          const manifest = yield* decodeProductionLiveQualificationManifest({
            ...input,
            publicationContainer,
            artifact: `${output}/evidence.json`,
            retentionReport: `${publicationContainer}/retained-locators.json`
          })
          yield* writeProductionLiveQualificationFailureRetentionReport({
            manifest,
            phase: "Setup",
            githubFixture: {
              manifest: {
                resources: [
                  {
                    _tag: "Issue",
                    nodeId: "issue-node-307",
                    number: 307,
                    title: "live-q-307: one disposable Dalph qualification task",
                    body: "live-q-307: create LIVE-QUALIFICATION.md with one sentence and commit the change.",
                    fingerprint: "a".repeat(64)
                  }
                ]
              }
            } as never,
            forwarder: undefined,
            localFixture: undefined,
            localContainer: undefined,
            cleanupState: {}
          })
          const report = JSON.parse(yield* fs.readFileString(manifest.retentionReport)) as {
            readonly phase: string
            readonly github: ReadonlyArray<{
              readonly nodeId: string
              readonly disposition: string
              readonly manualCommand: string
            }>
            readonly local: ReadonlyArray<unknown>
          }
          expect(report.phase).toBe("Setup")
          expect(report.github).toEqual([
            {
              _tag: "Issue",
              nodeId: "issue-node-307",
              disposition: "Retained",
              manualCommand:
                "gh api graphql -f query='query($id: ID!) { node(id: $id) { id __typename } }' -f id='issue-node-307'"
            }
          ])
          expect(report.local).toEqual([])
        })
      ).pipe(Effect.provide(layer))
    )
  })

  it("atomically retains safe progress with cleanup locators for an unfinished recoverable Run", async () => {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const output = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-live-retention-" })
          const publicationContainer = `${output}/Q`
          yield* fs.makeDirectory(publicationContainer)
          const manifest = yield* decodeProductionLiveQualificationManifest({
            ...input,
            publicationContainer,
            artifact: `${output}/evidence.json`,
            retentionReport: `${publicationContainer}/retained-locators.json`
          })
          const fixture = yield* createProductionLiveLocalFixture(
            manifest,
            { owner: "dalph-live", repository: "qualification", issueNumber: 307 },
            ProductionLiveResponsesEndpointLocator.make("http://127.0.0.1:4307/v1"),
            "http://127.0.0.1:4308/graphql",
            Redacted.make("github-secret")
          )
          yield* writeProductionLiveQualificationFailureRetentionReport({
            manifest,
            phase: "Execution",
            githubFixture: undefined,
            forwarder: undefined,
            localFixture: fixture,
            localContainer: undefined,
            cleanupState: {},
            progress: [{ _tag: "BuildMeasured" }]
          })
          const report = JSON.parse(yield* fs.readFileString(manifest.retentionReport)) as {
            readonly local: ReadonlyArray<{ readonly locator: string; readonly disposition: string }>
            readonly progress: ReadonlyArray<{ readonly _tag: string }>
          }
          expect(report.progress).toEqual([{ _tag: "BuildMeasured" }])
          expect(JSON.stringify(report)).not.toContain("github-secret")
          expect(report.local).toHaveLength(fixture.localManifest.resources.length + 1)
          expect(report.local.every(({ disposition }) => disposition === "Retained")).toBe(true)
          expect(report.local.map(({ locator }) => locator)).toContain(fixture.localManifest.container.locator)
          expect(yield* fs.exists(fixture.configuration.repository)).toBe(true)
          yield* writeProductionLiveQualificationFailureRetentionReport({
            manifest,
            phase: "Cleanup",
            githubFixture: undefined,
            forwarder: undefined,
            localFixture: fixture,
            localContainer: undefined,
            cleanupState: {
              local: ProductionLiveFixtureCleanup.cases.Removed.make({
                removed: fixture.localManifest.resources,
                retained: []
              })
            }
          })
          const removedReport = yield* decodeProductionLiveQualificationRetentionReport(
            JSON.parse(yield* fs.readFileString(manifest.retentionReport))
          )
          expect(removedReport.local.every(({ disposition }) => disposition === "Removed")).toBe(true)
          yield* fs.remove(fixture.localManifest.container.locator, { recursive: true })
        })
      ).pipe(Effect.provide(layer))
    )
  })
})
