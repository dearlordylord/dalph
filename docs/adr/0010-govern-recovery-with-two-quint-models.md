# Govern recovery with two canonical Quint models

Status: accepted

Dalph keeps two canonical Quint models: the focused
[`taskWorkSessionRecovery`](../../specs/taskWorkSessionRecovery.qnt) model owns
provider-session establishment after an uncertain request, while the broader
[`frontierRecovery`](../../specs/frontierRecovery.qnt) model owns composition
across the graph frontier, pause, capacity, crash recovery, reconciliation, and
all eight ambiguity-crossing boundaries. The models overlap only through the
versioned `AmbiguityBoundaryV1` projection. Keeping the focused provider model
separate preserves tractable exhaustive checks and provider-specific
correlation rules; keeping frontier, pause, and reconciliation together
prevents their shared authority and scheduling rules from drifting across
several models.

## Consequences

Every model exports a closed action and state projection at the public workflow
algebra. Modeled behavior changes must update the owning model, executable
adapter, selected readable scenarios, in-memory recovery prefixes, and SQLite
reopening prefixes together. A third model is justified only by a materially
different authority boundary, abstraction, checking profile, executable
adapter, lifecycle, or implementation consumer.
