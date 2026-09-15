import { it } from "@effect/vitest"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  PlannedAttemptExecutorProjection,
  PlannedAttemptExecutorReport,
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
import { Effect, Layer } from "effect"
import { expect } from "vitest"
import {
  KimiAcpCapabilities,
  KimiAcpSessionId,
  KimiAcpSessionObservation,
  controlledKimiAcpClientLayer
} from "./kimi-acp.js"
import type { KimiAcpClientService as KimiAcpClientServiceType } from "./kimi-acp.js"
import { kimiPlannedAttemptExecutorLayer } from "./kimi-planned-attempt-executor.js"
import { plannedAttemptExecutorContract } from "../../../orchestrator/test/contracts/planned-attempt-executor-contract.js"

const sessionId = KimiAcpSessionId.make("kimi-session-1")
const cwd = "/worktrees/kimi"

const makeService = () => {
  let status: KimiAcpSessionObservation["status"] = "idle"
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
        return sessionId
      }),
    loadSession: (restored, worktree) =>
      Effect.sync(() => {
        calls.push(`session/load:${restored}:${worktree}`)
        status = "idle"
        return restored
      }),
    resumeSession: (restored, worktree) =>
      Effect.sync(() => {
        calls.push(`session/resume:${restored}:${worktree}`)
        status = "idle"
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
          permissionDenied: false
        })
      ),
    cancel: (id) =>
      Effect.sync(() => {
        calls.push(`session/cancel:${id}`)
        status = "idle"
      }),
    close: () => Effect.void
  }
  return { service, calls }
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
