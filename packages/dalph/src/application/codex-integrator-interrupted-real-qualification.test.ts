/* eslint-disable import/no-nodejs-modules -- Disposable native interrupt/reopen qualification. */
import { NodeCrypto, NodeFileSystem, NodeServices } from "@effect/platform-node"
import { execFile as nodeExecFile } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, realpath, writeFile } from "node:fs/promises"
import { createServer } from "node:http"
import nodePath from "node:path"
import nodeProcess from "node:process"
import { promisify } from "node:util"
import { Deferred, Effect, Fiber, Layer, ManagedRuntime, Option, Schema, Stream } from "effect"
import { expect, it } from "vitest"
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
  GitCommonDirectoryTarget,
  Integrator,
  IntegratorRequest,
  IntegratorCandidateResourceLocator,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  JournalPosition,
  nodeGitCommandLayer,
  productionCoordinatorOwnershipLayer
} from "@dalph/orchestrator"
import {
  CodexAppServer,
  CodexOwnedActivityCensus,
  codexAppServerNodeLayer,
  makeNodeCodexProcessGroupCensusService,
  nodeCodexOwnedActivityCensusLayer
} from "./codex-app-server.js"
import { CodexServerLaunchRecord, nodeCodexAttemptStoreLayer } from "./codex-attempt-store.js"
import { codexIntegratorLayer } from "./codex-integrator.js"
import {
  CodexIntegratorConfiguration,
  CodexIntegratorPrivateRecord,
  CodexIntegratorPrivateStore,
  IntegratorCandidateWorktreeRoot,
  IntegratorPrivateStoreLocator,
  nodeCodexIntegratorPrivateStoreLayer,
  privateRuns
} from "./codex-integrator-private-store.js"

const execFile = promisify(nodeExecFile)
const enabled = nodeProcess.env["DALPH_RUN_REAL_CODEX_QUALIFICATION"] === "1"
it.skipIf(!enabled)(
  "R1/R4 native exact interrupted process-reopen seals without replayed notification or another provider turn",
  async () => {
    const executable = nodeProcess.env["DALPH_INTERRUPTED_CODEX_BIN"]
    if (executable === undefined) throw new Error("DALPH_INTERRUPTED_CODEX_BIN must name qualified Codex 0.162.1")
    expect(String((await execFile(executable, ["--version"])).stdout).trim()).toBe("codex-cli 0.162.1")
    const phase = nodeProcess.env["DALPH_INTERRUPTED_PHASE"]
    if (phase === undefined) {
      const packet = await realpath(await mkdtemp("/tmp/dalph-interrupted-controllers-"))
      const firstEvidence = nodePath.join(packet, "first.json")
      const file = "packages/dalph/src/application/codex-integrator-interrupted-real-qualification.test.ts"
      for (const step of ["Interrupt", "Reopen"]) {
        try {
          const result = await execFile("pnpm", ["exec", "vitest", "run", file], {
            env: { ...nodeProcess.env, DALPH_INTERRUPTED_PHASE: step, DALPH_INTERRUPTED_FIRST_EVIDENCE: firstEvidence },
            timeout: 60000,
            maxBuffer: 4 * 1024 * 1024
          })
          await writeFile(nodePath.join(packet, `${step}.log`), result.stdout + result.stderr)
        } catch (error) {
          await writeFile(nodePath.join(packet, `${step}-failure.txt`), String(error))
          throw error
        }
      }
      return
    }
    const firstEvidence = nodeProcess.env["DALPH_INTERRUPTED_FIRST_EVIDENCE"]
    if (firstEvidence === undefined) throw new Error("first phase receipt locator missing")
    const prior =
      phase === "Reopen"
        ? Schema.decodeUnknownSync(
            Schema.Struct({
              root: Schema.String,
              head: GitCommitSha,
              accepted: GitCommitSha,
              old: CodexServerLaunchRecord,
              retained: CodexIntegratorPrivateRecord,
              rawHash: Schema.String
            })
          )(JSON.parse(await readFile(firstEvidence, "utf8")))
        : undefined
    const root = prior?.root ?? (await realpath(await mkdtemp("/tmp/dalph-interrupted-native-")))
    const repository = nodePath.join(root, "repository")
    const codexHome = nodePath.join(root, "codex-home")
    if (prior === undefined) {
      await mkdir(repository)
      await mkdir(codexHome)
    }
    const git = async (...args: ReadonlyArray<string>) =>
      String((await execFile("git", ["-C", repository, ...args])).stdout).trim()
    let head = prior?.head ?? GitCommitSha.make("0".repeat(40))
    let accepted = prior?.accepted ?? head
    if (prior === undefined) {
      await git("init", "-q", "-b", "master")
      await git("config", "user.email", "interrupt@example.invalid")
      await git("config", "user.name", "Interrupt fixture")
      await writeFile(nodePath.join(repository, "behavior.txt"), "base\n")
      await git("add", ".")
      await git("commit", "-qm", "base")
      head = GitCommitSha.make(await git("rev-parse", "HEAD"))
      await git("checkout", "-qb", "accepted")
      await writeFile(nodePath.join(repository, "accepted.txt"), "accepted\n")
      await git("add", ".")
      await git("commit", "-qm", "accepted")
      accepted = GitCommitSha.make(await git("rev-parse", "HEAD"))
      await git("checkout", "-q", "master")
    }
    const providerReached = await Effect.runPromise(Deferred.make<void>())
    let providerRequests = 0
    const server = createServer((_request, response) => {
      providerRequests += 1
      void Effect.runPromise(Deferred.succeed(providerReached, undefined))
      response.writeHead(200, { "content-type": "text/event-stream" })
      response.write('data: {"type":"response.created","response":{"id":"held-interrupted-response"}}\n\n')
      // Hold one actual native provider turn until the fixture explicitly interrupts it.
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    server.unref()
    const address = server.address()
    if (address === null || typeof address === "string") throw new Error("fixture endpoint unavailable")
    await writeFile(
      nodePath.join(codexHome, "config.toml"),
      [
        "features.plugins = false",
        'model_provider = "fixture"',
        'model = "fixture"',
        "[model_providers.fixture]",
        'name = "fixture"',
        `base_url = "http://127.0.0.1:${address.port}/v1"`,
        'wire_api = "responses"',
        "request_max_retries = 0",
        "stream_max_retries = 0"
      ].join("\n")
    )
    const commonDirectory = await realpath(nodePath.join(repository, ".git"))
    const config = CodexIntegratorConfiguration.make({
      candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make(nodePath.join(root, "candidates")),
      commonDirectory: GitCommonDirectoryLocator.make(commonDirectory),
      privateStoreLocator: IntegratorPrivateStoreLocator.make(nodePath.join(root, "integrator-private.json")),
      repository: GitRepositoryLocator.make(repository)
    })
    const session = IntegratorSessionCorrelation.make({
      acceptedResult: AcceptedResult.make({
        commit: accepted,
        evidenceManifest: EvidenceReference.make({ byteLength: 0, digest: EvidenceDigest.make("0".repeat(64)) })
      }),
      candidateResource: IntegratorCandidateResourceLocator.make("interrupted-native-candidate"),
      expectedTargetHead: head,
      integrationTarget: IntegrationTarget.make({
        repository: config.repository,
        ref: IntegrationTargetRef.make("refs/heads/master")
      }),
      plannedAttempt: PlannedTaskAttempt.make({
        attemptId: AttemptId.make("interrupt-attempt"),
        baseSha: head,
        branch: TaskBranchRef.make("refs/heads/interrupt-attempt"),
        executor: TaskExecutorLocator.make("native"),
        runId: RunId.make("interrupt-run"),
        taskId: TaskId.make("interrupt-task"),
        taskRevision: TaskRevision.make("interrupt-revision"),
        worktree: WorktreeLocator.make(nodePath.join(root, "planned"))
      }),
      queuedAt: JournalPosition.make(1),
      sessionId: IntegratorSessionId.make("interrupt-session"),
      startedAt: JournalPosition.make(2),
      targetLineageObservedAt: JournalPosition.make(3)
    })
    const request = IntegratorRequest.make({
      correlation: IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session })
    })
    const observed = await Effect.runPromise(Deferred.make<CodexIntegratorPrivateRecord>())
    const launches: Array<CodexServerLaunchRecord> = []
    const census: Array<unknown> = []
    let turnStarts = 0
    let reopenHints = 0
    const layerFor = (reopen: boolean) => {
      const native = codexAppServerNodeLayer({ executable, environment: { CODEX_HOME: codexHome } }).pipe(
        Layer.provide(
          nodeCodexAttemptStoreLayer({ stateDirectory: nodePath.join(root, "state") }).pipe(
            Layer.provide(NodeFileSystem.layer)
          )
        ),
        Layer.provide(NodeServices.layer)
      )
      const app = Layer.effect(
        CodexAppServer,
        Effect.gen(function* () {
          const real = yield* CodexAppServer
          if (real.serverLaunch !== undefined) launches.push(real.serverLaunch)
          const attach = real.attachExactTurnCompletedHints
          return CodexAppServer.of({
            ...real,
            startTurn: (...args) =>
              real.startTurn(...args).pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    turnStarts += 1
                  })
                )
              ),
            ...(attach === undefined
              ? {}
              : {
                  attachExactTurnCompletedHints: (
                    ...args: Parameters<NonNullable<typeof real.attachExactTurnCompletedHints>>
                  ) =>
                    attach(...args).pipe(
                      Effect.map((subscription) => ({
                        ...subscription,
                        hints: subscription.hints.pipe(
                          Stream.tap(() =>
                            Effect.sync(() => {
                              if (reopen) reopenHints += 1
                            })
                          )
                        )
                      }))
                    )
                })
          })
        })
      ).pipe(Layer.provide(native))
      const store = Layer.effect(
        CodexIntegratorPrivateStore,
        Effect.gen(function* () {
          const real = yield* CodexIntegratorPrivateStore
          return CodexIntegratorPrivateStore.of({
            ...real,
            write: (record) =>
              real
                .write(record)
                .pipe(
                  Effect.tap(() =>
                    privateRuns(record).some((run) => run._tag === "TurnObserved")
                      ? Deferred.succeed(observed, record)
                      : Effect.void
                  )
                )
          })
        })
      ).pipe(Layer.provide(nodeCodexIntegratorPrivateStoreLayer(config).pipe(Layer.provide(NodeFileSystem.layer))))
      const activity = Layer.effect(
        CodexOwnedActivityCensus,
        Effect.gen(function* () {
          const real = yield* CodexOwnedActivityCensus
          return CodexOwnedActivityCensus.of({
            ...real,
            observe: (...args) =>
              real.observe(...args).pipe(
                Effect.tap((projection) =>
                  Effect.sync(() => {
                    census.push({ reopen, threadId: args[0].id, projection })
                  })
                )
              )
          })
        })
      ).pipe(Layer.provide(nodeCodexOwnedActivityCensusLayer))
      return codexIntegratorLayer(config).pipe(
        Layer.provideMerge(store),
        Layer.provide(activity),
        Layer.provideMerge(app),
        Layer.provide(NodeCrypto.layer),
        Layer.provide(NodeFileSystem.layer),
        Layer.provide(nodeGitCommandLayer.pipe(Layer.provide(NodeServices.layer))),
        Layer.provide(
          productionCoordinatorOwnershipLayer(GitCommonDirectoryTarget.make(commonDirectory)).pipe(
            Layer.provide(NodeFileSystem.layer)
          )
        )
      )
    }
    if (phase === "Interrupt") {
      const first = ManagedRuntime.make(layerFor(false))
      let retained: CodexIntegratorPrivateRecord | undefined
      let rawHash = ""
      try {
        retained = await first.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const pending = yield* Effect.forkChild((yield* Integrator).prepare(request))
              const record = yield* Deferred.await(observed)
              if (record._tag !== "ThreadWithRuns") return yield* Effect.die("missing observed thread")
              const run = record.runs[0]
              if (run._tag !== "TurnObserved") return yield* Effect.die("missing observed turn")
              const app = yield* CodexAppServer
              if (app.attachExactTurnCompletedHints === undefined) return yield* Effect.die("native hints unavailable")
              const subscription = yield* app.attachExactTurnCompletedHints(record.threadId, run.turnId)
              yield* Deferred.await(providerReached).pipe(
                Effect.timeoutOrElse({
                  duration: "10 seconds",
                  orElse: () =>
                    app
                      .readThread(record.threadId)
                      .pipe(
                        Effect.flatMap((snapshot) =>
                          Effect.fail(`native provider never reached endpoint: ${JSON.stringify(snapshot)}`)
                        )
                      )
                })
              )
              yield* app.interruptTurn(record.threadId, run.turnId)
              yield* Stream.runHead(subscription.hints)
              const snapshot = yield* app.readThread(record.threadId)
              expect(snapshot.turns).toHaveLength(1)
              expect(snapshot.turns[0]).toMatchObject({
                id: run.turnId,
                ownedTurnToken: run.token,
                status: "interrupted"
              })
              yield* Fiber.interrupt(pending)
              return record
            })
          ).pipe(Effect.timeout("45 seconds"))
        )
        const bytes = await readFile(config.privateStoreLocator)
        rawHash = createHash("sha256").update(bytes).digest("hex")
      } catch (error) {
        await writeFile(
          "/tmp/514-native-diagnostic.json",
          JSON.stringify({ root, retained, launches, providerRequests, error: String(error) }, null, 2)
        )
        server.closeAllConnections()
        server.close()
        throw error
      } finally {
        await first.runPromise(Effect.flatMap(CodexAppServer, (app) => app.close))
        await first.dispose()
      }
      const old = launches[0]
      if (old === undefined) throw new Error("native launch missing")
      expect((await Effect.runPromise(makeNodeCodexProcessGroupCensusService().observe(old)))._tag).toBe("Absent")
      await writeFile(firstEvidence, JSON.stringify({ root, head, accepted, old, retained, rawHash }, null, 2))
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      expect(turnStarts).toBe(1)
      return
    }
    if (prior === undefined) throw new Error("reopen receipt missing")
    launches.push(prior.old)
    expect((await Effect.runPromise(makeNodeCodexProcessGroupCensusService().observe(prior.old)))._tag).toBe("Absent")
    const second = ManagedRuntime.make(layerFor(true))
    try {
      const result = await second.runPromise(
        Effect.gen(function* () {
          const integrator = yield* Integrator
          const negative = yield* integrator.prepare(request)
          expect(yield* integrator.prepare(request)).toEqual(negative)
          const stored = yield* (yield* CodexIntegratorPrivateStore).read(session.sessionId)
          if (Option.isNone(stored)) return yield* Effect.die("private seal absent")
          expect(privateRuns(stored.value)[0]?._tag).toBe("InterruptedTurnSealed")
          return { negative, stored: stored.value }
        }).pipe(Effect.timeout("45 seconds"))
      )
      expect(result.negative._tag).toBe("NotPrepared")
      expect(turnStarts).toBe(0)
      expect(reopenHints).toBe(0)
      expect(await git("rev-parse", "refs/heads/master")).toBe(head)
      const evidence = {
        root,
        executable,
        retained: prior.retained,
        rawHash: prior.rawHash,
        result,
        launches,
        census,
        turnStarts,
        reopenHints,
        providerRequests
      }
      await writeFile(
        nodeProcess.env["DALPH_INTERRUPTED_EVIDENCE"] ?? "/tmp/dalph-interrupted-native.json",
        JSON.stringify(evidence, null, 2)
      )
    } finally {
      await second.runPromise(Effect.flatMap(CodexAppServer, (app) => app.close))
      await second.dispose()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
    const stopped = []
    for (const launch of launches) {
      const projection = await Effect.runPromise(makeNodeCodexProcessGroupCensusService().observe(launch))
      expect(projection._tag).toBe("Absent")
      stopped.push({ launch, projection })
    }
    await writeFile(
      `${nodeProcess.env["DALPH_INTERRUPTED_EVIDENCE"] ?? "/tmp/dalph-interrupted-native.json"}.stopped.json`,
      JSON.stringify(stopped, null, 2)
    )
  },
  120000
)
