# Workflow-occurrence projection scenarios

Status: accepted for the runtime occurrence-classification milestone.

## A tracker outcome has no earlier same-run read intent

### Starting situation

No person triggers this invalid case. A caller supplies a journal-record
sequence containing a tracker outcome for operation O, but the retained prefix
contains no earlier tracker-read intent for O in that run. The tracker outcome
may be structurally decodable by itself; the sequence does not prove which
action produced the observation relationship.

### Trigger and ordered actions

The caller asks Dalph to project production workflow occurrences from the
records. Dalph walks the records in journal order and looks up the exact
same-run read intent by `OperationId`.

### Visible and forbidden result

Dalph returns a typed projection failure identifying the outcome record and
operation. It emits no partial projection and does not silently omit the
outcome, borrow another run's intent, or fabricate an initiating actor.

No tracker, Git, executor, or journal write occurs because projection is a
read-only semantic boundary. A crash or retry cannot change the answer for the
same immutable input.

### Acceptance-test mapping

- `rejects a tracker outcome without an earlier same-run read intent` proves
  unmatched outcomes fail rather than disappearing.

## A large journal is projected in one indexed pass

### Starting situation and trigger

This is deterministic performance evidence, so no person, outside boundary,
crash, retry, or visible workflow result applies. A large immutable journal
contains many tracker intent/outcome pairs.

Dalph projects records in journal order while retaining an in-memory index of
earlier same-run tracker intents. Schema relationship validation also uses an
index. Neither phase rescans the retained prefix for every outcome.

### Acceptance-test mapping

- `projects a large journal without rescanning each retained prefix` proves a
  production-sized input completes within the bounded focused-test budget.
