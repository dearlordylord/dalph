# Reject unsafe production-host path relationships

Issue: [Reject unsafe production configuration and derive exact planned-attempt locations](https://github.com/dearlordylord/dalph/issues/292)

Status: accepted as the concrete path-overlap case in issue #259 Scenario 1 and
issue #292's accepted configuration boundary.

## Governing behavior

The decision here is whether one complete raw production-host configuration may
continue past decoding when a required-disjoint pair of path fields is equal or
stands in an ancestor relationship. It is governed by [Scenario 1: Invalid
configuration opens no
live boundary](https://github.com/dearlordylord/dalph/issues/259): that accepted
scenario requires the whole value to be decoded before an acquired production
Layer exists, with one typed safe failure and no durable or external effect.
The issue page has no stable `#issue-*` section anchor, so the issue URL and the
scenario name are the direct reference.

The boundary-specific owner is [D37a Complete host configuration validation
precedes every live boundary](../DELIVERY-INVARIANTS.md#run-boundaries): it
requires the complete value to be checked before a live boundary exists,
rejects equal or real-ancestor paths only in the path families that the host
requires to be disjoint, accepts sibling text prefixes, and forbids external
or durable effects during validation. Repository/common-directory equality is
intentionally valid because those two locators are not compared by the host's
cross-field predicate. Its executable evidence is the exact path tests named
below.

The adjacent planned-attempt codec amendment preserves [D1 Exact identity on
every action](../DELIVERY-INVARIANTS.md#identity) and [D2 Attempt
immutability](../DELIVERY-INVARIANTS.md#identity): equal `(RunId, TaskId,
ordinal)` inputs keep one exact location set, distinct identities do not alias,
and workflow-owned attempt facts remain unchanged. This scenario does not reach
attempt planning, reinterpret either invariant, or create a second location
authority.

The governing executable evidence is [`production-configuration.test.ts`](../../packages/dalph/src/application/production-configuration.test.ts):
`rejects filesystem-root and trailing-separator parent overlaps before any
live-boundary continuation`, `accepts disjoint paths whose names share only a
text prefix`, `derives equal locations for equal Run/task/ordinal inputs
strictly beneath the root`, `does not alias distinct Run, task, or task-local
ordinal identities`, and `keeps fresh ordinals task-local and consumes exact
replacement Base and ordinal`. No separate model law covers host path
semantics.

This #292 scenario preserves #259's fail-before-live-boundary, safe-error, and
retry-as-a-new-invocation behavior; it refines that behavior only by making
filesystem-component overlap (including `/` and a trailing separator) and
sibling-prefix acceptance concrete; and it supersedes nothing. The added scope
is the pure cross-field path predicate and its positive/negative test cases. It
adds no filesystem operation, mutation, retry protocol, or new location
authority.

## A containing path spelling cannot bypass startup validation

### Starting facts and trigger

Alice invokes the configured production host with one complete raw
configuration. In one rejected case a configured worktree root is the
filesystem root. In another it ends in a path separator and contains the other
worktree root, repository, or private-state locator. No coordinator lock,
SQLite connection, Codex process, GitHub request, Git command, Journal row,
worktree, or provider-private record exists for this invocation.

A separate valid configuration uses sibling names such as `/srv/dalph/work`
and `/srv/dalph/work-archive`. Their shared text prefix is not a filesystem
parent relationship. The repository and common-directory locators may also be
equal; that Git layout is valid and is outside the required-disjoint path
families.

### Ordered result, crash, retry, and visible outcome

1. The host decodes each absolute path and compares path components using the
   host platform's `node:path` semantics.
2. Equality or a real ancestor relationship is overlap for a required-disjoint
   pair regardless of whether the ancestor is the filesystem root or ends in a
   path separator. The host returns the typed configuration failure before
   constructing a live Layer. Repository/common-directory equality remains
   valid because that pair is intentionally not compared.
3. A mere sibling-prefix match is not overlap, so the otherwise-valid sibling
   configuration completes decoding.

Validation performs no external call or durable write. A crash during it leaves
nothing to reconcile; retrying the same invalid bytes returns the same failure,
and Alice may correct the path and invoke the host again.

Alice sees an actionable, credential-free configuration error for a real
required-disjoint overlap and a successful decode for disjoint siblings. Dalph
must not treat `/` as containing no paths in a required-disjoint comparison,
let a trailing separator hide an ancestor, reject one sibling solely because
its name begins with the other's text, or open any live boundary after a
required-disjoint overlap.

### Forbidden-result mapping

[D37a Complete host configuration validation precedes every live
boundary](../DELIVERY-INVARIANTS.md#run-boundaries) owns all four prohibitions:
the schema cross-field check `hostPathRelationships` rejects `/` and trailing
separator ancestors only for required-disjoint path pairs, accepts sibling
text prefixes, leaves the live continuation unopened for every rejected
overlap, and leaves repository/common-directory equality valid. The exact tests
`rejects filesystem-root and trailing-separator parent overlaps before any
live-boundary continuation` and `accepts disjoint paths whose names share only
a text prefix` prove those negative and positive cases. D37a also owns the
no-external-call/no-durable-write result. The credential-free error is the #259
safe-error rule and is enforced by `rejects %s before any live-boundary
continuation` and `decodes one complete value with branded locations and
redacted credentials` in the linked test file. The adjacent exact-location and
attempt-fact constraints are the named D1/D2 rules and the codec tests listed
in Governing behavior, not new rules in this scenario.

### Acceptance-test mapping

- `rejects filesystem-root and trailing-separator parent overlaps before any live-boundary continuation`
- `accepts disjoint paths whose names share only a text prefix`
