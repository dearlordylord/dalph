import { readFileSync, existsSync } from "node:fs"
import { join } from "node:path"
import { atomicRecord, wallClockTimestamp } from "./gate-custody-records.mjs"

const processGroup = () => {
  if (process.platform !== "linux") throw new Error("MBT generation custody currently requires Linux /proc")
  const stat = readFileSync("/proc/" + process.pid + "/stat", "utf8")
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ")
  return { groupId: Number(fields[2]), startTicks: fields[19] }
}

/** Bind the generation worker to its existing bounded supervisor before importing Quint. */
export const bindMbtGenerationProcessGroup = (directory) => {
  const { groupId, startTicks } = processGroup()
  if (groupId !== process.pid) throw new Error("MBT generator must be the bounded supervisor's exact group leader")
  const record = {
    version: 1,
    pid: process.pid,
    groupId,
    startTicks,
    bootId: readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
    recordedUtc: wallClockTimestamp()
  }
  const target = join(directory, "generator-group.json")
  if (existsSync(target))
    throw new Error("Retained MBT generator custody requires reconciliation before another launch")
  atomicRecord(target, record)
  process.env.DALPH_QUINT_PARENT_OWNED_GROUP = String(groupId)
  return record
}

/** A successful worker exit alone cannot authorize publication; require its recorded group absent. */
export const proveMbtGenerationProcessGroupAbsent = (directory) => {
  const record = JSON.parse(readFileSync(join(directory, "generator-group.json"), "utf8"))
  if (
    record.version !== 1 ||
    !Number.isSafeInteger(record.groupId) ||
    record.groupId <= 0 ||
    record.pid !== record.groupId ||
    typeof record.startTicks !== "string" ||
    !/^[0-9]+$/u.test(record.startTicks)
  )
    throw new Error("Invalid MBT generator group custody")
  if (record.bootId !== readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim())
    throw new Error("MBT generator custody belongs to another boot; reconciliation required")
  try {
    process.kill(-record.groupId, 0)
  } catch (error) {
    if (error.code === "ESRCH") {
      atomicRecord(join(directory, "generator-stopped.json"), {
        ...record,
        observedUtc: wallClockTimestamp(),
        groupAbsent: true
      })
      return
    }
    throw new Error("MBT generator group observation refused: " + error.code)
  }
  throw new Error("MBT generator group remains present; preserve its evidence and custody")
}
