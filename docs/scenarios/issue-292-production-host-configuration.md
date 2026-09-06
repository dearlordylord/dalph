# Reject unsafe production-host path relationships

Issue: [Reject unsafe production configuration and derive exact planned-attempt locations](https://github.com/dearlordylord/dalph/issues/292)

Status: accepted as the concrete path-overlap case in issue #259 Scenario 1 and
issue #292's accepted configuration boundary.

## Governing behavior

This scenario refines issue #259's **Invalid configuration opens no live
boundary** scenario and its #292 planned-attempt codec amendment. It makes the
already-accepted overlapping-path case literal; it does not add a filesystem
operation, mutation, retry protocol, or new location authority.

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
parent relationship.

### Ordered result, crash, retry, and visible outcome

1. The host decodes each absolute path and compares path components using the
   host platform's `node:path` semantics.
2. Equality or a real ancestor relationship is overlap regardless of whether
   the ancestor is the filesystem root or ends in a path separator. The host
   returns the typed configuration failure before constructing a live Layer.
3. A mere sibling-prefix match is not overlap, so the otherwise-valid sibling
   configuration completes decoding.

Validation performs no external call or durable write. A crash during it leaves
nothing to reconcile; retrying the same invalid bytes returns the same failure,
and Alice may correct the path and invoke the host again.

Alice sees an actionable, credential-free configuration error for a real
overlap and a successful decode for disjoint siblings. Dalph must not treat
`/` as containing no paths, let a trailing separator hide an ancestor, reject
one sibling solely because its name begins with the other's text, or open any
live boundary after an overlapping value.

### Acceptance-test mapping

- `rejects filesystem-root and trailing-separator parent overlaps before any live-boundary continuation`
- `accepts disjoint paths whose names share only a text prefix`

