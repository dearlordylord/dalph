const uuid = {
  bytes: 16,
  versionOffset: 6,
  variantOffset: 8,
  versionMask: 0x0f,
  version4: 0x40,
  variantMask: 0x3f,
  rfcVariant: 0x80,
  radix: 16,
  byteWidth: 2,
  firstEnd: 8,
  secondEnd: 12,
  thirdEnd: 16,
  fourthEnd: 20
} as const

/** UUIDv4 correlation identity usable on ordinary HTTP as well as secure origins. */
export const browserRequestId = (crypto: Pick<Crypto, "getRandomValues">): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(uuid.bytes))
  bytes[uuid.versionOffset] = ((bytes[uuid.versionOffset] ?? 0) & uuid.versionMask) | uuid.version4
  bytes[uuid.variantOffset] = ((bytes[uuid.variantOffset] ?? 0) & uuid.variantMask) | uuid.rfcVariant
  const hex = Array.from(bytes, (byte) => byte.toString(uuid.radix).padStart(uuid.byteWidth, "0")).join("")
  return [
    hex.slice(0, uuid.firstEnd),
    hex.slice(uuid.firstEnd, uuid.secondEnd),
    hex.slice(uuid.secondEnd, uuid.thirdEnd),
    hex.slice(uuid.thirdEnd, uuid.fourthEnd),
    hex.slice(uuid.fourthEnd)
  ].join("-")
}
