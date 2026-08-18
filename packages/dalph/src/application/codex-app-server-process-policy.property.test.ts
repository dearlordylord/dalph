import { ApplicationExitDiagnostic, ApplicationExitDrainFailure } from "@dalph/orchestrator"
import { Cause, Effect, Exit } from "effect"
import * as fc from "fast-check"
import { describe, expect, it } from "vitest"
import {
  CodexAppServerFailure,
  CodexProcessStartIdentity,
  applicationServerCloseAfterExecutorDrains,
  appendDiscoveredProcessCandidate,
  awaitExactMembersAbsent,
  awaitOwnedGroupAbsent,
  collectOwnedProcessGroupMembers,
  closeHandleFailure,
  discoverAppServerProcesses,
  durableIncarnationToken,
  failAfterInitializationCleanup,
  failAfterClose,
  ignoreEffectFailure,
  incarnationWithProcessIdentity,
  isLinuxProcessDescendant,
  launchCommandFacts,
  launchExecutableMatches,
  makeNodeCodexProcessOwnershipService,
  makeNodeCodexOwnedActivityCensusService,
  makeNodeCodexProcessGroupCensusService,
  normalizeInitializeResponse,
  numericProcessId,
  processErrorCode,
  processGroupLeaderFailure,
  processIdentityFromIncarnation,
  processLaunchObservationFailure,
  processWasAbsent,
  preserveAppServerFailure,
  projectDiscoveredProcesses,
  signalExactDetachedDescendants,
  signalOwnedProcessGroup,
  stopOwnedAppServer,
  validateLaunchedProcessObservation,
  windowsProcessIdentity,
  type LinuxProcessStat
} from "./codex-app-server.js"
import {
  controlledCodexProcessNativeLayer,
  CodexProcessNative,
  nodeCodexProcessNativeService
} from "./codex-process-native.js"
import type { CodexProcessNativeService } from "./codex-process-native.js"
import {
  CodexAttemptStoreFailure,
  CodexServerIncarnation,
  CodexServerLaunchRecord,
  CodexThreadId
} from "./codex-attempt-store.js"

const stat = (pid: number, parentPid: number, processGroupId: number, identity: string): LinuxProcessStat => ({
  pid,
  parentPid,
  processGroupId,
  startIdentity: CodexProcessStartIdentity.make(identity)
})

const linuxStatText = (entry: LinuxProcessStat): string =>
  `${entry.pid} (fixture) ${[
    "S",
    String(entry.parentPid),
    String(entry.processGroupId),
    ...Array.from({ length: 16 }, () => "0"),
    entry.startIdentity.replace("linux:", "")
  ].join(" ")}`

const native = (overrides: Partial<CodexProcessNativeService> = {}): CodexProcessNativeService => ({
  platform: "linux",
  pid: 1,
  kill: () => undefined,
  readFile: async () => "",
  readdir: async () => [],
  execFile: async () => ({ stdout: "" }),
  wait: () => Effect.void,
  ...overrides
})

const withNative = <A>(service: CodexProcessNativeService, use: (native: CodexProcessNativeService) => A): A => {
  return Effect.runSync(
    Effect.gen(function* () {
      const selected = yield* CodexProcessNative
      return use(selected)
    }).pipe(Effect.provide(controlledCodexProcessNativeLayer(service)))
  )
}

describe("Codex process observation policy", () => {
  it("runs Node's native exec adapter on success and failure", async () => {
    await expect(nodeCodexProcessNativeService.execFile("/bin/sh", ["-c", "printf native-ok"])).resolves.toEqual({
      stdout: "native-ok"
    })
    await expect(nodeCodexProcessNativeService.execFile("/definitely-missing-dalph-command", [])).rejects.toBeDefined()
  })

  it("classifies native absence codes through direct and wrapped failures", () => {
    expect(processErrorCode(null)).toBe("")
    expect(processErrorCode("ESRCH")).toBe("")
    expect(processErrorCode({ code: "ENOENT" })).toBe("ENOENT")
    expect(processErrorCode({ cause: { code: "ESRCH" } })).toBe("ESRCH")
    expect(processErrorCode({ message: "no code" })).toBe("")
    expect(processWasAbsent({ code: "ENOENT" })).toBe(true)
    expect(processWasAbsent({ cause: { code: "ESRCH" } })).toBe(true)
    expect(processWasAbsent(new Error("native ESRCH failure"))).toBe(true)
    expect(processWasAbsent(new Error("permission denied"))).toBe(false)
  })

  it("separates durable launch tokens from exact process identities", () => {
    const plain = CodexServerIncarnation.make("plain-token")
    const exact = CodexServerIncarnation.make("plain-token|linux%3A123")
    expect(durableIncarnationToken(plain)).toBe(plain)
    expect(durableIncarnationToken(exact)).toBe("plain-token")
    expect(processIdentityFromIncarnation(exact)).toBe("linux:123")
    expect(processIdentityFromIncarnation(CodexServerIncarnation.make("plain-token"))).toBeUndefined()
    expect(processIdentityFromIncarnation(CodexServerIncarnation.make("|identity"))).toBeUndefined()
    expect(processIdentityFromIncarnation(CodexServerIncarnation.make("token|"))).toBeUndefined()
    expect(processIdentityFromIncarnation(CodexServerIncarnation.make("token|%E0%A4%A"))).toBeUndefined()
    expect(windowsProcessIdentity("  ")).toBeUndefined()
    expect(windowsProcessIdentity(" 123 ")).toBe("windows:123")
  })

  it("round-trips every generated durable token and encoded process identity", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,30}$/),
        fc.stringMatching(/^[a-z][a-z0-9:/. -]{0,30}$/),
        (token, identity) => {
          const incarnation = CodexServerIncarnation.make(`${token}|${encodeURIComponent(identity)}`)
          expect(durableIncarnationToken(incarnation)).toBe(token)
          expect(processIdentityFromIncarnation(incarnation)).toBe(identity)
        }
      ),
      { numRuns: 100 }
    )
  })

  it("walks only complete, acyclic process ancestry", () => {
    const root = stat(10, 1, 10, "root")
    const child = stat(11, 10, 11, "child")
    const grandchild = stat(12, 11, 12, "grandchild")
    const missingParent = stat(13, 99, 13, "missing")
    const cycleA = stat(14, 15, 14, "cycle-a")
    const cycleB = stat(15, 14, 15, "cycle-b")
    const byPid = new Map([root, child, grandchild, missingParent, cycleA, cycleB].map((entry) => [entry.pid, entry]))
    expect(isLinuxProcessDescendant(root.pid, byPid, child)).toBe(true)
    expect(isLinuxProcessDescendant(root.pid, byPid, grandchild)).toBe(true)
    expect(isLinuxProcessDescendant(root.pid, byPid, root)).toBe(false)
    expect(isLinuxProcessDescendant(root.pid, byPid, missingParent)).toBe(false)
    expect(isLinuxProcessDescendant(root.pid, byPid, cycleA)).toBe(false)
  })

  it("projects exact detached process-group membership", () => {
    const root = stat(20, 1, 20, "expected")
    expect(processGroupLeaderFailure(undefined, 20, "expected")).toBeUndefined()
    expect(processGroupLeaderFailure(root, 20, "expected")).toBeUndefined()
    expect(
      processGroupLeaderFailure({ ...root, startIdentity: CodexProcessStartIdentity.make("foreign") }, 20, "expected")
    ).toBe("owned process group leader incarnation changed")
    expect(processGroupLeaderFailure({ ...root, processGroupId: 21 }, 20, "expected")).toBe(
      "owned app-server is not its detached process-group leader"
    )

    expect(collectOwnedProcessGroupMembers(20, "expected", new Map())).toEqual({ _tag: "Absent" })
    const sameGroup = stat(21, 1, 20, "same-group")
    expect(collectOwnedProcessGroupMembers(20, "expected", new Map([[21, sameGroup]]))).toEqual({
      _tag: "ExactLive",
      members: [sameGroup]
    })
    const child = stat(22, 20, 22, "child")
    const unrelated = stat(23, 1, 23, "unrelated")
    expect(
      collectOwnedProcessGroupMembers(
        20,
        "expected",
        new Map([
          [20, root],
          [22, child],
          [23, unrelated]
        ])
      )
    ).toEqual({ _tag: "ExactLive", members: [root, child] })
  })

  it("bounds group and exact-member disappearance checks", async () => {
    const launch = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("group|linux%3Aexpected"),
      phase: "Live",
      pid: 20
    })
    const observed = (
      projection:
        | { readonly _tag: "Absent" }
        | { readonly _tag: "ExactLive"; readonly members: ReadonlyArray<LinuxProcessStat> }
        | { readonly _tag: "Unreadable"; readonly detail: string }
        | { readonly _tag: "Contradictory"; readonly detail: string }
    ) => ({ observe: () => Effect.succeed(projection) })
    expect(
      Exit.isSuccess(await Effect.runPromiseExit(awaitOwnedGroupAbsent(observed({ _tag: "Absent" }), launch, 0)))
    ).toBe(true)
    for (const projection of [
      { _tag: "Unreadable" as const, detail: "unreadable group" },
      { _tag: "Contradictory" as const, detail: "changed group" },
      { _tag: "ExactLive" as const, members: [] }
    ]) {
      expect(Exit.isFailure(await Effect.runPromiseExit(awaitOwnedGroupAbsent(observed(projection), launch, 0)))).toBe(
        true
      )
    }
    let groupReads = 0
    const eventuallyAbsent = {
      observe: () =>
        Effect.sync(() => {
          groupReads += 1
          return groupReads === 1 ? { _tag: "ExactLive" as const, members: [] } : { _tag: "Absent" as const }
        })
    }
    expect(Exit.isSuccess(await Effect.runPromiseExit(awaitOwnedGroupAbsent(eventuallyAbsent, launch, 1)))).toBe(true)

    const member = stat(24, 20, 24, "linux:member")
    const readCases: ReadonlyArray<{ readonly result: string | Error; readonly failure: boolean }> = [
      { result: Object.assign(new Error("gone"), { code: "ESRCH" }), failure: false },
      { result: Object.assign(new Error("I/O"), { code: "EIO" }), failure: true },
      { result: "malformed", failure: true },
      {
        result: linuxStatText({ ...member, startIdentity: CodexProcessStartIdentity.make("linux:changed") }),
        failure: true
      },
      { result: linuxStatText(member), failure: true }
    ]
    for (const { failure, result } of readCases) {
      const selected = native({
        readFile: async () => {
          if (result instanceof Error) throw result
          return result
        }
      })
      const outcome = await Effect.runPromiseExit(
        awaitExactMembersAbsent(
          [member],
          0,
          withNative(selected, (value) => value)
        )
      )
      expect(Exit.isFailure(outcome)).toBe(failure)
    }
    let exactReads = 0
    const selected = native({
      readFile: async () => {
        exactReads += 1
        if (exactReads === 1) return linuxStatText(member)
        throw Object.assign(new Error("gone"), { code: "ESRCH" })
      }
    })
    expect(
      Exit.isSuccess(
        await Effect.runPromiseExit(
          awaitExactMembersAbsent(
            [member],
            1,
            withNative(selected, (value) => value)
          )
        )
      )
    ).toBe(true)
  })

  it("maps unexpected native census failures to typed ownership failures", async () => {
    const launch = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("census|linux%3Aexpected"),
      phase: "Live",
      pid: 40
    })
    const unavailableNative = native({
      readdir: async () => {
        throw new Error("procfs unavailable")
      }
    })
    const selectedNative = withNative(unavailableNative, (value) => value)
    const activityCensus = makeNodeCodexOwnedActivityCensusService(selectedNative)
    const groupCensus = makeNodeCodexProcessGroupCensusService(selectedNative)
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(
          activityCensus.observe(
            { cwd: "/worktree", id: CodexThreadId.make("census-thread"), status: "idle", turns: [] },
            [{ command: "work", cwd: "/worktree", itemId: "item", osPid: 40, processId: "process" }]
          )
        )
      )
    ).toBe(true)
    expect(Exit.isFailure(await Effect.runPromiseExit(groupCensus.observe(launch)))).toBe(true)
    const ownership = makeNodeCodexProcessOwnershipService(groupCensus, selectedNative)
    expect(Exit.isFailure(await Effect.runPromiseExit(ownership.discover(launch.incarnation)))).toBe(true)

    const throwingMember = new Proxy(stat(41, 40, 41, "linux:member"), {
      get: (target, property, receiver) => {
        // eslint-disable-next-line functional/no-throw-statements -- the proxy emulates a malformed native observation.
        if (property === "pid") throw new Error("invalid member")
        return Reflect.get(target, property, receiver)
      }
    })
    expect(Exit.isFailure(await Effect.runPromiseExit(activityCensus.terminateDescendants([throwingMember])))).toBe(
      true
    )
    expect(
      Exit.isFailure(await Effect.runPromiseExit(awaitExactMembersAbsent([throwingMember], 0, selectedNative)))
    ).toBe(true)
    const malformedIdentity = {
      ...stat(42, 40, 42, "linux:escaped"),
      get startIdentity(): CodexProcessStartIdentity {
        // eslint-disable-next-line functional/no-throw-statements -- the getter emulates a malformed native observation.
        throw new Error("invalid identity")
      }
    }
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(
          signalExactDetachedDescendants(launch, { _tag: "ExactLive", members: [malformedIdentity] }, selectedNative)
        )
      )
    ).toBe(true)
  })

  it("classifies platform-specific identity, handshake, census, and discovery boundaries", async () => {
    const launch = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("platform|linux%3Aexpected"),
      phase: "Live",
      pid: 60
    })
    const initialize = { codexHome: "/codex", platformFamily: "unix", platformOs: "linux", userAgent: "codex" }
    const linuxNative = native({ readFile: async () => linuxStatText(stat(60, 1, 60, "linux:expected")) })
    expect(
      await incarnationWithProcessIdentity(
        CodexServerIncarnation.make("platform"),
        60,
        withNative(linuxNative, (value) => value)
      )
    ).toBe("platform|linux%3Aexpected")
    expect(
      await validateLaunchedProcessObservation(
        launch,
        60,
        { expectedExecutable: "codex", expectedMode: "app-server" },
        ["/usr/bin/codex", "app-server"],
        withNative(linuxNative, (value) => value)
      )
    ).toEqual({ _tag: "ExactLive", pid: 60 })

    const malformedNative = native({ readFile: async () => "malformed" })
    expect(
      await incarnationWithProcessIdentity(
        CodexServerIncarnation.make("platform"),
        60,
        withNative(malformedNative, (value) => value)
      )
    ).toBeUndefined()

    const darwinNative = native({ platform: "darwin" })
    expect(
      await incarnationWithProcessIdentity(
        CodexServerIncarnation.make("platform"),
        60,
        withNative(darwinNative, (value) => value)
      )
    ).toBeUndefined()
    expect(
      await validateLaunchedProcessObservation(
        launch,
        60,
        { expectedExecutable: "codex", expectedMode: "app-server" },
        ["codex", "app-server"],
        withNative(darwinNative, (value) => value)
      )
    ).toMatchObject({ _tag: "Unreadable" })
    expect(
      normalizeInitializeResponse(
        { ...initialize, platformOs: "macos" },
        withNative(darwinNative, (value) => value)
      )
    ).toBe(true)
    expect(
      normalizeInitializeResponse(
        initialize,
        withNative(darwinNative, (value) => value)
      )
    ).toBeInstanceOf(CodexAppServerFailure)
    expect(
      normalizeInitializeResponse(
        { ...initialize, platformFamily: "windows", platformOs: "macos" },
        withNative(darwinNative, (value) => value)
      )
    ).toBeInstanceOf(CodexAppServerFailure)
    const darwinGroup = makeNodeCodexProcessGroupCensusService(withNative(darwinNative, (value) => value))
    expect(await Effect.runPromise(darwinGroup.observe(launch))).toMatchObject({ _tag: "Unreadable" })
    expect(
      await discoverAppServerProcesses(
        launch.incarnation,
        withNative(darwinNative, (value) => value)
      )
    ).toMatchObject({ _tag: "Unreadable" })
    expect(
      await Effect.runPromise(
        makeNodeCodexProcessOwnershipService(
          darwinGroup,
          withNative(darwinNative, (value) => value)
        ).observe({ ...launch, phase: "Launching", pid: null })
      )
    ).toMatchObject({ _tag: "Unreadable" })

    const windowsNative = native({
      platform: "win32",
      execFile: async () => {
        throw new Error("powershell unavailable")
      }
    })
    expect(
      normalizeInitializeResponse(
        { ...initialize, platformFamily: "windows", platformOs: "windows" },
        withNative(windowsNative, (value) => value)
      )
    ).toBe(true)
    await expect(
      incarnationWithProcessIdentity(
        CodexServerIncarnation.make("platform"),
        60,
        withNative(windowsNative, (value) => value)
      )
    ).rejects.toBeDefined()

    const noPidLaunch = { ...launch, phase: "Launching" as const, pid: null }
    const linuxGroup = makeNodeCodexProcessGroupCensusService(withNative(linuxNative, (value) => value))
    expect(await Effect.runPromise(linuxGroup.observe(noPidLaunch))).toMatchObject({ _tag: "Unreadable" })
    expect(
      await Effect.runPromise(
        linuxGroup.observe({ ...launch, incarnation: CodexServerIncarnation.make("without-process-identity") })
      )
    ).toMatchObject({ _tag: "Unreadable" })
    const unreadableNative = native({
      readdir: async () => ["60"],
      readFile: async () => {
        throw Object.assign(new Error("stat unreadable"), { code: "EIO" })
      }
    })
    const unreadableGroup = makeNodeCodexProcessGroupCensusService(withNative(unreadableNative, (value) => value))
    expect(await Effect.runPromise(unreadableGroup.observe(launch))).toMatchObject({ _tag: "Unreadable" })
    const exactNative = native({
      readdir: async () => ["60"],
      readFile: async () => linuxStatText(stat(60, 1, 60, "linux:expected"))
    })
    const exactGroup = makeNodeCodexProcessGroupCensusService(withNative(exactNative, (value) => value))
    expect(await Effect.runPromise(exactGroup.observe(launch))).toMatchObject({
      _tag: "ExactLive",
      members: [expect.objectContaining({ pid: 60 })]
    })
  })

  it("rejects every non-exact launch observation before authorizing a signal", async () => {
    const launch = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("stop|linux%3Aexpected"),
      phase: "Live",
      pid: 70
    })
    const service = (
      projection:
        | { readonly _tag: "Absent" }
        | { readonly _tag: "ExactLive" }
        | { readonly _tag: "Contradictory"; readonly detail: string }
    ) => {
      const observation = projection._tag === "ExactLive" ? { _tag: "ExactLive" as const, pid: 70 } : projection
      return {
        discover: () => Effect.succeed({ _tag: "Absent" as const }),
        observe: () => Effect.succeed(observation),
        stop: () => Effect.void
      }
    }
    const group = (
      projection: { readonly _tag: "Absent" } | { readonly _tag: "Contradictory"; readonly detail: string }
    ) => ({ observe: () => Effect.succeed(projection) })
    expect(
      Exit.isSuccess(
        await Effect.runPromiseExit(
          stopOwnedAppServer(service({ _tag: "Absent" }), group({ _tag: "Absent" }), {
            ...launch,
            phase: "Launching",
            pid: null
          })
        )
      )
    ).toBe(true)
    expect(
      Exit.isSuccess(
        await Effect.runPromiseExit(stopOwnedAppServer(service({ _tag: "Absent" }), group({ _tag: "Absent" }), launch))
      )
    ).toBe(true)
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(
          stopOwnedAppServer(service({ _tag: "Contradictory", detail: "changed" }), group({ _tag: "Absent" }), launch)
        )
      )
    ).toBe(true)
    expect(
      Exit.isFailure(
        await Effect.runPromiseExit(
          stopOwnedAppServer(
            service({ _tag: "ExactLive" }),
            group({ _tag: "Contradictory", detail: "changed" }),
            launch
          )
        )
      )
    ).toBe(true)

    let signals = 0
    const selectedNative = withNative(
      native({
        kill: () => {
          signals += 1
        }
      }),
      (value) => value
    )
    expect(
      Exit.isSuccess(
        await Effect.runPromiseExit(
          stopOwnedAppServer(service({ _tag: "ExactLive" }), group({ _tag: "Absent" }), launch, selectedNative)
        )
      )
    ).toBe(true)
    expect(
      Exit.isSuccess(
        await Effect.runPromiseExit(
          stopOwnedAppServer(
            service({ _tag: "ExactLive" }),
            { observe: () => Effect.succeed({ _tag: "ExactLive" as const, members: [] }) },
            launch,
            selectedNative
          )
        )
      )
    ).toBe(true)
    expect(signals).toBe(2)
  })

  it("preserves already typed app-server failures and wraps foreign failures", () => {
    const typed = new CodexAppServerFailure({ detail: "typed", kind: "Ownership", operation: "close" })
    expect(preserveAppServerFailure("close", "Ownership")(typed)).toBe(typed)
    expect(preserveAppServerFailure("close", "Ownership")(new Error("foreign"))).toMatchObject({
      detail: "Error: foreign",
      kind: "Ownership",
      operation: "close"
    })
    expect(closeHandleFailure(typed)).toBe(typed)
    expect(
      closeHandleFailure(new CodexAttemptStoreFailure({ detail: "store", operation: "clearServerLaunch" }))
    ).toMatchObject({ kind: "Ownership", operation: "close" })
    expect(closeHandleFailure(new Error("transport"))).toMatchObject({ kind: "Unavailable", operation: "close" })
  })

  it("preserves the initiating failure unless process cleanup also fails", async () => {
    const initiating = new CodexAppServerFailure({
      detail: "identity failed",
      kind: "Ownership",
      operation: "initialize"
    })
    const cleaned = await Effect.runPromiseExit(failAfterInitializationCleanup(Effect.void, "process", initiating))
    const cleanupFailed = await Effect.runPromiseExit(
      failAfterInitializationCleanup(Effect.fail("signal failed"), "process", initiating)
    )
    expect(cleaned).toMatchObject({ _tag: "Failure" })
    expect(cleanupFailed).toMatchObject({ _tag: "Failure" })
    if (Exit.isFailure(cleanupFailed)) {
      const failure = cleanupFailed.cause.reasons.find(Cause.isFailReason)
      expect(failure?.error).toMatchObject({ detail: expect.stringContaining("process cleanup failed") })
    }
    expect(await Effect.runPromise(ignoreEffectFailure())).toBeUndefined()
    const storeFailure = new CodexAttemptStoreFailure({ detail: "persist failed", operation: "writeServerLaunch" })
    expect(Exit.isFailure(await Effect.runPromiseExit(failAfterClose(Effect.void, storeFailure)))).toBe(true)
    expect(Exit.isFailure(await Effect.runPromiseExit(failAfterClose(Effect.fail(initiating), storeFailure)))).toBe(
      true
    )
  })

  it("combines executor-drain and app-server-close outcomes without dropping either failure", async () => {
    const executorFailure = new ApplicationExitDrainFailure({
      diagnostics: [ApplicationExitDiagnostic.make("executor failed")]
    })
    const closeFailure = new CodexAppServerFailure({ detail: "close failed", kind: "Ownership", operation: "close" })
    const cases = [
      applicationServerCloseAfterExecutorDrains(Effect.void, Effect.void),
      applicationServerCloseAfterExecutorDrains(Effect.fail(executorFailure), Effect.void),
      applicationServerCloseAfterExecutorDrains(Effect.void, Effect.fail(closeFailure)),
      applicationServerCloseAfterExecutorDrains(Effect.fail(executorFailure), Effect.fail(closeFailure))
    ]
    const outcomes = await Promise.all(cases.map((effect) => Effect.runPromiseExit(effect)))
    expect(outcomes.map(Exit.isFailure)).toEqual([false, true, true, true])
  })

  it("signals Unix and Windows process groups through typed outcomes", async () => {
    for (const failure of [undefined, Object.assign(new Error("gone"), { code: "ESRCH" }), new Error("denied")]) {
      const selectedNative = withNative(
        native({
          kill: () => {
            // eslint-disable-next-line functional/no-throw-statements -- the controlled signal boundary emits the selected native failure.
            if (failure !== undefined) throw failure
          }
        }),
        (value) => value
      )
      const outcome = await Effect.runPromiseExit(signalOwnedProcessGroup(50, selectedNative))
      expect(Exit.isFailure(outcome)).toBe(failure instanceof Error && !processWasAbsent(failure))
    }
    const windowsNative = withNative(native({ platform: "win32" }), (value) => value)
    const windowsOutcome = await Effect.runPromiseExit(signalOwnedProcessGroup(50, windowsNative))
    expect(Exit.isSuccess(windowsOutcome) || Exit.isFailure(windowsOutcome)).toBe(true)
  })

  it("signals only an escaped descendant whose exact identity is freshly reread", async () => {
    const launch = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("group|linux%3Aexpected"),
      phase: "Live",
      pid: 30
    })
    const leader = stat(30, 1, 30, "linux:expected")
    const escaped = stat(31, 30, 31, "linux:escaped")
    const linuxNative = withNative(native(), (value) => value)
    expect(
      Exit.isSuccess(
        await Effect.runPromiseExit(
          signalExactDetachedDescendants(launch, { _tag: "ExactLive", members: [leader] }, linuxNative)
        )
      )
    ).toBe(true)

    expect(
      Exit.isSuccess(
        await Effect.runPromiseExit(
          signalExactDetachedDescendants(
            launch,
            { _tag: "ExactLive", members: [leader, escaped] },
            withNative(native({ platform: "darwin" }), (value) => value)
          )
        )
      )
    ).toBe(true)
    expect(
      Exit.isSuccess(
        await Effect.runPromiseExit(
          signalExactDetachedDescendants(
            { ...launch, phase: "Launching", pid: null },
            { _tag: "ExactLive", members: [escaped] },
            linuxNative
          )
        )
      )
    ).toBe(true)

    let reads = 0
    let signaled = 0
    const successfulNative = withNative(
      native({
        readFile: async () => {
          reads += 1
          if (reads === 1) return linuxStatText(escaped)
          throw Object.assign(new Error("gone"), { code: "ESRCH" })
        },
        kill: () => {
          signaled += 1
        }
      }),
      (value) => value
    )
    const outcome = await Effect.runPromiseExit(
      signalExactDetachedDescendants(launch, { _tag: "ExactLive", members: [leader, escaped] }, successfulNative)
    )
    expect(Exit.isSuccess(outcome)).toBe(true)
    expect(signaled).toBe(1)

    const failureCases: ReadonlyArray<{
      readonly firstRead: string | Error
      readonly killError?: Error
      readonly shouldFail: boolean
    }> = [
      { firstRead: Object.assign(new Error("gone"), { code: "ESRCH" }), shouldFail: false },
      { firstRead: Object.assign(new Error("I/O"), { code: "EIO" }), shouldFail: true },
      { firstRead: "malformed", shouldFail: true },
      {
        firstRead: linuxStatText({ ...escaped, startIdentity: CodexProcessStartIdentity.make("linux:changed") }),
        shouldFail: true
      },
      {
        firstRead: linuxStatText(escaped),
        killError: Object.assign(new Error("gone"), { code: "ESRCH" }),
        shouldFail: false
      },
      { firstRead: linuxStatText(escaped), killError: new Error("signal denied"), shouldFail: true }
    ]
    for (const { firstRead, killError, shouldFail } of failureCases) {
      let caseReads = 0
      const caseNative = withNative(
        native({
          readFile: async () => {
            caseReads += 1
            if (caseReads > 1) throw Object.assign(new Error("gone"), { code: "ESRCH" })
            if (firstRead instanceof Error) throw firstRead
            return firstRead
          },
          kill: () => {
            // eslint-disable-next-line functional/no-throw-statements -- the controlled signal boundary emits the selected native failure.
            if (killError !== undefined) throw killError
          }
        }),
        (value) => value
      )
      const result = await Effect.runPromiseExit(
        signalExactDetachedDescendants(launch, { _tag: "ExactLive", members: [leader, escaped] }, caseNative)
      )
      expect(Exit.isFailure(result)).toBe(shouldFail)
    }
  })

  it("validates launch command identity without assuming an absolute executable", () => {
    const complete = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("launch|linux%3A1"),
      phase: "Live",
      pid: 1
    })
    expect(launchCommandFacts(complete)).toEqual({ expectedExecutable: "codex", expectedMode: "app-server" })
    expect(launchCommandFacts({ ...complete, command: [] })).toMatchObject({ _tag: "Unreadable" })
    expect(launchCommandFacts({ ...complete, command: ["codex", "wrong-mode"] })).toMatchObject({ _tag: "Unreadable" })
    expect(launchExecutableMatches("codex", ["/usr/local/bin/codex", "app-server"])).toBe(true)
    expect(launchExecutableMatches("codex", ["/usr/local/bin/other", "app-server"])).toBe(false)
    expect(launchExecutableMatches("/opt/codex", ["/opt/codex", "app-server"])).toBe(true)
    expect(launchExecutableMatches("relative/codex", ["/elsewhere/codex", "app-server"])).toBe(false)

    expect(
      launchCommandFacts(
        complete,
        withNative(native({ platform: "darwin" }), (value) => value)
      )
    ).toMatchObject({ _tag: "Unreadable" })
  })

  it("projects process ids, discovery candidates, and observation failures exhaustively", () => {
    expect(numericProcessId("42")).toBe(42)
    expect(numericProcessId("self")).toBeUndefined()
    expect(numericProcessId("0")).toBeUndefined()
    expect(numericProcessId("999999999999999999999")).toBeUndefined()

    const identity = CodexProcessStartIdentity.make("linux:42")
    const exact: Array<{ readonly pid: number; readonly processIdentity: CodexProcessStartIdentity }> = []
    const foreign: Array<string> = []
    appendDiscoveredProcessCandidate({ _tag: "Skip" }, exact, foreign)
    appendDiscoveredProcessCandidate({ _tag: "Unreadable", detail: "unreadable" }, exact, foreign)
    appendDiscoveredProcessCandidate({ _tag: "Exact", pid: 42, processIdentity: identity }, exact, foreign)
    appendDiscoveredProcessCandidate({ _tag: "Foreign", detail: "foreign token" }, exact, foreign)
    expect(exact).toEqual([{ pid: 42, processIdentity: identity }])
    expect(foreign).toEqual(["foreign token"])

    expect(projectDiscoveredProcesses([], [])).toEqual({ _tag: "Absent" })
    expect(projectDiscoveredProcesses([], ["foreign"])).toEqual({ _tag: "Contradictory", detail: "foreign" })
    expect(projectDiscoveredProcesses(exact, [])).toEqual({ _tag: "ExactLive", pid: 42, processIdentity: identity })
    expect(projectDiscoveredProcesses(exact, foreign)).toEqual({ _tag: "Contradictory", detail: "foreign token" })
    expect(projectDiscoveredProcesses([...exact, ...exact], [])).toMatchObject({ _tag: "Contradictory" })
    expect(processLaunchObservationFailure({ code: "ESRCH" }, 42)).toEqual({ _tag: "Absent" })
    expect(processLaunchObservationFailure(new Error("permission denied"), 42)).toMatchObject({ _tag: "Unreadable" })
  })

  it("accepts every generated positive safe process id without changing it", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: Number.MAX_SAFE_INTEGER }), (pid) => {
        expect(numericProcessId(String(pid))).toBe(pid)
      }),
      { numRuns: 100 }
    )
  })
})
