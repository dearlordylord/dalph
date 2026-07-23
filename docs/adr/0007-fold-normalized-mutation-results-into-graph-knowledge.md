# Fold normalized tracker mutation results into graph knowledge

Status: Accepted

Task-graph knowledge changes when Dalph receives usable normalized tracker
facts, not only when it explicitly requests a read. When one successful tracker
mutation response both completes its workflow operation and satisfies a named
task-graph read shape's coverage and evidence contract, Dalph records one
`TaskGraphFactsUpdated` event rather than separate acknowledgement and
graph-update events.

## Consequences

The composed managed-run reducer sends that one event to both the
workflow-history and graph-knowledge components. The graph facts follow the same
coverage, completeness, temporal-consistency, conflict, and replacement rules
as facts returned by an explicit read. A mutation response that does not satisfy
such a contract updates workflow history only; a later explicit read is still
required to update graph knowledge.
