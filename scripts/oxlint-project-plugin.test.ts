import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { expect } from "vitest"

const repositoryRoot = process.cwd()
const pluginFixtureRoot = join(repositoryRoot, "test", "fixtures", "oxlint-project-plugin")
const pluginPath = join(repositoryRoot, "scripts", "oxlint-project-plugin.mjs")
const localOxlintPath = join(
  repositoryRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "oxlint.cmd" : "oxlint"
)

const OxlintDiagnostic = Schema.Struct({ code: Schema.String, filename: Schema.String, message: Schema.String })
const OxlintResult = Schema.Struct({ diagnostics: Schema.Array(OxlintDiagnostic) })
const CommandResult = Schema.Struct({ exitCode: Schema.Finite, stdout: Schema.String, stderr: Schema.String })
class OxlintCommandError extends Schema.TaggedError<OxlintCommandError>()("OxlintCommandError", {
  cause: Schema.String
}) {}

const run = (args: ReadonlyArray<string>, cwd: string) =>
  Effect.tryPromise({
    try: () =>
      new Promise((resolvePromise) => {
        const command = process.env["DALPH_OXLINT_BIN"] ?? localOxlintPath
        const commandArguments = process.env["DALPH_OXLINT_BIN"] === undefined ? args : []
        const child = spawn(command, commandArguments, { cwd, stdio: ["ignore", "pipe", "pipe"] })
        const stdout: Array<Buffer> = []
        const stderr: Array<Buffer> = []
        child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk))
        child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk))
        child.on("close", (exitCode: number | null) =>
          resolvePromise({
            exitCode: exitCode ?? 1,
            stderr: Buffer.concat(stderr).toString("utf8"),
            stdout: Buffer.concat(stdout).toString("utf8")
          })
        )
      }),
    catch: (cause) => new OxlintCommandError({ cause: String(cause) })
  }).pipe(Effect.flatMap((result) => Schema.decodeUnknownEffect(CommandResult)(result)))

const parseLintResult = (result: typeof CommandResult.Type) =>
  Schema.decodeUnknownEffect(OxlintResult)(JSON.parse(result.stdout)).pipe(
    Effect.map((lint) => ({ ...result, diagnostics: lint.diagnostics }))
  )

const runFixture = (fixtureName: string, extraArguments: ReadonlyArray<string> = []) =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const fixtureDirectory = yield* Effect.tryPromise(() => mkdtemp(join(tmpdir(), "dalph-oxlint-plugin-")))
      const fixtureSource = yield* Effect.tryPromise(() => readFile(join(pluginFixtureRoot, fixtureName), "utf8"))
      const fixturePath = join(fixtureDirectory, fixtureName.replace(/\.txt$/u, ""))
      const configPath = join(fixtureDirectory, ".oxlintrc.json")
      yield* Effect.tryPromise(() => writeFile(fixturePath, fixtureSource))
      yield* Effect.tryPromise(() =>
        writeFile(
          configPath,
          JSON.stringify({
            jsPlugins: [pluginPath],
            rules: Object.fromEntries(
              [
                "effect-class-inheritance-only",
                "no-ambient-capability-bypass",
                "no-clock-read",
                "no-double-type-assertion",
                "no-module-mocks",
                "no-throw-statement",
                "no-type-assertion",
                "property-test-placement",
                "require-canonical-effect-import"
              ].map((rule) => [`dalph/${rule}`, "error"])
            )
          })
        )
      )
      return { configPath, fixtureDirectory, fixturePath }
    }),
    ({ configPath, fixtureDirectory, fixturePath }) =>
      run(["--no-ignore", "-f", "json", "-c", configPath, ...extraArguments, fixturePath], repositoryRoot).pipe(
        Effect.flatMap(parseLintResult),
        Effect.map((result) => ({ ...result, fixtureDirectory, fixturePath }))
      ),
    ({ fixtureDirectory }) => Effect.promise(() => rm(fixtureDirectory, { force: true, recursive: true }))
  )

const customRuleCodes = (diagnostics: ReadonlyArray<typeof OxlintDiagnostic.Type>) =>
  new Set(
    diagnostics
      .map(({ code }) => code.match(/^dalph\(([^)]+)\)$/u)?.[1])
      .filter((code): code is string => code !== undefined)
      .map((code) => `dalph/${code}`)
  )

it.effect(
  "custom Oxlint rules reject bypass-shaped constructs and both assertion syntaxes",
  () =>
    Effect.gen(function* () {
      const result = yield* runFixture("forbidden-constructs.ts.txt", [
        "-D",
        "dalph/no-double-type-assertion",
        "-D",
        "dalph/no-throw-statement",
        "-D",
        "dalph/property-test-placement"
      ])
      const codes = customRuleCodes(result.diagnostics)

      for (const rule of [
        "no-ambient-capability-bypass",
        "no-clock-read",
        "no-double-type-assertion",
        "no-module-mocks",
        "no-throw-statement",
        "no-type-assertion",
        "property-test-placement",
        "require-canonical-effect-import",
        "effect-class-inheritance-only"
      ]) {
        expect(codes, `expected ${rule} to reject the fixture`).toContain(`dalph/${rule}`)
      }
    }),
  30_000
)

it.effect(
  "custom Oxlint rules allow injected capabilities, canonical imports, and Effect inheritance",
  () =>
    Effect.gen(function* () {
      const result = yield* runFixture("safe-constructs.ts.txt")
      expect(customRuleCodes(result.diagnostics)).toEqual(new Set())
    }),
  30_000
)

it.effect(
  "custom package-boundary rule rejects a forbidden internal import",
  () =>
    Effect.gen(function* () {
      const fixtureDirectory = yield* Effect.tryPromise(() => mkdtemp(join(tmpdir(), "dalph-oxlint-boundary-")))
      const fixturePath = join(fixtureDirectory, "restricted-import.ts")
      const configPath = join(fixtureDirectory, ".oxlintrc.json")
      yield* Effect.tryPromise(() => writeFile(fixturePath, 'import "./coordination/activation/frontier/hidden"\n'))
      yield* Effect.tryPromise(() =>
        writeFile(
          configPath,
          JSON.stringify({
            jsPlugins: [pluginPath],
            rules: {
              "dalph/no-restricted-import-path": [
                "error",
                { patterns: [{ message: "internal import is forbidden", pattern: "coordination/activation/frontier" }] }
              ]
            }
          })
        )
      )
      const result = yield* run(["--no-ignore", "-f", "json", "-c", configPath, fixturePath], repositoryRoot).pipe(
        Effect.flatMap(parseLintResult),
        Effect.ensuring(Effect.promise(() => rm(fixtureDirectory, { force: true, recursive: true })))
      )
      expect(customRuleCodes(result.diagnostics)).toContain("dalph/no-restricted-import-path")
    }),
  30_000
)
