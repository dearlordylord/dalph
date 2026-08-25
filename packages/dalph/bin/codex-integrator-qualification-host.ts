#!/usr/bin/env node
/* eslint-disable import/no-nodejs-modules -- this executable owns the second Dalph process boundary. */
/* eslint-disable functional/immutable-data -- one-shot process output is the qualification protocol. */

import nodeProcess from "node:process"
import { NodeFileSystem, NodeServices } from "@effect/platform-node"
import { Effect, Layer, Schema } from "effect"
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
  IntegratorCandidateResourceLocator,
  IntegratorRequest,
  IntegratorRunCorrelation,
  IntegratorRunOrdinal,
  IntegratorSessionCorrelation,
  IntegratorSessionId,
  JournalPosition,
  nodeGitCommandLayer,
  productionCoordinatorOwnershipLayer
} from "@dalph/orchestrator"
import { codexAppServerNodeLayer, nodeCodexOwnedActivityCensusLayer } from "../src/application/codex-app-server.js"
import { memoryCodexAttemptStoreLayer } from "../src/application/codex-attempt-store.js"
import { nodeCodexIntegratorLayer } from "../src/application/codex-integrator.js"
import {
  CodexIntegratorConfiguration,
  IntegratorCandidateWorktreeRoot,
  IntegratorPrivateStoreLocator
} from "../src/application/codex-integrator-private-store.js"

const QualificationInputSchema = Schema.Struct({
  repository: Schema.NonEmptyString,
  commonDirectory: Schema.NonEmptyString,
  candidateRoot: Schema.NonEmptyString,
  privateStore: Schema.NonEmptyString,
  candidateResource: Schema.NonEmptyString,
  expectedTargetHead: Schema.NonEmptyString,
  acceptedCommit: Schema.NonEmptyString,
  targetRef: Schema.NonEmptyString,
  sessionId: Schema.NonEmptyString,
  plannedWorktree: Schema.NonEmptyString
})
type QualificationInput = typeof QualificationInputSchema.Type

const qualificationEvidenceDigestLength = 64
const qualificationStartedAt = 2
const qualificationTargetLineageObservedAt = 3

class QualificationInputFailure extends Schema.TaggedError<QualificationInputFailure>()("QualificationInputFailure", {
  detail: Schema.String
}) {}

const inputValue = (): Effect.Effect<QualificationInput, unknown> => {
  const encoded = nodeProcess.env["DALPH_INTEGRATOR_QUALIFICATION_INPUT"]
  if (encoded === undefined) {
    return Effect.fail(new QualificationInputFailure({ detail: "missing DALPH_INTEGRATOR_QUALIFICATION_INPUT" }))
  }
  return Effect.try({
    try: () => JSON.parse(encoded),
    catch: (cause) => new QualificationInputFailure({ detail: `qualification input is malformed: ${String(cause)}` })
  }).pipe(Effect.flatMap(Schema.decodeUnknownEffect(QualificationInputSchema)))
}

const requestFor = (input: QualificationInput): IntegratorRequest => {
  const repository = GitRepositoryLocator.make(input.repository)
  const head = GitCommitSha.make(input.expectedTargetHead)
  const session = IntegratorSessionCorrelation.make({
    acceptedResult: AcceptedResult.make({
      commit: GitCommitSha.make(input.acceptedCommit),
      evidenceManifest: EvidenceReference.make({
        byteLength: 0,
        digest: EvidenceDigest.make("0".repeat(qualificationEvidenceDigestLength))
      })
    }),
    candidateResource: IntegratorCandidateResourceLocator.make(input.candidateResource),
    expectedTargetHead: head,
    integrationTarget: IntegrationTarget.make({ repository, ref: IntegrationTargetRef.make(input.targetRef) }),
    plannedAttempt: PlannedTaskAttempt.make({
      attemptId: AttemptId.make("qualification-attempt"),
      baseSha: head,
      branch: TaskBranchRef.make("refs/heads/qualification"),
      executor: TaskExecutorLocator.make("qualification-executor"),
      runId: RunId.make("qualification-run"),
      taskId: TaskId.make("qualification-task"),
      taskRevision: TaskRevision.make("qualification-revision"),
      worktree: WorktreeLocator.make(input.plannedWorktree)
    }),
    queuedAt: JournalPosition.make(1),
    sessionId: IntegratorSessionId.make(input.sessionId),
    startedAt: JournalPosition.make(qualificationStartedAt),
    targetLineageObservedAt: JournalPosition.make(qualificationTargetLineageObservedAt)
  })
  return IntegratorRequest.make({
    correlation: IntegratorRunCorrelation.make({ ordinal: IntegratorRunOrdinal.make(1), session })
  })
}

const run = Effect.gen(function* () {
  const input = yield* inputValue()
  const config = CodexIntegratorConfiguration.make({
    candidateWorktreeRoot: IntegratorCandidateWorktreeRoot.make(input.candidateRoot),
    commonDirectory: GitCommonDirectoryLocator.make(input.commonDirectory),
    privateStoreLocator: IntegratorPrivateStoreLocator.make(input.privateStore),
    repository: GitRepositoryLocator.make(input.repository)
  })
  const app = codexAppServerNodeLayer({
    executable: nodeProcess.env["DALPH_QUALIFICATION_CODEX_EXECUTABLE"] ?? "codex",
    environment: {
      CODEX_HOME: nodeProcess.env["DALPH_QUALIFICATION_CODEX_HOME"] ?? "",
      DALPH_QUALIFICATION_MODEL_ENDPOINT: nodeProcess.env["DALPH_QUALIFICATION_MODEL_ENDPOINT"] ?? "",
      DALPH_QUALIFICATION_STATE: nodeProcess.env["DALPH_QUALIFICATION_STATE"] ?? ""
    }
  }).pipe(Layer.provide(memoryCodexAttemptStoreLayer()), Layer.provide(NodeServices.layer))
  const ownership = productionCoordinatorOwnershipLayer(GitCommonDirectoryTarget.make(input.commonDirectory)).pipe(
    Layer.provide(NodeFileSystem.layer)
  )
  const integrator = nodeCodexIntegratorLayer(config)
    .pipe(Layer.provide(nodeCodexOwnedActivityCensusLayer))
    .pipe(Layer.provide(app))
    .pipe(Layer.provide(NodeFileSystem.layer))
    .pipe(Layer.provide(nodeGitCommandLayer.pipe(Layer.provide(NodeServices.layer))))
    .pipe(Layer.provide(ownership))
  const result = yield* Effect.scoped(
    Effect.gen(function* () {
      const service = yield* Integrator
      return yield* service.prepare(requestFor(input))
    }).pipe(Effect.provide(integrator))
  )
  nodeProcess.stdout.write(`${JSON.stringify({ _tag: result._tag })}\n`)
})

Effect.runPromise(run).catch((error: unknown) => {
  const detail = error instanceof Error ? error.message : String(error)
  const providerDetail = typeof error === "object" && error !== null && "detail" in error ? String(error.detail) : ""
  nodeProcess.stderr.write(`${detail}${providerDetail.length === 0 ? "" : `: ${providerDetail}`}\n`)
  nodeProcess.exitCode = 1
})
