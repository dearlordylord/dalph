import { Effect, Layer, Schema } from "effect"
import { GitCommitSha, type GitRepositoryLocator } from "@dalph/contracts"
import { GitCommand, type GitCommandResult } from "./command.js"
import {
  IntegrationCandidateGit,
  IntegrationCandidateGitObservation,
  IntegrationCandidateGitReadFailure
} from "../../workflow/protocols/integration-candidate-construction/protocol.js"

const missingObject = (result: GitCommandResult): boolean =>
  result.exitCode !== 0 && /(?:not a valid object name|could not get object info|bad object)/iu.test(result.stderr)

const readFailure = (
  repository: GitRepositoryLocator,
  candidateCommit: GitCommitSha,
  result: GitCommandResult
): IntegrationCandidateGitReadFailure =>
  new IntegrationCandidateGitReadFailure({
    candidateCommit,
    detail: result.stderr.trim() || `git exited ${result.exitCode}`,
    repository
  })

const directParentNames = (commit: string): ReadonlyArray<string> => {
  const parents: Array<string> = []
  for (const line of commit.split("\n")) {
    if (line === "") break
    if (!line.startsWith("parent ")) continue
    parents.push(line.slice("parent ".length))
  }
  return parents
}

/** Read-only Git adapter for the submitted integration-candidate object and its ordered direct parents. */
export const nodeGitIntegrationCandidateLayer = Layer.effect(
  IntegrationCandidateGit,
  Effect.gen(function* () {
    const commands = yield* GitCommand
    return IntegrationCandidateGit.of({
      readSubmittedCommit: Effect.fn("IntegrationCandidateGit.Node.readSubmittedCommit")(
        function* (repository, candidateCommit) {
          const type = yield* commands
            .run(repository, ["cat-file", "-t", candidateCommit])
            .pipe(
              Effect.mapError(
                (failure) =>
                  new IntegrationCandidateGitReadFailure({ candidateCommit, detail: failure.detail, repository })
              )
            )
          if (missingObject(type)) return IntegrationCandidateGitObservation.cases.Missing.make({})
          if (type.exitCode !== 0) return yield* readFailure(repository, candidateCommit, type)
          const objectType = type.stdout.trim()
          if (objectType !== "commit") {
            return IntegrationCandidateGitObservation.cases.NonCommit.make({ objectType })
          }
          const commit = yield* commands
            .run(repository, ["cat-file", "-p", candidateCommit])
            .pipe(
              Effect.mapError(
                (failure) =>
                  new IntegrationCandidateGitReadFailure({ candidateCommit, detail: failure.detail, repository })
              )
            )
          if (commit.exitCode !== 0) return yield* readFailure(repository, candidateCommit, commit)
          const directParents = yield* Schema.decodeUnknownEffect(Schema.Array(GitCommitSha))(
            directParentNames(commit.stdout)
          ).pipe(
            Effect.mapError(
              () =>
                new IntegrationCandidateGitReadFailure({
                  candidateCommit,
                  detail: "git returned a commit with a malformed parent object name",
                  repository
                })
            )
          )
          return IntegrationCandidateGitObservation.cases.Commit.make({ directParents })
        }
      )
    })
  })
)
