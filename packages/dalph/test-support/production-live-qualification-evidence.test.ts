import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { AttemptId, EvidenceDigest, GitCommitSha, RunId, TaskId } from "@dalph/contracts"
import { GithubIssueNodeId, GithubLabelNodeId, GithubRepositoryNodeId, JournalPosition } from "@dalph/orchestrator"
import { Effect, FileSystem, Schema } from "effect"
import { expect } from "vitest"
import {
  makeProductionLiveQualificationEvidence,
  ProductionLiveQualificationEvidence,
  publishProductionLiveQualificationEvidence,
  qualificationFailed
} from "../src/qualification/live-qualification-evidence.js"
import {
  QualificationArtifactLocator,
  QualificationPublicationContainer,
  qualificationTranscriptDigest
} from "../src/qualification/qualification-artifact.js"
import { QualificationFormalProvenance } from "../src/qualification/qualification-provenance.js"

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

const formalProfile = (jobId: number) => ({
  sourceSha,
  nodeVersion: "24.20.0",
  job: { workflow: "Candidate qualification" as const, runId: 71, jobId },
  logDigest: digest(String(jobId % 10)),
  setupInstallSeconds: 10,
  formalSeconds: 105,
  completeJobSeconds: 115,
  remainingHostedSeconds: 845,
  hostedLimitSeconds: 960 as const,
  commands: [],
  negativeControls: ["collected temporal mutant"] as const
})

const validInput = Effect.fn("LiveEvidenceTest.validInput")(function* () {
  const records = [
    { _tag: "RunSelected" as const, runId, selection: "Allocated" as const, version: 1 as const },
    { _tag: "RunDisposition" as const, runId, disposition: "Completed" as const, version: 1 as const },
    {
      _tag: "ApplicationExitDisposition" as const,
      runId,
      disposition: { _tag: "Succeeded" as const, requestedStatus: 0 as const },
      version: 1 as const
    }
  ]
  return {
    schemaVersion: 1,
    mode: "Live",
    invocationId: "live-Q",
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
      job: "qualify",
      protectedEnvironment: "production-live-qualification"
    },
    formal: QualificationFormalProvenance.cases.DedicatedAndStressed.make({
      dedicated: formalProfile(72),
      stressed: formalProfile(73)
    }),
    fixture: { repositoryNodeId, issueNodeId, labelNodeIds: [labelNodeId] },
    delivery: {
      runId,
      taskId,
      attemptId,
      baseCommit: h,
      acceptedCommit: c,
      acceptedEvidence: { digest: digest("7"), byteLength: 91 },
      candidateCommit: m,
      candidateParents: [h, c],
      initialTargetCommit: h,
      finalTargetCommit: m
    },
    journal: {
      positions: [JournalPosition.make(1), JournalPosition.make(2)],
      occurrences: [
        "RunSelected",
        "AttemptPlanned",
        "ExecutorAccepted",
        "CandidateQualified",
        "TargetPromoted",
        "TaskCompleted",
        "RunCompleted"
      ]
    },
    boundaryCalls: [
      { tag: "TaskTracker", count: 1 },
      { tag: "Executor", count: 1 },
      { tag: "Integrator", count: 1 },
      { tag: "TargetPromotion", count: 1 },
      { tag: "ApplicationExit", count: 1 }
    ],
    publicRecords: { values: records, digest: yield* qualificationTranscriptDigest(records) },
    final: {
      tracker: { lifecycle: "Completed", claims: [] },
      run: { runId, disposition: "Completed" },
      application: { disposition: "Succeeded", status: 0 }
    },
    cleanup: {
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
    expect(evidence.schemaVersion).toBe(1)
    expect(evidence.delivery).toEqual(input.delivery)
    expect(JSON.stringify(evidence)).not.toMatch(/thread|session|worktree|candidateResource|privateStore/u)
    const rejected = yield* makeProductionLiveQualificationEvidence({
      ...input,
      privateStore: "/home/alice/private.json",
      providerResponse: "secret-response"
    }).pipe(Effect.flip)
    expect(rejected).toEqual(qualificationFailed("EvidenceValidation"))
    expect(JSON.stringify(rejected)).not.toContain("secret-response")
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("Alice receives only same-source protected hosted and required dedicated plus stressed provenance", () =>
  Effect.gen(function* () {
    const input = yield* validInput()
    for (const changed of [
      { ...input, hosted: { ...input.hosted, sourceSha: sha("9") } },
      {
        ...input,
        formal: QualificationFormalProvenance.cases.DedicatedAndStressed.make({
          dedicated: { ...input.formal.dedicated, sourceSha: sha("9") },
          stressed: input.formal.stressed
        })
      },
      {
        ...input,
        formal: QualificationFormalProvenance.cases.DedicatedAndStressed.make({
          dedicated: input.formal.dedicated,
          stressed: { ...input.formal.stressed, job: input.formal.dedicated.job }
        })
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

it.effect("Alice's H C M and final target are accepted only with exact causal equality", () =>
  Effect.gen(function* () {
    const input = yield* validInput()
    for (const delivery of [
      { ...input.delivery, candidateParents: [c, h] },
      { ...input.delivery, initialTargetCommit: sha("8") },
      { ...input.delivery, finalTargetCommit: sha("8") }
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
      const invalid = [
        { ...input, final: { ...input.final, tracker: { lifecycle: "Completed", claims: ["claim"] } } },
        { ...input, final: { ...input.final, run: { runId, disposition: "Blocked" } } },
        { ...input, final: { ...input.final, application: { disposition: "Failed", status: 1 } } },
        {
          ...input,
          publicRecords: {
            ...input.publicRecords,
            values: [
              { _tag: "Failure", version: 1, code: "configuration.invalid", detail: "secret", subject: "secret" }
            ]
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

it.effect("Alice receives one write-once artifact outside Q only after the complete live success validates", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-live-evidence-" })
      const container = QualificationPublicationContainer.make(`${root}/Q`)
      yield* fs.makeDirectory(container)
      const artifact = QualificationArtifactLocator.make(`${root}/live.json`)
      const input = yield* validInput()
      const outcome = yield* publishProductionLiveQualificationEvidence(container, artifact, input)
      expect(outcome._tag).toBe("Qualified")
      expect(yield* fs.exists(artifact)).toBe(true)
      expect(
        (yield* publishProductionLiveQualificationEvidence(container, artifact, input).pipe(Effect.flip)).phase
      ).toBe("Publication")
      const inside = QualificationArtifactLocator.make(`${container}/live.json`)
      expect(
        (yield* publishProductionLiveQualificationEvidence(container, inside, input).pipe(Effect.flip)).phase
      ).toBe("Publication")
      expect(yield* fs.exists(inside)).toBe(false)
    })
  ).pipe(Effect.provide(NodeCrypto.layer), Effect.provide(NodeServices.layer))
)
