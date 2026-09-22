/* eslint-disable import/no-nodejs-modules -- The fixture owns exact disposable Git paths. */

import nodePath from "node:path"
import {
  GitCommitSha,
  GitRepositoryLocator,
  type IntegrationTargetRef,
  RemotePublicationBranchRef,
  RemotePublicationEndpoint,
  RemotePublicationTarget
} from "@dalph/contracts"
import { GitCommand } from "@dalph/orchestrator"
import { Effect, FileSystem, Redacted, Schema } from "effect"
import { decodeProductionRepositoryHostConfiguration } from "../src/application/production-configuration.js"
import type { HermeticControllerFixture } from "./production-hermetic-controller.js"
import { createHermeticFixture } from "./production-hermetic-fixture.js"

export interface ProductionPublicPublicationFixture extends HermeticControllerFixture {
  readonly root: string
  readonly builtEntry: string
  readonly repository: GitRepositoryLocator
  readonly remoteRepository: GitRepositoryLocator
  readonly remoteRef: IntegrationTargetRef
  readonly baseSha: GitCommitSha
  readonly journalDatabase: HermeticControllerFixture["manifest"]["journalDatabase"]
  readonly baseConfiguration: Readonly<Record<string, unknown>>
}

const sourceBaseSha = GitCommitSha.make("dd69b1e247394a5c20e551593b142624af85f291")

const requireSuccessfulGit = Effect.fn("ProductionPublicPublicationFixture.requireSuccessfulGit")(function* (
  result: Effect.Success<ReturnType<GitCommand["Service"]["run"]>>,
  description: string
) {
  if (result.exitCode !== 0) return yield* Effect.die(`${description}: ${result.stderr}`)
  return result.stdout.trim()
})

/** Extends the authorized production-hermetic fixture with a distinct bare publication repository. */
export const createProductionPublicPublicationFixture = Effect.fn("ProductionPublicPublicationFixture.create")(
  function* (builtEntry: string) {
    const fs = yield* FileSystem.FileSystem
    const git = yield* GitCommand
    const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
    const root = fixture.container
    yield* Effect.addFinalizer(() => fs.remove(root, { recursive: true }).pipe(Effect.catch(() => Effect.void)))
    const repository = fixture.manifest.repository
    const remoteRepository = GitRepositoryLocator.make(nodePath.join(root, "publication.git"))
    const remoteRef = fixture.manifest.integrationRef

    yield* requireSuccessfulGit(
      yield* git.runInWorktree(root, ["clone", "--bare", repository, remoteRepository]),
      "create distinct bare publication repository"
    )
    const remoteBaseSha = GitCommitSha.make(
      yield* requireSuccessfulGit(
        yield* git.run(remoteRepository, ["rev-parse", remoteRef]),
        "read bare publication base"
      )
    )
    if (remoteBaseSha !== fixture.manifest.baseSha)
      return yield* Effect.die(
        `bare publication base ${remoteBaseSha} differs from local base ${fixture.manifest.baseSha}`
      )

    const document = yield* fs
      .readFileString(fixture.configurationPath)
      .pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))))
      )
    const remotePublicationTarget = RemotePublicationTarget.make({
      branch: RemotePublicationBranchRef.make(remoteRef),
      endpoint: RemotePublicationEndpoint.make(remoteRepository)
    })
    const baseConfiguration = { ...document, remotePublicationTarget }
    yield* fs.writeFileString(fixture.configurationPath, JSON.stringify(baseConfiguration))
    const configuration = yield* decodeProductionRepositoryHostConfiguration({
      ...baseConfiguration,
      target: fixture.configuration.target,
      githubToken: Redacted.value(fixture.configuration.githubToken)
    })

    return {
      ...fixture,
      configuration,
      root,
      builtEntry,
      repository,
      remoteRepository,
      remoteRef,
      baseSha: fixture.manifest.baseSha,
      journalDatabase: fixture.manifest.journalDatabase,
      baseConfiguration
    } satisfies ProductionPublicPublicationFixture
  }
)
