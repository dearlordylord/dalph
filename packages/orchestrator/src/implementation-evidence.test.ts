import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Crypto, Effect, FileSystem, Layer, PlatformError, Result, Schema } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { expect } from "vitest"
import {
  AttemptId,
  GitCommitSha,
  OperationId,
  PlannedTaskAttempt,
  ProviderObservationId,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  TaskRevision,
  TaskWorkSessionId,
  TaskWorkSessionLocator,
  WorkerProcessId,
  WorktreeLocator
} from "./domain.js"
import { GitCommand, GitCommandInvocationFailure, GitCommandResult, nodeGitCommandLayer } from "./git-command.js"
import {
  authorizeImplementationReview,
  EvidenceDigest,
  EvidenceReference,
  EvidenceStore,
  EvidenceStoreFailure,
  ImplementationDiffReadFailure,
  ImplementationEvidenceManifest,
  ImplementationEvidenceSealingSimulated,
  ImplementationEvidenceSource,
  ImplementationReviewNotAuthorized,
  memoryEvidenceStoreLayer,
  nodeImplementationEvidenceSourceLayer,
  sealImplementationEvidence,
  testImplementationEvidenceServicesLayer
} from "./implementation-evidence.js"
import { TaskExecutionOutcome } from "./task-execution.js"
import {
  makeImplementationEvidenceSealingOperation,
  WorkflowOperation,
  workflowOperationId
} from "./workflow-operation.js"

const plan = PlannedTaskAttempt.make({
  attemptId: AttemptId.make("evidence-attempt"),
  baseSha: GitCommitSha.make("1111111111111111111111111111111111111111"),
  branch: TaskBranchRef.make("refs/heads/evidence-attempt"),
  executor: TaskExecutorLocator.make("executor:evidence"),
  runId: RunId.make("evidence-run"),
  session: TaskWorkSessionLocator.make("session:evidence"),
  taskId: TaskId.make("evidence-task"),
  taskRevision: TaskRevision.make("evidence-revision"),
  worktree: WorktreeLocator.make("/tmp/evidence-attempt")
})
const predecessorOperationId = OperationId.make("execution-predecessor")
const outcome = TaskExecutionOutcome.cases.Succeeded.make({
  observationId: ProviderObservationId.make("evidence-observation"),
  operationId: predecessorOperationId,
  output: "implementation output",
  processId: WorkerProcessId.make(42),
  sessionId: TaskWorkSessionId.make("evidence-session")
})
const sourceLayer = Layer.succeed(
  ImplementationEvidenceSource,
  ImplementationEvidenceSource.of({
    readDiff: () => Effect.succeed(new TextEncoder().encode("diff --git a/a b/a"))
  })
)
const memoryLayer = memoryEvidenceStoreLayer.pipe(Layer.provide(NodeServices.layer))

it.effect("seals output and diff before publishing a predecessor-linked stage manifest", () =>
  Effect.gen(function*() {
    const sealed = yield* sealImplementationEvidence(
      OperationId.make("seal-evidence"),
      plan,
      predecessorOperationId,
      outcome
    )
    const store = yield* EvidenceStore
    const manifestBytes = yield* store.read(sealed.manifestReference)
    expect(JSON.parse(new TextDecoder().decode(manifestBytes))).toEqual({
      diff: sealed.manifest.diff,
      implementationOutput: sealed.manifest.implementationOutput,
      plannedBaseSha: plan.baseSha,
      predecessorOperationId,
      runId: plan.runId,
      stage: "Implementation",
      taskId: plan.taskId
    })
    expect(new TextDecoder().decode(yield* store.read(sealed.manifest.implementationOutput)))
      .toBe("implementation output")
  }).pipe(
    Effect.provide(sourceLayer),
    Effect.provide(memoryLayer)
  ))

it.effect("content addressing is immutable, idempotent, and isolates caller byte mutation", () =>
  Effect.gen(function*() {
    const store = yield* EvidenceStore
    const bytes = new TextEncoder().encode("same bytes")
    const first = yield* store.put(bytes)
    bytes[0] = 0
    const second = yield* store.put(new TextEncoder().encode("same bytes"))
    expect(second).toEqual(first)
    expect(new TextDecoder().decode(yield* store.read(first))).toBe("same bytes")
    expect(yield* store.read({ ...first, byteLength: first.byteLength + 1 }).pipe(Effect.flip))
      .toBeInstanceOf(EvidenceStoreFailure)
    expect(
      yield* store.read({
        byteLength: 1,
        digest: EvidenceDigest.make("bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb")
      }).pipe(Effect.flip)
    ).toBeInstanceOf(EvidenceStoreFailure)
  }).pipe(Effect.provide(memoryLayer)))

it.effect("partial and simulated evidence cannot authorize review", () =>
  Effect.gen(function*() {
    const partial = yield* authorizeImplementationReview({
      _tag: "SealedImplementationEvidence",
      manifest: { stage: "Implementation" }
    }).pipe(Effect.flip)
    const simulated = yield* authorizeImplementationReview(
      ImplementationEvidenceSealingSimulated.make({
        operationId: OperationId.make("simulated-seal"),
        predecessorOperationId,
        stage: "Implementation"
      })
    ).pipe(Effect.flip)
    expect(partial).toBeInstanceOf(ImplementationReviewNotAuthorized)
    expect(simulated).toBeInstanceOf(ImplementationReviewNotAuthorized)
  }).pipe(Effect.provide(memoryLayer)))

it.effect("authorizes only a complete sealed manifest and keeps the default source unavailable", () =>
  Effect.gen(function*() {
    const sealed = yield* sealImplementationEvidence(
      OperationId.make("authorize-evidence"),
      plan,
      predecessorOperationId,
      outcome
    ).pipe(Effect.provide(sourceLayer))
    const authorization = yield* authorizeImplementationReview(sealed)
    expect(authorization.predecessorOperationId).toBe(predecessorOperationId)
    const unavailable = yield* Effect.gen(function*() {
      const source = yield* ImplementationEvidenceSource
      return yield* source.readDiff(OperationId.make("unavailable-source"), plan)
    }).pipe(Effect.provide(testImplementationEvidenceServicesLayer), Effect.flip)
    expect(unavailable._tag).toBe("ImplementationDiffReadFailure")
  }).pipe(Effect.provide(memoryLayer)))

it.effect("rejects missing, malformed, mismatched, and partially referenced manifest bytes", () =>
  Effect.gen(function*() {
    const store = yield* EvidenceStore
    const absent = EvidenceReference.make({
      byteLength: 1,
      digest: EvidenceDigest.make("cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc")
    })
    const manifest = ImplementationEvidenceManifest.make({
      diff: absent,
      implementationOutput: absent,
      plannedBaseSha: plan.baseSha,
      predecessorOperationId,
      runId: plan.runId,
      stage: "Implementation",
      taskId: plan.taskId
    })
    const candidates = [
      { manifest, manifestReference: absent },
      {
        manifest,
        manifestReference: yield* store.put(new TextEncoder().encode("not json"))
      },
      {
        manifest,
        manifestReference: yield* store.put(new TextEncoder().encode("{}"))
      }
    ]
    for (const candidate of candidates) {
      expect(
        yield* authorizeImplementationReview({
          _tag: "SealedImplementationEvidence",
          ...candidate
        }).pipe(Effect.flip)
      ).toBeInstanceOf(ImplementationReviewNotAuthorized)
    }
    const manifestReference = yield* store.put(new TextEncoder().encode(
      JSON.stringify(Schema.encodeUnknownSync(ImplementationEvidenceManifest)(manifest))
    ))
    expect(
      yield* authorizeImplementationReview({
        _tag: "SealedImplementationEvidence",
        manifest: { ...manifest, taskId: TaskId.make("different-task") },
        manifestReference
      }).pipe(Effect.flip)
    ).toBeInstanceOf(ImplementationReviewNotAuthorized)
    expect(
      yield* authorizeImplementationReview({
        _tag: "SealedImplementationEvidence",
        manifest,
        manifestReference
      }).pipe(Effect.flip)
    ).toBeInstanceOf(ImplementationReviewNotAuthorized)
  }).pipe(Effect.provide(memoryLayer)))

it.effect("maps cryptographic digest failures into typed EvidenceStore failures", () =>
  Effect.gen(function*() {
    const store = yield* EvidenceStore
    const failure = yield* store.put(new Uint8Array([1])).pipe(Effect.flip)
    expect(failure).toBeInstanceOf(EvidenceStoreFailure)
  }).pipe(
    Effect.provide(memoryEvidenceStoreLayer),
    Effect.provide(Layer.succeed(
      Crypto.Crypto,
      Crypto.make({
        digest: () =>
          Effect.fail(PlatformError.systemError({
            _tag: "Unknown",
            module: "EvidenceCrypto",
            method: "digest"
          })),
        randomBytes: (size) => new Uint8Array(size)
      })
    ))
  ))

it("rejects an evidence operation whose direct predecessor is not its execution", () => {
  const valid = makeImplementationEvidenceSealingOperation({
    execution: { _tag: "SuccessfulExecution", outcome },
    operationId: OperationId.make("invalid-predecessor-seal"),
    plannedAttempt: plan
  })
  const decoded = Schema.decodeUnknownResult(WorkflowOperation)({
    ...valid,
    predecessorOperationIds: []
  })
  expect(workflowOperationId(valid)).toBe(valid.operationId)
  expect(Result.isFailure(decoded)).toBe(true)
})

it.effect("reads exact Git diff bytes and preserves command failures as typed evidence failures", () =>
  Effect.gen(function*() {
    const operationId = OperationId.make("read-diff")
    let invocation = 0
    const successLayer = nodeImplementationEvidenceSourceLayer().pipe(Layer.provide(Layer.succeed(
      GitCommand,
      GitCommand.of({
        run: () => Effect.die("unused common-dir command"),
        runInWorktree: () =>
          Effect.succeed(GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "/repo/.git/objects\n" })),
        runBytesInWorktree: (worktree, args) => {
          expect(worktree).toBe(plan.worktree)
          invocation += 1
          expect(args[0]).toBe(["read-tree", "add", "diff"][invocation - 1])
          return Effect.succeed({
            exitCode: 0,
            stderr: "",
            stdout: invocation === 3 ? new TextEncoder().encode("patch") : new Uint8Array()
          })
        }
      })
    )))
    const bytes = yield* Effect.gen(function*() {
      const source = yield* ImplementationEvidenceSource
      return yield* source.readDiff(operationId, plan)
    }).pipe(Effect.provide(successLayer))
    expect(new TextDecoder().decode(bytes)).toBe("patch")

    for (
      const command of [
        GitCommand.of({
          run: () => Effect.die("unused common-dir command"),
          runInWorktree: () =>
            Effect.succeed(GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "/repo/.git/objects\n" })),
          runBytesInWorktree: () => Effect.succeed({ exitCode: 2, stderr: "bad diff", stdout: new Uint8Array() })
        }),
        GitCommand.of({
          run: () => Effect.die("unused common-dir command"),
          runInWorktree: () =>
            Effect.succeed(GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "/repo/.git/objects\n" })),
          runBytesInWorktree: () => Effect.succeed({ exitCode: 3, stderr: "", stdout: new Uint8Array() })
        }),
        GitCommand.of({
          run: () => Effect.die("unused common-dir command"),
          runInWorktree: () =>
            Effect.succeed(GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "/repo/.git/objects\n" })),
          runBytesInWorktree: () => Effect.fail(new GitCommandInvocationFailure({ detail: "spawn failed" }))
        })
      ]
    ) {
      const failure = yield* Effect.gen(function*() {
        const source = yield* ImplementationEvidenceSource
        return yield* source.readDiff(operationId, plan)
      }).pipe(
        Effect.provide(nodeImplementationEvidenceSourceLayer()),
        Effect.provide(Layer.succeed(GitCommand, command)),
        Effect.flip
      )
      expect(failure._tag).toBe("ImplementationDiffReadFailure")
    }
    for (const failAt of [2, 3]) {
      let call = 0
      const failure = yield* Effect.gen(function*() {
        const source = yield* ImplementationEvidenceSource
        return yield* source.readDiff(operationId, plan)
      }).pipe(
        Effect.provide(nodeImplementationEvidenceSourceLayer()),
        Effect.provide(Layer.succeed(
          GitCommand,
          GitCommand.of({
            run: () => Effect.die("unused common-dir command"),
            runInWorktree: () =>
              Effect.succeed(GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "/repo/.git/objects\n" })),
            runBytesInWorktree: () => {
              call += 1
              if (call === failAt) {
                return Effect.fail(new GitCommandInvocationFailure({ detail: `failed call ${call}` }))
              }
              return Effect.succeed({
                exitCode: 0,
                stderr: "",
                stdout: new Uint8Array()
              })
            }
          })
        )),
        Effect.flip
      )
      expect(failure).toBeInstanceOf(ImplementationDiffReadFailure)
    }
    const invalidAlternate = yield* Effect.gen(function*() {
      const source = yield* ImplementationEvidenceSource
      return yield* source.readDiff(operationId, plan)
    }).pipe(
      Effect.provide(nodeImplementationEvidenceSourceLayer()),
      Effect.provide(Layer.succeed(
        GitCommand,
        GitCommand.of({
          run: () => Effect.die("unused common-dir command"),
          runInWorktree: () =>
            Effect.succeed(GitCommandResult.make({ exitCode: 0, stderr: "", stdout: "/bad:path/objects\n" })),
          runBytesInWorktree: () => Effect.die("invalid alternate must fail before snapshot commands")
        })
      )),
      Effect.flip
    )
    expect(invalidAlternate).toBeInstanceOf(ImplementationDiffReadFailure)
    const resolverFailure = yield* Effect.gen(function*() {
      const source = yield* ImplementationEvidenceSource
      return yield* source.readDiff(operationId, plan)
    }).pipe(
      Effect.provide(nodeImplementationEvidenceSourceLayer()),
      Effect.provide(Layer.succeed(
        GitCommand,
        GitCommand.of({
          run: () => Effect.die("unused common-dir command"),
          runInWorktree: () => Effect.fail(new GitCommandInvocationFailure({ detail: "resolver failed" })),
          runBytesInWorktree: () => Effect.die("resolver failure must precede snapshot commands")
        })
      )),
      Effect.flip
    )
    expect(resolverFailure).toBeInstanceOf(ImplementationDiffReadFailure)
  }).pipe(Effect.provide(NodeServices.layer)))

it.effect("reads staged and untracked bytes from the exact linked-worktree index", () =>
  Effect.scoped(
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-evidence-worktree-" })
      const repository = `${root}/repository`
      const linked = `${root}/linked`
      yield* fs.makeDirectory(repository)
      const git = yield* GitCommand
      const run = Effect.fn("EvidenceTest.git")(function*(worktree: string, args: ReadonlyArray<string>) {
        const result = yield* git.runInWorktree(worktree, args)
        if (result.exitCode !== 0) return yield* Effect.die(result.stderr)
        return result.stdout.trim()
      })
      yield* run(repository, ["init", "--initial-branch=master"])
      yield* run(repository, ["config", "user.email", "dalph@example.invalid"])
      yield* run(repository, ["config", "user.name", "Dalph Test"])
      yield* fs.writeFileString(`${repository}/tracked.txt`, "base\n")
      yield* run(repository, ["add", "tracked.txt"])
      yield* run(repository, ["commit", "-m", "base"])
      const baseSha = GitCommitSha.make(yield* run(repository, ["rev-parse", "HEAD"]))
      yield* run(repository, ["worktree", "add", "-b", "evidence", linked, baseSha])
      yield* fs.writeFileString(`${repository}/main-only.txt`, "must not leak\n")
      yield* run(repository, ["add", "main-only.txt"])
      yield* fs.writeFileString(`${linked}/tracked.txt`, "linked tracked\n")
      yield* fs.writeFileString(`${linked}/staged-new.txt`, "linked staged\n")
      yield* run(linked, ["add", "staged-new.txt"])
      yield* fs.writeFileString(`${linked}/untracked-new.txt`, "linked untracked\n")
      const invalidContent = new Uint8Array([0x66, 0x6f, 0x80, 0x0a])
      yield* fs.writeFile(`${linked}/invalid-content.txt`, invalidContent)
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const invalidFilenameProcess = yield* spawner.spawn(ChildProcess.make(
        "sh",
        ["-c", "printf 'x\\n' > \"$1/invalid-filename-$(printf '\\200')\"", "sh", linked]
      ))
      expect(yield* invalidFilenameProcess.exitCode).toBe(0)
      const linkedPlan = PlannedTaskAttempt.make({
        ...plan,
        baseSha,
        worktree: WorktreeLocator.make(linked)
      })
      const inventoryArgs = ["cat-file", "--batch-all-objects", "--batch-check=%(objectname)"]
      const inventoryBefore = yield* git.runBytesInWorktree(repository, inventoryArgs)
      const countBefore = yield* run(repository, ["count-objects", "-v"])
      const bytes = yield* Effect.gen(function*() {
        const source = yield* ImplementationEvidenceSource
        return yield* source.readDiff(OperationId.make("linked-diff"), linkedPlan)
      }).pipe(Effect.provide(nodeImplementationEvidenceSourceLayer()))
      const expectedIndex = yield* fs.makeTempDirectoryScoped({ prefix: "dalph-expected-index-" })
      const expectedObjects = `${expectedIndex}/objects`
      yield* fs.makeDirectory(expectedObjects)
      const repositoryObjects = yield* run(linked, [
        "rev-parse",
        "--path-format=absolute",
        "--git-path",
        "objects"
      ])
      const environment = {
        GIT_ALTERNATE_OBJECT_DIRECTORIES: repositoryObjects,
        GIT_INDEX_FILE: `${expectedIndex}/index`,
        GIT_OBJECT_DIRECTORY: expectedObjects
      }
      for (
        const args of [
          ["read-tree", baseSha],
          ["add", "-A", "--", "."]
        ]
      ) {
        expect((yield* git.runBytesInWorktree(linked, args, environment)).exitCode).toBe(0)
      }
      const expected = yield* git.runBytesInWorktree(
        linked,
        ["diff", "--cached", "--binary", baseSha],
        environment
      )
      expect(expected.exitCode).toBe(0)
      expect([...bytes]).toEqual([...expected.stdout])
      expect(bytes).toContain(0x80)
      const inventoryAfter = yield* git.runBytesInWorktree(repository, inventoryArgs)
      const countAfter = yield* run(repository, ["count-objects", "-v"])
      expect([...inventoryAfter.stdout]).toEqual([...inventoryBefore.stdout])
      expect(countAfter).toBe(countBefore)
      const patch = new TextDecoder().decode(bytes)
      expect(patch).toContain("linked tracked")
      expect(patch).toContain("staged-new.txt")
      expect(patch).toContain("linked staged")
      expect(patch).toContain("untracked-new.txt")
      expect(patch).toContain("linked untracked")
      expect(patch).toContain("invalid-filename")
      expect(patch).not.toContain("main-only")
    }).pipe(
      Effect.provide(nodeGitCommandLayer),
      Effect.provide(NodeServices.layer)
    )
  ))
