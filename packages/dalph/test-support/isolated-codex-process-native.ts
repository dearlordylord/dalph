import {
  linuxProcessEffectiveUid,
  type LinuxProcessStat,
  parseLinuxProcessStat
} from "../src/application/codex-app-server.js"
import {
  nodeCodexProcessNativeService,
  type CodexProcessNativeService
} from "../src/application/codex-process-native.js"

const processErrorCode = (error: unknown): string =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : ""

export const processEntryReadProvesAbsence = (error: unknown): boolean => {
  const code = processErrorCode(error)
  return code === "ENOENT" || code === "ESRCH"
}

const processBelongsToForeignUser = async (pid: number, native: CodexProcessNativeService): Promise<boolean> => {
  try {
    const [candidateStatus, ownerStatus] = await Promise.all([
      native.readFile(`/proc/${pid}/status`),
      native.readFile(`/proc/${native.pid}/status`)
    ])
    const candidateUid = linuxProcessEffectiveUid(candidateStatus)
    const ownerUid = linuxProcessEffectiveUid(ownerStatus)
    return candidateUid !== undefined && ownerUid !== undefined && candidateUid !== ownerUid
  } catch {
    return false
  }
}

const processEntryMayBeExcluded = async (
  pid: number,
  error: unknown,
  native: CodexProcessNativeService
): Promise<boolean> =>
  processEntryReadProvesAbsence(error) ||
  (processErrorCode(error) === "EACCES" && (await processBelongsToForeignUser(pid, native)))

const readFixtureProcess = async (
  entry: string,
  native: CodexProcessNativeService
): Promise<LinuxProcessStat | undefined> => {
  if (!/^[0-9]+$/.test(entry)) return undefined
  const pid = Number(entry)
  try {
    const stat = parseLinuxProcessStat(pid, await native.readFile(`/proc/${entry}/stat`))
    if (stat === undefined) return Promise.reject(new Error(`process ${pid} identity is malformed`))
    return stat
  } catch (error) {
    if (processEntryReadProvesAbsence(error)) return undefined
    return Promise.reject(error)
  }
}

const fixtureProcessIds = (processes: ReadonlyArray<LinuxProcessStat>, rootPid: number): ReadonlySet<number> => {
  const byPid = new Map(processes.map((process) => [process.pid, process]))
  return new Set(
    processes.flatMap((process) => {
      let pid = process.pid
      const seen = new Set<number>()
      while (!seen.has(pid)) {
        if (pid === rootPid) return [process.pid]
        seen.add(pid)
        const parent = byPid.get(pid)
        if (parent === undefined || parent.parentPid === 0) return []
        pid = parent.parentPid
      }
      return []
    })
  )
}

/**
 * Real Node process operations restricted to this qualification child and its
 * descendants. The hermetic provider is in-process and creates no app-server
 * or task processes, so sibling runner processes are outside its test scope.
 * Real app-server restart ownership is qualified separately.
 */
export const makeIsolatedCodexProcessNativeService = (
  native: CodexProcessNativeService
): CodexProcessNativeService => ({
  ...native,
  readFile: async (filename) => {
    try {
      return await native.readFile(filename)
    } catch (error) {
      const processMatch = /^\/proc\/(\d+)\/environ$/.exec(filename)
      if (
        native.platform === "linux" &&
        processMatch !== null &&
        (await processEntryMayBeExcluded(Number(processMatch[1]), error, native))
      ) {
        return Promise.reject(
          Object.assign(new Error(`entry unavailable in fixture process view: ${filename}`), { code: "ENOENT" })
        )
      }
      return Promise.reject(error)
    }
  },
  readdir: async (directory) => {
    const entries = await native.readdir(directory)
    if (native.platform !== "linux" || directory !== "/proc") return entries
    const processes = (await Promise.all(entries.map((entry) => readFixtureProcess(entry, native)))).filter(
      (process): process is LinuxProcessStat => process !== undefined
    )
    const included = fixtureProcessIds(processes, native.pid)
    return entries.filter((entry) => !/^[0-9]+$/.test(entry) || included.has(Number(entry)))
  }
})

export const isolatedCodexProcessNativeService: CodexProcessNativeService =
  makeIsolatedCodexProcessNativeService(nodeCodexProcessNativeService)
