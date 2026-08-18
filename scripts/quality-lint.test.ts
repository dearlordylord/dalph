import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { relative, join } from "node:path"
import { expect } from "vitest"

const repositoryRoot = process.cwd()
const qualityLintRunner = join(repositoryRoot, "scripts", "run-quality-lint.mjs")
const qualityFixtureRoot = join(repositoryRoot, "test", "fixtures", "quality-lint")
// Compatibility lint builds the whole TypeScript import graph. Keep its integration-test bound above the
// observed repository-scale runtime while the outer quality gate retains its own fixed overall deadline.
const repositoryCompatibilityLintTimeout = 240_000

const CommandResult = Schema.Struct({ exitCode: Schema.Finite, stdout: Schema.String, stderr: Schema.String })

class QualityLintCommandError extends Schema.TaggedError<QualityLintCommandError>()("QualityLintCommandError", {
  cause: Schema.String
}) {}

const run = (arguments_: ReadonlyArray<string>) =>
  Effect.tryPromise({
    try: () =>
      new Promise((resolvePromise) => {
        const child = spawn(process.execPath, [qualityLintRunner, ...arguments_], {
          cwd: repositoryRoot,
          stdio: ["ignore", "pipe", "pipe"]
        })
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

it.effect(
  "repository lint rejects a native warning and keeps diagnostics bounded",
  () =>
    withFixtures((fixtureDirectory) =>
      Effect.gen(function* () {
        const warningFile = yield* copyFixture(fixtureDirectory, "warning")
        const result = yield* run([relativeToRepository(warningFile)])
        expect(result.exitCode).not.toBe(0)
        expect(`${result.stdout}${result.stderr}`).toContain("no-debugger")
        expect(`${result.stdout}${result.stderr}`.split("\n").length).toBeLessThan(30)
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
        const functionalResult = yield* run([relativeToRepository(functionalFile)])
        const unconsumedResult = yield* run([relativeToRepository(unconsumedFile)])
        const publicEntryResult = yield* run(["packages/dalph/src/index.ts"])

        expect(functionalResult.exitCode).not.toBe(0)
        expect(functionalResult.stdout).toContain("functional/immutable-data")
        expect(unconsumedResult.exitCode).not.toBe(0)
        expect(unconsumedResult.stdout).toContain("import-x/no-unused-modules")
        expect(publicEntryResult.exitCode).toBe(0)
        expect(`${publicEntryResult.stdout}${publicEntryResult.stderr}`.split("\n").length).toBeLessThan(30)
      })
    ),
  repositoryCompatibilityLintTimeout
)

it.effect(
  "staged lint runs compatibility policy over the discovered project",
  () =>
    withFixtures((fixtureDirectory) =>
      Effect.gen(function* () {
        const functionalFile = yield* copyFixture(fixtureDirectory, "functional")
        const result = yield* run(["--staged", relativeToRepository(functionalFile)])
        expect(result.exitCode).not.toBe(0)
        expect(result.stdout).toContain("functional/immutable-data")
      })
    ),
  repositoryCompatibilityLintTimeout
)
