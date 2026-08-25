import { ApplicationExitDiagnostic, ApplicationExitDrainFailure } from "@dalph/orchestrator"
import { Cause, Effect, Exit, Option } from "effect"
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
  linuxProcessEffectiveUid,
  makeNodeCodexProcessOwnershipService,
  makeNodeCodexOwnedActivityCensusService,
  makeNodeCodexProcessGroupCensusService,
  normalizeInitializeResponse,
  numericProcessId,
  observeLeaseOwner,
  processErrorCode,
  processGroupLeaderFailure,
  processIdentityFromIncarnation,
  processLaunchObservationFailure,
  processWasAbsent,
  preserveAppServerFailure,
  projectDiscoveredProcesses,
  reconcileLaunchingPriorServer,
  reconcilePriorTokenOwnedActivities,
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
  CodexProcessIdentity,
  CodexServerIncarnation,
  CodexServerLeaseIncarnation,
  CodexServerLeaseRecord,
  CodexServerLaunchRecord,
  CodexThreadId,
  type CodexAttemptStoreService
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

  it("stops an escaped exact-token child before replacement after its prior leader is absent", async () => {
    const prior = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("prior-token|linux%3Aprior"),
      phase: "Live",
      pid: 50
    })
    let childLive = true
    let childSignals = 0
    const selectedNative = native({
      readdir: async () => (childLive ? ["100"] : []),
      readFile: async (path) => {
        if (!childLive) throw Object.assign(new Error("gone"), { code: "ESRCH" })
        if (path.endsWith("/stat")) return linuxStatText(stat(100, 1, 100, "linux:child"))
        if (path.endsWith("/environ")) return "DALPH_CODEX_SERVER_INCARNATION=prior-token\u0000"
        if (path.endsWith("/cmdline")) return "/bin/sh\u0000-c\u0000work\u0000"
        throw new Error(`unexpected process path ${path}`)
      },
      kill: (pid, signal) => {
        if (pid === 100 && signal === "SIGTERM") {
          childSignals += 1
          childLive = false
        }
      }
    })
    expect(Exit.isSuccess(await Effect.runPromiseExit(reconcilePriorTokenOwnedActivities(prior, selectedNative)))).toBe(
      true
    )
    expect(childSignals).toBe(1)
    expect(childLive).toBe(false)
  })

  it("does not clear a Launching intent until its escaped token child is absent", async () => {
    const prior = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("launching-token"),
      phase: "Launching",
      pid: null
    })
    let childLive = true
    let clearedAfterAbsence = false
    const selectedNative = native({
      readdir: async () => (childLive ? ["100"] : []),
      readFile: async (path) => {
        if (!childLive) throw Object.assign(new Error("gone"), { code: "ESRCH" })
        if (path.endsWith("/stat")) return linuxStatText(stat(100, 1, 100, "linux:child"))
        if (path.endsWith("/environ")) return "DALPH_CODEX_SERVER_INCARNATION=launching-token\u0000"
        if (path.endsWith("/cmdline")) return "/bin/sh\u0000-c\u0000work\u0000"
        throw new Error(`unexpected process path ${path}`)
      },
      kill: (pid, signal) => {
        if (pid === 100 && signal === "SIGTERM") childLive = false
      }
    })
    const store: CodexAttemptStoreService = {
      readAttempt: () => Effect.succeed(Option.none()),
      writeAttempt: () => Effect.void,
      readReplacementLedger: () => Effect.succeed(Option.none()),
      appendReplacementLedger: () => Effect.void,
      readServerLaunch: () => Effect.succeed(Option.some(prior)),
      writeServerLaunch: () => Effect.void,
      clearServerLaunch: () =>
        Effect.sync(() => {
          clearedAfterAbsence = !childLive
        }),
      acquireServerLease: () => Effect.void,
      releaseServerLease: () => Effect.void
    }
    const ownership = {
      observe: () => Effect.succeed({ _tag: "Absent" as const }),
      discover: () => Effect.succeed({ _tag: "Absent" as const }),
      stop: () => Effect.void
    }
    expect(
      Exit.isSuccess(
        await Effect.runPromiseExit(reconcileLaunchingPriorServer(store, ownership, prior, selectedNative))
      )
    ).toBe(true)
    expect(childLive).toBe(false)
    expect(clearedAfterAbsence).toBe(true)
  })

  it("repeats the durable-token census until a later token child is also absent", async () => {
    const prior = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("recensus-token|linux%3Aprior"),
      phase: "Live",
      pid: 50
    })
    const livePids = new Set([100])
    const signals: Array<number> = []
    const selectedNative = native({
      readdir: async () => [...livePids].map(String),
      readFile: async (path) => {
        const pid = Number(/^\/proc\/(\d+)\//.exec(path)?.[1])
        if (!livePids.has(pid)) throw Object.assign(new Error("gone"), { code: "ESRCH" })
        if (path.endsWith("/stat")) return linuxStatText(stat(pid, 1, pid, `linux:child-${pid}`))
        if (path.endsWith("/environ")) return "DALPH_CODEX_SERVER_INCARNATION=recensus-token\u0000"
        if (path.endsWith("/cmdline")) return "/bin/sh\u0000-c\u0000work\u0000"
        throw new Error(`unexpected process path ${path}`)
      },
      kill: (pid, signal) => {
        if (signal !== "SIGTERM" || !livePids.has(pid)) return
        signals.push(pid)
        livePids.delete(pid)
        if (pid === 100) livePids.add(101)
      }
    })
    expect(Exit.isSuccess(await Effect.runPromiseExit(reconcilePriorTokenOwnedActivities(prior, selectedNative)))).toBe(
      true
    )
    expect(signals).toEqual([100, 101])
    expect(livePids.size).toBe(0)
  })

  it("fails closed when the durable-token recensus bound is exhausted", async () => {
    const prior = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("bounded-token|linux%3Aprior"),
      phase: "Live",
      pid: 50
    })
    const selectedNative = native({
      readdir: async () => ["100"],
      readFile: async (path) => {
        if (path.endsWith("/stat")) return linuxStatText(stat(100, 1, 100, "linux:child"))
        if (path.endsWith("/environ")) return "DALPH_CODEX_SERVER_INCARNATION=bounded-token\u0000"
        if (path.endsWith("/cmdline")) return "/bin/sh\u0000-c\u0000work\u0000"
        throw new Error(`unexpected process path ${path}`)
      }
    })
    expect(
      Exit.isFailure(await Effect.runPromiseExit(reconcilePriorTokenOwnedActivities(prior, selectedNative, 0)))
    ).toBe(true)
  })

  it("fails closed when Darwin reports a live process with malformed stat text", async () => {
    const member = stat(60, 1, 60, "darwin:Sat Aug 22 01:23:45 2026")
    const selectedNative = native({
      platform: "darwin",
      execFile: async () => ({ stdout: "malformed-live-row\n" }),
      kill: () => undefined
    })
    const observation = await Effect.runPromiseExit(awaitExactMembersAbsent([member], 0, selectedNative))
    expect(Exit.isFailure(observation)).toBe(true)

    const launch = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("darwin-malformed|darwin%3ASat%20Aug%2022%2001%3A23%3A45%202026"),
      phase: "Live",
      pid: 60
    })
    const census = makeNodeCodexProcessGroupCensusService(selectedNative)
    expect(await Effect.runPromise(census.observe(launch))).toMatchObject({ _tag: "Unreadable" })
  })

  it("fails closed when Darwin omits a recorded live leader or returns an empty census", async () => {
    const started = "Sat Aug 22 01:23:45 2026"
    const launch = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make(`darwin-omission|${encodeURIComponent(`darwin:${started}`)}`),
      phase: "Live",
      pid: 60
    })
    for (const fullCensus of ["61 1 61 S Sat Aug 22 01:23:46 2026\n", ""]) {
      const selectedNative = native({
        platform: "darwin",
        execFile: async (_file, arguments_) =>
          arguments_.includes("-axo") ? { stdout: fullCensus } : { stdout: `60 1 60 S ${started}\n` },
        kill: () => undefined
      })
      expect(
        await Effect.runPromise(makeNodeCodexProcessGroupCensusService(selectedNative).observe(launch))
      ).toMatchObject({ _tag: "Unreadable" })
    }
  })

  it("treats Linux and Darwin zombie launch and lease owners as absent", async () => {
    const started = "Sat Aug 22 01:23:45 2026"
    const cases = [
      {
        identity: "linux:123",
        selectedNative: native({
          readFile: async () => linuxStatText(stat(60, 1, 60, "linux:123")).replace("(fixture) S ", "(fixture) Z ")
        })
      },
      {
        identity: `darwin:${started}`,
        selectedNative: native({ platform: "darwin", execFile: async () => ({ stdout: `60 1 60 Z ${started}\n` }) })
      }
    ]
    for (const { identity, selectedNative } of cases) {
      const launch = CodexServerLaunchRecord.make({
        command: ["codex", "app-server"],
        incarnation: CodexServerIncarnation.make(`zombie-owner|${encodeURIComponent(identity)}`),
        phase: "Live",
        pid: 60
      })
      expect(
        await Effect.runPromise(
          makeNodeCodexProcessOwnershipService(
            makeNodeCodexProcessGroupCensusService(selectedNative),
            selectedNative
          ).observe(launch)
        )
      ).toEqual({ _tag: "Absent" })
      expect(
        await observeLeaseOwner(
          CodexServerLeaseRecord.make({
            pid: 60,
            processIdentity: CodexProcessIdentity.make(identity),
            incarnation: CodexServerLeaseIncarnation.make("zombie-lease")
          }),
          selectedNative
        )
      ).toEqual({ _tag: "Absent" })
    }
  })

  it("fails closed when an exact-token census cannot read a live process environment", async () => {
    const prior = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("permission-token|linux%3Aprior"),
      phase: "Live",
      pid: 50
    })
    const selectedNative = native({
      readdir: async () => ["100"],
      readFile: async (path) => {
        if (path.endsWith("/stat")) return linuxStatText(stat(100, 1, 100, "linux:child"))
        if (path.endsWith("/environ")) throw Object.assign(new Error("permission denied"), { code: "EACCES" })
        return "/bin/sh\u0000"
      }
    })
    expect(Exit.isFailure(await Effect.runPromiseExit(reconcilePriorTokenOwnedActivities(prior, selectedNative)))).toBe(
      true
    )
  })

  it("skips an unreadable Linux environment only after proving a foreign effective uid", async () => {
    expect(linuxProcessEffectiveUid("Name:\tfixture\nUid:\t1000\t1001\t1001\t1001\n")).toBe("1001")
    expect(linuxProcessEffectiveUid("Uid: malformed")).toBeUndefined()
    const prior = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("foreign-user-token|linux%3Aprior"),
      phase: "Live",
      pid: 50
    })
    const selectedNative = native({
      readdir: async () => ["100"],
      readFile: async (path) => {
        if (path.endsWith("/stat")) return linuxStatText(stat(100, 1, 100, "linux:child"))
        if (path === "/proc/100/status") return "Uid:\t2000\t2000\t2000\t2000\n"
        if (path === "/proc/1/status") return "Uid:\t1000\t1000\t1000\t1000\n"
        if (path.endsWith("/environ")) throw Object.assign(new Error("permission denied"), { code: "EACCES" })
        return "/bin/sh\u0000"
      }
    })
    expect(Exit.isSuccess(await Effect.runPromiseExit(reconcilePriorTokenOwnedActivities(prior, selectedNative)))).toBe(
      true
    )
  })

  it("treats an inert Linux zombie as absent without reading its environment", async () => {
    const prior = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("zombie-token|linux%3Aprior"),
      phase: "Live",
      pid: 50
    })
    let environmentReads = 0
    const selectedNative = native({
      readdir: async () => ["100"],
      readFile: async (path) => {
        if (path.endsWith("/stat")) {
          return linuxStatText(stat(100, 1, 100, "linux:zombie")).replace("(fixture) S ", "(fixture) Z ")
        }
        if (path.endsWith("/environ")) environmentReads += 1
        return ""
      }
    })
    expect(Exit.isSuccess(await Effect.runPromiseExit(reconcilePriorTokenOwnedActivities(prior, selectedNative)))).toBe(
      true
    )
    expect(environmentReads).toBe(0)
  })

  it("treats a malformed Linux stat race as absent only after the exact pid vanishes", async () => {
    const prior = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("vanished-stat-token|linux%3Aprior"),
      phase: "Live",
      pid: 50
    })
    const selectedNative = native({
      readdir: async () => ["100"],
      readFile: async () => "",
      kill: () => {
        // eslint-disable-next-line functional/no-throw-statements -- the native fixture proves the exact pid vanished between observations.
        throw Object.assign(new Error("process vanished"), { code: "ESRCH" })
      }
    })
    expect(Exit.isSuccess(await Effect.runPromiseExit(reconcilePriorTokenOwnedActivities(prior, selectedNative)))).toBe(
      true
    )
  })

  it("rechecks an environment permission race and accepts only a newly inert process", async () => {
    const prior = CodexServerLaunchRecord.make({
      command: ["codex", "app-server"],
      incarnation: CodexServerIncarnation.make("zombie-race-token|linux%3Aprior"),
      phase: "Live",
      pid: 50
    })
    let statReads = 0
    const selectedNative = native({
      readdir: async () => ["100"],
      readFile: async (path) => {
        if (path.endsWith("/stat")) {
          statReads += 1
          const state = statReads === 1 ? "S" : "Z"
          return linuxStatText(stat(100, 1, 100, "linux:zombie-race")).replace("(fixture) S ", `(fixture) ${state} `)
        }
        if (path.endsWith("/environ")) throw Object.assign(new Error("process became inert"), { code: "EACCES" })
        return "Uid:\t1000\t1000\t1000\t1000\n"
      }
    })
    expect(Exit.isSuccess(await Effect.runPromiseExit(reconcilePriorTokenOwnedActivities(prior, selectedNative)))).toBe(
      true
    )
    expect(statReads).toBe(2)
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

    const darwinStarted = "Sat Aug 22 01:23:45 2026"
    let darwinBatchCommandReads = 0
    const darwinNative = native({
      platform: "darwin",
      execFile: async (_file, arguments_) => {
        const joined = arguments_.join(" ")
        if (joined.includes("pid=,ppid=,pgid=,stat=,lstart=")) {
          return { stdout: `60 1 60 S ${darwinStarted}\n` }
        }
        if (joined.includes("eww -axo pid=,command=")) {
          darwinBatchCommandReads += 1
          return { stdout: "60 codex app-server DALPH_CODEX_SERVER_INCARNATION=platform\n" }
        }
        if (joined.includes("eww -o command=")) {
          return { stdout: "codex app-server DALPH_CODEX_SERVER_INCARNATION=platform\n" }
        }
        if (joined.includes("lstart=")) return { stdout: `${darwinStarted}\n` }
        if (joined.includes("command=")) return { stdout: "codex app-server\n" }
        return { stdout: "" }
      }
    })
    const darwinIncarnation = CodexServerIncarnation.make(`platform|${encodeURIComponent(`darwin:${darwinStarted}`)}`)
    const darwinLaunch = CodexServerLaunchRecord.make({ ...launch, incarnation: darwinIncarnation })
    expect(
      await incarnationWithProcessIdentity(
        CodexServerIncarnation.make("platform"),
        60,
        withNative(darwinNative, (value) => value)
      )
    ).toBe(darwinIncarnation)
    expect(
      await validateLaunchedProcessObservation(
        darwinLaunch,
        60,
        { expectedExecutable: "codex", expectedMode: "app-server" },
        ["codex", "app-server"],
        withNative(darwinNative, (value) => value)
      )
    ).toEqual({ _tag: "ExactLive", pid: 60 })
    expect(
      await validateLaunchedProcessObservation(
        { ...darwinLaunch, incarnation: CodexServerIncarnation.make("platform|darwin%3Aother") },
        60,
        { expectedExecutable: "codex", expectedMode: "app-server" },
        ["codex", "app-server"],
        withNative(darwinNative, (value) => value)
      )
    ).toMatchObject({ _tag: "Contradictory" })
    let reusedPidSignals = 0
    const sameSecondReusedPid = native({
      platform: "darwin",
      execFile: async (_file, arguments_) =>
        arguments_.join(" ").includes("pid=,ppid=,pgid=,stat=,lstart=")
          ? { stdout: `61 1 61 S ${darwinStarted}\n` }
          : arguments_.join(" ").includes("eww")
            ? { stdout: "unrelated-process-without-launch-token\n" }
            : { stdout: `${darwinStarted}\n` },
      kill: () => {
        reusedPidSignals += 1
      }
    })
    const reusedPidOutcome = await Effect.runPromiseExit(
      signalExactDetachedDescendants(
        darwinLaunch,
        { _tag: "ExactLive", members: [stat(61, 1, 61, `darwin:${darwinStarted}`)] },
        withNative(sameSecondReusedPid, (value) => value)
      )
    )
    expect(Exit.isFailure(reusedPidOutcome)).toBe(true)
    expect(reusedPidSignals).toBe(0)
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
    expect(await Effect.runPromise(darwinGroup.observe(darwinLaunch))).toMatchObject({ _tag: "ExactLive" })
    const darwinActivityCensus = makeNodeCodexOwnedActivityCensusService(
      withNative(darwinNative, (value) => value),
      60,
      darwinIncarnation
    )
    expect(
      await Effect.runPromise(
        darwinActivityCensus.observe(
          { cwd: "/worktree", id: CodexThreadId.make("darwin-thread"), status: "idle", turns: [] },
          []
        )
      )
    ).toEqual({ _tag: "Absent" })
    expect(darwinBatchCommandReads).toBe(0)
    expect(
      await Effect.runPromise(
        darwinActivityCensus.observe(
          { cwd: "/worktree", id: CodexThreadId.make("darwin-thread"), status: "idle", turns: [] },
          [],
          "PlannedAttempt"
        )
      )
    ).toEqual({ _tag: "Absent" })
    expect(darwinBatchCommandReads).toBe(1)
    expect(
      await discoverAppServerProcesses(
        darwinLaunch.incarnation,
        withNative(darwinNative, (value) => value)
      )
    ).toMatchObject({ _tag: "ExactLive", pid: 60 })
    expect(darwinBatchCommandReads).toBe(2)
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

  it("fails closed on empty, malformed, or duplicate Darwin batch command observations", async () => {
    const incarnation = CodexServerIncarnation.make("batch-token|darwin%3Astarted")
    for (const stdout of ["", "malformed\n", "60 codex app-server\n60 duplicate\n"]) {
      let batchReads = 0
      const selectedNative = native({
        platform: "darwin",
        execFile: async (_file, arguments_) => {
          if (arguments_.join(" ").includes("eww -axo pid=,command=")) batchReads += 1
          return { stdout }
        }
      })
      expect(await discoverAppServerProcesses(incarnation, selectedNative)).toMatchObject({ _tag: "Unreadable" })
      expect(batchReads).toBe(1)
    }
    const tokenlessNative = native({ platform: "darwin", execFile: async () => ({ stdout: "60 codex app-server\n" }) })
    expect(await discoverAppServerProcesses(incarnation, tokenlessNative)).toEqual({ _tag: "Absent" })
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
      Exit.isFailure(
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
    expect(
      launchExecutableMatches("/workspace/node_modules/.bin/codex", ["node", "/pkg/bin/codex.js", "app-server"])
    ).toBe(true)
    expect(launchExecutableMatches("codex", ["/usr/local/bin/other", "app-server"])).toBe(false)
    expect(launchExecutableMatches("/opt/codex", ["/opt/codex", "app-server"])).toBe(true)
    expect(launchExecutableMatches("relative/codex", ["/elsewhere/codex", "app-server"])).toBe(false)

    expect(
      launchCommandFacts(
        complete,
        withNative(native({ platform: "darwin" }), (value) => value)
      )
    ).toEqual({ expectedExecutable: "codex", expectedMode: "app-server" })
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
