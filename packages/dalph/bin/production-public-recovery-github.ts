/* eslint-disable import/no-nodejs-modules -- This qualification controls only the GitHub authority boundary. */
import nodeFs from "node:fs"
import nodeProcess from "node:process"
import { GithubGraphqlClient, type GithubGraphqlRequest } from "@dalph/orchestrator"
import { Effect, Layer, Match, Schema } from "effect"

const FixtureEnvironment = Schema.Struct({
  DALPH_QUALIFICATION_CLAIM_STATE: Schema.NonEmptyString,
  DALPH_QUALIFICATION_MODE: Schema.Literals(["first", "recovered", "terminal", "exit-during-attachment"])
})

const environment = Schema.decodeUnknownSync(FixtureEnvironment)(nodeProcess.env)
const repositoryNodeId = "production-public-recovery-repository"
const issueNodeId = "production-public-recovery-issue"
const prefix = "DALPH_PUBLIC_RECOVERY_FIXTURE "

const observe = (event: unknown) =>
  Effect.sync(() => {
    nodeProcess.stderr.write(`${prefix}${JSON.stringify(event)}\n`)
  })

const closedIssue = environment.DALPH_QUALIFICATION_MODE === "terminal"

const graphResponse = (request: GithubGraphqlRequest) =>
  Match.valueTags(request, {
    AddBlockedBy: () => Effect.die("qualification must not add a blocker"),
    AddIssueComment: () => Effect.die("qualification must not add a comment"),
    AddSubIssue: () => Effect.die("qualification must not add a subissue"),
    CloseIssue: () => Effect.die("qualification must not close the fixture issue"),
    CreateClaimLabel: (create) =>
      Effect.gen(function* () {
        yield* Effect.sync(() => {
          nodeFs.writeFileSync(
            environment.DALPH_QUALIFICATION_CLAIM_STATE,
            JSON.stringify({ description: create.description, labelName: create.labelName })
          )
        })
        yield* observe({
          _tag: "CreateClaimLabelStarted",
          description: create.description,
          labelName: create.labelName,
          operationId: create.operationId
        })
        return yield* Effect.never
      }),
    CreateIssue: () => Effect.die("qualification must not create an issue"),
    DeleteClaimLabel: () => Effect.die("qualification must not delete the active claim"),
    DeleteIssue: () => Effect.die("qualification must not delete an issue"),
    FindClaimLabel: (find) =>
      Effect.gen(function* () {
        yield* observe({ _tag: "FindClaimLabelStarted", labelName: find.labelName })
        if (environment.DALPH_QUALIFICATION_MODE === "first") {
          return { body: { data: { node: { id: repositoryNodeId, label: null } } } }
        }
        const claim = yield* Schema.decodeUnknownEffect(
          Schema.Struct({ description: Schema.NonEmptyString, labelName: Schema.NonEmptyString })
        )(JSON.parse(nodeFs.readFileSync(environment.DALPH_QUALIFICATION_CLAIM_STATE, "utf8"))).pipe(Effect.orDie)
        return {
          body: {
            data: {
              node: {
                id: repositoryNodeId,
                label: { description: claim.description, id: "production-public-recovery-label", name: claim.labelName }
              }
            }
          }
        }
      }),
    ReadBlockedBy: () =>
      Effect.succeed({
        body: {
          data: {
            node: {
              __typename: "Issue",
              blockedBy: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } },
              id: issueNodeId
            }
          }
        }
      }),
    ReadIssue: (read) =>
      Effect.gen(function* () {
        yield* observe({
          _tag: "ReadIssueStarted",
          issueNodeId: read.issueNodeId,
          mode: environment.DALPH_QUALIFICATION_MODE
        })
        if (environment.DALPH_QUALIFICATION_MODE === "exit-during-attachment") return yield* Effect.never
        yield* observe({
          _tag: "ReadIssueReturned",
          issueNodeId: read.issueNodeId,
          state: closedIssue ? "CLOSED" : "OPEN"
        })
        return {
          body: {
            data: {
              node: {
                __typename: "Issue",
                id: issueNodeId,
                parent: null,
                repository: { id: repositoryNodeId },
                state: closedIssue ? "CLOSED" : "OPEN",
                stateReason: closedIssue ? "COMPLETED" : null
              }
            }
          }
        }
      }),
    ReadIssueDetails: () => Effect.die("qualification does not require issue details"),
    ReadSubIssues: () =>
      Effect.succeed({
        body: {
          data: {
            node: {
              __typename: "Issue",
              id: issueNodeId,
              subIssues: { nodes: [], pageInfo: { endCursor: null, hasNextPage: false } }
            }
          }
        }
      }),
    ReadTaskWorkSpecification: () => Effect.never,
    ReopenIssue: () => Effect.die("qualification must not reopen an issue"),
    ResolveIssue: () =>
      Effect.succeed({ body: { data: { repository: { id: repositoryNodeId, issue: { id: issueNodeId } } } } }),
    ResolveRepository: () => Effect.succeed({ body: { data: { repository: { id: repositoryNodeId } } } })
  })

const github = GithubGraphqlClient.of({ execute: graphResponse })

/** Controlled GitHub service supplied at the host's explicit external boundary. */
export const publicRecoveryGithubLayer = Layer.succeed(GithubGraphqlClient, github)
