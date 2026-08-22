import {
  nodeCodexProcessNativeService,
  type CodexProcessNativeService
} from "../src/application/codex-process-native.js"

const processErrorCode = (error: unknown): string =>
  typeof error === "object" && error !== null && "code" in error ? String(error.code) : ""

const processEntryIsReadable = async (entry: string): Promise<boolean> => {
  if (!/^[0-9]+$/.test(entry)) return true
  try {
    await nodeCodexProcessNativeService.readFile(`/proc/${entry}/environ`)
    return true
  } catch (error) {
    const code = processErrorCode(error)
    if (code === "EACCES" || code === "ENOENT") return false
    return Promise.reject(error)
  }
}

/**
 * Real Node process operations with the same per-account readable process view
 * used by the supported-host qualification fixture. Protocol tests do not own
 * unrelated runner processes and therefore must not census them.
 */
export const isolatedCodexProcessNativeService: CodexProcessNativeService = {
  ...nodeCodexProcessNativeService,
  readdir: async (directory) => {
    const entries = await nodeCodexProcessNativeService.readdir(directory)
    if (nodeCodexProcessNativeService.platform !== "linux" || directory !== "/proc") return entries
    const readable = await Promise.all(entries.map(processEntryIsReadable))
    return entries.filter((_, index) => readable[index] === true)
  }
}
