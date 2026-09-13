// THROWAWAY: real MCP bridge into unchanged production host composition.
import { GitCommitSha } from "@dalph/contracts"
import { GithubGraphqlClient, JournalStore, JournaledRunBootstrap, deliveryStatusOf,
 nodeGitCommandLayer, sqliteJournalStoreLayer, type GithubGraphqlRequest,
 type DeliveryRuntimeObservationState, type DeliveryRuntimeReadyObservation } from "@dalph/orchestrator"
import { NodeCrypto, NodeServices } from "@effect/platform-node"
import { it } from "@effect/vitest"
import { createServer } from "node:http"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import { Context, Deferred, Effect, Fiber, FileSystem, Layer, Ref } from "effect"
import { expect } from "vitest"
import { productionRepositoryHostGraph, withDecodedProductionRepositoryHost, type ProductionHostObservation } from "@dalph/dalph"
import { CodexAppServer } from "../../../packages/dalph/src/application/codex-app-server.js"
import { makeHermeticProviderState } from "../../../packages/dalph/test-support/production-hermetic-provider-state.js"
import { createHermeticFixture } from "../../../packages/dalph/test-support/production-hermetic-fixture.js"
import { connect, call, close, closeAll } from "./client.mjs"
const builtEntry = fileURLToPath(new URL("../../../packages/dalph/dist/bin/dalph.js", import.meta.url))
const sourceBaseSha = GitCommitSha.make("f99a2343f5b5d90c08e84b536ffab4a8d562b1fb")
const fixtureLayer = nodeGitCommandLayer.pipe(Layer.provideMerge(NodeServices.layer), Layer.merge(NodeCrypto.layer))
const providerBodyFor = (request: GithubGraphqlRequest) => {
  if (request._tag === "ResolveIssue") {
    return {
      query: "query ResolveIssue($fixture: String!) { fixture }",
      variables: {
        owner: request.target.owner,
        repository: request.target.repository,
        issueNumber: request.target.issueNumber
      }
    }
  }
  const { _tag, ...variables } = request
  return { query: `query ${_tag}($fixture: String!) { fixture }`, variables }
}

type WirePublication = {
  readonly _tag: "NotReady" | "Ready" | "Closed"
  readonly runId: string
  readonly acceptedAt?: number | null
  readonly graph?: unknown
  readonly frontier?: unknown
  readonly statuses?: unknown
  readonly final?: WirePublication | null
}

const readyProjection = (
  runId: ProductionHostObservation["selection"]["runId"],
  ready: DeliveryRuntimeReadyObservation,
  statusState: DeliveryRuntimeObservationState
): WirePublication => {
  const graphState = ready.evaluation.current.trackerGraph
  const snapshot = graphState._tag === "GraphEstablished" ? graphState.observation.snapshot : null
  const graph = snapshot?.toWire() ?? null
  return {
    _tag: "Ready",
    runId,
    acceptedAt: ready.evaluation.acceptedAt,
    graph: snapshot === null ? null : { rootTaskId: snapshot.rootTaskId ?? null, snapshot: graph },
    frontier: ready.evaluation.current.ticketDeliveries.source.source.standings,
    statuses: {
      run: deliveryStatusOf({ _tag: "Run", runId }, statusState),
      tasks:
        graph?.tasks.map((task) => ({
          taskId: task.id,
          status: deliveryStatusOf({ _tag: "Task", runId, taskId: task.id }, statusState)
        })) ?? []
    }
  }
}

const publicationOf = (
  runId: ProductionHostObservation["selection"]["runId"],
  state: DeliveryRuntimeObservationState
): WirePublication => {
  if (state._tag === "NotReady") return { _tag: "NotReady", runId }
  if (state._tag === "Ready") return readyProjection(runId, state, state)
  return {
    _tag: "Closed",
    runId,
    final: state.final === null ? null : readyProjection(runId, state.final, state)
  }
}


it.live("MCP child exits while the actual host accepts capacity and completes delivery", () =>
 Effect.scoped(Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const fixture = yield* createHermeticFixture(builtEntry, sourceBaseSha)
  yield* Effect.addFinalizer(() => fs.remove(fixture.container, {recursive:true,force:true}).pipe(Effect.orDie))
  const turnEntered = yield* Deferred.make<void>()
  const releaseTurn = yield* Deferred.make<void>()
  const commandEntered = yield* Deferred.make<void>()
  const releaseCommand = yield* Deferred.make<void>()
  const commandDone = yield* Deferred.make<unknown>()
  const bootstrapReady = yield* Deferred.make<JournaledRunBootstrap["Service"]>()
  const observationReady = yield* Deferred.make<ProductionHostObservation>()
  const releaseHost = yield* Deferred.make<void>()
  const provider = yield* makeHermeticProviderState(fixture.configuration, () => Effect.void, fixture.manifest.invocationId)
  const codex = CodexAppServer.of({...provider.codex, startTurn: (...args) =>
    Deferred.succeed(turnEntered, undefined).pipe(Effect.andThen(Deferred.await(releaseTurn)), Effect.andThen(provider.codex.startTurn(...args)))})
  const github = GithubGraphqlClient.of({execute:(request:GithubGraphqlRequest) =>
    provider.github(providerBodyFor(request)).pipe(Effect.orDie, Effect.flatMap(response => response.status === 200 ? Effect.succeed({body:response.body}) : Effect.die(`HTTP ${response.status}`)))})
  const exits = yield* Ref.make(0)
  const acquisitions = yield* Ref.make(0)
  const productionGraph = productionRepositoryHostGraph({
    boundaryObserver: boundary => boundary === "coordinator.acquire" ? Ref.update(acquisitions, n=>n+1) : Effect.void,
    applicationExitRequestObserver: () => Ref.update(exits,n=>n+1),
    codexAppServer: () => Layer.effect(CodexAppServer, Effect.addFinalizer(()=>provider.codex.close.pipe(Effect.orDie)).pipe(Effect.as(codex))),
    githubClient: () => Layer.succeed(GithubGraphqlClient,github)
  })
  const graph = {...productionGraph, run: (...args:Parameters<typeof productionGraph.run>) =>
    Layer.effectContext(Effect.gen(function*(){
      const context = yield* Layer.build(productionGraph.run(...args))
      const captured = Context.getOption(context, JournaledRunBootstrap)
      if (captured._tag === "None") return yield* Effect.die("Production graph does not retain bootstrap; no replacement permitted")
      yield* Deferred.succeed(bootstrapReady,captured.value)
      return context
    }))}
  const host = yield* withDecodedProductionRepositoryHost(fixture.configuration,graph, observation =>
    Deferred.succeed(observationReady,observation).pipe(Effect.andThen(Deferred.await(releaseHost)))).pipe(Effect.forkScoped)
  yield* Effect.addFinalizer(() => Effect.all([Deferred.succeed(releaseTurn,undefined),Deferred.succeed(releaseCommand,undefined),Deferred.succeed(releaseHost,undefined)]).pipe(Effect.asVoid))
  const observation = yield* Deferred.await(observationReady).pipe(Effect.timeout("30 seconds"))
  const bootstrap = yield* Deferred.await(bootstrapReady)
  yield* Deferred.await(turnEntered).pipe(Effect.timeout("30 seconds"))
  console.log(JSON.stringify({stage:"host-ready",runId:observation.selection.runId}))
  const runId = observation.selection.runId
  const scope = yield* Effect.scope
  const requestFibers = new Set<Fiber.Fiber<unknown, unknown>>()
  const state = Effect.gen(function*(){
    const policy = yield* bootstrap.operatorControl.readTaskWorkCapacity(runId)
    const publication = publicationOf(runId,yield* observation.current.get)
    return {runId,policy,publication}
  })
  const socket = join(fixture.container,"mcp-host.sock")
  const server = createServer((request,response)=>{
    let body=""
    request.setEncoding("utf8")
    request.on("data",chunk=>{body+=chunk})
    request.on("end",()=>{
      const operation = request.url === "/state" ? state : Effect.gen(function*(){
        const input = JSON.parse(body)
        if(input.hold){yield* Deferred.succeed(commandEntered,undefined); yield* Deferred.await(releaseCommand)}
        const result = yield* bootstrap.operatorControl.setTaskWorkCapacity(input).pipe(Effect.match({onSuccess:policy=>({ok:true,policy}),onFailure:error=>({ok:false,error})}))
        if(input.hold) yield* Deferred.succeed(commandDone,result)
        return result
      })
      const respond = operation.pipe(Effect.tap(result=>Effect.sync(()=>{
        if(!response.destroyed){response.setHeader("content-type","application/json");response.end(JSON.stringify(result))}
      })),Effect.catchCause(cause=>Effect.sync(()=>{if(!response.destroyed){response.statusCode=500;response.end(String(cause))}})))
      const waiter = Effect.runFork(Effect.forkIn(respond,scope))
      waiter.addObserver(exit=>{if(exit._tag==="Success")requestFibers.add(exit.value)})
    })
  })
  yield* Effect.addFinalizer(()=>Effect.promise(async()=>{
    server.closeAllConnections()
    const interrupted = await Promise.allSettled([...requestFibers].map(fiber=>Effect.runPromise(Fiber.interrupt(fiber))))
    await new Promise<void>(resolve=>server.close(()=>resolve()))
    const errors=interrupted.filter(r=>r.status==="rejected")
    if(errors.length)throw new AggregateError(errors,"host adapter cleanup")
  }))
  yield* Effect.promise(()=>new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(socket,resolve)}))
  yield* Effect.addFinalizer(()=>Effect.promise(closeAll))
  const first = yield* Effect.promise(()=>connect(socket))
  const initial = yield* Effect.promise(()=>call(first,"state"))
  expect(initial.runId).toBe(runId)
  expect(initial.publication.graph.snapshot.tasks).toHaveLength(1)
  const exact={runId,capacity:initial.policy.taskExecutionCapacity+1,expectedRevision:initial.policy.revision}
  const pending = call(first,"capacity",{...exact,hold:true}).then(()=>({rejected:false}),()=>({rejected:true}))
  yield* Deferred.await(commandEntered).pipe(Effect.timeout("20 seconds"))
  yield* Effect.promise(()=>close(first))
  expect((yield* Effect.promise(()=>pending)).rejected).toBe(true)
  expect(host.pollUnsafe()).toBeUndefined()
  expect((yield* bootstrap.operatorControl.readTaskWorkCapacity(runId)).revision).toBe(initial.policy.revision)
  yield* Deferred.succeed(releaseCommand,undefined)
  const applied = yield* Deferred.await(commandDone).pipe(Effect.timeout("20 seconds"))
  expect(applied).toMatchObject({ok:true,policy:{taskExecutionCapacity:exact.capacity,revision:initial.policy.revision+1}})
  const second=yield* Effect.promise(()=>connect(socket))
  const reattached=yield* Effect.promise(()=>call(second,"state"))
  expect(reattached.runId).toBe(runId)
  expect(reattached.policy.revision).toBe(initial.policy.revision+1)
  expect(reattached.publication.graph.snapshot.tasks).toHaveLength(1)
  const replay=yield* Effect.promise(()=>call(second,"capacity",exact))
  expect(replay.ok).toBe(false)
  expect(replay.error._tag).toBe("TaskWorkCapacityPolicyRevisionConflict")
  yield* Effect.promise(()=>close(second))
  yield* Deferred.succeed(releaseTurn,undefined)
  const termination=yield* observation.runTermination.await.pipe(Effect.timeout("40 seconds"))
  expect(termination.disposition).toBe("Completed")
  yield* Deferred.succeed(releaseHost,undefined)
  yield* Fiber.join(host).pipe(Effect.timeout("20 seconds"))
  const records=yield* Effect.scoped(Effect.gen(function*(){
    const context=yield* Layer.build(sqliteJournalStoreLayer({filename:fixture.configuration.journalDatabase}))
    return yield* Context.get(context,JournalStore).read(runId)
  }))
  expect(records.filter(r=>r.event._tag==="TaskWorkCapacityChanged")).toHaveLength(1)
  expect(records.filter(r=>r.event._tag==="WorkflowRunBegan")).toHaveLength(1)
  expect(records.some(r=>r.event._tag==="TargetPromotionObservedSuccess")).toBe(true)
  expect(records.some(({event})=>event._tag==="TaskTrackerFactsObserved"&&event.observation._tag==="FocusedTaskCompletionFacts"&&event.observation.purpose._tag==="Confirmation"&&event.observation.facts.lifecycle==="CompletedSuccessfully")).toBe(true)
  expect(yield* Ref.get(acquisitions)).toBe(1)
  expect(yield* Ref.get(exits)).toBe(0)
  expect(first.exitVerified&&second.exitVerified).toBe(true)
  console.log(JSON.stringify({sameRun:reattached.runId===runId,capacityRevision:reattached.policy.revision,capacityRecords:1,mcpChildren:2,childExitsVerified:true,coordinators:yield* Ref.get(acquisitions),applicationExitRequests:yield* Ref.get(exits),termination:termination.disposition}))
 })).pipe(Effect.provide(fixtureLayer)),90_000)
