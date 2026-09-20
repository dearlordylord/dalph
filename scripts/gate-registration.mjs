import { join } from "node:path"
import { readdirSync } from "node:fs"
import {
  canonicalUuidPattern,
  wallClockTimestamp,
  atomicRecord,
  custodyVersion,
  digest,
  inheritedCustody,
  newIdentity,
  readRecord,
  registrationLockPath,
  withFileLock
} from "./gate-custody-records.mjs"

const registrationPath = (runDirectory) => join(runDirectory, "registration.json")
export { registrationLockPath } from "./gate-custody-records.mjs"
export const ensureRegistrationOpen = (context) => {
  const registration = readRecord(registrationPath(context.runDirectory))
  if (registration.runId !== context.run.runId || registration.state !== "open")
    throw new Error("Gate registration is closed; old-run launches are refused")
}
export const registerSpawn = ({ command, environment, spawnChild }) => {
  const ambient = inheritedCustody()
  const supplied = inheritedCustody(environment)
  if (
    ambient !== undefined &&
    supplied !== undefined &&
    (ambient.run.runId !== supplied.run.runId ||
      ambient.runDirectory !== supplied.runDirectory ||
      ambient.parentId !== supplied.parentId)
  )
    throw new Error("Explicit child environment conflicts with owner gate custody")
  const context = ambient ?? supplied
  if (
    context !== undefined &&
    (process.env.DALPH_RUN_REAL_CODEX_QUALIFICATION === "1" || environment?.DALPH_RUN_REAL_CODEX_QUALIFICATION === "1")
  )
    throw new Error("Real Codex qualification is outside supported gate custody")
  if (context === undefined) return { child: spawnChild(environment), obligation: undefined }
  return withFileLock(registrationLockPath(context.runDirectory), () => {
    ensureRegistrationOpen(context)
    const obligationId = newIdentity()
    const path = join(context.runDirectory, "obligations", `${obligationId}.json`)
    const intent = {
      version: custodyVersion,
      runId: context.run.runId,
      obligationId,
      parentId: context.parentId,
      command,
      state: "intent",
      startedAt: wallClockTimestamp()
    }
    const registration = readRecord(registrationPath(context.runDirectory))
    atomicRecord(registrationPath(context.runDirectory), {
      ...registration,
      obligations: [...registration.obligations, obligationId]
    })
    atomicRecord(path, intent)
    const childEnvironment = {
      ...environment,
      DALPH_GATE_RUN_DIRECTORY: context.runDirectory,
      DALPH_GATE_RUN_ID: context.run.runId,
      DALPH_GATE_OBLIGATION: obligationId
    }
    const child = spawnChild(childEnvironment)
    // A missing pid is resolved only by the later definite launch-failure event.
    let observationError
    if (child.pid !== undefined) {
      try {
        atomicRecord(path, { ...intent, state: "observed", processGroup: child.pid })
      } catch (error) {
        observationError = error
      }
    }
    return { child, obligation: { context, intent, path }, observationError }
  })
}
export const publishNoChild = (obligation) => {
  if (obligation === undefined) return
  atomicRecord(obligation.path, { ...obligation.intent, state: "no-child" })
}
export const publishAbsence = (obligation) => {
  if (obligation === undefined) return
  const observed = readRecord(obligation.path)
  if (observed.state !== "observed" || !Number.isSafeInteger(observed.processGroup) || observed.processGroup <= 0)
    throw new Error("Cannot publish absence for an unobserved group")
  atomicRecord(join(obligation.context.runDirectory, "absence", `${obligation.intent.obligationId}.json`), {
    version: custodyVersion,
    runId: obligation.intent.runId,
    obligationId: obligation.intent.obligationId,
    state: "observed",
    processGroup: observed.processGroup,
    absentAt: wallClockTimestamp()
  })
}
export const groupIsAbsent = (processGroup) => {
  if (!Number.isSafeInteger(processGroup) || processGroup <= 0 || process.platform !== "linux")
    throw new Error("Unsupported process-group observation")
  try {
    process.kill(-processGroup, 0)
    return false
  } catch (error) {
    if (error.code === "ESRCH") return true
    if (error.code === "EPERM") return false
    throw error
  }
}
/** A definite failed launch has no group; only an observed launch owns a group. */
export const validateObligation = (obligation, runId) => {
  if (
    obligation.runId !== runId ||
    !/^[0-9a-f-]{36}$/u.test(obligation.obligationId ?? "") ||
    typeof obligation.command !== "object" ||
    obligation.command === null ||
    !["intent", "no-child", "observed"].includes(obligation.state) ||
    (obligation.state === "observed"
      ? !Number.isSafeInteger(obligation.processGroup) || obligation.processGroup <= 0
      : Object.hasOwn(obligation, "processGroup"))
  )
    throw new Error("Invalid custody obligation variant")
  return obligation
}
const stableValue = (value) => {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)])
    )
  return value
}
const stableJson = (value) => JSON.stringify(stableValue(value))
const validatePreviousBootObligation = (obligation, runId, fileName) => {
  if (!canonicalUuidPattern.test(obligation.obligationId ?? ""))
    throw new Error(`Invalid previous-boot obligation identity: ${fileName}`)
  if (obligation.parentId !== "root" && !canonicalUuidPattern.test(obligation.parentId ?? ""))
    throw new Error(`Invalid previous-boot obligation parent: ${obligation.obligationId}`)
  validateObligation(obligation, runId)
  if (!["no-child", "observed"].includes(obligation.state))
    throw new Error(`Previous-boot inventory contains an unobserved obligation: ${obligation.obligationId}`)
  return obligation
}
const closeAndDigestPreviousBootInventoryUnderLock = ({ closeOpen = true, runDirectory, runId }) => {
  const path = registrationPath(runDirectory)
  const registration = readRecord(path)
  const registrationKeys = Object.keys(registration).sort((left, right) => left.localeCompare(right))
  if (JSON.stringify(registrationKeys) !== JSON.stringify(["obligations", "runId", "state", "version"]))
    throw new Error("Invalid previous-boot registration shape")
  if (
    registration.runId !== runId ||
    !["open", "closed"].includes(registration.state) ||
    !Array.isArray(registration.obligations) ||
    registration.obligations.some((id) => !canonicalUuidPattern.test(id)) ||
    new Set(registration.obligations).size !== registration.obligations.length
  )
    throw new Error("Invalid previous-boot registration inventory")
  const directory = readdirSync(join(runDirectory, "obligations"))
  const canonicalDirectory = [...directory].sort((left, right) => left.localeCompare(right))
  const canonicalList = registration.obligations
    .map((id) => `${id}.json`)
    .sort((left, right) => left.localeCompare(right))
  if (
    canonicalDirectory.some((name) => !name.endsWith(".json") || !canonicalUuidPattern.test(name.slice(0, -5))) ||
    JSON.stringify(canonicalDirectory) !== JSON.stringify(canonicalList)
  )
    throw new Error("Previous-boot obligation directory does not match registration")
  const obligations = canonicalList.map((name) => {
    const obligation = validatePreviousBootObligation(readRecord(join(runDirectory, "obligations", name)), runId, name)
    if (obligation.obligationId !== name.slice(0, -5))
      throw new Error(`Previous-boot obligation filename does not match its record: ${name}`)
    return obligation
  })
  const parentById = new Map(obligations.map(({ obligationId, parentId }) => [obligationId, parentId]))
  for (const obligation of obligations) {
    const seen = new Set()
    let current = obligation.obligationId
    while (current !== "root") {
      if (seen.has(current)) throw new Error(`Previous-boot obligation parent cycle: ${obligation.obligationId}`)
      seen.add(current)
      const parent = parentById.get(current)
      if (parent === undefined)
        throw new Error(`Previous-boot obligation parent is not registered: ${obligation.obligationId}`)
      current = parent
    }
  }
  const inventory = {
    version: custodyVersion,
    runId,
    registration: {
      state: "closed",
      obligations: [...registration.obligations].sort((left, right) => left.localeCompare(right))
    },
    obligations: obligations.sort((left, right) => left.obligationId.localeCompare(right.obligationId))
  }
  if (closeOpen && registration.state === "open") atomicRecord(path, { ...registration, state: "closed" })
  return {
    count: inventory.obligations.length,
    digest: digest(stableJson(inventory)),
    wasOpen: registration.state === "open",
    registration: inventory.registration,
    obligations: inventory.obligations
  }
}
/** Read and, when necessary, close a complete previous-boot inventory under its registration lock. */
export const closeAndDigestPreviousBootInventory = ({ closeOpen = true, runDirectory, runId }) =>
  withFileLock(registrationLockPath(runDirectory), () => {
    const { count, digest } = closeAndDigestPreviousBootInventoryUnderLock({ closeOpen, runDirectory, runId })
    return { count, digest }
  })
/** The previous-boot reconciler holds registrationLockPath before calling this variant. */
export const closeAndDigestPreviousBootInventoryLocked = closeAndDigestPreviousBootInventoryUnderLock
const proveObligationStopped = (obligation) => {
  if (obligation.state === "no-child") return
  if (obligation.state !== "observed")
    throw new Error(`Unobserved spawn obligation ${obligation.obligationId}; cannot prove safe release`)
  if (!groupIsAbsent(obligation.processGroup))
    throw new Error(
      `Process group ${obligation.processGroup} for obligation ${obligation.obligationId} is not proven absent`
    )
}
/** The observer may exit while a registered detached descendant still owns writer custody. */
export const proveStageDescendantsStopped = (obligation) => {
  if (obligation === undefined) return
  const { context } = obligation
  withFileLock(registrationLockPath(context.runDirectory), () => {
    const registration = readRecord(registrationPath(context.runDirectory))
    const records = registration.obligations.map((id) =>
      validateObligation(readRecord(join(context.runDirectory, "obligations", `${id}.json`)), context.run.runId)
    )
    const descendants = new Set([obligation.intent.obligationId])
    for (let size = -1; size !== descendants.size;) {
      size = descendants.size
      for (const record of records) if (descendants.has(record.parentId)) descendants.add(record.obligationId)
    }
    const stopped = records.filter((record) => descendants.has(record.obligationId))
    for (const record of stopped) proveObligationStopped(record)
    for (const record of stopped)
      if (record.state === "observed")
        publishAbsence({
          context,
          intent: record,
          path: join(context.runDirectory, "obligations", `${record.obligationId}.json`)
        })
  })
}
export const closeAndProveCustodyStopped = (context) =>
  withFileLock(registrationLockPath(context.runDirectory), () => {
    const registration = readRecord(registrationPath(context.runDirectory))
    if (registration.runId !== context.run.runId || !["open", "closed"].includes(registration.state))
      throw new Error("Invalid registration state")
    atomicRecord(registrationPath(context.runDirectory), {
      version: custodyVersion,
      runId: context.run.runId,
      state: "closed",
      obligations: registration.obligations
    })
    const obligations = readdirSync(join(context.runDirectory, "obligations"))
    if (
      !Array.isArray(registration.obligations) ||
      registration.obligations.some((id) => typeof id !== "string") ||
      new Set(registration.obligations).size !== registration.obligations.length ||
      JSON.stringify([...obligations].sort((left, right) => left.localeCompare(right))) !==
        JSON.stringify(
          registration.obligations.map((id) => `${id}.json`).sort((left, right) => left.localeCompare(right))
        )
    )
      throw new Error("Missing or corrupt custody obligation inventory")
    const records = []
    for (const name of obligations) {
      if (!/^[0-9a-f-]+\.json$/u.test(name)) throw new Error(`Unrecognized obligation inventory entry: ${name}`)
      const obligation = readRecord(join(context.runDirectory, "obligations", name))
      if (
        obligation.runId !== context.run.runId ||
        name !== `${obligation.obligationId}.json` ||
        typeof obligation.command !== "object"
      )
        throw new Error(`Invalid obligation ${name}`)
      validateObligation(obligation, context.run.runId)
      records.push(obligation)
    }
    for (const obligation of records) proveObligationStopped(obligation)
    for (const obligation of records)
      if (obligation.state === "observed")
        publishAbsence({
          context,
          intent: obligation,
          path: join(context.runDirectory, "obligations", `${obligation.obligationId}.json`)
        })
    return obligations.length
  })
