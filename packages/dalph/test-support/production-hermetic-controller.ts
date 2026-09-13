/* eslint-disable import/no-nodejs-modules -- Qualification owns real built children and one scoped loopback provider server. */
import nodeProcess from "node:process"
import { createServer, type IncomingMessage, type Server } from "node:http"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import {
  Deferred,
  Effect,
  Fiber,
  FiberSet,
  FileSystem,
  HashSet,
  Match,
  MutableList,
  Option,
  Queue,
  Redacted,
  Ref,
  Schema,
  Stream
} from "effect"
import {
  authorizeHermeticFixture,
  BoundaryReached,
  HermeticFixtureResource,
  type HermeticFixtureCreationFacts,
  HermeticFixtureManifest
} from "../src/application/production-hermetic-contract.js"
import {
  HermeticCodexRequest,
  HermeticControllerEndpoint
} from "../src/application/production-hermetic-provider-bridge.js"
import type { ProductionCliRecord } from "../src/application/production-cli.js"
import {
  decodeProductionRepositoryHostConfiguration,
  type ProductionRepositoryHostConfiguration
} from "../src/application/production-configuration.js"
import { makeHermeticProviderState } from "./production-hermetic-provider-state.js"
import { makeHermeticChildOutput } from "./production-hermetic-child-output.js"

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
  readonly records: Queue.Queue<ProductionCliRecord>
  readonly recordLog: MutableList.MutableList<ProductionCliRecord>
  readonly stdout: Fiber.Fiber<void, unknown>
  readonly stderr: Fiber.Fiber<void, unknown>
}

export type HermeticControllerPause =
  | { readonly _tag: "Unpaused" }
  | { readonly _tag: "PauseAt"; readonly boundary: BoundaryReached["_tag"] }

class HermeticControllerFailure extends Schema.TaggedError<HermeticControllerFailure>()("HermeticControllerFailure", {
  operation: Schema.NonEmptyString
}) {}

const providerFailureHttpStatus = 500

const resourceBelongsToFixture = (fixture: HermeticControllerFixture, resource: HermeticFixtureResource) =>
  Match.valueTags(resource, {
    Repository: ({ locator }) => locator === fixture.manifest.repository,
    CommonDirectory: ({ locator }) => locator === fixture.manifest.commonDirectory,
    ConfigurationDocument: ({ locator }) => locator === fixture.configurationPath,
    ManifestDocument: ({ locator }) => locator === fixture.manifestPath,
    JournalDatabase: ({ locator }) => locator === fixture.manifest.journalDatabase,
    EvidenceRoot: ({ locator }) => locator === fixture.manifest.evidenceRoot,
    AttemptWorktreeRoot: ({ locator }) => locator === fixture.manifest.attemptWorktreeRoot,
    CodexStateDirectory: ({ locator }) => locator === fixture.manifest.codexStateDirectory,
    CandidateRoot: ({ locator }) => locator === fixture.manifest.candidateRoot,
    PrivateStore: ({ locator }) => locator === fixture.manifest.privateStore,
    OwnershipMarker: ({ locator }) => locator === fixture.manifest.ownershipMarker
  })

const resourceKey = (resource: HermeticFixtureResource) => `${resource._tag}:${resource.locator}`

const creationMatchesManifest = ({ creation, manifest }: HermeticControllerFixture) =>
  creation.invocationId === manifest.invocationId &&
  creation.repository === manifest.repository &&
  creation.commonDirectory === manifest.commonDirectory &&
  creation.ownershipMarker === manifest.ownershipMarker

/** A matching configuration never substitutes for the successful creation ledger. */
const validateCreationLedger = Effect.fn("HermeticController.validateCreation")(function* (
  fixture: HermeticControllerFixture
) {
  const creation = fixture.creation
  const resources = creation.createdResources
  const resourceKeys = HashSet.fromIterable(resources.map(resourceKey))
  const identityKeys = HashSet.fromIterable(fixture.identities.map(({ resource }) => resourceKey(resource)))
  if (!creationMatchesManifest(fixture) || resources.some((resource) => !resourceBelongsToFixture(fixture, resource))) {
    return yield* new HermeticControllerFailure({ operation: "fixture.foreignCreation" })
  }
  if (
    HashSet.size(resourceKeys) !== Object.keys(HermeticFixtureResource.cases).length ||
    HashSet.size(resourceKeys) !== resources.length ||
    HashSet.size(identityKeys) !== fixture.identities.length ||
    !HashSet.isSubset(resourceKeys, identityKeys) ||
    !HashSet.isSubset(identityKeys, resourceKeys)
  ) {
    return yield* new HermeticControllerFailure({ operation: "fixture.invalidCreationLedger" })
  }
})

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

/** Reads owning boundaries now; cached configuration and marker bytes cannot authorize a child. */
export const authorizeHermeticControllerFixture = Effect.fn("HermeticController.authorize")(function* (
  fixture: HermeticControllerFixture
) {
  yield* validateCreationLedger(fixture)
  const fs = yield* FileSystem.FileSystem
  const manifestDocument = yield* fs
    .readFileString(fixture.manifestPath)
    .pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(HermeticFixtureManifest))))
  if (!Schema.toEquivalence(HermeticFixtureManifest)(fixture.manifest, manifestDocument))
    return yield* new HermeticControllerFailure({ operation: "fixture.changedManifest" })
  const document = yield* fs
    .readFileString(fixture.configurationPath)
    .pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.Unknown))))
    )
  const c = yield* decodeProductionRepositoryHostConfiguration({
    ...document,
    target: fixture.configuration.target,
    githubToken: Redacted.value(fixture.configuration.githubToken),
    codexProviderCredential: Redacted.value(fixture.configuration.codexProviderCredential)
  })
  return yield* authorizeHermeticFixture(fixture.manifest, c)
})

/** One fixed provider fixture and its three concrete gates survive every child started by this controller. */
export const makeHermeticController = Effect.fn("HermeticController.make")(function* (
  fixture: HermeticControllerFixture,
  pause: HermeticControllerPause
) {
  yield* authorizeHermeticControllerFixture(fixture)
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const children = MutableList.make<HermeticPublicChild>()
  const childOutputs = new WeakMap<HermeticPublicChild, Effect.Success<ReturnType<typeof makeHermeticChildOutput>>>()
  const boundaries = yield* Queue.unbounded<BoundaryReached>()
  const boundaryLog = MutableList.make<BoundaryReached>()
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
  const provider = yield* makeHermeticProviderState(fixture.configuration, observeBoundary)
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
  const startChild = Effect.fn("HermeticController.startChild")(function* () {
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
            GIT_OPTIONAL_LOCKS: "0"
          }
        }
      )
    )
    const records = yield* Queue.unbounded<ProductionCliRecord>()
    const recordLog = MutableList.make<ProductionCliRecord>()
    const output = yield* makeHermeticChildOutput(handle, (record) =>
      Effect.sync(() => MutableList.append(recordLog, record)).pipe(Effect.andThen(Queue.offer(records, record)))
    )
    const stdout = yield* output.read().pipe(Effect.forkScoped)
    const stderr = yield* handle.stderr.pipe(Stream.runDrain, Effect.forkScoped)
    const child = { handle, records, recordLog, stdout, stderr } satisfies HermeticPublicChild
    childOutputs.set(child, output)
    MutableList.append(children, child)
    return child
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
  return {
    invocationId: fixture.manifest.invocationId,
    startChild,
    awaitBoundary,
    releaseBoundary: () => Deferred.succeed(release, undefined).pipe(Effect.asVoid),
    boundaryLog,
    providerSnapshot: provider.snapshot(),
    setCompletionResponse: provider.setCompletionResponse,
    activeRequestCount: FiberSet.size(requests),
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
        const exit = yield* output.kill()
        yield* Effect.all([Fiber.join(child.stdout), Fiber.join(child.stderr)])
        return exit
      }),
    awaitChild: (child: HermeticPublicChild) =>
      Effect.gen(function* () {
        const exit = yield* child.handle.exitCode
        yield* Effect.all([Fiber.join(child.stdout), Fiber.join(child.stderr)])
        return exit
      })
  }
})

export type HermeticController = Effect.Success<ReturnType<typeof makeHermeticController>>
