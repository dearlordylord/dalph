/**
 * Independent accepted #315 fresh-task admission command identities. This
 * literal oracle deliberately does not derive from the production manifest:
 * changing both the runner and its manifest must not redefine accepted work.
 */
export const acceptedFreshTaskAdmissionQuintGateCommandKeys = Object.freeze([
  "typecheck\u0000fresh-task admission model typecheck",
  "test\u0000fresh-task admission deterministic tests",
  "test\u0000fresh-task admission negative mutation profile",
  "sampled-run\u0000fresh-task admission sampled model",
  "typecheck\u0000fresh-task admission proof projection typecheck",
  "test\u0000fresh-task admission capacity proof deterministic tests",
  "test\u0000fresh-task admission capacity proof negative mutation profile",
  "sampled-run\u0000fresh-task admission capacity proof sampled model",
  "verify\u0000fresh-task admission capacity proof exhaustive model",
  "test\u0000fresh-task admission ambiguity proof deterministic tests",
  "test\u0000fresh-task admission ambiguity proof negative mutation profile",
  "sampled-run\u0000fresh-task admission ambiguity proof sampled model",
  "verify\u0000fresh-task admission ambiguity proof exhaustive model"
])
