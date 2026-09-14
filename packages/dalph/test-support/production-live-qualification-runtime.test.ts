import { Effect, FileSystem, Layer, Redacted } from "effect"
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { nodeGitCommandLayer } from "@dalph/orchestrator"
import { describe, expect, it } from "vitest"
import {
  createProductionLiveLocalFixture,
  decodeProductionLiveQualificationManifest,
  generateProductionLiveControlledProviderCredential,
  productionLiveQualificationBoundaryObservations,
  productionLiveQualificationChronologyIsExact,
  productionLiveQualificationOperationCounts,
  writeProductionLiveQualificationFailureRetentionReport
} from "../src/qualification/live-qualification-runtime.js"

const layer = nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer), Layer.merge(NodeCrypto.layer))
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

describe("#307 production live qualification runtime", () => {
  it("production qualification controller generates and redacts one fresh controlled-provider credential per invocation", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const first = yield* generateProductionLiveControlledProviderCredential
        const second = yield* generateProductionLiveControlledProviderCredential
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
      controllerFinal: ["GitReadTargetHead", "TaskTrackerReadGraph", "TaskTrackerReadClaim"],
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
        { tag: "ControllerFinal.TaskTrackerReadGraph", count: 1 },
        { tag: "ControllerFinal.TaskTrackerReadClaim", count: 1 }
      ])
    )
  })

  it("production live qualification fixture separates Codex home from executor private state", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fixture = yield* createProductionLiveLocalFixture(
          yield* decodeProductionLiveQualificationManifest(input),
          { owner: "dalph-live", repository: "qualification", issueNumber: 307 },
          "http://127.0.0.1:4307/v1",
          "http://127.0.0.1:4308/graphql",
          Redacted.make("github-secret")
        )
        const fs = yield* FileSystem.FileSystem
        expect(fixture.configuration.plannedAttemptBaseSha).toBe(fixture.initialTargetCommit)
        expect(fixture.localManifest.resources).toHaveLength(11)
        expect(fixture.codexHome).not.toBe(fixture.configuration.codexExecutorPrivateStateDirectory)
        const config = yield* fs.readFileString(`${fixture.codexHome}/config.toml`)
        expect(config).toContain('base_url = "http://127.0.0.1:4307/v1"')
        expect(config).toContain('env_key = "DALPH_LIVE_CONTROLLED_PROVIDER_CREDENTIAL"')
        expect(config).not.toContain("DALPH_CODEX_PROVIDER_CREDENTIAL")
        expect(fixture.configuration.codexExecutable).not.toBe(input.codexExecutable)
        expect(yield* fs.readFileString(fixture.configuration.codexExecutable)).toContain(
          `exec '${input.codexExecutable}' "$@"`
        )
        expect(yield* fs.readFileString(fixture.configuration.codexExecutable)).toContain('test "${1-}" = "app-server"')
        expect(yield* fs.readFileString(fixture.applicationServerObservationPath)).toBe("")
        const document = yield* fs.readFileString(fixture.configurationPath)
        expect(document).not.toContain("github-secret")
        yield* fs.remove(fixture.localManifest.container.locator, { recursive: true })
      }).pipe(Effect.provide(layer))
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
          "http://127.0.0.1:4307/v1",
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

  it("an unfinished recoverable Run retains every exact local locator for manual cleanup", async () => {
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
            "http://127.0.0.1:4307/v1",
            "http://127.0.0.1:4308/graphql",
            Redacted.make("github-secret")
          )
          yield* writeProductionLiveQualificationFailureRetentionReport(
            manifest,
            "Execution",
            undefined,
            undefined,
            fixture,
            undefined,
            {}
          )
          const report = JSON.parse(yield* fs.readFileString(manifest.retentionReport)) as {
            readonly local: ReadonlyArray<{ readonly locator: string; readonly disposition: string }>
          }
          expect(report.local).toHaveLength(fixture.localManifest.resources.length + 1)
          expect(report.local.every(({ disposition }) => disposition === "Retained")).toBe(true)
          expect(report.local.map(({ locator }) => locator)).toContain(fixture.localManifest.container.locator)
          expect(yield* fs.exists(fixture.configuration.repository)).toBe(true)
          yield* fs.remove(fixture.localManifest.container.locator, { recursive: true })
        })
      ).pipe(Effect.provide(layer))
    )
  })
})
