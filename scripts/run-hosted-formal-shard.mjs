import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"

import { runQuintEffectiveProfile } from "./check-quint-models.mjs"
import { assertQuintHostedDeadlineContract } from "./quint-gate-policy.mjs"
import { assertQuintHostedCommandCustody, readQuintHostedShardBinding } from "./quint-hosted-shards.mjs"

const parseArguments = (args) => {
  if (args.length !== 4 || args[0] !== "--shard" || args[2] !== "--report") {
    throw new Error("Hosted formal shard requires --shard <number> --report <path>")
  }
  const shard = Number(args[1])
  if (!Number.isInteger(shard)) throw new Error("Hosted formal shard number must be an integer")
  return { shard, reportPath: args[3] }
}

const { reportPath, shard } = parseArguments(process.argv.slice(2))
assertQuintHostedDeadlineContract(await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8"))
const report = await runQuintEffectiveProfile({ hostedShard: shard })
assertQuintHostedCommandCustody(report)
const envelope = {
  version: 1,
  binding: readQuintHostedShardBinding(),
  profileDigest: report.shard.profileDigest,
  shard: report.shard.shard,
  shardCount: report.shard.shardCount,
  report
}
await mkdir(dirname(reportPath), { recursive: true })
await writeFile(reportPath, `${JSON.stringify(envelope)}\n`, { flag: "wx" })
