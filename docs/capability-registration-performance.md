# Capability-registration performance

Issue [#343](https://github.com/dearlordylord/dalph/issues/343) concerns a
maintainer running the complete capability-registration check and exceeding
its existing 60-second quality-stage deadline. The accepted baseline is
`6edb884b23321d6c58c1a56d7d648aae245b19f4`.

This is repository verification tooling only. The changed files under
`scripts/` inspect source text; they neither construct nor import Dalph's
providers, services, or runtime. No workflow decision, provider request,
journal fact, recovery rule, or public runtime output changes.

## Repeated work and scope

The baseline already reused exact source trees across changed root sets. It
nevertheless scanned those trees again for every declaration lookup, contract
call lookup, and runtime-reference query. A CPU profile of five unchanged
audits contained 8,470 samples: runtime-reference filtering accounted for
2,001 inclusive samples and declaration lookup for 1,121. These totals describe
separate query paths, not all work performed by the check.

The audit now indexes declaration names, call markers, and runtime references
once per exact TypeScript source tree. The declaration index retains the
first declaration in traversal order; call lists and runtime references retain
their original traversal order. Each lookup still applies the original
selector, symbol-origin, role, registration, and diagnostic rules.

The weak tree index contains syntax only. A reused tree may have different
bindings after an imported source changes, so symbols, exports, compiler
diagnostics, and final findings are not stored there. The existing tree-reuse
boundary requires identical paths and complete source text.

Compiler construction and dependency scanning also share TypeScript's module
resolution cache within one Program. Every new Program creates a fresh cache,
including when roots are added or removed. Dependency scanning still examines
all required imports and references; this changes repeated lookups, not the
dependency denominator.

No source root, inventory registration, composition, provider fixture, rule,
negative control, diagnostic severity, or quality-stage deadline is removed
or changed. The existing bounded latest/largest Program retention remains.
The audited inventory contains 745 source files (14,823,140 UTF-8 bytes),
16 capability families, 32 implementations, 33 contract executions,
27 composition records, and 49 support bindings. Its JSON SHA-256 digest is
`c6a5ee83b1ecaccc1b241443381535f6c774385b3ec135ae072fd31e1b1d1527`.

## Acceptance mapping

| Maintainer action or source change | Required result | Test evidence |
| --- | --- | --- |
| Audit identical source arrays repeatedly, including copied arrays | Reuse the same syntax index; return identical ordered findings | `indexes unchanged syntax once while resolving replacement exports in each current program` directly checks index-build counts and full finding arrays |
| Replace an imported Layer with an ordinary value, leaving its consumer text unchanged | Reuse consumer syntax but resolve its new binding and remove exactly the obsolete Layer finding | The same characterization checks the complete findings difference |
| Change the consumer's complete source text | Build exactly one new syntax index | The same characterization checks the build-count increment |
| Add/remove roots, exports, ambient declarations, import types, triple-slash references, dynamic imports, or require dependencies | Retain or recompute the original compiler diagnostics and registration findings | Existing source-tree, semantic-diagnostic, dependency, shadowing, and re-export negative controls in `capability-registration.test.ts` |
| Audit every registered implementation and its contract/composition evidence | Retain the complete inventory and reject every existing invalid fixture | All original 54 assertions plus the characterization; exact baseline/candidate findings comparison described below |
| Run the comprehensive quality harness | Run this audit once, retain the 60-second process-group bound, propagate failures, and continue only after success | `capability-registration-quality-gate.test.ts` and the existing bounded-runner policy assertion; actual bounded command qualification |

No Dalph runtime scenarios or Quint model/adapter changes apply. The final
comprehensive gate and hosted Node 24.20.0 qualification belong to the frozen
candidate; focused measurements do not substitute for them.

## Measurements and equivalence

Measurements use Node 24.20.0 on the shared local host. Load varies, so elapsed
times are observations rather than unit-test thresholds. The unchanged
baseline took 184.15 seconds and hit two existing 10-second test deadlines
under load. The syntax-index change passed the original 54 assertions in
64.16 seconds. Adding the Program-local resolution cache passed all 55
assertions in 57.38 seconds, and a subsequent CPU-profiled run passed in
41.03 seconds. The deterministic characterization checks eliminated work
independently of these timings.

A temporary diagnostic harness executed the exact baseline and candidate
for every audit invocation in the 55-test suite, comparing complete ordered
finding arrays with `assert.deepEqual`. All 67 comparisons passed. Summed
audit time in this paired run was 80.70 seconds for the baseline and 36.18
seconds for the candidate, a 55% reduction. The SHA-256 digest of the
concatenated JSON finding arrays was
`176c553b8a85952ef1113af1b2821addc0cecea1e58998c4e9e7f3d9b6c69c64`.
The diagnostic harness allowed time for both implementations; it is not a
bounded-stage qualification and was removed before final checks.

After removing that instrumentation, the ordinary 55-test command passed
through `runBoundedCommand(boundedQualityGateCommand(...))` with the checked-in
`capabilityRegistrationQualityGate` policy in 38.55 and 39.91 seconds on two
successive qualifications. After wrapping the host's filename canonicalizer
to retain its method binding, the final source passed again in 25.40 seconds.
Every run left at least 20.09 seconds under the unchanged 60-second bound.
Hosted qualification remains a separate acceptance requirement. The
registration inventory and stage-policy files have no diff from the exact
baseline.
