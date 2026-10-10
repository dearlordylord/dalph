# Issue 513 Started Retry qualification

The Run owner reconstructs the authorization before Started and validates the
current Git lineage independently against the full accepted history. Current
invalidation stays fail-closed. The repair changes only the outer authorization
validator; native custody, session, token and retained-merge owners are unchanged.

Planned Base: `3b5e51dd3ce201310b457748e8ddd20a406a15da`.
An ordinary `git merge --no-edit 31c330d9` fast-forwarded this prepared native
leaf to qualified #512 `31c330d9b5732f8c076edbad6aeccab8a54b8702`, including #511
`7c7d0bc133e6b430a604c773d437318384e8771d`. No packaging pin changed in this leaf.
All Node and pnpm checks used `mise exec --`.

## Source and artifact binding

[Sources](issue-513/sources.json) bind the exact changed runtime/fixture files
and reused #512/#511 runtime boundaries by SHA-256.
[Results](issue-513/results.json) bind commands, outcomes and retained logs.
[Native inventory](issue-513/native-records.json) binds unchanged external raw
private records and fixture files by exact locator/hash. Private tokens are not
rewritten or checked into Git; no scanner bypass is used.
The [scenario mapping](../scenarios/started-integrator-retry-lineage.md) maps
P1/P2/P3 to named tests and refusal branches rather than relying on totals.

The actual Codex protocol fixture uses a disposable repository and isolated
provider home. It does not touch original #501 C, candidates, task worktrees,
journal or private state. Original rejection diagnostics remain retained
externally, including `501-retry-resume-lineage-boundary.json` and
`501-started-retry-lineage-reproducer.json`. Neither implies a provider result.

## Diagnosis and limits

The first protocol fixture failed because it modified only an exported record
copy, not the live accepted journal. The next failure matched decoded records by
object identity; canonical position matching repaired the negative oracle.
The first native fixture failed before run-two admission because the Effect
constructing direction control was not evaluated. Typecheck and production
build also found the helper under production source; moving it to test support
closed that boundary. The strengthened native replay assertion then incorrectly
required an unchanged entire private record; reconnecting legitimately updates
the observed process incarnation and record revision. Exact run-history/token
equality and immutable session/path/thread facts replace that assertion, while
both raw snapshots remain retained. Exact generated files from the failed build were inventoried
externally and removed. All failures remain diagnostic evidence, not passing
qualification. Focused repairs precede each affected rerun.

The accepted integration model and obligations are unchanged. Focused model
Retry tests and runtime conformance checks qualify the existing abstraction;
no fresh exhaustive proof or new formal certification is claimed. The full gate
and original #501 capacity/submission checks were explicitly excluded.

This leaf acceptance precedes tracker delivery. The parent native owner stops
this host before publication, adds repair-publication blocked-by #501 only after
qualification, and builds the isolated runtime preview from the Accepted exact
candidate plus the existing packaging-only Codex 0.162.1 pin. It reactivates
original #501's already-authorized run2 without another direction, then publishes
this repair and #512/#511 through their own native Runs, reconciles cleanup and
completes #491. Never add #501 blocked-by this repair. The parent completion edge
is a tracker fact owned by the parent; this evidence does not claim it was added
by the leaf or claim the parent delivery suffix completed.

## Qualified outcomes and review boundary

The six selected files passed 182 tests on the final source bytes. P1's native
protocol reopen passed in 58.51 seconds: required documentation exits [2,0,0]
(first failure repaired before retained run-one sealing), runtime exits [0,0],
unchanged failed optional diagnostic, exact [H,C] parents, and Absent stopped
custody. The initial native token is absent before admission; recorded run-two
history/tokens remain identical on reopen. Process incarnation and private
revision legitimately change; the raw snapshots preserve those observations.
P2's named contradictions and unchanged native refusal controls passed. P3's
initial admission, Started replay and human numeric Retry tests passed.

Artifact preparation, Base-scoped fast qualification, docs, unchanged model
Retry typecheck/eleven deterministic tests and four selected production-backed
conformance tests passed separately. The exact qualified candidate receives a
fresh same-model, medium-reasoning scoped reviewer before Accepted. Review
receipt and candidate identity are retained externally under this issue's
`evidence/leaf-review/`; no parent publication or full-gate success is inferred.


## Parent review repair: canonical FullRerun S2/run2

The parent Spec review identified missing explicit S2/run2 proof in the first
candidate: its positive protocol/native fixtures used S1/run2. A new named
successor-session regression constructs accepted FullRerun history and canonical
`IntegratorSuccessorSessionFixed`, then original S2 Q/D/L/Started and a fresh
post-Started request-bound L. It proves one admission and conclusive replay,
with wrong predecessor, successor, requested session and predecessor-result
refusals on this path. All 15 successor-session tests passed. The native fixture
remains honestly scoped to S1/run2; its exact source/runtime hashes are unchanged.
No source-runtime or model change was needed for this test-proof repair, so the
passing native/artifact/model evidence remains bound to the same source bytes.
The added test receives a fresh Base-scoped fast check, docs check, source/test
hash binding and fresh two-axis review. No original #501 resource was changed.
