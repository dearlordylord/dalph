/* eslint-disable import/no-nodejs-modules -- This built-command qualification facade observes process boundaries. */
import nodeFs from "node:fs"
import nodeProcess from "node:process"
import {
  GithubGraphqlClient,
  type GithubGraphqlRequest,
  WorkflowTrace,
  currentSignalOf,
  makeCurrentSignal
} from "@dalph/orchestrator"
import { Effect, Layer, Match, Option, Schema, Stream } from "effect"
import { CodexAppServer } from "../src/application/codex-app-server.js"
import { CodexServerIncarnation } from "../src/application/codex-attempt-store.js"
import { ProductionCliRecord } from "../src/application/production-cli.js"
import {
  productionRepositoryHostGraph as actualProductionRepositoryHostGraph,
  withDecodedProductionRepositoryHost as actualWithDecodedProductionRepositoryHost,
  type ProductionHostObservation
} from "../src/application/production-host.js"

const FixtureEnvironment = Schema.Struct({
  DALPH_QUALIFICATION_CLAIM_STATE: Schema.NonEmptyString,
  DALPH_QUALIFICATION_MODE: Schema.Literals(["first", "recovered", "terminal", "closed-null"]),
  DALPH_QUALIFICATION_STATUS_SOURCE: Schema.NonEmptyString
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
        yield* observe({ _tag: "CreateClaimLabelStarted", operationId: create.operationId })
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
    ReadIssue: () =>
      Effect.succeed({
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

const codex = CodexAppServer.of({
  incarnation: CodexServerIncarnation.make(`public-recovery-${environment.DALPH_QUALIFICATION_STATUS_SOURCE}`),
  attachTurnCompletedHints: Effect.succeed(Stream.empty),
  attachOwnedActivityHints: Effect.succeed(Stream.empty),
  startThread: () => Effect.never,
  readThread: () => Effect.never,
  resumeThread: () => Effect.never,
  startTurn: () => Effect.never,
  interruptTurn: () => Effect.void,
  listBackgroundTerminals: () => Effect.succeed([]),
  terminateBackgroundTerminal: () => Effect.succeed(true),
  close: Effect.void
})

export const productionRepositoryHostGraph = () =>
  actualProductionRepositoryHostGraph({
    codexAppServer: () => Layer.succeed(CodexAppServer, codex),
    githubClient: () => Layer.succeed(GithubGraphqlClient, github),
    onActivationFinalizationStart: (kind) => observe({ _tag: "ActivationFinalizationStarted", kind }),
    workflowTrace: () =>
      Layer.succeed(
        WorkflowTrace,
        WorkflowTrace.of({ emit: (event) => observe({ _tag: "WorkflowTraceObserved", event: event._tag }) })
      )
  })

const observedStatusSource = (observation: ProductionHostObservation): ProductionHostObservation => {
  void nodeProcess.stderr.write(
    `${prefix}${JSON.stringify({
      _tag: "StatusSourceAttached",
      sourceId: environment.DALPH_QUALIFICATION_STATUS_SOURCE
    })}\n`
  )
  const stableJournalEvidence = makeCurrentSignal(
    observation.current.attach.pipe(
      Effect.map(({ changes, current }) => ({
        current,
        // One actual post-attachment publication is enough to prove the recovered process's
        // coherent source without turning later process-local UI churn into qualification input.
        changes: changes.pipe(Stream.take(1))
      }))
    )
  )
  return environment.DALPH_QUALIFICATION_MODE === "closed-null"
    ? {
        ...observation,
        current: currentSignalOf({ _tag: "Closed" as const, final: null }),
        runTermination: { await: Effect.never, poll: Effect.succeed(Option.none()) }
      }
    : { ...observation, current: stableJournalEvidence }
}

export const withDecodedProductionRepositoryHost: typeof actualWithDecodedProductionRepositoryHost = (
  configuration,
  graph,
  use
) =>
  actualWithDecodedProductionRepositoryHost(configuration, graph, (observation) =>
    use(observedStatusSource(observation))
  )

export { ProductionCliRecord }
