import { GitCommitSha, RunId, TaskExecutorLocator, TaskId, makeTaskWorkSpecification } from "@dalph/contracts"
import {
  PlannedTaskAttemptOrdinal,
  PlannedTaskAttemptPlanRequest,
  PlannedTaskAttemptPlanner
} from "@dalph/orchestrator"
import { Effect, Redacted, Ref } from "effect"
import { describe, expect, it } from "vitest"
import {
  ProductionPlannedAttemptWorktreeRoot,
  decodeProductionRepositoryHostConfiguration,
  deriveProductionPlannedAttemptLocations,
  productionExecutorLocator,
  productionKimiExecutorPrivateStateDirectory,
  productionPlannedTaskAttemptLayer,
  withProductionRepositoryHostConfiguration
} from "./production-configuration.js"

const credentialNeedle = "credential-value-that-must-never-appear"

const validRawConfiguration = () => ({
  target: { _tag: "GithubIssue", issueNumber: 292, owner: "dearlordylord", repository: "dalph" },
  repository: "/srv/dalph/repository.git",
  commonDirectory: "/srv/dalph/repository.git",
  integrationRef: "refs/heads/master",
  remotePublicationTarget: { branch: "refs/heads/master", endpoint: "ssh://git@example.invalid/dalph.git" },
  plannedAttemptBaseSha: "a".repeat(40),
  plannedAttemptExecutor: "codex:production",
  claimOwner: "dalph:production",
  taskWorkCapacity: 2,
  journalDatabase: "/var/lib/dalph/journal.sqlite",
  evidenceStoreRoot: "/var/lib/dalph/evidence",
  plannedAttemptWorktreeRoot: "/srv/dalph/planned-attempts",
  codexExecutorPrivateStateDirectory: "/var/lib/dalph/executor-private",
  integratorCandidateWorktreeRoot: "/srv/dalph/integrator-candidates",
  integratorPrivateStore: "/var/lib/dalph/integrator-private.json",
  activationInterval: "1 minute",
  failureCooldown: "5 seconds",
  codexExecutable: "/usr/local/bin/codex",
  codexClientName: "dalph",
  codexClientVersion: "0.0.0",
  githubToken: credentialNeedle
})

describe("production repository host configuration", () => {
  it("rejects a host with no pinned remote publication target", async () => {
    const { remotePublicationTarget: _omitted, ...input } = validRawConfiguration()
    const result = await Effect.runPromiseExit(decodeProductionRepositoryHostConfiguration(input))
    expect(result._tag).toBe("Failure")
  })

  it("production configuration accepts ambient Codex CLI authentication without a provider credential", async () => {
    const decoded = await Effect.runPromise(decodeProductionRepositoryHostConfiguration(validRawConfiguration()))
    expect(decoded.target.issueNumber).toBe(292)
    expect(decoded.taskWorkCapacity).toBe(2)
    expect(decoded.integrationRef).toBe("refs/heads/master")
    expect(decoded.githubGraphqlEndpoint).toBe("https://api.github.com/graphql")
    expect(Redacted.value(decoded.githubToken)).toBe(credentialNeedle)
    expect(JSON.stringify(decoded.githubToken)).toBe('"<redacted:GitHubToken>"')
    expect(decoded.codexExecutorPrivateStateDirectory).toBe("/var/lib/dalph/executor-private")
    expect("codexProvider" in decoded).toBe(false)
    expect("codexProviderCredential" in decoded).toBe(false)
    expect("mode" in decoded).toBe(false)
    expect("recovered" in decoded).toBe(false)
    expect("applicationExitDrain" in decoded).toBe(false)
  })

  it("decodes configured executor profiles and a host default", async () => {
    const decoded = await Effect.runPromise(
      decodeProductionRepositoryHostConfiguration({
        ...validRawConfiguration(),
        plannedAttemptExecutor: "executor:default",
        executorProfileDefault: "kimi/for-coding",
        executorProfiles: [
          {
            adapter: "kimi-acp",
            executable: "kimi",
            id: "kimi/for-coding",
            model: "kimi-code/kimi-for-coding",
            permissionPolicy: "deny",
            provider: "kimi",
            providerConfigRef: "kimi-for-coding"
          }
        ]
      })
    )
    expect(decoded.plannedAttemptExecutor).toBe("executor:default")
    expect(decoded.executorProfileDefault).toBe("kimi/for-coding")
    expect(decoded.executorProfiles?.[0]?.adapter).toBe("kimi-acp")
    expect(productionExecutorLocator(decoded)).toBe("executor:kimi/for-coding")
  })

  it("keeps an explicitly selected executor locator", async () => {
    const decoded = await Effect.runPromise(decodeProductionRepositoryHostConfiguration(validRawConfiguration()))
    expect(productionExecutorLocator(decoded)).toBe("codex:production")
  })

  it("production keeps Codex CLI state separate from Dalph executor private state", async () => {
    const decoded = await Effect.runPromise(decodeProductionRepositoryHostConfiguration(validRawConfiguration()))
    expect(decoded.codexExecutorPrivateStateDirectory).toBe("/var/lib/dalph/executor-private")
    expect("codexStateDirectory" in decoded).toBe(false)
    expect("codexHome" in decoded).toBe(false)
  })

  it("derives a disjoint Kimi executor state directory when none is configured", async () => {
    const decoded = await Effect.runPromise(decodeProductionRepositoryHostConfiguration(validRawConfiguration()))
    expect(productionKimiExecutorPrivateStateDirectory(decoded)).toBe("/var/lib/dalph/executor-private-kimi")
  })

  it("preserves an explicit Kimi executor state directory", async () => {
    const decoded = await Effect.runPromise(
      decodeProductionRepositoryHostConfiguration({
        ...validRawConfiguration(),
        kimiExecutorPrivateStateDirectory: "/var/lib/dalph/kimi-private"
      })
    )
    expect(productionKimiExecutorPrivateStateDirectory(decoded)).toBe("/var/lib/dalph/kimi-private")
  })

  it.each([
    ["a separator", "dalph|production"],
    ["an owner over the GitHub budget", "x".repeat(25)]
  ] as const)("rejects claimOwner with %s during configuration admission", async (_reason, claimOwner) => {
    const effects = await Effect.runPromise(Ref.make<ReadonlyArray<string>>([]))
    const result = await Effect.runPromise(
      withProductionRepositoryHostConfiguration({ ...validRawConfiguration(), claimOwner }, () =>
        Effect.gen(function* () {
          yield* Ref.update(effects, (current) => [...current, "Run allocation"])
          yield* Ref.update(effects, (current) => [...current, "Journal intent"])
          yield* Ref.update(effects, (current) => [...current, "tracker mutation"])
          yield* Ref.update(effects, (current) => [...current, "executor work"])
        })
      ).pipe(Effect.flip)
    )

    expect(result._tag).toBe("ProductionRepositoryHostConfigurationError")
    expect(result.field).toBe("claimOwner")
    expect(result.detail).toContain("claimOwner")
    expect(result.detail).toContain("24")
    expect(result.detail).toContain("100-character")
    expect(result.detail).not.toContain(credentialNeedle)
    expect(await Effect.runPromise(Ref.get(effects))).toEqual([])
  })

  it.each([
    ["missing credential", {}],
    ["undefined credential", { githubToken: undefined }],
    ["malformed capacity", { taskWorkCapacity: 0 }],
    ["invalid integration ref", { integrationRef: "main" }],
    ["relative planned root", { plannedAttemptWorktreeRoot: "relative/planned" }],
    ["non-canonical repository", { repository: "/srv/dalph/../repository.git" }],
    ["non-canonical candidate root", { integratorCandidateWorktreeRoot: "/srv/dalph/../candidates" }],
    ["non-positive interval", { activationInterval: "0 seconds" }],
    ["edge-whitespace executable", { codexExecutable: " /usr/local/bin/codex" }],
    ["non-HTTP GitHub endpoint", { githubGraphqlEndpoint: "file:///tmp/github" }],
    ["overlapping worktree roots", { integratorCandidateWorktreeRoot: "/srv/dalph/planned-attempts/integrator" }],
    ["worktree and state overlap", { codexExecutorPrivateStateDirectory: "/srv/dalph/planned-attempts/state" }],
    ["private state overlap", { integratorPrivateStore: "/var/lib/dalph/evidence/integrator.json" }]
  ])("rejects %s before any live-boundary continuation", async (name, override) => {
    const opened = await Effect.runPromise(Ref.make(0))
    const input = { ...validRawConfiguration(), ...override }
    if (name === "missing credential") expect(Reflect.deleteProperty(input, "githubToken")).toBe(true)
    const result = await Effect.runPromise(
      withProductionRepositoryHostConfiguration(input, () => Ref.update(opened, (count) => count + 1)).pipe(Effect.flip)
    )
    expect(await Effect.runPromise(Ref.get(opened))).toBe(0)
    expect(result._tag).toBe("ProductionRepositoryHostConfigurationError")
    expect(result.field.length).toBeGreaterThan(0)
    expect(result.subject).toContain("production repository host")
    expect(result.detail.length).toBeGreaterThan(0)
    if (name.includes("overlap")) expect(result.detail).toContain("disjoint")
    expect(String(result)).not.toContain(credentialNeedle)
    expect(JSON.stringify(result)).not.toContain(credentialNeedle)
    expect(JSON.stringify(result)).not.toContain("/usr/local/bin/codex")
  })

  it("accepts one explicit canonical qualification forwarding endpoint", async () => {
    const decoded = await Effect.runPromise(
      decodeProductionRepositoryHostConfiguration({
        ...validRawConfiguration(),
        githubGraphqlEndpoint: "http://127.0.0.1:4307/graphql"
      })
    )
    expect(decoded.githubGraphqlEndpoint).toBe("http://127.0.0.1:4307/graphql")
  })

  it("rejects filesystem-root and trailing-separator parent overlaps before any live-boundary continuation", async () => {
    for (const override of [{ plannedAttemptWorktreeRoot: "/" }, { plannedAttemptWorktreeRoot: "/srv/dalph/" }]) {
      const opened = await Effect.runPromise(Ref.make(0))
      const result = await Effect.runPromise(
        withProductionRepositoryHostConfiguration({ ...validRawConfiguration(), ...override }, () =>
          Ref.update(opened, (count) => count + 1)
        ).pipe(Effect.flip)
      )

      expect(await Effect.runPromise(Ref.get(opened))).toBe(0)
      expect(result).toMatchObject({
        _tag: "ProductionRepositoryHostConfigurationError",
        detail: expect.stringContaining("disjoint")
      })
    }
  })

  it("accepts disjoint paths whose names share only a text prefix", async () => {
    const decoded = await Effect.runPromise(
      decodeProductionRepositoryHostConfiguration({
        ...validRawConfiguration(),
        plannedAttemptWorktreeRoot: "/srv/dalph/work",
        integratorCandidateWorktreeRoot: "/srv/dalph/work-archive"
      })
    )

    expect(decoded.plannedAttemptWorktreeRoot).toBe("/srv/dalph/work")
    expect(decoded.integratorCandidateWorktreeRoot).toBe("/srv/dalph/work-archive")
  })
})

describe("production planned-attempt location codec", () => {
  const root = ProductionPlannedAttemptWorktreeRoot.make("/srv/dalph/planned-attempts")

  it("derives equal locations for equal Run/task/ordinal inputs strictly beneath the root", () => {
    const input = [RunId.make("run/A"), TaskId.make("task A"), PlannedTaskAttemptOrdinal.make(3)] as const
    const first = deriveProductionPlannedAttemptLocations(root, ...input)
    const second = deriveProductionPlannedAttemptLocations(root, ...input)
    expect(second).toEqual(first)
    expect(first.worktree.startsWith(`${root}/`)).toBe(true)
    expect(first.worktree).not.toContain("../")
    expect(first.branch.startsWith("refs/heads/dalph/")).toBe(true)
  })

  it("does not alias distinct Run, task, or task-local ordinal identities", () => {
    const values = [
      deriveProductionPlannedAttemptLocations(
        root,
        RunId.make("run-a"),
        TaskId.make("task-a"),
        PlannedTaskAttemptOrdinal.make(0)
      ),
      deriveProductionPlannedAttemptLocations(
        root,
        RunId.make("run-b"),
        TaskId.make("task-a"),
        PlannedTaskAttemptOrdinal.make(0)
      ),
      deriveProductionPlannedAttemptLocations(
        root,
        RunId.make("run-a"),
        TaskId.make("task-b"),
        PlannedTaskAttemptOrdinal.make(0)
      ),
      deriveProductionPlannedAttemptLocations(
        root,
        RunId.make("run-a"),
        TaskId.make("task-a"),
        PlannedTaskAttemptOrdinal.make(1)
      )
    ]
    expect(new Set(values.map(({ attemptId }) => attemptId))).toHaveLength(values.length)
    expect(new Set(values.map(({ branch }) => branch))).toHaveLength(values.length)
    expect(new Set(values.map(({ worktree }) => worktree))).toHaveLength(values.length)
  })

  it("encodes Git-hostile and tuple-ambiguous identity text into valid distinct resources", () => {
    const first = deriveProductionPlannedAttemptLocations(
      root,
      RunId.make("run/*:?[\\"),
      TaskId.make("task/one-attempt-2"),
      PlannedTaskAttemptOrdinal.make(3)
    )
    const second = deriveProductionPlannedAttemptLocations(
      root,
      RunId.make("run"),
      TaskId.make("*:?[\\/task/one-attempt-2"),
      PlannedTaskAttemptOrdinal.make(3)
    )
    expect(first).not.toEqual(second)
    expect(first.branch).toMatch(/^refs\/heads\/dalph\/(part-[a-z0-9-]+\/)+_leaf$/)
    expect(second.branch).toMatch(/^refs\/heads\/dalph\/(part-[a-z0-9-]+\/)+_leaf$/)
  })

  it("keeps the full UTF-8 AttemptId while bounding long and Unicode resource components", () => {
    const runId = RunId.make(`production/${"r".repeat(230)}/雪😀`)
    const taskId = TaskId.make("github:dearlordylord/dalph/issues/339/*:?[\\")
    const locations = deriveProductionPlannedAttemptLocations(root, runId, taskId, PlannedTaskAttemptOrdinal.make(12))
    const hex = (value: string) =>
      Array.from(new TextEncoder().encode(value), (byte) => byte.toString(16).padStart(2, "0")).join("")
    const runHex = hex(runId)
    const taskHex = hex(taskId)
    const originalResource = `run-${runHex.length}-${runHex}-task-${taskHex.length}-${taskHex}-attempt-12`
    expect(originalResource.length).toBeGreaterThan(528)
    expect(locations.attemptId).toBe(`attempt:${originalResource}`)
    const components = locations.worktree.slice(`${root}/`.length).split("/")
    expect(components.at(-1)).toBe("_leaf")
    expect(
      components
        .slice(0, -1)
        .map((part) => part.slice("part-".length))
        .join("")
    ).toBe(originalResource)
    expect(components.every((part) => new TextEncoder().encode(part).length <= 133)).toBe(true)
    expect(locations.branch).toBe(`refs/heads/dalph/${components.join("/")}`)
    const moved = deriveProductionPlannedAttemptLocations(
      ProductionPlannedAttemptWorktreeRoot.make("/other/planned-attempts"),
      runId,
      taskId,
      PlannedTaskAttemptOrdinal.make(12)
    )
    expect(moved.attemptId).toBe(locations.attemptId)
    expect(moved.branch).toBe(locations.branch)
    expect(moved.worktree).not.toBe(locations.worktree)
  })

  it("keeps ordinal leaves disjoint at chunk boundaries", () => {
    // These lengths put the final ordinal around the 128-character boundary.
    for (const length of [49, 50, 51, 52, 113, 114, 115, 116]) {
      const runId = RunId.make("r".repeat(length))
      const taskId = TaskId.make("task")
      const first = deriveProductionPlannedAttemptLocations(root, runId, taskId, PlannedTaskAttemptOrdinal.make(1))
      const extended = deriveProductionPlannedAttemptLocations(root, runId, taskId, PlannedTaskAttemptOrdinal.make(10))
      expect(extended.attemptId).toBe(`${first.attemptId}0`)
      expect(extended.worktree.startsWith(`${first.worktree}/`)).toBe(false)
      expect(first.worktree.startsWith(`${extended.worktree}/`)).toBe(false)
      expect(extended.branch.startsWith(`${first.branch}/`)).toBe(false)
      expect(first.branch.startsWith(`${extended.branch}/`)).toBe(false)
    }
  })

  it("keeps fresh ordinals task-local and consumes exact replacement Base and ordinal", async () => {
    const configuration = {
      plannedAttemptBaseSha: GitCommitSha.make("a".repeat(40)),
      plannedAttemptExecutor: TaskExecutorLocator.make("codex:production"),
      plannedAttemptWorktreeRoot: root
    }
    const runId = RunId.make("run-planner")
    const taskA = makeTaskWorkSpecification({ body: "A", taskId: TaskId.make("A"), title: "Task A" })
    const taskB = makeTaskWorkSpecification({ body: "B", taskId: TaskId.make("B"), title: "Task B" })
    const replacementBase = GitCommitSha.make("b".repeat(40))
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const planner = yield* PlannedTaskAttemptPlanner
        const a0 = yield* planner.plan(PlannedTaskAttemptPlanRequest.Fresh({ specification: taskA }))
        const b0 = yield* planner.plan(PlannedTaskAttemptPlanRequest.Fresh({ specification: taskB }))
        const a1 = yield* planner.plan(PlannedTaskAttemptPlanRequest.Fresh({ specification: taskA }))
        const replacement = yield* planner.plan(
          PlannedTaskAttemptPlanRequest.ExactReplacement({
            baseSha: replacementBase,
            ordinal: PlannedTaskAttemptOrdinal.make(7),
            specification: taskA
          })
        )
        return { a0, a1, b0, replacement }
      }).pipe(Effect.provide(productionPlannedTaskAttemptLayer(configuration, runId)))
    )
    expect(result.a0).toMatchObject(
      deriveProductionPlannedAttemptLocations(root, runId, taskA.taskId, PlannedTaskAttemptOrdinal.make(0))
    )
    expect(result.b0).toMatchObject(
      deriveProductionPlannedAttemptLocations(root, runId, taskB.taskId, PlannedTaskAttemptOrdinal.make(0))
    )
    expect(result.a1).toMatchObject(
      deriveProductionPlannedAttemptLocations(root, runId, taskA.taskId, PlannedTaskAttemptOrdinal.make(1))
    )
    expect(result.replacement).toMatchObject({
      ...deriveProductionPlannedAttemptLocations(root, runId, taskA.taskId, PlannedTaskAttemptOrdinal.make(7)),
      baseSha: replacementBase
    })
  })
})
