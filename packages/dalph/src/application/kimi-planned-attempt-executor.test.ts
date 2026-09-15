import { it } from "@effect/vitest"
import {
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
  PlannedAttemptExecutorResult,
  PlannedAttemptExecutorRequest,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification,
  passiveLifecycleObservationPurpose,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import { EvidenceStore, GitCommand, type GitCommandService } from "@dalph/orchestrator"
import { Crypto, Effect, Layer } from "effect"
import { expect } from "vitest"
import {
  KimiAcpCapabilities,
  KimiAcpSessionId,
  KimiAcpSessionObservation,
  controlledKimiAcpClientLayer
} from "./kimi-acp.js"
import type { KimiAcpClientService as KimiAcpClientServiceType } from "./kimi-acp.js"
import { kimiPlannedAttemptExecutorLayer } from "./kimi-planned-attempt-executor.js"
import { memoryKimiAttemptPrivateStoreLayer, type KimiAttemptPrivateRecord } from "./kimi-attempt-store.js"
import { plannedAttemptExecutorContract } from "../../../orchestrator/test/contracts/planned-attempt-executor-contract.js"

const sessionId = KimiAcpSessionId.make("kimi-session-1")
const cwd = "/worktrees/kimi"

const makeService = () => {
  let status: KimiAcpSessionObservation["status"] = "idle"
  let lastMessage: string | undefined
  const calls: Array<string> = []
  const service: KimiAcpClientServiceType = {
    initialize: (worktree) =>
      Effect.sync(() => {
        calls.push(`initialize:${worktree}`)
        return KimiAcpCapabilities.make({ loadSession: true, resumeSession: true, sessionClose: true })
      }),
    newSession: (worktree) =>
      Effect.sync(() => {
        calls.push(`session/new:${worktree}`)
        status = "idle"
        lastMessage = undefined
        return sessionId
      }),
    loadSession: (restored, worktree) =>
      Effect.sync(() => {
        calls.push(`session/load:${restored}:${worktree}`)
        status = "idle"
        lastMessage = undefined
        return restored
      }),
    resumeSession: (restored, worktree) =>
      Effect.sync(() => {
        calls.push(`session/resume:${restored}:${worktree}`)
        status = "idle"
        lastMessage = undefined
        return restored
      }),
    prompt: (id, text) =>
      Effect.sync(() => {
        calls.push(`prompt:${id}:${text}`)
        status = "executing"
      }),
    observe: (id) =>
      Effect.succeed(
        KimiAcpSessionObservation.make({
          sessionId: id,
          cwd,
          status,
          updateCount: calls.filter((call) => call.startsWith("prompt:")).length,
          permissionDenied: false,
          ...(lastMessage === undefined ? {} : { lastMessage })
        })
      ),
    cancel: (id) =>
      Effect.sync(() => {
        calls.push(`session/cancel:${id}`)
        status = "idle"
      }),
    closeSession: (id) =>
      Effect.sync(() => {
        calls.push(`session/close:${id}`)
      }),
    close: () => Effect.void
  }
  return {
    service,
    calls,
    complete: (message: string) => {
      status = "terminal"
      lastMessage = message
    }
  }
}

const makeRequest = () => {
  const specification = makeTaskWorkSpecification({
    body: "Implement Kimi boundary",
    taskId: TaskId.make("kimi-task"),
    title: "Kimi task"
  })
  const attempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make("attempt:kimi:0"),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/kimi"),
    executor: TaskExecutorLocator.make("executor:kimi/for-coding"),
    runId: RunId.make("run:kimi"),
    taskId: specification.taskId,
    taskRevision: specification.fingerprint,
    worktree: WorktreeLocator.make(cwd)
  })
  return {
    attempt,
    correlation: plannedAttemptExecutorCorrelation(attempt),
    request: PlannedAttemptExecutorRequest.make({ plannedAttempt: attempt, specification })
  }
}

const testLayer = (service: KimiAcpClientServiceType) =>
  kimiPlannedAttemptExecutorLayer.pipe(Layer.provide(controlledKimiAcpClientLayer(service)))

const testLayerWithPrivateStore = (
  service: KimiAcpClientServiceType,
  initial: Parameters<typeof memoryKimiAttemptPrivateStoreLayer>[0] = [],
  observeWrite?: Parameters<typeof memoryKimiAttemptPrivateStoreLayer>[1]
) =>
  kimiPlannedAttemptExecutorLayer.pipe(
    Layer.provide(
      Layer.mergeAll(controlledKimiAcpClientLayer(service), memoryKimiAttemptPrivateStoreLayer(initial, observeWrite))
    )
  )

const acceptedDigest = EvidenceDigest.make("00".repeat(32))
const mismatchedDigest = EvidenceDigest.make("ff".repeat(32))

const makeAcceptanceBoundaries = (head: GitCommitSha, evidenceDigest: EvidenceDigest) => {
  let evidenceBytes = new Uint8Array()
  let evidencePutCalls = 0
  let evidenceReadCalls = 0
  let digestCalls = 0
  const digestInputBytes: Array<Uint8Array> = []
  const digestBytes = new Uint8Array(32)
  const crypto = Crypto.make({
    digest: (_algorithm, bytes) =>
      Effect.sync(() => {
        digestCalls += 1
        digestInputBytes.push(bytes.slice())
        return digestBytes.slice()
      }),
    randomBytes: (size) => new Uint8Array(size)
  })
  const evidence = EvidenceStore.of({
    put: (bytes) =>
      Effect.sync(() => {
        evidencePutCalls += 1
        evidenceBytes = bytes.slice()
        return EvidenceReference.make({ byteLength: bytes.byteLength, digest: evidenceDigest })
      }),
    read: () =>
      Effect.sync(() => {
        evidenceReadCalls += 1
        return evidenceBytes.slice()
      })
  })
  const gitCalls: Array<ReadonlyArray<string>> = []
  const git: GitCommandService = {
    run: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "" }),
    runInWorktree: (_worktree, args) =>
      Effect.sync(() => {
        gitCalls.push([...args])
        return { exitCode: 0, stderr: "", stdout: `${head}\n` }
      }),
    runBytesInWorktree: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: new Uint8Array() })
  }
  return {
    crypto,
    digestCalls: () => digestCalls,
    digestInputBytes,
    evidence,
    evidencePutCalls: () => evidencePutCalls,
    evidenceReadCalls: () => evidenceReadCalls,
    git,
    gitCalls
  }
}

const acceptanceTestLayer = (
  service: KimiAcpClientServiceType,
  boundaries: ReturnType<typeof makeAcceptanceBoundaries>
) =>
  kimiPlannedAttemptExecutorLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        controlledKimiAcpClientLayer(service),
        Layer.succeed(GitCommand, boundaries.git),
        Layer.succeed(EvidenceStore, boundaries.evidence),
        Layer.succeed(Crypto.Crypto, boundaries.crypto)
      )
    )
  )

const terminalMessage = (correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>, commit: GitCommitSha) =>
  JSON.stringify({ correlation, commit })

// The Kimi adapter is required to satisfy the same provider-neutral contract as Codex and dry-run.
const contractComposition = makeService()
plannedAttemptExecutorContract({ layer: testLayer(contractComposition.service), name: "Kimi ACP controlled" })

it.effect("initializes in the exact worktree, creates one session, and sends the authored body", () => {
  const controlled = makeService()
  const { attempt, correlation, request } = makeRequest()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect(yield* executor.begin(request, { _tag: "InitialDelivery" })).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    )
    expect(controlled.calls).toEqual([
      `initialize:${cwd}`,
      `session/new:${cwd}`,
      `prompt:${sessionId}:Implement Kimi boundary`
    ])
    expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      })
    )
    expect(attempt.worktree).toBe(cwd)
  }).pipe(Effect.provide(testLayer(controlled.service)))
})

it.effect("cancels and resumes the same ACP session through the generic command boundary", () => {
  const controlled = makeService()
  const { correlation, request } = makeRequest()
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request, { _tag: "InitialDelivery" })
    expect(yield* executor.requestSuspension(request.plannedAttempt)).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
    )
    expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
      })
    )
    yield* executor.resume(request)
    expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
      })
    )
    expect(controlled.calls).toEqual([
      `initialize:${cwd}`,
      `session/new:${cwd}`,
      `prompt:${sessionId}:Implement Kimi boundary`,
      `session/cancel:${sessionId}`,
      `session/resume:${sessionId}:${cwd}`,
      `prompt:${sessionId}:Implement Kimi boundary`
    ])
  }).pipe(Effect.provide(testLayer(controlled.service)))
})

it.effect("reconnects a persisted executing session after restart without sending another prompt", () => {
  const controlled = makeService()
  const { attempt, correlation, request } = makeRequest()
  const writes: Array<KimiAttemptPrivateRecord> = []
  return Effect.gen(function* () {
    yield* Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      yield* executor.begin(request, { _tag: "InitialDelivery" })
    }).pipe(Effect.provide(testLayerWithPrivateStore(controlled.service, [], (record) => writes.push(record))))
    const retained = writes[writes.length - 1]
    if (retained === undefined) return yield* Effect.die("Kimi private session was not persisted")

    const beforeRestartCalls = controlled.calls.length
    yield* Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
        PlannedAttemptExecutorProjection.cases.Exact.make({
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
        })
      )
    }).pipe(Effect.provide(testLayerWithPrivateStore(controlled.service, [retained])))

    expect(controlled.calls.slice(beforeRestartCalls)).toEqual([`session/load:${sessionId}:${cwd}`])
    expect(attempt.executor).toBe("executor:kimi/for-coding")
  })
})

it.effect("reports Accepted only after the terminal commit matches HEAD and reread evidence digest", () => {
  const controlled = makeService()
  const { correlation, request } = makeRequest()
  const head = GitCommitSha.make("a".repeat(40))
  const boundaries = makeAcceptanceBoundaries(head, acceptedDigest)
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request, { _tag: "InitialDelivery" })
    controlled.complete(terminalMessage(correlation, head))

    const projected = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(projected._tag).toBe("Exact")
    if (projected._tag === "Exact") {
      expect(projected.report._tag).toBe("ExecutorWorkTerminal")
      if (projected.report._tag === "ExecutorWorkTerminal") {
        expect(projected.report.result._tag).toBe("Accepted")
        if (projected.report.result._tag === "Accepted") {
          expect(projected.report.result.acceptedResult.commit).toBe(head)
          expect(projected.report.result.acceptedResult.evidenceManifest.digest).toBe(acceptedDigest)
        }
      }
    }
    expect(boundaries.gitCalls).toEqual([["rev-parse", "HEAD"]])
    expect(boundaries.evidencePutCalls()).toBe(1)
    expect(boundaries.evidenceReadCalls()).toBe(1)
    expect(boundaries.digestCalls()).toBe(1)
    expect(boundaries.digestInputBytes).toHaveLength(1)
    expect(controlled.calls).toEqual([
      `initialize:${cwd}`,
      `session/new:${cwd}`,
      `prompt:${sessionId}:Implement Kimi boundary`,
      `session/close:${sessionId}`
    ])
  }).pipe(Effect.provide(acceptanceTestLayer(controlled.service, boundaries)))
})

it.effect("recovers a sealed terminal result without loading the closed Kimi session", () => {
  const controlled = makeService()
  const { correlation, request } = makeRequest()
  const writes: Array<KimiAttemptPrivateRecord> = []
  return Effect.gen(function* () {
    yield* Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      yield* executor.begin(request, { _tag: "InitialDelivery" })
      controlled.complete("Kimi finished without a provider commit")
      yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    }).pipe(Effect.provide(testLayerWithPrivateStore(controlled.service, [], (record) => writes.push(record))))
    const sealed = writes[writes.length - 1]
    if (sealed === undefined) return yield* Effect.die("Kimi terminal state was not persisted")
    expect(sealed.sessionClosed).toBe(true)
    expect(sealed.terminal).toEqual(PlannedAttemptExecutorResult.cases.Completed.make({}))

    const beforeRestartCalls = controlled.calls.length
    yield* Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
        PlannedAttemptExecutorProjection.cases.Exact.make({
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
            correlation,
            result: PlannedAttemptExecutorResult.cases.Completed.make({})
          })
        })
      )
    }).pipe(Effect.provide(testLayerWithPrivateStore(controlled.service, [sealed])))
    expect(controlled.calls.slice(beforeRestartCalls)).toEqual([])
  })
})

it.effect("seals Accepted from a changed exact worktree when Kimi omits a commit marker", () => {
  const controlled = makeService()
  const { correlation, request } = makeRequest()
  const head = GitCommitSha.make("c".repeat(40))
  const boundaries = makeAcceptanceBoundaries(head, acceptedDigest)
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request, { _tag: "InitialDelivery" })
    controlled.complete("Implemented the task and committed it.")

    const projected = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(projected).toMatchObject({
      _tag: "Exact",
      report: { _tag: "ExecutorWorkTerminal", result: { _tag: "Accepted" } }
    })
    expect(boundaries.gitCalls).toEqual([["rev-parse", "HEAD"]])
    expect(boundaries.evidencePutCalls()).toBe(1)
    expect(controlled.calls).toContain(`session/close:${sessionId}`)
  }).pipe(Effect.provide(acceptanceTestLayer(controlled.service, boundaries)))
})

it.effect("does not report Accepted when the terminal commit differs from Git HEAD", () => {
  const controlled = makeService()
  const { attempt, correlation, request } = makeRequest()
  const providerCommit = GitCommitSha.make("a".repeat(40))
  const head = GitCommitSha.make("b".repeat(40))
  const boundaries = makeAcceptanceBoundaries(head, acceptedDigest)
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request, { _tag: "InitialDelivery" })
    controlled.complete(terminalMessage(correlation, providerCommit))

    expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
          correlation,
          result: { _tag: "Failed" }
        })
      })
    )
    expect(boundaries.gitCalls).toEqual([["rev-parse", "HEAD"]])
    expect(boundaries.evidencePutCalls()).toBe(0)
    expect(boundaries.evidenceReadCalls()).toBe(0)
    expect(boundaries.digestCalls()).toBe(0)
    expect(attempt.worktree).toBe(cwd)
  }).pipe(Effect.provide(acceptanceTestLayer(controlled.service, boundaries)))
})

it.effect("does not report Accepted when reread evidence has a mismatched digest", () => {
  const controlled = makeService()
  const { correlation, request } = makeRequest()
  const head = GitCommitSha.make("a".repeat(40))
  const boundaries = makeAcceptanceBoundaries(head, mismatchedDigest)
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request, { _tag: "InitialDelivery" })
    controlled.complete(terminalMessage(correlation, head))

    const projected = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(projected._tag).toBe("Unreadable")
    expect(boundaries.gitCalls).toEqual([["rev-parse", "HEAD"]])
    expect(boundaries.evidencePutCalls()).toBe(1)
    expect(boundaries.evidenceReadCalls()).toBe(1)
    expect(boundaries.digestCalls()).toBe(1)
  }).pipe(Effect.provide(acceptanceTestLayer(controlled.service, boundaries)))
})
