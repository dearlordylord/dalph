# Alice attaches clients to one running Dalph

Alice starts one repository host separately; her CLI and agent's MCP process
attach to its selected Run. This document completes the technical contract of
[#366](https://github.com/dearlordylord/dalph/issues/366) under
[#365](https://github.com/dearlordylord/dalph/issues/365). It specifies the milestone
interfaces. The maintained #368 mapping below names the implemented passive
slice; later command and watch slices retain their separate acceptance owners.
Qualification evidence belongs to each implementation issue.

## Governing behavior and current seams

Preserve [Run establishment](run-establishment-and-activation.md),
[Run Pause](pause-whole-run.md), [reactivation](reactivate-incomplete-runs.md),
[capacity](resize-task-admission.md),
[current status](current-status-admission-witness.md),
[application Exit](graceful-application-exit.md), and
[changing-graph finality](changing-graph-finality.md).
[D21–D24](../DELIVERY-INVARIANTS.md#ambiguity-and-evidence),
[D35](../DELIVERY-INVARIANTS.md#progress),
[D38–D40](../DELIVERY-INVARIANTS.md#run-boundaries), and
[D47](../DELIVERY-INVARIANTS.md#operator-requests) constrain the refinements here.
The laws `applicationClaimsNoLaterEffects` in
[controlDirectionApplication](../../specs/controlDirectionApplication.qnt),
`latestPolicyControlsAdmission`, `onlyExactEstablishedRunActivates`,
`terminationRequiresExactFreshGraphEvidence` and
`terminationRequiresNoRetainedResponsibilityOrPosition` in
[runActivation](../../specs/runActivation.qnt), and the existing
[Exit mapping](application-exit-model-mapping.md) remain governing boundaries.
They do not prove transport buffering, callbacks, or public encodings.

The [production host](../../packages/dalph/src/application/production-host.ts)
already owns selection, coordinator scope, current publication, accepted-history
signal and an independent `JournaledRunTerminationSource`. Its observation
interface exposes publication controls and the passive accepted-prefix getter
used by the listening host.
The [bootstrap](../../packages/orchestrator/src/coordination/run/journaled-run-bootstrap.ts)
already returns accepted termination with exact `TraceCursor`, reads durable
reactivation control, and accesses capacity through active runtime controls.
The [CLI](../../packages/dalph/src/application/live-cli.ts) owns its
production invocation and the separate listening-host and passive attachment
commands.
The new adapters must reuse these instances and one projection, rather than
compose another host over the same database.

The core S10 correction has its own maintained chronology and test mapping in
[changing-graph finality](changing-graph-finality.md). Public replacement-client
proof remains required here; neither this document nor a successful core test
qualifies either public adapter.

## Explicit startup and selected-Run handshake

The following spellings are the selected future interface:

```text
dalph host --production --config /absolute/config.json --listen http://127.0.0.1:43127 github:OWNER/REPOSITORY#ISSUE
dalph attach descriptor --host http://127.0.0.1:43127 --json
dalph attach snapshot --host http://127.0.0.1:43127 --run RUN --json
dalph attach watch --host http://127.0.0.1:43127 --run RUN --json
dalph attach control --host http://127.0.0.1:43127 --run RUN --json
dalph attach capacity --host http://127.0.0.1:43127 --run RUN --json
dalph attach set-capacity --host http://127.0.0.1:43127 --run RUN --capacity 2 --expected-revision REV --json
dalph attach start --host http://127.0.0.1:43127 --run RUN --json
dalph attach unpause --host http://127.0.0.1:43127 --run RUN --json
dalph attach refresh --host http://127.0.0.1:43127 --run RUN --whole-graph --json
dalph attach refresh --host http://127.0.0.1:43127 --run RUN --task TASK_A --task TASK_B --json
dalph mcp --host http://127.0.0.1:43127 --run RUN
```

`host` is an explicit foreground owner using the existing production target and
configuration decoding, not an alias that starts a background daemon. Neither
`attach` nor `mcp` accepts target/configuration/root/executor selection. `resume`
is an exact CLI alias of `unpause`. `--json` is required for this first attached
CLI; no human-output variant is implied. The existing `run`, cancellation and
publication commands keep their existing meanings.

`LocalHostAddress` is an explicitly provided HTTP origin with a canonical literal IPv4 address, nonzero TCP port, and no credentials/path/query/fragment. The host
binds only the requested literal IPv4 address. There is no default port, discovery,
redirect following, hostname resolution, proxy routing, or automatic startup.
Reject browser Origin headers and nonmatching Host authorities; this is an explicitly selected
trusted-network boundary, not remote authentication. An occupied port fails startup
without attaching to its occupant. Advertise only after exact Run establishment
and successful bind. Host stdout emits one JSON `HostReady` descriptor, then
lifecycle diagnostics; clients never parse the host's logs to select work.

`GET /dalph/v1/descriptor` returns `HostDescriptor` containing `protocolVersion: 1`,
`hostInstanceId`, `selectedRun: { runId, target }`, and `limits` below. The target
uses the existing normalized tracker-target encoding. `hostInstanceId` is a
fresh process-local opaque string, not a Run identity or durable receipt. CLI
`descriptor` is the only request not requiring a previously supplied RunId.
Every operation carries `protocolVersion`, `hostInstanceId`, `runId`, and a
process-local `requestId`. Clients compare the supplied RunId to the descriptor
before sending it; the server repeats that check. A fresh handshake is required
after connection loss; a new host instance never silently inherits an old
request. Descriptor availability is not proof of an active runtime lease.

The exact closed descriptor/startup objects are:

```text
HostDescriptor = { _tag: "HostDescriptor", protocolVersion: 1, hostInstanceId,
  selectedRun: { runId, target }, limits: {
    requestBytes: 65536, resultBytes: 2097152, frameBytes: 8388608, hostSubscriptions: 32,
    mcpSessionWatches: 8, writeDeadlineMillis: 5000, unreadWatchMillis: 30000,
    closedResourceMillis: 30000, connectDeadlineMillis: 5000,
    responseDeadlineMillis: 30000
  } }
HostReady = { _tag: "HostReady", address: LocalHostAddress,
  descriptor: HostDescriptor }
```

`target` uses the existing TrackerTarget codec in
[target.ts](../../packages/orchestrator/src/authorities/task-tracker/target.ts).
Host stdout writes HostReady followed by LF; subsequent diagnostics use stderr.
Successful attached CLI `descriptor --json` prints HostDescriptor directly
followed by LF and exits 0; its failures use the common failure envelope and exit
rules below. The two client deadline fields bound connect and response waiting,
not host operation execution.

`POST /dalph/v1/request` accepts one decoded operation and returns one JSON
result. `POST /dalph/v1/watch` accepts `WatchSnapshots` and returns NDJSON.
Clients always send `Content-Type: application/json`; the version field is
mandatory. Unknown versions/fields/tags, extra root/target arguments, conflicting
refresh forms, invalid brands and duplicate advisory IDs are rejected before
admission. HTTP 200 carries an application success or typed application failure;
400 is malformed framing, 413 is request size rejection, 409 is wrong host
instance, and 503 is closing. These responses use the same failure envelope
when writable. An unavailable socket has no server response and is classified
locally, never invented as a host rejection.

## One decoded request and result algebra

All schemas are closed tagged unions decoded with Effect Schema at the boundary.
JSON has no `undefined`, nonfinite numbers, BigInt, provider error stacks or
unvalidated blobs. Existing identity/value schemas retain their exact encodings;
Run/task/attempt identities, capacity, revision, control ordinal and journal
position retain distinct branded types internally. Existing TaskWorkCapacity is
an integer from 1 through 8; RunPolicyRevision starts at 1. RunId and TaskId are
existing nonempty strings, not assumed UUIDs. `LocalHostAddress`,
`HostInstanceId`, `RequestId`, `SubscriptionId`, `FrameSequence`, `ByteLimit`,
`SubscriptionLimit` and `WriteDeadlineMillis` describe distinct process-local
phenomena; none is a workflow event or persisted cursor. Numeric counters and
positions must be safe integers; an unencodable value fails rather than rounding.

Request objects are exactly `{ protocolVersion: 1, hostInstanceId, requestId,
runId, operation }`, where `operation` is `{ _tag: OperationTag, ...input }`.
The operation table's additional input belongs inside `operation`; common fields
must not be repeated there. Every tagged alternative uses literal key `_tag`.
For example:

```json
{"protocolVersion":1,"hostInstanceId":"host-1","requestId":"request-7","runId":"R","operation":{"_tag":"SetCapacity","capacity":2,"expectedRevision":1}}
```

Unary envelopes are exactly `{ protocolVersion: 1, requestId, runId, result }`
(except successful descriptor, which returns the descriptor directly).
For Success both identifiers are decoded nonempty strings. For Failure only,
`requestId` and `runId` are independently nullable: retain each successfully
decoded field and use null for absent/invalid/unreadable fields. Never echo raw
invalid values or manufacture an identity. Handshake/HTTP framing failures use
both null; the exact error carries selected/requested identities when known.
This shape also carries local connection errors before submission. `result` is
`{ _tag: "Success", value }` or `{ _tag: "Failure", error }`. Every operation
below has `runId` in its common request; only listed additional fields are legal.

| Operation tag | Additional input | Success value | Operation-specific failures |
| --- | --- | --- | --- |
| `ReadSnapshot` | none | `Snapshot` below | `ProjectionFailed`, `FrameTooLarge` |
| `WatchSnapshots` | none | current-first sequence of `Snapshot` frames | `ProjectionFailed`, `FrameTooLarge`, `SubscriptionLimitExceeded`, `WriteTimedOut`, `TransportFailed` |
| `ReadRunControl` | none | `RunControl` below | `ReadFailed` |
| `ReadCapacity` | none | `CapacityRead { policy }` | `RunInactive`, `RunClosed`, `ReadFailed` |
| `SetCapacity` | `capacity`, `expectedRevision` | `CapacityApplied { policy }` | `RunInactive`, `RunClosed`, `PolicyRevisionConflict`, `CommandFailed`, `CommandOutcomeUnknown` |
| `StartWork` | none | `WakeSubmitted` | `RunClosed`, `CommandFailed`, `CommandOutcomeUnknown` |
| `Unpause` | none | `UnpauseApplied { ordinal, acceptedAt }` | `RunClosed`, `CommandFailed`, `UnpausePartiallyApplied`, `CommandOutcomeUnknown` |
| `Refresh` | `interest: WholeGraph` or `AdvisoryTasks { taskIds }` | `RefreshSubmitted { interest }` | `RunClosed`, `CommandFailed`, `CommandOutcomeUnknown` |

`policy` is the complete existing `RunControlPolicy`, not only capacity;
`acceptedAt` is `{ runId, position }`. `PolicyRevisionConflict` contains RunId,
original expected revision and complete current policy. A repeated accepted set
with its original revision conflicts without adding a second record. No adapter
reads a newer revision and retries automatically. Capacity contraction preserves
already admitted attempts and their exact Base/worktree/executor associations.

`WakeSubmitted` and `RefreshSubmitted` mean the owner hint call returned. They
prove neither queue retention, authority read, activation, selected task, nor
Unpause. An inactive owner may accept a hint; a stopped-owner race may still
return Submitted. Known terminal evidence rejects before submission. Advisory
IDs are nonempty and bounded by request bytes; they never change the rooted
complete-read scope or contribute tracker facts. WholeGraph carries no IDs.
No refresh receipt, durable request record, or correlation to a later graph
publication is introduced.

Common errors are defined, not collapsed into a generic command failure:

| Error tag | Required safe evidence and meaning |
| --- | --- |
| `InvalidRequest` | Field path and validation code; no operation admitted. |
| `RunMismatch` | Requested and selected RunId; no operation admitted. |
| `HostInstanceMismatch` | Requested and actual host instance; no operation admitted. |
| `HostUnavailable` | Address and connect failure code; connection failed before submission. |
| `ProtocolVersionUnsupported` | Requested version and supported versions; no operation admitted. |
| `HostClosing` | Host instance and cutoff observed; no new operation admitted. |
| `RunInactive` | RunId and operation; no live capacity lease, no implicit activation. |
| `RunClosed` | RunId, accepted disposition and exact `terminatedAt`; no terminal append. |
| `ReadFailed` / `ProjectionFailed` | Stable cause tag and sanitized detail; never fabricated empty state. |
| `CommandFailed` | Operation, stable cause tag, sanitized detail and proved pre-application stage; never claim rollback. |
| `UnpausePartiallyApplied` | Ordinal, exact acceptedAt and callback failure; journal application is accepted, callback completion is unproved. |
| `CommandOutcomeUnknown` | Operation/requestId, phase `AdmissionUnconfirmed` or `AdmittedCompletionUnconfirmed`, optional known acceptedAt; no success or rejection inferred. |
| `FrameTooLarge` | Direction, maximumBytes and measuredBytes when known; whole value rejected, never truncated. |
| `SubscriptionLimitExceeded` | Scope, limit and current count; no upstream subscription acquired. |
| `WriteTimedOut` | Subscription/request identifier and deadlineMillis; exact stalled writer closed. |
| `TransportFailed` | Phase and safe reason; no successful EOF or domain result inferred. |

Common decoding/identity/version/closing failures apply to every operation and
the handshake where meaningful. A connection failure after a mutating request
might have crossed admission is `CommandOutcomeUnknown`, not `HostUnavailable`.
A read/watch failure is `TransportFailed` because it has no workflow mutation to
attribute. If storage/publication failure leaves application uncertain, return
Unknown rather than `CommandFailed`. There is no callback-based partial success
for passive reads or hints. Cancellation proven before admission has no workflow
effect; a client that cannot prove that cut retains Unknown.

The error objects use these exact keys; all fields are required, and nullable
fields encode JSON null. `OperationTag` is a literal from the operation table;
identifiers and positions use their existing branded schemas. Diagnostic
`code`, `causeTag`, `detail` and `reason` are sanitized nonempty strings;
`fieldPath` is a JSON Pointer (the empty string identifies the whole request).
Counts and byte sizes are nonnegative safe integers, limits and durations are
positive safe integers. `Cursor` is exactly `{ runId, position }`.

```text
InvalidRequest { _tag, fieldPath, code }
RunMismatch { _tag, requestedRunId, selectedRunId }
HostInstanceMismatch { _tag, requestedHostInstanceId, actualHostInstanceId }
HostUnavailable { _tag, address, reason }
ProtocolVersionUnsupported { _tag, requestedVersion, supportedVersions: [1] }
HostClosing { _tag, hostInstanceId, cutoff: "AdmissionClosed" }
RunInactive { _tag, runId, operation: OperationTag }
RunClosed { _tag, runId, disposition, terminatedAt: Cursor }
ReadFailed | ProjectionFailed { _tag, causeTag, detail }
CommandFailed { _tag, operation: OperationTag, causeTag, detail,
  stage: "PreAdmission" | "BeforeApplication" }
UnpausePartiallyApplied { _tag, ordinal, acceptedAt: Cursor, causeTag, detail }
CommandOutcomeUnknown { _tag, operation: OperationTag, requestId,
  phase: "AdmissionUnconfirmed" | "AdmittedCompletionUnconfirmed",
  acceptedAt: Cursor | null }
FrameTooLarge { _tag, direction: "Incoming" | "Outgoing", maximumBytes,
  measuredBytes: integer | null }
SubscriptionLimitExceeded { _tag, scope: "Host" | "McpSession", limit, current }
WriteTimedOut { _tag, subject: { _tag: "Request", requestId } |
  { _tag: "Subscription", subscriptionId }, deadlineMillis }
TransportFailed { _tag, phase: "Connect" | "Handshake" | "Response" |
  "Watch" | "Write", reason }
```

Each `_tag` is the named alternative's literal. `requestedVersion` is the
decoded safe integer that failed version negotiation; an invalid version value
is InvalidRequest instead. In particular, an accepted operation's ambiguous
storage acknowledgement can never be encoded with either CommandFailed stage.

## Passive state and accepted termination are separate

`Snapshot` is exactly one projected `DeliveryRuntimeObservationState` publication.
These are closed JSON objects (all fields below required; nullable means JSON
null, never omission):

```text
{ _tag: "NotReady", runId }
{ _tag: "Ready", runId, acceptedAt, graph, frontier, delivery, retained, held }
{ _tag: "Closed", runId, final: Ready | null }
```

`acceptedAt` is `{ runId, position: evaluation.acceptedAt }` or null, using the
selected RunId and that publication's accepted position. It is not a read of
the independent accepted-history signal.
The source's Closed final is Ready or null; do not synthesize a NotReady final.
The following codecs and fields are normative V1 wire definitions, not a request
for #368 to choose another DTO:

| Field | Exact encoding and source from that one publication |
| --- | --- |
| `graph` | `{ _tag: "GraphNotEstablished" }` or `{ _tag: "GraphEstablished", snapshot }`. `snapshot` is `Schema.encode(TaskDagWire)(observation.snapshot.toWire())` using [TaskDagWire](../../packages/orchestrator/src/authorities/task-tracker/graph.ts), schemaVersion 1. |
| `frontier` | `{ policy, standings, placements }`, from the same ticketDeliveries.source and its source frontier. `policy` is the existing RunControlPolicy JSON. `standings` and `placements` are the closed unions below, not raw relation objects. |
| `delivery` | Exact JSON encoded by [ProductionCliCurrentDeliveryStatus](../../packages/dalph/src/application/production-cli-status-schema.ts) after `publicDeliveryStatusOf(deliveryStatusOf({ _tag: "Run", runId }, ready))`. For this Ready field the result must be DeliveryStatusAvailable; any identity/projection contradiction fails the whole snapshot. |
| `retained` | Array of `{ taskId, obligationReference, kind, plannedAttempt }`, one per exact ticket-delivery obligation. `obligationReference` uses existing `deliveryStatusObligationReference` and the public ObligationReference codec; `kind` is `WorkflowResponsibility`, `AcceptedAwaitingIntegration`, `QueuedIntegration` or `StartedIntegration`. `plannedAttempt` is the exact existing PlannedTaskAttempt JSON when this obligation carries one, otherwise null; never reconstruct an invented plan from graph placement. |
| `held` | Array of `{ taskId, correlation }` copied from evaluation.taskWork.held. `correlation` uses existing PlannedAttemptExecutorCorrelation JSON `{ runId, attemptId }`; this means an executor-held position, distinct from the broader retained array. |

TaskDagWire is exactly `{ schemaVersion: 1, revision, tasks }`; each task is
`{ id, lifecycle, parentTaskId, prerequisiteIds }`. Lifecycle is the tagged union
`{ _tag: "Open" } | { _tag: "CompletedSuccessfully" } |
{ _tag: "TerminalWithoutSuccess" }`. `parentTaskId` is nullable; prerequisiteIds
is an array. Thus grouping and prerequisite edges retain their existing distinct
encodings rather than a lossy generic edge list. Tasks without attempts remain
present. The graph's existing validated normalization/order is retained.

`standings` is an array of `{ _tag: "Eligible", taskId, taskRevision }` or
`{ _tag: "Excluded", taskId, reasons }`. Each reason is exactly
`{ _tag: "PrerequisitesIncomplete", prerequisiteTaskIds }`,
`{ _tag: "SuccessfulCompletion" }`, or `{ _tag: "TerminalWithoutSuccess" }`;
Excluded reasons is nonempty. `placements` is an array of `{ taskId, placement }`,
where placement is `{ _tag: "Selected", rank }`,
`{ _tag: "EligibleOutsideBound", rank }`, or
`{ _tag: "GraphExcluded", reasons }` with the same reason union. Rank is the
existing nonnegative BoundedTicketRank. These are desired graph placements,
never held-position or executor-lifecycle claims. If the graph is not established,
its frontier standings/placements are the actual corresponding publication's
arrays; do not substitute cached graph arrays.

[PlannedTaskAttempt](../../packages/contracts/src/planned-attempt.ts) encodes
`{ attemptId, baseSha, branch, executor, runId, taskId, taskRevision, worktree }`.
The existing nonempty-string TaskExecutorLocator in `executor` is the optional
opaque executor association exposed when plannedAttempt is nonnull; it supplies
no provider transcript, session internals or native interaction guarantee.
Retained tasks may be absent from current graph/placements and must remain
visible. All nested RunIds must equal selected R. Preserve source array order;
serialize retained entries by taskId then obligationReference and held entries
by taskId then attemptId using lexical code-point ordering for deterministic
encoding. Unknown alternatives, duplicate exact obligation references, invalid
brands or inconsistent identities cause ProjectionFailed for the whole value.

The public delivery codec retains all its named waiting/progressing/blocked/
settled/relinquished alternatives, entry/evidence identities, wake conditions,
capacity holders and exact attempt fields; its exhaustive public projection
removes executable payloads and private authority. No raw runtime object is
serialized. Snapshots cause no tracker, Git, executor, journal append or
activation. A retained display graph is marked stale outside this DTO and cannot
replace GraphNotEstablished.

`ReadRunControl` uses a new read-only projection of one already accepted journal
prefix and returns one of `RunPaused`, `RunUnpaused`, or `RunTerminated`, together with a
separately labelled `terminationEvidence`:

```text
{ _tag: "RunPaused", controlObservedAt, terminationEvidence: Pending | FinalityFailed }
{ _tag: "RunUnpaused", controlObservedAt, terminationEvidence: Pending | FinalityFailed }
{ _tag: "RunTerminated", terminationEvidence: Accepted }
Pending = { _tag: "Pending" }
Accepted = { _tag: "Accepted", disposition, terminatedAt }
FinalityFailed = { _tag: "FinalityFailed", failure: {
  _tag: "WorkflowRunTerminationEvidenceInvalid", runId, detail
} }
```

For example, a complete terminal read is:

```json
{"protocolVersion":1,"requestId":"request-8","runId":"R","result":{"_tag":"Success","value":{"_tag":"RunTerminated","terminationEvidence":{"_tag":"Accepted","disposition":"Blocked","terminatedAt":{"runId":"R","position":42}}}}}
```

The disposition literal uses the existing RunTerminationDisposition codec.

`controlObservedAt` identifies the exact accepted journal prefix used for that
control result. Do not directly delegate this passive operation to current
`readRunReactivationControl`: its recovery path can establish stored state, close
observation and publish terminal/established signals. #368 must expose the
minimal immutable accepted-control projection without those effects. The terminal alternative reads the exact terminal record from
that same accepted prefix; it cannot return RunTerminated with missing position.
`disposition` is the existing `Completed | Blocked | Cancelled` domain value.
Pending means no accepted termination was established by this read, not a promise
that termination cannot race immediately afterward. It is valid for a snapshot
to be Closed while this separate evidence is Pending, or for Accepted to coexist
with a still-open snapshot source. Independent reads are never presented as an
atomic joined snapshot.

The host must retain the latest typed finality rejection process-locally before
closing its current signal or ending the failed activation. `ReadRunControl`
exposes `FinalityFailed` until later accepted termination supersedes it; MCP and
CLI encode the original stable tag. This is a required new public error path:
the current termination poll's `None` cannot distinguish pending from failure.
It appends no synthetic terminal/failure journal event. A restarted host may
report Pending until ordinary reconstruction/activation observes the failure
again; it must not invent a durable rejection. A finality failure cannot change
the durable pause direction or become Completed. A separate failure after a
proved terminal record does not erase Accepted. The passive read cannot trigger
finality merely to populate the field.

The host remains available after Run termination or a failed activation so a
replacement client can inspect these facts; only its explicit lifecycle Exit
ends the listening process. Retaining the host does not reopen a terminal Run.
Existing coordinator ownership remains held for that host lifetime. #368 must
provide a host-scoped failure monitor and listener lifetime outside the current
`withDecodedProductionRepositoryHost` use/activation-failure race: merely adding
a listener to the existing callback would lose the public failure on teardown.
The monitor retains typed outcomes, does not restart failed delivery, and permits
passive inspection until explicit host Exit. While it holds an activation
failure, reject every new mutation as CommandFailed with causeTag
DeliveryActivationFailed and stage PreAdmission. Capacity reads without a lease
remain RunInactive. Only the original typed finality error produces FinalityFailed;
other failures do not invent a Run disposition. A previously admitted operation
may still establish accepted termination, which supersedes the rejection.
No hint or Unpause bypasses this failure fence or retries the failed activation. This is the
explicit `host` command's lifetime, not a silent change to existing `run`.

## Host command ownership and Exit cutoff

Decode, verify version/instance/Run, and check known terminal evidence before
admission. Atomically admit a complete host-owned operation under the existing
Exit lifecycle boundary, then start it. A request connection owns only its result
wait. Protect Unpause journal acceptance, accepted publication, and the actual
bootstrap owner callback as one command lifetime. `UnpauseApplied` is emitted
only after that callback returns; protecting INSERT alone is insufficient.
MCP cancellation, client SIGTERM, CLI timeout or broken stdout after admission
cannot cancel that operation. No durable command receipt or replay service is
introduced. Transport request IDs are not idempotency keys.

Run Pause and Unpause serialize their complete append/publication/callback
boundary, so an intervening Pause cannot publish and notify the owner before
the earlier accepted Unpause callback settles. This preserves S5's latest
direction; task controls retain their separate membership boundary.
If SQLite commits but its acknowledgement is unavailable, Unpause reports
Unknown and retains a process-local reconciliation fence. Passive control still
labels the last acknowledged accepted prefix and does not claim rollback or
callback completion. Another attached Unpause is rejected before application
until an explicitly reopened exact host reconstructs its Journal; StartWork
cannot repair that uncertainty. No pending direction is replayed by a reader.

The existing graceful Exit cutoff rejects **all new** descriptor/read/watch and
mutating requests with HostClosing. Existing passive watches remain alive only
to deliver final Closed within the existing drain budget. MCP resource reads
that consume an already admitted watch are its drain, not a new passive Run
read; permit these and release/unsubscribe after cutoff, while refusing new
watch allocations and ordinary snapshot/control/descriptor reads; existing admitted
commands follow that same bounded drain, not a new unlimited uninterruptible
region. Existing reads may finish within the budget. Closing a client releases
only its transport/subscriptions, never requests Exit, releases a workflow
responsibility, or proves an executor stopped. Host signals use the existing
supervisor/Exit path; neither adapter exposes remote Pause or Exit.

If the budget ends before a reply, report only known partial/unknown evidence
when writable, then close; do not extend the drain to satisfy the transport
write deadline. Host process death yields transport failure/Unknown. A fresh
explicit host startup reconstructs durable control and exact responsibilities
under the existing protocol, without repeating Unpause. No inferred stopped
writers, cleanup, second beginning or replacement attempt is permitted.

## CLI and local HTTP framing

Unary CLI stdout is exactly one UTF-8 JSON envelope followed by LF; diagnostics
use stderr. Exit 0 means the requested operation returned Success, including
Pending, FinalityFailed, GraphNotEstablished or Closed as honest passive values.
Exit 2 means a known request/application failure; exit 3 means unavailable/failed
transport or unknown command outcome. ReadRunControl's FinalityFailed is also
printed unchanged, so an automation checks its tag rather than equating process
success with Run success. No stdout progress chatter accompanies JSON.

Watch stdout/HTTP body is NDJSON, one complete frame per LF:
`{ protocolVersion: 1, requestId, runId, subscriptionId, sequence, frame }`.
`frame` is `{ _tag: "Snapshot", value }` or `{ _tag: "Failure", error }`. Sequence starts at zero
for the subscription and increases for each emitted frame; it is neither a
journal cursor nor durable replay token. Different publications at the same
journal position remain eligible updates. No Last-Event-ID/replay option exists.
A Snapshot whose value is Closed is the final successful frame, followed by EOF
and CLI exit 0. Failure then EOF is exit 2 or 3 according to the error above.
Bare EOF before Closed/Failure is TransportFailed and exit 3, including abrupt
host death. A broken stdout may prevent printing that failure, but still yields
nonzero exit. Reconnect creates a new current-first subscription.

## MCP tools, resources and subscriptions

Pin MCP negotiation to `2025-11-25`; reject a peer with no common version rather
than silently using another resources protocol. This deliberate supported
revision is independent from local HTTP protocolVersion 1. The bridge uses
stdio JSON-RPC with `tools` and `resources: { subscribe: true }` capabilities;
stdout contains only MCP messages. The standard
[resources protocol](https://modelcontextprotocol.io/specification/2025-11-25/server/resources)
notifies a changed URI; clients then read its contents. The standard
[tools protocol](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
provides structured tool results. No invented inline-snapshot notification is
part of this contract.

Tools are `dalph_read_snapshot`, `dalph_read_run_control`, `dalph_read_capacity`,
`dalph_set_capacity`, `dalph_start_work`, `dalph_unpause`, `dalph_refresh`,
`dalph_watch_snapshots` and `dalph_close_watch`. Their arguments are the shared
operation input including exact RunId; host instance/version come from the
bridge handshake. They return the shared envelope in `structuredContent` plus
a text JSON copy and a declared outputSchema. Domain failures set `isError:
true`; malformed MCP/unknown method errors use JSON-RPC errors. Tool cancellation
only cancels the client's wait after host admission. No task-authoring or generic
command tool is exposed. Tool arguments are closed objects `{ runId, ...input }`
with the operation table's additional fields; the tool name supplies the
operation tag. The bridge supplies a fresh RequestId for each invocation, not
the MCP JSON-RPC message ID. `dalph_watch_snapshots` takes only `{ runId }`;
`dalph_close_watch` takes exactly `{ runId, subscriptionId }` and returns
`{ _tag: "WatchClosed", subscriptionId }` in the shared success envelope.

`resources/list` exposes `dalph://host/descriptor` and the exact selected Run's
`dalph://runs/{percentEncodedRunId}/snapshot` and `/control`. `resources/read`
returns one application/json text content with the descriptor or shared passive
result. Static snapshot/control resources are read-only and not subscribable;
watch resources below are the supported subscriptions. URI Run mismatch is the
same typed failure, never an alternate selection.

`dalph_watch_snapshots` opens the same shared WatchSnapshots operation and
returns `WatchOpened { subscriptionId, uri }`, with URI
`dalph://runs/{percentEncodedRunId}/watches/{subscriptionId}`. The bridge pins the
first complete frame before returning WatchOpened. The client subscribes to that
URI and then calls resources/read. The first read returns the pinned initial
frame even if newer states arrived; subsequent reads consume at most one latest
pending frame. After a read, another pending frame causes an update notification.
`resources/subscribe` immediately schedules an update notification if a frame
is already pending, preventing a lost wake between open/subscribe/read. Reads of one watch are serialized, and mailbox consumption changes only
process-local presentation state, with no workflow effects. A read
with no new frame repeats the last delivered complete frame, with its unchanged
sequence. Resource reads are passive presentation operations, never authority
reads or command replay.

Closed supersedes a pending ordinary frame but not the unread initial frame.
After the client reads the initial frame, Closed remains readable next. The
Closed read completes the logical watch. Its host source subscription is released
when Closed is observed, independently of resource consumption; its
frameBytes-bounded final resource remains readable until explicit close/unsubscribe, session
exit, or expiry. MCP process EOF is not normal watch completion: the client must
have read Closed. Failure frames likewise end the logical watch, never imply
Run disposition, and retain typed diagnostics. `resources/unsubscribe` or
`dalph_close_watch { runId, subscriptionId }` releases the watch exactly once;
closing an already closed same-session watch succeeds without outside effects.
Unknown or foreign IDs are InvalidRequest. For resources methods encode that
error in JSON-RPC `-32002` data with the shared failure envelope; invalid params
use `-32602`, unsupported method `-32601`, internal transport/handler failure
`-32603`, each preserving safe typed error data when available. Other MCP calls can continue after
one watch closes. A lost bridge/stdio stream cannot guarantee a final frame.

## Finite adapter limits and exact release

The descriptor exposes these fixed V1 defaults; implementation must test these
numbers, not merely document configurable intentions:

| Limit | Value and unit | Admission/failure |
| --- | --- | --- |
| `requestBytes` | 65,536 UTF-8 bytes of one HTTP JSON body or incoming MCP JSON message, excluding its delimiter LF | Reject before decode/admission with FrameTooLarge; streaming count stops at limit + 1. |
| `resultBytes` | 2,097,152 UTF-8 bytes of the shared unary envelope or watch frame before adapter wrapping, excluding delimiter LF | Both adapters reject the same oversized application value with FrameTooLarge before encoding their transport. |
| `frameBytes` | 8,388,608 UTF-8 bytes of one complete serialized outgoing envelope, including JSON escaping and LF for NDJSON | Measure before write; FrameTooLarge replaces the whole frame. Never split/truncate a graph. MCP outer message must also fit. |
| `hostSubscriptions` | 32 concurrent WatchSnapshots leases per host, across CLI and MCP | Reserve atomically before acquiring CurrentSignal; reject excess with SubscriptionLimitExceeded. |
| `mcpSessionWatches` | 8 allocated watch resources per bridge session, including retained closed resources | Reserve before host watch; reject excess without upstream allocation. |
| `writeDeadlineMillis` | 5,000 milliseconds per whole frame write, measured from handing it to transport through actual backpressure/flush completion | On timeout close the exact writer and subscription; cannot exceed remaining Exit budget. |
| `unreadWatchMillis` | 30,000 milliseconds without consuming a pending MCP frame | Expire watch, release upstream and retain WatchExpired as typed TransportFailed reason until resource expiry. |
| `closedResourceMillis` | 30,000 milliseconds after Closed/failure/expiry | Drop retained resource and its session slot; later read is InvalidRequest, never fabricated Closed. |

The HTTP client connect deadline is 5,000 ms; unary response waiting is 30,000 ms.
A timed-out mutating wait reports Unknown and leaves the admitted host command
owned; these are client waits, not new command/drain budgets. Descriptor exposes
these two millisecond values too. Idle watches need no heartbeat and no write
clock runs without a frame. MCP expiry uses controlled time in tests and starts
when a frame becomes pending, not repeatedly on every replacing publication.
An idle watch with no unread frame may remain subscribed until explicit release.

The adapter keeps one preserved initial frame until its first write/read, at
most one pending latest complete state, and at most one currently written
frame. Closed replaces pending ordinary state. This includes the short interval
where initial, latest and writer ownership coexist; it is not described as a
one-object global bound. After consuming the initial MCP frame, the bridge keeps
one last-delivered frame in place of that initial slot so an unchanged resource
read can repeat it. That slot is also frameBytes-bounded and is discarded on
resource release; a repeated read does not allocate another retained frame.
The shared resultBytes ceiling preserves result parity even though MCP wraps
the value in both structuredContent and escaped text. The separate frameBytes
check still measures the actual complete transport message; an estimate of
encoding overhead is not proof that it fits. Adapter-only framing/write
failures remain distinct from shared application results. Serialization failure/oversize produces one small
failure envelope if writable, otherwise transport failure. A failed partial
write cannot safely append a JSON failure to that stream: abort it instead.
The server releases the source subscription immediately on Closed/failure;
the bridge may retain bounded final bytes until the resource rules above end.

Each watch has separate upstream and downstream scopes. On source Closed,
retain the final frame, stop the pump, finalize the exact CurrentSignal
subscription and return its host slot immediately. Keep the downstream writer
and bounded mailbox alive to flush the preserved initial and Closed frames;
close the HTTP response only after Closed flushes, or on failure/deadline. MCP
retains its bounded final resource under the separate resource-expiry rules.
Source failure likewise releases upstream immediately while a writable
downstream may send its small failure frame. Neither case cancels the writer
before its required final frame has had its bounded opportunity to flush.

On limit/projection failure, writer deadline, HTTP disconnect, MCP
unsubscribe/close, creation cancellation, bridge death or host finalization,
release each still-held reservation once: stop pump/writer fibers as applicable,
finalize the exact source subscription, return the host slot, and close the
owned response/socket or resource mailbox. A source slot already returned on
Closed is not released again when downstream ends. Never borrow another
watch's release or drop executor responsibility.
A failed allocation rolls back both session and host reservations. Subscribing
twice to one URI does not allocate another source lease. Notifications retain
at most one pending URI hint per watch, plus the message currently being written;
they must not form another unbounded queue.

The existing upstream CurrentSignal/SubscriptionRef can retain an **unbounded
queue** while its consumer is delayed. The pump must consume independently from
transport writes and coalesce at the adapter, but scheduler stalls or projection
work can still grow upstream retention. These finite adapter counts/bytes do not
claim bounded total host memory. #372 must instrument upstream subscription
acquisition/finalization and prove that disconnect releases that exact queue;
a slow-write test that observes only the sliding slot is insufficient. Shutdown
must keep writable watches alive to send Closed within the original Exit drain;
a stalled one fails independently without extending host lifetime.

### Required limit and failure assertions

Each name below is a required parameterized test, owned by #372 unless stated.
Test boundaries with controlled clocks/writers; a single aggregate load test is
not evidence for these independently observable outcomes.

| Required test | Exact cases and adapter boundary |
| --- | --- |
| `Oversized requests are rejected before operation admission` | 65,536 bytes accepted if valid, 65,537 rejected; HTTP and incoming MCP; zero operation calls. #368 owns framing, #372 includes watch requests. |
| `Both adapters reject the same oversized application result` | Shared envelope/frame at 2,097,152 bytes accepted if otherwise valid, next byte rejected identically before CLI/MCP wrapping; compare normalized failure and zero truncated graphs. #368 owns unary projection, #372 watches. |
| `Complete outgoing frames fit the advertised byte ceiling` | 8,388,608 bytes accepted, next byte rejected; HTTP JSON, CLI NDJSON and full MCP outer JSON including escaped text plus structuredContent; no partial graph. |
| `Subscription reservations enforce host and session limits` | Host 32 accepted/33rd rejected across adapters; MCP session 8 accepted/9th rejected including retained final resources; concurrent admission, failed allocation rollback and duplicate subscribe. |
| `Blocked transport writes release the exact subscription` | Writable before 5,000 ms succeeds; still blocked at 5,000 ms aborts; CLI stdout, HTTP socket and MCP stdout; partial frame is aborted, no appended invalid JSON failure. |
| `Unread MCP watches expire without an executor effect` | Unsubscribed initial and subscribed unread pending expire at 30,000 ms; replacement publications do not reset timer; timely reads resume it; zero workflow effects. |
| `Final MCP resource expiry returns its session reservation` | Closed, failure and expired-watch resources drop at 30,000 ms; later reads are typed resource-not-found; closed payload remains frameBytes-bounded while retained. |
| `Every watch exit finalizes its exact upstream subscription` | Closed observed before downstream read, explicit unsubscribe/close, client death, creation cancellation, projection/byte failure, write timeout and host finalization; exact queue/fiber finalizers and slot release, no release of another watch. |
| `Exit preserves Closed delivery inside its original budget` | Writable CLI emits Closed then EOF; admitted MCP watch reads consume Closed despite new-read cutoff; stalled connections fail without extending Exit; abrupt host death is TransportFailed. |
| `Both adapters preserve the shared failure algebra` | #368 parameterizes every read/handshake common error; #369 every StartWork/Unpause error including pre-admission, unknown storage outcome and accepted callback failure; #370 every capacity conflict/inactive/terminal/error; #371 every Refresh variant/error. Each operation runs through real adapter decoding and encoding; impossible variants are rejected rather than fabricated. |

## Chronological acceptance scenarios

Unless overridden, Alice's host owns one Run R for root C and its coordinator
lock. GitHub has open A, B and C, with C requiring successful A and B; grouping
is separate. SQLite contains one beginning, capacity one/revision r, and A's
claim, immutable plan and executing responsibility. Git has A's exact branch,
worktree and planned Base. B/C have no attempts. Every named test below is
required future public evidence; the owner issues are implementation scopes.

| Row | Starting facts, trigger and ordered boundary calls | Cuts, retries, visible and forbidden results | Result/encoding and required test owner |
| --- | --- | --- | --- |
| S1 | From shared facts, CLI and MCP handshake, verify R, read snapshot/control and open watches. Gate a publication at attachment. Projection consumes one publication, without authority calls or append. | Disconnect/reconnect reads fresh current; no replay required. Preserve unread initial, graph edges and tasks without executors; do not splice control into snapshot or start work. | Descriptor, Snapshot and RunControl; CLI JSON/NDJSON, MCP structured result/resource. #368 `Alice and two clients observe one Run without starting work`; #372 `Attachment preserves the first publication across a simultaneous update`. |
| S2 | From S1, terminate CLI and MCP child while A executes; original host remains. Reconnect replacement client, then release controlled provider completion through real integration/promotion/confirmation. | Client death at watch/command wait does not request Exit or release responsibility. Fresh client sees same R; one minimal task fixture reaches Accepted Completed. | TransportFailed only for lost client stream; separate Accepted termination. #368 `MCP and CLI exit while the original host completes delivery`; #375 repeats both actual process cuts. |
| S3 | From shared capacity r, read policy, set capacity two with r; ordinary admission starts B while C remains blocked. Read next revision, set one. | Lose response after acceptance: read current, optionally retry original expected revision; conflict, no duplicate record or automatic overwrite. Do not preempt A/B or alter exact plans. | CapacityRead/Applied and PolicyRevisionConflict in shared envelope. #370 `Agent raises and lowers capacity without replacing running attempts`. |
| S4 | Add durable Run Pause. StartWork, timer and Refresh preserve Pause. Explicit Unpause appends one direction, publishes acceptance, calls owner to restart timer and permit ordinary safe activation. | Gate before INSERT, after INSERT/before COMMIT, after COMMIT/before publication, and after publication/before callback; kill client at each cut. Complete once under host ownership. Callback failure returns partial with exact ordinal/position, never rollback or full Applied. | WakeSubmitted, RefreshSubmitted, UnpauseApplied/PartiallyApplied/Unknown; both adapters. #369 `Start work preserves Pause and disconnected Unpause reaches the owner once`; real SQLite/bootstrap/owner fixture. |
| S5 | Two clients read r then race different SetCapacity requests. In separate paused fixture lose Unpause response, read control, then apply Pause through existing owning boundary. | Exactly one capacity winner; original-revision retry conflicts. Before-admission cancellation proves no call. Uncertain cut remains Unknown. Never replay old Unpause over later Pause; current control cannot identify a lost request. | Full conflict/current policy; Unknown distinct from HostUnavailable/CommandFailed. #369 and #370 `Two clients preserve control decisions after races and lost responses`. |
| S6 | Agent authors E and E-to-C blocker directly in GitHub, then Refresh WholeGraph or advisory [C,E]. Owner hint coalesces; ordinary workflow records intent, reads complete rooted graph and accepts observation. Repeat without hint using startup/timer. | Lost/repeated hints do not prove read or force it while paused/idle/active. Known terminal refuses; stopped-owner race may submit. Let A/B/E then C deliver and settle; only later qualified read supports Completed. No task selection or client-authored facts. | RefreshSubmitted then independent Snapshot and Accepted Completed. #371 `Tracker edits appear through hints or timer without selecting IDs`; #375 owns full A/B/E-to-C suffix. |
| S7 | Override: new D in grouping closure has no blocker or responsibility and capacity is free. Complete scheduled read occurs before agent's later E blocker edit. Separate case: E already blocks D but required page/read is unavailable. | First case may admit D under Q17; second cannot infer absence or admit from incomplete evidence. GraphNotEstablished is visible during refresh, not deletion. No crash/retry cut needed; ordinary bounded later reads remain independent. | Snapshot graph alternatives, unchanged status conflicts; no readiness transaction or automatic yield. #373 `Complete intermediate edits permit admission while incomplete evidence does not`. |
| S8 | From S1, hold writer while multiple complete publications occur, including two at same journal position; then publish Closed. Exercise exact byte/count/deadline/expiry boundaries in separate controlled variants. | Preserve initial, coalesce latest, prefer Closed; writable recovery emits Closed before logical EOF. Timeout/disconnect releases exact upstream queue and slot; abrupt death without Closed is failure. Reconnect reads current Closed if host available. No tracker/Git/executor work. | NDJSON Closed/Failure; MCP URI notification then resource Closed/Failure. #372 `Slow watchers coalesce or disconnect and never invent completion`, plus each limit and exact-release assertion. |
| S9 | From S4 kill actual host after durable Unpause before callback. Separately start host over same Git/SQLite; reacquire ownership, reconstruct R/control and restart owner timer. Separate graceful branch requests existing supervisor Exit while command admission is gated. | Unknown after host death; no automatic Unpause retry. Same beginning/ordinal/attempt/Base/worktree/executor; reconcile uncertain external effects before retries. At cutoff reject new reads/watches/mutations; admitted commands follow bounded drain, not client lifetime. | HostUnavailable/Unknown/HostClosing, later descriptor same R/new instance. #374 `Host loss reconstructs durable Unpause and exact work without retry`; #369 `Exit cuts off complete attached operations atomically`. |
| S10 negative | Override: root A executes at capacity one; tracker adds B/D under A, B requires unsuccessful C, then makes D unsuccessful. Replacement client sees four tasks; A's retained responsibility prevents another executor. Release A through real promotion/confirmation. Controlled g10/g11 history omits required predecessors. | Validator rejects incomparable evidence; zero terminal records. No crash/mutation retry involved. Do not infer disposition from A's success, Closed or journal-position order. Keep the independent negative control despite corrected producer. | ReadRunControl terminationEvidence FinalityFailed preserves WorkflowRunTerminationEvidenceInvalid; Snapshot independent. #375 `Replacement clients see incomparable graph finality failure without a terminal record`; core seam remains #367 mapping above. |
| S10 corrected | Same four-task chronology with justified causal replacement evidence under unchanged validator; settle all obligations after A succeeds. B remains blocked by unsuccessful C and D unsuccessful. | Replacement client observes actual accepted Blocked and exact position; never Completed. No crash needed; reread is passive. | Accepted Blocked and independent actual snapshot lifecycle. #375 `Changed graph settles with justified causal evidence and Blocked disposition`. |
| S11 | Override: no host/no client-created history, or host fixed to R. Client uses unavailable address, malformed payload, unsupported version, stale host instance, or Run X. Decode/handshake/identity checks precede operation. | Retry only after correcting configuration/new handshake; never auto-start, switch roots or append. Reject excess fields and remote address. No workflow/provider call in any rejection. | Exact common error union in CLI/MCP, including JSON-RPC versus application distinction. #368 `Unavailable host and wrong Run cause no workflow effects`. |
| S12 | From shared facts let active lease end with unfinished R. Read/set capacity; then deliberate StartWork may offer ordinary unpaused activation. Separate case accepts Run termination. | Inactive read/set does not activate or synthesize policy; later set retains chosen expected revision. Known terminal returns RunClosed with exact position; racing inactive may remain RunInactive. No reopening/append. Current source may remain open after Accepted. No crash here; response loss follows S5. | RunInactive/RunClosed and passive Pending/Accepted independent from snapshot Closed. #368, #370, #375 `Inactive capacity is explicit and a terminal Run never reopens`. |

## Refresh discovery acceptance ownership

[#371](https://github.com/dearlordylord/dalph/issues/371) adds the public
`Refresh` operation to the complete host-owned command boundary from #369.
Both clients decode the same closed `RefreshInterest` alternatives. The host
passes only `TrackerNotification` to the existing owner; IDs are echoed as
requested interest, never passed to tracker graph readers or work selection.

The maintained recorded cassette **trackerRefreshDiscoveryPrefix** is generated
from the real Git/SQLite/production-host fixture in
[`running-host-refresh.acceptance.test.ts`](../../packages/dalph/src/application/running-host-refresh.acceptance.test.ts).
Its startup, timer, whole-graph CLI/MCP, advisory CLI/MCP and coalesced variants
record ordinary read intents and qualified observations. Every recording is
projected and round-tripped through all four existing equivalence checks. This
is a discovery prefix, not the A/B/E-to-C completion cassette owned by #375.
The fixture authors E and its explicit blocker in its controlled GitHub adapter;
the public hint never authors tracker data.

| Owned scenario | Maintained assertion and boundary |
| --- | --- |
| S6 startup/timer discovery | `tracker edits appear through Startup/Timer as complete qualified E-to-C facts, independently of submission`: no notification, complete rooted observation, intent before the provider read, accepted E-to-C blocker, unchanged root and one Begin. |
| S6 public active discovery | The same CLIWhole/CLIAdvisory/MCPWhole/MCPAdvisory variants return only `RefreshSubmitted { interest }` while the graph provider is held. Later accepted observations and independently read snapshots show all four tasks and the blocker. Advisory C/E plus an outside-root ID neither narrow coverage nor expand scope. |
| S6 idle/coalesced owner | Discovery variants wait for the actual initial idle handoff before submitting; Coalesced submits both clients repeatedly while the read is held, without another concurrent read, and permits at most one trailing executing-work read. |
| S6 no executing subject | [`production-reactivation.test.ts`](../../packages/dalph/src/application/production-reactivation.test.ts): `a tracker notification without a qualifying executing subject does not invent an executing-work read`, with safely suspended and terminal attempt reports. An ordinary establishment read remains possible; no executor command or Run termination is inferred. |
| S4 public paused refresh | CLI/MCP `public refresh preserves durable Pause without timer, polling, journal append or fresh work`: both interest forms, real paused owner/SQLite, then two hours of controlled time; zero tracker/Git calls, timer starts, Begin or control append. Wake/Unpause remains #369's scope. |
| S11/S12 refresh rejection | Both clients reject wrong Run, closing and known terminal before notification, retaining the exact accepted terminal position. Native malformed-interest/task-ID and extra-root/graph tests assert zero command/control effects. Closed schemas reject missing, conflicting and duplicate advisory interests; CLI unknown flags and malformed MCP calls retain their transport-specific parser failures. |
| S12 stopped-owner race | Each native client captures an unterminated control read, then the real owner completes and stops before admission. Submission may still succeed; the accepted terminal journal remains identical and tracker calls do not increase. |
| Refresh result parity | [`running-host-client-parity.test.ts`](../../packages/dalph/src/application/running-host-client-parity.test.ts) compares native CLI/MCP normalized refresh failures, including both unknown-outcome phases; inconsistent replies remain unknown without retry. Schema/CLI/MCP tests separately own decoding and advertised tools. |

No correlated refresh receipt, synchronous read promise, task publication barrier,
new retry policy or authority is introduced. Temporary `GraphNotEstablished`
publications may occur during subsequent reads; discovery tests observe later
publications and read snapshots independently. Accepted `Completed` after all
A/B/E and C deliveries remains #375, blocked on #367; this prefix does not claim
that suffix.

## Bounded implementation split and qualification

Use one reusable production-host fixture with real Git, SQLite, coordinator,
workflow, executor and integrator adapters. Replace only GitHub/Codex provider
edges with controlled Layers. Keep a minimal one-task Completed case and the
complete changing-graph Blocked story. The same shared projection and request
algebra serve every adapter; controlled seams are allowed only where they expose
a cut the production fixture cannot discriminate.

The tool/resource names above describe the complete future interface. #368
implements passive reads and handshake only; command owners add their tools,
and #372 alone adds WatchSnapshots/watch tools and resource subscription runtime.
Before that slice, MCP advertises resources without subscribe and omits watch
tools. This staging cannot be claimed as the complete milestone.

The concrete transport work has two substantial pieces. Implement the local HTTP
host and direct attached CLI first within #368, then the stdio MCP bridge as the
second explicit adapter slice of #368. Do not close #368 or waive its blocking
edge until both slices meet its acceptance; no new tracker ticket is implied.
#369–#374 retain their existing dependency gates. #372 qualifies each watch
encoding; #375 qualifies the complete composition and finality suffix. This
split changes implementation order, not accepted product scope.

| Slice | Required separate assertion/test, not inherited by the other adapter |
| --- | --- |
| HTTP/CLI first | `CLI attaches without creating a host`; descriptor/identity rejection, JSON failures, direct shared dispatch, stdout break, client process exit, Unknown after response loss. |
| MCP second | `MCP negotiates the pinned version and preserves shared results`; actual child initialize/tools/resources, outputSchema/domain error mapping, cancellation after handoff, stdio death, URI ownership and subscribe/read race. |
| CLI watch (#372) | `CLI writes current latest and Closed within bounded frames`; NDJSON size, same-position publication, blocked stdout, exact source release and Closed-before-EOF. |
| MCP watch (#372) | `MCP reads pinned current then latest and Closed through standard resources`; notification-only URI, unread expiry, bounded pending hint, unsubscribe/double close, bridge death and outer-message byte limit. |
| Host commands (#369/#370/#371) | Both adapters execute each operation and every applicable result/error row. Controlled SQLite cuts prove complete callback lifetime; no passing HTTP case substitutes for MCP cancellation or reverse. |
| Full qualification (#375) | Both replacement clients observe same Run, exact attempts, independent termination Pending/FinalityFailed/Accepted and actual Completed/Blocked records; both adapters pass S1–S12 and all split assertions. |

Use Deferred gates/controlled clocks for cuts and resource counts, not sleeps.
Use real SQLite for INSERT/COMMIT boundaries; memory storage cannot prove them.
Source inspection or a protocol mock cannot replace actual child-process lifetime
qualification. No live provider mutation or bulk live fixture is needed. The
implementation handoff must enumerate passing evidence per row and per adapter;
aggregate test totals or a successful prefix do not settle a missing suffix.

## Maintained passive-read implementation (#368)

Alice starts `dalph host --production --config ABS --listen ADDRESS TARGET`.
The existing production composition retains its coordinator and selected Run
until application Exit; attached CLI and MCP processes only call its HTTP read
boundary. The ordinary `dalph run` invocation retains its existing lifetime.
Mutating commands and watches remain owned by the later slices above.

| Owned scenario or boundary | Maintained proof |
| --- | --- |
| S1: one host, coherent publication and passive clients | `production-running-host.test.ts`: the one-task fixture compares actual CLI/MCP results and checks unchanged accepted history, tracker/Git calls, one executor turn and zero client Exit requests. Its separate three-task case checks grouping, prerequisite edges and tasks without attempts. |
| S2: exited clients, replacement and original-host delivery | The same production test replaces CLI/MCP children against the same Run, then observes real Git/SQLite acceptance, promotion, tracker confirmation and exact accepted Completed disposition/position with one Run beginning. `production-running-host-fixture.ts` is the maintained provider-edge fixture for later slices. |
| S11: refusal before effects | `running-host-contract.test.ts` decodes address, version, Run, instance and root errors; `running-host-http.test.ts` exercises HTTP refusal and unchanged control-read counts, including exact incoming byte limits. The production test exercises unavailable-address and wrong-Run failures through actual clients. |
| S12: publication and termination remain distinct | `running-host-projection.test.ts` proves NotReady/Closed and pending/accepted/finality-failed alternatives. HTTP tests exercise Closed without accepted termination and the typed finality failure. Production tests compare both clients' exact accepted terminal evidence. |
| Listening host retains an activation failure | `production-host.test.ts`, `listening host retains an activation failure while its client scope stays open`, proves retained typed failure, open observation/admission and delayed scope release. |
| Shared result size and identity | `running-host-contract.test.ts` proves exact result-byte limit/next-byte rejection, safe wire positions and cross-Run rejection. |
| CLI bounded writes and passive command validation | `running-host-cli.test.ts` uses the public parser and injected Effect output service against the read host, rejects bad client configuration before acquisition, and proves exact five-second cancellation. |
| Both interfaces preserve every shared failure | `running-host-client-parity.test.ts` compares the source HTTP client and actual CLI/MCP children for all eleven errors through both passive operations, the exact shared result-byte boundary and rejection of excess descriptor properties before requests. Its blocked-stdout subprocess test proves client exit and a surviving peer after each cancellation. |
| MCP protocol, resources and errors | `running-host-mcp.test.ts` proves the pinned handshake, tool/resource parity, incompatible versions, extra arguments, incoming framing/UTF-8, finite RPC identities and bounded writes. |

The full changing-graph settlement and abrupt host death remain #375 and #374
respectively. These future owners do not replace the passive assertions above.

## Maintained wake and Unpause implementation (#369)

Alice attaches CLI or MCP to the existing host. `attach start` / `dalph_start_work`
submits the original owner's wake hint and returns `WakeSubmitted` without changing
Pause. `attach unpause` (`resume` alias) / `dalph_unpause` transfers the whole
append/publication/owner-callback operation to the host; only its result waiter
belongs to the client. `UnpauseApplied` identifies the accepted ordinal and cursor
only after the actual callback completes. The original Exit admission and drain
own these operations, including their uncertain outcomes.

| Owned scenario or boundary | Maintained proof |
| --- | --- |
| S4: wake preserves Pause; complete Unpause survives clients | `running-host-command.acceptance.test.ts`, separately for CLI and MCP, uses the maintained production fixture with real SQLite, bootstrap and owner. Actual children submit wake, then die after INSERT, after COMMIT, or after callback completion. Each case proves one additional ordinal, one actual callback, timer restart, ordinary tracker checks, safe delivery and the accepted Completed suffix. Its recorded-cassette projection round trip preserves this chronology. |
| S5: partial completion and uncertain storage | The same per-adapter tests retain ordinal/cursor after an actual owner callback defect and preserve a subsequent deliberate Pause without replay. Lost commit acknowledgement returns Unknown, invokes no callback, preserves the last acknowledged read prefix, and fences another attached Unpause until Journal reconstruction. |
| S9: admission and original Exit | Per-adapter production tests hold SQLite INSERT, close the original admission, reject a later command, then complete the admitted callback and original Exit. `running-host-command-ownership.test.ts` proves waiter cancellation, cutoff refusal and actual five-second drain timeout with Unknown and stopped operation. Per-adapter production callback-stall tests additionally retain durable ordinal/cursor when the actual bootstrap callback exceeds that original drain, report Unknown, stop the callback writer and prove no replay or tracker activation. |
| S11/S12: refusals and exact terminal evidence | `running-host-http.test.ts` proves incomplete-request cancellation before admission, known terminal refusal with exact cursor, transport loss without replay, and a client deadline leaving the host operation alive. CLI/MCP parser tests reject malformed and foreign-Run commands before dispatch; `running-host-client-parity.test.ts` compares actual child responses for shared command failures, partial and unknown evidence. |
| Existing control and startup owners | `journaled-run-bootstrap.test.ts` proves paused startup readiness without activation, exact callback-failure evidence, and serialization of the complete Run control callback so a later Pause cannot be overtaken. |

These tests refine concrete transport, SQLite acknowledgement and callback lifetime
below the existing Run-control and application-Exit model boundaries. No Quint
state or action changes: the accepted direction and lifecycle cutoff remain their
existing authorities. Full quality and fresh model gates qualify the candidate;
callback completion is proved by the concrete tests, not inferred from a model.
Capacity remains #370, paused Refresh #371, watch #372, abrupt killed-host
reconstruction #374, and full changing-graph qualification #375.

The accepted [Docker-IP attachment extension](running-host-docker-ip.md) supersedes the original loopback-only address restriction. Existing loopback commands remain valid.
