# Integrated archived-history acceptance

Dalph's existing exclusive host owner retains compact completion records while
bounding eligible archived details by 30 elapsed UTC days and 268,435,456 saved
bytes. Parent [#487](https://github.com/dearlordylord/dalph/issues/487) accepts
the combined #488–#490 implementation at runtime candidate
`e4df385372542c3b231917f29c53636ce327d925`, the immutable Base of this parent
attempt. The tracker reported all three dependencies closed on 2026-10-09;
Git integrates their changes at that Base. Subsequent parent changes update
documentation and evidence only; they cannot change Dalph runtime behavior.

The [named machine-readable results](issue-487-results.json) bind the candidate,
environment, selected files and individual passing tests. The
[scenario register](../scenarios/archived-run-expiry.md#combined-parent-evidence-ledger)
owns the detailed scenario-to-test mapping. All fourteen scenarios below passed
at those seams on 2026-10-09; a suite total alone supplies no scenario credit.

| Parent scenario | Passing named evidence on the integrated candidate |
| --- | --- |
| 1: Independent completion | `completion.test.ts`: **memory/SQLite keeps the same compact terminal result before and after archive retirement**, plus both completion commit-cut/reopen tests. |
| 2: Exact age boundary | `archive-retention.test.ts`: **memory/SQLite expires complete terminal histories at the 30-day boundary and preserves aged unfinished responsibilities**. |
| 3: Saved bytes and order | **enforces saved archive bytes by whole-Run completion order, equality, and oversized histories** and the generated **removes age-expired units before pressure units and preserves exact quota equality for generated storage facts** property. |
| 4: Oversized whole Run | **memory/SQLite deletes an oversized eligible Run as one unit using actual saved bytes**. |
| 5: Protected unfinished work | Shared exact-age test; `store.test.ts` canonical nonterminal/obligation rejection; **the owning startup retires aged terminal Hot history before expiry and preserves unrelated unfinished work**. |
| 6: All dispositions | Both store contracts: **expires Completed, Blocked, and Cancelled by identical rules and preserves exact receipts**; canonical finality negative cases. |
| 7: Purge crash/reconciliation | The three **SQLite reconciles archive purge … commit and acknowledgement loss after physical reopen** cases: before mutation, before commit, after commit. |
| 8: Overlap and honest reads | **SQLite distinguishes expired details from unknown Run across overlapping reads**; shared exact-age cached TraceReader assertions and Available-history TraceReader/retirement regressions. |
| 9: Identity remains closed | Both **rejects a completion-only Run before evaluating policy or constructing activation** / **rejects a reopened completion-only SQLite Run before constructing activation** tests; shared Begin/append/termination/recovery/mismatch assertions. |
| 10: Failure and unrelated work | **the owning host observes one storage failure without retrying before the next normal pass**; **reports deferred excess at a failed storage boundary without immediately retrying**; both terminal-Hot startup failure tests and physical purge cuts. |
| 11: Conservative legacy adoption | **backfills legacy completion receipts without inventing dates or losing histories**; both backfill commit-cut tests; invalid and contradictory completion tests; reopened startup and malformed-Hot cases. |
| 12: Owned finite passes | **bounds archive maintenance and honestly reports an expired backlog for later ordinary passes**; **stops archive selection at exactly one second and progresses on a later pass**; both host scheduler tests; **the SQLite host yields between archive units and graceful Exit stops at an atomic boundary**; physical startup and competing-owner tests. |
| 13: Completion-only public result/audit | **public terminal inspection keeps the exact result after idle scheduled expiry while the host remains open**; shared completion-only audit and cached-cursor assertions; contradictory receipt negative cases. |
| 14: Logical accounting | Actual saved-codec byte assertions in both shared age and oversized-history tests; physical purge/reopen accounting and complete-history codec regressions. Logical success requires no SQLite file shrink or VACUUM. |

## Qualification and review boundaries

The parent selected thirteen explicit owner/consumer files with one Vitest
worker. Twelve files passed initially; the physical restart case in
`production-host.test.ts` failed because this prepared dependency-only worktree
lacked its built fixture. Building with
`mise exec -- pnpm --filter @dalph/dalph... build` passed, then all 32 tests in
that owner file passed. No source or assertion changed. The initial failure is
retained in the results, rather than represented as a passing aggregate run.
Each selected test now has direct passing evidence on the unchanged runtime
candidate.

Parent documentation qualification: `mise exec -- pnpm check:docs` passed
with zero link errors; `git diff --check` passed. The repository formatter
selects code files only, so Markdown/JSON evidence uses the existing document
and two-space JSON conventions.

The child submission log `/tmp/490-submit-final.log` reaches its completed
49-file cassette summary: 508 passed, 21 skipped. It also contains artifact
preparation, formal controls, `check:fast` and full lint census. The child
candidate `96f044a4b162e7a84b2c98d08c9653bd4e0e70d7` has exactly the same Git
tree as the integrated runtime candidate; the results record that comparison
and retained log hashes. This is retained child evidence, not a newly executed
parent submission gate. Documentation-only parent changes do not repeat
unchanged broad checks. The earlier SQLite cache-lifetime failure remains
documented in the scenario register; the parent's four scan-retention checks
passed with tracing enabled.

The glossary, Journal architecture, D32/D35, establishment and public read
contracts preserve finality and current tracker/Git/executor authority.
Maintenance changes detailed-history availability without a workflow event or
new Quint action. Existing generated activation/cancellation and Exit
conformance evidence and corpus controls are retained with log hashes; this
parent changes no formal inputs. Deleted history is a typed unavailable
outcome, never an old successful historical snapshot containing empty events.

Physical SQLite and HTTP fixtures use controlled clocks and hermetic providers.
The transaction cuts prove the named boundaries, not every possible power-loss
interleaving. This acceptance makes no full local gate, hosted CI, live-provider,
total-disk-cap or full-evidence-reconstruction claim. It deletes no existing
Operator archive. Compact results remain recorded observations, not today's
external authority.
