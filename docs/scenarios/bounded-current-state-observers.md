# Alice stalls a current-state observer

Governing behavior: [parent A2](https://github.com/dearlordylord/dalph/issues/491)
and [current-first watches](running-host-clients.md#watch-delivery-implementation-test-ownership)
require complete coherent observations, passive disconnect and finite admission.
This slice uses no historical paging or workflow changes.

1. Alice watches an unfinished Run with an executing attempt, its existing claim,
   Git worktree and accepted Journal prefix. Dalph reserves the existing host
   subscription slot, attaches once and pins the first coherent publication.
2. Alice stops reading. Dalph drains publications into at most an initial and
   latest shared reference before disposable projection. Production source
   subscriptions carry bounded void hints, not a loss-free state backlog. Shared canonical state
   remains owned by delivery; these references can keep old canonical values
   alive and are reported separately, never counted as bounded optional bytes.
3. Before projecting, Dalph checks a finite structural preparation charge.
   On production Ready reads this includes the borrowed accepted prefix before
   allocating diagnostic arrays/maps; the reader does not export history. A
   large history may refuse the watch even if the final current frame is small. Before
   schema encoding/stringification, it checks finite structural and JSON-byte
   charges. Initial, pending and admitted whole writes have separate allowances.
   Oversized current state produces a typed refusal, never a truncated graph or
   historical cursor substitute. Skipped watch publications are not an audit log.
4. Disconnect interrupts only that observer's pump and writer, clears retained
   presentation values and returns its exact subscription slot. The attempt
   continues; no tracker, Git, executor or Journal operation is issued by the watch.
5. Alice reconnects without a historical cursor. A fresh attachment supplies the
   latest coherent state (or explicit refusal if it still exceeds capacity).
   A host crash loses these process-local resources; existing current-format
   reconstruction owns restart, and reconnect only repeats passive reads.

Preparation admission uses a logical structural charge: 64 bytes per visited
value/property plus two bytes per UTF-16 code unit, traversing repeated references
again and Map/Set contents. It bounds input admitted to projection, not V8 object
layout or total heap. Depth is limited to 64. At most one preparation runs per
subscription, with a 16 MiB input allowance; public presentation structures have
an 8 MiB allowance per value. JSON text retains the existing 2 MiB UTF-8 ceiling;
HTTP admits one record at a time plus its newline. MCP retains pinned initial,
latest pending and last-read values, each with that presentation allowance, and
uses the existing 8 MiB outer-message limit. Host/session count and all deadlines
are unchanged. Canonical bytes, runtime overhead, socket/kernel buffers and total
RSS are outside these logical optional-retention allowances.

Acceptance mapping (individual tests, not aggregate totals):

- Producer hint bound and latest reconnect: `current-signal.test.ts`,
  `A disposable observer pins current then reads latest after ten thousand updates without a value backlog`.
- Raw reference coalescing/current-first/release: `running-host-watch-stage.test.ts`,
  `Attachment preserves initial while its independent pump drains latest and releases upstream before Closed is read`.
- Production Ready diagnostic preparation before historical intermediates:
  `running-host-watch-diagnostics.test.ts`,
  `A Ready watch refuses large diagnostic preparation before materialization despite small current output, then reconnects passively`.
- Preparation/encoded boundaries including a single oversized string:
  `running-host-observer-budget.test.ts`.
- Public refusal, exact source release and latest-state reconnect:
  `running-host-inspection-watch.test.ts`.
- Native paused socket retained-byte profile and exact release:
  `running-host-observer-profile.test.ts` (records candidate/profile, RSS separately).
- Existing slot/deadline/order boundaries: `running-host-watch-http.test.ts` and
  `running-host-mcp-watch.test.ts`.
- Workflow isolation under actual watch-child death:
  `production-running-host.test.ts`, existing public-client delivery scenario.

The experiment's 1 GiB heap/1.5 GiB RSS safety ceiling is not an enforceable heap
cap. The profile declares its controlled workload; it does not claim capacity for
all canonical Runs or qualification of parent scenarios outside A2.

Measured acceptance evidence (2026-10-09, Linux arm64, Node v24.20.0):

The runtime/test candidate is `3764159d19962decd864ca6bfe7f8ae7679417f2`
against base `5af36c80649764cfdc77d6717c63fddb56cce941`. The subsequent
handoff commit only records this evidence. The clean native profile records
`candidateDiff: 0`, one observer, zero workflow records, a paused loopback TCP
reader, 64 replacements per started write and a maximum of 4096 updates. It
exercises the production whole-record writer and presentation stage, using a
synthetic frame payload; it does not measure a large canonical Run.

| Payload bytes | Published values | In-flight structural charge | Latest pending charge | Encoded admitted bytes | Native writable bytes | Total RSS bytes | Peak RSS bytes |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 262144 | 705 | 525906 | 525906 | 262339 | 262349 | 334528512 | 418725888 |
| 1835008 | 129 | 3671630 | 3671634 | 1835201 | 1835211 | 415617024 | 483622912 |

Both profiles reach the existing five-second typed `WriteTimedOut`. After exact
response destruction, native writable bytes equal zero; stopping the stage
clears initial/pending values and releases its source exactly once, including
when stopped again. Structural charges are bounded admission units, encoded
bytes are actual UTF-8 bytes, and RSS is process-wide observed memory. These
columns are separate quantities, not an inferred universal heap bound.

The mapped producer, diagnostic preparation, structural/JSON admission,
inspection refusal/reconnect, stage, HTTP and MCP watch tests pass. The existing
public delivery scenario also passes with actual CLI and MCP watch-child loss:
accepted history and tracker/Git/executor call counts remain unchanged while
work is executing; the same Run completes once, and clients read its coherent
terminal result. Its stale expected terminal shape was repaired to assert the
existing completion result and exact CLI/MCP agreement.

`check:fast`, `check:artifacts`, `check:package-boundary`, and `check:docs` pass.
Formal controls exposed a stale source manifest for the new producer module;
regenerating it and rerunning its focused control passes all 44 assertions.
The first scoped review's pre-materialization diagnostic-budget finding is
fixed and covered by the Ready large-history test. The fresh second review
reports no reasonable blocking findings. This is focused A2 acceptance, not a
claim that the parent issue's unrelated scenarios or a full gate were run.
