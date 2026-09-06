import { execFileSync, spawnSync } from "node:child_process"
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, relative, resolve } from "node:path"
import ts from "typescript"
import { afterEach, expect, it } from "vitest"

const repositoryRoot = resolve(import.meta.dirname, "..")
const temporaryRoots: Array<string> = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true })
})

const compilerOptionsFor = (relativeConfigPath: string): ts.CompilerOptions => {
  const configPath = resolve(repositoryRoot, relativeConfigPath)
  const config = ts.readConfigFile(configPath, (path) => readFileSync(path, "utf8"))
  if (config.error !== undefined) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, "\n"))
  return ts.parseJsonConfigFileContent(config.config, ts.sys, dirname(configPath), undefined, configPath).options
}

const resolveWorkspacePackage = (packageName: string, options: ts.CompilerOptions) =>
  ts.resolveModuleName(packageName, resolve(repositoryRoot, "scripts/workspace-artifact-consumer.ts"), options, ts.sys)
    .resolvedModule?.resolvedFileName

const resolutionWorkspace = ({ withStaleDeclaration }: { readonly withStaleDeclaration: boolean }) => {
  const root = mkdtempSync(join(tmpdir(), "dalph-workspace-resolution-"))
  temporaryRoots.push(root)
  cpSync(join(repositoryRoot, "tsconfig.base.json"), join(root, "tsconfig.base.json"))
  cpSync(join(repositoryRoot, "tsconfig.json"), join(root, "tsconfig.json"))
  cpSync(join(repositoryRoot, "tsconfig.artifacts.json"), join(root, "tsconfig.artifacts.json"))
  for (const packageName of ["contracts", "orchestrator", "dalph"]) {
    const packageRoot = join(root, "packages", packageName)
    mkdirSync(join(packageRoot, "src"), { recursive: true })
    writeFileSync(
      join(packageRoot, "package.json"),
      `${JSON.stringify({
        name: `@dalph/${packageName}`,
        type: "module",
        exports: { ".": { types: "./dist/src/index.d.ts", default: "./dist/src/index.js" } }
      })}\n`
    )
  }
  writeFileSync(join(root, "packages", "contracts", "src", "index.ts"), "export interface Current { source: true }\n")
  writeFileSync(
    join(root, "packages", "orchestrator", "src", "index.ts"),
    'import type { Current } from "@dalph/contracts"\nexport const current: Current = { source: true }\n'
  )
  writeFileSync(join(root, "packages", "dalph", "src", "index.ts"), 'export { current } from "@dalph/orchestrator"\n')
  mkdirSync(join(root, "scripts"), { recursive: true })
  writeFileSync(
    join(root, "scripts", "workspace-artifact-consumer.ts"),
    'import type { Current } from "@dalph/contracts"\nconst current: Current = { source: true }\nvoid current\n'
  )
  for (const configName of ["tsconfig.json", "tsconfig.artifacts.json"]) {
    const configPath = join(root, configName)
    const config = JSON.parse(readFileSync(configPath, "utf8"))
    writeFileSync(
      configPath,
      `${JSON.stringify({ ...config, compilerOptions: { ...config.compilerOptions, types: [] } })}\n`
    )
  }
  if (withStaleDeclaration) {
    const dist = join(root, "packages", "contracts", "dist", "src")
    mkdirSync(dist, { recursive: true })
    writeFileSync(join(dist, "index.d.ts"), "export interface Current { stale: true }\n")
    const scope = join(root, "node_modules", "@dalph")
    mkdirSync(scope, { recursive: true })
    symlinkSync(join(root, "packages", "contracts"), join(scope, "contracts"), "dir")
  }
  return root
}

const tsc = join(repositoryRoot, "node_modules", "typescript", "bin", "tsc")
const vitest = join(repositoryRoot, "node_modules", "vitest", "vitest.mjs")

it("resolves workspace package imports to current source for root development checks", () => {
  const options = compilerOptionsFor("tsconfig.json")

  expect(resolveWorkspacePackage("@dalph/contracts", options)).toBe(
    resolve(repositoryRoot, "packages/contracts/src/index.ts")
  )
  expect(resolveWorkspacePackage("@dalph/orchestrator", options)).toBe(
    resolve(repositoryRoot, "packages/orchestrator/src/index.ts")
  )
  expect(resolveWorkspacePackage("@dalph/dalph", options)).toBe(resolve(repositoryRoot, "packages/dalph/src/index.ts"))
})

it("keeps source mappings out of package emission and artifact validation", () => {
  expect(compilerOptionsFor("packages/contracts/tsconfig.json").paths).toBeUndefined()
  expect(compilerOptionsFor("packages/orchestrator/tsconfig.json").paths).toBeUndefined()
  expect(compilerOptionsFor("packages/dalph/tsconfig.json").paths).toBeUndefined()
  expect(compilerOptionsFor("tsconfig.artifacts.json").paths).toBeUndefined()
})

it("typechecks cross-package current source when every package output is absent", () => {
  const root = resolutionWorkspace({ withStaleDeclaration: false })

  expect(() => execFileSync(process.execPath, [tsc, "-p", "tsconfig.json", "--noEmit"], { cwd: root })).not.toThrow()
}, 30_000)

it("observes a producer source change while the mapping-free artifact probe still detects its stale declaration", () => {
  const root = resolutionWorkspace({ withStaleDeclaration: true })

  expect(() => execFileSync(process.execPath, [tsc, "-p", "tsconfig.json", "--noEmit"], { cwd: root })).not.toThrow()
  const artifactProbe = spawnSync(process.execPath, [tsc, "-p", "tsconfig.artifacts.json", "--noEmit"], {
    cwd: root,
    encoding: "utf8"
  })
  expect(artifactProbe.status).toBe(2)
  expect(artifactProbe.stdout).toContain("'source' does not exist in type 'Current'")
}, 30_000)

it("runs a cross-package focused test from source with absent and stale package output", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "dalph-workspace-focused-test-"))
  temporaryRoots.push(temporaryRoot)
  const workspace = join(temporaryRoot, "workspace")
  const ignoredSegments = new Set([".git", ".scratch", "coverage", "dist", "node_modules"])
  cpSync(repositoryRoot, workspace, {
    filter: (source) => {
      const path = relative(repositoryRoot, source)
      return path === "" || !path.split(/[\\/]/u).some((segment) => ignoredSegments.has(segment))
    },
    recursive: true
  })
  symlinkSync(join(repositoryRoot, "node_modules"), join(workspace, "node_modules"), "dir")
  for (const packageName of ["contracts", "orchestrator", "dalph"]) {
    symlinkSync(
      join(repositoryRoot, "packages", packageName, "node_modules"),
      join(workspace, "packages", packageName, "node_modules"),
      "dir"
    )
  }
  const focusedTest = "packages/orchestrator/src/coordination/delivery/delivery-colour.test.ts"
  const runFocusedTest = () =>
    execFileSync(process.execPath, [vitest, "run", focusedTest], { cwd: workspace, stdio: "pipe" })

  expect(runFocusedTest).not.toThrow()
  const staleDist = join(workspace, "packages", "contracts", "dist", "src")
  mkdirSync(staleDist, { recursive: true })
  writeFileSync(join(staleDist, "index.d.ts"), "this is deliberately invalid stale output")
  expect(runFocusedTest).not.toThrow()
}, 60_000)
