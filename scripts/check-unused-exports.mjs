import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { pathToFileURL } from "node:url"

const issueKey = (file, name) => `${file}\0${name}`

export const compareUnusedExports = (report, exceptionRecord) => {
  const observed = new Map()
  for (const issue of report.issues ?? []) {
    for (const exported of issue.exports ?? [])
      observed.set(issueKey(issue.file, exported.name), { ...exported, file: issue.file })
  }
  const exceptions = new Set(
    Object.entries(exceptionRecord).flatMap(([file, names]) => names.map((name) => issueKey(file, name)))
  )
  return {
    newIssues: [...observed].filter(([key]) => !exceptions.has(key)).map(([, issue]) => issue),
    staleExceptions: [...exceptions]
      .filter((key) => !observed.has(key))
      .map((key) => {
        const [file, name] = key.split("\0")
        return { file, name }
      })
  }
}

export const compareUnusedFiles = (report, exceptionFiles) => {
  const observed = new Set((report.issues ?? []).flatMap((issue) => (issue.files ?? []).map(({ name }) => name)))
  const exceptions = new Set(exceptionFiles)
  return {
    newIssues: [...observed].filter((file) => !exceptions.has(file)),
    staleExceptions: [...exceptions].filter((file) => !observed.has(file))
  }
}

const run = () => {
  const root = process.cwd()
  const executable = join(root, "node_modules", ".bin", process.platform === "win32" ? "knip.cmd" : "knip")
  const result = spawnSync(
    executable,
    ["--include", "files,exports", "--reporter", "json", "--no-exit-code", "--no-progress"],
    { cwd: root, encoding: "utf8" }
  )
  if (result.error !== undefined) throw result.error
  if (result.signal !== null || result.status !== 0) {
    process.stderr.write(result.stderr)
    process.exit(result.status ?? 1)
  }
  const exceptions = JSON.parse(readFileSync(new URL("./unused-export-exceptions.json", import.meta.url), "utf8"))
  const fileExceptions = JSON.parse(readFileSync(new URL("./unused-file-exceptions.json", import.meta.url), "utf8"))
  const report = JSON.parse(result.stdout)
  const comparison = compareUnusedExports(report, exceptions)
  const fileComparison = compareUnusedFiles(report, fileExceptions)
  for (const issue of comparison.newIssues)
    console.error(`${issue.file}:${issue.line}:${issue.col} unused export ${issue.name}`)
  for (const issue of comparison.staleExceptions)
    console.error(`${issue.file} stale unused-export exception ${issue.name}`)
  for (const file of fileComparison.newIssues) console.error(`${file} unused file`)
  for (const file of fileComparison.staleExceptions) console.error(`${file} stale unused-file exception`)
  if (
    comparison.newIssues.length > 0 ||
    comparison.staleExceptions.length > 0 ||
    fileComparison.newIssues.length > 0 ||
    fileComparison.staleExceptions.length > 0
  )
    process.exitCode = 1
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) run()
