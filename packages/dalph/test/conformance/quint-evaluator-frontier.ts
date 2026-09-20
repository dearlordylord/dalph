/* eslint-disable import/no-nodejs-modules -- The bounded oracle reads and hashes the repository-owned model. */
/* eslint-disable functional/immutable-data -- Evaluator choice discovery uses invocation-local queues. */
/* eslint-disable functional/no-throw-statements -- Model drift and incomplete enumeration must fail closed. */
/* eslint-disable max-lines -- The evaluator adapter keeps the typed-IR boundary auditable in one file. */
/* eslint-disable no-restricted-globals -- The bounded adapter measures evaluator CPU and wall time. */
/* eslint-disable no-magic-numbers -- Quint bounds and bounded checker units are explicit protocol constants. */
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { load, parse, typecheck } from "@informalsystems/quint/dist/src/cliCommands.js"
import { toExpr } from "@informalsystems/quint/dist/src/cliHelpers.js"
import type { LookupTable, QuintApp, QuintDef, QuintEx, QuintLet } from "@informalsystems/quint"
import type {
  CLIProcedure,
  LoadedStage,
  ParsedStage,
  TypecheckedStage
} from "@informalsystems/quint/dist/src/cliCommands.js"
import { Evaluator } from "@informalsystems/quint/dist/src/runtime/impl/evaluator.js"
import { rv } from "@informalsystems/quint/dist/src/runtime/impl/runtimeValue.js"
import { newTraceRecorder } from "@informalsystems/quint/dist/src/runtime/trace.js"
import { newRng } from "@informalsystems/quint/dist/src/rng.js"
import type { Rng } from "@informalsystems/quint/dist/src/rng.js"
import { version as quintVersion } from "@informalsystems/quint/dist/src/version.js"

const canonicalModelSourceSha256 = "ba1869b69d4536cd5883064c477bad6c678795e1c32bb2d25a4c30d571adc710"
const resumeRedeliveryStepName = "resumeRedeliveryMbtStep"
const expectedResumeRedeliveryBranchCount = 15

/** A complete transition returned by the imported Quint evaluator. */
export type ModelTransition = {
  readonly branchIndex: number
  readonly branchIr: string
  readonly actionNames: ReadonlyArray<string>
  readonly actionName: string | undefined
  readonly choiceVector: ReadonlyArray<bigint>
  readonly nondetPicks: ReadonlyArray<{ readonly name: string; readonly value: QuintEx }>
  readonly preState: QuintEx
  readonly postState: QuintEx
}

export type FrontierNode = { readonly state: QuintEx; readonly path: ReadonlyArray<ModelTransition> }

export type OracleLoadMeasurement = {
  readonly wallMs: number
  readonly cpuMs: number
  readonly sourceSha256: string
  readonly quintVersion: string
}

type LoadedOracle = {
  readonly table: LookupTable
  readonly init: QuintEx
  readonly step: QuintEx
  readonly stepDefinition: QuintDef
  readonly actionAny: QuintApp
  readonly branches: ReadonlyArray<QuintEx>
  readonly branchActionNames: ReadonlyArray<ReadonlyArray<string>>
  readonly branchHasNestedNondet: ReadonlyArray<boolean>
  readonly initialState: QuintEx
  readonly sourceSha256: string
  readonly loadMeasurement: OracleLoadMeasurement
}

type ResumeRedeliveryOracle = LoadedOracle & {
  readonly enumerateSuccessors: (state: QuintEx) => ReadonlyArray<ModelTransition>
  readonly enumerateSuccessorsForAction: (state: QuintEx, actionName: string) => ReadonlyArray<ModelTransition>
  readonly enumerateSuccessorsForActionReversed: (state: QuintEx, actionName: string) => ReadonlyArray<ModelTransition>
  readonly ordinarySuccessor: (state: QuintEx, seed: bigint) => ModelTransition | undefined
}

type ChoiceDiscovery = { readonly index: number; readonly bound: bigint }
type OuterChoicePosition = { readonly rawPosition: number; readonly bound: bigint }

const maxChoiceBound = 4096n
const maxChoiceEvaluations = 100000
const maxWallMs = 90000

const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_, nested) => (typeof nested === "bigint" ? `${nested}n` : nested))

const quintIrIdentity = canonicalJson

/** Compare evaluator samples on the model state while retaining runtime metadata in transitions. */
export const quintModelStateIdentity = (expression: QuintEx): string => {
  if (expression.kind !== "app" || expression.opcode !== "Rec") return canonicalJson(expression)
  for (let index = 0; index < expression.args.length; index += 2) {
    const key = expression.args[index]
    const value = expression.args[index + 1]
    if (key?.kind === "str" && key.value === "state" && value !== undefined) return canonicalJson(value)
  }
  return canonicalJson(expression)
}

const unwrapStage = <T>(result: CLIProcedure<T>): T => {
  if (result.isLeft()) throw new Error(`Quint operation failed: ${result.value.msg}`)
  return result.value
}

const isTrue = (expression: QuintEx): boolean => expression.kind === "bool" && expression.value

const isNondetLet = (expression: QuintEx, expectedName: string, setName?: string): expression is QuintLet =>
  expression.kind === "let" &&
  expression.opdef.name === expectedName &&
  expression.opdef.qualifier === "nondet" &&
  expression.opdef.expr.kind === "app" &&
  expression.opdef.expr.opcode === "oneOf" &&
  expression.opdef.expr.args.length === 1 &&
  (setName === undefined ||
    (expression.opdef.expr.args[0]?.kind === "name" && expression.opdef.expr.args[0].name === setName))

const actionNamesIn = (expression: QuintEx, table: LookupTable, names = new Set<string>()): ReadonlyArray<string> => {
  switch (expression.kind) {
    case "name": {
      const definition = table.get(expression.id)
      if (definition?.kind === "def" && definition.qualifier === "action") names.add(definition.name)
      return [...names]
    }
    case "app": {
      const definition = table.get(expression.id)
      if (definition?.kind === "def" && definition.qualifier === "action") names.add(definition.name)
      expression.args.forEach((argument) => actionNamesIn(argument, table, names))
      return [...names]
    }
    case "lambda":
      return actionNamesIn(expression.expr, table, names)
    case "let":
      actionNamesIn(expression.opdef.expr, table, names)
      return actionNamesIn(expression.expr, table, names)
    case "bool":
    case "int":
    case "str":
    default:
      return [...names]
  }
}

const findActionAny = (expression: QuintEx, found: Array<QuintApp> = []): ReadonlyArray<QuintApp> => {
  switch (expression.kind) {
    case "app":
      if (expression.opcode === "actionAny") found.push(expression)
      expression.args.forEach((argument) => findActionAny(argument, found))
      return found
    case "lambda":
      return findActionAny(expression.expr, found)
    case "let":
      findActionAny(expression.opdef.expr, found)
      return findActionAny(expression.expr, found)
    case "name":
    case "bool":
    case "int":
    case "str":
    default:
      return found
  }
}

const cloneWithActionAnyBranch = (expression: QuintEx, actionAnyId: bigint, branch: QuintEx): QuintEx => {
  switch (expression.kind) {
    case "app":
      if (expression.id === actionAnyId) return branch
      return {
        ...expression,
        args: expression.args.map((argument) => cloneWithActionAnyBranch(argument, actionAnyId, branch))
      }
    case "lambda":
      return { ...expression, expr: cloneWithActionAnyBranch(expression.expr, actionAnyId, branch) }
    case "let":
      return {
        ...expression,
        opdef: { ...expression.opdef, expr: cloneWithActionAnyBranch(expression.opdef.expr, actionAnyId, branch) },
        expr: cloneWithActionAnyBranch(expression.expr, actionAnyId, branch)
      }
    case "name":
    case "bool":
    case "int":
    case "str":
    default:
      return expression
  }
}

const expressionNames = (expression: QuintEx, names = new Set<string>()): ReadonlySet<string> => {
  switch (expression.kind) {
    case "name":
      names.add(expression.name)
      return names
    case "app":
      expression.args.forEach((argument) => expressionNames(argument, names))
      return names
    case "lambda":
      return expressionNames(expression.expr, names)
    case "let":
      expressionNames(expression.opdef.expr, names)
      return expressionNames(expression.expr, names)
    case "bool":
    case "int":
    case "str":
    default:
      return names
  }
}

const resolveDefinitionExpression = (table: LookupTable, expression: QuintEx, seen = new Set<bigint>()): QuintEx => {
  if (expression.kind !== "name") return expression
  if (seen.has(expression.id)) throw new Error(`Quint definition cycle at ${expression.name}`)
  const definition = table.get(expression.id)
  if (definition?.kind !== "def") return expression
  seen.add(expression.id)
  return resolveDefinitionExpression(table, definition.expr, seen)
}

const containsNestedNondet = (table: LookupTable, expression: QuintEx, seen = new Set<bigint>()): boolean => {
  switch (expression.kind) {
    case "let":
      return (
        expression.opdef.qualifier === "nondet" ||
        containsNestedNondet(table, expression.opdef.expr, seen) ||
        containsNestedNondet(table, expression.expr, seen)
      )
    case "name": {
      const definition = table.get(expression.id)
      if (definition?.kind !== "def" || seen.has(definition.id)) return false
      seen.add(definition.id)
      const result = containsNestedNondet(table, definition.expr, seen)
      seen.delete(definition.id)
      return result
    }
    case "app":
      return expression.args.some((argument) => containsNestedNondet(table, argument, seen))
    case "lambda":
      return containsNestedNondet(table, expression.expr, seen)
    case "bool":
    case "int":
    case "str":
      return false
  }
}

const makeChoiceVectorRng = (
  vector: ReadonlyArray<bigint>,
  ignoredRawPositions: ReadonlySet<number>,
  ignoredBounds: ReadonlySet<bigint>
) => {
  let currentVector = vector
  let rawCursor = 0
  let effectiveCursor = 0
  let firstMissing: ChoiceDiscovery | undefined
  const rng: Rng = {
    getState: () => BigInt(rawCursor),
    setState: (state) => {
      if (state < 0n || state > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("invalid choice-vector cursor")
      rawCursor = Number(state)
    },
    next: (bound) => {
      if (bound <= 0n) throw new Error(`Quint requested an invalid nondeterministic bound ${bound}`)
      if (bound > maxChoiceBound) throw new Error(`Quint nondeterminism exceeds the bounded frontier (${bound})`)
      const rawPosition = rawCursor
      rawCursor += 1
      if (ignoredRawPositions.has(rawPosition) || ignoredBounds.has(bound)) return 0n
      const effectivePosition = effectiveCursor
      effectiveCursor += 1
      const value = currentVector[effectivePosition]
      if (value === undefined) {
        firstMissing ??= { index: effectivePosition, bound }
        return 0n
      }
      if (value < 0n || value >= bound) throw new Error("choice vector is outside the evaluator bound")
      return value
    }
  }
  return {
    rng,
    reset: (nextVector: ReadonlyArray<bigint>) => {
      currentVector = nextVector
      rawCursor = 0
      effectiveCursor = 0
      firstMissing = undefined
    },
    cursor: () => effectiveCursor,
    missing: () => firstMissing
  }
}

const evaluatorFor = (table: LookupTable, rng: Rng): Evaluator =>
  new Evaluator(table, newTraceRecorder(0, rng, 1), rng, true)

const initialStateFor = (table: LookupTable, init: QuintEx): QuintEx => {
  const rng = newRng(0n)
  const evaluator = evaluatorFor(table, rng)
  const result = evaluator.evaluate(init)
  if (result.isLeft() || !isTrue(result.value)) throw new Error("Quint init did not complete")
  evaluator.shift()
  return rv.toQuintEx(evaluator.ctx.varStorage.asRecord())
}

const makePreparedEvaluator = (
  oracle: LoadedOracle,
  state: QuintEx,
  ignoredRawPositions: ReadonlySet<number>,
  ignoredBounds: ReadonlySet<bigint>,
  actionNames: ReadonlyArray<string>
) => {
  const choice = makeChoiceVectorRng([], ignoredRawPositions, ignoredBounds)
  const evaluator = evaluatorFor(oracle.table, choice.rng)
  const initialized = evaluator.evaluate(oracle.init)
  if (initialized.isLeft() || !isTrue(initialized.value)) throw new Error("Quint init did not complete")
  evaluator.shift()
  return {
    evaluate: (
      branchIndex: number,
      branchExpression: QuintEx,
      choiceVector: ReadonlyArray<bigint>
    ): { readonly transition?: ModelTransition; readonly missing?: ChoiceDiscovery } => {
      choice.reset(choiceVector)
      evaluator.reset()
      evaluator.updateState(state)
      const result = evaluator.evaluate(branchExpression)
      const missing = choice.missing()
      if (missing !== undefined) return { missing }
      if (result.isLeft() || !isTrue(result.value)) return {}
      const actionName = evaluator.ctx.varStorage.actionTaken
      const nondetPicks = [...evaluator.ctx.varStorage.nondetPicks.entries()].flatMap(([name, value]) =>
        value === undefined ? [] : [{ name, value: rv.toQuintEx(value) }]
      )
      evaluator.shift()
      const postState = rv.toQuintEx(evaluator.ctx.varStorage.asRecord())
      return {
        transition: {
          branchIndex,
          branchIr: quintIrIdentity(branchExpression),
          actionNames,
          actionName,
          choiceVector: choiceVector.slice(0, choice.cursor()),
          nondetPicks,
          preState: state,
          postState
        }
      }
    }
  }
}

const enumerateBranch = (
  oracle: LoadedOracle,
  state: QuintEx,
  branchIndex: number,
  branchExpression: QuintEx,
  ignoredOuterNames: ReadonlySet<string>,
  outerChoicePositions: ReadonlyMap<string, OuterChoicePosition>,
  usedOuterNames: ReadonlySet<string>,
  hasNestedNondet: boolean
) => {
  const pending: Array<ReadonlyArray<bigint>> = [[]]
  const transitions: Array<ModelTransition> = []
  const seen = new Set<string>()
  let evaluations = 0
  const started = performance.now()
  const ignoredRawPositions = new Set<number>()
  const ignoredBounds = new Set<bigint>()
  for (const [name, position] of outerChoicePositions.entries())
    if (ignoredOuterNames.has(name) && !usedOuterNames.has(name)) {
      ignoredRawPositions.add(position.rawPosition)
      // The Quint evaluator can revisit an unused outer binding while testing
      // the same branch.  A bound fallback is safe only for a branch proven to
      // contain no nested nondet expression; nested branches use raw positions
      // exclusively so every nested choice remains enumerable.
      if (!hasNestedNondet) ignoredBounds.add(position.bound)
    }
  const evaluator = makePreparedEvaluator(
    oracle,
    state,
    ignoredRawPositions,
    ignoredBounds,
    oracle.branchActionNames[branchIndex] ?? []
  )
  while (pending.length > 0) {
    if (evaluations >= maxChoiceEvaluations)
      throw new Error(`Quint choice-vector frontier exhausted its safety fuse at branch ${branchIndex}`)
    if (performance.now() - started > maxWallMs)
      throw new Error(`Quint choice-vector frontier exceeded its safety fuse at branch ${branchIndex}`)
    const vector = pending.pop()
    if (vector === undefined) break
    evaluations += 1
    const result = evaluator.evaluate(branchIndex, branchExpression, vector)
    if (result.missing !== undefined) {
      for (let value = 0n; value < result.missing.bound; value += 1n) pending.push([...vector, value])
      continue
    }
    const transition = result.transition
    if (transition === undefined) continue
    const identity = canonicalJson({
      branchIr: transition.branchIr,
      nondetPicks: transition.nondetPicks,
      postState: transition.postState
    })
    if (seen.has(identity)) continue
    seen.add(identity)
    transitions.push(transition)
  }
  return transitions
}

const validateShape = (
  table: LookupTable,
  definition: QuintDef,
  bindings: ReadonlyArray<{ readonly name: string; readonly setName?: string }>,
  expectedBranchCount: number
): { readonly expression: QuintEx; readonly actionAny: QuintApp; readonly branches: ReadonlyArray<QuintEx> } => {
  if (definition.kind !== "def") throw new Error(`${definition.name} is not an operator definition`)
  const definitionExpression = definition.expr
  let expression = resolveDefinitionExpression(table, definitionExpression)
  for (const binding of bindings) {
    if (!isNondetLet(expression, binding.name, binding.setName))
      throw new Error(`${definition.name} ${binding.name} nondet binding drifted`)
    expression = expression.expr
  }
  const actionAny = expression
  if (actionAny.kind !== "app" || actionAny.opcode !== "actionAny")
    throw new Error(`${definition.name} outer actionAny drifted`)
  const actionAnys = findActionAny(resolveDefinitionExpression(table, definitionExpression))
  if (actionAnys.length !== 1 || actionAnys[0]?.id !== actionAny.id)
    throw new Error(`${definition.name} must contain exactly one finite outer actionAny`)
  if (actionAny.args.length !== expectedBranchCount)
    throw new Error(
      `${definition.name} actionAny branch count drifted: expected ${expectedBranchCount}, got ${actionAny.args.length}`
    )
  return { expression: resolveDefinitionExpression(table, definitionExpression), actionAny, branches: actionAny.args }
}

const loadOracleFromTypedStage = (
  typed: TypecheckedStage,
  sourceSha256: string,
  startedWall: number,
  startedCpu: NodeJS.CpuUsage,
  stepName: string,
  bindings: ReadonlyArray<{ readonly name: string; readonly setName?: string }>,
  expectedBranchCount: number,
  ignoredOuterNames: ReadonlySet<string>,
  outerChoicePositions: ReadonlyMap<string, OuterChoicePosition>
): ResumeRedeliveryOracle => {
  const init = toExpr(typed, "init")
  const step = toExpr(typed, stepName)
  if (init.isLeft() || step.isLeft()) throw new Error("Quint oracle expressions could not be resolved")
  const definition = typed.table.get(step.value.id)
  if (definition === undefined || definition.kind !== "def") throw new Error("Quint step definition is unavailable")
  const { actionAny, branches, expression } = validateShape(typed.table, definition, bindings, expectedBranchCount)
  const branchActionNames = branches.map((branch) => actionNamesIn(branch, typed.table))
  const branchHasNestedNondet = branches.map((branch) => containsNestedNondet(typed.table, branch))
  const initialState = initialStateFor(typed.table, init.value)
  const loadMeasurement: OracleLoadMeasurement = {
    wallMs: performance.now() - startedWall,
    cpuMs: (() => {
      const usage = process.cpuUsage(startedCpu)
      return (usage.user + usage.system) / 1000
    })(),
    sourceSha256,
    quintVersion
  }
  const loaded: LoadedOracle = {
    table: typed.table,
    init: init.value,
    step: step.value,
    stepDefinition: definition,
    actionAny,
    branches,
    branchActionNames,
    branchHasNestedNondet,
    initialState,
    sourceSha256,
    loadMeasurement
  }
  return {
    ...loaded,
    enumerateSuccessors: (state) =>
      branches.flatMap((branch, branchIndex) =>
        enumerateBranch(
          loaded,
          state,
          branchIndex,
          cloneWithActionAnyBranch(expression, actionAny.id, branch),
          ignoredOuterNames,
          outerChoicePositions,
          new Set(expressionNames(branch)),
          loaded.branchHasNestedNondet[branchIndex] ?? true
        )
      ),
    enumerateSuccessorsForAction: (state, actionName) =>
      branches.flatMap((branch, branchIndex) =>
        (branchActionNames[branchIndex] ?? []).includes(actionName)
          ? enumerateBranch(
              loaded,
              state,
              branchIndex,
              cloneWithActionAnyBranch(expression, actionAny.id, branch),
              ignoredOuterNames,
              outerChoicePositions,
              new Set(expressionNames(branch)),
              loaded.branchHasNestedNondet[branchIndex] ?? true
            )
          : []
      ),
    enumerateSuccessorsForActionReversed: (state, actionName) => {
      const transitions = branches.flatMap((branch, branchIndex) =>
        (branchActionNames[branchIndex] ?? []).includes(actionName)
          ? enumerateBranch(
              loaded,
              state,
              branchIndex,
              cloneWithActionAnyBranch(expression, actionAny.id, branch),
              ignoredOuterNames,
              outerChoicePositions,
              new Set(expressionNames(branch)),
              loaded.branchHasNestedNondet[branchIndex] ?? true
            )
          : []
      )
      return transitions.reverse()
    },
    ordinarySuccessor: (state, seed) => {
      const rng = newRng(seed)
      const evaluator = evaluatorFor(typed.table, rng)
      const initialized = evaluator.evaluate(init.value)
      if (initialized.isLeft() || !isTrue(initialized.value)) throw new Error("Quint init did not complete")
      evaluator.shift()
      evaluator.updateState(state)
      const result = evaluator.evaluate(step.value)
      if (result.isLeft() || !isTrue(result.value)) return undefined
      const actionTaken = evaluator.ctx.varStorage.actionTaken
      evaluator.shift()
      const postState = rv.toQuintEx(evaluator.ctx.varStorage.asRecord())
      const branchIndex =
        actionTaken === undefined
          ? -1
          : branches.findIndex((branch) => branch.kind === "name" && branch.name === actionTaken)
      return {
        branchIndex,
        branchIr:
          branchIndex >= 0 && branches[branchIndex] !== undefined
            ? quintIrIdentity(branches[branchIndex])
            : "ordinary-evaluator",
        actionNames: actionTaken === undefined ? [] : [actionTaken],
        actionName: actionTaken,
        choiceVector: [],
        nondetPicks: [],
        preState: state,
        postState
      }
    }
  }
}

const parseAndTypecheck = async (input: string) => {
  const loaded = unwrapStage<LoadedStage>(await load({ input }))
  const parsed = unwrapStage<ParsedStage>(await parse(loaded))
  return unwrapStage<TypecheckedStage>(await typecheck(parsed))
}

const canonicalModelPath = (): string =>
  resolve(dirname(fileURLToPath(import.meta.url)), "../../../..", "specs/plannedAttemptExecutor.qnt")

export const loadResumeRedeliveryOracle = async (): Promise<ResumeRedeliveryOracle> => {
  const startedWall = performance.now()
  const startedCpu = process.cpuUsage()
  const input = canonicalModelPath()
  const sourceSha256 = createHash("sha256").update(readFileSync(input)).digest("hex")
  if (sourceSha256 !== canonicalModelSourceSha256) throw new Error("planned-attempt model source hash changed")
  return loadOracleFromTypedStage(
    await parseAndTypecheck(input),
    sourceSha256,
    startedWall,
    startedCpu,
    resumeRedeliveryStepName,
    [
      { name: "report", setName: "EXECUTOR_REPORTS" },
      { name: "commandProjection", setName: "COMMAND_PROJECTIONS" }
    ],
    expectedResumeRedeliveryBranchCount,
    new Set(["report", "commandProjection"]),
    new Map([
      ["report", { rawPosition: 0, bound: 3n }],
      ["commandProjection", { rawPosition: 1, bound: 8n }]
    ])
  )
}

export const loadCanonicalMbtStepOracle = async (): Promise<ResumeRedeliveryOracle> => {
  const startedWall = performance.now()
  const startedCpu = process.cpuUsage()
  const input = canonicalModelPath()
  const sourceSha256 = createHash("sha256").update(readFileSync(input)).digest("hex")
  return loadOracleFromTypedStage(
    await parseAndTypecheck(input),
    sourceSha256,
    startedWall,
    startedCpu,
    "mbtStep",
    [
      { name: "preTurnRead" },
      { name: "report", setName: "EXECUTOR_REPORTS" },
      { name: "commandProjection", setName: "COMMAND_PROJECTIONS" },
      { name: "stateObservation", setName: "STATE_OBSERVATIONS" }
    ],
    26,
    new Set(["preTurnRead", "report", "commandProjection", "stateObservation"]),
    new Map([
      ["preTurnRead", { rawPosition: 0, bound: 5n }],
      ["report", { rawPosition: 1, bound: 3n }],
      ["commandProjection", { rawPosition: 2, bound: 8n }],
      ["stateObservation", { rawPosition: 3, bound: 7n }]
    ])
  )
}

/** Test-only loader used by the mutation control; it still parses and typechecks Quint bytes. */
export const loadOracleFromBytes = async (bytes: Uint8Array): Promise<ResumeRedeliveryOracle> => {
  const directory = mkdtempSync(join(tmpdir(), "dalph-quint-oracle-"))
  const input = join(directory, "plannedAttemptExecutor.qnt")
  try {
    writeFileSync(input, bytes)
    const startedWall = performance.now()
    const startedCpu = process.cpuUsage()
    const sourceSha256 = createHash("sha256").update(bytes).digest("hex")
    return loadOracleFromTypedStage(
      await parseAndTypecheck(input),
      sourceSha256,
      startedWall,
      startedCpu,
      resumeRedeliveryStepName,
      [
        { name: "report", setName: "EXECUTOR_REPORTS" },
        { name: "commandProjection", setName: "COMMAND_PROJECTIONS" }
      ],
      expectedResumeRedeliveryBranchCount,
      new Set(["report", "commandProjection"]),
      new Map([
        ["report", { rawPosition: 0, bound: 3n }],
        ["commandProjection", { rawPosition: 1, bound: 8n }]
      ])
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
