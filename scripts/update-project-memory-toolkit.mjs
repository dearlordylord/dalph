#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const optMemDirectory = resolve(root, "tools", "optmem")

const runGit = (args, cwd = root) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim()

export const assertUpdateBranch = (branch) => {
  if (branch !== "master") {
    throw new Error("Update OptMem only from the master worktree.")
  }
}

const defaultTestRunner = ({ optMemDirectory: directory, root: repository }) => {
  const python = process.platform === "win32" ? ["py", ["-3", "test.py"]] : ["python3", ["test.py"]]
  const upstream = spawnSync(python[0], python[1], {
    cwd: directory,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    stdio: "inherit"
  })
  if (upstream.error || upstream.status !== 0) {
    return false
  }

  const local = spawnSync(process.execPath, ["--test", "scripts/project-memory.test.mjs"], {
    cwd: repository,
    stdio: "inherit"
  })
  return local.error === undefined && local.status === 0
}

export const updateWith = ({ git, optMemDirectory: directory, root: repository, runTests }) => {
  assertUpdateBranch(git(["branch", "--show-current"], repository))
  git(["submodule", "update", "--init", "tools/optmem"], repository)

  if (git(["status", "--porcelain"], directory) !== "") {
    throw new Error("The OptMem submodule has local changes; review them before updating.")
  }

  const before = git(["rev-parse", "HEAD"], directory)
  git(["submodule", "update", "--remote", "tools/optmem"], repository)
  const after = git(["rev-parse", "HEAD"], directory)

  if (!runTests({ after, optMemDirectory: directory, root: repository })) {
    throw new Error(
      `OptMem ${after} failed its upstream or local test suite. ` + "The gitlink remains changed for inspection."
    )
  }

  return { after, before }
}

export const update = () => {
  const { after, before } = updateWith({ git: runGit, optMemDirectory, root, runTests: defaultTestRunner })

  if (before === after) {
    process.stdout.write(`OptMem is already current at ${after}.\n`)
  } else {
    process.stdout.write(`OptMem updated from ${before} to ${after}. Review and commit the gitlink.\n`)
  }
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  update()
}
