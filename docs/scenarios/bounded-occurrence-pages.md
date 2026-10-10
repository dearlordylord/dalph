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

## Yield while validating complete current format history

The Operator requests a fixed-prefix page while the same unfinished Run retains
its executing responsibilities and exact claims. The accepted repair in
[issue #509](https://github.com/dearlordylord/dalph/issues/509) blocks combined
acceptance in #501. The reader still obtains the complete authoritative source;
native storage corruption outside the selected cursor still fails at that source
boundary. It checks the selected prefix's complete canonical history in the same
phase order before returning any occurrences.

The occurrence reader yields between envelope checks, exact-source query-index
construction, semantic validation records, operation indexing, projection records,
item mapping and history-item schema checks. Both synchronous and cooperative
readers interpret the same ordered semantic phases and strict-position predicate.
Canonical unique records may use the existing exact-source query index; malformed
keys and duplicate keys retain raw-array diagnostics. Every history field and
item is schema-checked, with the cross-item order checked over the complete result.
A private partial accumulator never becomes a successful occurrence-history cache
entry. Interruption discards it; restart reads the same complete current-format
source into new process-local state. No checkpoint, history omission, format
migration, new cleanup authority or external write is introduced.

| Accepted chronology | Executable evidence |
| --- | --- |
| V1 complete canonical parity, bounded page/refusal, unchanged authorities, oversized indivisible value | Existing paging acceptance test above; `trace-reader.cooperative.test.ts`: `yields during complete validation, admits another fiber, and returns exact canonical history`; retained profile fixture's Dense, DenseOversized8192Utf8Bytes and DenseOversizedUncachedSqlite tests |
| V2 Pause arrives after envelope validation while semantic preparation is unfinished | Retained profile fixture asserts source-inspection progress at HTTP control entry and measures correlated receipt to entry; existing `running-host-run-control.acceptance.test.ts` preserves Pause/Cancel exact settlement |
| V3 disconnect discards unfinished preparation, cache retry rebuilds, delivery remains unchanged | `running-host-occurrences-interruption.acceptance.test.ts`: `disconnect interrupts native semantic history preparation without cancelling delivery or caching a partial history`; `trace-reader.cooperative.test.ts`: `discards an interrupted validation and rebuilds before publishing a successful cache`; existing inspection Exit and watch shutdown tests retain original drain deadlines and exact subscription lifecycle |
| V4 gapped, duplicated, malformed, contradictory or incompatible history, fixed cursor across append and restart | `trace-reader.cooperative.property.test.ts`: `matches the synchronous cursor oracle for canonical, gapped, duplicated and malformed-key histories`; existing trace-reader, prepared/property, paging, SQLite store/cache and codec tests |

The retained executable fixture is
[profile-fixture.ts.txt](../evidence/issue-509/profile-fixture.ts.txt), with
[portable configuration](../evidence/issue-509/profile-config.mjs.txt).
Each declared profile measures twenty cold host reopens and twenty warm reads.
The oversized profiles retain one 8,192-byte UTF-8 task identity. The uncached
profile runs a read-only native scan before each request, invalidating only
process-local store caches, so the measured optional read includes actual SQLite
decoding. Scheduler-task wall spans and main-thread CPU cover prefix selection,
individual records, cancellation multiplicity, operation indexing, final
projection schema and history construction. The fixture asserts 10 ms per measured
task, 100 ms admission p95, 1 GiB heap and 1.5 GiB RSS, excluding children.
These are declared `ReadOccurrencePage` profiles, not a universal real-time
promise or qualification of legacy full traces, startup or whole-host capacity.

The workflow algebra, durable events, journal format, ownership and cleanup
protocols do not change, so this presentation-scheduling repair has no new model
or conformance obligation. Parent #501 still owns frozen combined qualification.
