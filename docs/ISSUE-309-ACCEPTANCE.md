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
