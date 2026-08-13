import { spawnSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import { relative, resolve } from "node:path"

const suppressionPath = "oxlint-complexity-suppressions.json"
const result = spawnSync("pnpm", ["exec", "oxlint", "-c", "oxlint.complexity.json", "-f", "json", "src", "packages"], {
  encoding: "utf8"
})

if (result.error !== undefined || (result.status !== 0 && result.status !== 1)) {
  throw result.error ?? new Error(result.stderr)
}

const parsed = JSON.parse(result.stdout)
if (typeof parsed !== "object" || parsed === null || !("diagnostics" in parsed) || !Array.isArray(parsed.diagnostics)) {
  throw new Error("Oxlint returned an unexpected JSON diagnostic shape")
}

const counts = new Map()
for (const diagnostic of parsed.diagnostics) {
  if (
    typeof diagnostic !== "object" ||
    diagnostic === null ||
    diagnostic.code !== "eslint(complexity)" ||
    typeof diagnostic.filename !== "string"
  ) {
    continue
  }
  const filename = relative(process.cwd(), resolve(diagnostic.filename))
  counts.set(filename, (counts.get(filename) ?? 0) + 1)
}

const sortedCounts = [...counts].sort(([left], [right]) => left.localeCompare(right))

if (process.argv.includes("--prune")) {
  const next = Object.fromEntries(sortedCounts.map(([filename, count]) => [filename, { complexity: { count } }]))
  writeFileSync(suppressionPath, `${JSON.stringify(next, undefined, 2)}\n`)
  console.log(`Updated ${suppressionPath} with ${sortedCounts.length} files.`)
} else {
  const suppressions = JSON.parse(readFileSync(suppressionPath, "utf8"))
  const filenames = new Set([...Object.keys(suppressions), ...counts.keys()])
  const mismatches = [...filenames].flatMap((filename) => {
    const actual = counts.get(filename) ?? 0
    const expected = suppressions[filename]?.complexity.count ?? 0
    return actual === expected ? [] : [`${filename}: expected ${expected}, found ${actual}`]
  })

  if (mismatches.length > 0) {
    console.error(["Cyclomatic complexity suppressions are out of sync:", ...mismatches].join("\n"))
    process.exitCode = 1
  } else {
    console.log(`Cyclomatic complexity is within the recorded baseline for ${sortedCounts.length} files.`)
  }
}
