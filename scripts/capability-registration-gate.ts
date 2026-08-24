import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import ts from "typescript"
import {
  capabilityRegistrationInventory,
  capabilityRegistrationIssues,
  type CapabilityRegistrationInventory,
  type RegisteredImplementation
} from "./capability-registration.js"

export interface CapabilitySourceFile {
  readonly path: string
  readonly source: string
}

const sourceRoots = [
  "packages/contracts/src",
  "packages/orchestrator/src",
  "packages/orchestrator/test",
  "packages/dalph/src",
  "packages/dalph/bin",
  "packages/dalph/test"
]

const isAuthoredTypeScriptSource = (path: string): boolean => path.endsWith(".ts") && !path.endsWith(".d.ts")

const filesBelow = (directory: string, repositoryRoot: string): ReadonlyArray<CapabilitySourceFile> =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = join(directory, entry.name)
    if (entry.isDirectory()) return filesBelow(absolute, repositoryRoot)
    if (!entry.isFile() || !isAuthoredTypeScriptSource(absolute)) return []
    return [{ path: relative(repositoryRoot, absolute).split("\\").join("/"), source: readFileSync(absolute, "utf8") }]
  })

export const repositoryCapabilitySourceFiles = (repositoryRoot = process.cwd()): ReadonlyArray<CapabilitySourceFile> =>
  sourceRoots.flatMap((root) => {
    const absolute = resolve(repositoryRoot, root)
    return existsSync(absolute) && statSync(absolute).isDirectory() ? filesBelow(absolute, repositoryRoot) : []
  })

type ParsedSource = ts.SourceFile

const parsedSourceCache = new WeakMap<object, ParsedSource>()
const parsedSource = (file: CapabilitySourceFile): ParsedSource => {
  const cached = parsedSourceCache.get(file)
  if (cached !== undefined) return cached
  const parsed = ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  parsedSourceCache.set(file, parsed)
  return parsed
}

const normalizedMarker = (marker: string): string => marker.trim().replace(/\s*\(\s*\{?\s*$/u, "")

const propertyAccessText = (node: ts.Node): string | undefined => {
  if (ts.isIdentifier(node)) return node.text
  if (!ts.isPropertyAccessExpression(node)) return undefined
  const left = propertyAccessText(node.expression)
  return left === undefined ? undefined : `${left}.${node.name.text}`
}

const isDeclarationName = (node: ts.Identifier): boolean => {
  const parent = node.parent
  if (
    (ts.isVariableDeclaration(parent) && parent.name === node) ||
    (ts.isFunctionDeclaration(parent) && parent.name === node) ||
    (ts.isClassDeclaration(parent) && parent.name === node) ||
    (ts.isParameter(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && parent.name === node) ||
    (ts.isImportClause(parent) && parent.name === node) ||
    (ts.isNamespaceImport(parent) && parent.name === node) ||
    (ts.isImportSpecifier(parent) && (parent.name === node || parent.propertyName === node)) ||
    (ts.isExportSpecifier(parent) && (parent.name === node || parent.propertyName === node))
  ) {
    return true
  }
  return false
}

const isImportOrExportDeclaration = (node: ts.Node): boolean => {
  let current: ts.Node = node
  while (!ts.isSourceFile(current) && !ts.isVariableStatement(current)) {
    if (ts.isImportDeclaration(current) || ts.isExportDeclaration(current)) return true
    current = current.parent
  }
  return false
}

const sourceNodesCache = new WeakMap<object, ReadonlyArray<ts.Node>>()
/* eslint-disable functional/immutable-data -- the parser index is a local read-only cache built per source object. */
const sourceNodes = (tree: ParsedSource): ReadonlyArray<ts.Node> => {
  const cached = sourceNodesCache.get(tree)
  if (cached !== undefined) return cached
  const nodes: Array<ts.Node> = []
  const visit = (node: ts.Node): void => {
    nodes.push(node)
    ts.forEachChild(node, visit)
  }
  visit(tree)
  sourceNodesCache.set(tree, nodes)
  return nodes
}
/* eslint-enable functional/immutable-data */

const hasReference = (file: CapabilitySourceFile, marker: string): boolean => {
  const expected = normalizedMarker(marker)
  return sourceNodes(parsedSource(file)).some((node) => {
    if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node)) return false
    if (propertyAccessText(node) !== expected) return false
    return !ts.isIdentifier(node) || !isImportOrExportDeclaration(node)
  })
}

const hasValueReference = (file: CapabilitySourceFile, marker: string): boolean => {
  const expected = normalizedMarker(marker)
  return sourceNodes(parsedSource(file)).some((node) => {
    if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node)) return false
    if (propertyAccessText(node) !== expected) return false
    if (ts.isIdentifier(node) && (isDeclarationName(node) || isImportOrExportDeclaration(node))) return false
    return true
  })
}

const hasCallExpression = (file: CapabilitySourceFile, marker: string): boolean => {
  const expected = normalizedMarker(marker)
  return sourceNodes(parsedSource(file)).some(
    (node) => ts.isCallExpression(node) && propertyAccessText(node.expression) === expected
  )
}

interface ExportedLayerInventory {
  readonly identities: ReadonlySet<string>
}

const sourcePathForSpecifier = (
  sourcePath: string,
  specifier: string,
  sourceByPath: ReadonlyMap<string, CapabilitySourceFile>
): string | undefined => {
  if (!specifier.startsWith(".")) return undefined
  const base = join(dirname(sourcePath), specifier.replace(/\.js$/u, "")).replaceAll("\\", "/")
  for (const candidate of [`${base}.ts`, `${base}/index.ts`, base]) {
    if (sourceByPath.has(candidate)) return candidate
  }
  return undefined
}

/* eslint-disable functional/immutable-data -- this local set is the AST's exported-value index. */
const directExportedLayers = (file: CapabilitySourceFile): ReadonlySet<string> => {
  const layers = new Set<string>()
  const tree = parsedSource(file)
  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node) && node.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        const identity = declaration.name.text
        const typeText = declaration.type?.getText(tree) ?? ""
        const hasLayerType = /\bLayer(?:\s*\.\s*Layer)?\s*</u.test(typeText)
        const initializer = declaration.initializer
        const initializerPath =
          initializer === undefined
            ? undefined
            : propertyAccessText(ts.isCallExpression(initializer) ? initializer.expression : initializer)
        const hasLayerInitializer = initializerPath?.startsWith("Layer.") === true
        const hasLayerAssertion =
          initializer !== undefined &&
          (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) &&
          /\bLayer(?:\s*\.\s*Layer)?\b/u.test(initializer.type.getText(tree))
        if (identity.endsWith("Layer") || hasLayerType || hasLayerInitializer || hasLayerAssertion) layers.add(identity)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  return layers
}
/* eslint-enable functional/immutable-data */

/* eslint-disable functional/immutable-data -- source indexing is local and never escapes the gate. */
const exportedLayerSymbols = (sourceFiles: ReadonlyArray<CapabilitySourceFile>): ExportedLayerInventory => {
  const sourceByPath = new Map(sourceFiles.map((file) => [file.path, file] as const))
  const memo = new Map<string, ReadonlySet<string>>()
  const visiting = new Set<string>()

  const layersFor = (path: string): ReadonlySet<string> => {
    const cached = memo.get(path)
    if (cached !== undefined) return cached
    if (visiting.has(path)) return new Set<string>()
    const file = sourceByPath.get(path)
    if (file === undefined) return new Set<string>()
    visiting.add(path)
    const layers = new Set(directExportedLayers(file))
    const importedLayers = new Set<string>()
    const tree = parsedSource(file)
    for (const statement of tree.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const targetPath = sourcePathForSpecifier(path, statement.moduleSpecifier.text, sourceByPath)
      if (targetPath === undefined || statement.importClause === undefined) continue
      const targetLayers = layersFor(targetPath)
      const bindings = statement.importClause.namedBindings
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          const original = (element.propertyName ?? element.name).text
          if (targetLayers.has(original)) importedLayers.add(element.name.text)
        }
      }
    }
    for (const identity of importedLayers) layers.add(identity)

    for (const statement of tree.statements) {
      if (
        ts.isVariableStatement(statement) &&
        statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)
      ) {
        for (const declaration of statement.declarationList.declarations) {
          if (
            ts.isIdentifier(declaration.name) &&
            declaration.initializer !== undefined &&
            ts.isIdentifier(declaration.initializer) &&
            importedLayers.has(declaration.initializer.text)
          ) {
            layers.add(declaration.name.text)
          }
        }
      }
      if (!ts.isExportDeclaration(statement)) continue
      const clause = statement.exportClause
      if (statement.moduleSpecifier !== undefined && ts.isStringLiteral(statement.moduleSpecifier)) {
        const targetPath = sourcePathForSpecifier(path, statement.moduleSpecifier.text, sourceByPath)
        if (targetPath === undefined) continue
        const targetLayers = layersFor(targetPath)
        if (clause === undefined) {
          for (const identity of targetLayers) layers.add(identity)
        } else if (ts.isNamedExports(clause)) {
          for (const element of clause.elements) {
            const original = (element.propertyName ?? element.name).text
            if (targetLayers.has(original)) layers.add(element.name.text)
          }
        }
      } else if (clause !== undefined && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          const original = (element.propertyName ?? element.name).text
          if (layers.has(original)) layers.add(element.name.text)
        }
      }
    }
    visiting.delete(path)
    memo.set(path, layers)
    return layers
  }

  const identities = new Set<string>()
  for (const file of sourceFiles) for (const identity of layersFor(file.path)) identities.add(identity)
  return { identities }
}
/* eslint-enable functional/immutable-data */

const implementationEntries = (inventory: CapabilityRegistrationInventory): ReadonlyArray<RegisteredImplementation> =>
  inventory.capabilities.flatMap((capability) =>
    (["controlled", "production"] as const).flatMap((role) => {
      const implementation = capability[role]
      return implementation._tag === "Implementation" ? [implementation] : []
    })
  )

const sourceAt = (sourceFiles: ReadonlyArray<CapabilitySourceFile>, path: string): CapabilitySourceFile | undefined =>
  sourceFiles.find((file) => file.path === path)

const implementationSourceIssues = (
  inventory: CapabilityRegistrationInventory,
  sourceFiles: ReadonlyArray<CapabilitySourceFile>
): ReadonlyArray<string> => {
  // The local diagnostic list is intentionally mutable so every failed source
  // fact is retained; it is never exposed or shared with runtime code.
  /* eslint-disable functional/immutable-data */
  const issues: Array<string> = []
  for (const capability of inventory.capabilities) {
    for (const role of ["controlled", "production"] as const) {
      const implementation = capability[role]
      if (implementation._tag === "NotApplicable") continue
      const source = sourceAt(sourceFiles, implementation.source)
      if (source === undefined) {
        issues.push(`${capability.family} ${role} implementation source is missing: ${implementation.source}`)
      } else if (!hasReference(source, implementation.marker)) {
        issues.push(`${capability.family} ${role} implementation marker is stale: ${implementation.marker}`)
      }
      const composition = sourceAt(sourceFiles, implementation.composition.source)
      if (composition === undefined) {
        issues.push(`${capability.family} ${role} composition source is missing: ${implementation.composition.source}`)
      } else if (!hasValueReference(composition, implementation.composition.marker)) {
        issues.push(`${capability.family} ${role} composition marker is stale: ${implementation.composition.marker}`)
      } else if (implementation.composition.marker !== implementation.identity) {
        issues.push(
          `${capability.family} ${role} composition does not consume implementation identity ${implementation.identity}`
        )
      } else if (implementation.composition.identity !== implementation.identity) {
        issues.push(
          `${capability.family} ${role} composition identity is stale: ${implementation.composition.identity}`
        )
      } else if (!hasValueReference(composition, implementation.identity)) {
        issues.push(
          `${capability.family} ${role} composition does not consume implementation identity ${implementation.identity}`
        )
      }
    }
    for (const execution of capability.contract.executions) {
      const source = sourceAt(sourceFiles, execution.source)
      if (source === undefined) {
        issues.push(`${capability.family} contract source is missing: ${execution.source}`)
      } else if (!hasReference(source, execution.marker)) {
        issues.push(`${capability.family} contract marker is stale: ${execution.marker}`)
      }
      if (execution.invocation !== undefined) {
        const invocation = sourceAt(sourceFiles, execution.invocation.source)
        if (invocation === undefined) {
          issues.push(`${capability.family} contract invocation source is missing: ${execution.invocation.source}`)
        } else if (!hasCallExpression(invocation, execution.invocation.marker)) {
          issues.push(`${capability.family} contract invocation marker is stale: ${execution.invocation.marker}`)
        }
      }
    }
  }
  /* eslint-enable functional/immutable-data */
  return issues
}

/**
 * Reads each checked-in composition and rejects an exported Layer reference
 * that is neither a registered capability implementation nor an explicit
 * support binding. This catches a new production adapter even when a
 * maintainer forgets to edit the registry.
 */
const compositionReferenceIssues = (
  inventory: CapabilityRegistrationInventory,
  sourceFiles: ReadonlyArray<CapabilitySourceFile>
): ReadonlyArray<string> => {
  // The local diagnostic list is intentionally mutable so independent source
  // failures are reported together instead of short-circuiting the audit.
  /* eslint-disable functional/immutable-data */
  const issues: Array<string> = []
  const exportedLayers = exportedLayerSymbols(sourceFiles).identities
  const registered = new Set(implementationEntries(inventory).map(({ identity }) => identity))
  const support = new Set(inventory.compositionSupportBindings.map(({ identity }) => identity))
  const allowed = new Set([...registered, ...support])
  for (const composition of inventory.compositionSources) {
    const source = sourceAt(sourceFiles, composition.source)
    if (source === undefined) {
      issues.push(`${composition.role} composition source is missing: ${composition.source}`)
      continue
    }
    for (const identity of exportedLayers) {
      if (!hasValueReference(source, identity)) continue
      if (!allowed.has(identity)) issues.push(`${composition.role} uses unregistered exported Layer ${identity}`)
    }
  }
  /* eslint-enable functional/immutable-data */
  return issues
}

export const runCapabilityRegistrationGate = (
  inventory: CapabilityRegistrationInventory = capabilityRegistrationInventory,
  sourceFiles: ReadonlyArray<CapabilitySourceFile> = repositoryCapabilitySourceFiles()
): ReadonlyArray<string> => [
  ...capabilityRegistrationIssues(inventory),
  ...implementationSourceIssues(inventory, sourceFiles),
  ...compositionReferenceIssues(inventory, sourceFiles)
]
