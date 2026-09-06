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

interface DeliveryImportBinding {
  readonly exportedName: string
  readonly localName: string
  readonly source: string
}

interface DeliveryNamespaceBinding {
  readonly localName: string
  readonly source: string
}

const canonicalDeliveryRuntimeCall = "../delivery/run-delivery-runtime.js#runDeliveryRuntimePhase"

/**
 * Run stabilization has one closed direct-call boundary into delivery. The
 * runtime operation and its existing support operations are classified here;
 * any other delivery-module call requires an explicit architecture decision.
 * “Direct” means invoking a named/default import or a member of a named or
 * namespace import. Local value-flow aliases are outside this deliberately
 * syntactic boundary.
 */
const allowedDeliveryCompositionCalls: ReadonlySet<string> = new Set([
  "../delivery/delivery-action-adapter-common.js#executeTrackerGraphRead",
  "../delivery/relations.js#attachCurrentSignal",
  "../delivery/relations.js#deliveryFinalityOf",
  "../delivery/run-delivery-runtime.js#DeliveryRuntimePhase.ActiveRefreshPostG2",
  "../delivery/run-delivery-runtime.js#DeliveryRuntimePhase.ActiveRefreshPreG2",
  canonicalDeliveryRuntimeCall
])

const composedDeliveryCallsBelow = (
  node: ts.Node,
  namedBindings: ReadonlyArray<DeliveryImportBinding>,
  namespaceBindings: ReadonlyArray<DeliveryNamespaceBinding>
): ReadonlyArray<string> => {
  const expression = ts.isCallExpression(node) ? node.expression : undefined
  const directBinding =
    expression !== undefined && ts.isIdentifier(expression)
      ? namedBindings.find(({ localName }) => localName === expression.text)
      : undefined
  const propertyAccess = expression !== undefined && ts.isPropertyAccessExpression(expression) ? expression : undefined
  const propertyOwner =
    propertyAccess !== undefined && ts.isIdentifier(propertyAccess.expression)
      ? propertyAccess.expression.text
      : undefined
  const namespaceBinding = namespaceBindings.find(({ localName }) => localName === propertyOwner)
  const namedObjectBinding = namedBindings.find(({ localName }) => localName === propertyOwner)
  const current =
    directBinding !== undefined
      ? [`${directBinding.source}#${directBinding.exportedName}`]
      : namespaceBinding !== undefined && propertyAccess !== undefined
        ? [`${namespaceBinding.source}#${propertyAccess.name.text}`]
        : namedObjectBinding !== undefined && propertyAccess !== undefined
          ? [`${namedObjectBinding.source}#${namedObjectBinding.exportedName}.${propertyAccess.name.text}`]
          : []
  return [
    ...current,
    ...node.getChildren().flatMap((child) => composedDeliveryCallsBelow(child, namedBindings, namespaceBindings))
  ]
}

const deliveryCompositionBoundaryIssues = (stabilizationSource: string): ReadonlyArray<string> => {
  const stabilization = ts.createSourceFile(
    stabilizationSourcePath,
    stabilizationSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS
  )
  const deliveryImports = stabilization.statements.filter(
    (statement): statement is ts.ImportDeclaration =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text.startsWith("../delivery/")
  )
  const namedBindings: ReadonlyArray<DeliveryImportBinding> = deliveryImports.flatMap(
    ({ importClause, moduleSpecifier }) => {
      if (importClause === undefined || importClause.isTypeOnly || !ts.isStringLiteral(moduleSpecifier)) return []
      const source = moduleSpecifier.text
      const defaultBinding =
        importClause.name === undefined ? [] : [{ exportedName: "default", localName: importClause.name.text, source }]
      const named = importClause.namedBindings
      const explicitlyNamed =
        named !== undefined && ts.isNamedImports(named)
          ? named.elements.flatMap((binding) =>
              binding.isTypeOnly
                ? []
                : [
                    {
                      exportedName: binding.propertyName?.text ?? binding.name.text,
                      localName: binding.name.text,
                      source
                    }
                  ]
            )
          : []
      return [...defaultBinding, ...explicitlyNamed]
    }
  )
  const namespaceBindings: ReadonlyArray<DeliveryNamespaceBinding> = deliveryImports.flatMap(
    ({ importClause, moduleSpecifier }) => {
      if (!ts.isStringLiteral(moduleSpecifier)) return []
      const bindings = importClause?.namedBindings
      return importClause?.isTypeOnly !== true && bindings !== undefined && ts.isNamespaceImport(bindings)
        ? [{ localName: bindings.name.text, source: moduleSpecifier.text }]
        : []
    }
  )
  const calls = [...new Set(composedDeliveryCallsBelow(stabilization, namedBindings, namespaceBindings))].toSorted()
  const missingCanonical = calls.includes(canonicalDeliveryRuntimeCall)
    ? []
    : ["canonical delivery runtime capability is not composed"]
  const unclassified = calls
    .filter((call) => !allowedDeliveryCompositionCalls.has(call))
    .map((call) => `unclassified delivery composition call: ${call}`)
  return [...missingCanonical, ...unclassified]
}

it("one idempotent Run entry installs the delivery service contracts", () => {
  const runSource = readFileSync(runSourcePath, "utf8")
  const stabilizationSource = readFileSync(stabilizationSourcePath, "utf8")

  expect(runSource.match(/\bconst consequences = yield\* delivery\b/g)).toHaveLength(1)
  expect(runSource.match(/\brunStabilizedDelivery\(/g)).toHaveLength(1)
  // Ordinary delivery, active refresh, and accepted-lifecycle fallback may
  // enter distinct phases, but all paths use the same runtime operation.
  expect(deliveryCompositionBoundaryIssues(stabilizationSource)).toEqual([])
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

  expect(deliveryCompositionBoundaryIssues(sourceWithSecondCapability)).toEqual([
    "unclassified delivery composition call: ../delivery/run-delivery-runtime.js#alternateDeliveryService"
  ])
})

it("rejects a delivery runtime capability imported from a second module", () => {
  const stabilizationSource = readFileSync(stabilizationSourcePath, "utf8")
  const sourceWithSecondModule = stabilizationSource
    .replace(
      'import { Effect, Option, Stream } from "effect"',
      'import { Effect, Option, Stream } from "effect"\nimport { hiddenService } from "../delivery/alternate-runtime.js"'
    )
    .concat("\nvoid hiddenService(undefined as never, undefined as never)\n")

  expect(deliveryCompositionBoundaryIssues(sourceWithSecondModule)).toEqual([
    "unclassified delivery composition call: ../delivery/alternate-runtime.js#hiddenService"
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
