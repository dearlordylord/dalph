import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"

// @ts-expect-error The bootstrap is an executable JavaScript module.
import { bootstrapWorktree } from "./bootstrap-worktree.mjs"

const temporaryRoots: Array<string> = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true })
})

const bootstrapFixture = (withSubmodules = false) => {
  const root = mkdtempSync(join(tmpdir(), "dalph-bootstrap-worktree-"))
  temporaryRoots.push(root)
  mkdirSync(join(root, "packages", "tool"), { recursive: true })
  writeFileSync(
    join(root, "packages", "tool", "package.json"),
    `${JSON.stringify({ name: "@fixture/tool", bin: { "fixture-tool": "dist/bin/tool.js" } })}\n`
  )
  if (withSubmodules) writeFileSync(join(root, ".gitmodules"), '[submodule "fixture"]\n\tpath = fixture\n')
  return root
}

const writeFixtureLauncher = (root: string) => {
  const launcher = join(
    root,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "fixture-tool.cmd" : "fixture-tool"
  )
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true })
  writeFileSync(launcher, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n")
}

it("runs frozen install before artifact preparation", async () => {
  const repositoryRoot = bootstrapFixture(true)
  const commands: Array<ReadonlyArray<string>> = []

  await bootstrapWorktree({
    pnpmEntryPoint: "/fake/pnpm.cjs",
    repositoryRoot,
    runCommand: (command: { readonly args: ReadonlyArray<string> }) => {
      commands.push(command.args)
      if (command.args.includes("--ignore-scripts")) writeFixtureLauncher(repositoryRoot)
      return Promise.resolve({ outputLineCount: 0 })
    }
  })

  expect(commands).toEqual([
    ["submodule", "update", "--init", "--recursive"],
    ["/fake/pnpm.cjs", "--silent", "install", "--frozen-lockfile"],
    ["/fake/pnpm.cjs", "--silent", "check:artifacts"],
    ["/fake/pnpm.cjs", "--silent", "install", "--frozen-lockfile", "--ignore-scripts"]
  ])
})

it("does not install dependencies when submodule initialization fails", async () => {
  const commands: Array<ReadonlyArray<string>> = []
  const submoduleFailure = new Error("submodule initialization failed")

  await expect(
    bootstrapWorktree({
      pnpmEntryPoint: "/fake/pnpm.cjs",
      repositoryRoot: bootstrapFixture(true),
      runCommand: (command: { readonly args: ReadonlyArray<string> }) => {
        commands.push(command.args)
        return Promise.reject(submoduleFailure)
      }
    })
  ).rejects.toBe(submoduleFailure)
  expect(commands).toEqual([["submodule", "update", "--init", "--recursive"]])
})

it("does not prepare artifacts when the frozen install fails", async () => {
  const commands: Array<ReadonlyArray<string>> = []
  const installFailure = new Error("frozen install failed")

  await expect(
    bootstrapWorktree({
      pnpmEntryPoint: "/fake/pnpm.cjs",
      repositoryRoot: bootstrapFixture(),
      runCommand: (command: { readonly args: ReadonlyArray<string> }) => {
        commands.push(command.args)
        return Promise.reject(installFailure)
      }
    })
  ).rejects.toBe(installFailure)
  expect(commands).toEqual([["/fake/pnpm.cjs", "--silent", "install", "--frozen-lockfile"]])
})

it("fails when the script-disabled relink does not create a declared workspace bin launcher", async () => {
  const repositoryRoot = bootstrapFixture()

  await expect(
    bootstrapWorktree({
      pnpmEntryPoint: "/fake/pnpm.cjs",
      repositoryRoot,
      runCommand: () => Promise.resolve({ outputLineCount: 0 })
    })
  ).rejects.toThrow("workspace bin launcher is missing: fixture-tool")
})

it("relinks a workspace bin whose generated target was absent during the first frozen install", async () => {
  const repositoryRoot = bootstrapFixture()
  writeFileSync(
    join(repositoryRoot, "package.json"),
    `${JSON.stringify({
      name: "fixture-root",
      private: true,
      scripts: { "check:artifacts": "pnpm --filter @fixture/tool build" },
      devDependencies: { "@fixture/tool": "workspace:*" }
    })}\n`
  )
  writeFileSync(join(repositoryRoot, "pnpm-workspace.yaml"), 'packages:\n  - "."\n  - "packages/*"\n')
  writeFileSync(
    join(repositoryRoot, "packages", "tool", "package.json"),
    `${JSON.stringify({
      name: "@fixture/tool",
      version: "0.0.0",
      private: true,
      type: "module",
      bin: { "fixture-tool": "dist/bin/tool.js" },
      scripts: { build: "node build.mjs" }
    })}\n`
  )
  writeFileSync(
    join(repositoryRoot, "packages", "tool", "build.mjs"),
    'import { mkdirSync, writeFileSync } from "node:fs"\nmkdirSync("dist/bin", { recursive: true })\nwriteFileSync("dist/bin/tool.js", "#!/usr/bin/env node\\nprocess.stdout.write(\\"usable\\")\\n")\n'
  )
  const pnpmEntryPoint = process.env["npm_execpath"]
  if (pnpmEntryPoint === undefined) {
    throw new Error("run the focused bootstrap integration through `pnpm test` so pnpm exposes its entry point")
  }
  execFileSync(
    process.execPath,
    [pnpmEntryPoint, "install", "--lockfile-only", "--no-frozen-lockfile", "--ignore-scripts"],
    { cwd: repositoryRoot, stdio: "ignore" }
  )

  await bootstrapWorktree({ pnpmEntryPoint, repositoryRoot })

  const launcher = join(
    repositoryRoot,
    "node_modules",
    ".bin",
    process.platform === "win32" ? "fixture-tool.cmd" : "fixture-tool"
  )
  const output =
    process.platform === "win32"
      ? execFileSync(process.env["ComSpec"] ?? "cmd.exe", ["/d", "/s", "/c", launcher], { encoding: "utf8" })
      : execFileSync(launcher, { encoding: "utf8" })
  expect(output).toBe("usable")
}, 30_000)
