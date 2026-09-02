# Prove exact causal active-work refresh in the maintained cassette

Owning issue: [#267](https://github.com/dearlordylord/dalph/issues/267)

Status: issue #267 was closed after composition on `integrate/issues-264-268`
through exact commit `a1b81c4fbcd189d62b480d6e637c62278ca7b829`. The
maintained proof remains a required handoff gate. The reviewed post-Safe G2
boundary repair now makes the unchanged maintained
proof green. A focused run passed 1/1; its observed 533 ms test duration is
execution evidence, not an acceptance bound or timing invariant. The
cassette-owned proof exposed one missing composition of
already-accepted #265/#266 behavior:
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
focused B read F1 and G1 causes focused B read F2. Dalph selects and starts F1
first, then selects F2; F2 returns first and F1 returns last. At the controlled
tracker boundary, each result is consumed only by
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
- `authored-active-work-causal-sync.test.ts` — “selects F1 then F2 and pairs
  reverse-completing reads with their exact initiating operations”
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
  timer hints then retains B1 until its exact safe report”; the unchanged
  required composed proof is green with the reviewed post-Safe G2 boundary
  repair

## A reactivation-owner interaction failure exits as the same defect

The first coordinator process dies after its accepted work is executing. A
fresh process starts the current-first production Run reactivation owner. In
the controlled malformed-interaction case, the cassette expects a different
exact boundary from the boundary that the production workflow selects. The
controlled trace boundary creates one `TraceOutputError` for that mismatch.

The production reactivation owner passes that exact error to `onFailure`.
`onFailure` completes the generation's exact in-memory failure signal. The
generation can observe terminal assertions, an authored coordinator process
death, or that owner failure. Before waiting, it samples one initial selection
cut in fixed order: owner failure, then an atomic nonblocking process-death
poll, then terminal eligibility. If neither higher-priority signal is ready,
terminal, non-consuming process-death peek, and owner failure may wake the
generation. After any wake, a second selection cut samples owner failure and
then atomically polls process death again. Only when neither is ready may a
terminal wake return `TerminalAssertions`. When owner failure is ready at
either cut, the generation exits through `Die` with the same `TraceOutputError`
object. It does not convert the defect to a typed `Fail`.

The two cuts do not claim one transactional snapshot across the independent
failure, queue, and terminal primitives. The fixed precedence applies to
signals observable at the initial cut or the post-wake cut. A signal that
becomes ready only after the post-wake cut is causally later and cannot
retroactively replace the selected outcome. The process-death peek is only a
wake signal; an interrupted losing peek consumes nothing. The atomic poll
consumes the exact death signal only when failure is absent and death wins.

It is forbidden to swallow the owner failure, wait indefinitely for terminal
assertions, report a successful terminal or process-death outcome, convert the
failure to a typed error, or replace the exact defect with a new wrapper. The
failure signal and the three-way outcome selection are process-local cassette
harness state. They add no Journal event, provider call, runtime authority,
retry, or person-facing boundary. A fresh test run constructs a fresh owner
generation and a fresh signal; no crash-resume promise applies to this
malformed harness interaction.

Acceptance tests:

- `authored-runner-policy.test.ts` — “ends one reactivation-owner generation
  at terminal assertions”
- `authored-runner-policy.test.ts` — “ends one reactivation-owner generation
  at an authored process death”
- `authored-runner-policy.test.ts` — “propagates one reactivation-owner
  failure as the same defect”
- `authored-runner-policy.test.ts` — “prefers an owner defect when all
  reactivation-owner outcomes are already ready”
- `authored-runner-policy.test.ts` — “prefers authored process death when
  death and terminal assertions are already ready”
- `authored-runner-policy.test.ts` — “prefers an owner defect that becomes
  ready with the terminal wake”
- `authored-runner-policy.test.ts` — “prefers authored process death that
  becomes ready with the terminal wake”
- `authored-active-work-causal-sync.test.ts` — “surfaces a
  reactivation-owner interaction defect before terminal assertions”

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
another Executing projection cannot release B1. The cassette names a later
passive lifecycle change separately from an explicitly requested executor
projection, so only B1's attached owner can consume exact B1 Safe or Terminal.
That observation is published through the ordinary report protocol, releases B1, and permits the
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
The pending capstone-only settlement and restart cuts are owned by the
dedicated [#268 scenario](issue-268-delivery-story-capstone.md), not by this
closed #267 scenario.

## Scenario-to-test mapping

| Chronological result | Direct proof |
|---|---|
| Raw operation and predecessor identities enter through the real trace seam | `authored-active-work-causal-sync.test.ts`, trace-seam test |
| F1 is selected before F2 while F2 completes before F1, preserving exact initiating operations | `authored-active-work-causal-sync.test.ts`, reverse-completion test |
| Missing, crossed, foreign, and duplicate ownership fails closed | `authored-active-work-causal-sync.test.ts`, fail-closed test |
| Repeated concurrent schedules drain one surrounding story position | `authored-active-work-causal-sync.test.ts`, repeatedly-forked test |
| Unchanged executing and foreign attempts do not release B1 | `authored-active-work-causal-sync.test.ts`, executing and exact-owner tests |
| Exact B1 Safe or Terminal releases B1 | `authored-active-work-causal-sync.test.ts`, exact-owner test; `delivery-proposal-routes.test.ts`, exact production adapter regression |
| Tracker causality does not change ordinary requested executor-projection consumption | `authored-active-work-causal-sync.test.ts`, causal-only requested-projection test |
| A terminal assertion or authored process death ends one reactivation-owner generation with its exact successful outcome | `authored-runner-policy.test.ts`, individual terminal and process-death tests |
| At both initial and post-wake selection cuts, ready owner defect wins over process death, and ready process death wins over terminal; death is consumed only when selected | `authored-runner-policy.test.ts`, all-ready and death-plus-terminal initial-cut tests; owner-defect-with-terminal-wake and process-death-with-terminal-wake post-wake tests |
| A malformed post-death boundary completes the owner failure signal and exits through `Die` with the same `TraceOutputError`, never typed `Fail` | `authored-runner-policy.test.ts`, individual same-defect test; `authored-active-work-causal-sync.test.ts`, malformed-interaction test |
| Current notification wins Startup, later hints coalesce into one trailing refresh, real G1/F1/F2 run, B1 releases only after exact Safe, and the post-Safe G2 handoff completes | `authored-active-work-causal-sync.test.ts`, unchanged maintained composed cassette test, green with the reviewed G2 boundary repair |

Historical closure evidence for commit
`a1b81c4fbcd189d62b480d6e637c62278ca7b829` included 194/194 combined
#267/#269 focused tests, 2,726 repository tests, 35 model-based tests, all 92
maintained cassettes, 100% changed executable coverage, and the gitleaks scan.
That historical result alone did not make the maintained composed row green.
The current reviewed candidate adds the owner-outcome and malformed-interaction
proofs above and passes the unchanged maintained coalescing cassette 1/1. The
observed 533 ms focused test duration records that run only; correctness does
not depend on that duration.
