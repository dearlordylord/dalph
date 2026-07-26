# Handoff: close the capacity-one formal-evidence gap in issue #131

Use the `implement`, `quint-modeling`, `quint-lang`, `property-based-testing`,
and `code-review` skills. Work on `master` with pnpm.

## Objective

Implement only the genuine capacity-one formal/model-to-code evidence missing
from [Derive the runnable frontier and bounded admission](https://github.com/dearlordylord/dalph/issues/131).
Do not absorb the production activation loop from issue #132, waiter ownership,
changed-capacity restart, pause commands, or the executor-boundary migration.

The control document is
[the issue #131 uncertainty audit](../issue-131-uncertainty-audit.md). Read its
current control section and the issue's live ticket-boundary amendment.

## Required result

- The frontier-recovery Quint model has a genuine capacity-one checking profile
  with at least two independently eligible tasks.
- Capacity remains a process-local/configured projection, never journal
  authority.
- The bounded-admission invariant uses the profile's configured limit.
- A deliberately weakened capacity rule yields the expected counterexample.
- Quint-connect executes the production selector/controller at capacity one and
  compares model-exported transition, reservation, operation, and explanation
  identities without hard-coded scheduler expectations.
- Fresh-memory and closed/reopened SQLite capacity-one lanes remain passing.
- The canonical specification and reconstruction coverage inventory say
  exactly which capacity-one behavior is checked.
- Re-run domain/spec, architecture/connascence, and strict code review until no
  reasonable finding remains, then run `pnpm check:all`.

Return the commit(s), exact model profiles, focused test commands, final gate
output, review dispositions, and any rejected finding with its concrete reason.
Do not mark the ledger item resolved; update its proof field and leave
issue-owner acceptance to the owner.
