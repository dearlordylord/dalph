import { Effect, FileSystem, Layer, Redacted } from "effect"
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { nodeGitCommandLayer } from "@dalph/orchestrator"
import { describe, expect, it } from "vitest"
import {
  createProductionLiveLocalFixture,
  decodeProductionLiveQualificationManifest,
  productionLiveQualificationChronologyIsExact
} from "./production-live-qualification-runtime.js"

const layer = nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer), Layer.merge(NodeCrypto.layer))

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
    job: "live-qualification",
    protectedEnvironment: "live-qualification"
  },
  formal: {
    _tag: "DedicatedAndStressed",
    dedicated: {
      sourceSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nodeVersion: "24.20.0",
      job: { workflow: "CI", runId: 1, jobId: 1 },
      logDigest: "0".repeat(64),
      setupInstallSeconds: 1,
      formalSeconds: 1,
      completeJobSeconds: 2,
      remainingHostedSeconds: 958,
      hostedLimitSeconds: 960,
      commands: [],
      negativeControls: ["negative"]
    },
    stressed: {
      sourceSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      nodeVersion: "24.20.0",
      job: { workflow: "CI", runId: 1, jobId: 2 },
      logDigest: "1".repeat(64),
      setupInstallSeconds: 1,
      formalSeconds: 1,
      completeJobSeconds: 2,
      remainingHostedSeconds: 958,
      hostedLimitSeconds: 960,
      commands: [],
      negativeControls: ["negative"]
    }
  }
}

describe("#307 production live qualification runtime", () => {
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

  it("creates one local repository H, one configuration, and one isolated Codex home", async () => {
    await Effect.runPromise(
      Effect.gen(function* () {
        const fixture = yield* createProductionLiveLocalFixture(
          yield* decodeProductionLiveQualificationManifest(input),
          { owner: "dalph-live", repository: "qualification", issueNumber: 307 },
          "http://127.0.0.1:4307/v1",
          "http://127.0.0.1:4308/graphql",
          Redacted.make("github-secret"),
          Redacted.make("provider-secret")
        )
        const fs = yield* FileSystem.FileSystem
        expect(fixture.configuration.plannedAttemptBaseSha).toBe(fixture.initialTargetCommit)
        expect(fixture.localManifest.resources).toHaveLength(10)
        expect(yield* fs.readFileString(`${fixture.configuration.codexStateDirectory}/config.toml`)).toContain(
          'base_url = "http://127.0.0.1:4307/v1"'
        )
        const document = yield* fs.readFileString(fixture.configurationPath)
        expect(document).not.toContain("github-secret")
        expect(document).not.toContain("provider-secret")
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
          Redacted.make("provider-secret"),
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
})
