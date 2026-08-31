# Prove exact causal active-work refresh in the maintained cassette

Owning issue: [#267](https://github.com/dearlordylord/dalph/issues/267)

Status: complete implementation candidate; integration review and closure are
pending. The maintained proof is cassette-owned and exposed one missing
composition of already-accepted #265/#266 behavior:
when Suspend returns the unchanged Executing projection, the ordinary passive
owner must remain attached to that exact attempt. The repair adds no provider
authority, refresh cadence, executor state, journal event, or presentation
behavior.

## Governing behavior

[#266](issue-266-active-work-authority-refresh.md) owns the production
notification/timer coalescing, ordinary journal-first tracker reads, and the
decision to request suspension. The accepted #254 amendment owns this
cassette conformance proof. Operation identities and predecessor identities
come from the ordinary workflow operation selected at the real trace seam;
the cassette neither generates nor persists them.

## Reverse completion does not cross two focused reads

Alice edits task B while B1 is executing. The task tracker publishes a
notification while its bounded timer also fires, and an independent
same-shaped tracker read is already running. The production owner from #266
coalesces the notification and timer into one active-work refresh; the
cassette does not model either hint as durable authority.

The ordinary workflow selects the independent complete graph read G0 and the
active-work complete graph read G1. Their raw operation identities are bound
to the cassette's symbolic `independent-G0` and `active-G1` roles. G0 causes
focused B read F1 and G1 causes focused B read F2. F2 and F1 return in reverse
order. At the controlled tracker boundary, each result is consumed only by
the exact initiating operation whose predecessor set names its graph read.
The active refresh therefore receives F2, while the independent operation
receives F1.

The visible result is a deterministic authored playback in which the two
results may arrive in either order and the surrounding story advances once
after both exact results drain. A missing operation identity, a missing or
foreign predecessor, an extra predecessor, a duplicate owner, or a second
result consumption fails with a typed cassette error. It is forbidden to use
array position, completion order, a private read ordinal, a second tracker
history, or a report-triggered refresh premise.

No person-facing boundary call is added: Alice's existing tracker edit is the
only person action. The causal matcher introduces no crash or retry behavior;
the maintained production composition below crosses an existing coordinator
process-death boundary governed by #265/#266 and the ordinary journal
protocols.

Acceptance tests:

- `authored-active-work-causal-sync.test.ts` — “binds authored roles at the
  real operation-selection trace seam”
- `authored-active-work-causal-sync.test.ts` — “pairs reverse-arriving
  same-shape B reads with their exact initiating operations exactly once”
- `authored-active-work-causal-sync.test.ts` — “fails closed for missing
  crossed foreign and duplicate causal relationships”
- `authored-active-work-causal-sync.test.ts` — “drains repeatedly forked
  exact read operations without resetting the story position”

## B1 releases only after its exact lifecycle changes

After F2 proves B changed, #266 requests suspension for B1 through the
ordinary executor protocol. Re-reading the already accepted executing report
is an unchanged process-local observation: it creates no authored report
ordinal and does not release B1. A report for another attempt likewise cannot
release B1. Only an exact B1 `ExecutorWorkSafelySuspended` or
`ExecutorWorkTerminal` observation permits the maintained story to proceed.

This part reuses the exact attempt correlation and passive-observation
behavior accepted and implemented by #265/#266. #267 may add cassette gates
and assertions around those existing boundaries, but may not create another
executor-status model or make tracker refresh depend on executor reports.

Acceptance tests:

- `authored-active-work-causal-sync.test.ts` — “reobserves B1 executing
  without advancing or manufacturing another report”
- `authored-active-work-causal-sync.test.ts` — “allows only B1 safe or
  terminal observations to consume B1's lifecycle result”
- `delivery-proposal-routes.test.ts` — “after Suspend returns Executing
  observes exact Safe and releases only that attempt”
- `authored-active-work-causal-sync.test.ts` — “coalesces notification and
  timer hints then retains B1 until its exact safe report”

## Maintained production chronology

The first coordinator has accepted A1 and B1 as executing, then its process
dies. A fresh process attaches the production Run reactivation owner to a
current tracker notification. That current value selects one active-work
refresh before Startup can replace it. The workflow reads shared graph G1,
then reads A's unchanged F1 and B's changed F2 with their exact immediate
predecessors. Only after G1 is selected does the cassette offer the later
notification/timer burst; the owner coalesces it into one trailing refresh.

The unchanged A path performs the ordinary claim, worktree, lineage, and
executing-observer checks. The changed B path requests exactly one Suspend for
B1. An unchanged Executing response retains B1 and its position while the
same-attempt passive owner waits. A foreign projection, a missing owner, or
another Executing projection cannot release B1. Exact B1 Safe or Terminal is
published through the ordinary report protocol, releases B1, and permits the
separate post-quiescence G2 read. When that activation returns, the four hints
produce exactly one trailing production refresh. That refresh sees only A
still executing, completes A's focused claim/Git checks, and performs its own
post-quiescence graph read; it neither rechecks safely suspended B nor requests
another Suspend. Repeated playback must drain all harness fibers and leave no
duplicate G1, F1/F2, Suspend, report ordinal, or second trailing activation.

The controlled active-refresh entry point changes composition capability only:
it lets dry-run, test, and production interpret the same workflow algebra with
their selected executor. The production wrapper still selects the live
executor and cleanup. Therefore this entry point introduces no new operational
scenario; the #265, #266, and #267 scenarios continue to govern its behavior.

## Scenario-to-test mapping

| Chronological result | Direct proof |
|---|---|
| Raw operation and predecessor identities enter through the real trace seam | `authored-active-work-causal-sync.test.ts`, trace-seam test |
| Reverse F2/F1 completion preserves exact initiating operations | `authored-active-work-causal-sync.test.ts`, reverse-arrival test |
| Missing, crossed, foreign, and duplicate ownership fails closed | `authored-active-work-causal-sync.test.ts`, fail-closed test |
| Repeated concurrent schedules drain one surrounding story position | `authored-active-work-causal-sync.test.ts`, repeatedly-forked test |
| Unchanged executing and foreign attempts do not release B1 | `authored-active-work-causal-sync.test.ts`, executing and exact-owner tests |
| Exact B1 Safe or Terminal releases B1 | `authored-active-work-causal-sync.test.ts`, exact-owner test; `delivery-proposal-routes.test.ts`, exact production adapter regression |
| Current notification wins Startup, later hints coalesce into one trailing refresh, real G1/F1/F2 run, and B1 releases only after exact Safe | `authored-active-work-causal-sync.test.ts`, maintained composed cassette test |
