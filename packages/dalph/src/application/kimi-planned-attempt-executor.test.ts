import { it } from "@effect/vitest"
import {
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorLifecycleObservation,
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
import { Crypto, Deferred, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { expect } from "vitest"
import { TestClock } from "effect/testing"
import {
  KimiAcpCapabilities,
  KimiAcpFailure,
  KimiAcpSessionId,
  KimiAcpSessionObservation,
  controlledKimiAcpClientLayer
} from "./kimi-acp.js"
import type { KimiAcpClientService as KimiAcpClientServiceType } from "./kimi-acp.js"
import { kimiPlannedAttemptExecutorLayer } from "./kimi-planned-attempt-executor.js"
import {
  KimiAttemptPrivateRecord,
  memoryKimiAttemptPrivateStoreLayer,
  type KimiAttemptPrivatePhase
} from "./kimi-attempt-store.js"
import { plannedAttemptExecutorContract } from "../../../orchestrator/test/contracts/planned-attempt-executor-contract.js"
import { ProviderResultCycle } from "./provider-result-correction.js"

const sessionId = KimiAcpSessionId.make("kimi-session-1")
const cwd = "/worktrees/kimi"

const expectedSemanticPrompt =
  'Implement Kimi boundary\n\nAccepted results must be the final JSON object {"version":1,"outcome":"Accepted","commit":"<40-hex>"}. Dalph binds its own identities; do not include correlation identifiers.'

const makeService = () => {
  let observedCwd = cwd
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
        observedCwd = worktree
        calls.push(`session/new:${worktree}`)
        status = "idle"
        lastMessage = undefined
        return sessionId
      }),
    loadSession: (restored, worktree) =>
      Effect.sync(() => {
        observedCwd = worktree
        calls.push(`session/load:${restored}:${worktree}`)
        status = "idle"
        lastMessage = undefined
        return restored
      }),
    resumeSession: (restored, worktree) =>
      Effect.sync(() => {
        observedCwd = worktree
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
          cwd: observedCwd,
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
    },
    setStatus: (next: KimiAcpSessionObservation["status"]) => {
      status = next
    }
  }
}

const makeRequest = (label = "kimi") => {
  const specification = makeTaskWorkSpecification({
    body: "Implement Kimi boundary",
    taskId: TaskId.make(`${label}-task`),
    title: "Kimi task"
  })
  const attempt = PlannedTaskAttempt.make({
    attemptId: AttemptId.make(`attempt:${label}:0`),
    baseSha: GitCommitSha.make("1".repeat(40)),
    branch: TaskBranchRef.make("refs/heads/dalph/kimi"),
    executor: TaskExecutorLocator.make("executor:kimi/for-coding"),
    runId: RunId.make(`run:${label}`),
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

const makePrivateRecord = (
  attempt: ReturnType<typeof makeRequest>["attempt"],
  phase: KimiAttemptPrivatePhase,
  sessionClosed = false,
  terminal?: PlannedAttemptExecutorResult
): KimiAttemptPrivateRecord =>
  KimiAttemptPrivateRecord.make({
    attemptId: attempt.attemptId,
    baseSha: attempt.baseSha,
    executor: attempt.executor,
    phase,
    runId: attempt.runId,
    sessionId,
    worktree: attempt.worktree,
    sessionClosed,
    ...(terminal === undefined ? {} : { terminal })
  })

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

const makeAcceptanceBoundaries = (
  head: GitCommitSha,
  evidenceDigest: EvidenceDigest,
  gitResult: { readonly exitCode: number; readonly stderr: string; readonly stdout: string } = {
    exitCode: 0,
    stderr: "",
    stdout: `${head}\n`
  },
  rereadBytes?: Uint8Array
) => {
  let evidenceBytes = new Uint8Array()
  let evidencePutCalls = 0
  let evidenceReadCalls = 0
  let digestCalls = 0
  const digestInputBytes: Array<Uint8Array> = []
  const digestBytes = new Uint8Array(32)
  let identityAllocations = 0
  const crypto = Crypto.make({
    digest: (_algorithm, bytes) =>
      Effect.sync(() => {
        digestCalls += 1
        digestInputBytes.push(bytes.slice())
        return digestBytes.slice()
      }),
    randomBytes: (size) => new Uint8Array(size).fill(++identityAllocations)
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
        return (rereadBytes ?? evidenceBytes).slice()
      })
  })
  const gitCalls: Array<ReadonlyArray<string>> = []
  const git: GitCommandService = {
    run: () => Effect.succeed({ exitCode: 0, stderr: "", stdout: "" }),
    runInWorktree: (_worktree, args) =>
      Effect.sync(() => {
        gitCalls.push([...args])
        return gitResult
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
      `prompt:${sessionId}:${expectedSemanticPrompt}`
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
      `prompt:${sessionId}:${expectedSemanticPrompt}`,
      `session/cancel:${sessionId}`,
      `session/resume:${sessionId}:${cwd}`,
      `prompt:${sessionId}:${expectedSemanticPrompt}`
    ])
  }).pipe(Effect.provide(testLayer(controlled.service)))
})

it.effect("reconciles a failed resume boundary back to safe suspension", () => {
  const controlled = makeService()
  const resumeFailure: KimiAcpClientServiceType = {
    ...controlled.service,
    resumeSession: () =>
      Effect.fail(new KimiAcpFailure({ detail: "Kimi resume failed", kind: "Provider", operation: "session/resume" }))
  }
  const { correlation, request } = makeRequest("resume-failure")
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request, { _tag: "InitialDelivery" })
    yield* executor.requestSuspension(request.plannedAttempt)
    const error = yield* executor.resume(request).pipe(Effect.flip)
    expect(error).toMatchObject({ command: "Resume", correlation, detail: "Kimi resume failed" })
    expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
      })
    )
  }).pipe(Effect.provide(testLayer(resumeFailure)))
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

it.effect("replays a retained session-created record before crossing the prompt boundary", () => {
  const controlled = makeService()
  const { correlation, request } = makeRequest("retained-session")
  const retained = makePrivateRecord(request.plannedAttempt, "SessionCreated")
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect(yield* executor.begin(request, { _tag: "InitialDelivery" })).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    )
    expect(controlled.calls).toEqual([
      `session/load:${sessionId}:${cwd}`,
      `prompt:${sessionId}:${expectedSemanticPrompt}`
    ])
  }).pipe(Effect.provide(testLayerWithPrivateStore(controlled.service, [retained])))
})

it.effect("reports an unavailable retained provider session as a typed begin failure", () => {
  const controlled = makeService()
  controlled.setStatus("unavailable")
  const { correlation, request } = makeRequest("unavailable-session")
  const retained = makePrivateRecord(request.plannedAttempt, "Unavailable")
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const error = yield* executor.begin(request, { _tag: "InitialDelivery" }).pipe(Effect.flip)
    expect(error).toMatchObject({ command: "Begin", correlation, detail: "TemporarilyUnavailable" })
    expect(controlled.calls).toEqual([])
  }).pipe(Effect.provide(testLayerWithPrivateStore(controlled.service, [retained])))
})

it.effect("projects a retained session-created record as unreadable when no prompt crossed ACP", () => {
  const controlled = makeService()
  const { correlation, request } = makeRequest("unprompted-session")
  const retained = makePrivateRecord(request.plannedAttempt, "SessionCreated")
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
      PlannedAttemptExecutorProjection.cases.Unreadable.make({
        correlation,
        detail: "Kimi session has no recorded prompt"
      })
    )
    expect(controlled.calls).toEqual([`session/load:${sessionId}:${cwd}`])
  }).pipe(Effect.provide(testLayerWithPrivateStore(controlled.service, [retained])))
})

it.effect("returns the retained executing projection when Begin is redelivered", () => {
  const controlled = makeService()
  const { correlation, request } = makeRequest("executing-redelivery")
  const retained = makePrivateRecord(request.plannedAttempt, "Executing")
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect(yield* executor.begin(request, { _tag: "InitialDelivery" })).toEqual(
      PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
    )
    expect(controlled.calls).toEqual([`session/load:${sessionId}:${cwd}`])
  }).pipe(Effect.provide(testLayerWithPrivateStore(controlled.service, [retained])))
})

it.effect("reconstructs a suspended Kimi session without sending a prompt", () => {
  const controlled = makeService()
  const { correlation, request } = makeRequest("suspended-restart")
  const retained = makePrivateRecord(request.plannedAttempt, "Suspended")
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkSafelySuspended.make({ correlation })
      })
    )
    expect(controlled.calls).toEqual([`session/load:${sessionId}:${cwd}`])
  }).pipe(Effect.provide(testLayerWithPrivateStore(controlled.service, [retained])))
})

it.effect("retains the original result-cycle intent when a restored Kimi session publishes executing progress", () => {
  const controlled = makeService()
  const { correlation, request } = makeRequest("result-cycle-restart")
  const writes: Array<KimiAttemptPrivateRecord> = []
  return Effect.gen(function* () {
    const resultCycle = yield* Schema.decodeUnknownEffect(ProviderResultCycle)({
      cycleId: "cycle:kimi-progress",
      responses: [
        {
          _tag: "RequestIntended",
          intent: { _tag: "Initial", ordinal: 1, token: "result:kimi-progress", intendedAt: 1_000 }
        }
      ]
    })
    const retained = KimiAttemptPrivateRecord.make({
      ...makePrivateRecord(request.plannedAttempt, "Executing"),
      resultCycle
    })
    yield* Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    }).pipe(
      Effect.provide(
        testLayerWithPrivateStore(
          {
            ...controlled.service,
            loadSession: (id, worktree) =>
              controlled.service
                .loadSession(id, worktree)
                .pipe(Effect.tap(() => Effect.sync(() => controlled.setStatus("executing"))))
          },
          [retained],
          (record) => writes.push(record)
        )
      )
    )
    expect(writes.at(-1)?.resultCycle).toEqual(resultCycle)
    expect(controlled.calls).toEqual([`session/load:${sessionId}:${cwd}`])
  })
})

it.effect("completes a sealed terminal record with no retained result without reopening its session", () => {
  const controlled = makeService()
  controlled.setStatus("terminal")
  const { correlation, request } = makeRequest("sealed-without-result")
  const retained = makePrivateRecord(request.plannedAttempt, "Terminal", true)
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
          correlation,
          result: PlannedAttemptExecutorResult.cases.Completed.make({})
        })
      })
    )
    expect(controlled.calls).toEqual([])
  }).pipe(Effect.provide(testLayerWithPrivateStore(controlled.service, [retained])))
})

it.effect("completes a terminal provider observation with no message at the planned base", () => {
  const controlled = makeService()
  const { correlation, request } = makeRequest("terminal-without-message")
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request, { _tag: "InitialDelivery" })
    controlled.setStatus("terminal")
    expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
      PlannedAttemptExecutorProjection.cases.Exact.make({
        report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
          correlation,
          result: PlannedAttemptExecutorResult.cases.Completed.make({})
        })
      })
    )
  }).pipe(Effect.provide(testLayer(controlled.service)))
})

it.effect("rejects retained state bound to another worktree before loading the Kimi session", () => {
  const controlled = makeService()
  const { correlation, request } = makeRequest("mismatched-session")
  const retained = KimiAttemptPrivateRecord.make({
    ...makePrivateRecord(request.plannedAttempt, "Executing"),
    worktree: WorktreeLocator.make("/worktrees/another-attempt")
  })
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    const error = yield* executor.begin(request, { _tag: "InitialDelivery" }).pipe(Effect.flip)
    expect(error).toMatchObject({
      command: "Begin",
      correlation,
      detail: "Kimi private session is bound to a different attempt"
    })
    expect(controlled.calls).toEqual([])
  }).pipe(Effect.provide(testLayerWithPrivateStore(controlled.service, [retained])))
})

it.effect("refuses changed planned Base on retained and in-memory Begin before provider effects", () =>
  Effect.forEach(
    [false, true],
    (inMemory) => {
      const controlled = makeService()
      const { correlation, request } = makeRequest(`changed-base-${inMemory}`)
      const changed = PlannedAttemptExecutorRequest.make({
        ...request,
        plannedAttempt: PlannedTaskAttempt.make({
          ...request.plannedAttempt,
          baseSha: GitCommitSha.make("b".repeat(40))
        })
      })
      return Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        if (inMemory) yield* executor.begin(request, { _tag: "InitialDelivery" })
        const before = [...controlled.calls]
        expect(yield* executor.begin(changed, { _tag: "InitialDelivery" }).pipe(Effect.flip)).toMatchObject({
          command: "Begin",
          correlation,
          detail: "Kimi private session is bound to a different attempt"
        })
        expect(controlled.calls).toEqual(before)
      }).pipe(
        Effect.provide(
          testLayerWithPrivateStore(
            controlled.service,
            inMemory ? [] : [makePrivateRecord(request.plannedAttempt, "Executing")]
          )
        )
      )
    },
    { discard: true }
  )
)

it.effect("reports no state and maps unknown and provider-failed command boundaries", () => {
  const controlled = makeService()
  const { attempt, correlation, request } = makeRequest("unknown-session")
  const initializeFailure: KimiAcpClientServiceType = {
    ...controlled.service,
    initialize: () =>
      Effect.fail(
        new KimiAcpFailure({ detail: "Kimi executable is unavailable", kind: "Unavailable", operation: "initialize" })
      )
  }
  return Effect.gen(function* () {
    yield* Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
        PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation })
      )
      const suspensionError = yield* executor.requestSuspension(attempt).pipe(Effect.flip)
      expect(suspensionError).toMatchObject({ command: "Suspend", correlation, detail: "Kimi session is unknown" })
      const resumeError = yield* executor.resume(request).pipe(Effect.flip)
      expect(resumeError).toMatchObject({ command: "Resume", correlation, detail: "Kimi session is unknown" })
    }).pipe(Effect.provide(testLayer(controlled.service)))

    yield* Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      const beginError = yield* executor.begin(request, { _tag: "InitialDelivery" }).pipe(Effect.flip)
      expect(beginError).toMatchObject({ command: "Begin", correlation, detail: "Kimi executable is unavailable" })
    }).pipe(Effect.provide(testLayer(initializeFailure)))
  })
})

it.effect("distinguishes legacy prose completion from invalid terminal candidates", () => {
  const markers: ReadonlyArray<{
    readonly label: string
    readonly message: (correlation: ReturnType<typeof plannedAttemptExecutorCorrelation>) => string
  }> = [
    { label: "syntax", message: () => "not-json" },
    { label: "malformed-json", message: () => '{"version":1,' },
    { label: "non-record", message: () => "null" },
    { label: "missing-correlation", message: () => JSON.stringify({ commit: "a".repeat(40) }) },
    {
      label: "foreign-correlation",
      message: () =>
        JSON.stringify({
          correlation: { runId: "run:foreign", attemptId: "attempt:foreign:0" },
          commit: "a".repeat(40)
        })
    },
    { label: "invalid-commit", message: (correlation) => JSON.stringify({ correlation, commit: "not-a-commit" }) }
  ]
  return Effect.gen(function* () {
    yield* Effect.forEach(
      markers,
      ({ label, message }) => {
        const controlled = makeService()
        const { attempt, correlation, request } = makeRequest(`marker-${label}`)
        const boundaries = makeAcceptanceBoundaries(attempt.baseSha, acceptedDigest)
        return Effect.gen(function* () {
          const executor = yield* PlannedAttemptExecutor
          yield* executor.begin(request, { _tag: "InitialDelivery" })
          controlled.complete(message(correlation))
          expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
            PlannedAttemptExecutorProjection.cases.Exact.make({
              report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                correlation,
                result:
                  label === "syntax"
                    ? PlannedAttemptExecutorResult.cases.Completed.make({})
                    : PlannedAttemptExecutorResult.cases.Failed.make({ failureCode: "ResultEnvelopeInvalid" })
              })
            })
          )
          expect(boundaries.evidencePutCalls()).toBe(0)
        }).pipe(Effect.provide(acceptanceTestLayer(controlled.service, boundaries)))
      },
      { discard: true }
    )
  })
})

it.effect("fails closed when Git cannot prove the terminal head or reread evidence bytes", () => {
  const gitResults: ReadonlyArray<{
    readonly label: string
    readonly result: { readonly exitCode: number; readonly stderr: string; readonly stdout: string }
  }> = [
    { label: "exit", result: { exitCode: 1, stderr: "missing HEAD", stdout: "" } },
    { label: "malformed", result: { exitCode: 0, stderr: "", stdout: "not-a-commit\n" } }
  ]
  return Effect.gen(function* () {
    yield* Effect.forEach(
      gitResults,
      ({ label, result }) => {
        const controlled = makeService()
        const { attempt, correlation, request } = makeRequest(`git-${label}`)
        const boundaries = makeAcceptanceBoundaries(attempt.baseSha, acceptedDigest, result)
        return Effect.gen(function* () {
          const executor = yield* PlannedAttemptExecutor
          yield* executor.begin(request, { _tag: "InitialDelivery" })
          controlled.complete("Kimi finished without a provider commit")
          expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
            PlannedAttemptExecutorProjection.cases.Exact.make({
              report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
                correlation,
                result: PlannedAttemptExecutorResult.cases.Failed.make({ failureCode: "GitUnavailable" })
              })
            })
          )
          expect(boundaries.evidencePutCalls()).toBe(0)
        }).pipe(Effect.provide(acceptanceTestLayer(controlled.service, boundaries)))
      },
      { discard: true }
    )

    const controlled = makeService()
    const { attempt, correlation, request } = makeRequest("evidence-bytes")
    const boundaries = makeAcceptanceBoundaries(
      GitCommitSha.make("a".repeat(40)),
      acceptedDigest,
      undefined,
      new TextEncoder().encode("changed evidence")
    )
    yield* Effect.gen(function* () {
      const executor = yield* PlannedAttemptExecutor
      yield* executor.begin(request, { _tag: "InitialDelivery" })
      controlled.complete(terminalMessage(correlation, GitCommitSha.make("a".repeat(40))))
      expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toMatchObject({
        _tag: "Unreadable",
        detail: "Kimi accepted-result evidence could not be verified"
      })
      expect(boundaries.evidencePutCalls()).toBe(1)
      expect(attempt.worktree).toBe(cwd)
    }).pipe(Effect.provide(acceptanceTestLayer(controlled.service, boundaries)))
  })
})

it.effect("maps a terminal close failure to an unreadable passive projection", () => {
  const controlled = makeService()
  const closeFailure: KimiAcpClientServiceType = {
    ...controlled.service,
    closeSession: () =>
      Effect.fail(
        new KimiAcpFailure({ detail: "Kimi session close failed", kind: "Provider", operation: "session/close" })
      )
  }
  const { correlation, request } = makeRequest("close-failure")
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request, { _tag: "InitialDelivery" })
    controlled.complete("Kimi finished without a provider commit")
    expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(
      PlannedAttemptExecutorProjection.cases.Unreadable.make({ correlation, detail: "Kimi session close failed" })
    )
  }).pipe(Effect.provide(testLayer(closeFailure)))
})

it.effect("attaches current-first lifecycle observations and publishes one terminal change", () => {
  const controlled = makeService()
  return Effect.scoped(
    Effect.gen(function* () {
      const { correlation, request } = makeRequest("lifecycle")
      const lifecycle = yield* PlannedAttemptExecutorLifecycleObservation
      const empty = yield* lifecycle.attach(correlation)
      expect(empty.current).toEqual(PlannedAttemptExecutorProjection.cases.NoReport.make({ correlation }))
      expect(yield* Stream.runCollect(empty.changes)).toEqual([])
      yield* empty.close

      const executor = yield* PlannedAttemptExecutor
      yield* executor.begin(request, { _tag: "InitialDelivery" })
      const attachment = yield* lifecycle.attach(correlation)
      expect(attachment.current).toEqual(
        PlannedAttemptExecutorProjection.cases.Exact.make({
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkExecuting.make({ correlation })
        })
      )
      controlled.complete("Kimi finished without a provider commit")
      expect(yield* Stream.runCollect(attachment.changes)).toEqual([
        PlannedAttemptExecutorProjection.cases.Exact.make({
          report: PlannedAttemptExecutorReport.cases.ExecutorWorkTerminal.make({
            correlation,
            result: PlannedAttemptExecutorResult.cases.Completed.make({})
          })
        })
      ])
      yield* attachment.close
    }).pipe(Effect.provide(testLayer(controlled.service)))
  )
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
    expect(boundaries.gitCalls).toEqual([
      ["rev-parse", "HEAD"],
      ["merge-base", "--is-ancestor", request.plannedAttempt.baseSha, head],
      ["rev-parse", "HEAD"]
    ])
    expect(boundaries.evidencePutCalls()).toBe(1)
    expect(boundaries.evidenceReadCalls()).toBe(1)
    expect(boundaries.digestCalls()).toBe(1)
    expect(boundaries.digestInputBytes).toHaveLength(1)
    expect(controlled.calls).toEqual([
      `initialize:${cwd}`,
      `session/new:${cwd}`,
      `prompt:${sessionId}:${expectedSemanticPrompt}`,
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

it.effect("binds an owned Kimi semantic candidate without copied identities", () => {
  const controlled = makeService()
  const { correlation, request } = makeRequest("opaque-".repeat(160))
  const head = GitCommitSha.make("a".repeat(40))
  const boundaries = makeAcceptanceBoundaries(head, acceptedDigest)
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request, { _tag: "InitialDelivery" })
    controlled.complete(JSON.stringify({ version: 1, outcome: "Accepted", commit: head }))
    const accepted = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
    expect(accepted).toMatchObject({
      _tag: "Exact",
      report: { correlation, result: { _tag: "Accepted", acceptedResult: { commit: head } } }
    })
    expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(accepted)
    expect(controlled.calls.find((call) => call.startsWith("prompt:"))).not.toContain(correlation.runId)
    expect(controlled.calls.find((call) => call.startsWith("prompt:"))).not.toContain(correlation.attemptId)
    expect(controlled.calls.filter((call) => call.startsWith("prompt:"))).toHaveLength(1)
    expect(boundaries.evidencePutCalls()).toBe(1)
  }).pipe(Effect.provide(acceptanceTestLayer(controlled.service, boundaries)))
})

it.effect("refuses a retained Kimi session when load returns another identity", () => {
  const controlled = makeService()
  const { correlation, request } = makeRequest("foreign-load")
  const retained = makePrivateRecord(request.plannedAttempt, "SessionCreated")
  const service: KimiAcpClientServiceType = {
    ...controlled.service,
    loadSession: (id, cwd) => controlled.service.loadSession(id, cwd).pipe(Effect.as(KimiAcpSessionId.make("foreign")))
  }
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    expect(yield* executor.begin(request, { _tag: "InitialDelivery" }).pipe(Effect.exit)).toMatchObject({
      _tag: "Failure"
    })
    expect(controlled.calls.some((call) => call.startsWith("prompt:"))).toBe(false)
    expect(controlled.calls.some((call) => call.startsWith("session/new:"))).toBe(false)
    expect(correlation.runId).toBe(request.plannedAttempt.runId)
  }).pipe(Effect.provide(testLayerWithPrivateStore(service, [retained])))
})

it.effect("rejects semantic results from another Kimi session or worktree", () =>
  Effect.forEach(
    ["Session", "Worktree"] as const,
    (foreign) => {
      const controlled = makeService()
      const { attempt, correlation, request } = makeRequest()
      const boundaries = makeAcceptanceBoundaries(attempt.baseSha, acceptedDigest)
      const service: KimiAcpClientServiceType = {
        ...controlled.service,
        observe: (id) =>
          controlled.service
            .observe(id)
            .pipe(
              Effect.map((observation) => ({
                ...observation,
                ...(foreign === "Session"
                  ? { sessionId: KimiAcpSessionId.make("foreign-session") }
                  : { cwd: "/foreign" })
              }))
            )
      }
      return Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request, { _tag: "InitialDelivery" })
        controlled.complete(JSON.stringify({ version: 1, outcome: "Accepted", commit: "a".repeat(40) }))
        expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toMatchObject({
          _tag: "Unreadable"
        })
        expect(boundaries.evidencePutCalls()).toBe(0)
        expect(boundaries.gitCalls).toEqual([])
        expect(controlled.calls.some((call) => call.startsWith("session/close:"))).toBe(false)
      }).pipe(Effect.provide(acceptanceTestLayer(service, boundaries)))
    },
    { discard: true }
  )
)

it.effect("rejects a Kimi semantic candidate when Git cannot prove Base ancestry", () =>
  Effect.forEach(
    [1, 128],
    (exitCode) => {
      const controlled = makeService()
      const { correlation, request } = makeRequest()
      const head = GitCommitSha.make("a".repeat(40))
      const boundaries = makeAcceptanceBoundaries(head, acceptedDigest)
      const git: GitCommandService = {
        ...boundaries.git,
        runInWorktree: (cwd, args) =>
          args[0] === "merge-base"
            ? Effect.succeed({ exitCode, stderr: "lineage unavailable", stdout: "" })
            : boundaries.git.runInWorktree(cwd, args)
      }
      return Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request, { _tag: "InitialDelivery" })
        controlled.complete(JSON.stringify({ version: 1, outcome: "Accepted", commit: head }))
        if (exitCode === 1) {
          expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toMatchObject({
            _tag: "Exact",
            report: { correlation, result: { _tag: "Failed", failureCode: "LineageUnproven" } }
          })
        } else {
          expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toMatchObject({
            _tag: "Unreadable",
            detail: "Kimi result authority unavailable at Lineage"
          })
          expect(controlled.calls.some((call) => call.startsWith("session/close:"))).toBe(false)
        }
        expect(boundaries.evidencePutCalls()).toBe(0)
      }).pipe(Effect.provide(acceptanceTestLayer(controlled.service, { ...boundaries, git })))
    },
    { discard: true }
  )
)

it.effect("rejects invalid semantic results without a HEAD fallback", () =>
  Effect.forEach(
    [
      { version: 1, outcome: "Accepted", commit: "not-a-commit" },
      { version: 1, outcome: "Accepted" },
      { version: 2, outcome: "Accepted", commit: "a".repeat(40) },
      {
        version: 1,
        outcome: "Accepted",
        commit: "a".repeat(40),
        correlation: { runId: "foreign", attemptId: "foreign" }
      },
      { commit: "a".repeat(40), correlation: { runId: "foreign", attemptId: "foreign" } }
    ].flatMap((payload) => [true, false].map((unchanged) => ({ payload, unchanged }))),
    ({ payload, unchanged }) => {
      const controlled = makeService()
      const { attempt, correlation, request } = makeRequest()
      const boundaries = makeAcceptanceBoundaries(
        unchanged ? attempt.baseSha : GitCommitSha.make("a".repeat(40)),
        acceptedDigest
      )
      return Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request, { _tag: "InitialDelivery" })
        controlled.complete(JSON.stringify(payload))
        expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toMatchObject({
          _tag: "Exact",
          report: {
            _tag: "ExecutorWorkTerminal",
            correlation,
            result: { _tag: "Failed", failureCode: "ResultEnvelopeInvalid" }
          }
        })
        expect(boundaries.evidencePutCalls()).toBe(0)
      }).pipe(Effect.provide(acceptanceTestLayer(controlled.service, boundaries)))
    },
    { discard: true }
  )
)

it.effect("refuses implicit HEAD acceptance when Kimi omits a semantic candidate", () => {
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
      report: { _tag: "ExecutorWorkTerminal", result: { _tag: "Failed" } }
    })
    expect(boundaries.gitCalls).toEqual([["rev-parse", "HEAD"]])
    expect(boundaries.evidencePutCalls()).toBe(0)
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
          result: { _tag: "Failed", failureCode: "CandidateHeadMismatch", observedHead: head }
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
    expect(boundaries.gitCalls).toEqual([
      ["rev-parse", "HEAD"],
      ["merge-base", "--is-ancestor", request.plannedAttempt.baseSha, head]
    ])
    expect(boundaries.evidencePutCalls()).toBe(1)
    expect(boundaries.evidenceReadCalls()).toBe(1)
    expect(boundaries.digestCalls()).toBe(1)
  }).pipe(Effect.provide(acceptanceTestLayer(controlled.service, boundaries)))
})

it.effect("refuses to seal Kimi acceptance when HEAD changes during evidence readback", () => {
  const controlled = makeService()
  const { correlation, request } = makeRequest("head-changed-during-readback")
  const head = GitCommitSha.make("a".repeat(40))
  const boundaries = makeAcceptanceBoundaries(head, acceptedDigest)
  let reads = 0
  const git: GitCommandService = {
    ...boundaries.git,
    runInWorktree: (worktree, args) =>
      args[0] === "rev-parse"
        ? Effect.sync(() => ({ exitCode: 0, stderr: "", stdout: `${++reads === 1 ? head : "b".repeat(40)}\n` }))
        : boundaries.git.runInWorktree(worktree, args)
  }
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request, { _tag: "InitialDelivery" })
    controlled.complete(JSON.stringify({ version: 1, outcome: "Accepted", commit: head }))
    expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toMatchObject({
      _tag: "Unreadable",
      detail: "Kimi result authority unavailable at Head"
    })
    expect(reads).toBe(2)
    expect(boundaries.evidenceReadCalls()).toBe(1)
    expect(controlled.calls.some((call) => call.startsWith("session/close:"))).toBe(false)
  }).pipe(Effect.provide(acceptanceTestLayer(controlled.service, { ...boundaries, git })))
})

it.effect(
  "records Kimi prompt identity before sending and refuses terminal notification after a lost acknowledgement",
  () =>
    Effect.forEach(
      [false, true],
      (lostAck) => {
        const controlled = makeService()
        const { correlation, request } = makeRequest(`durable-prompt-${lostAck}`)
        const head = GitCommitSha.make("a".repeat(40))
        const boundaries = makeAcceptanceBoundaries(head, acceptedDigest)
        let retained: KimiAttemptPrivateRecord | undefined
        let prompts = 0
        const service: KimiAcpClientServiceType = {
          ...controlled.service,
          prompt: (session, text, token) =>
            Effect.gen(function* () {
              prompts += 1
              expect(retained?.phase).toBe("PromptIntentRecorded")
              expect(retained?.promptRequests).toMatchObject([{ token, response: "Pending" }])
              expect(retained?.kimiResultCycle).toMatchObject({
                cycleId: token,
                plannedBaseSha: request.plannedAttempt.baseSha,
                responses: [{ _tag: "RequestIntended", intent: { _tag: "Initial", ordinal: 1, token } }]
              })
              expect(token).toBeDefined()
              yield* controlled.service.prompt(session, text, token)
              if (lostAck) {
                controlled.complete(JSON.stringify({ version: 1, outcome: "Accepted", commit: head }))
                return yield* new KimiAcpFailure({
                  operation: "session/prompt",
                  kind: "Unavailable",
                  detail: "lost prompt acknowledgement"
                })
              }
            })
        }
        return Effect.gen(function* () {
          const executor = yield* PlannedAttemptExecutor
          if (lostAck) {
            expect((yield* executor.begin(request, { _tag: "InitialDelivery" }).pipe(Effect.result))._tag).toBe(
              "Failure"
            )
            expect(retained?.promptRequests?.[0]?.response).toBe("Pending")
            expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toMatchObject({
              _tag: "Unreadable",
              detail: "Kimi prompt acknowledgement is unproven; retained request cannot be resent"
            })
            expect((yield* executor.begin(request, { _tag: "InitialDelivery" }).pipe(Effect.result))._tag).toBe(
              "Failure"
            )
            expect(retained?.terminal).toBeUndefined()
            expect(retained?.kimiResultCycle?.responses).toHaveLength(1)
            expect(retained?.kimiResultCycle?.responses[0]?._tag).toBe("RequestIntended")
            expect(boundaries.gitCalls).toEqual([])
            expect(boundaries.evidencePutCalls()).toBe(0)
          } else {
            yield* executor.begin(request, { _tag: "InitialDelivery" })
            expect(retained?.promptRequests?.[0]?.response).toBe("Observed")
            expect(retained?.phase).toBe("Executing")
            expect(retained?.kimiResultCycle?.responses).toHaveLength(1)
            expect(retained?.kimiResultCycle?.responses[0]?._tag).toBe("PromptAcknowledged")
            yield* executor.begin(request, { _tag: "InitialDelivery" })
          }
          expect(prompts).toBe(1)
        }).pipe(
          Effect.provide(
            acceptanceTestLayer(service, boundaries).pipe(
              Layer.provide(
                memoryKimiAttemptPrivateStoreLayer([], (record) => {
                  retained = record
                })
              )
            )
          )
        )
      },
      { discard: true }
    )
)

it.effect("retains an owned Kimi response when Git is unavailable without a correction or terminal seal", () => {
  const controlled = makeService()
  const { correlation, request } = makeRequest("owned-unavailable-head")
  const boundaries = makeAcceptanceBoundaries(request.plannedAttempt.baseSha, acceptedDigest, {
    exitCode: 128,
    stderr: "repository unavailable",
    stdout: ""
  })
  let retained: KimiAttemptPrivateRecord | undefined
  return Effect.gen(function* () {
    const executor = yield* PlannedAttemptExecutor
    yield* executor.begin(request, { _tag: "InitialDelivery" })
    controlled.complete("Finished the work.")
    const before = retained?.kimiResultCycle
    for (const _observation of [1, 2]) {
      expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toMatchObject({
        _tag: "Unreadable",
        detail: "Kimi result authority unavailable at Head"
      })
    }
    expect(retained?.kimiResultCycle).toEqual(before)
    expect(retained?.terminal).toBeUndefined()
    expect(retained?.resultRejection).toBeUndefined()
    expect(controlled.calls.filter((call) => call.startsWith("prompt:"))).toHaveLength(1)
    expect(controlled.calls.some((call) => call.startsWith("session/close:"))).toBe(false)
    expect(boundaries.evidencePutCalls()).toBe(0)
  }).pipe(
    Effect.provide(
      acceptanceTestLayer(controlled.service, boundaries).pipe(
        Layer.provide(
          memoryKimiAttemptPrivateStoreLayer([], (record) => {
            retained = record
          })
        )
      )
    )
  )
})

it.effect(
  "corrects owned Kimi answers with a retained three-response budget and exposes unresolved custody on exhaustion",
  () =>
    Effect.forEach(
      [false, true],
      (exhausted) => {
        const controlled = makeService()
        const { correlation, request } = makeRequest(`corrections-${exhausted}`)
        const head = GitCommitSha.make("a".repeat(40))
        const boundaries = makeAcceptanceBoundaries(head, acceptedDigest)
        let retained: KimiAttemptPrivateRecord | undefined
        let prompts = 0
        let stops = 0
        const promptTokens = new Set<string>()
        const service: KimiAcpClientServiceType = {
          ...controlled.service,
          prompt: (session, text, token) =>
            Effect.gen(function* () {
              prompts += 1
              expect(retained?.phase).toBe("PromptIntentRecorded")
              expect(retained?.kimiResultCycle?.responses).toHaveLength(prompts)
              expect(retained?.kimiResultCycle?.responses[prompts - 1]).toMatchObject({
                _tag: "RequestIntended",
                intent: { token, ordinal: prompts }
              })
              if (token !== undefined) promptTokens.add(token)
              if (prompts > 1) {
                expect(text).toContain("ResultEnvelopeInvalid")
                expect(text).toContain("full access")
                const allowance = retained?.kimiResultCycle?.responses[prompts - 1]?.intent
                expect(allowance).toMatchObject({ _tag: "Correction" })
                if (allowance?._tag === "Correction") expect(allowance.deadline - allowance.intendedAt).toBe(30_000)
              }
              yield* controlled.service.prompt(session, text, token)
              controlled.complete(
                !exhausted && prompts > 1
                  ? JSON.stringify({ version: 1, outcome: "Accepted", commit: head })
                  : "{invalid}"
              )
            }),
          cancel: (session) =>
            Effect.gen(function* () {
              expect(retained?.phase).toBe("ResultStopIntended")
              expect(retained?.terminal).toBeUndefined()
              stops += 1
              yield* controlled.service.cancel(session)
            }),
          closeSession: (session) =>
            Effect.gen(function* () {
              if (exhausted) expect(retained?.phase).toBe("ResultStopIntended")
              yield* controlled.service.closeSession(session)
            })
        }
        return Effect.gen(function* () {
          const executor = yield* PlannedAttemptExecutor
          yield* executor.begin(request, { _tag: "InitialDelivery" })
          expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toMatchObject({
            _tag: "Exact",
            report: { _tag: "ExecutorWorkExecuting" }
          })
          if (exhausted) {
            yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
            const rejected = yield* executor.observe(correlation, passiveLifecycleObservationPurpose)
            expect(rejected).toMatchObject({
              _tag: "Exact",
              report: {
                _tag: "ExecutorWorkResultRejected",
                responseCount: 3,
                recoveryCause: "CorrectionExhausted",
                custody: { _tag: "Unresolved" }
              }
            })
            expect(retained?.phase).toBe("ResultRejected")
            expect(retained?.terminal).toBeUndefined()
            expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(rejected)
            expect((yield* executor.resume(request).pipe(Effect.result))._tag).toBe("Failure")
            expect(prompts).toBe(3)
            expect(stops).toBe(1)
            expect(boundaries.evidencePutCalls()).toBe(0)
          } else {
            expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toMatchObject({
              _tag: "Exact",
              report: { _tag: "ExecutorWorkTerminal", result: { _tag: "Accepted" } }
            })
            expect(prompts).toBe(2)
            expect(stops).toBe(0)
            expect(boundaries.evidenceReadCalls()).toBe(1)
          }
          expect(promptTokens.size).toBe(prompts)
        }).pipe(
          Effect.provide(
            acceptanceTestLayer(service, boundaries).pipe(
              Layer.provide(
                memoryKimiAttemptPrivateStoreLayer([], (record) => {
                  retained = record
                })
              )
            )
          )
        )
      },
      { discard: true }
    )
)

it.effect(
  "expires an unacknowledged Kimi correction at its persisted deadline without resending or accepting a late answer",
  () =>
    Effect.gen(function* () {
      const controlled = makeService()
      const { correlation, request } = makeRequest("correction-deadline")
      const head = GitCommitSha.make("a".repeat(40))
      const boundaries = makeAcceptanceBoundaries(head, acceptedDigest)
      const correctionIntended = yield* Deferred.make<void>()
      let retained: KimiAttemptPrivateRecord | undefined
      let prompts = 0
      let stops = 0
      const service: KimiAcpClientServiceType = {
        ...controlled.service,
        prompt: (session, text, token) =>
          Effect.gen(function* () {
            prompts += 1
            yield* controlled.service.prompt(session, text, token)
            if (prompts === 1) controlled.complete("{invalid}")
            else {
              expect(retained?.kimiResultCycle?.responses).toHaveLength(2)
              yield* Deferred.succeed(correctionIntended, undefined)
              return yield* Effect.never
            }
          }),
        cancel: (session) =>
          Effect.gen(function* () {
            expect(retained?.phase).toBe("ResultStopIntended")
            stops += 1
            yield* controlled.service.cancel(session)
          })
      }
      yield* Effect.gen(function* () {
        const executor = yield* PlannedAttemptExecutor
        yield* executor.begin(request, { _tag: "InitialDelivery" })
        const pending = yield* executor.observe(correlation, passiveLifecycleObservationPurpose).pipe(Effect.forkChild)
        yield* Deferred.await(correctionIntended)
        yield* TestClock.adjust("30 seconds")
        const expired = yield* Fiber.join(pending)
        expect(expired).toMatchObject({
          _tag: "Exact",
          report: {
            _tag: "ExecutorWorkResultRejected",
            responseCount: 2,
            recoveryCause: "Deadline",
            custody: { _tag: "Unresolved" }
          }
        })
        expect(retained?.kimiResultCycle?.responses[1]?._tag).toBe("RequestIntended")
        controlled.complete(JSON.stringify({ version: 1, outcome: "Accepted", commit: head }))
        expect(yield* executor.observe(correlation, passiveLifecycleObservationPurpose)).toEqual(expired)
        expect((yield* executor.resume(request).pipe(Effect.result))._tag).toBe("Failure")
        expect(prompts).toBe(2)
        expect(stops).toBe(1)
        expect(retained?.terminal).toBeUndefined()
        expect(boundaries.evidencePutCalls()).toBe(0)
      }).pipe(
        Effect.provide(
          acceptanceTestLayer(service, boundaries).pipe(
            Layer.provide(
              memoryKimiAttemptPrivateStoreLayer([], (record) => {
                retained = record
              })
            )
          )
        )
      )
    })
)
