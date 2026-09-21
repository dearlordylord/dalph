import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { AttemptId, EvidenceDigest, GitCommitSha, IntegrationTargetRef, RunId, TaskId } from "@dalph/contracts"
import {
  GithubIssueNodeId,
  GithubLabelNodeId,
  GithubRepositoryNodeId,
  IntegratorRunOrdinal,
  IntegratorSessionId,
  JournalPosition,
  TargetPromotionRequestId
} from "@dalph/orchestrator"
import { Effect, FileSystem, Schema } from "effect"
import { expect } from "vitest"
import {
  makeProductionLiveQualificationEvidence,
  ProductionLiveQualificationEvidence,
  captureProductionLiveQualificationPreCleanupEvidence,
  publishProductionLiveQualificationEvidence,
  qualificationFailed
} from "../src/qualification/live-qualification-evidence.js"
import {
  QualificationArtifactLocator,
  QualificationPublicationContainer,
  qualificationTranscriptDigest
} from "../src/qualification/qualification-artifact.js"
import { QualificationFormalProvenance } from "../src/qualification/qualification-provenance.js"
import { CodexProcessIdentity } from "../src/application/codex-attempt-store.js"

const sha = (digit: string) => GitCommitSha.make(digit.repeat(40))
const digest = (digit: string) => EvidenceDigest.make(digit.repeat(64))
const sourceSha = sha("a")
const h = sha("1")
const c = sha("2")
const m = sha("3")
const runId = RunId.make("live-run")
const taskId = TaskId.make("live-task")
const attemptId = AttemptId.make("live-attempt")
const repositoryNodeId = GithubRepositoryNodeId.make("live-repository")
const issueNodeId = GithubIssueNodeId.make("live-issue")
const labelNodeId = GithubLabelNodeId.make("live-label")
const targetRef = IntegrationTargetRef.make("refs/heads/master")
const sessionId = IntegratorSessionId.make("live-integration")
const runOrdinal = IntegratorRunOrdinal.make(1)
const promotionRequestId = TargetPromotionRequestId.make("live-promotion")
const applicationServerIdentity = CodexProcessIdentity.make("linux:307:pid:730")
const startedAt = "2026-09-13T14:00:00.000Z"
const endedAt = "2026-09-13T14:05:00.000Z"

const formalCommands = (custodyOffset: number) =>
  Array.from({ length: 105 }, (_value, position) => ({
    position,
    kind: "test" as const,
    name: `formal command ${position}`,
    args: ["test", `specs/formal-${position}.qnt`] as const,
    verdict: {
      acceptedExitCodes: [0] as const,
      witnesses: [],
      temporal: null,
      collectedReplacementTest: false,
      artifactPreparedAfter: false
    },
    result: "exit:0" as const,
    obligationId: `00000000-0000-4000-8000-${String(custodyOffset * 1_000 + position + 1).padStart(12, "0")}`,
    durationMilliseconds: 1
  }))
const formalProfileFields = (profileKind: "dedicated" | "stressed", jobId: number) => ({
  sourceSha,
  nodeVersion: "24.20.0",
  runId: 71,
  runAttempt: 1,
  profileDigest: digest("9"),
  formalSeconds: 105,
  completeProfileSeconds: 115,
  shards: [0, 1].map((shard) => ({
    shard,
    condition:
      profileKind === "dedicated"
        ? { kind: "dedicated-hosted-job" as const, runnerLabel: "ubuntu-24.04-arm" as const, effectiveParallelism: 4 }
        : {
            kind: "cpu-affinity" as const,
            runnerLabel: "ubuntu-latest" as const,
            cpuList: "0-1" as const,
            hostParallelism: 4,
            effectiveParallelism: 2 as const
          },
    job: {
      workflow: "Production live qualification" as const,
      runId: 71,
      runAttempt: 1,
      jobId: jobId + shard,
      name: `${profileKind === "dedicated" ? "Dedicated" : "Stressed"} formal evidence shard ${shard}`
    },
    reportDigest: digest(String((jobId + shard) % 10)),
    positions: Array.from({ length: 105 }, (_value, position) => position).filter((position) =>
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
    ),
    setupInstallSeconds: 10,
    formalSeconds: 105 - shard,
    completeJobSeconds: 115,
    remainingHostedSeconds: 845,
    hostedLimitSeconds: 960 as const,
    startedAt: "2026-09-13T12:00:00.000Z",
    completedAt: "2026-09-13T12:01:55.000Z"
  })),
  commands: formalCommands(jobId),
  negativeControls: ["collected temporal mutant"] as const
})
const dedicatedFormalProfile = (jobId: number) => ({
  profileKind: "dedicated" as const,
  ...formalProfileFields("dedicated", jobId)
})
const stressedFormalProfile = (jobId: number) => ({
  profileKind: "stressed" as const,
  ...formalProfileFields("stressed", jobId)
})

const validInput = Effect.fn("LiveEvidenceTest.validInput")(function* () {
  const records = [
    { _tag: "RunSelected" as const, runId, selection: "Allocated" as const, version: 1 as const },
    { _tag: "RunDisposition" as const, runId, disposition: "Completed" as const, version: 1 as const }
  ]
  return {
    schemaVersion: 1,
    artifactStage: "Final",
    scenario: "ProductionHappy",
    mode: "Live",
    invocationId: "live-Q",
    startedAt,
    endedAt,
    build: {
      sourceSha,
      sourceBaseSha: sha("b"),
      builtEntryDigest: digest("4"),
      lockfileDigest: digest("5"),
      configurationDigest: digest("6"),
      operatingSystem: "linux",
      architecture: "x64",
      nodeVersion: "24.20.0",
      pnpmVersion: "10.29.3"
    },
    hosted: {
      sourceSha,
      workflow: "Production live qualification",
      runId: 71,
      runAttempt: 1,
      job: "qualify",
      protectedEnvironment: "production-live-qualification"
    },
    formal: yield* Schema.decodeUnknownEffect(QualificationFormalProvenance.cases.DedicatedAndStressed)({
      _tag: "DedicatedAndStressed",
      dedicated: dedicatedFormalProfile(72),
      stressed: stressedFormalProfile(74)
    }),
    fixture: { repositoryNodeId, issueNodeId, labelNodeIds: [labelNodeId] },
    composition: {
      applicationServerProcessIdentities: [applicationServerIdentity],
      taskWorktreeCount: 1,
      integrationTargetCount: 1
    },
    delivery: {
      runId,
      taskId,
      attemptId,
      baseCommit: h,
      acceptedCommit: c,
      acceptedEvidence: { digest: digest("7"), byteLength: 91 },
      candidateCommit: m,
      candidateParents: [h, c],
      targetRef,
      integration: { sessionId, runOrdinal },
      promotionRequestId,
      initialTargetCommit: h,
      finalTargetCommit: m,
      remotePublicationHead: m
    },
    journal: {
      positions: [JournalPosition.make(1), JournalPosition.make(2)],
      occurrences: [
        "RunSelected",
        "ClaimAcquired",
        "AttemptPlanned",
        "ExecutorAccepted",
        "IntegrationStarted",
        "CandidateQualified",
        "TargetPromoted",
        "TaskCompleted",
        "ClaimsReleased",
        "RunCompleted"
      ],
      orderedEventTags: ["WorkflowRunBegan", "WorkflowRunTerminated"]
    },
    orderedBoundaryTags: {
      shippedGithub: [
        "ResolveIssue",
        "ReadIssue",
        "CreateClaimLabel",
        "FindClaimLabel",
        "CreateClaimLabel",
        "FindClaimLabel",
        "CloseIssue",
        "DeleteClaimLabel",
        "DeleteClaimLabel",
        "ReadIssue"
      ],
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
    },
    operationCounts: [
      { tag: "JournalEvent.WorkflowRunBegan", count: 1 },
      { tag: "JournalEvent.WorkflowRunTerminated", count: 1 },
      { tag: "PublicRecord.RunSelected", count: 1 },
      { tag: "PublicRecord.RunDisposition", count: 1 },
      { tag: "ShippedGithub.ResolveIssue", count: 1 },
      { tag: "ShippedGithub.ReadIssue", count: 2 },
      { tag: "ShippedGithub.CreateClaimLabel", count: 2 },
      { tag: "ShippedGithub.FindClaimLabel", count: 2 },
      { tag: "ShippedGithub.CloseIssue", count: 1 },
      { tag: "ShippedGithub.DeleteClaimLabel", count: 2 },
      { tag: "Responses.ExecutorRequest", count: 2 },
      { tag: "Responses.ExecutorGitReadHead", count: 1 },
      { tag: "Responses.IntegratorRequest", count: 2 },
      { tag: "Responses.IntegratorGitReadHead", count: 1 },
      { tag: "ControllerFinal.GitReadTargetHead", count: 1 },
      { tag: "ControllerFinal.GitReadPublicationHead", count: 1 },
      { tag: "ControllerFinal.TaskTrackerReadGraph", count: 1 },
      { tag: "ControllerFinal.TaskTrackerReadClaim", count: 1 },
      { tag: "Process.Spawn", count: 1 },
      { tag: "Process.Exit", count: 1 }
    ],
    publicRecords: { values: records, digest: yield* qualificationTranscriptDigest(records) },
    final: {
      tracker: { lifecycle: "Completed", claims: [] },
      run: { runId, disposition: "Completed" },
      process: { status: 0 }
    },
    cleanup: {
      _tag: "Completed",
      github: {
        removedIssueNodeId: issueNodeId,
        resolvedLabels: [{ _tag: "AlreadyAbsent", nodeId: labelNodeId }],
        retained: []
      },
      local: { _tag: "RemovedFixture", removedResourceCount: 9, containerAbsent: true, retained: [] }
    }
  }
})

it.effect("Alice can qualify only exact version-one live evidence with no private fields", () =>
  Effect.gen(function* () {
    const input = yield* validInput()
    const evidence = yield* makeProductionLiveQualificationEvidence(input)
    expect(evidence.mode).toBe("Live")
    expect(evidence.scenario).toBe("ProductionHappy")
    expect(evidence.startedAt).toBe(startedAt)
    expect(evidence.endedAt).toBe(endedAt)
    expect(evidence.schemaVersion).toBe(1)
    expect(evidence.delivery).toEqual(input.delivery)
    expect(evidence.delivery).toMatchObject({ targetRef, integration: { sessionId, runOrdinal }, promotionRequestId })
    expect(evidence.journal.occurrences).toEqual(input.journal.occurrences)
    expect(evidence.orderedBoundaryTags).toEqual(input.orderedBoundaryTags)
    expect(evidence.operationCounts).toEqual(input.operationCounts)
    expect(evidence.publicRecords.values.every(({ _tag }) => _tag !== "ApplicationExitDisposition")).toBe(true)
    expect(JSON.stringify(evidence)).not.toMatch(/thread|worktree|candidateResource|privateStore/u)
    const rejected = yield* makeProductionLiveQualificationEvidence({
      ...input,
      privateStore: "/home/alice/private.json",
      providerResponse: "secret-response"
    }).pipe(Effect.flip)
    expect(rejected).toEqual(qualificationFailed("EvidenceValidation"))
    expect(JSON.stringify(rejected)).not.toContain("secret-response")
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect(
  "Alice sees complete ordered live observations and exact counts including final rereads and Responses Git calls",
  () =>
    Effect.gen(function* () {
      const input = yield* validInput()
      for (const changed of [
        {
          ...input,
          orderedBoundaryTags: {
            ...input.orderedBoundaryTags,
            responses: [...input.orderedBoundaryTags.responses].reverse()
          }
        },
        {
          ...input,
          operationCounts: input.operationCounts.filter(({ tag }) => tag !== "ControllerFinal.TaskTrackerReadClaim")
        },
        {
          ...input,
          operationCounts: input.operationCounts.map((count) =>
            count.tag === "Responses.IntegratorGitReadHead" ? { ...count, count: 2 } : count
          )
        },
        {
          ...input,
          orderedBoundaryTags: {
            ...input.orderedBoundaryTags,
            shippedGithub: [
              ...input.orderedBoundaryTags.shippedGithub.slice(0, 7),
              "CloseIssue",
              ...input.orderedBoundaryTags.shippedGithub.slice(7)
            ]
          },
          operationCounts: input.operationCounts.map((count) =>
            count.tag === "ShippedGithub.CloseIssue" ? { ...count, count: 2 } : count
          )
        },
        {
          ...input,
          orderedBoundaryTags: {
            ...input.orderedBoundaryTags,
            shippedGithub: [...input.orderedBoundaryTags.shippedGithub.slice(0, 8), "ReadIssue", "DeleteClaimLabel"]
          }
        },
        { ...input, startedAt: "2026-09-13T14:05:00.000Z", endedAt: "2026-09-13T14:00:00.000Z" },
        { ...input, startedAt: "not-a-timestamp" }
      ]) {
        expect(yield* makeProductionLiveQualificationEvidence(changed).pipe(Effect.flip)).toEqual(
          qualificationFailed("EvidenceValidation")
        )
      }
    }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("Alice rejects one-fact mutations at every remaining live evidence validation boundary", () =>
  Effect.gen(function* () {
    const input = yield* validInput()
    const duplicateOperationCount = {
      ...input,
      operationCounts: [
        ...input.operationCounts.slice(0, 1),
        ...input.operationCounts.slice(0, 1),
        ...input.operationCounts.slice(1)
      ]
    }
    for (const changed of [
      duplicateOperationCount,
      { ...input, fixture: { ...input.fixture, labelNodeIds: [labelNodeId, labelNodeId] } },
      { ...input, journal: { ...input.journal, occurrences: [...input.journal.occurrences].reverse() } },
      { ...input, composition: { ...input.composition, applicationServerProcessIdentities: ["not-a-linux-process"] } },
      { ...input, journal: { ...input.journal, positions: input.journal.positions.slice(0, 1) } },
      { ...input, final: { ...input.final, run: { ...input.final.run, runId: RunId.make("different-run") } } },
      {
        ...input,
        cleanup: {
          ...input.cleanup,
          github: {
            ...input.cleanup.github,
            resolvedLabels: [...input.cleanup.github.resolvedLabels, ...input.cleanup.github.resolvedLabels]
          }
        }
      }
    ]) {
      expect(yield* makeProductionLiveQualificationEvidence(changed).pipe(Effect.flip)).toEqual(
        qualificationFailed("EvidenceValidation")
      )
    }
    expect(
      yield* Schema.decodeUnknownEffect(ProductionLiveQualificationEvidence)({
        ...input,
        hosted: { ...input.hosted, sourceSha: sha("9") }
      }).pipe(Effect.flip)
    ).toBeDefined()
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("Alice receives only same-source protected hosted and required dedicated plus stressed provenance", () =>
  Effect.gen(function* () {
    const input = yield* validInput()
    for (const changed of [
      { ...input, hosted: { ...input.hosted, sourceSha: sha("9") } },
      { ...input, hosted: { ...input.hosted, runAttempt: 2 } },
      {
        ...input,
        formal: {
          _tag: "DedicatedAndStressed" as const,
          dedicated: { ...input.formal.dedicated, sourceSha: sha("9") },
          stressed: input.formal.stressed
        }
      },
      {
        ...input,
        formal: {
          _tag: "DedicatedAndStressed" as const,
          dedicated: input.formal.dedicated,
          stressed: {
            ...input.formal.stressed,
            shards: [
              { ...input.formal.stressed.shards[0], job: input.formal.dedicated.shards[0].job },
              input.formal.stressed.shards[1]
            ]
          }
        }
      },
      { ...input, formal: { ...input.formal, dedicated: { ...input.formal.dedicated, completeProfileSeconds: 116 } } },
      {
        ...input,
        formal: {
          ...input.formal,
          stressed: {
            ...input.formal.stressed,
            shards: [{ ...input.formal.stressed.shards[0], positions: [0] }, input.formal.stressed.shards[1]]
          }
        }
      }
    ]) {
      expect(yield* makeProductionLiveQualificationEvidence(changed).pipe(Effect.flip)).toEqual(
        qualificationFailed("ProvenanceValidation")
      )
    }
    expect(
      yield* Schema.decodeUnknownEffect(ProductionLiveQualificationEvidence)({
        ...input,
        formal: { _tag: "NotSupplied", reason: "LocalHermeticInvocation" }
      }).pipe(Effect.flip)
    ).toBeDefined()
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("Alice's exact H C M T and branded integration and promotion identities survive validation", () =>
  Effect.gen(function* () {
    const input = yield* validInput()
    for (const delivery of [
      { ...input.delivery, candidateParents: [c, h] },
      { ...input.delivery, initialTargetCommit: sha("8") },
      { ...input.delivery, finalTargetCommit: sha("8") },
      { ...input.delivery, remotePublicationHead: sha("8") }
    ]) {
      expect(yield* makeProductionLiveQualificationEvidence({ ...input, delivery }).pipe(Effect.flip)).toEqual(
        qualificationFailed("EvidenceValidation")
      )
    }
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect(
  "Alice cannot qualify an incomplete run, failed process, remaining claim, bad transcript, or retained fixture",
  () =>
    Effect.gen(function* () {
      const input = yield* validInput()
      const applicationExitRecords = [
        ...input.publicRecords.values,
        {
          _tag: "ApplicationExitDisposition" as const,
          runId,
          disposition: { _tag: "Succeeded" as const, requestedStatus: 0 as const },
          version: 1 as const
        }
      ]
      const invalid = [
        { ...input, final: { ...input.final, tracker: { lifecycle: "Completed", claims: ["claim"] } } },
        { ...input, final: { ...input.final, run: { runId, disposition: "Blocked" } } },
        { ...input, final: { ...input.final, process: { status: 1 } } },
        {
          ...input,
          composition: {
            ...input.composition,
            applicationServerProcessIdentities: [
              applicationServerIdentity,
              CodexProcessIdentity.make("linux:308:pid:731")
            ]
          }
        },
        { ...input, composition: { ...input.composition, applicationServerProcessIdentities: [] } },
        {
          ...input,
          publicRecords: {
            ...input.publicRecords,
            values: [
              { _tag: "Failure", version: 1, code: "configuration.invalid", detail: "secret", subject: "secret" }
            ]
          }
        },
        {
          ...input,
          publicRecords: {
            values: applicationExitRecords,
            digest: yield* qualificationTranscriptDigest(applicationExitRecords)
          }
        },
        { ...input, publicRecords: { ...input.publicRecords, digest: digest("0") } },
        { ...input, cleanup: { ...input.cleanup, local: { ...input.cleanup.local, retained: ["Q"] } } },
        {
          ...input,
          cleanup: {
            ...input.cleanup,
            github: { ...input.cleanup.github, removedIssueNodeId: GithubIssueNodeId.make("other") }
          }
        }
      ]
      for (const changed of invalid) {
        const failure = yield* makeProductionLiveQualificationEvidence(changed).pipe(Effect.flip)
        expect(failure._tag).toBe("QualificationFailed")
        expect("evidence" in failure).toBe(false)
        expect(JSON.stringify(failure)).not.toContain("secret")
      }
    }).pipe(Effect.provide(NodeCrypto.layer), Effect.provide(NodeServices.layer))
)

it.effect("Alice receives one schema-versioned artifact replaced at the same path after factual cleanup", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-live-evidence-" })
      const container = QualificationPublicationContainer.make(`${root}/Q`)
      yield* fs.makeDirectory(container)
      const artifact = QualificationArtifactLocator.make(`${root}/live.json`)
      const input = yield* validInput()
      yield* captureProductionLiveQualificationPreCleanupEvidence(container, artifact, {
        ...input,
        artifactStage: "PreCleanup",
        cleanup: { _tag: "Pending" }
      })
      expect(
        yield* captureProductionLiveQualificationPreCleanupEvidence(container, artifact, input).pipe(Effect.flip)
      ).toEqual(qualificationFailed("EvidenceValidation"))
      expect(
        yield* publishProductionLiveQualificationEvidence(container, artifact, {
          ...input,
          artifactStage: "PreCleanup",
          cleanup: { _tag: "Pending" }
        }).pipe(Effect.flip)
      ).toEqual(qualificationFailed("EvidenceValidation"))
      expect(JSON.parse(yield* fs.readFileString(artifact))).toMatchObject({ artifactStage: "PreCleanup" })
      const outcome = yield* publishProductionLiveQualificationEvidence(container, artifact, input)
      expect(outcome._tag).toBe("Qualified")
      expect(yield* fs.exists(artifact)).toBe(true)
      expect(JSON.parse(yield* fs.readFileString(artifact))).toMatchObject({
        artifactStage: "Final",
        cleanup: { _tag: "Completed" }
      })
      expect(yield* fs.exists(`${artifact}.pre-cleanup`)).toBe(false)
      expect(yield* fs.exists(`${artifact}.replacement`)).toBe(false)
      const inside = QualificationArtifactLocator.make(`${container}/live.json`)
      expect(
        (yield* publishProductionLiveQualificationEvidence(container, inside, input).pipe(Effect.flip)).phase
      ).toBe("Publication")
      expect(yield* fs.exists(inside)).toBe(false)
    })
  ).pipe(Effect.provide(NodeCrypto.layer), Effect.provide(NodeServices.layer))
)

it.effect("same-path pre-cleanup evidence survives a mismatched final replacement without claiming cleanup", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-live-two-phase-" })
      const container = QualificationPublicationContainer.make(`${root}/Q`)
      yield* fs.makeDirectory(container)
      const artifact = QualificationArtifactLocator.make(`${root}/live.json`)
      const input = yield* validInput()
      const captured = yield* captureProductionLiveQualificationPreCleanupEvidence(container, artifact, {
        ...input,
        artifactStage: "PreCleanup",
        cleanup: { _tag: "Pending" }
      })
      expect(captured.evidence.cleanup).toEqual({ _tag: "Pending" })
      expect(
        (yield* publishProductionLiveQualificationEvidence(container, artifact, {
          ...input,
          endedAt: "2026-09-13T14:06:00.000Z"
        }).pipe(Effect.flip)).phase
      ).toBe("Publication")
      expect(yield* fs.exists(artifact)).toBe(true)
      expect(JSON.parse(yield* fs.readFileString(artifact))).toMatchObject({
        artifactStage: "PreCleanup",
        cleanup: { _tag: "Pending" }
      })
    })
  ).pipe(Effect.provide(NodeCrypto.layer), Effect.provide(NodeServices.layer))
)
