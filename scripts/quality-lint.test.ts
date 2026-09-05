import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { relative, join } from "node:path"
import { describe, expect } from "vitest"
// @ts-expect-error The discovery implementation is an executable JavaScript module.
import { discoverQualityFiles } from "./quality-file-discovery.mjs"
// @ts-expect-error The lint policy is shared with the executable JavaScript runner.
import { selectCompatibilityFiles } from "./quality-lint-policy.mjs"
// @ts-expect-error The bounded command implementation is an executable JavaScript module.
import { runBoundedCommand } from "./run-bounded-command.mjs"

const repositoryRoot = process.cwd()
const qualityLintRunner = join(repositoryRoot, "scripts", "run-quality-lint.mjs")
const compatibilityLintExecutable = join(
  repositoryRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "eslint.cmd" : "eslint"
)
const qualityFixtureRoot = join(repositoryRoot, "test", "fixtures", "quality-lint")
// Compatibility lint builds the whole TypeScript import graph. One process receives enough time for a loaded host while
// remaining well inside the quality gate's twenty-minute coverage-stage bound.
const repositoryCompatibilityLintTimeout = 320_000
const compatibilityLintSubprocessTimeout = 300_000
const compatibilityLintEnvironment = {
  ...process.env,
  NODE_OPTIONS: [process.env["NODE_OPTIONS"], "--max-old-space-size=12288"].filter(Boolean).join(" ")
}

const CommandResult = Schema.Struct({ exitCode: Schema.Finite, output: Schema.String, outputLineCount: Schema.Int })
const EslintResult = Schema.Struct({
  filePath: Schema.String,
  messages: Schema.Array(Schema.Struct({ ruleId: Schema.NullOr(Schema.String) }))
})
const EslintResultsFromJson = Schema.fromJsonString(Schema.Array(EslintResult))

class QualityLintCommandError extends Schema.TaggedError<QualityLintCommandError>()("QualityLintCommandError", {
  cause: Schema.String
}) {}

const run = ({
  arguments_,
  environment,
  executable,
  name,
  timeoutMilliseconds
}: {
  readonly arguments_: ReadonlyArray<string>
  readonly environment?: NodeJS.ProcessEnv
  readonly executable: string
  readonly name: string
  readonly timeoutMilliseconds: number
}) =>
  Effect.tryPromise({
    try: () =>
      runBoundedCommand({
        acceptedExitCodes: [0, 1],
        args: arguments_,
        captureOutput: true,
        environment,
        executable,
        forwardOutput: false,
        name,
        timeoutMilliseconds
      }),
    catch: (cause) => new QualityLintCommandError({ cause: String(cause) })
  }).pipe(Effect.flatMap((result) => Schema.decodeUnknownEffect(CommandResult)(result)))

const withFixtures = <Result>(use: (fixtureDirectory: string) => Effect.Effect<Result, unknown>) =>
  Effect.acquireUseRelease(
    Effect.tryPromise(() => mkdtemp(join(repositoryRoot, "packages", "dalph", "src", "quality-lint-"))),
    use,
    (fixtureDirectory) => Effect.promise(() => rm(fixtureDirectory, { force: true, recursive: true }))
  )

const copyFixture = (fixtureDirectory: string, fixtureName: string) =>
  Effect.gen(function* () {
    const source = yield* Effect.tryPromise(() => readFile(join(qualityFixtureRoot, `${fixtureName}.ts.txt`), "utf8"))
    const target = join(fixtureDirectory, `${fixtureName}.ts`)
    yield* Effect.tryPromise(() => writeFile(target, source))
    return target
  })

const relativeToRepository = (path: string) => relative(repositoryRoot, path).split("\\").join("/")

describe.sequential("quality lint integration", () => {
  it.effect(
    "repository lint rejects a native warning and keeps diagnostics bounded",
    () =>
      withFixtures((fixtureDirectory) =>
        Effect.gen(function* () {
          const warningFile = yield* copyFixture(fixtureDirectory, "warning")
          const result = yield* run({
            arguments_: [qualityLintRunner, relativeToRepository(warningFile)],
            executable: process.execPath,
            name: "Quality lint integration subprocess",
            timeoutMilliseconds: 20_000
          })
          expect(result.exitCode).not.toBe(0)
          expect(result.output).toContain("no-debugger")
          expect(result.outputLineCount).toBeLessThan(30)
        })
      ),
    30_000
  )

  it.effect(
    "compatibility lint restores immutable-data and whole-project unused-export checks",
    () =>
      withFixtures((fixtureDirectory) =>
        Effect.gen(function* () {
          const functionalFile = yield* copyFixture(fixtureDirectory, "functional")
          const unconsumedFile = yield* copyFixture(fixtureDirectory, "unconsumed")
          const functionalPath = relativeToRepository(functionalFile)
          const unconsumedPath = relativeToRepository(unconsumedFile)
          const publicEntryPath = "packages/dalph/src/index.ts"
          const result = yield* run({
            arguments_: [
              "--config",
              "eslint.compat.config.mjs",
              "--max-warnings",
              "0",
              "--suppressions-location",
              "eslint-functional-suppressions.json",
              "--no-error-on-unmatched-pattern",
              "--format",
              "json",
              functionalPath,
              unconsumedPath,
              publicEntryPath
            ],
            environment: compatibilityLintEnvironment,
            executable: compatibilityLintExecutable,
            name: "Compatibility lint integration subprocess",
            timeoutMilliseconds: compatibilityLintSubprocessTimeout
          })
          const lintResults = yield* Schema.decodeUnknownEffect(EslintResultsFromJson)(result.output)

          expect(result.exitCode).toBe(1)
          expect(result.outputLineCount).toBeLessThan(10)
          expect(lintResults).toHaveLength(3)
          expect(lintResults).toContainEqual({
            filePath: functionalFile,
            messages: expect.arrayContaining([{ ruleId: "functional/immutable-data" }])
          })
          expect(lintResults).toContainEqual({
            filePath: unconsumedFile,
            messages: expect.arrayContaining([{ ruleId: "import-x/no-unused-modules" }])
          })
          expect(lintResults).toContainEqual({ filePath: join(repositoryRoot, publicEntryPath), messages: [] })
        })
      ),
    repositoryCompatibilityLintTimeout
  )

  it.effect(
    "staged lint selects the discovered project for compatibility policy",
    () =>
      withFixtures((fixtureDirectory) =>
        Effect.gen(function* () {
          const functionalFile = yield* copyFixture(fixtureDirectory, "functional")
          const selectedFiles = yield* Effect.tryPromise(() =>
            discoverQualityFiles({ explicitFiles: [relativeToRepository(functionalFile)] })
          )
          const allFiles = yield* Effect.tryPromise(() => discoverQualityFiles())
          const { compatibilityFiles, selectedCompatibilityFiles } = selectCompatibilityFiles({
            allFiles,
            selectedFiles,
            staged: true
          })

          expect(selectedCompatibilityFiles).toEqual([relativeToRepository(functionalFile)])
          expect(compatibilityFiles).toContain(relativeToRepository(functionalFile))
          expect(compatibilityFiles.length).toBeGreaterThan(selectedCompatibilityFiles.length)
        })
      ),
    30_000
  )
})
