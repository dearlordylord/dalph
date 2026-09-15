import { NodeCrypto, NodeFileSystem } from "@effect/platform-node"
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
  TaskId,
  TaskExecutorLocator,
  TaskRevision,
  WorktreeLocator
} from "@dalph/contracts"
import { Context, Effect, FileSystem, Layer } from "effect"
import { it } from "@effect/vitest"
import { describe, expect } from "vitest"
import {
  CoordinatorOwnership,
  GitCommand,
  Integrator,
  IntegratorCandidateResourceLocator,
  IntegratorRequest,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorSessionCorrelation,
  IntegratorSessionId
} from "@dalph/orchestrator"
import { CodexAppServer } from "./codex-app-server.js"
import { CodexOwnedTurnToken, CodexThreadOwnershipToken } from "./codex-attempt-store.js"
import {
  CodexIntegratorConfiguration,
  IntegratorCandidateWorktreeRoot,
  IntegratorPrivateStoreLocator,
  candidateWorktreePathFor
} from "./codex-integrator-private-store.js"
import { KimiAcpSessionId, controlledKimiAcpClientLayer, type KimiAcpClientService } from "./kimi-acp.js"
import { kimiIntegratorProviderLayer, nodeKimiIntegratorLayer } from "./kimi-integrator-provider.js"

describe("Kimi Integrator provider adapter", () => {
  it.effect("routes the shared Integrator protocol through Kimi ACP", () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const sessionId = KimiAcpSessionId.make("kimi-integrator-session")
      const observation = {
        sessionId,
        cwd: "/tmp/kimi-integrator-candidate",
        status: "terminal" as const,
        updateCount: 1,
        lastMessage: '{"version":1,"outcome":"PreparedCandidate","candidate":"candidate"}',
        stopReason: "end_turn",
        permissionDenied: false
      }
      const client: KimiAcpClientService = {
        initialize: () => Effect.succeed({ loadSession: true, resumeSession: true, sessionClose: true }),
        newSession: (cwd) => Effect.sync(() => calls.push(`newSession:${cwd}`)).pipe(Effect.as(sessionId)),
        loadSession: (id) => Effect.sync(() => calls.push(`loadSession:${id}`)).pipe(Effect.as(id)),
        resumeSession: (id, cwd) => Effect.sync(() => calls.push(`resumeSession:${id}:${cwd}`)).pipe(Effect.as(id)),
        prompt: (id, text) => Effect.sync(() => calls.push(`prompt:${id}:${text}`)),
        observe: (id) => Effect.sync(() => calls.push(`observe:${id}`)).pipe(Effect.as(observation)),
        cancel: (id) => Effect.sync(() => calls.push(`cancel:${id}`)),
        closeSession: (id) => Effect.sync(() => calls.push(`closeSession:${id}`)),
        close: () => Effect.sync(() => calls.push("close"))
      }
      const context = yield* Layer.build(
        kimiIntegratorProviderLayer.pipe(
          Layer.provide(controlledKimiAcpClientLayer(client)),
          Layer.provide(NodeCrypto.layer)
        )
      )
      const app = Context.get(context, CodexAppServer)
      const threadToken = CodexThreadOwnershipToken.make("thread-token")
      const turnToken = CodexOwnedTurnToken.make("turn-token")
      const thread = yield* app.startThread(observation.cwd, threadToken)
      yield* app.startTurn(thread.id, observation.cwd, "integrate", turnToken)
      const listed = yield* app.listThreads()

      expect(calls).toEqual([
        `newSession:${observation.cwd}`,
        `observe:${sessionId}`,
        `prompt:${sessionId}:integrate`,
        `observe:${sessionId}`,
        `observe:${sessionId}`
      ])
      expect(listed.map(({ id }) => id)).toEqual([thread.id])
    })
  )

  it.effect("runs the shared Integrator core through Kimi without acquiring Codex", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const root = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-kimi-integrator-" })
        const repository = GitRepositoryLocator.make(`${root}/repository.git`)
        const config = CodexIntegratorConfiguration.make({
          candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make(root),
          commonDirectory: repository,
          privateStoreLocator: IntegratorPrivateStoreLocator.make(`${root}/integrator-private.json`),
          repository
        })
        const resource = IntegratorCandidateResourceLocator.make("candidate:test")
        const candidatePath = candidateWorktreePathFor(config, resource)
        const targetHead = GitCommitSha.make("a".repeat(40))
        const acceptedCommit = GitCommitSha.make("b".repeat(40))
        const session = IntegratorSessionCorrelation.make({
          acceptedResult: AcceptedResult.make({
            commit: acceptedCommit,
            evidenceManifest: EvidenceReference.make({ byteLength: 0, digest: EvidenceDigest.make("0".repeat(64)) })
          }),
          candidateResource: resource,
          expectedTargetHead: targetHead,
          integrationTarget: IntegrationTarget.make({ repository, ref: IntegrationTargetRef.make("refs/heads/main") }),
          plannedAttempt: PlannedTaskAttempt.make({
            attemptId: AttemptId.make("attempt"),
            baseSha: targetHead,
            branch: TaskBranchRef.make("refs/heads/task"),
            executor: TaskExecutorLocator.make("kimi:test"),
            runId: RunId.make("run"),
            taskId: TaskId.make("task"),
            taskRevision: TaskRevision.make("revision"),
            worktree: WorktreeLocator.make(`${root}/planned`)
          }),
          queuedAt: 1,
          sessionId: IntegratorSessionId.make("session"),
          startedAt: 2,
          targetLineageObservedAt: 3
        })
        const sessionId = KimiAcpSessionId.make("kimi-integrator-session")
        const observation = {
          sessionId,
          cwd: candidatePath,
          status: "terminal" as const,
          updateCount: 1,
          lastMessage: '{"version":1,"outcome":"PreparedCandidate","candidate":"M"}',
          stopReason: "end_turn",
          permissionDenied: false
        }
        const calls: Array<string> = []
        const client: KimiAcpClientService = {
          initialize: () => Effect.succeed({ loadSession: true, resumeSession: true, sessionClose: true }),
          newSession: (cwd) => Effect.sync(() => calls.push(`newSession:${cwd}`)).pipe(Effect.as(sessionId)),
          loadSession: (id) => Effect.succeed(id),
          resumeSession: (id) => Effect.succeed(id),
          prompt: (id, text) => Effect.sync(() => calls.push(`prompt:${id}:${text.includes("Accepted commit C")}`)),
          observe: (id) => Effect.sync(() => calls.push(`observe:${id}`)).pipe(Effect.as(observation)),
          cancel: () => Effect.void,
          closeSession: () => Effect.void,
          close: () => Effect.void
        }
        let registered = false
        const git = GitCommand.of({
          run: (_directory, args) => {
            if (args[0] === "worktree" && args[1] === "list") {
              return Effect.succeed({
                exitCode: 0,
                stderr: "",
                stdout: registered ? `worktree ${candidatePath}\0HEAD ${targetHead}\0detached\0\0` : ""
              })
            }
            if (args[0] === "worktree" && args[1] === "add") {
              registered = true
              return fileSystem
                .makeDirectory(candidatePath, { recursive: true })
                .pipe(Effect.as({ exitCode: 0, stderr: "", stdout: "" }))
            }
            return Effect.succeed({ exitCode: 0, stderr: "", stdout: "" })
          },
          runInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "" }),
          runBytesInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: new Uint8Array() })
        })
        const ownership = CoordinatorOwnership.of({ release: Effect.void, runMutation: (mutation) => mutation })
        const layer = nodeKimiIntegratorLayer(config, controlledKimiAcpClientLayer(client)).pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              NodeFileSystem.layer,
              Layer.succeed(GitCommand, git),
              Layer.succeed(CoordinatorOwnership, ownership)
            )
          )
        )
        const context = yield* Layer.build(layer)
        const integrator = Context.get(context, Integrator)
        const result = yield* integrator.prepare(
          IntegratorRequest.make({
            correlation: IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session })
          })
        )
        expect(result._tag).toBe("PreparedCandidate")
        expect(calls.some((call) => call.startsWith("newSession:"))).toBe(true)
        expect(calls.some((call) => call.startsWith("prompt:") && call.endsWith(":true"))).toBe(true)
      })
    ).pipe(Effect.provide(NodeFileSystem.layer))
  )
})
