/* eslint-disable import/no-nodejs-modules -- Real-wrapper qualification starts a real Node child process. */
import { NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Option, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { cwd as processCwd, execPath } from "node:process"
import { describe, expect } from "vitest"
import {
  AttemptId,
  EvidenceDigest,
  EvidenceReference,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTarget,
  IntegrationTargetRef,
  RunId
} from "@dalph/contracts"
import {
  IntegrationCandidateId,
  IntegrationCandidateResourceLocator,
  IntegrationSessionId,
  IntegrationCandidateCorrelation
} from "../../workflow/protocols/integration-candidate-construction/events.js"
import { JournalPosition } from "../../workflow-journal/identity.js"
import {
  TargetVerificationPlanId,
  TargetVerificationRequest,
  TargetVerificationBoundary,
  TargetVerificationBoundaryFailure,
  targetVerificationCorrelationFor,
  type TargetVerificationCandidate
} from "../../workflow/protocols/target-verification/events.js"
import {
  nodeRepositoryVerificationWrapperLayer,
  nodeTargetVerificationBoundaryLayer,
  repositoryVerificationBoundaryLayer,
  RepositoryVerificationWrapper,
  RepositoryVerificationWrapperFailure,
  RepositoryVerificationWrapperInterrupted,
  TargetVerificationWrapperExecutable
} from "./repository-resource-lock.js"
import { validateRun, wrapperInterruptedExitCode } from "./repository-resource-lock-lifecycle.js"
import { detailOf, parseWrapperMessage } from "./repository-resource-lock-protocol.js"

const nodeWrapperLayer = (script: string, args: ReadonlyArray<string> = []) =>
  nodeRepositoryVerificationWrapperLayer({
    args: ["-e", script, ...args],
    executable: TargetVerificationWrapperExecutable.make(execPath)
  }).pipe(Layer.provide(NodeServices.layer))

const evidence = EvidenceReference.make({ byteLength: 0, digest: EvidenceDigest.make("a".repeat(64)) })
const target = IntegrationTarget.make({
  ref: IntegrationTargetRef.make("refs/heads/main"),
  repository: GitRepositoryLocator.make("/repositories/verification.git")
})
const candidate: TargetVerificationCandidate = {
  candidateCommit: GitCommitSha.make("4".repeat(40)),
  constructedAt: JournalPosition.make(11),
  correlation: IntegrationCandidateCorrelation.make({
    acceptanceManifest: evidence,
    acceptedResultCommit: GitCommitSha.make("3".repeat(40)),
    attemptId: AttemptId.make("verification-attempt"),
    candidateId: IntegrationCandidateId.make("verification-candidate"),
    candidateResource: IntegrationCandidateResourceLocator.make("/candidate/verification"),
    expectedTargetHead: GitCommitSha.make("2".repeat(40)),
    integrationSessionId: IntegrationSessionId.make("verification-session"),
    integrationTarget: target,
    runId: RunId.make("verification-run")
  }),
  reviewManifest: evidence
}
const request = TargetVerificationRequest.make({
  ...targetVerificationCorrelationFor(candidate, TargetVerificationPlanId.make("verification-plan"))
})

const passedWrapperScript = `
const fs = require("node:fs")
const request = JSON.parse(fs.readFileSync(0, "utf8"))
const emit = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
emit({ _tag: "Waiting", requestId: request.requestId })
emit({ _tag: "Acquired", requestId: request.requestId })
emit({ _tag: "Terminal", result: { _tag: "Passed", correlation: request, artifacts: [{ name: "report", bytes: "cmVzdWx0" }] } })
emit({ _tag: "Released", requestId: request.requestId })
`

const partialWrapperScript = `
const fs = require("node:fs")
const request = JSON.parse(fs.readFileSync(0, "utf8"))
const emit = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
emit({ _tag: "Waiting", requestId: request.requestId })
emit({ _tag: "Acquired", requestId: request.requestId })
emit({ _tag: "Terminal", result: { _tag: "Partial", correlation: request, artifacts: [{ name: "partial", bytes: "cGFydGlhbA==" }] } })
emit({ _tag: "Released", requestId: request.requestId })
`

const interruptedWrapperScript = `
const fs = require("node:fs")
const request = JSON.parse(fs.readFileSync(0, "utf8"))
const emit = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
emit({ _tag: "Waiting", requestId: request.requestId })
emit({ _tag: "Acquired", requestId: request.requestId })
emit({ _tag: "Interrupted", requestId: request.requestId, signal: "SIGTERM", detail: "wrapper stopped" })
emit({ _tag: "Released", requestId: request.requestId })
process.exitCode = 143
`

const malformedWrapperScript = `
const fs = require("node:fs")
const request = JSON.parse(fs.readFileSync(0, "utf8"))
const emit = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
emit({ _tag: "Waiting", requestId: request.requestId })
emit({ _tag: "Acquired", requestId: request.requestId })
emit({ _tag: "Terminal", result: { _tag: "Passed", correlation: request, artifacts: [] } })
`

const signalWrapperScript = `
const fs = require("node:fs")
const request = JSON.parse(fs.readFileSync(0, "utf8"))
const emit = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
emit({ _tag: "Waiting", requestId: request.requestId })
emit({ _tag: "Acquired", requestId: request.requestId })
process.kill(process.pid, "SIGTERM")
`

const failedWrapperScript = `
const fs = require("node:fs")
const request = JSON.parse(fs.readFileSync(0, "utf8"))
const emit = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
emit({ _tag: "Waiting", requestId: request.requestId })
emit({ _tag: "Acquired", requestId: request.requestId })
emit({ _tag: "Failed", requestId: request.requestId, detail: "guarded command failed" })
process.exitCode = 2
`

const oversizedWrapperScript = `process.stdout.write("x".repeat(16 * 1024 * 1024 + 1))`

const lockHolderScript = `
const fs = require("node:fs")
const { flock } = require("fs-ext-extra-prebuilt")
const descriptor = fs.openSync(process.argv[1], "a+")
flock(descriptor, "exnb", (failure) => {
  if (failure !== null) process.exit(2)
  process.stdout.write("held\\n")
  setTimeout(() => {
    fs.closeSync(descriptor)
    process.exit(0)
  }, 200)
})
`

const waitingWrapperScript = `
const fs = require("node:fs")
const { flock } = require("fs-ext-extra-prebuilt")
const request = JSON.parse(fs.readFileSync(0, "utf8"))
const emit = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
const descriptor = fs.openSync(process.argv[1], "a+")
emit({ _tag: "Waiting", requestId: request.requestId })
const acquire = () => flock(descriptor, "exnb", (failure) => {
  if (failure !== null) return setTimeout(acquire, 10)
  emit({ _tag: "Acquired", requestId: request.requestId })
  emit({ _tag: "Terminal", result: { _tag: "Passed", correlation: request, artifacts: [{ name: "report", bytes: "cmVzdWx0" }] } })
  fs.closeSync(descriptor)
  emit({ _tag: "Released", requestId: request.requestId })
})
acquire()
`

const wrapperLines = (...messages: ReadonlyArray<unknown>): ReadonlyArray<string> =>
  messages.map((message) => JSON.stringify(message))

const terminalMessage = (
  tag: "Failed" | "Killed" | "Partial" | "Passed" | "TimedOut",
  artifacts: ReadonlyArray<{ readonly name: string; readonly bytes: string }> = [
    { name: "diagnostic", bytes: "ZGlhZ25vc3RpYw==" }
  ]
) => ({ _tag: "Terminal" as const, result: { _tag: tag, correlation: request, artifacts } })

describe("repository verification wrapper node adapter", () => {
  it.effect("invokes exactly one public wrapper and keeps lifecycle observations typed", () =>
    Effect.gen(function* () {
      const wrapper = yield* RepositoryVerificationWrapper
      const run = yield* wrapper.runOrResume(request)

      expect(run.terminal._tag).toBe("Passed")
      expect(run.observations.map((observation) => observation._tag)).toEqual([
        "Waiting",
        "Acquired",
        "Terminal",
        "Released"
      ])
      expect(run.observations[2]).toMatchObject({ _tag: "Terminal", terminal: { _tag: "Passed" } })
    }).pipe(Effect.provide(nodeWrapperLayer(passedWrapperScript)))
  )

  it.effect("seals nonpass terminal observations without treating partial verification as success", () =>
    Effect.gen(function* () {
      const wrapper = yield* RepositoryVerificationWrapper
      const run = yield* wrapper.runOrResume(request)

      expect(run.terminal._tag).toBe("Partial")
      expect(run.observations.map((observation) => observation._tag)).toEqual([
        "Waiting",
        "Acquired",
        "Terminal",
        "Released"
      ])
    }).pipe(Effect.provide(nodeWrapperLayer(partialWrapperScript)))
  )

  it.effect("maps interruption to a typed observation and keeps success fail-closed", () =>
    Effect.gen(function* () {
      const wrapper = yield* RepositoryVerificationWrapper
      const failure = yield* wrapper.runOrResume(request).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(RepositoryVerificationWrapperInterrupted)
      expect(failure).toMatchObject({ requestId: request.requestId, signal: "SIGTERM" })
      expect(failure.observations.map((observation) => observation._tag)).toEqual([
        "Waiting",
        "Acquired",
        "Interrupted",
        "Released"
      ])
    }).pipe(Effect.provide(nodeWrapperLayer(interruptedWrapperScript)))
  )

  it.effect("maps an operating-system signal to a typed interruption with observed lifecycle", () =>
    Effect.gen(function* () {
      const wrapper = yield* RepositoryVerificationWrapper
      const failure = yield* wrapper.runOrResume(request).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(RepositoryVerificationWrapperInterrupted)
      expect(failure).toMatchObject({ requestId: request.requestId, signal: "SIGTERM" })
      expect(failure.observations.map((observation) => observation._tag)).toEqual(["Waiting", "Acquired"])
    }).pipe(Effect.provide(nodeWrapperLayer(signalWrapperScript)))
  )

  it.effect("normalizes wrapper process spawn failure before any lifecycle observation", () =>
    Effect.gen(function* () {
      const wrapper = yield* RepositoryVerificationWrapper
      const failure = yield* wrapper.runOrResume(request).pipe(Effect.flip)

      expect(failure).toMatchObject({ _tag: "RepositoryVerificationWrapperFailure", observations: [] })
    }).pipe(
      Effect.provide(
        nodeRepositoryVerificationWrapperLayer({
          args: [],
          executable: TargetVerificationWrapperExecutable.make("/dalph/does-not-exist/verification-wrapper")
        }).pipe(Layer.provide(NodeServices.layer))
      )
    )
  )

  it.effect("rejects malformed or incomplete wrapper output", () =>
    Effect.gen(function* () {
      const wrapper = yield* RepositoryVerificationWrapper
      const failure = yield* wrapper.runOrResume(request).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(RepositoryVerificationWrapperFailure)
      expect(failure).toMatchObject({ requestId: request.requestId })
      expect(failure.observations.map((observation) => observation._tag)).toEqual(["Waiting", "Acquired"])
    }).pipe(Effect.provide(nodeWrapperLayer(malformedWrapperScript)))
  )

  it.effect("rejects wrapper output beyond the fixed public boundary", () =>
    Effect.gen(function* () {
      const wrapper = yield* RepositoryVerificationWrapper
      const failure = yield* wrapper.runOrResume(request).pipe(Effect.flip)

      expect(failure).toMatchObject({
        detail: "wrapper output exceeded the bounded limit",
        requestId: request.requestId
      })
    }).pipe(Effect.provide(nodeWrapperLayer(oversizedWrapperScript)))
  )

  it.effect("maps wrapper failure and missing release to a fail-closed boundary failure", () =>
    Effect.gen(function* () {
      const boundary = yield* TargetVerificationBoundary
      const failure = yield* boundary.runOrResume(request).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(TargetVerificationBoundaryFailure)
      expect(failure).toMatchObject({ requestId: request.requestId, detail: "guarded command failed" })
    }).pipe(
      Effect.provide(
        nodeTargetVerificationBoundaryLayer({
          args: ["-e", failedWrapperScript],
          executable: TargetVerificationWrapperExecutable.make(execPath)
        }).pipe(Layer.provide(NodeServices.layer))
      )
    )
  )

  it.effect("returns the exact successful terminal through the provider-neutral boundary", () =>
    Effect.gen(function* () {
      const boundary = yield* TargetVerificationBoundary
      const terminal = yield* boundary.runOrResume(request)

      expect(terminal).toMatchObject({ _tag: "Passed", correlation: request })
    }).pipe(
      Effect.provide(
        nodeTargetVerificationBoundaryLayer({
          args: ["-e", passedWrapperScript],
          executable: TargetVerificationWrapperExecutable.make(execPath)
        }).pipe(Layer.provide(NodeServices.layer))
      )
    )
  )

  it.effect("preserves an interrupted wrapper signal at the provider-neutral boundary", () =>
    Effect.gen(function* () {
      const boundary = yield* TargetVerificationBoundary
      const failure = yield* boundary.runOrResume(request).pipe(Effect.flip)

      expect(failure).toMatchObject({ detail: "SIGTERM: controlled interruption", requestId: request.requestId })
    }).pipe(
      Effect.provide(
        repositoryVerificationBoundaryLayer.pipe(
          Layer.provide(
            Layer.succeed(
              RepositoryVerificationWrapper,
              RepositoryVerificationWrapper.of({
                runOrResume: () =>
                  Effect.fail(
                    new RepositoryVerificationWrapperInterrupted({
                      detail: "controlled interruption",
                      observations: [],
                      requestId: request.requestId,
                      signal: "SIGTERM"
                    })
                  )
              })
            )
          )
        )
      )
    )
  )

  it.effect("waits for the wrapper-owned repository lock then releases it", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem
        const directory = yield* fileSystem.makeTempDirectoryScoped({ prefix: "dalph-issue-78-wrapper-" })
        const lockPath = `${directory}/repository.lock`
        yield* Effect.gen(function* () {
          const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
          const holder = yield* spawner.spawn(
            ChildProcess.make(execPath, ["-e", lockHolderScript, lockPath], { cwd: processCwd() })
          )
          const ready = yield* holder.stdout.pipe(Stream.decodeText(), Stream.splitLines, Stream.runHead)
          expect(Option.getOrUndefined(ready)).toBe("held")

          const wrapper = yield* RepositoryVerificationWrapper
          const run = yield* wrapper.runOrResume(request)

          expect(run.terminal._tag).toBe("Passed")
          expect(run.observations.map((observation) => observation._tag)).toEqual([
            "Waiting",
            "Acquired",
            "Terminal",
            "Released"
          ])
          expect(yield* holder.exitCode).toBe(0)
        }).pipe(Effect.provide(Layer.merge(nodeWrapperLayer(waitingWrapperScript, [lockPath]), NodeServices.layer)))
      }).pipe(Effect.provide(NodeServices.layer))
    )
  )
})

describe("repository verification lifecycle boundary", () => {
  it.effect("decodes every non-passing terminal kind before release", () =>
    Effect.gen(function* () {
      for (const tag of ["Failed", "Killed", "TimedOut"] as const) {
        const run = yield* validateRun(
          request,
          wrapperLines(
            { _tag: "Waiting", requestId: request.requestId },
            { _tag: "Acquired", requestId: request.requestId },
            terminalMessage(tag),
            { _tag: "Released", requestId: request.requestId }
          ),
          0,
          ""
        )
        expect(run.terminal._tag).toBe(tag)
      }

      const invalidArtifact = yield* validateRun(
        request,
        wrapperLines(
          { _tag: "Waiting", requestId: request.requestId },
          { _tag: "Acquired", requestId: request.requestId },
          terminalMessage("Failed", [{ name: "diagnostic", bytes: "not-base64" }])
        ),
        0,
        ""
      ).pipe(Effect.flip)
      expect(invalidArtifact).toBeInstanceOf(RepositoryVerificationWrapperFailure)
      expect(invalidArtifact.detail).toBe("artifact bytes are not canonical base64")

      const nonCanonicalArtifact = yield* validateRun(
        request,
        wrapperLines(
          { _tag: "Waiting", requestId: request.requestId },
          { _tag: "Acquired", requestId: request.requestId },
          terminalMessage("Failed", [{ name: "diagnostic", bytes: "ab==" }])
        ),
        0,
        ""
      ).pipe(Effect.flip)
      expect(nonCanonicalArtifact).toBeInstanceOf(RepositoryVerificationWrapperFailure)
      expect(nonCanonicalArtifact.detail).toBe("artifact bytes are not canonical base64")
    })
  )

  it.effect("reports malformed wrapper lines with the observations seen so far", () =>
    Effect.gen(function* () {
      const prior = [{ _tag: "Waiting" as const, requestId: request.requestId }]
      const malformedJson = yield* parseWrapperMessage("{", request.requestId, prior).pipe(Effect.flip)
      expect(malformedJson).toBeInstanceOf(RepositoryVerificationWrapperFailure)
      expect(malformedJson.observations).toEqual(prior)

      const malformedSchema = yield* parseWrapperMessage(
        JSON.stringify({ _tag: "Unknown" }),
        request.requestId,
        prior
      ).pipe(Effect.flip)
      expect(malformedSchema).toBeInstanceOf(RepositoryVerificationWrapperFailure)
      expect(malformedSchema.observations).toEqual(prior)
    })
  )

  it.effect("rejects lifecycle messages that cross ownership or settlement boundaries", () =>
    Effect.gen(function* () {
      const cases = [
        { detail: "wrapper emitted terminal before acquisition", lines: wrapperLines(terminalMessage("Failed")) },
        {
          detail: "wrapper emitted duplicate or late waiting",
          lines: wrapperLines(
            { _tag: "Waiting", requestId: request.requestId },
            { _tag: "Waiting", requestId: request.requestId }
          )
        },
        {
          detail: "wrapper emitted duplicate or late acquisition",
          lines: wrapperLines(
            { _tag: "Waiting", requestId: request.requestId },
            { _tag: "Acquired", requestId: `${request.requestId}-foreign` }
          )
        },
        {
          detail: "wrapper emitted release without acquired ownership",
          lines: wrapperLines({ _tag: "Released", requestId: request.requestId })
        },
        {
          detail: "wrapper emitted release without acquired ownership",
          lines: wrapperLines(
            { _tag: "Waiting", requestId: request.requestId },
            { _tag: "Acquired", requestId: request.requestId },
            { _tag: "Released", requestId: request.requestId }
          )
        },
        {
          detail: "wrapper emitted a foreign terminal correlation",
          lines: (() => {
            const terminal = terminalMessage("Failed")
            return wrapperLines(
              { _tag: "Waiting", requestId: request.requestId },
              { _tag: "Acquired", requestId: request.requestId },
              { ...terminal, result: { ...terminal.result, correlation: { ...request, planId: "foreign" } } }
            )
          })()
        },
        {
          detail: "wrapper emitted interruption after settling",
          lines: wrapperLines(
            { _tag: "Waiting", requestId: request.requestId },
            { _tag: "Acquired", requestId: request.requestId },
            terminalMessage("Failed"),
            { _tag: "Interrupted", requestId: request.requestId, signal: "SIGTERM", detail: "late" }
          )
        },
        {
          detail: "wrapper emitted failure after settling",
          lines: wrapperLines(
            { _tag: "Waiting", requestId: request.requestId },
            { _tag: "Acquired", requestId: request.requestId },
            terminalMessage("Failed"),
            { _tag: "Failed", requestId: request.requestId, detail: "late" }
          )
        }
      ]
      for (const scenario of cases) {
        const failure = yield* validateRun(request, scenario.lines, 0, "").pipe(Effect.flip)
        expect(failure).toBeInstanceOf(RepositoryVerificationWrapperFailure)
        expect(failure.detail).toBe(scenario.detail)
      }
    })
  )

  it.effect("maps incomplete exits and non-zero passing exits without inferring success", () =>
    Effect.gen(function* () {
      const signals = [
        [130, "SIGINT"],
        [137, "SIGKILL"],
        [wrapperInterruptedExitCode, "SIGTERM"]
      ] as const
      for (const [exitCode, signal] of signals) {
        const failure = yield* validateRun(request, [], exitCode, "").pipe(Effect.flip)
        expect(failure).toBeInstanceOf(RepositoryVerificationWrapperInterrupted)
        expect(failure._tag).toBe("RepositoryVerificationWrapperInterrupted")
        if (failure._tag === "RepositoryVerificationWrapperInterrupted") expect(failure.signal).toBe(signal)
      }

      const unknownExit = yield* validateRun(request, [], 42, "  ").pipe(Effect.flip)
      expect(unknownExit).toBeInstanceOf(RepositoryVerificationWrapperFailure)
      expect(unknownExit.detail).toBe("wrapper did not provide a complete lifecycle")

      const interrupted = yield* validateRun(
        request,
        wrapperLines(
          { _tag: "Waiting", requestId: request.requestId },
          { _tag: "Acquired", requestId: request.requestId },
          { _tag: "Interrupted", requestId: request.requestId, signal: "SIGUSR1", detail: "stopped" }
        ),
        0,
        ""
      ).pipe(Effect.flip)
      expect(interrupted).toBeInstanceOf(RepositoryVerificationWrapperInterrupted)
      expect(interrupted).toMatchObject({ detail: "stopped", signal: "SIGUSR1" })

      const failed = yield* validateRun(
        request,
        wrapperLines(
          { _tag: "Waiting", requestId: request.requestId },
          { _tag: "Acquired", requestId: request.requestId },
          { _tag: "Failed", requestId: request.requestId, detail: "guard failed" }
        ),
        0,
        "fallback"
      ).pipe(Effect.flip)
      expect(failed).toBeInstanceOf(RepositoryVerificationWrapperFailure)
      expect(failed.detail).toBe("guard failed")

      const passedWithFailureExit = yield* validateRun(
        request,
        wrapperLines(
          { _tag: "Waiting", requestId: request.requestId },
          { _tag: "Acquired", requestId: request.requestId },
          terminalMessage("Passed"),
          { _tag: "Released", requestId: request.requestId }
        ),
        2,
        ""
      ).pipe(Effect.flip)
      expect(passedWithFailureExit).toBeInstanceOf(RepositoryVerificationWrapperFailure)
      expect(passedWithFailureExit.detail).toBe("wrapper exited 2 after reporting Passed")
    })
  )

  it("bounds diagnostics crossing the wrapper boundary", () => {
    expect(detailOf("x".repeat(4_096))).toHaveLength(4_096)
    expect(detailOf("x".repeat(4_097))).toBe(`${"x".repeat(4_096)}…`)
  })
})
