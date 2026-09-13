import {
  nodeCodexProcessNativeService,
  type CodexProcessNativeService
} from "../src/application/codex-process-native.js"

const processErrorCode = (error: unknown): string =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : ""

export const processEntryReadIsUnavailable = (error: unknown): boolean => {
  const code = processErrorCode(error)
  return code === "EACCES" || code === "ENOENT" || code === "ESRCH"
}

const processEntryIsReadable = async (entry: string, native: CodexProcessNativeService): Promise<boolean> => {
  if (!/^[0-9]+$/.test(entry)) return true
  try {
    await native.readFile(`/proc/${entry}/environ`)
    return true
  } catch (error) {
    // A process can disappear after `/proc` enumeration but before this
    // readability probe. ESRCH is a proven absence at this exact PID; it is
    // not an unreadable/live/changed process and must not abort the census.
    if (processEntryReadIsUnavailable(error)) return false
    return Promise.reject(error)
  }
}

/**
 * Real Node process operations with the same per-account readable process view
 * used by the supported-host qualification fixture. Protocol tests do not own
 * unrelated runner processes and therefore must not census them.
 */
export const makeIsolatedCodexProcessNativeService = (
  native: CodexProcessNativeService
): CodexProcessNativeService => ({
  ...native,
  readFile: async (filename) => {
    try {
      return await native.readFile(filename)
    } catch (error) {
      // The runner can make an unrelated entry unreadable after enumeration.
      // Keep this fixture's readable directory view consistent at the later
      // token read; production retains its stricter ownership observations.
      if (
        native.platform === "linux" &&
        /^\/proc\/\d+\/environ$/.test(filename) &&
        processEntryReadIsUnavailable(error)
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
    const readable = await Promise.all(entries.map((entry) => processEntryIsReadable(entry, native)))
    return entries.filter((_, index) => readable[index] === true)
  }
})

export const isolatedCodexProcessNativeService: CodexProcessNativeService =
  makeIsolatedCodexProcessNativeService(nodeCodexProcessNativeService)
