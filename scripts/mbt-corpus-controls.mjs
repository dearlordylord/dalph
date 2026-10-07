import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { runBoundedCommand } from "./run-bounded-command.mjs"

// Retained inputs are an unresolved disposition, not permission to retry.
export const runCorpusConsumer = async ({ cleanup, command, retain, run = runBoundedCommand }) => {
  let stoppedWritersProven = false
  try {
    const result = await run(command)
    stoppedWritersProven = true
    return result
  } catch (error) {
    stoppedWritersProven = error.stoppedWritersProven === true
    throw error
  } finally {
    if (stoppedWritersProven) await cleanup()
    else await retain()
  }
}

export const rawCorpusBytes = async (directory) => {
  const files = await readdir(directory).catch((error) => {
    if (error.code === "ENOENT") return []
    throw error
  })
  let bytes = 0
  for (const file of files) bytes += (await stat(join(directory, file))).size
  return bytes
}

export const checkRawCorpusBudget = async (directory, lane, alreadyPublished, batchLimit) => {
  const bytes = await rawCorpusBytes(directory)
  if (bytes > lane.limits.bytes || alreadyPublished + bytes > batchLimit)
    throw new Error(`MBT byte budget exceeded: ${lane.id}`)
  return bytes
}
