# Retain incomparable task-graph facts as local knowledge conflicts

Status: Accepted

Two successful `TaskGraphFactsUpdated` events may disagree even though neither
adapter assembly contained a detectable internal contradiction. Dalph uses
provider comparison evidence only for the exact fact family whose contract
makes that evidence comparable. When neither conflicting fact is provably
newer, the graph-knowledge reducer retains a local conflict instead of choosing
by workflow-journal position or blocking the whole run.

## Consequences

Only the conflicting fact and graph regions whose next actions depend on it
become unavailable. Other valid knowledge remains consumable, and the conflict
makes a bounded focused reread eligible. GitHub issue-level `updatedAt` evidence
does not become a revision for dependency or grouping edges, and a
`TrackerRevision` content fingerprint does not become a graph-wide freshness
order.
