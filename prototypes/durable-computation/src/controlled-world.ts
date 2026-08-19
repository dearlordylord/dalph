import { open, readFile, rename } from "node:fs/promises"
import { join } from "node:path"
import { Schema } from "effect"
import {
  type AdapterName,
  type ExactClaim,
  OutsideWorld,
  ProviderCall,
  type ProviderRequest,
  fixture
} from "./contracts.ts"

const outsideWorldPath = (workspace: string): string => join(workspace, "outside-world.json")
const providerLedgerPath = (workspace: string): string => join(workspace, "provider-calls.ndjson")

const writeDurably = async (path: string, contents: string): Promise<void> => {
  const temporaryPath = `${path}.${process.pid}.tmp`
  const file = await open(temporaryPath, "w")
  try {
    await file.writeFile(contents, "utf8")
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(temporaryPath, path)
}

export const initializeOutsideWorld = async (workspace: string): Promise<void> =>
  writeDurably(
    outsideWorldPath(workspace),
    `${JSON.stringify(
      OutsideWorld.make({
        applicationExitAdmission: "Open",
        executorObservation: "Absent",
        plannedBaseSha: fixture.plannedBaseSha,
        schemaVersion: 1,
        task: { claim: null, id: fixture.claim.taskId, lifecycle: "Open", targetMember: true },
        trackerRevision: 1
      })
    )}\n`
  )

export const readOutsideWorld = async (workspace: string): Promise<OutsideWorld> =>
  Schema.decodeUnknownSync(OutsideWorld)(JSON.parse(await readFile(outsideWorldPath(workspace), "utf8")))

const readProviderCalls = async (workspace: string): Promise<ReadonlyArray<ProviderCall>> => {
  const contents = await readFile(providerLedgerPath(workspace), "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return ""
    throw error
  })
  return contents
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => Schema.decodeUnknownSync(ProviderCall)(JSON.parse(line)))
}

export const loadProviderCalls = readProviderCalls

interface CallContext {
  readonly adapter: AdapterName
  readonly processInstance: string
  readonly workspace: string
}

const appendProviderCall = async (
  context: CallContext,
  request: ProviderRequest,
  result: string,
  trackerRevision: number | null,
  replyDelivered: boolean
): Promise<void> => {
  const existing = await readProviderCalls(context.workspace)
  const entry = ProviderCall.make({
    adapter: context.adapter,
    ordinal: existing.length + 1,
    processInstance: context.processInstance,
    replyDelivered,
    request,
    result,
    trackerRevision
  })
  const file = await open(providerLedgerPath(context.workspace), "a")
  try {
    await file.appendFile(`${JSON.stringify(entry)}\n`, "utf8")
    await file.sync()
  } finally {
    await file.close()
  }
}

export const readClaim = async (context: CallContext): Promise<ExactClaim | null> => {
  const world = await readOutsideWorld(context.workspace)
  await appendProviderCall(
    context,
    "GitHub.ReadClaim",
    world.task.claim === null ? "Absent" : "Exact",
    world.trackerRevision,
    true
  )
  return world.task.claim
}

export const createClaim = async (
  context: CallContext,
  claim: ExactClaim,
  replyDelivered: boolean
): Promise<void> => {
  const world = await readOutsideWorld(context.workspace)
  const updated = OutsideWorld.make({
    ...world,
    task: { ...world.task, claim },
    trackerRevision: world.trackerRevision + 1
  })
  await writeDurably(outsideWorldPath(context.workspace), `${JSON.stringify(updated)}\n`)
  await appendProviderCall(
    context,
    "GitHub.CreateClaim",
    "AppliedExactClaim",
    updated.trackerRevision,
    replyDelivered
  )
}

export const readCurrentTaskFacts = async (context: CallContext): Promise<OutsideWorld> => {
  const world = await readOutsideWorld(context.workspace)
  await appendProviderCall(
    context,
    "GitHub.ReadCurrentTaskFacts",
    `${world.task.lifecycle}:${world.task.targetMember ? "Member" : "OutsideTarget"}`,
    world.trackerRevision,
    true
  )
  return world
}

export const moveTaskOutsideTargetDuringDowntime = async (workspace: string): Promise<void> => {
  const world = await readOutsideWorld(workspace)
  const updated = OutsideWorld.make({
    ...world,
    task: { ...world.task, targetMember: false },
    trackerRevision: world.trackerRevision + 1
  })
  await writeDurably(outsideWorldPath(workspace), `${JSON.stringify(updated)}\n`)
}

export const closeApplicationExitAdmission = async (context: CallContext): Promise<void> => {
  const world = await readOutsideWorld(context.workspace)
  await writeDurably(
    outsideWorldPath(context.workspace),
    `${JSON.stringify(OutsideWorld.make({ ...world, applicationExitAdmission: "Closed" }))}\n`
  )
  await appendProviderCall(context, "ApplicationExit.CutoffObserved", "Closed", null, true)
}

export const reopenApplicationAdmission = async (workspace: string): Promise<void> => {
  const world = await readOutsideWorld(workspace)
  await writeDurably(
    outsideWorldPath(workspace),
    `${JSON.stringify(OutsideWorld.make({ ...world, applicationExitAdmission: "Open" }))}\n`
  )
}
