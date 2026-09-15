# Qualify the recovery-prefix harness against both journal stores

Status: accepted

Issue: [#142](https://github.com/dearlordylord/dalph/issues/142)

This issue changes maintained test infrastructure only. It does not change a
Dalph command, workflow decision, external request, journal event, retry rule,
recovery rule, cleanup action, or visible runtime result. The concrete actor is
the maintainer running the repository gate. Maintained cassette adapters return
declared in-memory tracker, Git, executor, and Integrator results without
contacting a provider.

The former two-model conformance specification and its session-recovery model
were removed when the planned-attempt executor became opaque. Current formal
authority is the subject-scoped portfolio in
`docs/adr/0010-govern-subject-scoped-quint-models.md`. The old requirement to
retain 18 selected model traces and run three simulated evaluators would test a
new selection-and-evaluation harness rather than Dalph. It is not part of the
accepted infrastructure bracket.

## A maintainer reopens one legal completion chronology at every durable cut

### Starting situation

A maintained cassette's in-memory task-tracker adapter, one legal
tracker-completion chronology, the memory journal adapter, and the SQLite
journal adapter are available. The chronology
has seven test-only cut labels, P0 through P6. These labels name where the test
stops retained history; they are not production states or events.

No person uses Dalph and no live GitHub, Git, executor, or Integrator boundary
is called.

### Test chronology

The maintainer runs the focused conformance test. For each cut, the test writes
the same legal prefix into a new memory journal scope and into a temporary
SQLite database. It closes the SQLite scope, opens a new scope over the same
file, decodes the retained records, and reconstructs the production semantic
projection from both stores.

The test compares canonical journal order and the semantic projection. A cut
that has no distinct durable event is represented only when the completion
protocol actually has that endpoint; the harness must not invent an event to
fill a label.

Closing and reopening the SQLite Layer is the applicable crash boundary. The
memory lane uses a fresh scope over copied retained records. A retry is issued
only if the production completion protocol selects it from that prefix; the
harness never calls a provider directly.

### Visible and forbidden result

The maintainer sees 14 passing executions: seven cuts through two stores. A
decode failure, different record order, different semantic projection, or an
extra state-changing request fails with the exact cut and store lane.

The harness must not add runtime P0-P6 vocabulary, persist a derived frontier,
create a second fixture catalog, call a live provider, or claim that one tracer
proves every workflow boundary.

### Scenario-to-test mapping

- `reopens every tracker-completion cut through memory and SQLite with the same projection`
- `rejects a recovery cut whose retained prefix or expected projection is inconsistent`

## A manifest keeps recovery-test scope explicit

### Starting situation and trigger

The repository has current ambiguity-crossing boundary families, a closed
workflow-event vocabulary, maintained cassettes, and focused protocol tests.
The maintainer runs the manifest test after one of those artifacts changes.

### Test chronology

The test decodes a closed manifest. Every boundary marks P0 through P6 as
applicable or not applicable. Each non-applicable cell gives the concrete
reason that the protocol has no distinct durable endpoint. Every entry names
its current event or focused evidence seam. The test rejects duplicate or
unknown boundary identifiers, missing cut decisions, obsolete event tags, and
references that do not exist.

Crash and retry do not apply to this scenario because the test validates static
test metadata and crosses no workflow or provider boundary.

### Visible and forbidden result

The maintainer sees the exact missing or stale manifest entry. The manifest is
not runtime authority and does not assert that every listed boundary has a
dual-store matrix. It only makes the coverage denominator and deliberate gaps
visible.

### Scenario-to-test mapping

- `keeps the recovery-prefix manifest closed and tied to current evidence`
- `requires an applicability decision and reason for every boundary cut`

## The complete-history generator remains deferred

The maintainer compares the current subject-model adapters, property tests,
maintained cassette catalog, and the representative dual-store tracer. The
audit records which cross-subject compositions remain outside those lanes. It
does not build an arbitrary complete-history generator unless one missing legal
history shape is both named and unavailable to the current evidence seams.

No crash, external boundary, retry, or runtime-visible result applies because
this is a checked-in evidence audit.

### Scenario-to-test mapping

- `records the complete-history generator decision against current evidence`
