import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { GitCommitSha, GitRepositoryLocator } from "@dalph/contracts"
import { GitCommand, nodeGitCommandLayer } from "@dalph/orchestrator"
import { Effect, FileSystem, Layer, Schema } from "effect"
import { expect } from "vitest"
import { quintGateCommandManifest } from "../../../scripts/quint-gate-command-manifest.mjs"
import { HermeticFixtureContainer } from "./production-hermetic-controller.js"
import { HermeticFixtureResource } from "../src/application/production-hermetic-contract.js"
import {
  ProductionMvpQualificationEvidence,
  publishQualificationEvidence,
  qualificationCleanupDisposition
} from "./production-mvp-qualification-evidence.js"
import {
  measureQualificationBuild,
  qualificationDigest,
  qualificationFormalProvenance,
  requiredQualificationFormalProvenance,
  type SuppliedQualificationProfile
} from "../src/qualification/qualification-provenance.js"
import {
  QualificationArtifactLocator,
  qualificationTranscriptDigest,
  writeQualificationArtifact
} from "../src/qualification/qualification-artifact.js"

const sourceSha = GitCommitSha.make("06d1661f8a2af9a65022e3807643e3f58b5ab969")
const otherSha = GitCommitSha.make("bf027ef1588d0ec0d0e749b812d6652343682c3b")
const fixtureLayer = nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer), Layer.merge(NodeCrypto.layer))
const abcDigest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"

const schemaEvidence = (container: string, transcriptDigest: string) => {
  const repository = { owner: "hermetic", name: "qualification", nodeId: "hermetic-repository" }
  const runId = "00000000-0000-7000-8000-000000000001"
  return {
    schemaVersion: 1,
    scenario: "CompletionThrottle",
    mode: "Hermetic",
    invocationId: "unit-Q",
    startedAt: "2026-09-13T00:00:00.000Z",
    endedAt: "2026-09-13T00:00:01.000Z",
    build: {
      sourceSha: otherSha,
      sourceBaseSha: sourceSha,
      builtEntryDigest: abcDigest,
      lockfileDigest: abcDigest,
      configurationDigest: abcDigest,
      operatingSystem: "linux",
      architecture: "x64",
      nodeVersion: "24.20.0",
      pnpmVersion: "10.0.0"
    },
    fixture: {
      invocationId: "unit-Q",
      sourceBaseSha: sourceSha,
      builtEntry: "/tmp/unit-entry.js",
      builtEntryDigest: abcDigest,
      repository: `${container}/repository`,
      commonDirectory: `${container}/repository/.git`,
      integrationRef: "refs/heads/master",
      baseSha: otherSha,
      journalDatabase: `${container}/journal.sqlite`,
      evidenceRoot: `${container}/evidence`,
      attemptWorktreeRoot: `${container}/worktrees`,
      codexStateDirectory: `${container}/codex`,
      candidateRoot: `${container}/candidates`,
      privateStore: `${container}/private.json`,
      ownershipMarker: `${container}/Q.marker`
    },
    taskId: "unit-task",
    runs: [{ _tag: "Unfinished", runId }],
    processes: [{ _tag: "Exit", processId: 123, status: 1 }],
    plannedAttempts: [],
    executor: { _tag: "NotReached", reason: "NoAcceptedExecutorResult" },
    integration: { _tag: "NotReached", reason: "NoIntegratorSession" },
    promotion: { _tag: "NotReached", reason: "NoPromotionRequest" },
    journal: { cursor: { runId, position: 1 }, positions: [1] },
    boundaries: [],
    operationCounts: [],
    finalTargetHead: otherSha,
    finalTracker: {
      original: { invocationId: "unit-Q", repository, resources: [] },
      issuePresent: true,
      lifecycle: "Open",
      claims: []
    },
    transcript: {
      records: [{ _tag: "RunSelected", runId, selection: "Allocated", version: 1 }],
      digest: transcriptDigest
    },
    formal: { _tag: "NotSupplied", reason: "LocalHermeticInvocation" },
    githubCleanup: { repository, removed: [], alreadyAbsent: [], retained: [] },
    localCleanup: {
      _tag: "RetainedFixture",
      cause: { _tag: "UnfinishedRun" },
      retained: [],
      removed: [],
      retainedContainer: container
    },
    cleanupDisposition: {
      _tag: "QualificationCleanupIncomplete",
      github: { repository, removed: [], alreadyAbsent: [], retained: [] },
      local: {
        _tag: "RetainedFixture",
        cause: { _tag: "UnfinishedRun" },
        retained: [],
        removed: [],
        retainedContainer: container
      },
      localInspectionCommands: []
    }
  }
}

it.effect(
  "reports incomplete cleanup independently of publication and preserves exact read-only local inspection locators",
  () =>
    Effect.gen(function* () {
      const evidence = Schema.decodeUnknownSync(ProductionMvpQualificationEvidence)(
        schemaEvidence("/tmp/unit-Q", yield* qualificationTranscriptDigest([]))
      )
      const complete = qualificationCleanupDisposition(evidence.githubCleanup, {
        _tag: "RemovedResources",
        removed: [],
        retainedContainer: evidence.localCleanup.retainedContainer
      })
      expect(complete._tag).toBe("QualificationCleanupComplete")
      const resource = Schema.decodeUnknownSync(HermeticFixtureResource)({
        _tag: "ConfigurationDocument",
        locator: "/tmp/unit-Q/config'with$characters.json"
      })
      const local = {
        _tag: "RetainedFixture" as const,
        cause: { _tag: "UnfinishedRun" as const },
        retained: [resource],
        removed: [],
        retainedContainer: evidence.localCleanup.retainedContainer
      }
      const incomplete = qualificationCleanupDisposition(evidence.githubCleanup, local)
      expect(incomplete._tag).toBe("QualificationCleanupIncomplete")
      if (incomplete._tag === "QualificationCleanupIncomplete") {
        expect(incomplete.local).toStrictEqual(local)
        expect(incomplete.github).toStrictEqual(evidence.githubCleanup)
        expect(incomplete.localInspectionCommands[0]?.resource).toStrictEqual(resource)
        expect(incomplete.localInspectionCommands[0]?.command).toContain("lstatSync")
        expect(incomplete.localInspectionCommands[0]?.command).not.toMatch(/unlink|rmSync|mutation/u)
      }
    }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("complete artifact schema rejects original unknown fields and free failure text before a write", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-complete-evidence-unit-" })
      const container = HermeticFixtureContainer.make(`${root}/Q`)
      yield* fs.makeDirectory(container)
      const initial = yield* Schema.decodeUnknownEffect(ProductionMvpQualificationEvidence)(
        schemaEvidence(container, abcDigest)
      )
      const digest = yield* qualificationTranscriptDigest(initial.transcript.records)
      if (initial.localCleanup._tag !== "RetainedFixture")
        return yield* Effect.die("unit fixture requires retained cleanup")
      const resource = Schema.decodeUnknownSync(HermeticFixtureResource)({
        _tag: "ConfigurationDocument",
        locator: `${container}/configuration.json`
      })
      const localCleanup = { ...initial.localCleanup, retained: [resource] }
      const evidence = {
        ...initial,
        localCleanup,
        cleanupDisposition: qualificationCleanupDisposition(initial.githubCleanup, localCleanup),
        transcript: { ...initial.transcript, digest }
      }
      const output = QualificationArtifactLocator.make(`${root}/complete.json`)
      const unknownInput = { ...evidence, private_configuration: "qualification-private-sentinel" }
      const rejected = yield* publishQualificationEvidence(container, output, unknownInput).pipe(Effect.flip)
      expect(rejected.operation).toBe("ValidateEvidence")
      expect(JSON.stringify(rejected)).not.toContain("qualification-private-sentinel")
      expect(yield* fs.exists(output)).toBe(false)
      const ordinaryFailure = yield* Schema.decodeUnknownEffect(ProductionMvpQualificationEvidence)({
        ...evidence,
        transcript: {
          records: [
            {
              _tag: "Failure",
              version: 1,
              code: "configuration.invalid",
              detail: "qualification-private-sentinel",
              subject: "qualification-private-subject"
            }
          ],
          digest
        }
      })
      expect(
        (yield* publishQualificationEvidence(container, output, ordinaryFailure).pipe(Effect.flip)).operation
      ).toBe("ValidateEvidence")
      expect(yield* fs.exists(output)).toBe(false)
      expect(yield* publishQualificationEvidence(container, output, evidence)).toBe(output)
      const originalBytes = yield* fs.readFileString(output)
      const decoded = yield* Schema.decodeUnknownEffect(Schema.fromJsonString(ProductionMvpQualificationEvidence))(
        originalBytes
      )
      expect(decoded).toEqual(evidence)
      const unavailable = QualificationArtifactLocator.make(`${root}/missing/complete.json`)
      expect((yield* publishQualificationEvidence(container, unavailable, evidence).pipe(Effect.flip)).operation).toBe(
        "WriteArtifact"
      )
      expect(yield* fs.exists(unavailable)).toBe(false)
      expect(evidence.runs).toEqual(initial.runs)
      expect(evidence.processes).toEqual(initial.processes)
      expect(evidence.localCleanup).toEqual(localCleanup)
      expect(evidence.githubCleanup).toEqual(initial.githubCleanup)
    })
  ).pipe(Effect.provide(NodeServices.layer), Effect.provide(NodeCrypto.layer))
)

const formalLog = () =>
  [
    ...quintGateCommandManifest.map(
      ({ kind, name }) =>
        `Quint command timing: ${kind} ${name} 1.00s result=${name.includes("temporal mutant") ? "exit:1" : "exit:0"}`
    ),
    "Quint phase timing: typecheck 15 command(s), 15.00s",
    "Quint phase timing: test 46 command(s), 46.00s",
    "Quint phase timing: sampled-run 23 command(s), 23.00s",
    "Quint phase timing: verify 21 command(s), 21.00s",
    "Complete Quint model gate: 105.00s (budget 750s)"
  ].join("\n")

const profile = (jobId: number): SuppliedQualificationProfile => ({
  sourceSha,
  nodeVersion: "24.20.0",
  job: { workflow: "Candidate qualification", runId: 1, jobId },
  log: formalLog(),
  setupInstallSeconds: 10,
  completeJobSeconds: 115,
  negativeControls: quintGateCommandManifest
    .filter(({ name }) => name.includes("negative mutation profile") || name.includes("temporal mutant"))
    .map(({ name }) => name)
})

it.effect("Alice's byte digest matches the independent SHA256 known answer", () =>
  Effect.gen(function* () {
    expect(yield* qualificationDigest(new TextEncoder().encode("abc"))).toBe(abcDigest)
  }).pipe(Effect.provide(NodeCrypto.layer))
)

it.effect("local hermetic evidence does not fabricate hosted formal profiles", () =>
  Effect.gen(function* () {
    expect(yield* qualificationFormalProvenance(sourceSha, { _tag: "LocalHermetic" })).toEqual({
      _tag: "NotSupplied",
      reason: "LocalHermeticInvocation"
    })
  })
)

it.effect("same-source supported dedicated and stressed evidence retains every ordered command and setup margin", () =>
  Effect.gen(function* () {
    const result = yield* qualificationFormalProvenance(sourceSha, {
      _tag: "SuppliedProfiles",
      dedicated: profile(2),
      stressed: profile(3)
    })
    expect(result._tag).toBe("DedicatedAndStressed")
    if (result._tag !== "DedicatedAndStressed") return yield* Effect.die("supplied profiles must be present")
    for (const value of [result.dedicated, result.stressed]) {
      expect(value.sourceSha).toBe(sourceSha)
      expect(value.commands).toHaveLength(105)
      expect(value.commands.map(({ kind, name }) => ({ kind, name }))).toEqual(quintGateCommandManifest)
      expect(value.commands.filter(({ kind }) => kind === "typecheck")).toHaveLength(15)
      expect(value.commands.filter(({ kind }) => kind === "test")).toHaveLength(46)
      expect(value.commands.filter(({ kind }) => kind === "sampled-run")).toHaveLength(23)
      expect(value.commands.filter(({ kind }) => kind === "verify")).toHaveLength(21)
      expect(value.negativeControls).toContain(
        "planned-attempt executor temporal mutant releasableEvidenceNeverReleasesPosition (TLC)"
      )
      expect(value.completeJobSeconds).toBe(115)
      expect(value.hostedLimitSeconds).toBe(960)
      expect(value.setupInstallSeconds).toBe(10)
    }
    expect(result.dedicated.job.jobId).not.toBe(result.stressed.job.jobId)
  })
)

it.effect("live qualification provenance requires two independent same-source formal jobs", () =>
  Effect.gen(function* () {
    const result = yield* requiredQualificationFormalProvenance(sourceSha, {
      dedicated: profile(2),
      stressed: profile(3)
    })
    expect(result._tag).toBe("DedicatedAndStressed")
    expect(result.dedicated.sourceSha).toBe(sourceSha)
    expect(result.stressed.sourceSha).toBe(sourceSha)
    expect(result.dedicated.job.jobId).not.toBe(result.stressed.job.jobId)
    expect(
      (yield* requiredQualificationFormalProvenance(sourceSha, { dedicated: profile(2), stressed: profile(2) }).pipe(
        Effect.flip
      )).operation
    ).toBe("ValidateProvenance")
  })
)

it.effect("stale substituted unsupported incomplete or over-budget provenance grants no qualification claim", () =>
  Effect.gen(function* () {
    for (const changed of [
      { ...profile(2), sourceSha: otherSha },
      { ...profile(2), nodeVersion: "22.22.2" },
      { ...profile(2), nodeVersion: "24.15.0" },
      { ...profile(2), completeJobSeconds: 104 },
      { ...profile(2), completeJobSeconds: 961 },
      { ...profile(2), negativeControls: [] },
      {
        ...profile(2),
        log: formalLog().replace(
          "Quint command timing: typecheck planned-attempt executor model typecheck 1.00s result=exit:0\n",
          ""
        )
      }
    ]) {
      const failure = yield* qualificationFormalProvenance(sourceSha, {
        _tag: "SuppliedProfiles",
        dedicated: changed,
        stressed: profile(3)
      }).pipe(Effect.flip)
      expect(failure.operation).toBe("ValidateProvenance")
    }
    expect(
      (yield* qualificationFormalProvenance(sourceSha, {
        _tag: "SuppliedProfiles",
        dedicated: profile(2),
        stressed: profile(2)
      }).pipe(Effect.flip)).operation
    ).toBe("ValidateProvenance")
  })
)

it.effect(
  "Alice receives actual clean Git source and separately measured files rather than fixture H or raw configuration",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const git = yield* GitCommand
        const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-qualification-build-" })
        const repository = GitRepositoryLocator.make(`${root}/source`)
        yield* fs.makeDirectory(repository)
        const run = (args: ReadonlyArray<string>) =>
          git
            .runInWorktree(repository, args)
            .pipe(Effect.tap((result) => Effect.sync(() => expect(result.exitCode).toBe(0))))
        yield* run(["init", "--initial-branch=master"])
        yield* run(["config", "user.name", "Qualification Test"])
        yield* run(["config", "user.email", "qualification@example.invalid"])
        yield* fs.writeFileString(`${repository}/source.txt`, "source")
        yield* run(["add", "source.txt"])
        yield* run(["commit", "-m", "source"])
        const head = (yield* run(["rev-parse", "HEAD"])).stdout.trim()
        const files = { builtEntry: `${root}/entry.js`, lockfile: `${root}/lock.yaml`, configuration: `${root}/Q.json` }
        for (const path of Object.values(files)) yield* fs.writeFileString(path, "abc")
        const measured = yield* measureQualificationBuild(repository, sourceSha, files)
        expect(measured.sourceSha).toBe(head)
        expect(measured.sourceBaseSha).toBe(sourceSha)
        expect(measured.sourceSha).not.toBe(sourceSha)
        expect(measured.builtEntryDigest).toBe(abcDigest)
        expect(measured.lockfileDigest).toBe(abcDigest)
        expect(measured.configurationDigest).toBe(abcDigest)
        expect(measured.nodeVersion).toMatch(/^24\.20\.\d+$/u)
        expect(measured.pnpmVersion).toMatch(/^\d+\.\d+\.\d+$/u)
        expect(JSON.stringify(measured)).not.toContain(JSON.stringify("abc"))
        yield* fs.writeFileString(`${repository}/source.txt`, "modified")
        expect((yield* measureQualificationBuild(repository, sourceSha, files).pipe(Effect.flip)).operation).toBe(
          "MeasureBuild"
        )
      })
    ).pipe(Effect.provide(fixtureLayer))
)

it.effect("artifact writing stays outside Q and failure never claims or repeats publication", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-qualification-output-" })
      const container = HermeticFixtureContainer.make(`${root}/Q`)
      yield* fs.makeDirectory(container)
      const inside = QualificationArtifactLocator.make(`${container}/evidence.json`)
      expect((yield* writeQualificationArtifact(container, inside, "{}").pipe(Effect.flip)).operation).toBe(
        "ArtifactLocation"
      )
      expect(yield* fs.exists(inside)).toBe(false)
      const outside = QualificationArtifactLocator.make(`${root}/evidence.json`)
      expect((yield* writeQualificationArtifact(container, outside, '{"schemaVersion":1}'))._tag).toBe(
        "ArtifactPublished"
      )
      expect(yield* fs.readFileString(outside)).toBe('{"schemaVersion":1}\n')
      const second = yield* writeQualificationArtifact(container, outside, "replacement").pipe(Effect.flip)
      expect(second.operation).toBe("WriteArtifact")
      expect(yield* fs.readFileString(outside)).toBe('{"schemaVersion":1}\n')
      const unwritable = QualificationArtifactLocator.make(`${root}/missing/evidence.json`)
      expect((yield* writeQualificationArtifact(container, unwritable, "{}").pipe(Effect.flip)).operation).toBe(
        "WriteArtifact"
      )
      expect(yield* fs.exists(unwritable)).toBe(false)
    })
  ).pipe(Effect.provide(NodeServices.layer))
)
