import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
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
