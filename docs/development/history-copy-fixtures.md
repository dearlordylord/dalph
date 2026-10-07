# Preserve history fields when copying fixtures

The fixture copier restores accepted Run history through the memory or SQLite
JournalStore boundary. It must preserve every decoded record field, including
absent historical fields, rather than normalize old history into a new Run.
SQLite verification closes and reopens the copied store before comparing it.

`makeWorkflowRunBeganRecord` requires `AttemptBasePolicy` for contemporary
construction. `makeHistoricalWorkflowRunBeganRecord` explicitly reconstructs
released history where that field may be absent. JournalStore restoration and
its optional historical input remain unchanged; this change does not backfill
history or relax fresh admission. Modern RunControlledWorkflow construction
continues to require the same Base policy.

## Acceptance mapping

| Starting facts and trigger | Boundary and required result | Check |
| --- | --- | --- |
| A retained beginning has a fixed Base policy, or historically has no policy. It is copied into memory/SQLite and read back. | Every decoded field and optional absence is preserved; the reconstructed history remains valid. | `recovery-store-lanes.property.test.ts`: four retained-prefix examples |
| Valid generated beginnings have schema-derived optional fields and zero to four consecutive capacity changes. The same store copier replays them. | Complete record equality, not a selected-field comparison, in both lanes. No derived-history cache or admission rule changes. | `recovery-store-lanes.property.test.ts`: 32 generated histories per lane, fixed seed 481 |
| A copy mutation deliberately drops the original contemporary Base policy. | The whole-record equality property fails in each lane, exposing the missing field. | `recovery-store-lanes.property.test.ts`: policy-dropping negative controls |
| A caller constructs a contemporary beginning, or explicitly restores historical history. | The contemporary argument is required; only the historical constructor accepts absence. | `recovery-store-lanes.property.test.ts`: constructor type assertions and repository typecheck |
| An exact old attempt is recovered from history without a Base policy and fresh admission is attempted. | Recovery stays readable; ordinary fresh admission remains refused. | `run-activation.mbt.test.ts`: recovers an exact historical attempt while refusing fresh admission without a pinned Base policy |

The property derives event fields from production Effect schemas. Constrained
Git ref/endpoint leaf generators provide admissible values; JSON round-tripping
preserves the durable distinction between optional absence and an in-memory
undefined property. This generator covers beginnings and capacity changes;
existing richer recovery prefixes continue to own other event chronologies.
