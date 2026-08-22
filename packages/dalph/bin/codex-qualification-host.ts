#!/usr/bin/env node
/* eslint-disable import/no-nodejs-modules -- this executable owns the real qualification process boundary. */
/* eslint-disable functional/immutable-data -- process output and one-shot CLI state are intentionally mutable. */

import nodeProcess from "node:process"
import { NodeServices } from "@effect/platform-node"
import {
  AttemptId,
  GitCommitSha,
  PlannedAttemptExecutor,
  type PlannedAttemptExecutorProjection,
  type PlannedAttemptExecutorReport,
  type PlannedAttemptExecutorService,
  PlannedAttemptExecutorRequest,
  PlannedTaskAttempt,
  RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  TaskId,
  WorktreeLocator,
  makeTaskWorkSpecification,
  plannedAttemptExecutorCorrelation
} from "@dalph/contracts"
import {
  ApplicationExitDiagnostic,
  ApplicationExitDrainFailure,
  ApplicationExitShell,
  EvidenceStoreLocator,
  makeApplicationExitShell,
  nodeEvidenceStoreLayer,
  nodeGitCommandLayer
} from "@dalph/orchestrator"
import { Cause, Effect, Exit, Fiber, Layer, Option, Schema } from "effect"
import {
  CodexAppServer,
  codexAppServerNodeLayer,
  type CodexThreadSnapshot
} from "../src/application/codex-app-server.js"
import {
  CodexAttemptRecord,
  CodexAttemptStore,
  nodeCodexAttemptStoreLayer
} from "../src/application/codex-attempt-store.js"
import { nodeCodexPlannedAttemptExecutorLayer } from "../src/application/codex-planned-attempt-executor.js"
import { CodexQualificationAction, CodexQualificationHostEvent } from "./codex-qualification-host-contract.js"

const QualificationConfiguration = Schema.Struct({
  action: CodexQualificationAction,
  worktree: Schema.NonEmptyString,
  stateDirectory: Schema.NonEmptyString,
  evidenceDirectory: Schema.NonEmptyString,
  codexHome: Schema.NonEmptyString,
  codexExecutable: Schema.NonEmptyString,
  baseSha: GitCommitSha,
  branch: TaskBranchRef,
  taskId: TaskId,
  runId: RunId,
  attemptId: AttemptId,
  holdAfterAction: Schema.Boolean,
  openAiApiKey: Schema.optionalKey(Schema.String)
})
type QualificationConfiguration = typeof QualificationConfiguration.Type

class QualificationConfigurationFailure extends Schema.TaggedError<QualificationConfigurationFailure>()(
  "QualificationConfigurationFailure",
  { detail: Schema.String }
) {}

const usage =
  "dalph-codex-qualification-host <allocate|associate|association-cut|pre-thread-cut|create|turn|project|read|suspend|interrupt|settle|exercise-suspension|exercise-terminal-suspension|exit|exit-stuck|close|wait>; requires qualification paths, base SHA, and CODEX_HOME"

const envValue = (name: string): string | undefined => nodeProcess.env[name]

const rawConfiguration = {
  action: nodeProcess.argv[2],
  worktree: envValue("DALPH_CODEX_QUALIFICATION_WORKTREE"),
  stateDirectory: envValue("DALPH_CODEX_QUALIFICATION_STATE"),
  evidenceDirectory: envValue("DALPH_CODEX_QUALIFICATION_EVIDENCE"),
  codexHome: envValue("CODEX_HOME"),
  codexExecutable: envValue("CODEX_BIN") ?? "codex",
  baseSha: envValue("DALPH_CODEX_QUALIFICATION_BASE_SHA"),
  branch: envValue("DALPH_CODEX_QUALIFICATION_BRANCH") ?? "refs/heads/dalph/real-codex-qualification",
  taskId: envValue("DALPH_CODEX_QUALIFICATION_TASK_ID") ?? "real-codex-qualification-task",
  runId: envValue("DALPH_CODEX_QUALIFICATION_RUN_ID") ?? "real-codex-qualification-run",
  attemptId: envValue("DALPH_CODEX_QUALIFICATION_ATTEMPT_ID") ?? "real-codex-qualification-attempt",
  holdAfterAction: envValue("DALPH_CODEX_QUALIFICATION_HOLD") === "1",
  ...(envValue("OPENAI_API_KEY") === undefined ? {} : { openAiApiKey: envValue("OPENAI_API_KEY") })
}

const decodeConfiguration = (): Effect.Effect<QualificationConfiguration, QualificationConfigurationFailure> =>
  Schema.decodeUnknownEffect(QualificationConfiguration)(rawConfiguration).pipe(
    Effect.mapError(
      (error) =>
        new QualificationConfigurationFailure({ detail: `invalid qualification host configuration: ${String(error)}` })
    )
  )

const writeEvent = (value: unknown): Effect.Effect<void, never> =>
  Schema.decodeUnknownEffect(CodexQualificationHostEvent)(value).pipe(
    Effect.flatMap((event) => Effect.sync(() => nodeProcess.stdout.write(`${JSON.stringify(event)}\n`))),
    Effect.orDie
  )

const threadRecordFor = (configuration: QualificationConfiguration, threadId: CodexThreadSnapshot["id"]) =>
  CodexAttemptRecord.cases.AssociatedPreTurn.make({
    attemptId: configuration.attemptId,
    correlationAttemptId: configuration.attemptId,
    correlationRunId: configuration.runId,
    threadId,
    worktree: WorktreeLocator.make(configuration.worktree)
  })

const reportEvent = (command: "StartOrContinue" | "Suspend", report: PlannedAttemptExecutorReport) => ({
  event: "report" as const,
  command,
  report
})

const projectionEvent = (projection: PlannedAttemptExecutorProjection) => ({ event: "projection" as const, projection })

const taskBody = "Execute the deterministic real-Codex qualification task and report the resulting commit."
const terminalObservationAttempts = 600

const settleAttempt = (
  executor: PlannedAttemptExecutorService,
  request: PlannedAttemptExecutorRequest,
  remaining: number
): Effect.Effect<PlannedAttemptExecutorReport, unknown> =>
  executor
    .startOrContinue(request)
    .pipe(
      Effect.flatMap((report) =>
        report._tag !== "Running"
          ? Effect.succeed(report)
          : remaining <= 0
            ? Effect.fail(
                new QualificationConfigurationFailure({
                  detail: "real Codex turn did not settle within the qualification observation bound"
                })
              )
            : Effect.sleep("25 millis").pipe(Effect.andThen(settleAttempt(executor, request, remaining - 1)))
      )
    )

const specificationFor = (configuration: QualificationConfiguration) =>
  makeTaskWorkSpecification({ body: taskBody, taskId: configuration.taskId, title: "Real Codex qualification" })

const attemptFor = (configuration: QualificationConfiguration): PlannedTaskAttempt => {
  const specification = specificationFor(configuration)
  return PlannedTaskAttempt.make({
    attemptId: configuration.attemptId,
    baseSha: configuration.baseSha,
    branch: configuration.branch,
    executor: TaskExecutorLocator.make("executor:codex-app-server"),
    runId: configuration.runId,
    taskId: configuration.taskId,
    taskRevision: specification.fingerprint,
    worktree: WorktreeLocator.make(configuration.worktree)
  })
}

const environmentFor = (configuration: QualificationConfiguration): Readonly<Record<string, string>> =>
  configuration.openAiApiKey === undefined
    ? { CODEX_HOME: configuration.codexHome }
    : { CODEX_HOME: configuration.codexHome, OPENAI_API_KEY: configuration.openAiApiKey }

const exitDrainFailure = (detail: string) =>
  new ApplicationExitDrainFailure({ diagnostics: [ApplicationExitDiagnostic.make(detail)] })

const configurationProgram = Effect.gen(function* () {
  const configuration = yield* decodeConfiguration()
  const attempt = attemptFor(configuration)
  const specification = specificationFor(configuration)
  const request = PlannedAttemptExecutorRequest.make({ plannedAttempt: attempt, specification })
  const correlation = plannedAttemptExecutorCorrelation(attempt)

  return yield* Effect.scoped(
    Effect.gen(function* () {
      const applicationExit = yield* makeApplicationExitShell(
        { release: Effect.void, runMutation: (mutation) => mutation },
        {
          requestEnd: (decision) =>
            Effect.sync(() => {
              nodeProcess.exitCode = decision.status
            })
        },
        { emit: (event) => writeEvent({ event: "exit-trace", detail: event._tag }) }
      )
      const exitLayer = Layer.succeed(ApplicationExitShell, applicationExit)
      const durableStoreLayer = nodeCodexAttemptStoreLayer({ stateDirectory: configuration.stateDirectory })
      const storeLayer =
        configuration.action === "association-cut"
          ? Layer.effect(
              CodexAttemptStore,
              Effect.map(CodexAttemptStore, (durable) => ({
                ...durable,
                writeAttempt: (record: CodexAttemptRecord) =>
                  record._tag === "AssociatedPreTurn"
                    ? writeEvent({ event: "association-write-started" }).pipe(Effect.andThen(Effect.never))
                    : durable.writeAttempt(record)
              }))
            ).pipe(Layer.provide(durableStoreLayer))
          : durableStoreLayer
      const appLayer = codexAppServerNodeLayer({
        executable: configuration.codexExecutable,
        environment: environmentFor(configuration)
      }).pipe(Layer.provide(exitLayer))
      const appAndStoreLayer = appLayer.pipe(Layer.provideMerge(storeLayer), Layer.provideMerge(NodeServices.layer))
      const gitLayer = nodeGitCommandLayer.pipe(Layer.provide(NodeServices.layer))
      const evidenceLayer = nodeEvidenceStoreLayer(EvidenceStoreLocator.make(configuration.evidenceDirectory)).pipe(
        Layer.provide(NodeServices.layer)
      )
      const runtimeLayer = nodeCodexPlannedAttemptExecutorLayer.pipe(
        Layer.provideMerge(Layer.mergeAll(appAndStoreLayer, gitLayer, evidenceLayer, exitLayer))
      )
      // eslint-disable-next-line complexity -- One disposable host interprets the accepted chronology's closed action vocabulary.
      return yield* Effect.gen(function* () {
        const app = yield* CodexAppServer
        const store = yield* CodexAttemptStore
        const executor = yield* PlannedAttemptExecutor
        yield* writeEvent({ event: "ready", pid: nodeProcess.pid })

        if (configuration.action === "wait" || configuration.action === "pre-thread-cut") return yield* Effect.never

        if (configuration.action === "allocate") {
          const thread = yield* app.startThread(configuration.worktree)
          yield* writeEvent({ event: "allocated", threadMaterialized: true, worktree: thread.cwd })
        } else if (configuration.action === "associate") {
          const thread = yield* app.startThread(configuration.worktree)
          yield* store.writeAttempt(threadRecordFor(configuration, thread.id))
          yield* writeEvent({ event: "associated", threadMaterialized: true, worktree: thread.cwd })
        } else if (
          configuration.action === "create" ||
          configuration.action === "turn" ||
          configuration.action === "association-cut"
        ) {
          yield* writeEvent(reportEvent("StartOrContinue", yield* executor.startOrContinue(request)))
        } else if (configuration.action === "project" || configuration.action === "read") {
          yield* writeEvent(projectionEvent(yield* executor.project(correlation)))
        } else if (configuration.action === "suspend" || configuration.action === "interrupt") {
          yield* writeEvent(reportEvent("Suspend", yield* executor.requestSuspension(attempt)))
        } else if (configuration.action === "settle") {
          const initial = yield* executor.startOrContinue(request)
          yield* writeEvent(reportEvent("StartOrContinue", initial))
          if (initial._tag === "Running") {
            yield* Effect.sleep("100 millis")
            yield* writeEvent(
              reportEvent("StartOrContinue", yield* settleAttempt(executor, request, terminalObservationAttempts))
            )
          }
        } else if (configuration.action === "exercise-suspension") {
          yield* writeEvent(reportEvent("StartOrContinue", yield* executor.startOrContinue(request)))
          yield* Effect.sleep("100 millis")
          const suspension = yield* Effect.forkScoped(executor.requestSuspension(attempt), { startImmediately: true })
          yield* writeEvent({ event: "suspension-requested" })
          yield* writeEvent(reportEvent("Suspend", yield* Fiber.join(suspension)))
        } else if (configuration.action === "exercise-terminal-suspension") {
          yield* writeEvent(reportEvent("StartOrContinue", yield* executor.startOrContinue(request)))
          yield* writeEvent({ event: "suspension-ready" })
          yield* Effect.promise(
            () =>
              new Promise<void>((resolve) => {
                nodeProcess.stdin.once("data", () => resolve())
                nodeProcess.stdin.resume()
              })
          )
          const suspension = yield* Effect.forkScoped(executor.requestSuspension(attempt), { startImmediately: true })
          yield* writeEvent({ event: "suspension-requested" })
          yield* writeEvent(reportEvent("Suspend", yield* Fiber.join(suspension)))
        } else if (configuration.action === "exit" || configuration.action === "exit-stuck") {
          const started = yield* executor.startOrContinue(request)
          yield* writeEvent(reportEvent("StartOrContinue", started))
          const suspendForExit = executor.requestSuspension(attempt).pipe(
            Effect.tap((report) => writeEvent(reportEvent("Suspend", report))),
            Effect.flatMap((report) =>
              report._tag === "SafelySuspended" || report._tag === "Terminal"
                ? Effect.succeed([report.correlation])
                : Effect.fail(exitDrainFailure(`Executor Exit drain retained ${report._tag} work`))
            )
          )
          yield* applicationExit.registerExecutorDrain({
            suspendRunningExecutorWork:
              configuration.action === "exit-stuck"
                ? suspendForExit.pipe(
                    Effect.catch((failure) =>
                      writeEvent({ event: "suspension-unresolved", detail: String(failure) }).pipe(
                        Effect.andThen(Effect.never)
                      )
                    )
                  )
                : suspendForExit.pipe(
                    Effect.mapError((failure) =>
                      failure instanceof ApplicationExitDrainFailure
                        ? failure
                        : exitDrainFailure(`Executor Exit drain failed: ${String(failure)}`)
                    )
                  )
          })
          if (started._tag === "Running") yield* Effect.sleep("100 millis")
          const result = yield* applicationExit.requestBoundary.requestExit
          yield* writeEvent({ event: "exit-result", exitResult: result })
        } else {
          yield* writeEvent({ event: "closed" })
        }

        if (
          configuration.holdAfterAction ||
          configuration.action === "allocate" ||
          configuration.action === "associate"
        ) {
          return yield* Effect.never
        }
      }).pipe(Effect.provide(runtimeLayer))
    })
  )
})

const detailOf = (cause: unknown): string => {
  const decoded = Schema.decodeUnknownOption(Schema.Struct({ detail: Schema.String }))(cause)
  return Option.isSome(decoded) ? decoded.value.detail : String(cause)
}

if (rawConfiguration.action === undefined) {
  nodeProcess.stderr.write(`${usage}\n`)
  nodeProcess.exitCode = 64
} else {
  void Effect.runPromiseExit(configurationProgram)
    .then((exit) => {
      if (Exit.isSuccess(exit)) return
      const detail = detailOf(Cause.squash(exit.cause)) || Cause.pretty(exit.cause)
      nodeProcess.stdout.write(`${JSON.stringify({ event: "failure", detail })}\n`)
      nodeProcess.exitCode = 70
    })
    .catch((cause: unknown) => {
      nodeProcess.stdout.write(`${JSON.stringify({ event: "failure", detail: detailOf(cause) })}\n`)
      nodeProcess.exitCode = 70
    })
}
