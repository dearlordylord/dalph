/* eslint-disable import/no-nodejs-modules -- Qualification locates the built public entry and controls a disposable receiving hook. */
import { fileURLToPath } from "node:url"
import { GitRepositoryLocator, type RunId } from "@dalph/contracts"
import {
  GitCommand,
  GithubGraphqlReadThrottled,
  GitCommonDirectoryTarget,
  RemotePublicationGit,
  RemotePublicationPushFailure,
  nodeGitCommandLayer,
  nodeGitDirectPublicationLayer,
  JournalStore,
  JournaledRunBootstrap,
  type JournalRecord,
  TraceOutput,
  TraceOutputError,
  TrackerGraphReader,
  WorkflowTrace,
  sqliteJournalStoreLayer
} from "@dalph/orchestrator"
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import {
  Clock,
  ConfigProvider,
  Context,
  Deferred,
  Effect,
  Fiber,
  FileSystem,
  Layer,
  Option,
  Queue,
  Ref,
  Schema
} from "effect"
import { expect } from "vitest"
import { makeRunningHostFixture, runningHostFixtureLayer } from "../../test-support/production-running-host-fixture.js"
import { runProductionCli, productionCliHostObservationOf } from "./live-cli.js"
import { ProductionCliRecord } from "./production-cli.js"
import { inspectProductionPublicationSubjects, withDecodedProductionRepositoryHost } from "./production-host.js"
import { projectRecordedCassette, verifyRecordedCassetteRoundTrip } from "../cassettes/recorded.js"
import { fileGitSenderCustodyLayer } from "./git-sender-custody.js"
import { dryRunOperationIdAllocatorLayer } from "./composition.js"
import {
  CodexProviderHomeNamespace,
  CodexServerStartupId,
  CodexServerStartupRecord,
  CodexStartupDeadlineMilliseconds,
  CodexStartupInstantMilliseconds,
  codexStartupLimitMilliseconds
} from "./codex-server-startup-record.js"

class PublicPublicationQualificationFailure extends Schema.TaggedError<PublicPublicationQualificationFailure>()(
  "PublicPublicationQualificationFailure",
  { detail: Schema.String }
) {}

const builtEntry = fileURLToPath(new URL("../../dist/bin/dalph.js", import.meta.url))
const recordsOf = <Tag extends JournalRecord["event"]["_tag"]>(records: ReadonlyArray<JournalRecord>, tag: Tag) =>
  records.filter(
    (record): record is JournalRecord & { readonly event: Extract<JournalRecord["event"], { readonly _tag: Tag }> } =>
      record.event._tag === tag
  )

for (const [recovery, paused, authorityWait, custodyWait] of [
  ["Resume", false, false, false],
  ["Grant", false, false, false],
  ["Throttled", false, false, false],
  ["Resume", true, false, false],
  ["Grant", true, false, false],
  ["Resume", false, true, false],
  ["Grant", false, true, false],
  ["Resume", false, false, true],
  ["Grant", false, false, true]
] as const)
  it.live(
    recovery === "Throttled"
      ? "public resume preserves native throttling across duplicate requests and restart"
      : authorityWait || custodyWait
        ? `public ${recovery.toLowerCase()} receipt does not bypass unavailable ${custodyWait ? "sender custody" : "fresh tracker authority"}`
        : `public ${recovery.toLowerCase()} reconnects after receipt output loss${paused ? " through Pause" : ""} and delivers the exact retained candidate`,
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const fs = yield* FileSystem.FileSystem
          const git = yield* GitCommand
          const idle = yield* Queue.unbounded<void>()
          const reject = yield* Ref.make(recovery === "Grant")
          const custodyUnavailable = yield* Ref.make(false)
          const fixture = yield* makeRunningHostFixture(builtEntry, false, undefined, {
            ...(recovery !== "Grant" && !custodyWait
              ? {}
              : {
                  remotePublicationGitLayer: (configuration) =>
                    Layer.effect(
                      RemotePublicationGit,
                      Effect.map(RemotePublicationGit, (authority) =>
                        RemotePublicationGit.of({
                          ...authority,
                          ...(!custodyWait
                            ? {}
                            : {
                                prepareSenderCustody: (request, ordinal) =>
                                  Ref.get(custodyUnavailable).pipe(
                                    Effect.flatMap((unavailable) =>
                                      unavailable
                                        ? Effect.fail(
                                            new RemotePublicationPushFailure({
                                              reason: "SenderStopUnproven",
                                              target: request.target
                                            })
                                          )
                                        : authority.prepareSenderCustody(request, ordinal)
                                    )
                                  )
                              }),
                          push: (request, ordinal) =>
                            Effect.gen(function* () {
                              if (!(yield* Ref.get(reject))) return yield* authority.push(request, ordinal)
                              const base = yield* git
                                .run(configuration.remotePublicationTarget.endpoint, [
                                  "rev-parse",
                                  configuration.remotePublicationTarget.branch
                                ])
                                .pipe(Effect.orDie)
                              if (base.exitCode !== 0) return yield* Effect.die("outside race baseline unreadable")
                              const baseline = base.stdout.trim()
                              const outside = yield* git
                                .run(configuration.remotePublicationTarget.endpoint, [
                                  "-c",
                                  "user.name=Controlled Outside Actor",
                                  "-c",
                                  "user.email=controlled-outside@example.invalid",
                                  "commit-tree",
                                  `${baseline}^{tree}`,
                                  "-p",
                                  baseline,
                                  "-m",
                                  "controlled outside publication race"
                                ])
                                .pipe(Effect.orDie)
                              if (outside.exitCode !== 0) return yield* Effect.die("outside race commit failed")
                              const competing = outside.stdout.trim()
                              const move = yield* git
                                .run(configuration.remotePublicationTarget.endpoint, [
                                  "update-ref",
                                  configuration.remotePublicationTarget.branch,
                                  competing,
                                  baseline
                                ])
                                .pipe(Effect.orDie)
                              if (move.exitCode !== 0) return yield* Effect.die("outside race admission failed")
                              return yield* authority.push(request, ordinal).pipe(
                                Effect.ensuring(
                                  git
                                    .run(configuration.remotePublicationTarget.endpoint, [
                                      "update-ref",
                                      configuration.remotePublicationTarget.branch,
                                      baseline,
                                      competing
                                    ])
                                    .pipe(Effect.orDie)
                                    .pipe(
                                      Effect.flatMap((restored) =>
                                        restored.exitCode === 0
                                          ? Effect.void
                                          : Effect.die("outside race restoration failed")
                                      )
                                    )
                                )
                              )
                            })
                        })
                      )
                    ).pipe(
                      Layer.provide(
                        nodeGitDirectPublicationLayer(GitRepositoryLocator.make(configuration.commonDirectory)).pipe(
                          Layer.provide(
                            nodeGitCommandLayer.pipe(
                              Layer.provide(
                                fileGitSenderCustodyLayer(GitCommonDirectoryTarget.make(configuration.commonDirectory))
                              ),
                              Layer.provide(NodeServices.layer),
                              Layer.fresh
                            )
                          )
                        )
                      )
                    )
                }),
            onActivationIdle: () => Queue.offer(idle, undefined).pipe(Effect.asVoid),
            onActivationFailure: () => Queue.offer(idle, undefined).pipe(Effect.asVoid)
          })
          const configuration = fixture.configuration
          const document = yield* fs
            .readFileString(fixture.configurationPath)
            .pipe(
              Effect.flatMap(
                Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))
              )
            )
          yield* fs.writeFileString(
            fixture.configurationPath,
            JSON.stringify({ ...document, remotePublicationTarget: configuration.remotePublicationTarget })
          )
          const hook = `${configuration.remotePublicationTarget.endpoint}/hooks/pre-receive`
          yield* fs.writeFileString(
            hook,
            recovery === "Throttled"
              ? "#!/bin/sh\necho 'rate limit' >&2\nexit 1\n"
              : "#!/bin/sh\necho 'controlled receiving policy denies update' >&2\nexit 1\n"
          )
          yield* fs.chmod(hook, 0o700)
          const run = yield* Ref.make<Option.Option<RunId>>(Option.none())
          const liveStore = yield* Ref.make<Option.Option<JournalStore["Service"]>>(Option.none())
          const currentBootstrap = yield* Ref.make<Option.Option<JournaledRunBootstrap["Service"]>>(Option.none())
          const graph = {
            ...fixture.graph,
            acquireProvider: (...args: Parameters<typeof fixture.graph.acquireProvider>) =>
              fixture.graph.acquireProvider(...args).pipe(
                Effect.tap((provider) =>
                  Effect.gen(function* () {
                    if (
                      provider._tag !== "CodexAppServer" ||
                      Option.isSome(yield* provider.attemptStore.readServerStartup())
                    )
                      return
                    const home = `${configuration.codexExecutorPrivateStateDirectory}/controlled-provider-home`
                    yield* fs.makeDirectory(home)
                    const now = yield* Clock.currentTimeMillis
                    const fields = {
                      startupId: CodexServerStartupId.make("controlled-publication-provider"),
                      home: CodexProviderHomeNamespace.make(yield* fs.realPath(home)),
                      intendedAtMilliseconds: CodexStartupInstantMilliseconds.make(now),
                      deadlineMilliseconds: CodexStartupDeadlineMilliseconds.make(now + codexStartupLimitMilliseconds)
                    }
                    yield* provider.attemptStore.writeServerStartup(CodexServerStartupRecord.cases.Pending.make(fields))
                    yield* provider.attemptStore.writeServerStartup(
                      CodexServerStartupRecord.cases.Initialized.make({
                        ...fields,
                        initializedAtMilliseconds: CodexStartupInstantMilliseconds.make(now)
                      })
                    )
                  })
                )
              ),
            run: (...args: Parameters<typeof fixture.graph.run>) =>
              fixture.graph
                .run(...args)
                .pipe(
                  Layer.tap((context) => Ref.set(currentBootstrap, Context.getOption(context, JournaledRunBootstrap)))
                ),
            foundation: (input: typeof configuration) =>
              fixture.graph
                .foundation(input)
                .pipe(Layer.tap((context) => Ref.set(liveStore, Option.some(Context.get(context, JournalStore)))))
          }
          const readHistory = Effect.gen(function* () {
            const selected = yield* Ref.get(run)
            if (Option.isNone(selected)) return yield* Effect.die("public command has not selected a Run")
            return yield* Effect.scoped(
              Effect.gen(function* () {
                const context = yield* Layer.build(sqliteJournalStoreLayer({ filename: configuration.journalDatabase }))
                return yield* Context.get(context, JournalStore).read(selected.value)
              })
            )
          })
          const invoke = Effect.fn("PublicPublicationControlTest.invoke")(function* (
            operation: "run" | "publication-subjects" | "publication-resume" | "publication-grant",
            stopAtRetained = false,
            loseReceiptOutput = false,
            direction?: "Pause" | "Unpause",
            stopAfterControlOutput = false,
            retainedCause?: "PushCustodyUnproven"
          ) {
            yield* Queue.clear(idle)
            yield* Ref.set(fixture.failures, [])
            const output = yield* Ref.make<ReadonlyArray<ProductionCliRecord>>([])
            const receiptWritten = yield* Deferred.make<void>()
            const application = runProductionCli(
              (input, use, mode) =>
                withDecodedProductionRepositoryHost(
                  input,
                  graph,
                  (observation) =>
                    Effect.gen(function* () {
                      const selected = yield* Ref.get(run)
                      if (Option.isSome(selected)) expect(observation.selection.runId).toBe(selected.value)
                      yield* Ref.set(run, Option.some(observation.selection.runId))
                      if (direction !== undefined) {
                        const bootstrap = yield* Ref.get(currentBootstrap)
                        if (Option.isNone(bootstrap)) return yield* Effect.die("missing selected bootstrap")
                        yield* bootstrap.value.operatorControl.applyControlDirection({
                          direction,
                          subject: { _tag: "Run", runId: observation.selection.runId }
                        })
                      }
                      const untilRetained = Effect.gen(function* () {
                        for (;;) {
                          yield* Queue.take(idle).pipe(Effect.timeout("30 seconds"))
                          const failures = yield* Ref.get(fixture.failures)
                          if (failures.length > 0)
                            return yield* new PublicPublicationQualificationFailure({
                              detail: JSON.stringify(failures)
                            })
                          const store = yield* Ref.get(liveStore)
                          if (Option.isNone(store)) return yield* Effect.die("missing selected Journal")
                          const records = yield* store.value.read(observation.selection.runId)
                          if (
                            stopAtRetained &&
                            recordsOf(records, "RemotePublicationRetained").length > 0 &&
                            (retainedCause === undefined ||
                              recordsOf(records, "RemotePublicationRetained").at(-1)?.event.cause._tag ===
                                retainedCause) &&
                            (operation === "run" ||
                              (yield* Ref.get(output)).some(
                                (record) =>
                                  record._tag === "PublicationResumeResult" || record._tag === "PublicationGrantResult"
                              ))
                          )
                            return
                        }
                      })
                      const present = use(
                        productionCliHostObservationOf(observation),
                        observation.applicationExitRequestBoundary,
                        observation.remotePublicationControl
                      )
                      yield* Effect.raceFirst(
                        present,
                        stopAfterControlOutput ? Deferred.await(receiptWritten) : untilRetained
                      ).pipe(
                        Effect.ensuring(observation.applicationExitRequestBoundary.requestExit.pipe(Effect.asVoid))
                      )
                    }),
                  mode
                ),
              { addSignalListener: () => Effect.void, removeSignalListener: () => Effect.void },
              (input) => inspectProductionPublicationSubjects(input)
            )
            const target = configuration.target
            const result = yield* application([
              operation,
              `github:${target.owner}/${target.repository}#${target.issueNumber}`,
              "--config",
              fixture.configurationPath,
              ...(operation === "run"
                ? ["--production"]
                : operation === "publication-resume" || operation === "publication-grant"
                  ? ["--request", `${configuration.repository}/resume.json`]
                  : [])
            ]).pipe(
              Effect.provide(
                Layer.succeed(
                  TraceOutput,
                  TraceOutput.of({
                    writeLine: (line) =>
                      Schema.decodeUnknownEffect(Schema.fromJsonString(ProductionCliRecord))(line).pipe(
                        Effect.orDie,
                        Effect.flatMap((record) =>
                          (record._tag === "PublicationResumeResult" || record._tag === "PublicationGrantResult") &&
                          loseReceiptOutput
                            ? Effect.fail(new TraceOutputError({ detail: "controlled receipt response loss" }))
                            : Ref.update(output, (records) => [...records, record]).pipe(
                                Effect.andThen(
                                  record._tag === "PublicationResumeResult" || record._tag === "PublicationGrantResult"
                                    ? Deferred.succeed(receiptWritten, undefined)
                                    : Effect.void
                                )
                              )
                        )
                      )
                  })
                )
              ),
              Effect.provide(ConfigProvider.layer(ConfigProvider.fromUnknown({ GITHUB_TOKEN: "controlled-token" }))),
              Effect.provide(
                Layer.mergeAll(
                  Layer.mock(TrackerGraphReader, {}),
                  Layer.mock(WorkflowTrace, {}),
                  dryRunOperationIdAllocatorLayer
                )
              ),
              Effect.timeout("30 seconds"),
              Effect.result
            )
            return { result, output: yield* Ref.get(output) }
          })
          const started = yield* invoke("run", true).pipe(Effect.forkScoped)
          yield* Deferred.await(fixture.turnEntered).pipe(Effect.timeout("20 seconds"))
          yield* fixture.release
          const initial = yield* Fiber.join(started)
          if (initial.result._tag === "Failure") return yield* Effect.die(JSON.stringify(initial.result))
          expect(initial.result._tag).toBe("Success")
          const before = yield* readHistory
          const retained = before.findLast(({ event }) => event._tag === "RemotePublicationRetained")
          if (retained?.event._tag !== "RemotePublicationRetained")
            return yield* Effect.die("initial denial was not retained")
          expect(retained.event.cause._tag).toBe(
            recovery === "Resume" ? "PolicyDenied" : recovery === "Grant" ? "AttemptsExhausted" : "Throttled"
          )
          const inspected = yield* invoke("publication-subjects")
          expect(inspected.result._tag).toBe("Success")
          const subjects = inspected.output.find((record) => record._tag === "PublicationSubjects")
          if (subjects?._tag !== "PublicationSubjects") return yield* Effect.die("public subject selection missing")
          expect(subjects.subjects).toHaveLength(1)
          const subject = subjects.subjects[0]
          if (subject === undefined) return yield* Effect.die("retained subject missing")
          expect(subject.retainedAt).toBe(retained.position)
          expect(subject.candidateCommit).toBe(retained.event.correlation.qualifiedCandidate.candidateCommit)
          expect(yield* readHistory).toEqual(before)
          const requestHistory = yield* readHistory
          const exhausted = requestHistory.findLast(({ event }) => event._tag === "RemotePublicationRetained")
          if (recovery === "Grant") expect(exhausted?.event).toMatchObject({ cause: { _tag: "AttemptsExhausted" } })
          const operation = recovery === "Grant" ? "publication-grant" : "publication-resume"
          const resultTag = recovery === "Grant" ? "PublicationGrantResult" : "PublicationResumeResult"
          const eventTag =
            recovery === "Resume" ? "RemotePublicationResumeRequested" : "RemotePublicationBatchGrantApplied"
          const request = {
            requestId: `public-${recovery.toLowerCase()}-loss`,
            ...(recovery === "Grant" ? { exhaustionAt: exhausted?.position } : {}),
            responsibility: subject.responsibility,
            runId: subject.runId,
            schemaVersion: 1
          }
          if (recovery === "Grant") {
            expect((yield* invoke("run", true)).result._tag).toBe("Success")
            yield* fs.writeFileString(
              `${configuration.repository}/resume.json`,
              JSON.stringify({
                schemaVersion: 1,
                requestId: "public-exhausted-resume",
                responsibility: subject.responsibility,
                runId: subject.runId
              })
            )
            const exhaustedResume = yield* invoke("publication-resume", true)
            expect(exhaustedResume.result._tag).toBe("Success")
            expect(exhaustedResume.output.find((record) => record._tag === "PublicationResumeResult")).toMatchObject({
              result: {
                _tag: "RemotePublicationResumeStatus",
                state: { _tag: "PublicationRetained", cause: { _tag: "AttemptsExhausted" } }
              }
            })
            const unchanged = yield* readHistory
            expect(recordsOf(unchanged, "RemotePublicationAttemptIntended")).toEqual(
              recordsOf(before, "RemotePublicationAttemptIntended")
            )
            expect(recordsOf(unchanged, "RemotePublicationResumeRequested")).toHaveLength(0)
            expect(recordsOf(unchanged, "RemotePublicationBatchGrantApplied")).toHaveLength(0)
            expect(recordsOf(unchanged, "WorkflowRunTerminated")).toHaveLength(0)
            yield* fs.remove(`${configuration.repository}/resume.json`)
          }
          const beforeUnsubmitted = yield* readHistory
          const unsubmitted = yield* invoke(operation)
          expect(unsubmitted.result._tag).toBe("Failure")
          expect(yield* readHistory).toEqual(beforeUnsubmitted)
          yield* fs.writeFileString(`${configuration.repository}/resume.json`, JSON.stringify(request))
          if (recovery === "Throttled") {
            yield* fs.writeFileString(
              `${configuration.repository}/resume.json`,
              JSON.stringify({ ...request, requestId: "public-throttled-grant", exhaustionAt: retained.position })
            )
            const refusedGrant = yield* invoke("publication-grant")
            expect(refusedGrant.result._tag).toBe("Failure")
            if (refusedGrant.result._tag === "Failure")
              expect(refusedGrant.result.failure).toMatchObject({
                _tag: "ProductionCliPublicationError",
                code: "publication.rejected",
                subject: subject.runId
              })
            expect(yield* readHistory).toEqual(beforeUnsubmitted)
            yield* fs.writeFileString(`${configuration.repository}/resume.json`, JSON.stringify(request))
            for (const _ of [0, 1]) {
              const denied = yield* invoke("publication-resume", true)
              expect(denied.result._tag).toBe("Success")
              expect(denied.output.find((record) => record._tag === "PublicationResumeResult")).toMatchObject({
                result: {
                  _tag: "RemotePublicationResumeStatus",
                  state: { _tag: "PublicationRetained", cause: { _tag: "Throttled" } }
                }
              })
            }
            expect((yield* invoke("run", true)).result._tag).toBe("Success")
            const after = yield* readHistory
            for (const tag of [
              "RemotePublicationAttemptIntended",
              "TaskAttemptPlanned",
              "PlannedAttemptExecutorCommandIntended"
            ] as const)
              expect(recordsOf(after, tag)).toEqual(recordsOf(before, tag))
            expect(recordsOf(after, "RemotePublicationResumeRequested")).toHaveLength(0)
            expect(recordsOf(after, "RemotePublicationBatchGrantApplied")).toHaveLength(0)
            expect(recordsOf(after, "RemotePublicationSucceeded")).toHaveLength(0)
            expect(recordsOf(after, "WorkflowRunTerminated")).toHaveLength(0)
            return
          }
          if (paused) {
            const deferred = yield* invoke(operation, false, false, "Pause", true)
            expect(deferred.result._tag).toBe("Success")
            const history = yield* readHistory
            expect(recordsOf(history, "RemotePublicationAttemptIntended")).toEqual(
              recordsOf(before, "RemotePublicationAttemptIntended")
            )
            expect(recordsOf(history, "TaskAttemptPlanned")).toEqual(recordsOf(before, "TaskAttemptPlanned"))
            expect(recordsOf(history, "RemotePublicationSucceeded")).toHaveLength(0)
            expect(recordsOf(history, "WorkflowRunTerminated")).toHaveLength(0)
            expect(deferred.output.find((record) => record._tag === resultTag)).toMatchObject({
              result: {
                _tag: recovery === "Grant" ? "RemotePublicationBatchGrantReceipt" : "RemotePublicationResumeReceipt"
              }
            })
          }
          const lost = yield* invoke(operation, false, true, paused ? "Unpause" : undefined)
          expect(lost.result._tag).toBe("Failure")
          expect(lost.output.some((record) => record._tag === resultTag)).toBe(false)
          const recorded = yield* readHistory
          expect(recordsOf(recorded, eventTag)).toHaveLength(1)
          expect(recordsOf(recorded, "RemotePublicationSucceeded")).toHaveLength(0)
          const duplicateLost = yield* invoke(operation, false, true)
          expect(duplicateLost.result._tag).toBe("Failure")
          expect(yield* readHistory).toEqual(recorded)
          yield* fs.writeFileString(
            `${configuration.repository}/resume.json`,
            JSON.stringify({
              ...request,
              responsibility: { ...request.responsibility, queuedAt: request.responsibility.queuedAt + 1 }
            })
          )
          const changed = yield* invoke(operation)
          expect(changed.result._tag).toBe("Failure")
          expect(yield* readHistory).toEqual(recorded)
          yield* fs.writeFileString(`${configuration.repository}/resume.json`, JSON.stringify(request))
          const persistentDenial = recovery === "Resume" && !paused && !authorityWait && !custodyWait
          if (persistentDenial) {
            const stillDenied = yield* invoke(operation, true)
            expect(stillDenied.result._tag).toBe("Success")
            expect(stillDenied.output.find((record) => record._tag === resultTag)).toMatchObject({
              result: { requestId: request.requestId, acceptedAt: recordsOf(recorded, eventTag)[0]?.position }
            })
            const deniedHistory = yield* readHistory
            expect(recordsOf(deniedHistory, "RemotePublicationRetained").at(-1)?.event.cause._tag).toBe("PolicyDenied")
            expect(
              recordsOf(deniedHistory, "RemotePublicationAttemptIntended").map(({ event }) => event.attemptOrdinal)
            ).toEqual([1, 2])
            expect(recordsOf(deniedHistory, "TaskAttemptPlanned")).toEqual(recordsOf(before, "TaskAttemptPlanned"))
            expect(recordsOf(deniedHistory, "RemotePublicationBatchGrantApplied")).toHaveLength(0)
            expect(recordsOf(deniedHistory, eventTag)).toHaveLength(1)
            expect(recordsOf(deniedHistory, "RemotePublicationSucceeded")).toHaveLength(0)
            expect(recordsOf(deniedHistory, "WorkflowRunTerminated")).toHaveLength(0)
          }
          yield* fs.remove(hook)
          yield* Ref.set(reject, false)
          if (custodyWait) {
            yield* Ref.set(custodyUnavailable, true)
            const waiting = yield* invoke(operation, true, false, undefined, false, "PushCustodyUnproven")
            expect(waiting.result._tag).toBe("Success")
            expect(waiting.output.find((record) => record._tag === resultTag)).toMatchObject({
              result: { requestId: request.requestId, acceptedAt: recordsOf(recorded, eventTag)[0]?.position }
            })
            const after = yield* readHistory
            expect(recordsOf(after, "RemotePublicationRetained").at(-1)?.event).toMatchObject({
              cause: { _tag: "PushCustodyUnproven" }
            })
            expect(recordsOf(after, "RemotePublicationAttemptIntended")).toEqual(
              recordsOf(recorded, "RemotePublicationAttemptIntended")
            )
            expect(recordsOf(after, "TaskAttemptPlanned")).toEqual(recordsOf(before, "TaskAttemptPlanned"))
            expect(recordsOf(after, eventTag)).toHaveLength(1)
            expect(recordsOf(after, "RemotePublicationSucceeded")).toHaveLength(0)
            expect(recordsOf(after, "WorkflowRunTerminated")).toHaveLength(0)
            return
          }
          if (authorityWait) {
            yield* fixture.setGraphReadFailure(
              new GithubGraphqlReadThrottled({
                operation: "ReadIssue",
                detail: "controlled fresh authority unavailable",
                retry: { _tag: "Unavailable" }
              })
            )
            const waiting = yield* invoke(operation)
            expect(waiting.result._tag).toBe("Failure")
            expect(waiting.output.find((record) => record._tag === resultTag)).toMatchObject({
              result: { requestId: request.requestId, acceptedAt: recordsOf(recorded, eventTag)[0]?.position }
            })
            const retained = yield* readHistory
            expect(recordsOf(retained, "RemotePublicationAttemptIntended")).toEqual(
              recordsOf(recorded, "RemotePublicationAttemptIntended")
            )
            expect(recordsOf(retained, "TaskAttemptPlanned")).toEqual(recordsOf(before, "TaskAttemptPlanned"))
            expect(recordsOf(retained, eventTag)).toHaveLength(1)
            expect(recordsOf(retained, "RemotePublicationSucceeded")).toHaveLength(0)
            expect(recordsOf(retained, "WorkflowRunTerminated")).toHaveLength(0)
            return
          }
          let finalRequestId = request.requestId
          let finalAcceptedAt = recordsOf(recorded, eventTag)[0]?.position
          if (persistentDenial) {
            const deniedHistory = yield* readHistory
            const oldReceipt = yield* invoke(operation, true)
            expect(oldReceipt.result._tag).toBe("Success")
            expect(recordsOf(yield* readHistory, "RemotePublicationAttemptIntended")).toEqual(
              recordsOf(deniedHistory, "RemotePublicationAttemptIntended")
            )
            finalRequestId = "public-resume-repaired-policy"
            finalAcceptedAt = undefined
            yield* fs.writeFileString(
              `${configuration.repository}/resume.json`,
              JSON.stringify({ ...request, requestId: finalRequestId })
            )
          }
          const resumed = yield* invoke(operation)
          expect(resumed.result._tag).toBe("Success")
          const receipt = resumed.output.find((record) => record._tag === resultTag)
          expect(receipt).toMatchObject({
            result: {
              _tag: recovery === "Resume" ? "RemotePublicationResumeReceipt" : "RemotePublicationBatchGrantReceipt",
              requestId: finalRequestId,
              ...(finalAcceptedAt === undefined ? {} : { acceptedAt: finalAcceptedAt })
            }
          })
          expect(resumed.output.find((record) => record._tag === "RunDisposition")).toMatchObject({
            disposition: "Completed",
            runId: subject.runId
          })
          const after = yield* readHistory
          expect(receipt).toMatchObject({
            result: {
              acceptedAt: recordsOf(after, eventTag).find(({ event }) => event.request.requestId === finalRequestId)
                ?.position
            }
          })
          expect(recordsOf(after, "WorkflowRunBegan")).toHaveLength(1)
          expect(recordsOf(after, "TaskAttemptPlanned")).toEqual(recordsOf(before, "TaskAttemptPlanned"))
          expect(
            after.filter(
              ({ event }) => event._tag === "PlannedAttemptExecutorCommandIntended" && event.command === "Begin"
            )
          ).toHaveLength(1)
          expect(recordsOf(after, "RemotePublicationResumeRequested")).toHaveLength(
            recovery === "Resume" ? (persistentDenial ? 2 : 1) : 0
          )
          expect(recordsOf(after, "RemotePublicationBatchGrantApplied")).toHaveLength(recovery === "Resume" ? 0 : 1)
          expect(recordsOf(after, "RemotePublicationAttemptIntended").map(({ event }) => event.attemptOrdinal)).toEqual(
            recovery === "Resume" ? (persistentDenial ? [1, 2, 3] : [1, 2]) : [1, 2, 3, 4]
          )
          expect(recordsOf(after, "RemotePublicationSucceeded")).toHaveLength(1)
          expect(recordsOf(after, "WorkflowRunTerminated")).toHaveLength(1)
          const planned = recordsOf(after, "TaskAttemptPlanned")[0]?.event.operation.plannedAttempt
          const publication = recordsOf(after, "RemotePublicationSucceeded")[0]
          const promotion = recordsOf(after, "TargetPromotionObservedSuccess")[0]
          const termination = recordsOf(after, "WorkflowRunTerminated")[0]
          if (
            planned === undefined ||
            publication === undefined ||
            promotion === undefined ||
            termination === undefined
          )
            return expect.fail("requires exact delivery settlement evidence")
          expect(termination.event.disposition).toBe("Completed")
          expect(yield* fixture.provider.snapshot()).toMatchObject({ activeClaimCount: 0, completionClaimCount: 0 })
          expect(yield* Ref.get(fixture.failures)).toEqual([])
          const candidate = publication.event.correlation.qualifiedCandidate
          expect(candidate.candidateCommit).toBe(subject.candidateCommit)
          expect(candidate.run.session.plannedAttempt).toEqual(planned)
          expect(promotion.event.correlation.qualifiedCandidate).toEqual(candidate)
          expect(recordsOf(after, "TargetPromotionObservedSuccess")).toHaveLength(1)
          expect(promotion.position).toBeGreaterThan(publication.position)
          const confirmations = recordsOf(after, "TaskTrackerFactsObserved").filter(
            ({ event }) =>
              event.observation._tag === "FocusedTaskCompletionFacts" &&
              event.observation.purpose._tag === "Confirmation" &&
              event.observation.facts.taskId === planned.taskId &&
              event.observation.facts.lifecycle === "CompletedSuccessfully"
          )
          expect(confirmations).toHaveLength(1)
          expect(confirmations[0]?.position).toBeGreaterThan(promotion.position)
          const finality = recordsOf(after, "IntegrationFinalitySettled")
          const deleted = recordsOf(after, "CompletionClaimDeleted")
          expect(finality).toHaveLength(1)
          expect(deleted).toHaveLength(1)
          expect(finality[0]).toMatchObject({ event: { claim: { plannedAttempt: planned } } })
          expect(deleted[0]).toMatchObject({ event: { claim: { plannedAttempt: planned } } })
          const worktrees = recordsOf(after, "WorktreeCleanupSettled")
          const branches = recordsOf(after, "BranchCleanupSettled")
          const candidates = recordsOf(after, "IntegratorCandidateCleanupSettled")
          expect(worktrees).toHaveLength(1)
          expect(branches).toHaveLength(1)
          expect(candidates).toHaveLength(1)
          expect(worktrees[0]).toMatchObject({
            event: {
              authorization: {
                locator: planned.worktree,
                owner: { attemptId: planned.attemptId, branch: planned.branch },
                disposition: { _tag: "Settled", plannedAttempt: planned }
              }
            }
          })
          expect(branches[0]).toMatchObject({
            event: {
              authorization: {
                locator: planned.branch,
                owner: { attemptId: planned.attemptId },
                disposition: { _tag: "Settled", plannedAttempt: planned }
              }
            }
          })
          expect(candidates[0]).toMatchObject({
            event: {
              authorization: {
                locator: candidate.run.session.candidateResource,
                owner: { sessionId: candidate.run.session.sessionId },
                disposition: { _tag: "Settled", qualifiedCandidate: candidate }
              }
            }
          })
          for (const settlement of [finality[0], deleted[0], worktrees[0], branches[0], candidates[0]]) {
            expect(settlement?.position).toBeGreaterThan(confirmations[0]?.position ?? 0)
            expect(settlement?.position).toBeLessThan(termination.position)
          }
          expect(yield* fs.exists(planned.worktree)).toBe(false)
          const worktreeInventory = yield* git.runInWorktree(configuration.repository, [
            "worktree",
            "list",
            "--porcelain"
          ])
          expect(worktreeInventory.exitCode).toBe(0)
          expect(worktreeInventory.stdout).not.toContain(configuration.plannedAttemptWorktreeRoot)
          expect(worktreeInventory.stdout).not.toContain(configuration.integratorCandidateWorktreeRoot)
          expect(
            (yield* git.runInWorktree(configuration.repository, ["show-ref", "--verify", "--quiet", planned.branch]))
              .exitCode
          ).toBe(1)
          const local = yield* git.runInWorktree(configuration.repository, ["rev-parse", configuration.integrationRef])
          expect(local.exitCode).toBe(0)
          expect(local.stdout.trim()).toBe(candidate.candidateCommit)
          const cassette = yield* projectRecordedCassette(after)
          expect(
            verifyRecordedCassetteRoundTrip(after, cassette).every(
              (checkpoint) =>
                checkpoint.workflowHistoryEquivalent &&
                checkpoint.operationalStateEquivalent &&
                checkpoint.pureSelectionEquivalent &&
                checkpoint.appliedOccurrencePositionEquivalent
            )
          ).toBe(true)
          const remote = yield* git.run(configuration.remotePublicationTarget.endpoint, [
            "rev-parse",
            configuration.remotePublicationTarget.branch
          ])
          expect(remote.exitCode).toBe(0)
          expect(remote.stdout.trim()).toBe(subject.candidateCommit)
        })
      ).pipe(Effect.provide(runningHostFixtureLayer)),
    120000
  )
