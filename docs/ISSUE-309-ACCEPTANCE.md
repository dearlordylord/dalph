# Issue #309: causal cassette acceptance

Alice authors exact boundary occurrences and their causal predecessors. Dalph's
controlled cassette consumes an enabled occurrence once when production calls
that boundary, while the production workflow and authorities remain unchanged.
This handoff covers the accepted [issue #309](https://github.com/dearlordylord/dalph/issues/309)
and its later comment that kept closure open until the complete seven-task story
and Lab/browser evidence passed.

## Scope and review

The reviewed implementation is on local `master` at `675bfd5ec1ade261a7d694512de9a93b343705bd`.
The final Lab/browser repair is test, command, and documentation code. It
changes no Dalph runtime decision, external boundary, or journal record.
Causal windows use in-memory frontiers; sequential parts retain strict order.
The internal `DeliverySemanticTrace` is absent from the orchestrator package
barrel, and cassette cursor/source/tests contain no `Effect.yieldNow`
ownership or settlement window.

| Accepted result | Direct evidence |
| --- | --- |
| Independent A–E pipelines admit opposite valid interleavings while graph → specification → plan → worktree order remains strict within each task | `authored-active-work-causal-sync.test.ts`: “replays independent A-E boundary chains in opposite valid interleavings”; `authored-causal-graph.test.ts`: “accepts opposite topological orders of independent boundary chains” and “rejects an early boundary with its exact unmet predecessor” |
| A call consumes only one enabled exact occurrence; same-shaped calls cannot select by array order or confuse attempt, task, or operation identities | `authored-causal-graph.test.ts`: “rejects two enabled same-shaped occurrences instead of picking array order”; `authored-active-work-causal-sync.test.ts`: “reports a same-kind attempt identity mismatch inside a causal window”, “selects F1 then F2 and pairs reverse-completing reads with their exact initiating operations”, and “fails closed for missing crossed foreign and duplicate causal relationships” |
| Invalid IDs, predecessors, repeated edges, cycles, premature calls, duplicate consumption, and unfinished required nodes fail closed | `authored-causal-graph.test.ts`: invalid-graph, early-boundary, duplicate-consumption, and unconsumed-node cases; `authored-domain.test.ts`: schema validation before playback; `authored-active-work-causal-sync.test.ts`: duplicate ID and ambiguous enabled-read controls |
| Sequential stories retain exact order; `sequence` and `parallel` authoring produce only declared edges | `authored-causal-graph.test.ts`: strict adjacent predecessor and composed sequence/parallel cases |
| The #267 reverse-read owner and #268 admission cut run through the same production-composition cassette | `authored-active-work-causal-sync.test.ts`: exact reverse ownership and A Begin before/after B/C worktree cases; `pnpm test:integration:capstone` passed 3 files / 8 tests on the merged local tree |
| The complete seven-task chronology retains status, cleanup, recording, and replay evidence | `pnpm test:integration:capstone` passed in 70.87s on 2026-10-01; `pnpm check:lab:browser:capstone` completed 441/441 authored items, rendered three exact status reads, and proved a fresh Run on rerun |
| Maintained recording, catalog, Lab, and browser consumers remain usable | `pnpm test:recorded-catalog` passed; `pnpm check:lab` passed typecheck, maintained-cassette smoke, and build; comprehensive `pnpm check:lab:browser` passed; `pnpm check:lab:browser:causal` passed exact occurrence identity |
| Changed source and quality selection remain coherent | `pnpm check:fast` passed typecheck, changed lint, and 14/14 selection fixtures; the standalone formal profile passed all 127 commands at clean candidate `48bcd91450eb5cc43c53baa04ac6aad695ee03ea` in 10m43s. Later commits changed no formal source. |

The focused graph/cursor/domain suite passed 64/64 tests on the merged tree.
The formal run ID is `9da7f180-4e9e-4536-974b-ae0d177c7bc1`; its custody
is stopped. No local `check:all` or hosted S1 was used as a substitute for
these scenario checks.

## Qualification cost control

Routine causal matcher edits use `pnpm check:lab:browser:causal`, which runs
the exact browser occurrence case. Capstone Lab changes use
`pnpm check:lab:browser:capstone`. Shared Lab navigation or browser harness
changes use the comprehensive `pnpm check:lab:browser` manually. This keeps
the broad browser catalog available while avoiding its unrelated UI
assertions on each matcher edit. The browser harness now compares declared
completion counts and traverses to the terminal landmark instead of pinning
historical story size or a fixed landmark ceiling.

Issue comments explicitly moved the remaining production Effect audit work
to #413 (Journal publication yield), #414 (bounded lossless runtime mailbox),
and #319 (progress watchdog). Those do not replace or defer any #309 causal
matcher, capstone, or Lab/browser proof above.

## Focused repair of CI run 36890906141 — 2026-10-01

The retained coverage artifact binds CI candidate
`53aa42d60883b922d17d1fa0f2c7aab3cf85d0fb`; this follow-up starts from the
owner's exact clean Base `2faafee0fbe9653956c9ffb61e264270465fc389` in isolated
`fix/issue309-ci-fixtures-r1`. The artifact's structured `failedTestFiles`
identifies the seven affected files. Its stage log truncates individual failure
details; no missing host log or unobserved passing result receives credit.

The initial local focused reproduction observed nine failures in four of those
files, including the literal story-29 replacement/graph mismatch and DS14–17
`[46,54,92]` versus `[46,54,69,78,100]`. The two static consumers independently
reproduced their failures. The shared singleton prefix explains the four
normal-termination and two outstanding-work failures as well as its direct
scenario failure. These repairs change test fixtures and evidence consumers
only: no production decision, boundary implementation, journal rule, authority,
or causal matcher is changed.

| Shared cause / accepted requirement | Repair and decisive focused evidence |
| --- | --- |
| Promoted A must read fresh complete graph, immutable specification and exact claim before replacing its active claim; the singleton fixture skipped these six boundary items (seven affected tests across scenario, normal termination and outstanding work). | `complete-singleton-delivery.ts` now supplies those exact reads before replacement, matching `readPostPromotionFinalityPremises`. `scenario.test.ts`: “settles a promoted authored task through the real completion-claim boundary”; the normal and recovery `normal-termination.test.ts` tests and both `outstanding-work.test.ts` tests pass. Existing foreign-identity, absence, finality and cleanup assertions remain. |
| A completion claim already present does not authorize retroactive replacement intent (one definite-deletion rejection case). | The deletion-rejection fixture uses `RestartReplacement`, explicitly recording the earlier intended replacement before reconciling its existing exact marker. `scenario.test.ts`: “replays definite completion-claim boundary rejections as terminal typed failures” passes, retaining exact failure tag, calls and journal tags. |
| Baseline Git reads use the pinned invocation Base H1, while replacement lineage uses immutable H2 (three promoted-successor tests). | The shared provider observation is keyed to the original invocation Base and still reports current H2; its separate lineage responses and successor plan retain H2. The diagnostic observed `EstablishRemoteBaseline` followed by repeated release/acquire proposals and no Integrator boundary. All five `integration-finality-protocol-cassette.test.ts` cases pass, including both omission controls and exact replacement identity/correlation checks. |
| Recovery finality legitimately adds PostPromotionFinalityCheck then AttemptContinuation; a copied happy-path graph after claim replacement is not another recovered prerequisite (two DS14–17 tests). | One bounded diagnostic captured every cause/activation/position for all six CAS-to-successor cuts. The expectations retain exact positions, causes and activation identities with both required reads added. Recovery after `CompletionClaimReplaced` removes only the copied later graph pair while retaining fresh activation-entry authority and focused completion. Both restart titles and the full `delivery-story-capstone.execution.test.ts` file pass. |
| The accepted manual capstone declaration uses `.skipIf(!runIntegrationCapstone)` (one manifest-link test). | The declaration audit recognizes precisely that opt-in form while retaining exact file, declaration and test-name lookup. The merged toolkit repair also names any missing beat and test reference. All three `delivery-story-link.test.ts` tests pass; catalog, manifest and beat mappings remain checked. |
| X rereads its instructions for active continuation and post-promotion finality (one residual chronology test). | The residual tag projection was removed because it duplicated the stronger executed ten-task test, “consumes a staggered graph while restart-added X waits for recovered capacity.” That retained test checks X specification, recovered capacity and final settlement and passes. No accepted scenario mapped to the removed projection. |

Final exact seven-file verification without coverage passed **217/217** in
**52.88s** (`/tmp/issue309-exact-seven-repaired.log`). Individual diagnostic
receipts are retained under `/tmp/issue309-*`, including
`all-restart-graph-causes.log`, `replacement-stall-diagnostic.log`,
`replacement-owner-diagnostic.log`, `replacement-baseline-repair.log`,
`restart-exact-controls.log` and `static-consumers-repaired.log` with the
`issue309-` prefix. Temporary diagnostic hooks were restored before verification.

Scoped review dispositions: resolved omitted fresh-authority fixture prefix;
resolved absent prior intent in the recovery fixture without weakening runtime
ownership checks; resolved provider-Base versus successor-Base conflation;
resolved stale restart graph inventory without deleting required fresh reads;
resolved guarded declaration lookup and removed duplicate X projection. These are evidence
alignment findings, not production safety waivers. Existing exact identity,
negative omission, resource, cleanup, one-Run and finality assertions remain.
No accepted requirement is deferred. No broad gate, coverage run, hosted retry,
manual capstone Run or new formal proof is claimed by this follow-up.

Final Base-pinned `check:fast` passed typecheck, changed-file lint and 14/14
selection fixtures (`/tmp/issue309-ci-fixtures-final-fast.log`).
`git diff --check` passed. Scoped review is closed for Churny's isolated
fixture/test repair and this evidence update; his commit changes no toolkit or
production implementation.

Codex integrated the four non-overlapping fixture changes into the toolkit
candidate. The two static consumer fixes above come from the earlier toolkit
commits, which also remove the duplicate X projection. On the resulting
combined tree, `pnpm check:submit` passed: typecheck, changed lint, full lint
census and 49 in-memory cassette files (529 passing tests, five skipped;
71.55 seconds for the cassette suite). The earlier 217/217 focused result
belongs to Churny's pre-integration repair commit; this combined-tree result
supersedes it for local readiness. The merged candidate has no production
behavior change. A fresh hosted qualification is still required for closure.
