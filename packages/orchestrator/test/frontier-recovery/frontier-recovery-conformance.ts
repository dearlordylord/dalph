import { Effect, Match, Schema } from "effect"
import type { OperationId, TaskId } from "../../src/domain.js"

// A manifest change is an explicit compatibility-boundary revision.
// eslint-disable-next-line no-magic-numbers -- Version two adds bounded frontier and admission selection.
export const frontierRecoveryReconstructionConformanceVersion = 3 as const
const minimumModelIdentity = 0n

/**
 * Closed M2 action inventory for reconstructed-run and bounded-frontier selection.
 */
const frontierRecoveryReconstructionActionFields = {
  init: {},
  reconstructionStep: {},
  commitFirstIntent: { task: Schema.BigInt },
  observeProvenAbsence: {},
  observeIncomparableMembership: {},
  observeCompatibleReplacement: {},
  crash: {},
  restart: {}
} as const

export const frontierRecoveryReconstructionActions = Object.keys(
  frontierRecoveryReconstructionActionFields
)

const FrontierRecoveryReconstructionAction = Schema.TaggedUnion(
  frontierRecoveryReconstructionActionFields
)
export type FrontierRecoveryReconstructionAction = typeof FrontierRecoveryReconstructionAction.Type
export type FrontierRecoveryReconstructionActionFields = {
  readonly [Action in FrontierRecoveryReconstructionAction as Action["_tag"]]: {
    readonly [Field in Exclude<keyof Action, "_tag">]: unknown
  }
}

export interface TargetClosureObservationInput {
  readonly explicitlyCoveredTasks: ReadonlyArray<bigint>
  readonly operation: bigint
  readonly predecessorOperations: ReadonlyArray<bigint>
  readonly revision: bigint
  readonly tasks: ReadonlyArray<bigint>
}

export interface FrontierRecoveryReconstructionControls<A, E, R> {
  readonly commitFirstIntent: (task: bigint) => Effect.Effect<A, E, R>
  readonly crash: () => Effect.Effect<A, E, R>
  readonly init: () => Effect.Effect<A, E, R>
  readonly observeCompatibleReplacement: () => Effect.Effect<A, E, R>
  readonly observeIncomparableMembership: () => Effect.Effect<A, E, R>
  readonly observeProvenAbsence: () => Effect.Effect<A, E, R>
  readonly reconstructionStep: () => Effect.Effect<A, E, R>
  readonly restart: () => Effect.Effect<A, E, R>
}

/** A model action or identity cannot cross the M2 conformance boundary. */
export class FrontierRecoveryConformanceIssue extends Schema.TaggedErrorClass<FrontierRecoveryConformanceIssue>()(
  "FrontierRecoveryConformanceIssue",
  {
    detail: Schema.String,
    reason: Schema.Literals([
      "DuplicateBrandedIdentity",
      "DuplicateModelIdentity",
      "LossyProjection",
      "MissingMapping",
      "UnknownAction",
      "UnknownModelIdentity"
    ])
  }
) {}

export const runFrontierRecoveryReconstructionAction = Effect.fn(
  "FrontierRecoveryConformance.runAction"
)(function*<A, E, R>(
  input: unknown,
  controls: FrontierRecoveryReconstructionControls<A, E, R>
) {
  const action = yield* Schema.decodeUnknownEffect(
    FrontierRecoveryReconstructionAction
  )(input).pipe(
    Effect.mapError(() =>
      new FrontierRecoveryConformanceIssue({
        detail: `unknown M2 reconstruction action ${String(input)}`,
        reason: "UnknownAction"
      })
    )
  )
  return yield* Match.value(action).pipe(
    Match.tags({
      commitFirstIntent: ({ task }) => controls.commitFirstIntent(task),
      crash: controls.crash,
      init: controls.init,
      observeCompatibleReplacement: controls.observeCompatibleReplacement,
      observeIncomparableMembership: controls.observeIncomparableMembership,
      observeProvenAbsence: controls.observeProvenAbsence,
      reconstructionStep: controls.reconstructionStep,
      restart: controls.restart
    }),
    Match.exhaustive
  )
})

interface IdentityEntry<A> {
  readonly branded: A
  readonly model: bigint
}

interface FrontierRecoveryIdentityMappingInput {
  readonly operations: ReadonlyArray<IdentityEntry<OperationId>>
  readonly tasks: ReadonlyArray<IdentityEntry<TaskId>>
}

const duplicate = <A>(
  entries: ReadonlyArray<IdentityEntry<A>>,
  select: (entry: IdentityEntry<A>) => A | bigint
): boolean => {
  const values = entries.map(select)
  return new Set(values).size !== values.length
}

const mappingIssue = (
  reason: FrontierRecoveryConformanceIssue["reason"],
  detail: string
) => new FrontierRecoveryConformanceIssue({ detail, reason })

const requireMapped = <A>(
  values: ReadonlyMap<bigint, A>,
  model: bigint,
  kind: "operation" | "task"
): Effect.Effect<A, FrontierRecoveryConformanceIssue> => {
  const value = values.get(model)
  return value === undefined
    ? Effect.fail(mappingIssue("UnknownModelIdentity", `unknown M2 ${kind} identity ${model}`))
    : Effect.succeed(value)
}

const requireModel = <A>(
  values: ReadonlyMap<A, bigint>,
  branded: A,
  kind: "operation" | "task"
): Effect.Effect<bigint, FrontierRecoveryConformanceIssue> => {
  const value = values.get(branded)
  return value === undefined
    ? Effect.fail(mappingIssue("UnknownModelIdentity", `unmapped Dalph ${kind} identity ${String(branded)}`))
    : Effect.succeed(value)
}

/** Builds the bounded, bijective M2-to-Dalph identity projection. */
export const makeFrontierRecoveryIdentityMapping = Effect.fn(
  "FrontierRecoveryConformance.makeIdentityMapping"
)(function*(input: FrontierRecoveryIdentityMappingInput) {
  if (input.tasks.length === 0 || input.operations.length === 0) {
    return yield* mappingIssue(
      "MissingMapping",
      "the M2 reconstruction slice requires task and operation identity mappings"
    )
  }
  if (
    duplicate(input.tasks, ({ model }) => model)
    || duplicate(input.operations, ({ model }) => model)
  ) {
    return yield* mappingIssue(
      "DuplicateModelIdentity",
      "one M2 identity cannot map to multiple Dalph identities"
    )
  }
  if (
    duplicate(input.tasks, ({ branded }) => branded)
    || duplicate(input.operations, ({ branded }) => branded)
  ) {
    return yield* mappingIssue(
      "DuplicateBrandedIdentity",
      "one Dalph identity cannot map to multiple M2 identities"
    )
  }
  if (
    [...input.tasks, ...input.operations].some(
      ({ model }) => model < minimumModelIdentity
    )
  ) {
    return yield* mappingIssue(
      "LossyProjection",
      "bounded M2 identities must be non-negative integers"
    )
  }

  const operationsByModel = new Map(input.operations.map(({ branded, model }) => [model, branded]))
  const operationModels = new Map(input.operations.map(({ branded, model }) => [branded, model]))
  const tasksByModel = new Map(input.tasks.map(({ branded, model }) => [model, branded]))
  const taskModels = new Map(input.tasks.map(({ branded, model }) => [branded, model]))

  return {
    operationFromModel: (model: bigint) => requireMapped(operationsByModel, model, "operation"),
    operationToModel: (branded: OperationId) => requireModel(operationModels, branded, "operation"),
    taskFromModel: (model: bigint) => requireMapped(tasksByModel, model, "task"),
    taskToModel: (branded: TaskId) => requireModel(taskModels, branded, "task")
  } as const
})
