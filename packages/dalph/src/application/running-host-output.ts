/* eslint-disable import/no-nodejs-modules -- This boundary owns cancelable process-local output descriptors. */
import { fstatSync } from "node:fs"
import { Socket } from "node:net"
import process from "node:process"
import type { Writable } from "node:stream"

let stdout: Writable | undefined
let stderr: Writable | undefined

/** Node's special process.stdout/stderr destroy methods cannot cancel queued
 * pipe writes. An owned Socket gives those descriptors real cancellation;
 * regular files and terminals retain Node's native synchronous output path. */
export const runningHostNodeOutput = (channel: "stdout" | "stderr"): Writable => {
  const existing = channel === "stdout" ? stdout : stderr
  if (existing !== undefined) return existing
  const native = channel === "stdout" ? process.stdout : process.stderr
  const status = fstatSync(native.fd)
  const destination =
    status.isFIFO() || status.isSocket() ? new Socket({ fd: native.fd, readable: false, writable: true }) : native
  if (channel === "stdout") stdout = destination
  else stderr = destination
  return destination
}
