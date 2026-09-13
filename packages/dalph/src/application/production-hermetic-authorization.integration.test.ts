/* eslint-disable import/no-nodejs-modules -- This integration test starts the actual built Node child with an explicit fixture environment. */
import nodeProcess from "node:process"
import { GitCommitSha } from "@dalph/contracts"
import { GitCommand, nodeGitCommandLayer } from "@dalph/orchestrator"
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { Effect, FileSystem, Layer, Ref, Result, Schema, Stream } from "effect"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { expect } from "vitest"
import { createHermeticFixture } from "../../test-support/production-hermetic-fixture.js"
import { makeHermeticController } from "../../test-support/production-hermetic-controller.js"
import { HermeticFixtureAuthorizationFailure, HermeticFixtureManifest } from "./production-hermetic-contract.js"

const builtEntry = new URL("../../dist/bin/production-hermetic-qualification.js", import.meta.url).pathname
const sourceBaseSha = GitCommitSha.make("bf027ef1588d0ec0d0e749b812d6652343682c3b")
const fixtureLayer = nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer), Layer.merge(NodeCrypto.layer))

it.live(
  "a changed configuration is rejected again before any child spawn and leaves the foreign ref unchanged",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const starts = yield* Ref.make(0)
        const controller = yield* makeHermeticController(fixture, { _tag: "Unpaused" }).pipe(
          Effect.provideService(
            ChildProcessSpawner.ChildProcessSpawner,
            ChildProcessSpawner.ChildProcessSpawner.of({
              ...spawner,
              spawn: (command) => Ref.update(starts, (count) => count + 1).pipe(Effect.andThen(spawner.spawn(command)))
            })
          )
        )
        const git = yield* GitCommand
        yield* git.runInWorktree(fixture.manifest.repository, ["branch", "foreign", fixture.manifest.baseSha])
        const document = yield* fs
          .readFileString(fixture.configurationPath)
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))
            )
          )
        yield* fs.writeFileString(
          fixture.configurationPath,
          JSON.stringify({ ...document, integrationRef: "refs/heads/foreign" })
        )
        const result = yield* controller.startChild().pipe(Effect.result)
        expect(Result.isFailure(result)).toBe(true)
        if (Result.isSuccess(result)) return yield* Effect.die("unauthorized child unexpectedly started")
        expect(Schema.is(HermeticFixtureAuthorizationFailure)(result.failure)).toBe(true)
        if (Schema.is(HermeticFixtureAuthorizationFailure)(result.failure))
          expect(result.failure.reason).toBe("ConfigurationMismatch")
        expect(yield* Ref.get(starts)).toBe(0)
        expect((yield* controller.providerSnapshot).operationCounts).toEqual([])
        expect(
          (yield* git.runInWorktree(fixture.manifest.repository, ["rev-parse", "refs/heads/foreign"])).stdout.trim()
        ).toBe(fixture.manifest.baseSha)
        expect(yield* fs.readFileString(fixture.manifest.journalDatabase)).toBe("")
        expect(yield* fs.readFileString(fixture.manifest.privateStore)).toBe("[]\n")
      })
    ).pipe(Effect.provide(fixtureLayer)),
  30_000
)

it.live(
  "the built child guards its actual decoded configuration against original Q before SQLite or host acquisition",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
        const beforeCodex = yield* fs.readDirectory(fixture.manifest.codexStateDirectory)
        const document = yield* fs
          .readFileString(fixture.configurationPath)
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown)))
            )
          )
        const foreignJournal = `${fixture.container}/foreign-journal.sqlite`
        yield* fs.writeFileString(foreignJournal, "foreign journal sentinel\n")
        yield* fs.writeFileString(
          fixture.configurationPath,
          JSON.stringify({ ...document, journalDatabase: foreignJournal })
        )
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const child = yield* spawner.spawn(
          ChildProcess.make(
            nodeProcess.execPath,
            [builtEntry, "run", "github:hermetic/fixture#1", "--production", "--config", fixture.configurationPath],
            {
              env: {
                GITHUB_TOKEN: "controlled-hermetic-github-token",
                DALPH_CODEX_PROVIDER_CREDENTIAL: "controlled-hermetic-codex-credential",
                DALPH_HERMETIC_CONTROLLER: "http://127.0.0.1:9",
                DALPH_HERMETIC_EXPECTED_MANIFEST: yield* Schema.encodeEffect(
                  Schema.fromJsonString(HermeticFixtureManifest)
                )(fixture.manifest),
                GIT_OPTIONAL_LOCKS: "0"
              }
            }
          )
        )
        const [stdout, , exitCode] = yield* Effect.all(
          [child.stdout.pipe(Stream.decodeText(), Stream.mkString), child.stderr.pipe(Stream.runDrain), child.exitCode],
          { concurrency: "unbounded" }
        )
        expect(exitCode).toBe(1)
        expect(stdout).not.toContain("RunSelected")
        expect(yield* fs.readFileString(foreignJournal)).toBe("foreign journal sentinel\n")
        expect(yield* fs.readFileString(fixture.manifest.journalDatabase)).toBe("")
        expect(yield* fs.readFileString(fixture.manifest.privateStore)).toBe("[]\n")
        expect(yield* fs.readDirectory(fixture.manifest.codexStateDirectory)).toEqual(beforeCodex)
      })
    ).pipe(Effect.provide(fixtureLayer)),
  30_000
)
