export interface GateSlot {
  readonly holder: string
  readonly lock: string
  readonly ordinal: number
}

export declare const gateSlotEnvironmentName: string
export declare const gateSlotCountEnvironmentName: string
export declare const defaultGateSlotCount: number

export declare const resolveGateSlotCount: (input: { readonly configured: string | undefined }) => number

export declare const gateSlots: (
  input: { readonly lockDirectory: string; readonly slotCount: number }
) => ReadonlyArray<GateSlot>

export declare const shouldAcquireGateSlot: (input: { readonly occupiedSlot: string | undefined }) => boolean
