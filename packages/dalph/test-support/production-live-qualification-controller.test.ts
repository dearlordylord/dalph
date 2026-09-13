/* eslint-disable import/no-nodejs-modules -- The focused test compares the exact Node executable. */
import nodeProcess from "node:process"
import { GitCommitSha, RunId } from "@dalph/contracts"
import { GithubIssueNumber, GithubIssueTarget, GithubRepositoryName, GithubRepositoryOwner } from "@dalph/orchestrator"
import { Effect, MutableList, Redacted, Schema, Stream } from "effect"
import { describe, expect, it } from "vitest"
import {
  encodeProductionCliRecord,
  ProductionConfigurationLocator,
  type ProductionCliRecord
} from "../src/application/production-cli.js"
import {
  ProductionLiveBuiltEntry,
  ProductionLiveChildExecutable,
  ProductionLiveCodexHome,
  ProductionLiveQualificationBoundaryFailure,
  ProductionLiveQualificationProcessId,
  runProductionLiveQualification,
  type ProductionLiveQualificationBoundary,
  type ProductionLiveQualificationFinalFacts
} from "../src/qualification/live-qualification-controller.js"

const builtEntry = ProductionLiveBuiltEntry.make("/workspace/dalph/packages/dalph/dist/bin/dalph.js")
const configuration = ProductionConfigurationLocator.make("/tmp/dalph-live-q/production.json")
const invocation = {
  builtEntry,
  codexHome: ProductionLiveCodexHome.make("/tmp/dalph-live-q/codex"),
  configuration,
  target: GithubIssueTarget.make({
    owner: GithubRepositoryOwner.make("fixture-owner"),
    repository: GithubRepositoryName.make("fixture-repository"),
    issueNumber: GithubIssueNumber.make(41)
  }),
  githubToken: Redacted.make("github-secret"),
  codexProviderCredential: Redacted.make("codex-secret")
}

const selected: ProductionCliRecord = {
  _tag: "RunSelected",
  runId: RunId.make("run-live-q"),
  selection: "Allocated",
  version: 1
}
const disposition: ProductionCliRecord = {
  _tag: "RunDisposition",
  runId: RunId.make("run-live-q"),
  disposition: "Completed",
  version: 1
}
const encoded = (...records: ReadonlyArray<ProductionCliRecord>) =>
  new TextEncoder().encode(records.map(encodeProductionCliRecord).join("\n") + "\n")

const facts: ProductionLiveQualificationFinalFacts = {
  applicationServerCount: 1,
  integrationTargetCount: 1,
  taskWorktreeCount: 1,
  journal: [],
  github: { lifecycle: "Completed", claims: [] },
  targetHead: GitCommitSha.make("2222222222222222222222222222222222222222")
}

const boundary = (spawn: ProductionLiveQualificationBoundary["spawn"]): ProductionLiveQualificationBoundary => ({
  spawn
})

describe("#307 production live qualification controller", () => {
  it("starts the shipped production command once with the exact public argument vector", async () => {
    const requests = MutableList.make<Parameters<ProductionLiveQualificationBoundary["spawn"]>[0]>()
    const published = MutableList.make<unknown>()
    const result = await Effect.runPromise(
      runProductionLiveQualification(
        invocation,
        boundary((request) => {
          MutableList.append(requests, request)
          return Effect.succeed({
            pid: ProductionLiveQualificationProcessId.make(701),
            stdout: Stream.make(encoded(selected, disposition)),
            stderr: Stream.empty,
            exitCode: Effect.succeed(0)
          })
        }),
        {
          validateRecord: () => Effect.void,
          gatherFinalFacts: () => Effect.succeed(facts),
          publish: (input) => Effect.sync(() => MutableList.append(published, input)),
          retainAfterFailure: () => Effect.void
        }
      )
    )

    expect(result).toMatchObject({ _tag: "Completed", processId: 701, runId: "run-live-q", spawnCount: 1 })
    expect(MutableList.toArray(requests)).toEqual([
      {
        executable: nodeProcess.execPath,
        arguments: [
          builtEntry,
          "run",
          "github:fixture-owner/fixture-repository#41",
          "--production",
          "--config",
          configuration
        ],
        environment: {
          CODEX_HOME: "/tmp/dalph-live-q/codex",
          GITHUB_TOKEN: "github-secret",
          DALPH_CODEX_PROVIDER_CREDENTIAL: "codex-secret",
          GIT_OPTIONAL_LOCKS: "0"
        }
      }
    ])
    expect(MutableList.toArray(published)).toHaveLength(1)
  })

  it("does not start a second workflow when final observation or publication fails", async () => {
    for (const failedStage of ["GatherFinalFacts", "Publish"] as const) {
      let spawns = 0
      let retained = 0
      const result = await Effect.runPromise(
        runProductionLiveQualification(
          invocation,
          boundary(() => {
            spawns += 1
            return Effect.succeed({
              pid: ProductionLiveQualificationProcessId.make(702),
              stdout: Stream.make(encoded(selected, disposition)),
              stderr: Stream.empty,
              exitCode: Effect.succeed(0)
            })
          }),
          {
            validateRecord: () => Effect.void,
            gatherFinalFacts: () =>
              failedStage === "GatherFinalFacts" ? Effect.fail("unreadable final authority") : Effect.succeed(facts),
            publish: () => (failedStage === "Publish" ? Effect.fail("artifact unavailable") : Effect.void),
            retainAfterFailure: () =>
              Effect.sync(() => {
                retained += 1
              })
          }
        )
      )

      expect(result).toMatchObject({ _tag: "Failed", stage: failedStage, spawnCount: 1 })
      expect(spawns).toBe(1)
      expect(retained).toBe(1)
    }
  })

  it("rejects unsafe canonical records without returning secret bytes and retains after one child", async () => {
    const secret = "qualification-secret-sentinel"
    let spawns = 0
    const result = await Effect.runPromise(
      runProductionLiveQualification(
        invocation,
        boundary(() => {
          spawns += 1
          return Effect.succeed({
            pid: ProductionLiveQualificationProcessId.make(703),
            stdout: Stream.make(
              encoded(selected, {
                _tag: "Failure",
                code: "configuration.invalid",
                detail: secret,
                subject: "production configuration file",
                version: 1
              })
            ),
            stderr: Stream.empty,
            exitCode: Effect.succeed(1)
          })
        }),
        {
          validateRecord: (record) =>
            JSON.stringify(record).includes(secret) ? Effect.fail("unsafe public source") : Effect.void,
          gatherFinalFacts: () => Effect.succeed(facts),
          publish: () => Effect.void,
          retainAfterFailure: () => Effect.void
        }
      )
    )

    expect(result).toMatchObject({ _tag: "Failed", stage: "ReadOutput", spawnCount: 1 })
    expect(JSON.stringify(result)).not.toContain(secret)
    expect(spawns).toBe(1)
  })

  it("fails closed unless observations prove one app server one task worktree and one integration target", async () => {
    for (const field of ["applicationServerCount", "taskWorktreeCount", "integrationTargetCount"] as const) {
      let spawns = 0
      const result = await Effect.runPromise(
        runProductionLiveQualification(
          invocation,
          boundary(() => {
            spawns += 1
            return Effect.succeed({
              pid: ProductionLiveQualificationProcessId.make(704),
              stdout: Stream.make(encoded(selected, disposition)),
              stderr: Stream.empty,
              exitCode: Effect.succeed(0)
            })
          }),
          {
            validateRecord: () => Effect.void,
            gatherFinalFacts: () => Effect.succeed({ ...facts, [field]: 2 }),
            publish: () => Effect.void,
            retainAfterFailure: () => Effect.void
          }
        )
      )
      expect(result).toMatchObject({ _tag: "Failed", stage: "ValidateComposition", spawnCount: 1 })
      expect(spawns).toBe(1)
    }
  })

  it("rejects malformed child locators and process identities before invocation", () => {
    expect(Schema.is(ProductionLiveBuiltEntry)("dist/bin/dalph.js")).toBe(false)
    expect(Schema.is(ProductionLiveBuiltEntry)("/workspace/dalph/../other/dalph.js")).toBe(false)
    expect(Schema.is(ProductionLiveCodexHome)("relative/codex-home")).toBe(false)
    expect(Schema.is(ProductionLiveChildExecutable)("node")).toBe(false)
    expect(Schema.is(ProductionLiveQualificationProcessId)(0)).toBe(false)
    expect(Schema.is(ProductionLiveQualificationProcessId)(1.5)).toBe(false)
  })

  it("maps a typed spawn-boundary failure to the exact safe stage", async () => {
    const result = await Effect.runPromise(
      runProductionLiveQualification(
        invocation,
        boundary(() =>
          Effect.fail(new ProductionLiveQualificationBoundaryFailure({ operation: "Spawn", reason: "Unavailable" }))
        ),
        {
          validateRecord: () => Effect.void,
          gatherFinalFacts: () => Effect.succeed(facts),
          publish: () => Effect.void,
          retainAfterFailure: () => Effect.void
        }
      )
    )

    expect(result).toEqual({ _tag: "Failed", stage: "Spawn", spawnCount: 1 })
  })

  it("maps typed child observation failures to their exact safe stages", async () => {
    for (const expected of [
      { operation: "ReadStdout" as const, stage: "ReadOutput" as const },
      { operation: "ReadStderr" as const, stage: "ReadOutput" as const },
      { operation: "WaitForExit" as const, stage: "Process" as const }
    ]) {
      const failure = new ProductionLiveQualificationBoundaryFailure({
        operation: expected.operation,
        reason: "Unavailable"
      })
      const result = await Effect.runPromise(
        runProductionLiveQualification(
          invocation,
          boundary(() =>
            Effect.succeed({
              pid: ProductionLiveQualificationProcessId.make(705),
              stdout:
                expected.operation === "ReadStdout"
                  ? Stream.fail(failure)
                  : Stream.make(encoded(selected, disposition)),
              stderr: expected.operation === "ReadStderr" ? Stream.fail(failure) : Stream.empty,
              exitCode: expected.operation === "WaitForExit" ? Effect.fail(failure) : Effect.succeed(0)
            })
          ),
          {
            validateRecord: () => Effect.void,
            gatherFinalFacts: () => Effect.succeed(facts),
            publish: () => Effect.void,
            retainAfterFailure: () => Effect.void
          }
        )
      )

      expect(result).toMatchObject({ _tag: "Failed", stage: expected.stage, processId: 705, spawnCount: 1 })
    }
  })
})
