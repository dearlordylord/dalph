/* eslint-disable import/no-nodejs-modules -- Qualification owns real built children and one scoped loopback provider server. */
import nodeProcess from "node:process"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import {
  Deferred,
  Crypto,
  Effect,
  Fiber,
  FiberSet,
  FileSystem,
  Match,
  MutableList,
  Option,
  Queue,
  Ref,
  Schema,
  Stream
} from "effect"
import {
  BoundaryReached,
  HermeticRegistrationScopeId,
  type HermeticFixtureResource,
  type HermeticFixtureCreationFacts,
  HermeticFixtureManifest
} from "../src/application/production-hermetic-contract.js"
import {
  HermeticCodexRequest,
  HermeticControllerEndpoint,
  HermeticExpectedRecordRegistration
} from "../src/application/production-hermetic-provider-bridge.js"
import type { ProductionCliRecord } from "../src/application/production-cli.js"
import type { ProductionRepositoryHostConfiguration } from "../src/application/production-configuration.js"
import { authorizeHermeticControllerFixture } from "./production-hermetic-fixture-authorization.js"
import { makeHermeticProviderState } from "./production-hermetic-provider-state.js"
import {
  HermeticControllerFailure,
  type HermeticProcessOutcome,
  killedProcessOutcome,
  makeHermeticRecordBindings,
  settleHermeticChild
} from "./production-hermetic-child-lifetime.js"
import { makeHermeticChildOutput, validateQualificationRecordBinding } from "./production-hermetic-child-output.js"

export interface HermeticControllerFixture {
  readonly container: HermeticFixtureContainer
  readonly manifest: HermeticFixtureManifest
  readonly creation: HermeticFixtureCreationFacts
  readonly identities: ReadonlyArray<HermeticCreatedResourceIdentity>
  readonly configuration: ProductionRepositoryHostConfiguration
  readonly configurationPath: string
  readonly manifestPath: string
}

/** Locates the created Q container; unlike its exact resource children, it is never recursively removed. */
export const HermeticFixtureContainer = Schema.NonEmptyString.pipe(Schema.brand("HermeticFixtureContainer"))
export type HermeticFixtureContainer = typeof HermeticFixtureContainer.Type

/** An inode and device identify the actual created local object, not a reusable path. */
const HermeticFileDevice = Schema.Int.pipe(Schema.brand("HermeticFileDevice"))
/** Identifies the actual created inode on its separately recorded device. */
const HermeticFileInode = Schema.Int.pipe(Schema.brand("HermeticFileInode"))
export const HermeticFileIdentity = Schema.TaggedUnion({
  Known: {
    device: HermeticFileDevice,
    inode: HermeticFileInode,
    kind: Schema.Literals([
      "File",
      "Directory",
      "SymbolicLink",
      "BlockDevice",
      "CharacterDevice",
      "FIFO",
      "Socket",
      "Unknown"
    ])
  },
  Unavailable: {}
})
export type HermeticFileIdentity = typeof HermeticFileIdentity.Type

export interface HermeticCreatedResourceIdentity {
  readonly resource: HermeticFixtureResource
  readonly identity: HermeticFileIdentity
}

/** Captured after successful creation; a later stat must never refresh this receipt. */
export const readHermeticFileIdentity = Effect.fn("HermeticFixture.readIdentity")(function* (locator: string) {
  const fs = yield* FileSystem.FileSystem
  const stat = yield* fs.stat(locator)
  if (Option.isNone(stat.ino)) return HermeticFileIdentity.cases.Unavailable.make({})
  return HermeticFileIdentity.cases.Known.make({
    device: HermeticFileDevice.make(stat.dev),
    inode: HermeticFileInode.make(stat.ino.value),
    kind: stat.type
  })
})

/** A child process owns its public streams; these observations never authorize a provider retry. */
export interface HermeticPublicChild {
  readonly handle: ChildProcessSpawner.ChildProcessHandle
  readonly registrationScope: HermeticRegistrationScopeId
  readonly records: Queue.Queue<ProductionCliRecord>
  readonly recordLog: MutableList.MutableList<ProductionCliRecord>
  readonly stdout: Fiber.Fiber<void, unknown>
  readonly stderr: Fiber.Fiber<void, unknown>
  readonly stderrLog: MutableList.MutableList<Uint8Array>
}

export type HermeticControllerPause =
  | { readonly _tag: "Unpaused" }
  | { readonly _tag: "PauseAt"; readonly boundary: BoundaryReached["_tag"] }

const providerFailureHttpStatus = 500

const readBody = Effect.fn("HermeticController.readBody")(function* (request: IncomingMessage) {
  const text = yield* Effect.tryPromise({
    try: () =>
      new Promise<string>((resolve, reject) => {
        let body = ""
        request.setEncoding("utf8")
        request.on("data", (chunk: string) => {
          body += chunk
        })
        request.on("end", () => resolve(body))
        request.on("error", reject)
      }),
    catch: () => new HermeticControllerFailure({ operation: "request.read" })
  })
  return yield* Effect.try({
    try: () => JSON.parse(text),
    catch: () => new HermeticControllerFailure({ operation: "request.decode" })
  })
})

const closeServer = (server: Server) =>
  Effect.tryPromise({
    try: () =>
      new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve()
        server.closeAllConnections()
        server.close((failure) => (failure === undefined ? resolve() : reject(failure)))
      }),
    catch: () => new HermeticControllerFailure({ operation: "server.close" })
  })

/** One fixed provider fixture and its three concrete gates survive every child started by this controller. */
export const makeHermeticController = Effect.fn("HermeticController.make")(function* (
  fixture: HermeticControllerFixture,
  pause: HermeticControllerPause
) {
  yield* authorizeHermeticControllerFixture(fixture)
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const crypto = yield* Crypto.Crypto
  const children = MutableList.make<HermeticPublicChild>()
  const recordBindings = yield* makeHermeticRecordBindings()
  const childOutputs = new WeakMap<HermeticPublicChild, Effect.Success<ReturnType<typeof makeHermeticChildOutput>>>()
  const boundaries = yield* Queue.unbounded<BoundaryReached>()
  const boundaryLog = MutableList.make<BoundaryReached>()
  const processOutcomes = new Map<HermeticPublicChild, HermeticProcessOutcome>()
  const release = yield* Deferred.make<void>()
  const paused = yield* Ref.make(false)
  const observeBoundary = Effect.fn("HermeticController.observeBoundary")(function* (boundary: BoundaryReached) {
    MutableList.append(boundaryLog, boundary)
    yield* Queue.offer(boundaries, boundary)
    if (pause._tag === "PauseAt" && pause.boundary === boundary._tag && !(yield* Ref.getAndSet(paused, true))) {
      yield* Deferred.await(release)
    }
  })
  yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined).pipe(Effect.asVoid))
  const provider = yield* makeHermeticProviderState(
    fixture.configuration,
    observeBoundary,
    fixture.manifest.invocationId
  )
  const codexRequest = Effect.fn("HermeticController.codexRequest")(function* (input: unknown) {
    const request = yield* Schema.decodeUnknownEffect(HermeticCodexRequest)(input)
    return yield* Match.valueTags(request, {
      StartThread: (value) => provider.codex.startThread(value.cwd, value.ownedThreadToken),
      ReadThread: (value) => provider.codex.readThread(value.threadId),
      ResumeThread: (value) => provider.codex.resumeThread(value.threadId, value.cwd),
      StartTurn: (value) => provider.codex.startTurn(value.threadId, value.cwd, value.text, value.ownedTurnToken),
      InterruptTurn: (value) => provider.codex.interruptTurn(value.threadId, value.turnId).pipe(Effect.as({})),
      ListThreads: () =>
        provider.codex.listThreads?.() ??
        Effect.fail(new HermeticControllerFailure({ operation: "codex.listThreads" })),
      ListBackgroundTerminals: (value) => provider.codex.listBackgroundTerminals(value.threadId),
      TerminateBackgroundTerminal: (value) =>
        provider.codex.terminateBackgroundTerminal(value.threadId, value.processId),
      Close: () => provider.codex.close.pipe(Effect.as({}))
    })
  })
  const dispatch = Effect.fn("HermeticController.dispatch")(function* (request: IncomingMessage) {
    const body = yield* readBody(request)
    switch (request.url ?? "") {
      case "/github":
        return yield* provider.github(body)
      case "/codex":
        return { status: 200, body: yield* codexRequest(body) }
      case "/boundary": {
        const boundary = yield* Schema.decodeUnknownEffect(BoundaryReached)(body)
        yield* observeBoundary(boundary)
        return { status: 200, body: {} }
      }
      case "/expected-record": {
        const scope = yield* Schema.decodeUnknownEffect(HermeticRegistrationScopeId)(
          request.headers["x-dalph-registration-scope"],
          { reportInput: false }
        ).pipe(Effect.mapError(() => new HermeticControllerFailure({ operation: "record.foreignScope" })))
        const registration = yield* Schema.decodeUnknownEffect(HermeticExpectedRecordRegistration)(body, {
          reportInput: false,
          onExcessProperty: "error"
        }).pipe(Effect.mapError(() => new HermeticControllerFailure({ operation: "record.registration" })))
        yield* recordBindings.register(scope, registration)
        return { status: 200, body: {} }
      }
      default:
        return yield* new HermeticControllerFailure({ operation: "request.route" })
    }
  })
  const requests = yield* FiberSet.make()
  const runRequest = yield* FiberSet.runtimePromise(requests)<never>()
  const server = yield* Effect.acquireRelease(
    Effect.sync(() =>
      createServer((request, response) => {
        runRequest(dispatch(request)).then(
          (result) => {
            response.writeHead(result.status, { "content-type": "application/json" })
            response.end(JSON.stringify(result.body))
          },
          () => {
            response.writeHead(providerFailureHttpStatus)
            response.end("{}")
          }
        )
      })
    ),
    (value) => closeServer(value).pipe(Effect.orDie)
  )
  const endpoint = yield* Effect.tryPromise({
    try: () =>
      new Promise<HermeticControllerEndpoint>((resolve, reject) => {
        server.once("error", reject)
        server.listen(0, "127.0.0.1", () => {
          const address = server.address()
          if (address === null || typeof address === "string")
            return reject(new HermeticControllerFailure({ operation: "server.address" }))
          resolve(HermeticControllerEndpoint.make(`http://127.0.0.1:${address.port}`))
        })
      }),
    catch: () => new HermeticControllerFailure({ operation: "server.listen" })
  })
  const spawnOwnedChild = Effect.fn("HermeticController.spawnOwnedChild")(function* (
    registrationScope: HermeticRegistrationScopeId
  ) {
    if (!server.listening) return yield* new HermeticControllerFailure({ operation: "controller.disposed" })
    yield* authorizeHermeticControllerFixture(fixture)
    const target = fixture.configuration.target
    const handle = yield* spawner.spawn(
      ChildProcess.make(
        nodeProcess.execPath,
        [
          fixture.manifest.builtEntry,
          "run",
          `github:${target.owner}/${target.repository}#${target.issueNumber}`,
          "--production",
          "--config",
          fixture.configurationPath
        ],
        {
          env: {
            GITHUB_TOKEN: "controlled-hermetic-github-token",
            DALPH_CODEX_PROVIDER_CREDENTIAL: "controlled-hermetic-codex-credential",
            DALPH_HERMETIC_EXPECTED_MANIFEST: yield* Schema.encodeEffect(
              Schema.fromJsonString(HermeticFixtureManifest)
            )(fixture.manifest),
            DALPH_HERMETIC_CONTROLLER: endpoint,
            DALPH_HERMETIC_REGISTRATION_SCOPE: registrationScope,
            GIT_OPTIONAL_LOCKS: "0"
          }
        }
      )
    )
    yield* recordBindings.bind(registrationScope, handle)
    const records = yield* Queue.unbounded<ProductionCliRecord>()
    const recordLog = MutableList.make<ProductionCliRecord>()
    const output = yield* makeHermeticChildOutput(handle, (record) =>
      Effect.gen(function* () {
        yield* validateQualificationRecordBinding(record, yield* recordBindings.digestsFor(registrationScope, handle))
        MutableList.append(recordLog, record)
        yield* Queue.offer(records, record)
      })
    )
    const stdout = yield* output.read().pipe(Effect.forkScoped)
    const stderrLog = MutableList.make<Uint8Array>()
    const stderr = yield* handle.stderr.pipe(
      Stream.runForEach((bytes) => Effect.sync(() => MutableList.append(stderrLog, new Uint8Array(bytes)))),
      Effect.forkScoped
    )
    const child = {
      handle,
      registrationScope,
      records,
      recordLog,
      stdout,
      stderr,
      stderrLog
    } satisfies HermeticPublicChild
    childOutputs.set(child, output)
    MutableList.append(children, child)
    return child
  })
  const startChild = Effect.fn("HermeticController.startChild")(function* () {
    const scope = HermeticRegistrationScopeId.make(yield* crypto.randomUUIDv7)
    yield* recordBindings.begin(scope)
    return yield* spawnOwnedChild(scope).pipe(Effect.ensuring(recordBindings.end(scope)))
  })
  const awaitBoundary = Effect.fn("HermeticController.awaitBoundary")(function* (
    tag: BoundaryReached["_tag"],
    child: HermeticPublicChild
  ) {
    const observedBoundary = Effect.gen(function* () {
      for (;;) {
        const boundary = yield* Queue.take(boundaries)
        if (boundary._tag === tag) return boundary
      }
    })
    const exited = Effect.exit(child.handle.exitCode).pipe(
      Effect.andThen(Effect.all([Fiber.join(child.stdout), Fiber.join(child.stderr)])),
      Effect.andThen(new HermeticControllerFailure({ operation: "child.exitedBeforeBoundary" }))
    )
    return yield* Effect.raceFirst(observedBoundary, exited)
  })
  const forgetRecordBindings = (child: HermeticPublicChild) =>
    recordBindings.forget(child.registrationScope, child.handle)
  return {
    invocationId: fixture.manifest.invocationId,
    startChild,
    awaitBoundary,
    releaseBoundary: () => Deferred.succeed(release, undefined).pipe(Effect.asVoid),
    boundaryLog,
    processOutcomes: Effect.sync(() =>
      MutableList.toArray(children).flatMap((child) => {
        const outcome = processOutcomes.get(child)
        return outcome === undefined ? [] : [outcome]
      })
    ),
    providerSnapshot: provider.snapshot(),
    providerCreationManifest: provider.creationManifest,
    finalTrackerFacts: provider.finalTrackerFacts,
    githubCleanupAdapter: provider.cleanupAdapter,
    setCompletionResponse: provider.setCompletionResponse,
    setPublicTaskSpecification: provider.setPublicTaskSpecification,
    activeRequestCount: FiberSet.size(requests),
    activeRegistrationCount: recordBindings.count,
    stopTransport: closeServer(server).pipe(Effect.andThen(FiberSet.clear(requests))),
    selectedRunsCompleted: Effect.sync(() => {
      const owned = MutableList.toArray(children)
      const records = owned.flatMap((child) => MutableList.toArray(child.recordLog))
      const selected = records.flatMap((record) => (record._tag === "RunSelected" ? [record.runId] : []))
      const completed = records.flatMap((record) =>
        record._tag === "RunDisposition" && record.disposition === "Completed" ? [record.runId] : []
      )
      return owned.length === 0 || (selected.length > 0 && selected.every((runId) => completed.includes(runId)))
    }),
    ownedChildrenStopped: Effect.suspend(() =>
      Effect.forEach(MutableList.toArray(children), (child) => child.handle.isRunning)
    ).pipe(Effect.map((running) => running.every((active) => !active))),
    terminateChild: (child: HermeticPublicChild) => Effect.sync(() => nodeProcess.kill(child.handle.pid, "SIGTERM")),
    killChild: (child: HermeticPublicChild) =>
      Effect.gen(function* () {
        const output = childOutputs.get(child)
        if (output === undefined) return yield* new HermeticControllerFailure({ operation: "child.foreignKill" })
        return yield* settleHermeticChild(
          child,
          output.kill().pipe(
            Effect.flatMap((exit) => {
              const outcome = killedProcessOutcome(child.handle.pid, exit)
              return outcome === undefined
                ? Effect.fail(new HermeticControllerFailure({ operation: "child.unobservedKillOutcome" }))
                : Effect.succeed({ exit, outcome })
            })
          ),
          ({ outcome }) => processOutcomes.set(child, outcome),
          forgetRecordBindings(child)
        ).pipe(Effect.map(({ exit }) => exit))
      }),
    awaitChild: (child: HermeticPublicChild) =>
      settleHermeticChild(
        child,
        child.handle.exitCode,
        (status) => processOutcomes.set(child, { _tag: "Exit", processId: child.handle.pid, status }),
        forgetRecordBindings(child)
      )
  }
})

export type HermeticController = Effect.Success<ReturnType<typeof makeHermeticController>>
