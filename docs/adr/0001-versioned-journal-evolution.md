# Version journal envelopes and migrate physical schema with Effect SQL

Dalph will store an immutable JSON event payload inside a normalized journal
envelope whose columns carry authority-relevant identity, position, event kind,
and event version. Physical SQLite schema changes use ordered migrations from
Effect SQL's SQLite migrator; event versions use Effect Schema decoders and
upcasters; and recovery folds decoded events through a total semantic reducer
that returns either a valid state or typed issues. This keeps one Effect-native
database stack and avoids both an ORM added only for migrations and a table
migration for every event variant.

## Considered options

Drizzle was rejected because Dalph already uses Effect SQL and does not need a
second client, ORM schema, or migration history. Fully normalized payload tables
were rejected because they couple physical schema evolution to every workflow
event change. Canonical JSON is not the equality contract: deterministic bytes
help hashing and signatures, but do not establish semantic equality across event
versions. Idempotent re-appends will decode and upcast the stored event before
comparing managed-history values; historical payloads remain immutable.

## Consequences

Before journal schema version 2, issue #50 must replace the version-1 bootstrap
with version-controlled Effect SQL migrations and introduce versioned envelopes,
Effect Schema upcasters, and the managed-history reduction. Envelope columns may
be indexed and constrained; payload-specific fields stay JSON unless a concrete
query or integrity requirement earns a projection owned outside journal
authority. Derived recovery state is never persisted as journal authority.
