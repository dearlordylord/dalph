import { expect, it } from "vitest"

// @ts-expect-error The repeatability runner is an executable JavaScript test-support module.
import { runDeliveryRepeatability } from "../../../../scripts/run-delivery-repeatability.mjs"

const deliveryRepeatabilityTimeout = 18 * 60_000

it(
  "repeats the complete delivery checkpoint table twenty times with identical observed order",
  async () => {
    const result = await runDeliveryRepeatability()
    expect(result).toMatchObject({
      acceptedOrderDigest: "6df6b575b41d4ea07d3ac083725cd54b0ddf29fb925936dfd7f1c85a5d90b5c8",
      iterations: Array.from({ length: 20 }, (_, index) => ({
        acceptedOrderDigest: "6df6b575b41d4ea07d3ac083725cd54b0ddf29fb925936dfd7f1c85a5d90b5c8",
        iteration: index + 1,
        occurrenceCount: 1_010,
        status: "PASS"
      })),
      occurrenceCount: 1_010
    })
  },
  deliveryRepeatabilityTimeout
)
