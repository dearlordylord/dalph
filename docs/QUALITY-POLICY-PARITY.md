# Quality-policy parity for issue #212

This inventory compares the quality harness at `b5662cbf` (the parent of the
TypeScript 7/Oxlint migration) with the restored harness. It is a policy
inventory, not a request to preserve obsolete package choices. Every policy
that remains effective has one owner so Oxlint and the compatibility pass do
not report the same fact twice.

## Tooling-only operational scenario

A maintainer or CI runner starts from a checkout containing authored Dalph
TypeScript, TSX, JavaScript-module tooling, and root TypeScript/JavaScript
configuration. The maintainer changes a file or stages a change and runs the
repository gate. The gate reads the checkout, discovers the explicit file set,
asks Oxlint, the narrow ESLint compatibility pass, dprint, and the Effect
diagnostic command to inspect it, and prints a bounded pass or typed failure.
No Dalph command, GitHub request, Git operation, executor session, worktree,
or workflow-journal record is created: these checks only read source files and
return process status. There is therefore no Dalph runtime operational
scenario, crash recovery, retry protocol, or external authority reread to
model. Re-running after a process interruption repeats read-only inspection;
it must not infer that a runtime action happened. The visible result is a
successful gate or a failure naming the file and policy, and warnings intended
to gate the repository are failures.

Forbidden results are a missing authored file, an accepted warning, an
unbounded diagnostic stream, a staged check that omits a hard policy, or a
quality-harness change that alters Dalph runtime behavior.

## Policy-to-owner inventory

| Migration-era policy | Restored owner | Evidence or deliberate exception |
| --- | --- | --- |
| TypeScript array, comments, duplicate enum values, empty object, `any`, floating promises, namespace, wrapper, assertion, switch, and declaration-merging checks | Native Oxlint TypeScript rules | `.oxlintrc.json`; type-aware mode remains enabled. |
| `no-array-constructor`, expressions, vars, `var`, shorthand, const/rest/spread, console, magic numbers, max lines | Native Oxlint rules | Warnings are denied by the repository and staged commands. |
| Import ordering, duplicate imports, and Node-module boundary | Native Oxlint import rules | Explicit source/config discovery feeds the same command. |
| Ambient globals (`crypto`, `fetch`, `globalThis`, `performance`, `process`, timers), clock reads, module mocks, canonical Effect imports, type assertions, double assertions, inheritance, restricted imports, and destructuring order | Custom Oxlint `dalph` rules | `scripts/oxlint-project-plugin.mjs`; fixture tests cover direct, computed, namespace, destructured, and both assertion AST forms. |
| Production immutable-data policy (warning before migration) | ESLint compatibility `functional/immutable-data`, warning denied as fatal | Tests are the historical deliberate exception; the compatibility command uses `--max-warnings 0`. Existing migration-boundary findings are enumerated in `eslint-functional-suppressions.json`; new findings are not accepted. |
| Mixed-type declaration rejection | ESLint compatibility `functional/no-mixed-types` | Type-aware rule has no native Oxlint equivalent. |
| Type-declaration immutability | ESLint compatibility `functional/type-declaration-immutability` | Type-aware rule has no native Oxlint equivalent; the pre-migration identifier patterns are retained. |
| Tacit-function preference | ESLint compatibility `functional/prefer-tacit` | Oxlint has no equivalent; the pre-migration error severity is retained. |
| Functional `no-this`, `no-try`, mixed-type, and declaration-immutability rules | ESLint compatibility functional rules | They are type-aware and not represented by a native Oxlint rule; the compatibility pass retains the pre-migration recommended severity. |
| Functional-parameter, no-return-void, class, conditional, expression, let, loop, and prefer-immutable-types rules | Explicitly retained parent exceptions | The parent configuration already disabled these rules for the repository; the parity inventory records the retirement instead of silently implying they are gated. |
| Throw restriction in production source and typed tests | ESLint compatibility `functional/no-throw-statements` | Production source and typed tests retain the error. Only host-tooling scripts are exempt because they own process boundaries; existing migration-boundary throws are finite entries in `eslint-functional-suppressions.json`, not a new-test exemption. |
| Whole-project unused production exports | ESLint compatibility `import-x/no-unused-modules` | The graph includes authored package and tooling modules plus test consumers; `src/index.ts` and each package `src/index.ts` are the narrow public entry-point exceptions. A finite migration-boundary count of already-exported declarations is recorded in `eslint-functional-suppressions.json`; new unconsumed declarations are unsuppressed failures and the fixture test proves that path. |
| Effect language-service diagnostics | `effect-tsgo diagnostics --strict --severity error,warning` plus strict `tsc` | `scripts/run-effect-diagnostics.mjs` owns the warning-fatal JSON pass. Current test-only `multipleEffectProvide` and `unnecessaryEffectGen` suppressions remain only where measured test composition requires them; `lazyEffect` stays suggestion-only. The rationale is in `docs/DEVELOPMENT.md`. |
| Formatting | dprint OXC plugin | Explicit `.js`, `.mjs`, `.ts`, `.tsx`, and root `*.config.{js,mjs,ts,tsx}` discovery; fixture files are excluded only because they intentionally contain forbidden syntax and are linted by their own harness. |
| Circular dependencies, complexity, duplication, package boundaries, memory, MBT, coverage, and secrets | Existing dedicated gates | Their command ownership is unchanged; the quality gate still enforces the 400 successful-output-line budget. |

The compatibility config loads `eslint-plugin-import` only so existing inline
`eslint-disable import/no-nodejs-modules` directives remain recognizable while
the native Oxlint rule owns that policy; the compatibility rule itself is off.

## Scenario-to-test mapping

- `quality file discovery includes authored TS, TSX, MJS, and root configs`:
  `scripts/quality-file-discovery.test.ts` proves stable cross-platform paths
  and the fixture exclusion, plus a temporary-root case for TSX and root MJS
  configuration discovery.
- `custom Oxlint rules reject forbidden constructs and allow safe forms`:
  `scripts/oxlint-project-plugin.test.ts` runs Oxlint against checked-in
  fixtures and parses diagnostics through Effect Schemas. Cases include
  direct and computed mock calls, namespace and destructured imports, ambient
  capability bypasses, and both `as` and angle-bracket double assertions.
- `repository and staged lint fail on warnings`:
  `scripts/quality-lint.test.ts` invokes the public lint runner against a
  warning fixture and a staged-file-shaped subset, proving warning denial and
  compatibility-pass participation.
- `compatibility pass restores functional and unused-export policies`:
  `scripts/quality-lint.test.ts` runs the same public runner against functional
  and unconsumed-export fixtures and checks the intentional package-entry
  exceptions.
- `Effect warning severity is explicit and fatal`:
  `scripts/effect-diagnostics.test.ts` runs the dedicated diagnostics command
  against a controlled Effect diagnostic at both error and warning severity and
  asserts the nonzero status under `--strict --severity error,warning`; the
  clean fixture proves bounded output.
- `quality gate keeps successful output bounded`:
  existing `scripts/quality-output-budget.test.ts` remains the acceptance seam,
  and `scripts/quality-lint.test.ts` asserts clean output stays compact.
