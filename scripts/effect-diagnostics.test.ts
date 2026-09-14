import { it } from "@effect/vitest"
import { Effect, Schema } from "effect"
import { execFileSync, spawnSync } from "node:child_process"
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises"
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

interface ChangedDiagnosticFixture {
  readonly baseSha: string
  readonly directory: string
  readonly shimLog: string
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

const git = (directory: string, ...arguments_: ReadonlyArray<string>) =>
  execFileSync("git", arguments_, { cwd: directory, encoding: "utf8" }).trim()

const withChangedDiagnosticFixture = <Result>(
  use: (fixture: ChangedDiagnosticFixture) => Effect.Effect<Result, unknown>
) =>
  Effect.acquireUseRelease(
    Effect.tryPromise(async () => {
      await mkdir(join(repositoryRoot, ".scratch"), { recursive: true })
      const directory = await mkdtemp(join(repositoryRoot, ".scratch", "changed-effect-diagnostics-"))
      const shimLog = join(directory, "effect-diagnostics-shim.log")
      const shim = join(directory, "node_modules", ".bin", "effect-tsgo")
      await mkdir(join(directory, "node_modules", ".bin"), { recursive: true })
      await mkdir(join(directory, "scripts"), { recursive: true })
      await writeFile(join(directory, "package.json"), JSON.stringify({ private: true, type: "module" }))
      await writeFile(join(directory, "tsconfig.json"), JSON.stringify({ include: ["scripts/**/*.ts"] }))
      await writeFile(join(directory, "scripts", "baseline.ts"), "export {}\n")
      await writeFile(
        shim,
        `#!${process.execPath}\nimport {appendFileSync} from "node:fs"\nappendFileSync(process.env.DALPH_EFFECT_DIAGNOSTICS_SHIM_LOG, JSON.stringify(process.argv.slice(2)) + "\\n")\nprocess.stdout.write(JSON.stringify({diagnostics:[],summary:{filesChecked:1,totalFiles:1,errors:0,warnings:0,messages:0}}) + "\\n")\n`
      )
      await chmod(shim, 0o755)
      git(directory, "init", "--quiet", "--initial-branch=master")
      git(directory, "config", "user.name", "Dalph Test")
      git(directory, "config", "user.email", "dalph@example.invalid")
      git(directory, "add", ".")
      git(directory, "commit", "--quiet", "-m", "baseline")
      return { baseSha: git(directory, "rev-parse", "HEAD"), directory, shimLog }
    }),
    use,
    (fixture) => Effect.promise(() => rm(fixture.directory, { force: true, recursive: true }))
  )

const runChangedDiagnostics = (fixture: ChangedDiagnosticFixture, environment: NodeJS.ProcessEnv = process.env) =>
  Effect.sync(() =>
    spawnSync(process.execPath, [diagnosticRunner, "--changed"], {
      cwd: fixture.directory,
      encoding: "utf8",
      env: { ...environment, DALPH_EFFECT_DIAGNOSTICS_SHIM_LOG: fixture.shimLog }
    })
  )

const shimInvocations = (fixture: ChangedDiagnosticFixture) =>
  Effect.tryPromise(async () => {
    try {
      return (await readFile(fixture.shimLog, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ReadonlyArray<string>)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return []
      throw error
    }
  })

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

it.effect("changed Effect diagnostics use the pinned base and keep selection evidence off stdout", () =>
  withChangedDiagnosticFixture((fixture) =>
    Effect.gen(function* () {
      yield* Effect.tryPromise(async () => {
        await writeFile(join(fixture.directory, "scripts", "prerequisite.ts"), "export const prerequisite = 1\n")
        git(fixture.directory, "add", ".")
        git(fixture.directory, "commit", "--quiet", "-m", "prerequisite")
        const prerequisiteHead = git(fixture.directory, "rev-parse", "HEAD")
        git(fixture.directory, "update-ref", "refs/remotes/origin/master", prerequisiteHead)
        await writeFile(join(fixture.directory, "docs-dependent.md"), "dependent\n")
      })

      const result = yield* runChangedDiagnostics(fixture, { ...process.env, DALPH_DIAGNOSTICS_BASE: fixture.baseSha })
      expect(result.status).toBe(0)
      expect(() => JSON.parse(result.stdout)).not.toThrow()
      expect(result.stdout).not.toContain("Dalph changed-file selection")
      expect(result.stderr).toContain(`"reference":"${fixture.baseSha}"`)
      expect(result.stderr).toContain(`"resolvedSha":"${fixture.baseSha}"`)
      expect(result.stderr).toContain('"source":"explicit"')
      expect(result.stderr).toContain('"changedPaths":["docs-dependent.md","scripts/prerequisite.ts"]')
      expect(result.stderr).toContain('"selectedPaths":["scripts/prerequisite.ts"]')
      expect(yield* shimInvocations(fixture)).toEqual([
        expect.arrayContaining(["diagnostics", "--file", "scripts/prerequisite.ts"])
      ])
    })
  )
)

it.effect("changed Effect diagnostics report an empty pinned selection without starting diagnostics", () =>
  withChangedDiagnosticFixture((fixture) =>
    Effect.gen(function* () {
      const result = yield* runChangedDiagnostics(fixture, { ...process.env, DALPH_DIAGNOSTICS_BASE: fixture.baseSha })
      expect(result.status).toBe(0)
      expect(result.stdout).toBe("")
      expect(result.stderr).toContain('"command":"typecheck:effect:changed:none"')
      expect(result.stderr).toContain('"changedPaths":[]')
      expect(result.stderr).toContain('"selectedPaths":[]')
      expect(result.stderr).toContain("Effect diagnostics have nothing to check")
      expect(yield* shimInvocations(fixture)).toEqual([])
    })
  )
)

it.effect("more than twelve changed TypeScript files route Effect diagnostics to one project check", () =>
  withChangedDiagnosticFixture((fixture) =>
    Effect.gen(function* () {
      yield* Effect.tryPromise(() =>
        Promise.all(
          Array.from({ length: 13 }, (_, index) =>
            writeFile(join(fixture.directory, "scripts", `changed-${String(index).padStart(2, "0")}.ts`), "export {}\n")
          )
        )
      )
      const result = yield* runChangedDiagnostics(fixture, { ...process.env, DALPH_DIAGNOSTICS_BASE: fixture.baseSha })
      expect(result.status).toBe(0)
      expect(() => JSON.parse(result.stdout)).not.toThrow()
      expect(result.stderr).toContain('"command":"typecheck:effect:changed:project"')
      expect(result.stderr).toContain('"selectedPaths":["tsconfig.json"]')
      expect(result.stderr).toContain("More than 12 changed TypeScript files")
      expect(yield* shimInvocations(fixture)).toEqual([
        expect.arrayContaining(["diagnostics", "--project", "tsconfig.json"])
      ])
    })
  )
)

it.effect("changed Effect diagnostics fail before execution when the explicit base cannot resolve", () =>
  withChangedDiagnosticFixture((fixture) =>
    Effect.gen(function* () {
      const result = yield* runChangedDiagnostics(fixture, {
        ...process.env,
        DALPH_DIAGNOSTICS_BASE: "refs/heads/missing-planned-base"
      })
      expect(result.status).not.toBe(0)
      expect(result.stdout).toBe("")
      expect(result.stderr).toContain(
        'Changed-file diagnostics cannot resolve comparison base "refs/heads/missing-planned-base"'
      )
      expect(yield* shimInvocations(fixture)).toEqual([])
    })
  )
)

it.effect("changed Effect diagnostics fail visibly when the moving origin/master fallback cannot resolve", () =>
  withChangedDiagnosticFixture((fixture) =>
    Effect.gen(function* () {
      const { DALPH_DIAGNOSTICS_BASE: _inheritedBase, ...environment } = process.env
      const result = yield* runChangedDiagnostics(fixture, environment)
      expect(result.status).not.toBe(0)
      expect(result.stdout).toBe("")
      expect(result.stderr).toContain('Changed-file diagnostics cannot resolve comparison base "origin/master"')
      expect(yield* shimInvocations(fixture)).toEqual([])
    })
  )
)

it.effect("changed Effect diagnostics fail before execution when the explicit base has unrelated history", () =>
  withChangedDiagnosticFixture((fixture) =>
    Effect.gen(function* () {
      const unrelated = git(fixture.directory, "commit-tree", "HEAD^{tree}", "-m", "unrelated")
      const result = yield* runChangedDiagnostics(fixture, { ...process.env, DALPH_DIAGNOSTICS_BASE: unrelated })
      expect(result.status).not.toBe(0)
      expect(result.stdout).toBe("")
      expect(result.stderr).toContain("Changed-file diagnostics cannot establish a merge base")
      expect(result.stderr).toContain(unrelated)
      expect(yield* shimInvocations(fixture)).toEqual([])
    })
  )
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
