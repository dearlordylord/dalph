import { NodeFileSystem } from "@effect/platform-node"
import {
  AcceptedResult,
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import {
  GitCommonDirectoryLocator,
  CoordinatorOwnershipLost,
  GitCommandInvocationFailure,
  IntegratorCandidateResourceLocator,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  JournalPosition,
  type GitCommandService
} from "@dalph/orchestrator"
import { Effect, Exit, FileSystem, Option } from "effect"
import { describe, expect, it } from "vitest"
import {
  CodexIntegratorConfiguration,
  CodexIntegratorPrivateRecord,
  type CodexIntegratorPrivateStoreService,
  IntegratorCandidateWorktreePath,
  IntegratorCandidateWorktreeRoot,
  IntegratorPrivateStoreLocator,
  revision
} from "./codex-integrator-private-store.js"
import { CodexServerIncarnation, CodexThreadOwnershipToken } from "./codex-attempt-store.js"
import { ensureCandidateWorktree as ensureWorktree, readWorktrees } from "./codex-integrator-worktree.js"

const config = CodexIntegratorConfiguration.make({
  candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make("/tmp/dalph-worktree-tests"),
  commonDirectory: GitCommonDirectoryLocator.make("/tmp/dalph-worktree-tests.git"),
  privateStoreLocator: IntegratorPrivateStoreLocator.make("/tmp/dalph-worktree-tests/store.json"),
  repository: GitRepositoryLocator.make("/tmp/dalph-worktree-tests.git")
})

const expectedHead = "a".repeat(40)
const worktreeSession = IntegratorSessionCorrelation.make({
  acceptedResult: AcceptedResult.make({
    commit: GitCommitSha.make("b".repeat(40)),
    evidenceManifest: EvidenceReference.make({ byteLength: 0, digest: EvidenceDigest.make("0".repeat(64)) })
  }),
  candidateResource: IntegratorCandidateResourceLocator.make("candidate:worktree-tests"),
  expectedTargetHead: GitCommitSha.make(expectedHead),
  integrationTarget: IntegrationTarget.make({
    repository: GitRepositoryLocator.make("/tmp/dalph-worktree-tests.git"),
    ref: IntegrationTargetRef.make("refs/heads/main")
  }),
  plannedAttempt: PlannedTaskAttempt.make({
    attemptId: AttemptId.make("worktree-attempt"),
    baseSha: GitCommitSha.make(expectedHead),
    branch: TaskBranchRef.make("refs/heads/worktree-tests"),
    executor: TaskExecutorLocator.make("worktree-executor"),
    runId: RunId.make("worktree-run"),
    taskId: TaskId.make("worktree-task"),
    taskRevision: TaskRevision.make("worktree-revision"),
    worktree: WorktreeLocator.make("/tmp/worktree-tests-planned")
  }),
  queuedAt: JournalPosition.make(1),
  sessionId: IntegratorSessionId.make("worktree-session"),
  startedAt: JournalPosition.make(2),
  targetLineageObservedAt: JournalPosition.make(3)
})

const privateRecordFor = (
  candidatePath: IntegratorCandidateWorktreePath,
  worktreeReady = false,
  worktreeMaterializationIntent = false
): CodexIntegratorPrivateRecord =>
  CodexIntegratorPrivateRecord.make({
    appServerIncarnation: CodexServerIncarnation.make("worktree-incarnation"),
    candidatePath,
    correlation: worktreeSession,
    revision: revision(1),
    removed: false,
    removalIntent: false,
    runs: [],
    threadId: null,
    threadToken: CodexThreadOwnershipToken.make("worktree-thread"),
    threadStartIntent: false,
    worktreeMaterializationIntent,
    worktreeReady
  })

const porcelain = (
  candidatePath: string,
  head = expectedHead,
  mode: "detached" | "branch" = "detached",
  extra = ""
): string =>
  [
    `worktree ${candidatePath}`,
    `HEAD ${head}`,
    mode === "detached" ? "detached" : "branch refs/heads/foreign",
    extra,
    ""
  ]
    .filter((line) => line.length > 0)
    .join("\n")

const privateStoreFor = (writes: Array<CodexIntegratorPrivateRecord>): CodexIntegratorPrivateStoreService => ({
  read: () => Effect.succeed(Option.none()),
  findByCandidatePath: () => Effect.succeed(Option.none()),
  write: (value) => Effect.sync(() => void writes.push(value))
})

type EnsureOptions = {
  readonly list: ReadonlyArray<string>
  readonly addResult?: { readonly exitCode: number; readonly stderr: string; readonly stdout?: string }
  readonly existsBefore?: boolean
  readonly createOnAdd?: boolean
  readonly ownershipFailure?: boolean
  readonly worktreeReady?: boolean
}

const ensure = (options: EnsureOptions) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-worktree-boundary-" })
        const candidatePath = IntegratorCandidateWorktreePath.make(`${root}/candidate`)
        if (options.existsBefore === true) yield* fileSystem.makeDirectory(candidatePath)
        const writes: Array<CodexIntegratorPrivateRecord> = []
        let listReads = 0
        const commands: GitCommandService = {
          run: (_directory, args) =>
            Effect.gen(function* () {
              if (args[0] === "worktree" && args[1] === "list") {
                const stdout = (options.list[Math.min(listReads++, options.list.length - 1)] ?? "")
                  .replaceAll("/tmp/ignored", candidatePath)
                  .replaceAll("/tmp/existing-candidate", candidatePath)
                return { exitCode: 0, stderr: "", stdout }
              }
              if (args[0] === "worktree" && args[1] === "add") {
                if (options.createOnAdd === true) {
                  yield* fileSystem
                    .makeDirectory(candidatePath)
                    .pipe(Effect.mapError((error) => new GitCommandInvocationFailure({ detail: String(error) })))
                }
                return options.addResult === undefined
                  ? { exitCode: 0, stderr: "", stdout: "" }
                  : { ...options.addResult, stdout: options.addResult.stdout ?? "" }
              }
              return { exitCode: 0, stderr: "", stdout: "" }
            }),
          runInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "" }),
          runBytesInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: new Uint8Array() })
        }
        const ownership = {
          runMutation: <A, E, R>(mutation: Effect.Effect<A, E, R>) =>
            options.ownershipFailure === true
              ? Effect.fail(new CoordinatorOwnershipLost({ gitCommonDirectory: config.commonDirectory }))
              : mutation
        }
        const result = yield* Effect.exit(
          ensureWorktree(
            commands,
            fileSystem,
            config,
            privateRecordFor(candidatePath, options.worktreeReady),
            privateStoreFor(writes),
            ownership
          )
        )
        return { result, writes }
      }).pipe(Effect.provide(NodeFileSystem.layer))
    )
  )

const commandsFor = (result: { readonly exitCode: number; readonly stderr: string; readonly stdout: string }) => {
  const run = () => Effect.succeed(result)
  return {
    run,
    runInWorktree: run,
    runBytesInWorktree: () =>
      Effect.succeed({
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: new TextEncoder().encode(result.stdout)
      })
  } satisfies GitCommandService
}

const read = (stdout: string, exitCode = 0, stderr = "") =>
  Effect.runPromise(Effect.exit(readWorktrees(commandsFor({ exitCode, stderr, stdout }), config)))

describe("Codex Integrator worktree parser", () => {
  it("accepts exact branch and detached registrations", async () => {
    const exit = await read(
      [
        "worktree /tmp/branch",
        "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "branch refs/heads/topic",
        "locked",
        "",
        "worktree /tmp/detached",
        "HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        "detached",
        "prunable stale",
        ""
      ].join("\n")
    )
    expect(Exit.isSuccess(exit)).toBe(true)
    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual([
        {
          worktree: "/tmp/branch",
          head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          branch: "refs/heads/topic",
          detached: false,
          prunable: false
        },
        { worktree: "/tmp/detached", head: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", detached: true, prunable: true }
      ])
    }
  })

  it("fails closed for provider errors and malformed porcelain blocks", async () => {
    const cases = [
      await read("", 1, "permission denied"),
      await read("worktree /tmp/candidate\nHEAD abc\nunknown field\n"),
      await read("worktree /tmp/candidate\nworktree /tmp/other\nHEAD abc\ndetached\n"),
      await read("worktree /tmp/candidate\nHEAD abc\n"),
      await read("HEAD abc\ndetached\n"),
      await read(
        ["worktree /tmp/candidate", "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "branch refs/heads/"].join("\n")
      ),
      await read(
        [
          "worktree /tmp/candidate",
          "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          "branch refs/heads/",
          "detached"
        ].join("\n")
      ),
      await read(
        ["worktree /tmp/one", "HEAD abc", "detached", "", "worktree /tmp/one", "HEAD def", "detached", ""].join("\n")
      )
    ]
    for (const exit of cases) expect(Exit.isFailure(exit)).toBe(true)
  })

  it("reconciles exact registrations and fails closed across every add boundary", async () => {
    const existingPath = "/tmp/existing-candidate"
    const existing = porcelain(existingPath)
    const ready = await ensure({ list: [existing], existsBefore: true, worktreeReady: true })
    expect(Exit.isSuccess(ready.result)).toBe(true)
    expect(ready.writes).toHaveLength(0)

    const intent = await ensure({ list: [existing], existsBefore: true })
    expect(Exit.isSuccess(intent.result)).toBe(true)
    expect(intent.writes).toHaveLength(2)

    const existingFailures = [
      await ensure({ list: [porcelain(existingPath, "c".repeat(40))], existsBefore: true }),
      await ensure({ list: [porcelain(existingPath, expectedHead, "branch")], existsBefore: true }),
      await ensure({ list: [porcelain(existingPath, expectedHead, "detached", "prunable stale")], existsBefore: true }),
      await ensure({ list: [existing], existsBefore: false })
    ]
    for (const result of existingFailures) expect(Exit.isFailure(result.result)).toBe(true)

    const noRegistrationReady = await ensure({ list: [""], worktreeReady: true })
    const existingPathWithoutRegistration = await ensure({ list: [""], existsBefore: true })
    expect(Exit.isFailure(noRegistrationReady.result)).toBe(true)
    expect(Exit.isFailure(existingPathWithoutRegistration.result)).toBe(true)

    const addBoundaries = [
      await ensure({ list: [""], addResult: { exitCode: 0, stderr: "" } }),
      await ensure({ list: [""], addResult: { exitCode: 1, stderr: "creation failed" } }),
      await ensure({ list: [""], addResult: { exitCode: 1, stderr: "" } }),
      await ensure({ list: ["", porcelain("/tmp/ignored", "c".repeat(40))], addResult: { exitCode: 0, stderr: "" } }),
      await ensure({
        list: ["", porcelain("/tmp/ignored", expectedHead, "branch")],
        addResult: { exitCode: 0, stderr: "" }
      }),
      await ensure({
        list: ["", porcelain("/tmp/ignored", expectedHead, "detached", "prunable stale")],
        addResult: { exitCode: 0, stderr: "" }
      }),
      await ensure({
        list: ["", porcelain("/tmp/ignored")],
        addResult: { exitCode: 0, stderr: "" },
        createOnAdd: false
      })
    ]
    for (const result of addBoundaries) expect(Exit.isFailure(result.result)).toBe(true)

    const success = await ensure({
      list: ["", porcelain("/tmp/ignored")],
      addResult: { exitCode: 0, stderr: "" },
      createOnAdd: true
    })
    expect(Exit.isSuccess(success.result)).toBe(true)
    expect(success.writes).toHaveLength(2)

    const ownershipFailure = await ensure({ list: [""], ownershipFailure: true })
    expect(Exit.isFailure(ownershipFailure.result)).toBe(true)
  })
})
