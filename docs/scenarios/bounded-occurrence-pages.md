# Read historical occurrences at one committed prefix

The Operator requests `ReadOccurrencePage` through the public running-host
client. The accepted governing chronologies are A1 and A3 in
[issue #491](https://github.com/dearlordylord/dalph/issues/491). The journal owns
retained history; archive maintenance owns its eventual unavailability.

Starting facts: Run R has valid retained current-format history through committed
position P, and that history contains more occurrences than one response permits.
The Operator sends R, P, a capacity, and initially no continuation. The host reads
and validates the exact prefix before returning occurrences in canonical order.
It returns covered occurrence positions and either Complete or Partial with the
exact next occurrence and original prefix. Capacities from 1024 through 1048576
UTF-8 bytes are supported; the budget includes the actual response envelope.
Graph, facets and relationships are outside this operation.

The Operator continues after another record is appended. The host selects the
same R/P prefix, so concatenated pages equal the original canonical occurrence
sequence. A read retry repeats only reads. An occurrence that cannot fit alone
returns `OccurrenceTooLarge`, its exact identity, encoded occurrence bytes,
required response bytes, capacity and an unchanged continuation at that item.
The host must not skip that item. Invalid prefix/cursor/capacity fails explicitly;
corruption fails before a size result. Retired history reports the archive owner's
failure rather than inventing an empty page. Reads cannot append history or call
tracker, Git or executor mutations; those effect crash/retry cases are inapplicable.

Current status uses the independent coherent publication while optional history
preparation is pending. The existing full trace and cursor-only CLI paths remain
unchanged. Each CLI invocation still has its separate cumulative output quota;
this operation neither consumes that quota nor changes logical history.

Acceptance mapping:

| Chronology / forbidden result | Exact test owner |
| --- | --- |
| A1/A3: canonical ordering, exact ranges, bounded envelope, append between pages, retry without mutations, indivisible refusal, invalid continuation/prefix/capacity, corruption before quota, status during blocked optional preparation | `running-host-occurrences.acceptance.test.ts`: `pages the canonical fixed prefix across an append with no read mutations and refuses exact oversized occurrences` |
| Archive-owner unavailability after deletion; compact completion remains available | `running-host-occurrences.acceptance.test.ts`: `reports the SQLite archive owner's historical deletion without mutating authorities or losing compact Run control` |
| Existing full-view validation and cursor-only admission remain unchanged | `trace-reader.test.ts`; `production-cli.test.ts` |

The physical production fixture uses SQLite and the actual HTTP host/client with
controlled authority adapters. Controlled blocked preparation proves independent
status access, not a p95 resource or latency claim for a large workload. Combined
measurements remain owned by parent #491.
