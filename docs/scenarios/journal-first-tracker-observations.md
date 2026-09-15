# Issue 164: journal-first tracker observations

No person directly triggers these events. A running Dalph coordinator, the
configured task tracker, and Dalph's workflow journal are the relevant systems.
Git, executor sessions, worktrees, and cleanup do not participate before an
attempt is planned.

## A graph read cannot authorize work before the journal append

The tracker contains open task A and no existing claim, worktree, executor
session, or journaled observation for A. Dalph selects a complete target-closure
read, records the exact read intent, and asks the tracker for identity,
lifecycle, prerequisites, grouping, and target membership. If Dalph crashes
after the tracker returns but before the normalized observation is appended,
restart sees only the intent and exposes no claim or planning work. Retrying
may repeat the provider read but must not reuse the lost return.

If Dalph appends the complete observation and crashes before selecting the
frontier, restart decodes the journal, reconstructs the graph, and may select A
without calling the provider again for the completed operation. No person sees
work before the append; after restart they may see A progress once. Dalph must
not infer facts from the abandoned process memory or duplicate the recorded
read outcome.

Acceptance test: `a crash before append authorizes no work; restart after
append reconstructs facts and only a later observed completion releases B` in
`task-tracker-facts.test.ts`.

## One logical read spans several tracker moments

The tracker contains tasks A and B, and B depends on A. Dalph records one graph
read intent and the adapter may make several outside requests while the tracker
changes. If every requested family is complete, covers the same target and
subjects, and contains no detectable contradiction, Dalph appends one
provider-neutral, potentially mixed-time observation. A crash after the append
replays that observation; a retry of the completed operation reuses it.

If a family is incomplete, names different subjects or freshness, omits an
explicitly requested task, or the reconstructed graph is contradictory, Dalph
exposes no schedulable graph or recoverable responsibility. A person can see
progress only from the valid case. Dalph must not persist provider pages or
select work from the invalid case.

Acceptance tests: `a potentially mixed-time complete read is schedulable only
when every fact family is complete and consistent` and `rejects canonical facts
whose target contradicts the initiating logical read` in
`task-tracker-facts.test.ts`.

## A fresh read finds unchanged facts

An earlier complete observation for the target is durable. Dalph records a new
read intent and asks the tracker for comparable coverage. The tracker returns
the same normalized content. Dalph appends one compact reconfirmation naming
the earlier full observation and carrying the later per-family freshness and
coverage. If Dalph crashes after that append, restart proves the later check and
reconstructs the earlier payload. Retrying the completed operation reuses the
reconfirmation and does not append another full graph.

Why Dalph asked for the graph does not affect this comparison. For example,
one read may precede a decision about A and a later read may precede a decision
about B. If both reads return the same complete target graph, they are the same
graph result for caching: the later observation is an unchanged reconfirmation.
The initiating operations may separately explain why each read occurred, but
that explanation is not tracker fact content and does not create a different
observation kind or cache identity.

If the reconfirmation names no earlier full observation in the same run, names
one that occurs later, or disagrees with the earlier observation's target,
content identity, or subjects, the complete journal history is invalid. The
history reducer fails before returning reconstructed run state, so Dalph cannot
continue from unrelated records or expose a partial graph. There is no
person-visible change for unchanged facts, and Dalph must not create delta
chains or accept a false reconfirmation.

Acceptance tests: `a fresh unchanged read records later freshness compactly and
restart reuses the earlier full facts` (including whole-history rejection for
invalid references) and `reconfirms unchanged generated graphs compactly while
preserving reconstructable facts`.

## Focused instructions and completion acknowledgement

After a fresh graph observation and claim, task A is still eligible. Dalph
records a focused read intent for A, asks the tracker for A's exact normalized
title and body, appends those facts and their fingerprint, reconstructs them
from the journal, and only then plans the attempt. Comments are not read. A
crash before the append cannot plan A; a crash after it reuses the exact
focused observation without another provider call. The person sees an attempt
bound to that title/body fingerprint, never instructions inferred from graph
facts.

Separately, if a request to mark A complete returns an acknowledgement while B
depends on A, the acknowledgement changes no reconstructed lifecycle and B
stays blocked. Dalph must read the graph again and append an observation that
reports A completed before B can become eligible. A crash or retry cannot turn
the acknowledgement itself into completion evidence. No Git or executor
boundary applies until the later observation authorizes planning.

Acceptance tests: `replays a focused read from its canonical journal
observation without calling the provider again`, `records exact normalized
title and body only through the focused attempt read`, and `a crash before
append authorizes no work; restart after append reconstructs facts and only a
later observed completion releases B` in `task-tracker-facts.test.ts`.
`replays exact task-fact choices and recovery through production journal and
authority seams` in `task-fact-reconciliation.mbt.test.ts` proves that restart
requires the focused read, waits for its outcome if unresolved, and permits
planning only after the focused title/body observation is durable.
