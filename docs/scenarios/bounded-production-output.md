# Bounded production history output

The Operator starts one production Run with an append-only Journal and a public
NDJSON stdout consumer. Each accepted Journal cursor may advance while the Run
remains unfinished. A `HistoricalSnapshot` contains the complete trace through
its cursor, so writing one at every cursor repeats all earlier facts and can
grow stdout quadratically. The retained #418 Run produced 446 MB in 13 minutes
from 249 such records while its SQLite Journal remained about 3 MB.

When an accepted cursor advances, the CLI may write a complete snapshot only
while the invocation's cumulative history-snapshot budget and per-record limit
permit it. After either limit is reached, it writes a small `HistoryAdvanced`
record with the exact Run and Journal cursor. It does not read the complete
trace for a cursor-only publication. Run selection, current status, Exit, and
termination remain separate records. The Journal and read-only trace reader
retain the complete history; stdout's cursor is an address, not a claim that
the entire trace was emitted.

After a crash or restart, a new CLI invocation receives its own output budget
and the existing Run's current cursor. An ambiguous stdout write still fails
through the existing output boundary. No workflow mutation, authority call,
Run disposition, or retry permission follows from choosing the smaller record.

Acceptance mapping:

| Cut | Focused evidence |
| --- | --- |
| Small history and terminal cursor | Existing `production-cli.test.ts` selection and termination cases retain one whole `HistoricalSnapshot` and `RunDisposition` |
| Snapshot exceeds the per-record budget | `production-cli.test.ts` bounded-history case emits `HistoryAdvanced` with the exact cursor |
| Cumulative budget exhausted | `production-cli.test.ts` bounded-history case never rereads the full trace for later cursors |
| Lost stdout | Existing `production-cli.test.ts` output failure case remains fail-closed |

This is presentation-only. Dalph runtime behavior and the Run Journal do not
change.

## Restart with a history that cannot fit the first snapshot

Starting facts: the existing Run has a committed cursor and a valid retained
history. Its operations contain enough causal predecessor references that the
JSON field names of the required causal edges alone exceed the invocation's
per-record or remaining byte budget. The complete history remains authoritative;
neither records nor causal references may be removed or rewritten.

1. The Operator restarts the ordinary production CLI on that exact Run.
2. Before expanding causal edges into a complete snapshot, the read-only trace
   boundary validates the selected committed prefix: storage identities and
   keys, historical relationships, operation identities and predecessor order,
   occurrence projection, and all non-causal trace schema and invariants.
   Every causal edge's scalar fields are checked through its operation schema.
3. Only after those guards pass, the boundary compares a conservative JSON byte
   lower bound for the required causal edges with the supplied byte capacity.
   Exceeding that bound proves the complete snapshot cannot fit; it does not
   claim to know the complete encoded size or make a partial snapshot.
4. The CLI publishes `HistoryAdvanced` with the exact cursor, exhausts this
   invocation's snapshot budget, and does not expand or encode that snapshot.
   Run execution, status, cancellation, Exit, and disposition continue normally.
5. If the bound does not prove excess, ordinary complete trace projection and
   exact encoded-byte checks still decide between a whole `HistoricalSnapshot`
   and `HistoryAdvanced`. A malformed prefix fails before admission even when
   its causal references would exceed the byte budget.

A restart rederives admission from the actual immutable prefix and a fresh
invocation budget. Admission is never persisted as workflow or resource state.
An uncertain stdout write remains an output failure; no workflow effect is
retried because of this read-only decision. No additional tracker, Git, or
provider calls are needed, so their crash/retry cases are inapplicable here.

Acceptance mapping: trace-reader focused tests compare admitted small views with
ordinary full projection, prove byte-bound decisions for dense causal histories,
and retain malformed-prefix and invalid-cursor failures. Production CLI focused
tests prove an oversized first cursor never invokes complete `readAt`, preserves
selection/status/disposition output, and propagates admission/output failures.
Real native #479 cancellation is still required to prove the repaired resource
boundary permits that Run to progress; codec or presenter tests alone cannot
close it.
