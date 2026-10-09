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
3. Before projecting, Dalph checks a finite structural preparation charge. Before
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
