import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join, relative, resolve } from "node:path"
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

const escapedRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")

const exportedLayerSymbols = (sourceFiles: ReadonlyArray<CapabilitySourceFile>): ReadonlySet<string> =>
  new Set(
    sourceFiles.flatMap(({ source }) =>
      [...source.matchAll(/\bexport\s+const\s+(?<identity>[A-Za-z][A-Za-z0-9_]*Layer)\b/gu)].flatMap((match) =>
        match.groups?.["identity"] === undefined ? [] : [match.groups["identity"]]
      )
    )
  )

const referencesOutsideDeclaration = (source: string, identity: string): boolean => {
  const pattern = new RegExp(`\\b${escapedRegExp(identity)}\\b`, "gu")
  for (const match of source.matchAll(pattern)) {
    const lineStart = source.lastIndexOf("\n", match.index) + 1
    const lineEnd = source.indexOf("\n", match.index)
    const line = source.slice(lineStart, lineEnd < 0 ? undefined : lineEnd)
    if (!new RegExp(`^\\s*export\\s+const\\s+${escapedRegExp(identity)}\\b`, "u").test(line)) return true
  }
  return false
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

const hasCompositionUse = (source: string, marker: string): boolean => {
  const pattern = new RegExp(`\\b${escapedRegExp(marker)}\\b`, "gu")
  return [...source.matchAll(pattern)].some((match) => {
    const lineStart = source.lastIndexOf("\n", match.index) + 1
    const lineEnd = source.indexOf("\n", match.index)
    const line = source.slice(lineStart, lineEnd < 0 ? undefined : lineEnd)
    return !/^\s*import\b/u.test(line) && !/^\s*export\s+const\b/u.test(line)
  })
}

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
      } else if (!source.source.includes(implementation.marker)) {
        issues.push(`${capability.family} ${role} implementation marker is stale: ${implementation.marker}`)
      }
      const composition = sourceAt(sourceFiles, implementation.composition.source)
      if (composition === undefined) {
        issues.push(`${capability.family} ${role} composition source is missing: ${implementation.composition.source}`)
      } else if (!hasCompositionUse(composition.source, implementation.composition.marker)) {
        issues.push(`${capability.family} ${role} composition marker is stale: ${implementation.composition.marker}`)
      }
    }
    for (const execution of capability.contract.executions) {
      const source = sourceAt(sourceFiles, execution.source)
      if (source === undefined) {
        issues.push(`${capability.family} contract source is missing: ${execution.source}`)
      } else if (!source.source.includes(execution.marker)) {
        issues.push(`${capability.family} contract marker is stale: ${execution.marker}`)
      }
      if (execution.invocation !== undefined) {
        const invocation = sourceAt(sourceFiles, execution.invocation.source)
        if (invocation === undefined) {
          issues.push(`${capability.family} contract invocation source is missing: ${execution.invocation.source}`)
        } else if (!invocation.source.includes(execution.invocation.marker)) {
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
  const exportedLayers = exportedLayerSymbols(sourceFiles)
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
      if (!referencesOutsideDeclaration(source.source, identity)) continue
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
