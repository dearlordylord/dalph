# The Operator reads a bounded Run summary

Under #480, the Operator reads one existing running-host snapshot through
`dalph attach snapshot --host ADDRESS --run RUN --json --compact`. The CLI
projects the decoded response; the host performs its existing passive snapshot
read once. This adds no tracker/Git/provider read, workflow command, journal
write, cache or private-state interpretation.

The compact option is CLI-only. MCP's `dalph_read_snapshot` retains its existing
full output schema: a second server-side projection is unnecessary for this
CLI supervision task. CLI and MCP still consume the same full public snapshot;
existing parity tests remain applicable. Remove `--compact` for full evidence.
The client still receives the existing full snapshot and its transport limits
apply. The snapshot does not contain an exact cleanup/writer-custody observation:
compact explicitly marks cleanup Unavailable and preserves retained obligation
counts without interpreting them as cleanup permission.

## Chronology and acceptance mapping

| Starting facts, trigger and boundary | Visible and forbidden results | Tests |
| --- | --- | --- |
| A Ready publication contains open, completed, progressing and blocked work. The Operator requests a compact read; the existing descriptor/snapshot boundary returns it. | Exact Run/position, lifecycle and delivery-category counts, held/retained responsibilities and bounded examples. Held responsibility is not proof of an executing writer. No additional reads or commands. | `running-host-compact.test.ts`: `preserves active facts and every blocked category`; `running-host-compact-cli.test.ts`: `the built CLI reads a large observation once and emits bounded JSON` |
| The publication is explicitly Closed, with or without a retained final Ready value. The same read is projected. | Closed remains explicit. Missing final observation is Unavailable, not zero counts. Delivered task counts never infer Closed or safe cleanup. | `running-host-compact.test.ts`: `keeps Closed and unavailable publication distinct` |
| The response reports failure, or Ready diagnostics retain failure/recovery/cleanup obligations. A host crash during the read uses the existing transport-failure response. | Keep failure category and transport phase, all diagnostic failure/recovery categories and responsibility counts; cleanup is explicitly Unavailable because the snapshot does not carry its custody facts. Omit free-form details; mark their omission and point to full inspection. Never report healthy empty state or retry a mutation. | `running-host-compact.test.ts`: `retains failures while excluding free-form payloads`; existing public-client failure tests; `running-host-compact-cli.test.ts`: `compact output preserves failure exit status` |
| A large graph and long identifiers exceed the example budget. The Operator reads the same observation. | At most 8 KiB UTF-8 including newline. Examples that cannot fit are omitted with exact counts; all category/count facts remain. If essential identity/category metadata cannot fit, return explicit FrameTooLarge failure rather than truncate identity. Full output is unchanged. | `running-host-compact.test.ts`: `bounds oversized examples without dropping counts`; `running-host-compact-cli.test.ts`: built large-observation test |
| Existing full CLI/MCP clients read without compact mode, or compact is requested on a command. | Full contracts remain unchanged. Compact is accepted only for snapshot; other commands refuse before effects. | existing `running-host-client-parity.test.ts`; `running-host-cli.test.ts`: `compact is refused on commands before host effects` |

The projection has no durable operation to recover: a disconnected/crashed
client can repeat this passive read under the existing transport rules. It
cannot authorize cleanup, publication or recovery. Tests use controlled public
observations; no live-provider mutations or new native task attempts apply.
