import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { compareUnusedExports, compareUnusedFiles } from "./check-unused-exports.mjs"

void test("reports new exports and stale exact exceptions", () => {
  const report = { issues: [{ exports: [{ col: 2, line: 3, name: "newExport" }], file: "src/new.ts" }] }
  assert.deepEqual(compareUnusedExports(report, { "src/old.ts": ["oldExport"] }), {
    newIssues: [{ col: 2, file: "src/new.ts", line: 3, name: "newExport" }],
    staleExceptions: [{ file: "src/old.ts", name: "oldExport" }]
  })
})

void test("accepts only the exact file and symbol exception", () => {
  const report = { issues: [{ exports: [{ name: "allowed" }], file: "src/value.ts" }] }
  assert.deepEqual(compareUnusedExports(report, { "src/value.ts": ["allowed"] }), {
    newIssues: [],
    staleExceptions: []
  })
})

void test("reports new files and stale exact file exceptions", () => {
  const report = { issues: [{ file: "src/new.ts", files: [{ name: "src/new.ts" }] }] }
  assert.deepEqual(compareUnusedFiles(report, ["src/old.ts"]), {
    newIssues: ["src/new.ts"],
    staleExceptions: ["src/old.ts"]
  })
})

void test("Knip resolves public entries, tests, re-exports, type consumers, and dynamic imports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "dalph-unused-exports-"))
  try {
    await mkdir(join(directory, "src"))
    await mkdir(join(directory, "test"))
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({
        knip: {
          entry: ["src/index.ts", "src/consumer.ts", "src/reexport.ts", "test/**/*.ts"],
          project: ["src/**/*.ts", "test/**/*.ts"]
        },
        private: true,
        type: "module"
      })
    )
    await writeFile(join(directory, "src", "index.ts"), "export const publicValue = 1\n")
    await writeFile(
      join(directory, "src", "unused.ts"),
      "export const usedFromMixedModule = 1\nexport const unusedValue = 1\n"
    )
    await writeFile(
      join(directory, "src", "values.ts"),
      "export const consumedValue = 1\nexport interface ConsumedType { readonly value: number }\n"
    )
    await writeFile(join(directory, "src", "dynamic.ts"), "export const dynamicValue = 1\n")
    await writeFile(join(directory, "src", "reexport-source.ts"), "export const reexportedValue = 1\n")
    await writeFile(join(directory, "src", "reexport.ts"), 'export { reexportedValue } from "./reexport-source.js"\n')
    await writeFile(
      join(directory, "src", "consumer.ts"),
      'import { usedFromMixedModule } from "./unused.js"\nimport { consumedValue, type ConsumedType } from "./values.js"\nexport const consume = async (value: ConsumedType) => usedFromMixedModule + consumedValue + value.value + (await import("./dynamic.js")).dynamicValue\n'
    )
    await writeFile(join(directory, "test", "fixture.test.ts"), "export const testFixture = 1\n")
    const executable = join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "knip.cmd" : "knip")
    const result = spawnSync(
      executable,
      ["--include", "files,exports", "--reporter", "json", "--no-exit-code", "--no-progress"],
      { cwd: directory, encoding: "utf8" }
    )
    assert.equal(result.status, 0, result.stderr)
    const report = JSON.parse(result.stdout)
    assert.deepEqual(
      report.issues.flatMap(({ exports, file }) => exports.map(({ name }) => ({ file, name }))),
      [{ file: "src/unused.ts", name: "unusedValue" }]
    )
    assert.deepEqual(
      report.issues.flatMap(({ files }) => files.map(({ name }) => name)),
      []
    )
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
})
