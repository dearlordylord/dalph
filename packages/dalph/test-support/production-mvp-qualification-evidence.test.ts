import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { GitCommitSha, GitRepositoryLocator } from "@dalph/contracts"
import { GitCommand, nodeGitCommandLayer } from "@dalph/orchestrator"
import { Effect, FileSystem, Layer, Schema } from "effect"
import { expect } from "vitest"
import { quintGateCommandManifest } from "../../../scripts/quint-gate-command-manifest.mjs"
import { createQuintEffectiveProfile } from "../../../scripts/quint-effective-profile.mjs"
import { assertCompleteQuintHostedPartition, quintHostedProfileDigest } from "../../../scripts/quint-hosted-shards.mjs"
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
      codexExecutorPrivateStateDirectory: `${container}/codex-executor-private`,
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

const capturedOutput = (command: ReturnType<typeof createQuintEffectiveProfile>["commands"][number]) => {
  const lines = command.verdict.witnesses.map(
    (witness) => `${witness} was witnessed in 1 trace(s) out of 1 explored (100.00%)`
  )
  if (command.verdict.collectedReplacementTest) {
    lines.push("ok safeSuspensionAndExactFreshFactsAtomicallyRecordCleanP2Test passed 1 test(s)")
  }
  if (command.verdict.temporal === "clean") lines.push("[ok] No violation found")
  if (command.verdict.temporal === "violation") lines.push("[violation] Found an issue")
  return `${lines.join("\n")}\n`
}

const shardReports = (custodyOffset: number) => {
  const effective = createQuintEffectiveProfile()
  const binding = { runId: "1", runAttempt: "1", commitSha: sourceSha, nodeVersion: "24.20.0" }
  return assertCompleteQuintHostedPartition(effective).map((shard) => {
    const commands = shard.positions.map((position) => {
      const command = effective.commands[position]
      if (command === undefined) return expect.fail(`missing formal command ${position}`)
      return {
        position,
        name: command.name,
        kind: command.kind,
        executable: "/opt/node/bin/node",
        obligationId: `00000000-0000-4000-8000-${String(custodyOffset * 1_000 + position + 1).padStart(12, "0")}`,
        args: command.args,
        exitCode: command.verdict.acceptedExitCodes[0],
        output: capturedOutput(command),
        verdict: command.verdict
      }
    })
    return {
      version: 1,
      binding,
      profileDigest: quintHostedProfileDigest(effective),
      shard: shard.shard,
      shardCount: shard.shardCount,
      report: {
        version: 1,
        entryPoint: "/workspace/node_modules/@informalsystems/quint/dist/src/cli.js",
        profile: effective,
        shard,
        serverEndpoint: null,
        commands,
        timing: {
          records: commands.map(({ exitCode, kind, name }) => ({
            kind,
            name,
            durationMilliseconds: 1000,
            result: `exit:${exitCode}`
          })),
          aggregates: Object.fromEntries(
            ["typecheck", "test", "sampled-run", "verify"].map((kind) => [
              kind,
              {
                count: commands.filter((command) => command.kind === kind).length,
                durationMilliseconds: commands.filter((command) => command.kind === kind).length * 1000
              }
            ])
          )
        },
        provenance: {
          architecture: "arm64",
          bytes: 1,
          evaluatorPath: "/home/runner/evaluator",
          evaluatorVersion: "v0.6.0",
          platform: "linux",
          quintPackageVersion: "0.32.0",
          sha256: "a".repeat(64)
        },
        elapsedMilliseconds: shard.shard === 0 ? 105_000 : 104_000
      }
    }
  })
}

const profile = (profileKind: "dedicated" | "stressed", jobId: number): SuppliedQualificationProfile => ({
  profileKind,
  sourceSha,
  nodeVersion: "24.20.0",
  runId: 1,
  runAttempt: 1,
  shards: shardReports(jobId).map((report, shard) => ({
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
      runId: 1,
      runAttempt: 1,
      jobId: jobId + shard,
      name: `${profileKind === "dedicated" ? "Dedicated" : "Stressed"} formal evidence shard ${shard}`
    },
    reportSource: `${JSON.stringify(report)}\n`,
    setupInstallSeconds: 10,
    formalSeconds: shard === 0 ? 105 : 104,
    completeJobSeconds: 115,
    startedAt: shard === 0 ? "2026-09-13T12:00:00.000Z" : "2026-09-13T12:00:01.000Z",
    completedAt: shard === 0 ? "2026-09-13T12:01:55.000Z" : "2026-09-13T12:01:56.000Z"
  }))
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
      dedicated: profile("dedicated", 2),
      stressed: profile("stressed", 4)
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
      expect(value.formalSeconds).toBe(105)
      expect(value.completeProfileSeconds).toBe(116)
      expect(value.shards.map(({ shard }) => shard)).toEqual([0, 1])
      expect(value.shards.map(({ hostedLimitSeconds }) => hostedLimitSeconds)).toEqual([960, 960])
      expect(value.shards.every(({ setupInstallSeconds }) => setupInstallSeconds === 10)).toBe(true)
    }
    expect(
      new Set([result.dedicated, result.stressed].flatMap(({ shards }) => shards.map(({ job }) => job.jobId))).size
    ).toBe(4)
    expect(result.dedicated.profileKind).toBe("dedicated")
    expect(result.dedicated.shards.every(({ condition }) => condition.kind === "dedicated-hosted-job")).toBe(true)
    expect(result.stressed.profileKind).toBe("stressed")
    expect(result.stressed.shards[0].condition).toEqual({
      kind: "cpu-affinity",
      runnerLabel: "ubuntu-latest",
      cpuList: "0-1",
      hostParallelism: 4,
      effectiveParallelism: 2
    })
  })
)

it.effect("live qualification provenance requires four independent same-source formal shard jobs", () =>
  Effect.gen(function* () {
    const result = yield* requiredQualificationFormalProvenance(sourceSha, {
      dedicated: profile("dedicated", 2),
      stressed: profile("stressed", 4)
    })
    expect(result._tag).toBe("DedicatedAndStressed")
    expect(result.dedicated.sourceSha).toBe(sourceSha)
    expect(result.stressed.sourceSha).toBe(sourceSha)
    expect(
      new Set([result.dedicated, result.stressed].flatMap(({ shards }) => shards.map(({ job }) => job.jobId))).size
    ).toBe(4)
    expect(
      (yield* requiredQualificationFormalProvenance(sourceSha, {
        dedicated: profile("dedicated", 2),
        stressed: profile("stressed", 3)
      }).pipe(Effect.flip)).operation
    ).toBe("ValidateProvenance")
    expect(
      (yield* requiredQualificationFormalProvenance(sourceSha, {
        dedicated: profile("dedicated", 2),
        stressed: { ...profile("stressed", 4), runId: 2 }
      }).pipe(Effect.flip)).operation
    ).toBe("ValidateProvenance")
  })
)

it.effect("stale substituted unsupported incomplete or over-budget provenance grants no qualification claim", () =>
  Effect.gen(function* () {
    for (const changed of [
      { ...profile("dedicated", 2), sourceSha: otherSha },
      { ...profile("dedicated", 2), nodeVersion: "22.22.2" },
      { ...profile("dedicated", 2), nodeVersion: "24.15.0" },
      { ...profile("dedicated", 2), shards: profile("dedicated", 2).shards.slice(0, 1) },
      {
        ...profile("dedicated", 2),
        shards: profile("dedicated", 2).shards.map((shard) => ({ ...shard, completeJobSeconds: 960 }))
      },
      { ...profile("dedicated", 2), profileKind: "stressed" as const },
      {
        ...profile("dedicated", 2),
        shards: profile("dedicated", 2).shards.map((shard, index) =>
          index === 0 ? { ...shard, reportSource: "{}" } : shard
        )
      }
    ]) {
      const failure = yield* qualificationFormalProvenance(sourceSha, {
        _tag: "SuppliedProfiles",
        dedicated: changed,
        stressed: profile("stressed", 4)
      }).pipe(Effect.flip)
      expect(failure.operation).toBe("ValidateProvenance")
    }
    expect(
      (yield* qualificationFormalProvenance(sourceSha, {
        _tag: "SuppliedProfiles",
        dedicated: profile("dedicated", 2),
        stressed: profile("stressed", 3)
      }).pipe(Effect.flip)).operation
    ).toBe("ValidateProvenance")
    expect(
      (yield* qualificationFormalProvenance(sourceSha, {
        _tag: "SuppliedProfiles",
        dedicated: profile("dedicated", 2),
        stressed: {
          ...profile("stressed", 4),
          shards: profile("stressed", 4).shards.map((shard) => ({
            ...shard,
            condition: profile("dedicated", 2).shards[0]?.condition ?? shard.condition
          }))
        }
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
