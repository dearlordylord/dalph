# Store repeated journal values once without changing workflow history

Status: accepted scope from the operator request to remove duplicate copies and
validate against the existing four-task journal. The operator also authorizes
rewriting that exact test journal. This changes the storage representation,
never workflow events, event versions, identities, or external actions.

## 1. Dalph appends and reopens a compact event

Starting facts: Dalph has a valid current-version workflow event containing a
completion claim. The claim repeats its exact planned attempt inside its
promotion correlation; finality events may also repeat the claim inside their
success observation. The event has passed the existing Effect Schema boundary.

Trigger: the ordinary SQLite Journal append. Dalph encodes the semantic event,
removes only equal duplicate values, and writes an explicitly tagged compact
payload in the existing atomic row append. On reopen, exact read or audit decodes
the storage tag, restores the copies from values inside the same row, then runs
the unchanged complete event schema and history reducer. Events without those
copies keep their ordinary payload representation.

Visible result: callers receive the same event, positions, keys, and chronology.
An exact-key append retry compares decoded meanings and returns the original
record without appending another row. A crash before commit exposes no row;
a crash after commit exposes the complete row and uses ordinary append replay.
No tracker, Git, or executor call is introduced; graph dependencies and blocking
edges are unchanged. Forbidden: an omitted intent, inferred external fact,
changed identity, cross-row reference, or weakened schema/history check.

Acceptance: `storage-payload.property.test.ts` round-trip properties and negative controls;
`store.test.ts` existing SQLite reopen and exact-key replay cases. D1 exact identity, D21 intent before ambiguity, D22 reconcile before retry,
and D32/D32a reduction and record admission remain governing rules.

## 2. An operator compacts the existing stopped test journal

Starting facts: the exact four-task journal is stopped, has 617 records and a
valid Completed history. The operator authorizes rewriting it. A verified backup
retains the old bytes; no live writer may own the database.

Trigger: the bounded offline diagnostic. It reads both partitions, decodes every
row with the production codec, prepares compact payloads, and proves each decoded
result equal to the original. In one SQLite transaction it changes payload bytes
only. It reopens through production JournalStore, exact-reads and audits the Run,
and compares the complete reduced history before and after. SQLite VACUUM may
then reclaim free pages while all writers remain stopped.

Visible result: less payload storage, the same 617 ordered events and Completed
result. Existing untagged current-version full payloads remain readable because
this exact existing journal is an explicit acceptance target. No older semantic
event version is newly supported. A crash before transaction commit rolls back;
a lost committed result is reconciled by reading actual payloads before retry.
The transform is idempotent. Forbidden: event/key/position/version changes,
partial rewrite, invalid history admitted, source backup overwritten, or a
workflow restart/mutation during maintenance.

Acceptance: the retained exact-journal diagnostic records before/after hashes,
all-row equality, full reducer results, production reopen/audit, and byte sizes.
The controlled codec properties prove repeated packing is stable; SQLite atomic
retirement tests exercise the same storage transaction boundary.

## 3. Dalph encounters a malformed or contradictory payload

Starting facts: a row has an unsupported compact tag, missing source data, a
foreign claim/plan, or an untagged full payload missing a required field.
Trigger: exact read or audit. The storage decoder rejects unsupported tags and
restores only the named duplicate fields in explicitly tagged compact payloads;
the complete Effect Schema and reducer reject malformed/contradictory data.
Present unequal copies are preserved, never silently replaced with equal ones.

Visible result: a typed decode/history issue preserves the row as evidence.
No workflow action is authorized by that row. Crash/retry changes nothing:
reads are pure and do not repair storage. Forbidden: treating arbitrary missing
fields as defaults, swallowing contradictory copies, or changing event versions.

Acceptance: `storage-payload.property.test.ts` missing-source, unsupported-format,
untagged-missing-field, and unequal-copy controls plus existing history negatives.

## 4. Dalph retires a compact terminal Run

Starting facts: valid terminal Hot history contains compact and full payloads.
Trigger: ordinary retirement. Dalph decodes/reduces the complete history, then
atomically copies and byte-verifies stored rows before deleting Hot rows.
Read/reopen sees the same full events in Cold. Existing retirement crash and
lost-response rules apply unchanged. No external system is called.
Forbidden: re-expanding or rewriting payload bytes during retirement, splitting
partitions, or changing the terminal disposition.

Acceptance: existing `store.test.ts` byte-parity retirement and
`retirement.property.test.ts` exclusive-partition/crash-cut properties run with
the production compact encoder; exact-journal diagnostic additionally retires
a disposable copied database and compares both storage bytes and decoded events.
