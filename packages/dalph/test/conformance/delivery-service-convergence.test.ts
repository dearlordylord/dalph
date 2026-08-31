/* eslint-disable import/no-nodejs-modules -- These tests audit package source architecture. */
import { readdirSync, readFileSync } from "node:fs"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { expect, it } from "vitest"

const orchestratorSource = fileURLToPath(new URL("../../../orchestrator/src/", import.meta.url))
const dalphSource = fileURLToPath(new URL("../../src/", import.meta.url))
const runSourcePath = `${orchestratorSource}/coordination/run/run.ts`
const stabilizationSourcePath = `${orchestratorSource}/coordination/run/run-stabilization.ts`
const deliverySourcePath = `${orchestratorSource}/coordination/delivery/delivery.ts`
const deliveryRuntimeSourcePath = `${orchestratorSource}/coordination/delivery/run-delivery-runtime.ts`
const pauseObserverSourcePath = `${orchestratorSource}/coordination/run/pause-progress-observer.ts`
const controlledWorkflowSourcePath = `${orchestratorSource}/coordination/run/controlled-workflow.ts`
const authoredRunnerSourcePath = `${dalphSource}/cassettes/authored-runner.ts`
const productionSourcePath = `${dalphSource}/application/production.ts`

const sourceFilesUnder = (root: string): ReadonlyArray<string> =>
  readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return sourceFilesUnder(path)
    return extname(path) === ".ts" && !path.endsWith(".test.ts") ? [path] : []
  })

interface RuntimeImportBinding {
  readonly exportedName: string
  readonly localName: string
}

const composedRuntimeCapabilitiesBelow = (
  node: ts.Node,
  namedBindings: ReadonlyArray<RuntimeImportBinding>,
  namespaceNames: ReadonlyArray<string>
): ReadonlyArray<string> => {
  const expression = ts.isCallExpression(node) ? node.expression : undefined
  const directBinding =
    expression !== undefined && ts.isIdentifier(expression)
      ? namedBindings.find(({ localName }) => localName === expression.text)
      : undefined
  const namespaceCapability =
    expression !== undefined &&
    ts.isPropertyAccessExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    namespaceNames.includes(expression.expression.text)
      ? expression.name.text
      : undefined
  const current =
    directBinding !== undefined
      ? [directBinding.exportedName]
      : namespaceCapability === undefined
        ? []
        : [namespaceCapability]
  return [
    ...current,
    ...node.getChildren().flatMap((child) => composedRuntimeCapabilitiesBelow(child, namedBindings, namespaceNames))
  ]
}

const deliveryRuntimeCapabilityIssues = (stabilizationSource: string): ReadonlyArray<string> => {
  const stabilization = ts.createSourceFile(
    stabilizationSourcePath,
    stabilizationSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const runtimeImports = stabilization.statements.filter(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "../delivery/run-delivery-runtime.js"
  )
  const namedBindings: ReadonlyArray<RuntimeImportBinding> = runtimeImports.flatMap(({ importClause }) => {
    if (importClause === undefined || importClause.isTypeOnly) return []
    const defaultBinding =
      importClause.name === undefined ? [] : [{ exportedName: "default", localName: importClause.name.text }]
    const named = importClause.namedBindings
    const explicitlyNamed =
      named !== undefined && ts.isNamedImports(named)
        ? named.elements.flatMap((binding) =>
            binding.isTypeOnly
              ? []
              : [{ exportedName: binding.propertyName?.text ?? binding.name.text, localName: binding.name.text }]
          )
        : []
    return [...defaultBinding, ...explicitlyNamed]
  })
  const namespaceNames = runtimeImports.flatMap(({ importClause }) => {
    const bindings = importClause?.namedBindings
    return importClause?.isTypeOnly !== true && bindings !== undefined && ts.isNamespaceImport(bindings)
      ? [bindings.name.text]
      : []
  })
  const capabilities = [
    ...new Set(composedRuntimeCapabilitiesBelow(stabilization, namedBindings, namespaceNames))
  ].toSorted()
  return capabilities.length === 1 && capabilities[0] === "runDeliveryRuntimePhase"
    ? []
    : [`delivery runtime capability boundary is ${capabilities.join(", ")}`]
}

it("one idempotent Run entry installs the delivery service contracts", () => {
  const runSource = readFileSync(runSourcePath, "utf8")
  const stabilizationSource = readFileSync(stabilizationSourcePath, "utf8")

  expect(runSource.match(/\bconst consequences = yield\* delivery\b/g)).toHaveLength(1)
  expect(runSource.match(/\brunStabilizedDelivery\(/g)).toHaveLength(1)
  // Ordinary delivery, active refresh, and accepted-lifecycle fallback may
  // enter distinct phases, but all paths use the same runtime operation.
  expect(deliveryRuntimeCapabilityIssues(stabilizationSource)).toEqual([])
  // Ordinary and active-refresh bootstrap paths both use this one shared
  // journaled composition; neither path creates a second delivery program.
  expect(runSource.match(/\brunJournaledDelivery\(/g)).toHaveLength(2)
  expect(runSource).toContain("bootstrap.activate")
  expect(runSource).not.toContain("bootstrap.fresh")
  expect(runSource).not.toContain("bootstrap.recovered")
  expect(runSource).not.toContain("bootstrap.controlled")
})

it("rejects a differently named second delivery runtime capability", () => {
  const stabilizationSource = readFileSync(stabilizationSourcePath, "utf8")
  const sourceWithSecondCapability = stabilizationSource
    .replace("  runDeliveryRuntimePhase,", "  runDeliveryRuntimePhase,\n  alternateDeliveryService as hiddenService,")
    .concat("\nvoid hiddenService(undefined as never, undefined as never)\n")

  expect(deliveryRuntimeCapabilityIssues(sourceWithSecondCapability)).toEqual([
    "delivery runtime capability boundary is alternateDeliveryService, runDeliveryRuntimePhase"
  ])
})

it("bootstrap-composed workflows reuse the process attempt guard and passive observer", () => {
  const controlledWorkflowSource = readFileSync(controlledWorkflowSourcePath, "utf8")
  const authoredRunnerSource = readFileSync(authoredRunnerSourcePath, "utf8")
  const productionSource = readFileSync(productionSourcePath, "utf8")

  for (const source of [controlledWorkflowSource, authoredRunnerSource]) {
    expect(source).toContain("attemptChoiceControlWithProvidedProtocolLayer")
    expect(source).not.toMatch(/\battemptChoiceControlLayer\b/)
  }
  expect(productionSource).not.toContain("passivePlannedAttemptObserverLayer")
  expect(productionSource).not.toMatch(/yield\* PassivePlannedAttemptObserver/)
  expect(productionSource).not.toMatch(/Layer\.succeed\(PassivePlannedAttemptObserver/)
})

it("delivery consumers use the CurrentSignal attachment contract instead of local race protocols", () => {
  const deliveryRuntimeSource = readFileSync(deliveryRuntimeSourcePath, "utf8")
  const pauseObserverSource = readFileSync(pauseObserverSourcePath, "utf8")
  const stabilizationSource = readFileSync(stabilizationSourcePath, "utf8")

  expect(deliveryRuntimeSource).toContain("attachCurrentSignal(relation)")
  expect(deliveryRuntimeSource).not.toContain("Stream.drop(1)")
  expect(deliveryRuntimeSource).not.toContain("subscribedCurrent")
  expect(pauseObserverSource).toContain("attachCurrentSignal(resources.runtimeObservation)")
  expect(stabilizationSource).toContain("attachCurrentSignal(evaluations)")
  expect(stabilizationSource).not.toContain("Stream.concat(Stream.fromEffect(evaluations.get), evaluations.changes)")
})

it("keeps shared delivery and authored cassettes free of implementation-mode vocabulary", () => {
  const files = [...sourceFilesUnder(orchestratorSource), ...sourceFilesUnder(`${dalphSource}/cassettes`)]
  const violations = files.flatMap((path) => {
    const source = readFileSync(path, "utf8")
    return /\b(?:Synthetic|Simulated)\w*\b|\bflat\s+(?:Effect|composition|delivery|relation|runtime|workflow)\b|\bflat-delivery\b|\brunFlat\w*\b/i.test(
      source
    )
      ? [path]
      : []
  })

  expect(violations).toEqual([])
  expect(readFileSync(`${dalphSource}/cassettes/catalog.ts`, "utf8")).not.toMatch(
    /\b(?:controlled|dry[- ]run|fake|synthetic)\b/i
  )
})

it("keeps the descriptive delivery composition to its five ordered arrows", () => {
  const deliverySource = readFileSync(deliverySourcePath, "utf8")
  const body = deliverySource.slice(deliverySource.indexOf("export const delivery"))
  const arrows = [
    "frontierOf",
    "boundedParallelTickets",
    "executorResponsibilities",
    "deliverySettlements",
    "reflectDeliverySettlements"
  ]

  const positions = arrows.map((arrow) => body.indexOf(arrow))
  expect(
    positions.every((position) => position !== -1),
    `every arrow appears: ${arrows.join(", ")}`
  ).toBe(true)
  expect(positions).toEqual([...positions].toSorted((left, right) => left - right))
})
