# Issue #69: exact durable-resource cleanup dispositions

Status: accepted implementation scenarios for #69.

This ticket adds three provider-neutral cleanup families. Each family owns its
authorization, fresh observation, mutation request/result, contradiction, and
terminal settlement events. A family never reuses another family's locator or
approval.

The planned-attempt `Settled` compatibility shape is not an authority source:
the journal currently has no canonical terminal settlement event for a planned
attempt. `TargetLineageObserved`, executor reports, and a cleanup family's own
settlement are not interchangeable terminal witnesses, so a caller supplying
only that shape is preserved with zero boundary calls. `Superseded` and
`Abandoned` remain eligible only when their exact durable events, keys, Run, and
causal witnesses are reconstructed.

## Alice restarts a changed task

Alice's tracker has an exact claim for P1. The journal records first-choice-wins
Restart, P1 is safely suspended and terminal, and a replacement P2 is planned.
Git still has P1 worktree W1 and branch B1 at the authorized head. P2 uses a
different worktree and branch. No executor writes P1.

On ordinary activation, Dalph records a worktree authorization naming the exact
terminal disposition, W1, P1's owner, the last Git observation and revision,
the operation identity, and writer quiescence. It records a fresh observation
intent before reading Git. Matching W1 facts permit one bounded remove request;
the result is recorded afterward. Only after a later fresh read proves W1
absent and B1 still has the authorized head does Dalph authorize and attempt
branch deletion. P2 continues.

If the process dies after authorization, a read intent, a mutation intent, or
an outside mutation before its result, restart reconstructs the same subject,
reads Git first, and retries only when matching facts still hold. Confirmed
absence settles without a delete call. Unknown, unreadable, contradictory,
foreign, moved, unregistered, or live-writer facts preserve W1/B1, P2, journal
history, and evidence.

Acceptance tests: `worktree.test.ts` exact removal, response-loss
reconciliation, and bounded requests; `branch.test.ts` worktree-settlement
gate; `worktree.property.test.ts` locator/owner/disposition/revision table.

## Git owner or locator changes after authorization

After the authorization above, a fresh Git read reports B1 at another head,
W1 on another branch, an unregistered path, or incomplete authority facts.
Dalph records a family-specific contradiction and sends zero remove/delete
calls. Replaying the old authorization is not approval for the changed owner,
locator, head, or revision.

Acceptance test: the foreign observation case in `worktree.test.ts`, the branch
foreign-observation case in `branch.test.ts`, and the property/table test.

## FullRerun creates a successor Integrator

The journal records a quarantined predecessor S1/C1, then FullRerun creates a
fresh head and successor S2/C2. No provider activity writes C1 during cleanup.
Dalph authorizes only C1, reads C1's exact locator, S1 owner, writer-quiescence
fact, and observation revision, then deletes C1 only when those facts match.
S1 history/evidence, C2, and the live successor remain untouched. A lost
response is reconciled by a fresh read; absence settles, while changed/live or
unavailable facts preserve C1.

Acceptance tests: `integrator-candidate.test.ts` predecessor-only and live
writer cases, plus the recorded cassette catalog.

## Current quarantine has no terminal disposal

When a current quarantine has no FullRerun successor and no terminal disposal
occurrence, Dalph has no cleanup responsibility and makes no boundary call.
The current session and evidence remain available. The
`isCleanupEligibleDisposition` negative control proves that quarantine alone
cannot manufacture authorization.

Acceptance test: the current-quarantine negative control in
`worktree.test.ts`.

## Formal-model coverage decision

No Quint model is changed for #69. The existing subject-scoped models cannot
faithfully represent three distinct authority families with exact locators,
owner observations, mutation intents, and revisions: `taskFactReconciliation`
models P1/P2 and tracker-claim release only; `gitReconciliation` has no
locator/intent/delete protocol; `acceptedResultIntegration` records candidate
resources but no disposal; `integrationFinality` deletes only tracker claims;
and `applicationExit` deliberately requires `durableCleanupCalls == 0`.
Focused property tests, composed cassettes, and memory/SQLite P0-P6 replay are
the positive evidence; existing model negative controls remain regression
evidence, not positive coverage.
