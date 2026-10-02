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
