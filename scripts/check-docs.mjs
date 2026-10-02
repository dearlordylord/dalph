import { execFileSync, spawnSync } from "node:child_process"
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { pathToFileURL } from "node:url"
import { ensureLychee } from "./install-lychee.mjs"

/** Maintained documentation, including new unstaged files; fixtures and vendored trees are not docs. */
export const documentationPaths = (root) => {
  const paths = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
    cwd: root,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    encoding: "utf8",
    timeout: 10_000
  }).split("\0")
  return [...new Set(paths)]
    .filter(
      (path) =>
        /\.md$/u.test(path) &&
        (!path.includes("/") ||
          /^(docs|research)\//u.test(path) ||
          /^(packages|prototypes)\/[^/]+\/(README|AGENTS)\.md$/u.test(path) ||
          /^\.github\/(ISSUE_TEMPLATE\/|PULL_REQUEST_TEMPLATE\.md$)/u.test(path)) &&
        existsSync(join(root, path))
    )
    .sort((left, right) => left.localeCompare(right, "en"))
}

export const checkDocumentation = async (root) => {
  const paths = documentationPaths(root)
  if (paths.length === 0) throw new Error("No maintained Markdown found; refusing an empty documentation check")
  const binary = await ensureLychee()
  const temporary = mkdtempSync(join(tmpdir(), "dalph-doc-links-"))
  try {
    const inputs = join(temporary, "inputs.txt")
    writeFileSync(inputs, `${paths.join("\n")}\n`)
    const result = spawnSync(
      binary,
      [
        "--config",
        join(root, "lychee.toml"),
        "--offline",
        "--include-fragments=anchor-only",
        "--hidden",
        "--no-ignore",
        "--no-progress",
        "--files-from",
        inputs
      ],
      { cwd: root, stdio: "inherit", timeout: 60_000 }
    )
    if (result.error !== undefined) throw result.error
    if (result.status === null) throw new Error(`Lychee stopped without an exit status (${result.signal})`)
    return result.status
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.exitCode = await checkDocumentation(process.cwd())
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
