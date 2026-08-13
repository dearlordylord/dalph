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
  RepositoryVerificationWrapper,
  RepositoryVerificationWrapperFailure,
  RepositoryVerificationWrapperInterrupted
} from "./repository-resource-lock.js"

const nodeWrapperLayer = (script: string, args: ReadonlyArray<string> = []) =>
  nodeRepositoryVerificationWrapperLayer({ args: ["-e", script, ...args], executable: execPath }).pipe(
    Layer.provide(NodeServices.layer)
  )

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

const failedWrapperScript = `
const fs = require("node:fs")
const request = JSON.parse(fs.readFileSync(0, "utf8"))
const emit = (message) => process.stdout.write(JSON.stringify(message) + "\\n")
emit({ _tag: "Waiting", requestId: request.requestId })
emit({ _tag: "Acquired", requestId: request.requestId })
emit({ _tag: "Failed", requestId: request.requestId, detail: "guarded command failed" })
process.exitCode = 2
`

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
    }).pipe(Effect.provide(nodeWrapperLayer(interruptedWrapperScript)))
  )

  it.effect("rejects malformed or incomplete wrapper output", () =>
    Effect.gen(function* () {
      const wrapper = yield* RepositoryVerificationWrapper
      const failure = yield* wrapper.runOrResume(request).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(RepositoryVerificationWrapperFailure)
      expect(failure).toMatchObject({ requestId: request.requestId })
    }).pipe(Effect.provide(nodeWrapperLayer(malformedWrapperScript)))
  )

  it.effect("maps wrapper failure and missing release to a fail-closed boundary failure", () =>
    Effect.gen(function* () {
      const boundary = yield* TargetVerificationBoundary
      const failure = yield* boundary.runOrResume(request).pipe(Effect.flip)

      expect(failure).toBeInstanceOf(TargetVerificationBoundaryFailure)
      expect(failure).toMatchObject({ requestId: request.requestId, detail: "guarded command failed" })
    }).pipe(
      Effect.provide(
        nodeTargetVerificationBoundaryLayer({ args: ["-e", failedWrapperScript], executable: execPath }).pipe(
          Layer.provide(NodeServices.layer)
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
