import { join } from "node:path"

// A slot admits one heavy gate run at a time. Concurrent agents share the repository's cores, so the whole-program
// gates take a slot before they start while the focused tiers run unadmitted.
export const gateSlotEnvironmentName = "DALPH_GATE_SLOT"
export const gateSlotCountEnvironmentName = "DALPH_GATE_SLOTS"
export const defaultGateSlotCount = 2

export const resolveGateSlotCount = ({ configured }) => {
  if (configured === undefined || configured === "") {
    return defaultGateSlotCount
  }
  const parsed = Number.parseInt(configured, 10)
  if (!Number.isInteger(parsed) || parsed < 1 || String(parsed) !== configured.trim()) {
    throw new Error(`${gateSlotCountEnvironmentName} must be a positive integer, received ${configured}`)
  }
  return parsed
}

export const gateSlots = ({ lockDirectory, slotCount }) =>
  Array.from({ length: slotCount }, (_unusedEntry, index) => ({
    fence: join(lockDirectory, `dalph-gate-slot-${index + 1}.fence.json`),
    lock: join(lockDirectory, `dalph-gate-slot-${index + 1}.lock`),
    ordinal: index + 1
  }))
