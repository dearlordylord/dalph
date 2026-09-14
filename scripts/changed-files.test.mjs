import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { test } from "node:test"
import { changedRepositoryFileSelection, completeFormalChangedPaths } from "./changed-files.mjs"

const git = (root, ...arguments_) => execFileSync("git", arguments_, { cwd: root, encoding: "utf8" }).trim()

const createFixture = () => {
  const root = mkdtempSync(join(tmpdir(), "dalph-changed-files-"))
  const write = (path, contents = "base\n") => {
    const absolutePath = join(root, path)
    mkdirSync(dirname(absolutePath), { recursive: true })
    writeFileSync(absolutePath, contents)
  }

  git(root, "init", "-q", "-b", "master")
  git(root, "config", "user.email", "tests@example.invalid")
  git(root, "config", "user.name", "Changed Files Test")
  for (const path of ["README.md", "docs/DEVELOPMENT.md", "packages/dalph/src/runtime.ts", "specs/model.qnt"])
    write(path)
  git(root, "add", ".")
  git(root, "commit", "-qm", "base")
  return { root, write, baseSha: git(root, "rev-parse", "HEAD") }
}

test("completeFormalChangedPaths includes committed, staged, working, and NUL-safe untracked paths", () => {
  const fixture = createFixture()
  try {
    fixture.write("README.md", "committed\n")
    git(fixture.root, "add", "README.md")
    git(fixture.root, "commit", "-qm", "committed")
    fixture.write("docs/DEVELOPMENT.md", "staged\n")
    git(fixture.root, "add", "docs/DEVELOPMENT.md")
    fixture.write("packages/dalph/src/runtime.ts", "working\n")
    fixture.write("research/line\nbreak.md", "untracked\n")

    const result = completeFormalChangedPaths(fixture.baseSha, join(fixture.root, "docs"))

    assert.equal(result.headSha, git(fixture.root, "rev-parse", "HEAD"))
    assert.deepEqual(result.changedFiles, [
      "docs/DEVELOPMENT.md",
      "packages/dalph/src/runtime.ts",
      "README.md",
      "research/line\nbreak.md"
    ])
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("completeFormalChangedPaths retains deletion and both sides of a rename", () => {
  const fixture = createFixture()
  try {
    git(fixture.root, "mv", "packages/dalph/src/runtime.ts", "packages/dalph/src/renamed-runtime.ts")
    git(fixture.root, "rm", "specs/model.qnt")

    const result = completeFormalChangedPaths(fixture.baseSha, fixture.root)

    assert.deepEqual(result.changedFiles, [
      "packages/dalph/src/renamed-runtime.ts",
      "packages/dalph/src/runtime.ts",
      "specs/model.qnt"
    ])
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})

test("changedRepositoryFileSelection keeps an older pinned base after the moving reference advances", () => {
  const fixture = createFixture()
  try {
    fixture.write("packages/dalph/src/prerequisite.ts", "prerequisite\n")
    git(fixture.root, "add", ".")
    git(fixture.root, "commit", "-qm", "prerequisite")
    const prerequisiteHead = git(fixture.root, "rev-parse", "HEAD")
    git(fixture.root, "update-ref", "refs/remotes/origin/master", prerequisiteHead)
    fixture.write("packages/dalph/src/dependent.ts", "dependent\n")

    const pinned = changedRepositoryFileSelection({ baseReference: fixture.baseSha, cwd: fixture.root })
    const moving = changedRepositoryFileSelection({ baseReference: "origin/master", cwd: fixture.root })

    assert.deepEqual(pinned, {
      baseReference: fixture.baseSha,
      resolvedBaseSha: fixture.baseSha,
      comparisonBaseSha: fixture.baseSha,
      headSha: prerequisiteHead,
      files: ["packages/dalph/src/dependent.ts", "packages/dalph/src/prerequisite.ts"]
    })
    assert.deepEqual(moving, {
      baseReference: "origin/master",
      resolvedBaseSha: prerequisiteHead,
      comparisonBaseSha: prerequisiteHead,
      headSha: prerequisiteHead,
      files: ["packages/dalph/src/dependent.ts"]
    })
  } finally {
    rmSync(fixture.root, { recursive: true, force: true })
  }
})
