# Qualify production evidence storage and sealed evidence history

Issue: [#76 Qualify production evidence storage](https://github.com/dearlordylord/dalph/issues/76)

Status: **partially superseded on 2026-08-14**. Filesystem atomicity,
immutability, content identity, reopen, and executor-acceptance evidence remain
accepted. Any chain element dedicated to the removed #59 target-verification
stage is historical and must not be required by corrected integration finality.

This issue qualifies the real filesystem evidence-store boundary after the
provider-neutral acceptance and completion protocols exist. No person directly
starts these scenarios. The running Dalph coordinator and the executor cross
the evidence boundary; the filesystem owns evidence bytes and paths, Git owns
commit ancestry, the task tracker owns task lifecycle and claims, and the
Dalph journal owns only the ordered workflow occurrences it records. Evidence
references are inputs to those protocols, never a second workflow authority.

P0–P6 are test cut labels only. They are not evidence stages, storage states,
workflow states, or production terminology.

## A partial write is never a complete evidence object

### Starting situation

Run R has a planned attempt A. The executor is about to publish an immutable
acceptance manifest or a later integration manifest. The configured filesystem
evidence root exists, but no object for the bytes' SHA-256 digest is published.
The journal has not recorded a reference to this object. No SQLite journal
record is needed to authorize a byte write, and no tracker or Git call is
involved in this storage-only boundary.

### Trigger and chronological behavior

1. Dalph copies the supplied bytes and computes their lowercase SHA-256 digest.
2. It creates the digest directory and writes the complete copy to one private
   temporary pathname beneath that directory.
3. The process may die after the temporary write and before publication, or the
   filesystem may report a failed publication/cleanup. The final digest
   pathname must not expose those bytes as a complete object.
4. On a later activation the evidence store reads the digest pathname. A
   missing object, wrong length, or wrong digest is a typed storage failure; it
   is not a manifest that can authorize acceptance, integration, promotion, or
   tracker completion.
5. A retry puts the same bytes under the same digest. It publishes one complete
   object atomically; once cleanup also succeeds it returns one exact
   reference. If cleanup is unknown, it reports a typed put failure and a later
   retry reconciles the already-published target.

The maintainer sees a typed wait/failure until a complete object can be read.
Dalph must not return a reference before complete publication, read a temporary
pathname, treat a partial object as a manifest, or let one storage failure
become a universal Run-completion failure.

There is no retry of a tracker, Git, or executor request in this scenario: no
such boundary was crossed. A process crash is the applicable failure because it
can occur between the temporary write and publication.

### Acceptance-test mapping

- `does not expose partial bytes after an interrupted filesystem publication`
  proves the digest pathname is absent or unreadable until complete publication.
- `reopens an interrupted publication and republishes the same complete object`
  proves recovery can retry the storage operation without changing its content
  address.
- `reports temporary-file cleanup failure as a typed put failure` proves a
  published object is not silently reported as a successful storage operation
  when cleanup disposition is unknown.

## Content addresses remain immutable across reopen and concurrent writers

### Starting situation

The evidence root may already contain the complete bytes for a reference, and
the process may be a fresh process reopening that root. Two Dalph fibers can
attempt to put identical bytes; a foreign or corrupt object may occupy the
digest pathname. The journal stores only references and does not own the bytes.

### Trigger and chronological behavior

1. Each put copies caller bytes before returning, hashes the copy, and tries to
   publish under the digest-derived path.
2. Identical bytes converge on the same reference. A second writer rereads the
   existing object and succeeds only when its length and digest match exactly.
3. A changed object at that digest path, a reference with a wrong length, or
   bytes whose digest differs from the path produces a typed failure. Dalph
   preserves the object for diagnosis and never overwrites it.
4. After closing and reopening the store, the same reference rereads the same
   bytes. Mutating the caller's input or returned output cannot mutate the
   stored object.

The maintainer sees one stable immutable reference or a typed conflict. Dalph
must not replace bytes at an existing digest, accept a hash-only match with a
wrong length, or infer successful storage from a stale existence check.

The only retry is the same content-addressed put after reconciling the existing
path. No tracker, Git, executor, or journal retry applies because this scenario
qualifies the storage port itself.

### Acceptance-test mapping

- `stores immutable bytes idempotently and publishes concurrent same-content writes once`
  proves copy isolation and same-content convergence in memory.
- `reopens a published object with the same reference and bytes` proves the
  production filesystem adapter survives process/layer reopening.
- `reconciles a losing same-content publication race and rejects a corrupt winner`
  proves stale existence checks fail closed.
- `fails with a typed read failure for an absent or corrupt object` proves
  malformed storage never becomes usable evidence.

## Sealed manifests form an immutable predecessor chain

### Starting situation

The executor has a durable accepted terminal report for one exact `(RunId,
AttemptId)` and an acceptance manifest reference. Later production protocols
may add an integration-review or target-verification manifest, then a
completion authorization. Each manifest is stored as immutable bytes and may
name the immediately preceding sealed manifest. The journal retains the
workflow events and references; the evidence store does not decide whether a
transition is legal.

### Trigger and chronological behavior

1. Before integration responsibility is recorded, Dalph rereads and
   schema-decodes the acceptance manifest and checks its commit and correlation
   against the durable executor report.
2. After each later evidence object is sealed, its producer stores the manifest
   bytes and the workflow protocol carries its immutable reference. When
   completion reopens the chain, Dalph rereads each manifest and checks each
   predecessor reference against the exact earlier sealed manifest. A missing
   predecessor, changed predecessor, malformed envelope, or partial object is
   a task-local typed conflict/wait.
3. A crash after any object put but before its journal event leaves the object
   available by its immutable reference but does not create workflow authority.
   Reopening reads the journal first, then rereads the exact reference before
   recording or continuing any event that consumes that reference.
4. A crash after the journal event leaves the same reference and predecessor
   chain. Reopening reconstructs the accepted-through-completion responsibility
   from journal history and current Git/tracker facts; it does not infer a
   later stage merely because bytes exist.

The maintainer sees a complete, hash-addressed chain only when every referenced
object and predecessor qualifies. Dalph must not mutate an earlier manifest,
skip a predecessor, infer journal events from orphan bytes, or treat evidence
as universal completion authority.

The applicable retry rereads the exact immutable reference and its predecessor
chain before repeating a journal append or downstream request. It never creates
a replacement identity solely because a response was lost.

### Acceptance-test mapping

- `validates the exact predecessor for every reopened sealed manifest` and
  `accepts every generated immutable chain with its exact adjacent predecessor`
  prove immutable chain reconstruction.
- `rejects a missing, foreign, or root predecessor before downstream work` and
  `rejects a reopened evidence chain whose review predecessor is foreign` prove
  chain integrity is task-local and fail-closed.
- `qualifies a durable accepted result only after its exact manifest qualifies`
  and the accepted-result evidence property cases prove the first chain link.
- Existing `reopens ... completion ...` evidence reread tests prove later
  completion stages independently reread all sealed manifests.

## Accepted work reconstructs through completion without granting evidence authority

### Starting situation

Run R's journal contains an exact planned attempt, accepted terminal report,
integration responsibility, candidate construction, sealed verification, and
promotion facts as applicable. The filesystem evidence root contains the
referenced acceptance, review, and verification manifests. The task tracker and
Git are still the authorities for current lifecycle, claims, ancestry, and
promotion. A coordinator process may die after any durable prefix.

### Trigger and chronological behavior

1. On activation, Dalph reopens the journal and reduces the retained records.
   A complete accepted report with no integration responsibility is offered to
   the acceptance qualification protocol; no evidence object alone creates
   responsibility.
2. The protocol rereads the exact acceptance manifest. Matching commit,
   `RunId`, `AttemptId`, outcome, and supported format permit exactly one
   integration-responsibility append. Unavailable or mismatched bytes do not.
3. Later activation reconstructs the same responsibility and rereads current
   tracker/Git facts before candidate, verification, promotion, completion
   claim, or tracker-completion work. Each protocol rereads the exact sealed
   manifests it consumes; a successful executor result or evidence reference
   alone never completes the tracker task.
4. After Git proves exact promoted ancestry and a fresh tracker observation
   proves successful completion, the completion protocol may settle the task
   responsibility and release only its exact completion claim. Other Run
   responsibilities remain unchanged.
5. If the process dies between any intent and outside response, reopening keeps
   the same journal identity and reconciles the named authority before retrying.
   Process-local positions, fibers, and derived frontiers are rebuilt rather
   than read from evidence.

The maintainer sees one accepted result flow through the existing integration
and finality protocols, with evidence references preserved and no duplicate
integration or completion request. Dalph must not let an orphan manifest,
executor success, promotion request, or stale graph observation authorize task
completion; it must not copy evidence bytes into the journal as a second
authority.

No person directly triggers this recovery path. The crash/reopen boundary is
applicable; a storage-only retry is not enough because each outside authority
must be reconciled before repeating its own request.

### Acceptance-test mapping

- `admits a durable accepted result only after its exact manifest qualifies`
  proves acceptance-to-responsibility reconstruction.
- `waits when acceptance evidence is unavailable without consuming integration`
  proves no downstream resource is consumed by missing evidence.
- `refuses completion when required sealed evidence is missing, malformed, or
  mismatched` and `restart returns the durable acknowledgement without another
  tracker call` prove accepted-through-completion reconstruction through the
  public finality protocol.
- Existing accepted-result integration, integration-finality, and production
  cassette tests remain regression gates for journal authority, tracker facts,
  and Git ancestry.

## Scope boundary

This scenario file qualifies evidence bytes, immutable references, manifest
chains, and their use at accepted-result/integration/finality boundaries. It
does not add a third Quint model or turn P0–P6 into production stages. Real
GitHub, Git, and process-provider qualification remains owned by their exact
port tickets.
