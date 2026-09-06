import { mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"

// @ts-expect-error The artifact checker is an executable JavaScript module.
import { prepareWorkspaceArtifacts, validateWorkspaceArtifacts } from "./workspace-artifacts.mjs"
// @ts-expect-error The production quality-gate helper is an executable JavaScript module.
import { runBoundedCommand } from "./run-bounded-command.mjs"

const temporaryRoots: Array<string> = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true })
})

const workspaceWithPackage = (manifest: object): string => {
  const root = mkdtempSync(join(tmpdir(), "dalph-workspace-artifacts-"))
  temporaryRoots.push(root)
  mkdirSync(join(root, "packages", "example"), { recursive: true })
  writeFileSync(join(root, "packages", "example", "package.json"), `${JSON.stringify(manifest)}\n`)
  return root
}

const packageNames = ["contracts", "orchestrator", "dalph"] as const

const writeValidArtifacts = (repositoryRoot: string) => {
  for (const packageName of packageNames) {
    const dist = join(repositoryRoot, "packages", packageName, "dist")
    mkdirSync(join(dist, "src"), { recursive: true })
    writeFileSync(join(dist, "src", "index.js"), `export const packageName = ${JSON.stringify(packageName)}\n`)
    writeFileSync(join(dist, "src", "index.d.ts"), `export declare const packageName: ${JSON.stringify(packageName)}\n`)
  }
  const bin = join(repositoryRoot, "packages", "dalph", "dist", "bin")
  mkdirSync(bin, { recursive: true })
  writeFileSync(join(bin, "dalph.js"), "#!/usr/bin/env node\nprocess.stdout.write('dalph fixture')\n")
}

const artifactWorkspace = (): string => {
  const root = mkdtempSync(join(tmpdir(), "dalph-workspace-artifacts-"))
  temporaryRoots.push(root)
  for (const packageName of packageNames) {
    const packageRoot = join(root, "packages", packageName)
    mkdirSync(packageRoot, { recursive: true })
    const manifest = {
      name: `@dalph/${packageName}`,
      version: "0.0.0",
      private: true,
      type: "module",
      exports: { ".": { types: "./dist/src/index.d.ts", default: "./dist/src/index.js" } },
      files: ["dist"],
      scripts: { build: `build-${packageName}` },
      ...(packageName === "dalph" ? { bin: { dalph: "dist/bin/dalph.js" } } : {})
    }
    writeFileSync(join(packageRoot, "package.json"), `${JSON.stringify(manifest)}\n`)
  }
  mkdirSync(join(root, "scripts"), { recursive: true })
  writeFileSync(
    join(root, "scripts", "workspace-artifact-consumer.ts"),
    packageNames.map((name) => `import "@dalph/${name}"`).join("\n")
  )
  writeFileSync(
    join(root, "tsconfig.artifacts.json"),
    `${JSON.stringify({
      compilerOptions: {
        module: "NodeNext",
        moduleResolution: "NodeNext",
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: "ES2022",
        types: []
      },
      include: ["scripts/workspace-artifact-consumer.ts"]
    })}\n`
  )
  const scope = join(root, "node_modules", "@dalph")
  mkdirSync(scope, { recursive: true })
  for (const packageName of packageNames) {
    symlinkSync(join(root, "packages", packageName), join(scope, packageName), "dir")
  }
  return root
}

const filesBelow = (root: string, relative = ""): Array<string> =>
  readdirSync(join(root, relative), { withFileTypes: true }).flatMap((entry) => {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`
    return entry.isDirectory() ? filesBelow(root, path) : [path]
  })

const runnerFor = (repositoryRoot: string, commands: Array<string>) => async (command: Record<string, unknown>) => {
  commands.push(String(command["name"]))
  const args = command["args"] as Array<string>
  if (args.includes("build")) {
    writeValidArtifacts(repositoryRoot)
    return { outputLineCount: 0 }
  }
  if (args.includes("check:package-boundary")) return { outputLineCount: 0 }
  if (args.includes("pack")) {
    const packageName = args.at(args.indexOf("--filter") + 1)?.replace("@dalph/", "") ?? ""
    return {
      exitCode: 0,
      output: JSON.stringify({
        files: [
          "package.json",
          ...filesBelow(join(repositoryRoot, "packages", packageName, "dist")).map((path) => `dist/${path}`)
        ].map((path) => ({ path }))
      }),
      outputLineCount: 1
    }
  }
  if (args.includes("tsc")) {
    return runBoundedCommand({
      ...command,
      args: [
        join(import.meta.dirname, "..", "node_modules", "typescript", "bin", "tsc"),
        "-p",
        "tsconfig.artifacts.json"
      ],
      executable: process.execPath,
      forwardOutput: false
    })
  }
  return runBoundedCommand({ ...command, forwardOutput: false })
}

it("rejects a production workspace package without a build script before running a build", async () => {
  const repositoryRoot = workspaceWithPackage({ name: "@dalph/example", private: true, version: "0.0.0" })
  const commands: Array<unknown> = []

  await expect(
    prepareWorkspaceArtifacts({
      pnpmEntryPoint: "/fake/pnpm.cjs",
      repositoryRoot,
      runCommand: (command: unknown) => {
        commands.push(command)
        return Promise.resolve({ outputLineCount: 0 })
      }
    })
  ).rejects.toThrow("@dalph/example must declare a nonempty scripts.build")
  expect(commands).toEqual([])
})

it("builds absent output before validating normal exports, declarations, bins, and package contents", async () => {
  const repositoryRoot = artifactWorkspace()
  const commands: Array<string> = []

  await prepareWorkspaceArtifacts({
    pnpmEntryPoint: "/fake/pnpm.cjs",
    repositoryRoot,
    runCommand: runnerFor(repositoryRoot, commands)
  })

  expect(commands).toEqual([
    "Workspace production build",
    "Production package boundary",
    "Artifact declaration resolution",
    "Artifact runtime export imports",
    "@dalph/dalph bin dalph syntax",
    "@dalph/contracts package contents",
    "@dalph/dalph package contents",
    "@dalph/orchestrator package contents"
  ])
})

it("rejects a missing exported runtime artifact", async () => {
  const repositoryRoot = artifactWorkspace()
  writeValidArtifacts(repositoryRoot)
  rmSync(join(repositoryRoot, "packages", "contracts", "dist", "src", "index.js"))

  await expect(
    validateWorkspaceArtifacts({
      pnpmEntryPoint: "/fake/pnpm.cjs",
      repositoryRoot,
      runCommand: runnerFor(repositoryRoot, [])
    })
  ).rejects.toThrow("@dalph/contracts package target is missing: ./dist/src/index.js")
})

it("rejects malformed exported JavaScript in the fresh runtime-import process", async () => {
  const repositoryRoot = artifactWorkspace()
  writeValidArtifacts(repositoryRoot)
  writeFileSync(join(repositoryRoot, "packages", "contracts", "dist", "src", "index.js"), "export const =")

  await expect(
    validateWorkspaceArtifacts({
      pnpmEntryPoint: "/fake/pnpm.cjs",
      repositoryRoot,
      runCommand: runnerFor(repositoryRoot, [])
    })
  ).rejects.toThrow("Artifact runtime export imports failed with exit 1")
})

it("rejects malformed exported declarations through the mapping-free consumer", async () => {
  const repositoryRoot = artifactWorkspace()
  writeValidArtifacts(repositoryRoot)
  writeFileSync(join(repositoryRoot, "packages", "contracts", "dist", "src", "index.d.ts"), "export declare const :")

  await expect(
    validateWorkspaceArtifacts({
      pnpmEntryPoint: "/fake/pnpm.cjs",
      repositoryRoot,
      runCommand: runnerFor(repositoryRoot, [])
    })
  ).rejects.toThrow("Artifact declaration resolution failed with exit 2")
})

it("rejects a declared bin omitted from the package inventory", async () => {
  const repositoryRoot = artifactWorkspace()
  writeValidArtifacts(repositoryRoot)
  const baseRunner = runnerFor(repositoryRoot, [])

  await expect(
    validateWorkspaceArtifacts({
      pnpmEntryPoint: "/fake/pnpm.cjs",
      repositoryRoot,
      runCommand: async (command: Record<string, unknown>) => {
        const result = await baseRunner(command)
        if (String(command["name"]) !== "@dalph/dalph package contents" || !("output" in result)) return result
        const report = JSON.parse(String(result.output)) as { files: Array<{ path: string }> }
        return {
          ...result,
          output: JSON.stringify({ files: report.files.filter(({ path }) => path !== "dist/bin/dalph.js") })
        }
      }
    })
  ).rejects.toThrow("@dalph/dalph package omits declared artifact: dist/bin/dalph.js")
})
