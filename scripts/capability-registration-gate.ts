import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
import ts from "typescript"
import {
  capabilityRegistrationInventory,
  capabilityRegistrationIssues,
  type ContractImplementationBinding,
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

interface CapabilitySourceProgram {
  readonly checker: ts.TypeChecker
  readonly program: ts.Program
  readonly sourceByPath: ReadonlyMap<string, CapabilitySourceFile>
}

const virtualRoot = "/__dalph_capability_registration__"
const virtualPath = (path: string): string => join(virtualRoot, path).replaceAll("\\", "/")
const normalizedVirtualPath = (path: string): string => resolve(path).replaceAll("\\", "/")

const sourceProgramCache = new WeakMap<object, CapabilitySourceProgram>()
const sourceProgramByRootKey = new Map<string, CapabilitySourceProgram>()
const sourceProgram = (sourceFiles: ReadonlyArray<CapabilitySourceFile>): CapabilitySourceProgram => {
  const cached = sourceProgramCache.get(sourceFiles)
  if (cached !== undefined) return cached

  const sourceByPath = new Map(sourceFiles.map((file) => [file.path, file] as const))
  const virtualSources = new Map(
    sourceFiles.map((file) => [normalizedVirtualPath(virtualPath(file.path)), file] as const)
  )
  const rootKey = sourceFiles.map(({ path }) => path).join("\u0000")
  const previous = sourceProgramByRootKey.get(rootKey)
  const options: ts.CompilerOptions = {
    baseUrl: virtualRoot,
    lib: ["lib.es2023.d.ts"],
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    noResolve: false,
    paths: {
      "@dalph/contracts": ["packages/contracts/src/index.ts"],
      "@dalph/dalph": ["packages/dalph/src/index.ts"],
      "@dalph/orchestrator": ["packages/orchestrator/src/index.ts"]
    },
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022
  }
  const host = ts.createCompilerHost(options, true)
  const defaultFileExists = host.fileExists.bind(host)
  const defaultReadFile = host.readFile.bind(host)
  const defaultGetSourceFile = host.getSourceFile.bind(host)
  const defaultDirectoryExists = host.directoryExists?.bind(host)
  /* eslint-disable functional/immutable-data -- TypeScript's compiler host is an intentionally mutable adapter. */
  host.getCurrentDirectory = () => virtualRoot
  host.fileExists = (fileName) => {
    const normalized = normalizedVirtualPath(fileName)
    return virtualSources.has(normalized) || defaultFileExists(fileName)
  }
  host.readFile = (fileName) => {
    const source = virtualSources.get(normalizedVirtualPath(fileName))
    return source?.source ?? defaultReadFile(fileName)
  }
  host.getSourceFile = (fileName, languageVersion, onError, shouldCreateNewSourceFile) => {
    const source = virtualSources.get(normalizedVirtualPath(fileName))
    const previousSource = previous?.sourceByPath.get(sourcePathFromVirtualPath(fileName))
    const previousTree = previous?.program.getSourceFile(fileName)
    if (source !== undefined && previousSource?.source === source.source && previousTree !== undefined)
      return previousTree
    return source === undefined
      ? defaultGetSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
      : ts.createSourceFile(fileName, source.source, languageVersion, true, ts.ScriptKind.TS)
  }
  host.directoryExists = (directoryName) => {
    const normalized = normalizedVirtualPath(directoryName)
    return (
      [...virtualSources.keys()].some((fileName) => fileName.startsWith(`${normalized}/`)) ||
      (defaultDirectoryExists?.(directoryName) ?? false)
    )
  }
  host.resolveModuleNames = (moduleNames, containingFile) =>
    moduleNames.map((moduleName) => ts.resolveModuleName(moduleName, containingFile, options, host).resolvedModule)
  const program = ts.createProgram(
    sourceFiles.map(({ path }) => virtualPath(path)),
    options,
    host,
    previous?.program
  )
  const indexed = { checker: program.getTypeChecker(), program, sourceByPath }
  sourceProgramCache.set(sourceFiles, indexed)
  sourceProgramByRootKey.set(rootKey, indexed)
  /* eslint-enable functional/immutable-data */
  return indexed
}

const sourcePathFromVirtualPath = (path: string): string => relative(virtualRoot, path).replaceAll("\\", "/")

const parsedSource = (file: CapabilitySourceFile, indexed: CapabilitySourceProgram): ts.SourceFile => {
  const parsed = indexed.program.getSourceFile(virtualPath(file.path))
  return (
    parsed ?? ts.createSourceFile(virtualPath(file.path), file.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  )
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
const sourceNodes = (tree: ts.SourceFile): ReadonlyArray<ts.Node> => {
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

const isTypePosition = (node: ts.Node): boolean => {
  let current: ts.Node = node.parent
  while (!ts.isSourceFile(current)) {
    if (ts.isTypeNode(current)) return true
    if (ts.isStatement(current) || ts.isBlock(current)) return false
    current = current.parent
  }
  return false
}

const hasValueReference = (file: CapabilitySourceFile, marker: string, indexed: CapabilitySourceProgram): boolean => {
  const expected = normalizedMarker(marker)
  return sourceNodes(parsedSource(file, indexed)).some((node) => {
    if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node)) return false
    if (propertyAccessText(node) !== expected) return false
    if (isTypePosition(node)) return false
    if (ts.isIdentifier(node) && (isDeclarationName(node) || isImportOrExportDeclaration(node))) return false
    return true
  })
}

const declarationName = (node: ts.Node): ts.Identifier | undefined => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) return node.name
  if (ts.isFunctionDeclaration(node) && node.name !== undefined) return node.name
  if (ts.isClassDeclaration(node) && node.name !== undefined) return node.name
  if (ts.isParameter(node) && ts.isIdentifier(node.name)) return node.name
  return undefined
}

const declarationFor = (
  file: CapabilitySourceFile,
  marker: string,
  indexed: CapabilitySourceProgram
): ts.Identifier | undefined => {
  const expected = normalizedMarker(marker)
  return sourceNodes(parsedSource(file, indexed))
    .map(declarationName)
    .find((name) => name?.text === expected)
}

const declarationSymbolFor = (
  file: CapabilitySourceFile,
  marker: string,
  indexed: CapabilitySourceProgram
): ts.Symbol | undefined => {
  const name = declarationFor(file, marker, indexed)
  return name === undefined ? undefined : indexed.checker.getSymbolAtLocation(name)
}

const resolveSymbol = (symbol: ts.Symbol | undefined, checker: ts.TypeChecker): ts.Symbol | undefined => {
  if (symbol === undefined) return undefined
  if ((symbol.flags & ts.SymbolFlags.Alias) === 0) return symbol
  try {
    return checker.getAliasedSymbol(symbol)
  } catch {
    return undefined
  }
}

const symbolsMatch = (left: ts.Symbol | undefined, right: ts.Symbol | undefined, checker: ts.TypeChecker): boolean => {
  const resolvedLeft = resolveSymbol(left, checker)
  const resolvedRight = resolveSymbol(right, checker)
  return resolvedLeft !== undefined && resolvedLeft === resolvedRight
}

type InvocationSelector =
  | { readonly _tag: "ObjectProperty"; readonly property: string; readonly value: string }
  | { readonly _tag: "StringArgument"; readonly index: number; readonly value: string }
  | { readonly _tag: "ArgumentReference"; readonly index: number; readonly value: string }

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
  if (selector._tag === "ArgumentReference") {
    const argument = call.arguments[selector.index]
    return argument !== undefined && propertyAccessText(argument) === selector.value
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
  indexed: CapabilitySourceProgram
): boolean => {
  return callExpressions(file, marker, selector, origin, originName, indexed).length > 0
}

const callResolvesToContractOrigin = (
  call: ts.CallExpression,
  origin: string,
  originName: string,
  indexed: CapabilitySourceProgram
): boolean => {
  if (!ts.isIdentifier(call.expression)) return false
  const originFile = indexed.sourceByPath.get(origin)
  if (originFile === undefined) return false
  const originSymbol = declarationSymbolFor(originFile, originName, indexed)
  const invocationSymbol = indexed.checker.getSymbolAtLocation(call.expression)
  return symbolsMatch(invocationSymbol, originSymbol, indexed.checker)
}

/* eslint-disable functional/immutable-data -- symbol traversal uses local visited state and result collection. */
const expressionReferencesSymbol = (
  root: ts.Node,
  expected: ts.Symbol,
  indexed: CapabilitySourceProgram,
  seen: ReadonlySet<ts.Symbol> = new Set()
): boolean => {
  let found = false
  const visited = new Set(seen)
  const visit = (node: ts.Node): void => {
    if (found) return
    if (ts.isIdentifier(node) || ts.isPropertyAccessExpression(node)) {
      const symbol = indexed.checker.getSymbolAtLocation(node)
      if (symbolsMatch(symbol, expected, indexed.checker)) {
        found = true
        return
      }
      const resolved = resolveSymbol(symbol, indexed.checker)
      if (resolved !== undefined && !visited.has(resolved)) {
        visited.add(resolved)
        for (const declaration of resolved.declarations ?? []) {
          if (ts.isVariableDeclaration(declaration) && declaration.initializer !== undefined) {
            visit(declaration.initializer)
          } else if (ts.isFunctionDeclaration(declaration) && declaration.body !== undefined) {
            visit(declaration.body)
          }
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  return found
}

const propertyExpressions = (root: ts.Node, propertyName: string): ReadonlyArray<ts.Expression> => {
  const expressions: Array<ts.Expression> = []
  const visit = (node: ts.Node): void => {
    if (ts.isObjectLiteralExpression(node)) {
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue
        if (propertyNameText(property.name) !== propertyName) continue
        expressions.push(ts.isPropertyAssignment(property) ? property.initializer : property.name)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
  return expressions
}
/* eslint-enable functional/immutable-data */

const functionLikeBody = (call: ts.CallExpression): ts.Node => {
  let current: ts.Node = call.parent
  while (!ts.isSourceFile(current)) {
    if (ts.isFunctionLike(current)) {
      const body = "body" in current ? current.body : undefined
      return body ?? current
    }
    current = current.parent
  }
  return call.getSourceFile()
}

const bindingExpressions = (
  call: ts.CallExpression,
  selector: ContractImplementationBinding["selector"]
): ReadonlyArray<ts.Node> => {
  if (selector._tag === "Argument") {
    const argument = call.arguments[selector.index]
    return argument === undefined ? [] : [argument]
  }
  if (selector._tag === "ObjectProperty") return propertyExpressions(call.arguments[0] ?? call, selector.property)
  return [functionLikeBody(call)]
}

const callExpressions = (
  file: CapabilitySourceFile,
  marker: string,
  selector: InvocationSelector | undefined,
  origin: string,
  originName: string,
  indexed: CapabilitySourceProgram
): ReadonlyArray<ts.CallExpression> => {
  const expected = normalizedMarker(marker)
  return sourceNodes(parsedSource(file, indexed)).flatMap((node) => {
    if (
      !ts.isCallExpression(node) ||
      propertyAccessText(node.expression) !== expected ||
      (selector !== undefined && !callMatchesSelector(node, selector)) ||
      !callResolvesToContractOrigin(node, origin, originName, indexed)
    ) {
      return []
    }
    return [node]
  })
}

const layerTypeText = (text: string): boolean => /\bLayer(?:\s*\.\s*Layer)?(?:\s*<|\b)/u.test(text)

const layerExpression = (
  expression: ts.Expression | undefined,
  tree: ts.SourceFile,
  indexed: CapabilitySourceProgram,
  seen: ReadonlySet<ts.Symbol> = new Set()
): boolean => {
  if (expression === undefined) return false
  if (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression)) {
    return layerExpression(expression.expression, tree, indexed, seen)
  }
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression)) {
    return layerTypeText(expression.type.getText(tree)) || layerExpression(expression.expression, tree, indexed, seen)
  }
  if (ts.isTypeAssertionExpression(expression)) {
    return layerTypeText(expression.type.getText(tree)) || layerExpression(expression.expression, tree, indexed, seen)
  }
  if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
    if (propertyAccessText(expression)?.startsWith("Layer.") === true) return true
    const symbol = resolveSymbol(indexed.checker.getSymbolAtLocation(expression), indexed.checker)
    if (symbol === undefined || seen.has(symbol)) return false
    const nextSeen = new Set(seen).add(symbol)
    return (
      symbol.declarations?.some((declaration) => declarationLooksLikeLayer(declaration, tree, indexed, nextSeen)) ??
      false
    )
  }
  if (!ts.isCallExpression(expression)) return false
  const callee = expression.expression
  if (propertyAccessText(callee)?.startsWith("Layer.") === true) return true
  return ts.isPropertyAccessExpression(callee) && callee.name.text === "pipe"
    ? layerExpression(callee.expression, tree, indexed, seen)
    : false
}

const declarationLooksLikeLayer = (
  declaration: ts.Declaration,
  tree: ts.SourceFile,
  indexed: CapabilitySourceProgram,
  seen: ReadonlySet<ts.Symbol>
): boolean => {
  const name = declarationName(declaration)
  if (name?.text.endsWith("Layer") === true) return true
  if (ts.isVariableDeclaration(declaration)) {
    return (
      layerTypeText(declaration.type?.getText(tree) ?? "") ||
      layerExpression(declaration.initializer, tree, indexed, seen)
    )
  }
  if (ts.isParameter(declaration)) return layerTypeText(declaration.type?.getText(tree) ?? "")
  return false
}

const isLayerSymbol = (symbol: ts.Symbol | undefined, indexed: CapabilitySourceProgram): boolean => {
  const resolved = resolveSymbol(symbol, indexed.checker)
  if (resolved === undefined) return false
  const seen = new Set<ts.Symbol>([resolved])
  return (
    resolved.declarations?.some((declaration) => {
      const tree = declaration.getSourceFile()
      return declarationLooksLikeLayer(declaration, tree, indexed, seen)
    }) ?? false
  )
}

const exportedLayerSymbols = (indexed: CapabilitySourceProgram): ReadonlySet<ts.Symbol> => {
  /* eslint-disable functional/immutable-data -- local symbol sets close over one source audit. */
  const layers = new Set<ts.Symbol>()
  const visited = new Set<ts.Symbol>()
  const visitModule = (module: ts.Symbol): void => {
    const resolvedModule = resolveSymbol(module, indexed.checker)
    if (resolvedModule === undefined || visited.has(resolvedModule)) return
    visited.add(resolvedModule)
    let exports: ReadonlyArray<ts.Symbol>
    try {
      exports = indexed.checker.getExportsOfModule(resolvedModule)
    } catch {
      return
    }
    for (const exported of exports) {
      const resolved = resolveSymbol(exported, indexed.checker)
      if (resolved !== undefined && isLayerSymbol(resolved, indexed)) layers.add(resolved)
      if (resolved !== undefined && resolved.exports !== undefined) visitModule(resolved)
    }
  }
  for (const file of indexed.sourceByPath.values()) {
    const module = indexed.checker.getSymbolAtLocation(parsedSource(file, indexed))
    if (module !== undefined) visitModule(module)
  }
  /* eslint-enable functional/immutable-data */
  return layers
}

const implementationEntries = (inventory: CapabilityRegistrationInventory): ReadonlyArray<RegisteredImplementation> =>
  inventory.capabilities.flatMap((capability) =>
    (["controlled", "production"] as const).flatMap((role) => {
      const implementation = capability[role]
      return implementation._tag === "Implementation" ? [implementation] : []
    })
  )

const sourceAt = (sourceFiles: ReadonlyArray<CapabilitySourceFile>, path: string): CapabilitySourceFile | undefined =>
  sourceFiles.find((file) => file.path === path)

const runtimeValueReferences = (
  file: CapabilitySourceFile,
  indexed: CapabilitySourceProgram
): ReadonlyArray<ts.Identifier | ts.PropertyAccessExpression> =>
  sourceNodes(parsedSource(file, indexed)).flatMap((node) => {
    if (!ts.isIdentifier(node) && !ts.isPropertyAccessExpression(node)) return []
    if (isTypePosition(node)) return []
    if (ts.isIdentifier(node) && (isDeclarationName(node) || isImportOrExportDeclaration(node))) return []
    return [node]
  })

const valueReferenceMatchesSymbol = (
  file: CapabilitySourceFile,
  marker: string,
  expected: ts.Symbol | undefined,
  indexed: CapabilitySourceProgram
): boolean => {
  if (expected === undefined) return false
  const normalized = normalizedMarker(marker)
  return runtimeValueReferences(file, indexed).some(
    (node) =>
      propertyAccessText(node) === normalized &&
      symbolsMatch(indexed.checker.getSymbolAtLocation(node), expected, indexed.checker)
  )
}

type ContractExecutionEvidence =
  CapabilityRegistrationInventory["capabilities"][number]["contract"]["executions"][number]

const contractImplementationIssues = (
  capability: CapabilityRegistrationInventory["capabilities"][number],
  execution: ContractExecutionEvidence,
  sourceFiles: ReadonlyArray<CapabilitySourceFile>,
  indexed: CapabilitySourceProgram
): ReadonlyArray<string> => {
  const binding = execution.implementation
  const implementation = capability[execution.role]
  if (binding === undefined) {
    return implementation._tag === "Implementation"
      ? [
          `${capability.family} ${execution.role} contract implementation binding is missing: ${implementation.identity}`
        ]
      : []
  }
  if (implementation._tag === "NotApplicable") return []
  const issue = `${capability.family} ${execution.role} contract implementation binding is stale: ${binding.identity}`
  if (
    binding.identity !== implementation.identity ||
    binding.source !== implementation.source ||
    binding.marker !== implementation.marker
  ) {
    return [issue]
  }
  const bindingSource = sourceAt(sourceFiles, binding.source)
  const expectedSymbol =
    bindingSource === undefined ? undefined : declarationSymbolFor(bindingSource, binding.marker, indexed)
  if (expectedSymbol === undefined || execution.invocation === undefined) return [issue]
  const invocationSource = sourceAt(sourceFiles, execution.invocation.source)
  if (invocationSource === undefined) return [issue]
  const calls = callExpressions(
    invocationSource,
    execution.invocation.marker,
    execution.invocation.selector,
    execution.source,
    execution.marker,
    indexed
  )
  const bound = calls.some((call) => {
    const expressions = bindingExpressions(call, binding.selector)
    return (
      expressions.length > 0 &&
      expressions.every((expression) => expressionReferencesSymbol(expression, expectedSymbol, indexed))
    )
  })
  return bound ? [] : [issue]
}

const implementationSourceIssues = (
  inventory: CapabilityRegistrationInventory,
  sourceFiles: ReadonlyArray<CapabilitySourceFile>
): ReadonlyArray<string> => {
  // The local diagnostic list is intentionally mutable so every failed source
  // fact is retained; it is never exposed or shared with runtime code.
  /* eslint-disable functional/immutable-data */
  const issues: Array<string> = []
  const indexed = sourceProgram(sourceFiles)
  for (const capability of inventory.capabilities) {
    for (const role of ["controlled", "production"] as const) {
      const implementation = capability[role]
      if (implementation._tag === "NotApplicable") continue
      const source = sourceAt(sourceFiles, implementation.source)
      if (source === undefined) {
        issues.push(`${capability.family} ${role} implementation source is missing: ${implementation.source}`)
      } else if (declarationSymbolFor(source, implementation.marker, indexed) === undefined) {
        issues.push(`${capability.family} ${role} implementation marker is stale: ${implementation.marker}`)
      }
      const implementationSymbol =
        source === undefined ? undefined : declarationSymbolFor(source, implementation.marker, indexed)
      const composition = sourceAt(sourceFiles, implementation.composition.source)
      if (composition === undefined) {
        issues.push(`${capability.family} ${role} composition source is missing: ${implementation.composition.source}`)
      } else if (!hasValueReference(composition, implementation.composition.marker, indexed)) {
        issues.push(`${capability.family} ${role} composition marker is stale: ${implementation.composition.marker}`)
      } else if (implementation.composition.marker !== implementation.identity) {
        issues.push(
          `${capability.family} ${role} composition does not consume implementation identity ${implementation.identity}`
        )
      } else if (implementation.composition.identity !== implementation.identity) {
        issues.push(
          `${capability.family} ${role} composition identity is stale: ${implementation.composition.identity}`
        )
      } else if (!valueReferenceMatchesSymbol(composition, implementation.identity, implementationSymbol, indexed)) {
        issues.push(
          `${capability.family} ${role} composition does not consume implementation identity ${implementation.identity}`
        )
      }
    }
    for (const execution of capability.contract.executions) {
      const source = sourceAt(sourceFiles, execution.source)
      if (source === undefined) {
        issues.push(`${capability.family} contract source is missing: ${execution.source}`)
      } else if (declarationSymbolFor(source, execution.marker, indexed) === undefined) {
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
            indexed
          )
        ) {
          const executionLabel =
            capability.family === "journal" ? `${capability.family} ${execution.role}` : capability.family
          issues.push(`${executionLabel} contract invocation marker is stale: ${execution.invocation.marker}`)
        }
      }
      issues.push(...contractImplementationIssues(capability, execution, sourceFiles, indexed))
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
  const indexed = sourceProgram(sourceFiles)
  const exportedLayers = exportedLayerSymbols(indexed)
  const registered = new Map<string, ts.Symbol>()
  for (const implementation of implementationEntries(inventory)) {
    const source = sourceAt(sourceFiles, implementation.source)
    const symbol = source === undefined ? undefined : declarationSymbolFor(source, implementation.marker, indexed)
    if (symbol !== undefined) registered.set(implementation.identity, symbol)
  }
  const support = new Map<string, ts.Symbol>()
  for (const binding of inventory.compositionSupportBindings) {
    const source = sourceAt(sourceFiles, binding.source)
    const symbol = source === undefined ? undefined : declarationSymbolFor(source, binding.marker, indexed)
    if (symbol !== undefined) support.set(binding.identity, symbol)
  }
  const allowed = new Map([...registered, ...support])
  const allowedSymbols = new Set([...allowed.values()].map((symbol) => resolveSymbol(symbol, indexed.checker)))
  const reported = new Set<string>()
  for (const composition of inventory.compositionSources) {
    const source = sourceAt(sourceFiles, composition.source)
    if (source === undefined) {
      issues.push(`${composition.role} composition source is missing: ${composition.source}`)
      continue
    }
    for (const node of runtimeValueReferences(source, indexed)) {
      const identity = propertyAccessText(node)
      if (identity === undefined) continue
      const symbol = resolveSymbol(indexed.checker.getSymbolAtLocation(node), indexed.checker)
      const expected = allowed.get(identity)
      const expectedResolved = expected === undefined ? undefined : resolveSymbol(expected, indexed.checker)
      const isAllowedByBinding = expectedResolved !== undefined && symbol !== undefined && symbol === expectedResolved
      const isAllowedByIdentity = expected !== undefined
      if (isAllowedByIdentity && !isAllowedByBinding) continue
      if (
        symbol !== undefined &&
        exportedLayers.has(symbol) &&
        !allowedSymbols.has(symbol) &&
        isLayerSymbol(symbol, indexed)
      ) {
        const issue = `${composition.role} uses unregistered exported Layer ${identity}`
        if (!reported.has(issue)) {
          reported.add(issue)
          issues.push(issue)
        }
      }
    }
  }
  /* eslint-enable functional/immutable-data */
  return issues
}

const supportBindingSourceIssues = (
  inventory: CapabilityRegistrationInventory,
  sourceFiles: ReadonlyArray<CapabilitySourceFile>
): ReadonlyArray<string> => {
  const indexed = sourceProgram(sourceFiles)
  const issues: Array<string> = []
  /* eslint-disable functional/immutable-data -- local diagnostics are accumulated for one audit. */
  for (const binding of inventory.compositionSupportBindings) {
    const source = sourceAt(sourceFiles, binding.source)
    if (source === undefined) {
      issues.push(`support binding ${binding.identity} declaration source is missing: ${binding.source}`)
    } else if (declarationSymbolFor(source, binding.marker, indexed) === undefined) {
      issues.push(`support binding ${binding.identity} declaration source is stale: ${binding.source}`)
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
  ...supportBindingSourceIssues(inventory, sourceFiles),
  ...compositionReferenceIssues(inventory, sourceFiles)
]
