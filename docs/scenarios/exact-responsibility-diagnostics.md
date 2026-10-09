# The Operator reads an exact unresolved responsibility

Accepted scope: [parent O1](https://github.com/dearlordylord/dalph/issues/491).
The Operator reads current production status while one retained attempt cannot
settle because executor, tracker or Git evidence is unavailable or contradictory.
The current status entry keeps its existing subject and obligation reference.
Its safe summary names the boundary, constraint, missing proof, relevant accepted
evidence and permitted observation or exact Operator direction. A claim-release
wait also names the exact observation operation. Reading conveys no permission to
retry an uncertain mutation.

## Governing behavior

This preserves [passive status](actionable-failure-diagnostics.md),
[Pause progress](observe-pause-progress.md),
[local task isolation](localize-task-conflicts.md), and the owning
[executor reconciliation](planned-attempt-executor-boundary.md),
[claim reconciliation](reconcile-task-claims.md) and
[Git reconciliation](reconcile-git-facts.md) protocols.
The additional summaries change presentation only. They add no workflow decision,
authority call, journal event, timeout, ETA, or recovery authorization. Existing
tracker fact/wake, conflict identities, explicit rejected-result recovery and
safe/terminal settlement variants remain the vocabulary for those outcomes.

## Chronology and acceptance mapping

1. Dalph already retains an exact attempt and accepted executor progress. The
   executor's next owned observation is unavailable or names foreign work.
   The existing protocol records an unavailable/contradictory observation;
   the Operator reads status. The executor lifecycle remains executing until
   an exact accepted safe or terminal report changes it. A repeated identical
   observation, another task, or another immutable plan cannot advance the
   summary. Restart rederives it from the same accepted history. Test:
   `retains exact unavailable and contradictory evidence without changing executor lifecycle or borrowing foreign facts`
   in `delivery-diagnostics.test.ts`.
   `keeps exact Git and claim evidence families separate and redacts authority-private content`
   in the same file proves authority-family separation and target matching. Existing
   `duplicate lifecycle observations do not advance substantive progress`
   covers duplicate accepted reports.
2. An exact executor, Git worktree or tracker claim constraint prevents task A
   from advancing while an independent task B has a live action. The Operator
   attaches through the production current-first status boundary. Dalph only
   projects supplied accepted observations: it names A's exact correlation,
   boundary and typed proof requirement, preserves B's live action, and excludes
   provider-private detail. Repeating the read has the same result. Test:
   `explains exact unresolved responsibility evidence through passive production status`
   in `production-cli.test.ts`.
   `joins only accepted evidence for the exact immutable responsibility and required operation`
   in the same file rejects another task, Base or observation operation as an
   evidence source. Existing public projection tests
   `localizes unavailable evidence without blocking an independent task` and
   `localizes contradictory evidence without blocking an independent task` in
   `delivery-status.test.ts` own the unchanged isolation rule.
3. The exact accepted safe report arrives after a contradictory observation.
   The summary changes to that safe evidence; it does not claim delivery or
   authorize cleanup. The same diagnostics test in step 1 proves this transition.
   Existing status and Pause acceptance tests own the safe-boundary confirmation
   and terminal settlement variants. No external request is retried by this read,
   and there is no observer-owned durable state to recover after a crash.

The public production snapshot and CLI use the same projection. The existing
`projects and encodes all twelve status variants through the production current-first attachment`
and `production status rendering has no tracker Git executor Integrator Journal mutation admission retry cleanup control or Exit capability`
in `production-cli.test.ts` prove serialization and the passive capability boundary.
Unavailable evidence cannot release responsibility (D17, D20 and D29 in
[delivery invariants](../DELIVERY-INVARIANTS.md)); only the governing protocols
can accept the required evidence and change the retained responsibility.
