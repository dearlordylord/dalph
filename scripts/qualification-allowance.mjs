import { existsSync } from "node:fs"
import { join } from "node:path"
import { atomicRecord, custodyVersion, digest, epochMilliseconds, readRecord } from "./gate-custody-records.mjs"
import { resolveGateDeadline } from "./gate-deadline.mjs"

export const defaultQualificationAllowanceMilliseconds = 4 * 60 * 60 * 1000

const canonicalTimestamp = (value) => {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

const canonicalCommit = (value) => typeof value === "string" && /^[0-9a-f]{40}$/u.test(value)

export const qualificationAllowancePath = (location, baseSha) =>
  join(
    location.custodyRoot,
    "qualification-allowances",
    `${digest(JSON.stringify({ worktree: location.worktree, baseSha }))}.json`
  )

const validateAllowance = ({ baseSha, location, path, record }) => {
  if (record.kind !== "qualification-allowance" || record.worktree !== location.worktree || record.baseSha !== baseSha)
    throw new Error(`Qualification allowance identity does not match: ${path}`)
  if (
    !canonicalCommit(record.baseSha) ||
    !canonicalTimestamp(record.startedAt) ||
    !canonicalTimestamp(record.deadline) ||
    Date.parse(record.deadline) <= Date.parse(record.startedAt)
  )
    throw new Error(`Invalid qualification allowance: ${path}`)
  return record
}

/**
 * Resolve one qualification allowance while the caller owns the exact worktree
 * lock. The record is keyed by canonical worktree and planned Base, so a new
 * shell or gate command cannot restart the allowance.
 */
export const resolveQualificationAllowance = ({
  baseSha,
  configuredGateDeadline,
  location,
  now = epochMilliseconds()
}) => {
  if (!canonicalCommit(baseSha)) throw new Error("Qualification allowance requires a canonical planned Base SHA")
  const path = qualificationAllowancePath(location, baseSha)
  let record
  if (existsSync(path)) {
    record = validateAllowance({ baseSha, location, path, record: readRecord(path) })
  } else {
    record = {
      version: custodyVersion,
      kind: "qualification-allowance",
      worktree: location.worktree,
      baseSha,
      startedAt: new Date(now).toISOString(),
      deadline: new Date(now + defaultQualificationAllowanceMilliseconds).toISOString()
    }
    atomicRecord(path, record)
  }
  if (Date.parse(record.deadline) <= now)
    throw new Error(`Qualification allowance expired at ${record.deadline}; no new gate may start`)
  const gateDeadline = resolveGateDeadline({ configured: configuredGateDeadline, now })
  const deadline = Date.parse(gateDeadline) <= Date.parse(record.deadline) ? gateDeadline : record.deadline
  return { deadline, path, record }
}
