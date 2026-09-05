const deeplyFreeze = <Value>(value: Value): Value => {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value
  for (const key of Reflect.ownKeys(value)) deeplyFreeze(Reflect.get(value, key))
  return Object.freeze(value)
}

/** Detached immutable evidence for authority that must not drift after validation. */
export const immutableSnapshot = <Value>(value: Value): Value => deeplyFreeze(structuredClone(value))
