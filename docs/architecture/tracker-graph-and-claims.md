# Tracker Graph and Claims

This page owns tracker-specific architecture: target closure, normalized graph
observations, coverage and freshness, mutation results, GitHub consistency
limits, named reads, and claim records.

## Target closure

A task-tracker target selects a grouping root or query. Its closure contains
the selected grouping descendants plus every transitive prerequisite required
to evaluate them. Grouping descendants of a prerequisite-only task remain
outside the closure unless the target selects them independently.

For example, if selected root `R` groups child `C`, `C` is blocked by `B`, and
prerequisite-only `B` groups `B1`, the closure contains `R`, `C`, and `B` but
not `B1`. The dependency edge requires Dalph to observe `B`; grouping alone
does not make `B1` part of this Run.

## Normalized observations

The tracker adapter returns one complete normalized observation for the named
read shape or a typed failure. It finishes every bounded page, decodes every
covered task and relation, and rejects detectable missing or contradictory
records before exposing graph knowledge.

Each successful observation declares:

- the exact subjects and fact families covered;
- completeness for those subjects and families;
- consistency evidence available from the provider;
- freshness evidence and content identity;
- the logical read identity that produced it.

Dalph records the observation before selectors consume it. Raw provider
records do not feed delivery directly. A later comparable observation replaces
knowledge only for the area and fact families it covers. An empty complete
blocker result removes earlier blocker edges; a task-only observation says
nothing about blockers.

Missing or incomplete coverage never proves absence. If two observations
conflict and the provider cannot prove which fact is newer for that family,
Dalph retains an explicit conflict for the exact subject and fact family. A
later focused read may resolve it. Journal position alone does not order
external facts.

See [ADR 0003](../adr/0003-policy-indexed-task-graph-reads.md) and
[ADR 0006](../adr/0006-retain-incomparable-task-graph-facts.md).

## Mutation results as graph evidence

Dalph is not restricted to explicit read responses when updating graph
knowledge. A successful tracker mutation result may update the graph view when
it returns normalized facts satisfying a named observation contract for
coverage, completeness, consistency, freshness, and replacement.

A bare acknowledgement that the tracker accepted or applied a request is not
enough. In particular, acknowledging a request to complete task `A` cannot by
itself establish completed lifecycle, release dependants, or prove Run
completion. Unless the response contains the required normalized evidence, a
later tracker observation must establish those facts.

The result follows the canonical tracker-observation evidence and reduction
rules rather than introducing a second graph-knowledge path. See
[ADR 0007](../adr/0007-fold-normalized-mutation-results-into-graph-knowledge.md)
and [issue 145](https://github.com/dearlordylord/dalph/issues/145).

## Named read shapes

The adapter exposes a closed set of read shapes earned by workflow use, such as
one task, one task's complete blocker relation, one task-work specification, or
one complete target closure. Dalph does not expose a speculative field bag or
general graph-query language.

Immediately before attempt planning, a focused task-work specification read
returns the exact normalized title and body and their content fingerprint. It
does not silently claim graph coverage. Conversely, a complete graph
observation need not copy authored title and body. The planned attempt binds
the authored-content fingerprint as its `TaskRevision`.

## GitHub consistency and bounds

GitHub Issue GraphQL exposes current issue fields and paginated `subIssues` and
`blockedBy` connections without a transaction-wide as-of revision. Dalph can
detect identity, pagination, repository, and parent contradictions, but a
concurrent edit can still produce a mixed-time observation that GitHub does not
make detectable.

Before a state-changing request whose validity depends on current graph facts,
Dalph performs the focused read required by that protocol. This is not a claim
that GitHub provides a transactional graph snapshot.

`Issue.updatedAt` can compare versions of one issue record. Dependency and
sub-issue connection edges do not expose an equivalent edge revision. A
`TrackerRevision` fingerprints normalized content read; it is not a provider
transaction revision or graph-wide freshness order.

The GitHub adapter bounds one target-closure observation to 1,000 distinct
tasks and ten pages for each `subIssues` or `blockedBy` connection. Crossing a
bound returns `ResourceLimitExceeded`; a partial graph is never published.
Provider requests use a bounded retry policy, and an exhausted logical read is
recorded as one failed read rather than one event per internal page attempt.

Provider references:

- [GitHub Issue GraphQL fields](https://docs.github.com/en/graphql/reference/issues)
- [GitHub GraphQL query limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api)
- [GitHub issue edit history](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/editing-an-issue)

## GitHub claim record

The GitHub adapter represents one active task claim as a repository label. Its
deterministic name is `dalph-claim-` followed by a bounded SHA-256 digest of the
opaque `TaskId`. The schema-versioned description contains the exact operation,
owner, and token within GitHub's label-description limit.

Repository label names are unique. Creating the label is therefore the
provider's create-if-unclaimed seam: competing creates cannot establish two
records with the same name. Dalph records the claim intent before calling
GitHub. Every unknown error or malformed response is followed by an exact
label lookup before another create can be authorized.

Release compares the complete owner and token, then deletes the exact opaque
label node ID. A delayed release for a deleted record cannot delete a later
replacement with another node ID.

Claim lookup is read-only. Claim creation and deletion require coordinator
ownership. After Dalph observes that it owns the exact claim, it rereads the
task and required graph facts before planning work; the claim itself does not
prove that the task remains open, selected, or free of unfinished
prerequisites.

See [issue-137-reconcile-task-claims.md](../scenarios/issue-137-reconcile-task-claims.md).
