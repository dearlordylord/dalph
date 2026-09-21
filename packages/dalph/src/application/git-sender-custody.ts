/* eslint-disable import/no-nodejs-modules -- execution-substrate persistence owns exact local Git senders. */
import { createHash } from "node:crypto"
import { NodeCrypto } from "@effect/platform-node"
import { constants } from "node:fs"
import { mkdir, mkdtemp, open, readFile, rename, rmdir } from "node:fs/promises"
import { join } from "node:path"
import {
  GitCommandCustodySubject,
  GitSenderCustody,
  GitSenderCustodyFailure,
  GitSenderProcessId,
  GitSenderToken,
  gitSenderTokenEnvironment
} from "@dalph/orchestrator"
import { Crypto, Effect, Layer, Schema } from "effect"
import { CodexProcessStartIdentity, linuxProcessEffectiveUid, parseLinuxProcessStat } from "./codex-app-server.js"
import { nodeCodexProcessNativeService, type CodexProcessNativeService } from "./codex-process-native.js"

const senderFileMode = 0o600
const senderStopBudgetMillis = 2000
const senderPollMillis = 25
const senderStopPollLimit = 80

const SenderIdentity = Schema.Struct({ pid: GitSenderProcessId, startIdentity: CodexProcessStartIdentity })
type SenderIdentity = typeof SenderIdentity.Type
const SenderRecord = Schema.Struct({
  subject: GitCommandCustodySubject,
  token: GitSenderToken,
  identity: Schema.NullOr(SenderIdentity),
  phase: Schema.Literals(["Reserved", "Launching", "Spawned", "Stopped"])
})
type SenderRecord = typeof SenderRecord.Type
const absent = (error: unknown): boolean =>
  typeof error === "object" && error !== null && "code" in error && (error.code === "ENOENT" || error.code === "ESRCH")

/** File-backed sender ownership, separate from both the Run journal and Codex's singleton server lease. */
export const fileGitSenderCustodyLayer = (
  commonDirectory: string,
  native: CodexProcessNativeService = nodeCodexProcessNativeService
) => {
  const directory = join(commonDirectory, "dalph", "git-senders")
  const pathFor = (subject: GitCommandCustodySubject) =>
    join(directory, `${createHash("sha256").update(JSON.stringify(subject)).digest("hex")}.json`)
  const read = async (subject: GitCommandCustodySubject): Promise<SenderRecord> => {
    const record = Schema.decodeUnknownSync(SenderRecord)(JSON.parse(await readFile(pathFor(subject), "utf8")))
    if (JSON.stringify(record.subject) !== JSON.stringify(subject)) return Promise.reject(new GitSenderCustodyFailure())
    return record
  }
  const persist = async (record: SenderRecord, initial: boolean): Promise<void> => {
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const destination = pathFor(record.subject)
    const temporary = initial ? undefined : await mkdtemp(join(directory, ".sender-write-"))
    const path = temporary === undefined ? destination : join(temporary, "record")
    const file = await open(
      path,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      senderFileMode
    )
    try {
      await file.writeFile(JSON.stringify(record))
      await file.sync()
    } finally {
      await file.close()
    }
    if (!initial) await rename(path, destination)
    if (temporary !== undefined) await rmdir(temporary)
    const parent = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY)
    try {
      await parent.sync()
    } finally {
      await parent.close()
    }
  }
  const census = async (record: SenderRecord) => {
    if (native.platform !== "linux") return Promise.reject(new GitSenderCustodyFailure())
    const ownerUid = linuxProcessEffectiveUid(await native.readFile("/proc/self/status"))
    if (ownerUid === undefined) return Promise.reject(new GitSenderCustodyFailure())
    const members: Array<SenderIdentity> = []
    for (const entry of await native.readdir("/proc")) {
      if (!/^\d+$/u.test(entry)) continue
      const pid = await Schema.decodeUnknownPromise(GitSenderProcessId)(Number(entry))
      try {
        const uid = linuxProcessEffectiveUid(await native.readFile(`/proc/${pid}/status`))
        if (uid === undefined) return Promise.reject(new GitSenderCustodyFailure())
        if (uid !== ownerUid) continue
        const stat = parseLinuxProcessStat(pid, await native.readFile(`/proc/${pid}/stat`))
        if (stat === undefined) return Promise.reject(new GitSenderCustodyFailure())
        if (stat.processState === "Z") continue
        const environment = await native.readFile(`/proc/${pid}/environ`)
        const tokenOwned = environment.split("\0").includes(`${gitSenderTokenEnvironment}=${record.token}`)
        const exactRoot = record.identity?.pid === pid && record.identity.startIdentity === stat.startIdentity
        if (tokenOwned || exactRoot) members.push({ pid, startIdentity: stat.startIdentity })
      } catch (error: unknown) {
        if (!absent(error)) return Promise.reject(error)
      }
    }
    return members
  }
  const boundary = <A>(operation: () => Promise<A>) =>
    Effect.tryPromise({ try: operation, catch: () => new GitSenderCustodyFailure() })
  return Layer.effect(
    GitSenderCustody,
    Effect.gen(function* () {
      const crypto = yield* Crypto.Crypto
      return GitSenderCustody.of({
        reserve: (subject) =>
          crypto.randomUUIDv4.pipe(
            Effect.mapError(() => new GitSenderCustodyFailure()),
            Effect.flatMap((uuid) =>
              boundary(async () => {
                try {
                  const existing = await read(subject)
                  return existing.phase === "Reserved" ? undefined : Promise.reject(new GitSenderCustodyFailure())
                } catch (error: unknown) {
                  if (!absent(error)) return Promise.reject(error)
                }
                const token = GitSenderToken.make(uuid)
                await persist({ subject, token, identity: null, phase: "Reserved" }, true)
              })
            )
          ),
        begin: (subject) =>
          boundary(async () => {
            const record = await read(subject)
            if (record.phase !== "Reserved") return Promise.reject(new GitSenderCustodyFailure())
            // This transition commits before the token can be inherited by a child.
            await persist({ ...record, phase: "Launching" }, false)
            return record.token
          }),
        spawned: (subject, token, pid) =>
          boundary(async () => {
            const record = await read(subject)
            if (record.token !== token || record.phase !== "Launching")
              return Promise.reject(new GitSenderCustodyFailure())
            let text: string
            try {
              text = await native.readFile(`/proc/${pid}/stat`)
            } catch (error: unknown) {
              // A short-lived Git command can close before its PID acknowledgement.
              // Keep the durable pre-spawn token; reconciliation still censuses every helper.
              if (absent(error)) return
              return Promise.reject(error)
            }
            const stat = parseLinuxProcessStat(pid, text)
            if (stat === undefined || stat.processGroupId !== pid) return Promise.reject(new GitSenderCustodyFailure())
            await persist({ ...record, phase: "Spawned", identity: { pid, startIdentity: stat.startIdentity } }, false)
          }),
        reconcile: (subject) =>
          Effect.gen(function* () {
            const record = yield* boundary(() => read(subject))
            if (record.phase === "Reserved") {
              // Numbered intent may be durable while its sender never launched.
              yield* boundary(() => persist({ ...record, phase: "Stopped" }, false))
              return
            }
            // Even a previously stopped record is checked for token-bearing escaped children.
            const stopAt = (yield* Effect.clockWith((clock) => clock.currentTimeMillis)) + senderStopBudgetMillis
            for (let attempt = 0; attempt < senderStopPollLimit; attempt += 1) {
              const members = yield* boundary(() => census(record))
              if (members.length === 0) {
                yield* boundary(() => persist({ ...record, phase: "Stopped" }, false))
                return
              }
              yield* boundary(async () => {
                for (const member of members) {
                  try {
                    const current = parseLinuxProcessStat(member.pid, await native.readFile(`/proc/${member.pid}/stat`))
                    if (current?.startIdentity !== member.startIdentity) continue
                    native.kill(member.pid, "SIGKILL")
                  } catch (error: unknown) {
                    if (!absent(error)) return Promise.reject(error)
                  }
                }
              })
              if ((yield* Effect.clockWith((clock) => clock.currentTimeMillis)) >= stopAt) {
                return yield* new GitSenderCustodyFailure()
              }
              yield* native.wait(senderPollMillis)
            }
            return yield* new GitSenderCustodyFailure()
          })
      })
    })
  ).pipe(Layer.provide(NodeCrypto.layer))
}
