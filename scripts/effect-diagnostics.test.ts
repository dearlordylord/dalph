import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { expect } from "vitest"
// @ts-expect-error The bounded command implementation is an executable JavaScript module.
import { runBoundedCommand } from "./run-bounded-command.mjs"

const repositoryRoot = process.cwd()
const diagnosticRunner = join(repositoryRoot, "scripts", "run-effect-diagnostics.mjs")
const diagnosticFixtureRoot = join(repositoryRoot, "test", "fixtures", "effect-diagnostics")

const CommandResult = Schema.Struct({ exitCode: Schema.Finite, output: Schema.String })
const Diagnostic = Schema.Struct({
  code: Schema.Finite,
  file: Schema.String,
  message: Schema.String,
  name: Schema.String,
  severity: Schema.String
})
const DiagnosticResult = Schema.Struct({ diagnostics: Schema.Array(Diagnostic) })

class DiagnosticCommandError extends Schema.TaggedError<DiagnosticCommandError>()("DiagnosticCommandError", {
  cause: Schema.Unknown
}) {}

interface DiagnosticFixture {
  readonly directory: string
  readonly fixturePath: string
  readonly commandsWithoutStoppedProof: Set<symbol>
}

const run = (fixture: DiagnosticFixture, extraArguments: ReadonlyArray<string> = []) =>
  Effect.tryPromise({
    try: async () => {
      const command = Symbol("Effect diagnostics fixture command")
      fixture.commandsWithoutStoppedProof.add(command)
      try {
        const result = await runBoundedCommand({
          acceptedExitCodes: [0, 1],
          args: [diagnosticRunner, "--file", fixture.fixturePath, ...extraArguments],
          captureOutput: true,
          cwd: fixture.directory,
          executable: process.execPath,
          forwardOutput: false,
          name: "Effect diagnostics fixture command",
          relayParentSignals: true,
          timeoutMilliseconds: 20_000
        })
        fixture.commandsWithoutStoppedProof.delete(command)
        return result
      } catch (cause) {
        // These bounded outcomes prove stopped commands and registered descendants. Ambiguous outcomes retain storage.
        if (
          cause instanceof Error &&
          "quintCommandResult" in cause &&
          typeof cause.quintCommandResult === "string" &&
          /^(?:exit:\d+|launch-failed|timed-out)$/u.test(cause.quintCommandResult)
        )
          fixture.commandsWithoutStoppedProof.delete(command)
        throw cause
      }
    },
    catch: (cause) => new DiagnosticCommandError({ cause })
  }).pipe(Effect.flatMap((result) => Schema.decodeUnknownEffect(CommandResult)(result)))

const parse = (result: typeof CommandResult.Type) =>
  Schema.decodeUnknownEffect(Schema.fromJsonString(DiagnosticResult))(result.output).pipe(
    Effect.map((diagnostics) => ({ ...result, diagnostics: diagnostics.diagnostics }))
  )

const withDiagnosticFixture = <Result>(
  fixtureName: string,
  use: (fixture: DiagnosticFixture) => Effect.Effect<Result, unknown>
) =>
  Effect.acquireUseRelease(
    Effect.tryPromise(async () => {
      await mkdir(join(repositoryRoot, ".scratch"), { recursive: true })
      const directory = await mkdtemp(join(repositoryRoot, ".scratch", "effect-diagnostics-"))
      return {
        directory,
        fixturePath: join(directory, "scripts", fixtureName),
        commandsWithoutStoppedProof: new Set<symbol>()
      }
    }),
    (fixture) =>
      Effect.gen(function* () {
        yield* Effect.tryPromise(async () => {
          // The unchanged compiler policy sees the same scripts-relative file and dependency resolution in a tiny program.
          await mkdir(join(fixture.directory, "scripts"))
          const source = await readFile(join(diagnosticFixtureRoot, fixtureName), "utf8")
          const preparation = await Promise.allSettled([
            copyFile(join(repositoryRoot, "tsconfig.base.json"), join(fixture.directory, "tsconfig.base.json")),
            symlink(join(repositoryRoot, "node_modules"), join(fixture.directory, "node_modules"), "dir"),
            writeFile(join(fixture.directory, "package.json"), JSON.stringify({ private: true, type: "module" })),
            writeFile(
              join(fixture.directory, "tsconfig.json"),
              JSON.stringify({ extends: "./tsconfig.base.json", include: ["scripts/**/*.ts"] })
            ),
            writeFile(fixture.fixturePath, source)
          ])
          for (const result of preparation) if (result.status === "rejected") throw result.reason
        })
        return yield* use(fixture)
      }),
    (fixture) =>
      Effect.promise(async () => {
        if (fixture.commandsWithoutStoppedProof.size === 0)
          await rm(fixture.directory, { force: true, recursive: true })
        else console.error(`Preserving Effect diagnostics fixture with unproven stopped custody: ${fixture.directory}`)
      })
  )

it.effect(
  "Effect warning and error severities make a floating effect fail",
  () =>
    withDiagnosticFixture("floating-effect.ts", (fixture) =>
      Effect.gen(function* () {
        const result = yield* run(fixture).pipe(Effect.flatMap(parse))
        expect(result.exitCode).not.toBe(0)
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({ file: fixture.fixturePath, name: "floatingEffect", severity: "error" })
        )
        expect(result.output.split("\n").length).toBeLessThan(30)
      })
    ),
  30_000
)

it.effect(
  "a clean Effect diagnostic run succeeds with compact JSON output",
  () =>
    withDiagnosticFixture("used-effect.ts", (fixture) =>
      Effect.gen(function* () {
        const result = yield* run(fixture).pipe(Effect.flatMap(parse))
        expect(result.exitCode).toBe(0)
        expect(result.diagnostics).toEqual([])
        expect(result.output.split("\n").length).toBeLessThan(30)
      })
    ),
  30_000
)

it.effect(
  "the strict diagnostics runner also fails a warning severity",
  () =>
    withDiagnosticFixture("floating-effect.ts", (fixture) =>
      Effect.gen(function* () {
        const result = yield* run(fixture, [
          "--lspconfig",
          JSON.stringify({ diagnosticSeverity: { floatingEffect: "warning" } })
        ]).pipe(Effect.flatMap(parse))
        expect(result.exitCode).not.toBe(0)
        expect(result.diagnostics).toContainEqual(
          expect.objectContaining({ file: fixture.fixturePath, name: "floatingEffect", severity: "warning" })
        )
      })
    ),
  30_000
)
