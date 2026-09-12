// Vitest supplies Vite's mode at collection time; plain Node has no such environment.
const vitestEnvironment = Reflect.get(import.meta, "env")
export const isCoverageMode =
  typeof vitestEnvironment === "object" &&
  vitestEnvironment !== null &&
  Reflect.get(vitestEnvironment, "MODE") === "coverage"
