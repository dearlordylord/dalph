import { spawnSync } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, expect, it } from "vitest"

const temporaryRoots: Array<string> = []
const repositoryIdentity = "alice/dalph-production-walkthrough"
const markerName = ".dalph-walkthrough-repository"
const documentation = readFileSync(new URL("../docs/DEVELOPMENT.md", import.meta.url), "utf8")
const disposalSection = documentation.split("#### 6. Dispose exactly, or preserve everything")[1] ?? ""
const cleanupBlock = [...disposalSection.matchAll(/```bash\n([\s\S]*?)\n```/g)].at(-1)?.[1] ?? ""

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true })
})

const fixture = () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), "dalph-cleanup-test-")))
  temporaryRoots.push(parent)
  const root = mkdtempSync(join(parent, "dalph-production-walkthrough."))
  writeFileSync(join(root, "journal.sqlite"), "local recovery facts")
  writeFileSync(join(parent, "unrelated"), "another workspace")
  return { parent, root }
}

const runCleanup = (parent: string, root: string) => {
  expect(cleanupBlock).not.toBe("")
  return spawnSync("bash", ["--noprofile", "--norc", "-c", `set +e\n${cleanupBlock}`], {
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"],
      DALPH_DEMO_OWNER: "alice",
      DALPH_DEMO_REPOSITORY: "dalph-production-walkthrough",
      DALPH_DEMO_TEMP_PARENT: parent,
      DALPH_DEMO_ROOT: root
    }
  })
}

it.each(["missing", "foreign", "directory", "symlink", "extra-lines"])(
  "preserves Alice's local facts when the repository marker is %s with Bash errexit disabled",
  (markerState) => {
    const { parent, root } = fixture()
    const marker = join(root, markerName)
    if (markerState === "foreign") writeFileSync(marker, "bob/another-repository\n")
    if (markerState === "directory") mkdirSync(marker)
    if (markerState === "symlink") symlinkSync(join(parent, "unrelated"), marker)
    if (markerState === "extra-lines") writeFileSync(marker, `${repositoryIdentity}\nforeign-marker\n`)

    const result = runCleanup(parent, root)

    expect(result.error).toBeUndefined()
    expect(result.stderr).toContain("refusing cleanup")
    expect(result.stdout).not.toContain("Local files retained at:")
    expect(readFileSync(join(root, "journal.sqlite"), "utf8")).toBe("local recovery facts")
    expect(readdirSync(parent).filter((name) => name.startsWith("dalph-retained."))).toEqual([])
    expect(readFileSync(join(parent, "unrelated"), "utf8")).toBe("another workspace")
  }
)

it.each(["nested", "symlink", "unexpected-name"])(
  "preserves Alice's local facts when the cleanup root is %s",
  (rootState) => {
    const { parent, root } = fixture()
    writeFileSync(join(root, markerName), `${repositoryIdentity}\n`)
    const alternateRoot = join(parent, "dalph-production-walkthrough.alternate")
    const selectedRoot = rootState === "unexpected-name" ? join(parent, "another-project") : alternateRoot
    if (rootState === "nested") {
      mkdirSync(alternateRoot)
      renameSync(root, join(alternateRoot, "dalph-production-walkthrough.nested"))
    } else if (rootState === "symlink") {
      symlinkSync(root, alternateRoot)
    } else {
      renameSync(root, selectedRoot)
    }
    const actualRoot =
      rootState === "nested"
        ? join(alternateRoot, "dalph-production-walkthrough.nested")
        : rootState === "symlink"
          ? root
          : selectedRoot

    const result = runCleanup(parent, rootState === "symlink" ? selectedRoot : actualRoot)

    expect(result.error).toBeUndefined()
    expect(result.stderr).toContain("refusing")
    expect(readFileSync(join(actualRoot, "journal.sqlite"), "utf8")).toBe("local recovery facts")
    expect(readdirSync(parent).filter((name) => name.startsWith("dalph-retained."))).toEqual([])
  }
)

it("retires only Alice's verified root and allows all local facts to be restored at the original path", () => {
  const { parent, root } = fixture()
  writeFileSync(join(root, markerName), `${repositoryIdentity}\n`)

  const result = runCleanup(parent, root)

  expect(result.error).toBeUndefined()
  expect(result.status).toBe(0)
  expect(result.stderr).toBe("")
  expect(existsSync(root)).toBe(false)
  const retained = readdirSync(parent).filter((name) => name.startsWith("dalph-retained."))
  expect(retained).toHaveLength(1)
  const retainedWorkspace = join(parent, retained[0] ?? "missing-retention-directory", "workspace")
  expect(result.stdout).toBe(`Local files retained at: ${retainedWorkspace}\n`)
  expect(readFileSync(join(retainedWorkspace, "journal.sqlite"), "utf8")).toBe("local recovery facts")
  expect(readFileSync(join(retainedWorkspace, markerName), "utf8")).toBe(`${repositoryIdentity}\n`)
  expect(readFileSync(join(parent, "unrelated"), "utf8")).toBe("another workspace")

  renameSync(retainedWorkspace, root)
  expect(readFileSync(join(root, "journal.sqlite"), "utf8")).toBe("local recovery facts")
})
