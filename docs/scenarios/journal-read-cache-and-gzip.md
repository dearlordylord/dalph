# Dalph reuses unchanged reads and stores independently compressed payloads

Status: accepted scope from the operator request to fix repeated journal reads
and add the researched gzip layer. Existing compact/full current-version rows
and the exact operator-owned four-task journal are explicit input targets.
No task dependency, workflow fact, semantic event version, or blocking edge changes.
D1 exact identity, D21 intent before ambiguity, D22 reconciliation, and D32/D32a
journal reduction/admission govern every chronology below.

## 1. A caller reads one unchanged Run repeatedly

Starting facts: one live JournalStore owns its private SQLite connection under
exclusive locking and the production coordinator fence. The Run has a complete
Hot or valid terminal Cold partition. Manual database mutation is outside the
supported threat model; no second writer may share ownership.

Trigger and order: the first ordinary `read` checks both partition memberships
inside a transaction, loads and decodes the entire chosen partition, and caches
the immutable ordered snapshot after success. A later ordinary `read` checks
both memberships inside its transaction and returns the identical cached array
if its partition agrees. TraceReader can reuse its existing array-identity index.
No tracker, Git, executor, or durable cache state is read or written.

Visible: identical records and stable array identity, without repeated payload
queries/decode. Forbidden: stale results after a store mutation, mixed Hot/Cold
snapshots, bypassed partition contradiction, or reuse across reopening/ownership.
Crash discards the cache; reopening decodes actual stored rows. There is no
workflow retry/effect added. Acceptance: `sqlite-read-cache.test.ts` unchanged
Hot/Cold reads, array reuse and query counts; existing reopen/corruption tests.

## 2. A write, maintenance, failure, or recovery follows a cached read

Starting facts: ordinary read cached Run R. Trigger: append, begin, termination,
retirement, audit, startup scan, recovery read, or interruption/failure.
The store invalidates the ordinary-read snapshot on append, even replay, and on
lifecycle/retirement outcomes. Scans and audits invalidate all read caches.
Recovery always reloads/decode actual bytes. A failed read discards the affected
cache. Append's existing keyed checkpoint remains separate, retaining constant
warm-append work rather than copying whole arrays on every append.

After an acknowledged append, the connection's keyed checkpoint still proves
every immutable row through the new position. The next ordinary read checks
both partition memberships, then builds a new ordered array from that exact
checkpoint, sharing its decoded events instead of decoding the whole Run again.
The previous array remains unchanged. This changes only process-local payload
reuse: workflow decisions, external requests, durable facts, and crash/retry
rules remain unchanged. Ambiguous outcomes, failed reads, audits, scans, and
reopening still discard the checkpoint or establish it again from actual bytes.

Visible: next ordinary read sees all committed facts or typed failure. A lost
append COMMIT acknowledgement invalidates caches; retry reads actual history and
returns the committed same-key event without reinsertion. A retirement overlap
is serialized and returns one complete partition. Forbidden: omitting committed
rows, retaining stale arrays after ambiguous outcomes, hiding corruption from
audit/reopen, or duplicate effects. Crash before commit rolls back; after commit
recovery reconciles existing records. Acceptance: `sqlite-read-cache.test.ts`
append/failure/audit/recovery/retirement cases, existing warm-append lost-COMMIT,
retirement-overlap and fresh reopened corruption tests.
The append case also proves decoded-event identity reuse and no extra partition
payload query after the acknowledged write.

After reopening, the first partition SELECT must also release its obsolete
read array and record wrappers once a later acknowledged append replaces the
read view and callers drop their references. The live checkpoint still retains
the exact decoded events needed by the current history. The native driver's
prepare cache must not retain the completed read's parent span and old array.
`sqlite-scan-retention.test.ts`: `releases the first reopened read array while retaining the current SQLite checkpoint`
seeds a persisted Run in a separate closed store, opens a fresh connection,
reads, appends, rereads, and checks both obsolete wrappers with WeakRef/GC while
the store remains open. This changes only process-local retention; every row,
membership, codec and history check, and the crash/reopen rules above remain.

### Selected startup history and the first append

An exclusive SQLite connection has no checkpoint after reopening. Dalph already
knows the exact Run R selected for startup; other Hot Runs still require the
ordinary complete scan and validation. Startup requests that scan with R as its
sole retention subject. The scan reads and decodes every Hot row, checks the
selected history's contiguous positions and unique keys, and confirms that R
has no Cold membership before retaining its current-connection checkpoint.
Startup still validates every returned history before installing the live
Journal. The checkpoint and Journal share R's immutable decoded events.

The first acknowledged append to R uses that exact checkpoint instead of
decoding R again. The selected scan array remains unchanged, and the next read
contains both its original events and the committed append. No other Run is
retained because of this request. An ordinary scan without a selected subject,
or any audit, still invalidates the checkpoints; ambiguity and reopening retain
their existing cold-read rules. Corrupt selected rows cannot seed a checkpoint,
and conflicting Hot/Cold membership remains a typed failure. A missing selected
Run is not invented. No provider, Git, or durable workflow effect is added.

Acceptance: `sqlite-read-cache.test.ts` checks selected scan -> first append ->
read, exact event identity, and no repeated partition-payload query. Existing
scan/audit, corruption, ambiguous append and retirement tests own the unchanged
failure boundaries. The retained production-sized startup/first-append
diagnostic and native cancellation check own the memory/resource boundary.

## 3. Dalph writes and reopens gzip payloads

Starting facts: a current full semantic event passes Effect Schema. Trigger:
ordinary SQLite append/lifecycle encoding. The codec first removes accepted
equal copies, then optionally stores that row's UTF-8 JSON as an explicitly
versioned gzip envelope with decoded length, SHA-256 and canonical Base64.
Only payloads from 1 KiB through 1 MiB are compression candidates; a candidate
is stored plain if its complete envelope is not smaller. Larger payloads remain
plain, preserving existing admission rather than imposing a new event-size cap.
Synchronous encoding is bounded by that candidate size; decoding uses bounded
asynchronous gunzip. The store already serializes row reads; no unbounded
compression fanout is introduced.

On read, Effect Schema validates the envelope, validates its compressed input
bound, decodes with the exact declared output bound (at most 1 MiB), checks
length and SHA-256, strictly decodes UTF-8, then passes the restored compact/full
JSON to unchanged event decoding and full-history validation. Plain and existing
compact rows remain readable. The existing browser Node-only resolver also refuses zlib adapter calls;
browser/cassette consumers continue using the common codec without gzip.
No external actor is called; no cross-row
reference/dictionary or workflow event is introduced. Atomic row commit/crash
and idempotent append rules stay unchanged. Older semantic versions remain
unsupported, and older binaries cannot read the new storage format.

Visible: the same events, keys, positions and reconstructed Run with smaller
storage. Forbidden: treating failed compressed bytes as plain, silently dropping
rows, weakening event/history checks, blocking the event loop with synchronous
gunzip, or changing facts during compression. Acceptance: `gzip-payload.property.test.ts`
generated byte roundtrips, limits/UTF-8/digest/truncation/envelope negatives,
`storage-payload.property.test.ts`, full codec/store/retirement tests and exact
617-row copied/current-journal production reopen/reducer comparisons.

## 4. An operator compacts the stopped existing journal

Starting facts: exact current four-task database has 617 events and Completed
history; the operator authorized rewriting it. All writers are stopped and a
verified original backup exists. Trigger: bounded offline maintenance prepares
each production-encoded row and proves decoded-event equality before effects.
It writes intent, transactionally changes payload bytes only using exact old
payload comparisons, then reopens/read/audits with production JournalStore and
compares every record and complete reduced state. VACUUM runs after commit
while ownership remains exclusive. Original backup bytes remain unchanged.

Crash before commit leaves original rows. After an ambiguous committed result,
read actual bytes before retry; codec output is idempotent. A disposable retired
copy proves Hot-to-Cold byte parity. Visible: smaller database, same complete
history. Forbidden: changing envelope identities/versions, starting workflow
work, split rewrite, live writer overlap, or overwriting the backup.
Acceptance: retained exact-journal diagnostic records hashes, byte/event/state
equality, production audit/reopens, retirement parity and warm-read query counts.
