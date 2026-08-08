# Compose pure reducers into one reconstructed run state

Status: Accepted

Dalph reconstructs graph knowledge, workflow history, resource responsibility,
and pause state with distinct pure reducers composed behind one run
reduction boundary. The reconstruction workflow reads and decodes
journal rows once; the composed reducer processes those event values in
canonical order, updates the component states, validates their cross-component
invariants, and returns one validated reconstructed run state.

## Consequences

No reducer reads the journal, invokes an adapter, or performs another effect.
Within one live process, Dalph may retain the derived state and its last applied
journal position to fold later events incrementally. That process-local value
is discarded on restart and is never persisted or treated as authority.
