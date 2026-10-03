/* eslint-disable import/no-nodejs-modules -- Tests exercise the exact local network boundary. */
import { RunId } from "@dalph/contracts"
import { it } from "@effect/vitest"
import { Effect, Option, Ref } from "effect"
import { expect } from "vitest"
import { callRunningHost, readRunningHostDescriptor } from "./running-host-client.js"
import { runningHostLimits } from "./running-host-contract.js"
import { availableLocalHostAddress, makeRunningHostReadProbe } from "../../test-support/running-host-read-probe.js"
import { serveRunningHost } from "./running-host-http.js"

it.live("HTTP reads remain passive, reject wrong identities and malformed bytes, and respect Exit admission", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { closing, current, failure, observation, reads, runId } = yield* makeRunningHostReadProbe()
      const address = yield* availableLocalHostAddress
      const listening = yield* serveRunningHost(address, observation)
      expect(yield* readRunningHostDescriptor(address)).toEqual(listening.descriptor)
      expect(yield* callRunningHost(address, runId, { _tag: "ReadSnapshot" })).toMatchObject({
        result: { _tag: "Success", value: { _tag: "NotReady", runId } }
      })
      expect(yield* callRunningHost(address, RunId.make("wrong"), { _tag: "ReadRunControl" })).toMatchObject({
        result: { _tag: "Failure", error: { _tag: "RunMismatch" } }
      })
      expect(yield* Ref.get(reads)).toBe(0)
      expect(yield* callRunningHost(address, runId, { _tag: "ReadRunControl" })).toMatchObject({
        result: { _tag: "Success", value: { _tag: "RunUnpaused", terminationEvidence: { _tag: "Pending" } } }
      })
      const post = (body: string | Uint8Array) =>
        Effect.promise(async () => {
          // eslint-disable-next-line no-restricted-globals -- This test sends deliberately malformed bytes across the real local HTTP boundary.
          const response = await fetch(`${address}/dalph/v1/request`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body
          })
          return response.json()
        })
      const request = {
        protocolVersion: 1,
        hostInstanceId: listening.descriptor.hostInstanceId,
        requestId: "request",
        runId,
        operation: { _tag: "ReadRunControl" }
      }
      for (const invalid of [
        { ...request, root: "override" },
        { ...request, hostInstanceId: "stale" },
        { ...request, protocolVersion: 2 }
      ]) {
        expect(yield* post(JSON.stringify(invalid))).toMatchObject({ result: { _tag: "Failure" } })
      }
      expect(yield* post(new Uint8Array([0xff]))).toMatchObject({
        result: { _tag: "Failure", error: { _tag: "InvalidRequest" } }
      })
      expect(yield* Ref.get(reads)).toBe(1)
      const sizingRequest = { ...request, requestId: "", operation: { _tag: "ReadSnapshot" } }
      const fixedBytes = new TextEncoder().encode(JSON.stringify(sizingRequest)).byteLength
      const exactRequest = { ...sizingRequest, requestId: "x".repeat(runningHostLimits.requestBytes - fixedBytes) }
      expect(yield* post(JSON.stringify(exactRequest))).toMatchObject({
        result: { _tag: "Success", value: { _tag: "NotReady" } }
      })
      expect(yield* post(JSON.stringify({ ...exactRequest, requestId: `${exactRequest.requestId}x` }))).toMatchObject({
        result: {
          _tag: "Failure",
          error: { _tag: "FrameTooLarge", direction: "Incoming", maximumBytes: runningHostLimits.requestBytes }
        }
      })
      expect(yield* Ref.get(reads)).toBe(1)
      yield* Ref.set(current, { _tag: "Closed", final: null })
      expect(yield* callRunningHost(address, runId, { _tag: "ReadSnapshot" })).toMatchObject({
        result: { _tag: "Success", value: { _tag: "Closed", runId, final: null } }
      })
      yield* Ref.set(failure, Option.some({ _tag: "WorkflowRunTerminationEvidenceInvalid", runId }))
      expect(yield* callRunningHost(address, runId, { _tag: "ReadRunControl" })).toMatchObject({
        result: { _tag: "Success", value: { _tag: "RunUnpaused", terminationEvidence: { _tag: "FinalityFailed" } } }
      })
      expect(yield* Ref.get(reads)).toBe(2)
      yield* Ref.set(closing, true)
      expect(yield* readRunningHostDescriptor(address).pipe(Effect.flip)).toMatchObject({ _tag: "HostClosing" })
      expect(yield* Ref.get(reads)).toBe(2)
    })
  )
)

it.live("a missing explicit host fails without discovery or a production acquisition", () =>
  Effect.gen(function* () {
    const { runId } = yield* makeRunningHostReadProbe()
    const address = yield* availableLocalHostAddress
    expect(yield* readRunningHostDescriptor(address).pipe(Effect.flip)).toMatchObject({
      _tag: "HostUnavailable",
      address
    })
    expect(yield* callRunningHost(address, runId, { _tag: "ReadSnapshot" })).toMatchObject({
      result: { _tag: "Failure", error: { _tag: "HostUnavailable" } }
    })
  })
)
