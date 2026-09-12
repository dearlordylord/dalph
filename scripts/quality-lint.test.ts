import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { access, copyFile, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises"
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

const CommandResult = Schema.Struct({ exitCode: Schema.Finite, output: Schema.String, outputLineCount: Schema.Int })
const EslintResult = Schema.Struct({
  filePath: Schema.String,
  messages: Schema.Array(Schema.Struct({ ruleId: Schema.NullOr(Schema.String) }))
})
const EslintResultsFromJson = Schema.fromJsonString(Schema.Array(EslintResult))

class QualityLintCommandError extends Schema.TaggedError<QualityLintCommandError>()("QualityLintCommandError", {
  cause: Schema.Unknown
}) {}

interface LintFixture {
  readonly directory: string
  readonly commandsWithoutStoppedProof: Set<symbol>
}

const run = ({
  arguments_,
  environment,
  executable,
  fixture,
  name,
  timeoutMilliseconds
}: {
  readonly arguments_: ReadonlyArray<string>
  readonly fixture: LintFixture
  readonly environment?: NodeJS.ProcessEnv
  readonly executable: string
  readonly name: string
  readonly timeoutMilliseconds: number
}) =>
  Effect.tryPromise({
    try: async () => {
      const command = Symbol(name)
      fixture.commandsWithoutStoppedProof.add(command)
      try {
        const result = await runBoundedCommand({
          acceptedExitCodes: [0, 1],
          args: arguments_,
          captureOutput: true,
          cwd: fixture.directory,
          environment,
          executable,
          forwardOutput: false,
          name,
          relayParentSignals: true,
          timeoutMilliseconds
        })
        fixture.commandsWithoutStoppedProof.delete(command)
        return result
      } catch (cause) {
        // The bounded runner retains these outcomes only after proving the command and registered descendants stopped.
        // Unknown, signal and ambiguous custody failures retain the workspace for reconciliation.
        if (
          cause instanceof Error &&
          "quintCommandResult" in cause &&
          typeof cause.quintCommandResult === "string" &&
          /^(?:exit:\d+|launch-failed|timed-out)$/u.test(cause.quintCommandResult)
        ) {
          fixture.commandsWithoutStoppedProof.delete(command)
        }
        throw cause
      }
    },
    catch: (cause) => new QualityLintCommandError({ cause })
  }).pipe(Effect.flatMap((result) => Schema.decodeUnknownEffect(CommandResult)(result)))

const withFixtures = <Result>(use: (fixture: LintFixture) => Effect.Effect<Result, unknown>) =>
  Effect.acquireUseRelease(
    Effect.tryPromise(async () => {
      await mkdir(join(repositoryRoot, ".scratch"), { recursive: true })
      return {
        directory: await mkdtemp(join(repositoryRoot, ".scratch", "quality-lint-")),
        commandsWithoutStoppedProof: new Set<symbol>()
      }
    }),
    (fixture) =>
      Effect.gen(function* () {
        const fixtureDirectory = fixture.directory
        // Copy the real policies into disposable source context. Only dependencies and one plugin file link back;
        // neither the lint graph nor recursive cleanup can traverse the repository's authored source through a link.
        yield* Effect.tryPromise(async () => {
          await mkdir(join(fixtureDirectory, "packages", "dalph", "src"), { recursive: true })
          await mkdir(join(fixtureDirectory, "scripts"))
          await mkdir(join(fixtureDirectory, "test"))
          const preparation = await Promise.allSettled([
            ...[
              ".oxlintrc.json",
              "eslint.compat.config.mjs",
              "eslint-functional-suppressions.json",
              "dprint.json",
              "tsconfig.base.json",
              "tsconfig.lint.json"
            ].map((name) => copyFile(join(repositoryRoot, name), join(fixtureDirectory, name))),
            symlink(join(repositoryRoot, "node_modules"), join(fixtureDirectory, "node_modules"), "dir"),
            symlink(
              join(repositoryRoot, "scripts", "oxlint-project-plugin.mjs"),
              join(fixtureDirectory, "scripts", "oxlint-project-plugin.mjs"),
              "file"
            ),
            writeFile(join(fixtureDirectory, "package.json"), JSON.stringify({ private: true, type: "module" })),
            writeFile(join(fixtureDirectory, "scripts", "fixture.ts"), "export {}\n"),
            writeFile(join(fixtureDirectory, "test", "fixture.test.ts"), "export {}\n"),
            writeFile(join(fixtureDirectory, "fixture.config.ts"), "export {}\n"),
            writeFile(
              join(fixtureDirectory, "tsconfig.json"),
              JSON.stringify({
                extends: "./tsconfig.base.json",
                include: ["packages/**/*.ts", "scripts/**/*.ts", "test/**/*.ts", "*.config.ts"]
              })
            )
          ])
          // Finish every setup writer before release can remove this exact workspace after a setup failure.
          for (const result of preparation) {
            if (result.status === "rejected") throw result.reason
          }
        })
        return yield* use(fixture)
      }),
    (fixture) =>
      Effect.promise(async () => {
        if (fixture.commandsWithoutStoppedProof.size === 0) {
          await rm(fixture.directory, { force: true, recursive: true })
        } else {
          console.error(`Preserving lint fixture with unproven stopped custody: ${fixture.directory}`)
        }
      })
  )

const copyFixture = (fixtureDirectory: string, fixtureName: string) =>
  Effect.gen(function* () {
    const source = yield* Effect.tryPromise(() => readFile(join(qualityFixtureRoot, `${fixtureName}.ts.txt`), "utf8"))
    const target = join(fixtureDirectory, "packages", "dalph", "src", `${fixtureName}.ts`)
    yield* Effect.tryPromise(() => writeFile(target, source))
    return target
  })

const relativeToFixture = (fixtureDirectory: string, path: string) =>
  relative(fixtureDirectory, path).split("\\").join("/")

describe.sequential("quality lint integration", () => {
  it.effect("preserves the raw signal failure and fixture until exact process-group absence is proved", () =>
    Effect.gen(function* () {
      const retained = yield* withFixtures((fixture) =>
        Effect.gen(function* () {
          const failure = yield* run({
            arguments_: ["-e", 'process.stdout.write(String(process.pid), () => process.kill(process.pid, "SIGTERM"))'],
            executable: process.execPath,
            fixture,
            name: "Lint fixture signal completion control",
            timeoutMilliseconds: 10_000
          }).pipe(Effect.flip)
          expect(failure).toBeInstanceOf(QualityLintCommandError)
          const observed = yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              cause: Schema.Struct({
                message: Schema.String,
                output: Schema.String,
                outputLineCount: Schema.Int,
                quintCommandResult: Schema.String
              })
            })
          )(failure)
          expect(observed.cause.message).toBe("Lint fixture signal completion control failed with SIGTERM")
          expect(observed.cause.quintCommandResult).toBe("failed")
          expect(observed.cause.outputLineCount).toBe(1)
          const processGroup = yield* Schema.decodeUnknownEffect(
            Schema.fromJsonString(Schema.Int.check(Schema.isGreaterThan(0)))
          )(observed.cause.output)
          return { directory: fixture.directory, processGroup }
        })
      )
      yield* Effect.tryPromise(() => access(retained.directory))
      expect(() => process.kill(-retained.processGroup, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }))
      yield* Effect.tryPromise(() => rm(retained.directory, { recursive: true, force: true }))
      yield* Effect.promise(() => expect(access(retained.directory)).rejects.toMatchObject({ code: "ENOENT" }))

      const sibling = yield* withFixtures((fixture) => Effect.succeed(fixture.directory))
      yield* Effect.promise(() => expect(access(sibling)).rejects.toMatchObject({ code: "ENOENT" }))
      yield* Effect.tryPromise(() => access(join(repositoryRoot, "node_modules")))
    })
  )
  it.effect("disposable lint workspace cleanup removes its exact links without removing their targets", () =>
    Effect.gen(function* () {
      const fixtureDirectory = yield* withFixtures((fixture) =>
        Effect.gen(function* () {
          const directory = fixture.directory
          const dependencyTarget = yield* Effect.tryPromise(() => readlink(join(directory, "node_modules")))
          const pluginTarget = yield* Effect.tryPromise(() =>
            readlink(join(directory, "scripts", "oxlint-project-plugin.mjs"))
          )
          expect(dependencyTarget).toBe(join(repositoryRoot, "node_modules"))
          expect(pluginTarget).toBe(join(repositoryRoot, "scripts", "oxlint-project-plugin.mjs"))
          const fixturePolicy = yield* Effect.tryPromise(() =>
            readFile(join(directory, "eslint.compat.config.mjs"), "utf8")
          )
          const repositoryPolicy = yield* Effect.tryPromise(() =>
            readFile(join(repositoryRoot, "eslint.compat.config.mjs"), "utf8")
          )
          expect(fixturePolicy).toBe(repositoryPolicy)
          return directory
        })
      )
      yield* Effect.promise(() => expect(access(fixtureDirectory)).rejects.toMatchObject({ code: "ENOENT" }))
      yield* Effect.tryPromise(() => access(join(repositoryRoot, "node_modules")))
      yield* Effect.tryPromise(() => access(join(repositoryRoot, "scripts", "oxlint-project-plugin.mjs")))
    })
  )
  it.effect(
    "repository lint rejects a native warning and keeps diagnostics bounded",
    () =>
      withFixtures((fixture) =>
        Effect.gen(function* () {
          const fixtureDirectory = fixture.directory
          const warningFile = yield* copyFixture(fixtureDirectory, "warning")
          const result = yield* run({
            arguments_: [qualityLintRunner, relativeToFixture(fixtureDirectory, warningFile)],
            fixture,
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
      withFixtures((fixture) =>
        Effect.gen(function* () {
          const fixtureDirectory = fixture.directory
          const functionalFile = yield* copyFixture(fixtureDirectory, "functional")
          const unconsumedFile = yield* copyFixture(fixtureDirectory, "unconsumed")
          const functionalPath = relativeToFixture(fixtureDirectory, functionalFile)
          const unconsumedPath = relativeToFixture(fixtureDirectory, unconsumedFile)
          const publicEntryPath = "packages/dalph/src/index.ts"
          const consumedPath = "packages/dalph/src/consumed.ts"
          yield* Effect.tryPromise(async () => {
            await mkdir(join(fixtureDirectory, "packages", "consumer", "src"), { recursive: true })
            await writeFile(join(fixtureDirectory, publicEntryPath), "export const publicFixture = 1\n")
            await writeFile(join(fixtureDirectory, consumedPath), "export const consumedFixture = 1\n")
            await writeFile(
              join(fixtureDirectory, "packages", "consumer", "src", "use.ts"),
              'import { consumedFixture } from "../../dalph/src/consumed.js"\nexport const usageFixture = consumedFixture\n'
            )
          })
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
              consumedPath,
              publicEntryPath
            ],
            fixture,
            executable: compatibilityLintExecutable,
            name: "Compatibility lint integration subprocess",
            timeoutMilliseconds: 20_000
          })
          const lintResults = yield* Schema.decodeUnknownEffect(EslintResultsFromJson)(result.output)

          expect(result.exitCode).toBe(1)
          expect(result.outputLineCount).toBeLessThan(10)
          expect(lintResults).toHaveLength(4)
          expect(lintResults).toContainEqual({
            filePath: functionalFile,
            messages: expect.arrayContaining([{ ruleId: "functional/immutable-data" }])
          })
          expect(lintResults).toContainEqual({
            filePath: unconsumedFile,
            messages: expect.arrayContaining([{ ruleId: "import-x/no-unused-modules" }])
          })
          expect(lintResults).toContainEqual({ filePath: join(fixtureDirectory, consumedPath), messages: [] })
          expect(lintResults).toContainEqual({ filePath: join(fixtureDirectory, publicEntryPath), messages: [] })
        })
      ),
    30_000
  )

  it.effect(
    "staged lint keeps the selected compatibility files without the whole graph",
    () =>
      withFixtures((fixture) =>
        Effect.gen(function* () {
          const fixtureDirectory = fixture.directory
          const functionalFile = yield* copyFixture(fixtureDirectory, "functional")
          const selectedFiles = yield* Effect.tryPromise(() =>
            discoverQualityFiles({
              explicitFiles: [relativeToFixture(fixtureDirectory, functionalFile)],
              rootDirectory: fixtureDirectory
            })
          )
          const allFiles = yield* Effect.tryPromise(() => discoverQualityFiles({ rootDirectory: fixtureDirectory }))
          const { compatibilityFiles, selectedCompatibilityFiles } = selectCompatibilityFiles({
            allFiles,
            scoped: true,
            selectedFiles
          })

          expect(selectedCompatibilityFiles).toEqual([relativeToFixture(fixtureDirectory, functionalFile)])
          expect(compatibilityFiles).toEqual([])
        })
      ),
    30_000
  )
})

describe("compatibility lint policy", () => {
  const allFiles = ["packages/dalph/src/index.ts", "packages/dalph/src/run.ts", "scripts/run.mjs"]

  it("keeps the whole compatibility graph for a repository run", () => {
    const { compatibilityFiles } = selectCompatibilityFiles({ allFiles, selectedFiles: allFiles })

    expect(compatibilityFiles).toEqual(["packages/dalph/src/index.ts", "packages/dalph/src/run.ts"])
  })

  it("skips the compatibility pass for a scoped run", () => {
    const { compatibilityFiles, selectedCompatibilityFiles } = selectCompatibilityFiles({
      allFiles,
      scoped: true,
      selectedFiles: ["packages/dalph/src/run.ts"]
    })

    expect(compatibilityFiles).toEqual([])
    expect(selectedCompatibilityFiles).toEqual(["packages/dalph/src/run.ts"])
  })

  it("runs the compatibility pass for a scoped run that asks for it", () => {
    const { compatibilityFiles } = selectCompatibilityFiles({
      allFiles,
      compatibility: true,
      scoped: true,
      selectedFiles: ["packages/dalph/src/run.ts"]
    })

    expect(compatibilityFiles).toEqual(["packages/dalph/src/run.ts"])
  })

  it("skips the compatibility pass when a repository run declines it", () => {
    const { compatibilityFiles } = selectCompatibilityFiles({
      allFiles,
      selectedFiles: allFiles,
      withoutCompatibility: true
    })

    expect(compatibilityFiles).toEqual([])
  })
})
