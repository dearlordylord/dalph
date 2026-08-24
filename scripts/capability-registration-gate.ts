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

const isTypePosition = (node: ts.Node): boolean => {
  let current: ts.Node = node.parent
  while (!ts.isSourceFile(current)) {
    if (ts.isTypeNode(current)) return true
    if (ts.isStatement(current) || ts.isBlock(current)) return false
    current = current.parent
  }
  return false
}

const hasValueReference = (file: CapabilitySourceFile, marker: string): boolean => {
  const expected = normalizedMarker(marker)
  return sourceNodes(parsedSource(file)).some((node) => {
    if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node)) return false
    if (propertyAccessText(node) !== expected) return false
    if (isTypePosition(node)) return false
    if (ts.isIdentifier(node) && (isDeclarationName(node) || isImportOrExportDeclaration(node))) return false
    return true
  })
}

type InvocationSelector =
  | { readonly _tag: "ObjectProperty"; readonly property: string; readonly value: string }
  | { readonly _tag: "StringArgument"; readonly index: number; readonly value: string }

const propertyNameText = (node: ts.PropertyName): string | undefined =>
  ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : undefined

const expressionMatches = (node: ts.Expression, expected: string): boolean => {
  if (propertyAccessText(node) === expected) return true
  return ts.isStringLiteral(node) && node.text === expected
}

const callMatchesSelector = (call: ts.CallExpression, selector: InvocationSelector): boolean => {
  if (selector._tag === "StringArgument") {
    const argument = call.arguments[selector.index]
    return argument !== undefined && ts.isStringLiteral(argument) && argument.text === selector.value
  }
  const firstArgument = call.arguments[0]
  if (firstArgument === undefined || !ts.isObjectLiteralExpression(firstArgument)) return false
  return firstArgument.properties.some((property) => {
    if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return false
    const name = propertyNameText(property.name)
    if (name !== selector.property) return false
    if (ts.isShorthandPropertyAssignment(property)) return property.name.text === selector.value
    return expressionMatches(property.initializer, selector.value)
  })
}

const hasCallExpression = (
  file: CapabilitySourceFile,
  marker: string,
  selector: InvocationSelector | undefined,
  origin: string,
  originName: string,
  sourceFiles: ReadonlyArray<CapabilitySourceFile>
): boolean => {
  const expected = normalizedMarker(marker)
  return sourceNodes(parsedSource(file)).some(
    (node) =>
      ts.isCallExpression(node) &&
      propertyAccessText(node.expression) === expected &&
      (selector === undefined || callMatchesSelector(node, selector)) &&
      callResolvesToContractOrigin(node, expected, file, origin, originName, sourceFiles)
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

const topLevelBinding = (tree: ParsedSource, name: string): boolean =>
  tree.statements.some((statement) => {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) {
      return true
    }
    return (
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name
      )
    )
  })

const directBindingsInBlock = (block: ts.Block, name: string): boolean =>
  block.statements.some((statement) => {
    if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name?.text === name) {
      return true
    }
    return (
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (declaration) => ts.isIdentifier(declaration.name) && declaration.name.text === name
      )
    )
  })

const hasEnclosingLocalBinding = (call: ts.CallExpression, name: string): boolean => {
  let current: ts.Node = call.parent
  while (!ts.isSourceFile(current)) {
    if (ts.isBlock(current) && directBindingsInBlock(current, name)) return true
    if (ts.isFunctionLike(current)) {
      if (current.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === name)) {
        return true
      }
      if (
        "body" in current &&
        current.body !== undefined &&
        ts.isBlock(current.body) &&
        directBindingsInBlock(current.body, name)
      ) {
        return true
      }
    }
    current = current.parent
  }
  return false
}

const importedBinding = (
  tree: ParsedSource,
  localName: string,
  sourcePath: string,
  sourceByPath: ReadonlyMap<string, CapabilitySourceFile>
): { readonly original: string; readonly targetPath: string } | undefined => {
  for (const statement of tree.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
    const targetPath = sourcePathForSpecifier(sourcePath, statement.moduleSpecifier.text, sourceByPath)
    if (targetPath === undefined || statement.importClause === undefined) continue
    if (statement.importClause.name?.text === localName) return { original: "default", targetPath }
    const bindings = statement.importClause.namedBindings
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue
    const binding = bindings.elements.find((element) => element.name.text === localName)
    if (binding !== undefined) {
      return { original: (binding.propertyName ?? binding.name).text, targetPath }
    }
  }
  return undefined
}

const callResolvesToContractOrigin = (
  call: ts.CallExpression,
  localName: string,
  invocationFile: CapabilitySourceFile,
  origin: string,
  originName: string,
  sourceFiles: ReadonlyArray<CapabilitySourceFile>
): boolean => {
  if (!ts.isIdentifier(call.expression) || hasEnclosingLocalBinding(call, localName)) return false
  const sourceByPath = new Map(sourceFiles.map((file) => [file.path, file] as const))
  const imported = importedBinding(parsedSource(invocationFile), localName, invocationFile.path, sourceByPath)
  if (imported !== undefined) {
    if (topLevelBinding(parsedSource(invocationFile), localName)) return false
    if (imported.targetPath !== origin || imported.original !== originName) return false
    const originFile = sourceByPath.get(origin)
    return originFile !== undefined && hasReference(originFile, originName)
  }
  return invocationFile.path === origin && topLevelBinding(parsedSource(invocationFile), localName)
}

/* eslint-disable functional/immutable-data -- this local set is the AST's exported-value index. */
const directExportedLayers = (file: CapabilitySourceFile): ReadonlySet<string> => {
  const tree = parsedSource(file)
  const declarations = new Map<string, ts.VariableDeclaration>()
  const layerCandidates = new Set<string>()
  const layerType = (text: string): boolean => /\bLayer(?:\s*\.\s*Layer)?(?:\s*<|\b)/u.test(text)
  const layerExpression = (expression: ts.Expression | undefined): boolean => {
    if (expression === undefined) return false
    if (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression)) {
      return layerExpression(expression.expression)
    }
    if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
      return layerType(expression.type.getText(tree)) || layerExpression(expression.expression)
    }
    if (ts.isTypeAssertionExpression(expression)) {
      return layerType(expression.type.getText(tree)) || layerExpression(expression.expression)
    }
    if (ts.isIdentifier(expression)) return layerCandidates.has(expression.text)
    if (ts.isPropertyAccessExpression(expression)) return propertyAccessText(expression)?.startsWith("Layer.") === true
    if (!ts.isCallExpression(expression)) return false
    const callee = expression.expression
    if (propertyAccessText(callee)?.startsWith("Layer.") === true) return true
    return ts.isPropertyAccessExpression(callee) && callee.name.text === "pipe"
      ? layerExpression(callee.expression)
      : false
  }
  const visit = (node: ts.Node): void => {
    if (ts.isVariableStatement(node)) {
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue
        declarations.set(declaration.name.text, declaration)
        if (
          declaration.name.text.endsWith("Layer") ||
          layerType(declaration.type?.getText(tree) ?? "") ||
          layerExpression(declaration.initializer)
        ) {
          layerCandidates.add(declaration.name.text)
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(tree)
  let changed = true
  while (changed) {
    changed = false
    for (const [identity, declaration] of declarations) {
      if (!layerCandidates.has(identity) && layerExpression(declaration.initializer)) {
        layerCandidates.add(identity)
        changed = true
      }
    }
  }

  const layers = new Set<string>()
  for (const statement of tree.statements) {
    if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && layerCandidates.has(declaration.name.text)) {
          layers.add(declaration.name.text)
        }
      }
    }
    if (ts.isExportDeclaration(statement)) {
      const clause = statement.exportClause
      if (statement.moduleSpecifier === undefined && clause !== undefined && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          const original = (element.propertyName ?? element.name).text
          if (layerCandidates.has(original)) layers.add(element.name.text)
        }
      }
    }
    if (ts.isExportAssignment(statement) && layerExpression(statement.expression)) layers.add("default")
  }
  return layers
}
/* eslint-enable functional/immutable-data */

/* eslint-disable functional/immutable-data -- source indexing is local and never escapes the gate. */
const exportedLayerSymbols = (sourceFiles: ReadonlyArray<CapabilitySourceFile>): ExportedLayerInventory => {
  const sourceByPath = new Map(sourceFiles.map((file) => [file.path, file] as const))
  const memo = new Map<string, ReadonlySet<string>>()
  const visiting = new Set<string>()
  const addImportedAlias = (
    layers: Set<string>,
    original: string,
    local: string,
    targetLayers: ReadonlySet<string>
  ): void => {
    if (targetLayers.has(original)) layers.add(local)
    for (const identity of targetLayers) {
      if (identity.startsWith(`${original}.`)) layers.add(`${local}${identity.slice(original.length)}`)
    }
  }

  const layersFor = (path: string): ReadonlySet<string> => {
    const cached = memo.get(path)
    if (cached !== undefined) return cached
    if (visiting.has(path)) return new Set<string>()
    const file = sourceByPath.get(path)
    if (file === undefined) return new Set<string>()
    visiting.add(path)
    const layers = new Set(directExportedLayers(file))
    const tree = parsedSource(file)
    for (const statement of tree.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const targetPath = sourcePathForSpecifier(path, statement.moduleSpecifier.text, sourceByPath)
      if (targetPath === undefined || statement.importClause === undefined) continue
      const targetLayers = layersFor(targetPath)
      if (statement.importClause.name !== undefined && targetLayers.has("default")) {
        layers.add(statement.importClause.name.text)
      }
      const bindings = statement.importClause.namedBindings
      if (bindings !== undefined && ts.isNamedImports(bindings)) {
        for (const element of bindings.elements) {
          addImportedAlias(layers, (element.propertyName ?? element.name).text, element.name.text, targetLayers)
        }
      } else if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
        for (const identity of targetLayers) layers.add(`${bindings.name.text}.${identity}`)
      }
    }

    for (const statement of tree.statements) {
      if (
        ts.isVariableStatement(statement) &&
        statement.modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword)
      ) {
        for (const declaration of statement.declarationList.declarations) {
          if (ts.isIdentifier(declaration.name) && declaration.initializer !== undefined) {
            const initializer = propertyAccessText(declaration.initializer)
            if (initializer !== undefined && layers.has(initializer)) layers.add(declaration.name.text)
          }
        }
      }
      if (ts.isExportAssignment(statement)) {
        const expression = propertyAccessText(statement.expression)
        if (expression !== undefined && layers.has(expression)) layers.add("default")
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
            addImportedAlias(layers, (element.propertyName ?? element.name).text, element.name.text, targetLayers)
          }
        } else if (ts.isNamespaceExport(clause)) {
          for (const identity of targetLayers) layers.add(`${clause.name.text}.${identity}`)
        }
      } else if (clause !== undefined && ts.isNamedExports(clause)) {
        for (const element of clause.elements) {
          addImportedAlias(layers, (element.propertyName ?? element.name).text, element.name.text, layers)
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
        } else if (
          !hasCallExpression(
            invocation,
            execution.invocation.marker,
            execution.invocation.selector,
            execution.source,
            execution.marker,
            sourceFiles
          )
        ) {
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
