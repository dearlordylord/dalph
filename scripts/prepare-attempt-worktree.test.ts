import { execFileSync, spawnSync } from "node:child_process"
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, expect, it } from "vitest"

// @ts-expect-error The task preparation is an executable JavaScript module.
import { prepareAttemptWorktree } from "./prepare-attempt-worktree.mjs"

const roots: Array<string> = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const fixture = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "dalph-attempt-prep-")))
  roots.push(root)
  writeFileSync(join(root, "package.json"), JSON.stringify({ engines: { node: "^24.20.0" } }))
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n")
  writeFileSync(join(root, "mise.toml"), '[tools]\nnode = "24"\n')
  return root
}

it("selects repository Node before frozen install in the exact worktree", async () => {
  const root = fixture()
  const commands: Array<{ readonly executable: string; readonly args: ReadonlyArray<string>; readonly cwd: string }> =
    []
  const result = await prepareAttemptWorktree({
    cwd: root,
    gitTopLevel: () => root,
    runCommand: async (command: {
      readonly executable: string
      readonly args: ReadonlyArray<string>
      readonly cwd: string
    }) => {
      commands.push(command)
      if (command.args.includes("install")) mkdirSync(join(root, "node_modules", ".pnpm"), { recursive: true })
      return command.args.includes("process.version") ? { output: "v24.20.0\n" } : {}
    }
  })
  expect(result).toEqual({ node: "v24.20.0", worktree: root })
  expect(commands.map(({ args, cwd, executable }) => ({ args, cwd, executable }))).toEqual([
    { executable: "mise", args: ["exec", "--", "node", "-p", "process.version"], cwd: root },
    { executable: "mise", args: ["exec", "--", "pnpm", "install", "--frozen-lockfile"], cwd: root }
  ])
})

it("rejects unsupported Node before installing dependencies", async () => {
  const root = fixture()
  const commands: Array<ReadonlyArray<string>> = []
  await expect(
    prepareAttemptWorktree({
      cwd: root,
      gitTopLevel: () => root,
      runCommand: async (command: { readonly args: ReadonlyArray<string> }) => {
        commands.push(command.args)
        return { output: "v25.6.1\n" }
      }
    })
  ).rejects.toMatchObject({ stage: "node" })
  expect(commands).toEqual([["exec", "--", "node", "-p", "process.version"]])
})

it("rejects a different worktree root before executing commands", async () => {
  const root = fixture()
  const other = fixture()
  await expect(prepareAttemptWorktree({ cwd: root, gitTopLevel: () => other })).rejects.toMatchObject({ stage: "git" })
})

it("rejects an install that exits without dependencies", async () => {
  const root = fixture()
  await expect(
    prepareAttemptWorktree({
      cwd: root,
      gitTopLevel: () => root,
      runCommand: async (command: { readonly args: ReadonlyArray<string> }) =>
        command.args.includes("process.version") ? { output: "v24.21.0\n" } : {}
    })
  ).rejects.toMatchObject({ stage: "install" })
})

it("writes an exact terminal receipt after the frozen install has completed", () => {
  const root = fixture()
  execFileSync("git", ["init", "--quiet"], { cwd: root })
  const bin = join(root, "bin")
  mkdirSync(bin)
  const mise = join(bin, "mise")
  writeFileSync(mise, '#!/bin/sh\nif [ "$3" = node ]; then echo v24.20.0; else mkdir -p node_modules/.pnpm; fi\n')
  chmodSync(mise, 0o755)
  const receipt = join(root, "receipt.json")
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./prepare-attempt-worktree.mjs", import.meta.url))],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env["PATH"] ?? ""}`,
        DALPH_ATTEMPT_PREPARATION_RECEIPT: receipt,
        DALPH_ATTEMPT_PREPARATION_TOKEN: "exact-token"
      },
      timeout: 10_000
    }
  )
  expect(result.status).toBe(0)
  expect(JSON.parse(readFileSync(receipt, "utf8"))).toEqual({
    _tag: "AttemptWorktreePrepared",
    node: "v24.20.0",
    token: "exact-token",
    worktree: root
  })
})

it("does not write a terminal receipt while an install descendant remains unproven", async () => {
  const root = fixture()
  execFileSync("git", ["init", "--quiet"], { cwd: root })
  const bin = join(root, "bin")
  mkdirSync(bin)
  const mise = join(bin, "mise")
  writeFileSync(
    mise,
    '#!/bin/sh\nif [ "$3" = node ]; then echo v24.20.0; else sleep 4 >/dev/null 2>&1 </dev/null & exit 1; fi\n'
  )
  chmodSync(mise, 0o755)
  const receipt = join(root, "receipt.json")
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("./prepare-attempt-worktree.mjs", import.meta.url))],
    {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env["PATH"] ?? ""}`,
        DALPH_ATTEMPT_PREPARATION_RECEIPT: receipt,
        DALPH_ATTEMPT_PREPARATION_TOKEN: "exact-token"
      },
      timeout: 10_000
    }
  )
  expect(result.status).toBe(1)
  expect(result.stderr).toContain("not proven absent")
  expect(existsSync(receipt)).toBe(false)
  // The fixture's four-second descendant exits naturally after the two-second
  // absence window. Keep the test's own process lifetime beyond that exit.
  await new Promise((resolve) => setTimeout(resolve, 4_000))
})
