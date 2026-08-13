import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect } from "vitest"

const repositoryRoot = process.cwd()
const diagnosticRunner = join(repositoryRoot, "scripts", "run-effect-diagnostics.mjs")
const diagnosticFixtureRoot = join(repositoryRoot, "test", "fixtures", "effect-diagnostics")

const CommandResult = Schema.Struct({ exitCode: Schema.Finite, stdout: Schema.String, stderr: Schema.String })
const Diagnostic = Schema.Struct({
  code: Schema.Finite,
  file: Schema.String,
  message: Schema.String,
  name: Schema.String,
  severity: Schema.String
})
const DiagnosticResult = Schema.Struct({ diagnostics: Schema.Array(Diagnostic) })

class DiagnosticCommandError extends Schema.TaggedError<DiagnosticCommandError>()("DiagnosticCommandError", {
  cause: Schema.String
}) {}

const run = (fixturePath: string, extraArguments: ReadonlyArray<string> = []) =>
  Effect.tryPromise({
    try: () =>
      new Promise((resolvePromise) => {
        const child = spawn(process.execPath, [diagnosticRunner, "--file", fixturePath, ...extraArguments], {
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
    catch: (cause) => new DiagnosticCommandError({ cause: String(cause) })
  }).pipe(Effect.flatMap((result) => Schema.decodeUnknownEffect(CommandResult)(result)))

const parse = (result: typeof CommandResult.Type) =>
  Schema.decodeUnknownEffect(DiagnosticResult)(JSON.parse(result.stdout)).pipe(
    Effect.map((diagnostics) => ({ ...result, diagnostics: diagnostics.diagnostics }))
  )

const withDiagnosticFixture = <Result>(
  fixtureName: string,
  use: (fixturePath: string) => Effect.Effect<Result, unknown>
) =>
  Effect.acquireUseRelease(
    Effect.gen(function* () {
      const directory = yield* Effect.tryPromise(() => mkdtemp(join(repositoryRoot, "scripts", "effect-diagnostics-")))
      const source = yield* Effect.tryPromise(() => readFile(join(diagnosticFixtureRoot, fixtureName), "utf8"))
      const fixturePath = join(directory, fixtureName)
      yield* Effect.tryPromise(() => writeFile(fixturePath, source))
      return { directory, fixturePath }
    }),
    ({ fixturePath }) => use(fixturePath),
    ({ directory }) => Effect.promise(() => rm(directory, { force: true, recursive: true }))
  )

it.effect(
  "Effect warning and error severities make a floating effect fail",
  () =>
    withDiagnosticFixture("floating-effect.ts", (fixturePath) =>
      Effect.gen(function* () {
        const result = yield* run(fixturePath).pipe(Effect.flatMap(parse))
        expect(result.exitCode).not.toBe(0)
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({ name: "floatingEffect", severity: "error" })
        )
        expect(result.stdout.split("\n").length).toBeLessThan(30)
      })
    ),
  30_000
)

it.effect(
  "a clean Effect diagnostic run succeeds with compact JSON output",
  () =>
    withDiagnosticFixture("used-effect.ts", (fixturePath) =>
      Effect.gen(function* () {
        const result = yield* run(fixturePath).pipe(Effect.flatMap(parse))
        expect(result.exitCode).toBe(0)
        expect(result.diagnostics).toEqual([])
        expect(result.stdout.split("\n").length).toBeLessThan(30)
      })
    ),
  30_000
)

it.effect(
  "the strict diagnostics runner also fails a warning severity",
  () =>
    withDiagnosticFixture("floating-effect.ts", (fixturePath) =>
      Effect.gen(function* () {
        const result = yield* run(fixturePath, [
          "--lspconfig",
          JSON.stringify({ diagnosticSeverity: { floatingEffect: "warning" } })
        ]).pipe(Effect.flatMap(parse))
        expect(result.exitCode).not.toBe(0)
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({ name: "floatingEffect", severity: "warning" })
        )
      })
    ),
  30_000
)
