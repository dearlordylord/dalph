/* eslint-disable import/no-nodejs-modules -- This module owns the production host's canonical path boundary. */

import { Buffer } from "node:buffer"
import nodePath from "node:path"
import {
  AttemptId,
  GitCommitSha,
  GitRepositoryLocator,
  IntegrationTargetRef,
  type PlannedTaskAttempt,
  PlannedTaskAttempt as PlannedTaskAttemptSchema,
  type RunId,
  TaskBranchRef,
  TaskExecutorLocator,
  type TaskId,
  WorktreeLocator
} from "@dalph/contracts"
import {
  ClaimOwner,
  EvidenceStoreLocator,
  GitCommonDirectoryLocator,
  GithubIssueTarget,
  JournalDatabaseLocator,
  PlannedTaskAttemptOrdinal,
  PlannedTaskAttemptPlanner,
  type PlannedTaskAttemptError,
  type PlannedTaskAttemptPlanRequest,
  TaskWorkCapacity
} from "@dalph/orchestrator"
import { Effect, Layer, Ref, Schema, SchemaIssue } from "effect"
import { IntegratorCandidateWorktreeRoot, IntegratorPrivateStoreLocator } from "./codex-integrator-private-store.js"
import { ProductionRunReactivationInterval } from "./production.js"

const canonicalAbsolutePath = (subject: string) =>
  Schema.makeFilter<string>((value) => {
    if (!nodePath.isAbsolute(value)) return `${subject} must be absolute`
    return nodePath.normalize(value) === value ? undefined : `${subject} must be normalized`
  })

/** Canonical root used only for deterministic planned-attempt worktrees. */
export const ProductionPlannedAttemptWorktreeRoot = Schema.NonEmptyString.check(
  canonicalAbsolutePath("planned-attempt worktree root")
).pipe(Schema.brand("ProductionPlannedAttemptWorktreeRoot"))
export type ProductionPlannedAttemptWorktreeRoot = typeof ProductionPlannedAttemptWorktreeRoot.Type

/** Canonical private directory for executor and application-scoped Codex state. */
export const ProductionCodexStateDirectory = Schema.NonEmptyString.check(
  canonicalAbsolutePath("Codex state directory")
).pipe(Schema.brand("ProductionCodexStateDirectory"))
export type ProductionCodexStateDirectory = typeof ProductionCodexStateDirectory.Type

const CanonicalRepositoryLocator = GitRepositoryLocator.check(canonicalAbsolutePath("Git repository locator"))
const CanonicalCommonDirectoryLocator = GitCommonDirectoryLocator.check(
  canonicalAbsolutePath("Git common-directory locator")
)
const CanonicalJournalDatabaseLocator = JournalDatabaseLocator.check(canonicalAbsolutePath("Journal database locator"))
const CanonicalEvidenceStoreLocator = EvidenceStoreLocator.check(canonicalAbsolutePath("evidence-store locator"))
const NonEmptyExecutable = Schema.NonEmptyString.check(
  Schema.makeFilter((value) =>
    value.trim() === value ? undefined : "Codex executable must not contain edge whitespace"
  )
)

const pathContains = (parent: string, child: string): boolean =>
  parent === child || child.startsWith(`${parent}${nodePath.sep}`)

const pathsOverlap = (left: string, right: string): boolean => pathContains(left, right) || pathContains(right, left)

type HostPathFacts = {
  readonly repository: string
  readonly commonDirectory: string
  readonly journalDatabase: string
  readonly evidenceStoreRoot: string
  readonly plannedAttemptWorktreeRoot: string
  readonly codexStateDirectory: string
  readonly integratorCandidateWorktreeRoot: string
  readonly integratorPrivateStore: string
}

const hostPathRelationshipError = (value: HostPathFacts): string | undefined => {
  const worktreeRoots = [value.plannedAttemptWorktreeRoot, value.integratorCandidateWorktreeRoot] as const
  if (pathsOverlap(worktreeRoots[0], worktreeRoots[1])) {
    return "planned-attempt and Integrator candidate worktree roots must be disjoint"
  }
  const statePaths = [
    value.repository,
    value.commonDirectory,
    value.journalDatabase,
    value.evidenceStoreRoot,
    value.codexStateDirectory,
    value.integratorPrivateStore
  ] as const
  if (worktreeRoots.some((worktree) => statePaths.some((state) => pathsOverlap(worktree, state)))) {
    return "worktree roots must be disjoint from repository and private state locators"
  }
  const privateStatePaths = [
    value.journalDatabase,
    value.evidenceStoreRoot,
    value.codexStateDirectory,
    value.integratorPrivateStore
  ] as const
  for (let left = 0; left < privateStatePaths.length; left += 1) {
    for (let right = left + 1; right < privateStatePaths.length; right += 1) {
      const leftPath = privateStatePaths[left]
      const rightPath = privateStatePaths[right]
      /* v8 ignore next -- @preserve Both loop indexes are bounded by the tuple length before access. */
      if (leftPath !== undefined && rightPath !== undefined && pathsOverlap(leftPath, rightPath)) {
        return "Journal, evidence, Codex, and Integrator private state locators must be disjoint"
      }
    }
  }
  return undefined
}

const hostPathRelationships = Schema.makeFilter<HostPathFacts>(hostPathRelationshipError)

/**
 * Complete decoded input for one repository host. Production/dry selection,
 * fresh/recovered Run state, and the fixed Exit drain are deliberately absent.
 */
export const ProductionRepositoryHostConfiguration = Schema.Struct({
  target: GithubIssueTarget,
  repository: CanonicalRepositoryLocator,
  commonDirectory: CanonicalCommonDirectoryLocator,
  integrationRef: IntegrationTargetRef,
  plannedAttemptBaseSha: GitCommitSha,
  plannedAttemptExecutor: TaskExecutorLocator,
  claimOwner: ClaimOwner,
  taskWorkCapacity: TaskWorkCapacity,
  journalDatabase: CanonicalJournalDatabaseLocator,
  evidenceStoreRoot: CanonicalEvidenceStoreLocator,
  plannedAttemptWorktreeRoot: ProductionPlannedAttemptWorktreeRoot,
  codexStateDirectory: ProductionCodexStateDirectory,
  integratorCandidateWorktreeRoot: IntegratorCandidateWorktreeRoot,
  integratorPrivateStore: IntegratorPrivateStoreLocator,
  activationInterval: ProductionRunReactivationInterval,
  failureCooldown: ProductionRunReactivationInterval,
  codexExecutable: NonEmptyExecutable,
  codexClientName: Schema.NonEmptyString,
  codexClientVersion: Schema.NonEmptyString,
  codexProvider: Schema.NonEmptyString,
  githubToken: Schema.RedactedFromValue(Schema.NonEmptyString, { label: "GitHubToken", disallowEncode: true }),
  codexProviderCredential: Schema.RedactedFromValue(Schema.NonEmptyString, {
    label: "CodexProviderCredential",
    disallowEncode: true
  })
}).check(hostPathRelationships)
export type ProductionRepositoryHostConfiguration = typeof ProductionRepositoryHostConfiguration.Type

/** Safe startup failure: field and subject are retained, rejected bytes are not. */
export class ProductionRepositoryHostConfigurationError extends Schema.TaggedError<ProductionRepositoryHostConfigurationError>()(
  "ProductionRepositoryHostConfigurationError",
  { field: Schema.NonEmptyString, subject: Schema.NonEmptyString, detail: Schema.NonEmptyString }
) {}

const safeSchemaIssueFormatter = SchemaIssue.makeFormatterStandardSchemaV1({
  checkHook: SchemaIssue.defaultCheckHook,
  leafHook: (issue) => (issue._tag === "MissingKey" ? "is required" : "is invalid")
})

const safeConfigurationError = (failure: { readonly issue: SchemaIssue.Issue }) => {
  const issue = safeSchemaIssueFormatter(failure.issue).issues[0]
  const issuePath = issue?.path ?? []
  const field = typeof issuePath[0] === "string" ? issuePath[0] : "configuration"
  return new ProductionRepositoryHostConfigurationError({
    field,
    subject: field === "configuration" ? "production repository host" : `production repository host field ${field}`,
    detail: issue?.message ?? "is invalid"
  })
}

/** Decodes the complete raw host value before any caller can construct live Layers. */
export const decodeProductionRepositoryHostConfiguration = Effect.fn("ProductionRepositoryHostConfiguration.decode")(
  function* (input: unknown) {
    return yield* Schema.decodeUnknownEffect(ProductionRepositoryHostConfiguration)(input, { reportInput: false }).pipe(
      Effect.mapError(safeConfigurationError)
    )
  }
)

/** Runs a host continuation only after the complete configuration is accepted. */
export const withProductionRepositoryHostConfiguration = <A, E, R>(
  input: unknown,
  use: (configuration: ProductionRepositoryHostConfiguration) => Effect.Effect<A, E, R>
) => decodeProductionRepositoryHostConfiguration(input).pipe(Effect.flatMap(use))

/** Exact locations derived from one Run, task, and workflow-owned task-local slot. */
export const ProductionPlannedAttemptLocations = Schema.Struct({
  attemptId: AttemptId,
  branch: TaskBranchRef,
  worktree: WorktreeLocator
})
export type ProductionPlannedAttemptLocations = typeof ProductionPlannedAttemptLocations.Type

const identitySegment = (value: string): string => {
  const encoded = Buffer.from(value, "utf8").toString("hex")
  return `${encoded.length}-${encoded}`
}

/** Pure codec; Base SHA is intentionally absent because the workflow protocol owns it. */
export const deriveProductionPlannedAttemptLocations = (
  root: ProductionPlannedAttemptWorktreeRoot,
  runId: RunId,
  taskId: TaskId,
  ordinal: PlannedTaskAttemptOrdinal
): ProductionPlannedAttemptLocations => {
  const resource = `run-${identitySegment(runId)}-task-${identitySegment(taskId)}-attempt-${String(ordinal)}`
  return ProductionPlannedAttemptLocations.make({
    attemptId: AttemptId.make(`attempt:${resource}`),
    branch: TaskBranchRef.make(`refs/heads/dalph/${resource}`),
    worktree: WorktreeLocator.make(nodePath.join(root, resource))
  })
}

/**
 * Adapts the pure codec to the existing planner protocol. Fresh ordinals are
 * task-local; ExactReplacement consumes the protocol's exact Base SHA/slot.
 */
export const productionPlannedTaskAttemptLayer = (
  configuration: Pick<
    ProductionRepositoryHostConfiguration,
    "plannedAttemptBaseSha" | "plannedAttemptExecutor" | "plannedAttemptWorktreeRoot"
  >,
  runId: RunId
) =>
  Layer.effect(
    PlannedTaskAttemptPlanner,
    Effect.gen(function* () {
      const nextOrdinals = yield* Ref.make<ReadonlyMap<TaskId, number>>(new Map())
      const plan = Effect.fn("ProductionPlannedTaskAttemptPlanner.plan")(function* (
        request: PlannedTaskAttemptPlanRequest
      ): Effect.fn.Return<PlannedTaskAttempt, PlannedTaskAttemptError> {
        const taskId = request.specification.taskId
        const ordinal = yield* Ref.modify(nextOrdinals, (current) => {
          const selected = request._tag === "ExactReplacement" ? Number(request.ordinal) : (current.get(taskId) ?? 0)
          return [
            PlannedTaskAttemptOrdinal.make(selected),
            new Map(current).set(taskId, Math.max(current.get(taskId) ?? 0, selected + 1))
          ] as const
        })
        const locations = deriveProductionPlannedAttemptLocations(
          configuration.plannedAttemptWorktreeRoot,
          runId,
          taskId,
          ordinal
        )
        return PlannedTaskAttemptSchema.make({
          ...locations,
          baseSha: request._tag === "ExactReplacement" ? request.baseSha : configuration.plannedAttemptBaseSha,
          executor: configuration.plannedAttemptExecutor,
          runId,
          taskId,
          taskRevision: request.specification.fingerprint
        })
      })
      return PlannedTaskAttemptPlanner.of({ plan })
    })
  )
