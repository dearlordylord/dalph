# Invokee research: targeted validation round

Follow-up: the [real-host composition experiment](./invokee-real-host-results.md)
now passes the previously open five-step client-disconnection chronology. The
limits below describe this earlier validation round.

Status: research only, 2026-09-13. No implementation tasks or production changes.
The user will request tasks explicitly. Work remains on the isolated
`research/invoker-invokee-interview` branch.

## Findings that changed our understanding

1. **Command retry behavior differs by command.** The existing capacity protocol
   rejects an exact stale replay without another append. Unpause has no such
   revision precondition: the new real-service probe shows A Unpause, B Pause,
   then A's exact replay producing a third record and overriding B's Pause.
   See [command semantics and replay evidence](./invokee-command-semantics.md).
2. **A hint response cannot promise progress.** Wake and tracker notification
   return no queued/coalesced/discarded disposition or completed-read evidence.
   The earlier hosting recommendation now reflects that source constraint.
3. **The graph already has a coherent internal basis.** One runtime publication
   contains task inventory, grouping/dependency edges, frontier and status
   inputs. A combined public schema and uniform optional executor association
   do not yet exist. See [graph observation](./invokee-graph-observation.md).
4. **Not sending Exit is insufficient to preserve lifetime.** Existing host and
   CLI source shows callback failure can close the host scope. The real SDK
   probe shows that closing an MCP connection aborts active handler signals.
   Neither observation means an already accepted Dalph operation should stop;
   it identifies a cancellation boundary still needing validation.

## Evidence executed in this round

| Validation | Result | What it does not establish |
| --- | --- | --- |
| Existing production host beginning and competing-owner cases | 2 selected tests passed | Remote attachment or executor progress after client death |
| Existing CLI stdout failure case | 1 selected test passed; no graceful Exit requested | Live host cleanup in that controlled callback test |
| Existing current-signal, delivery projection and status suites | 84 tests passed | Public graph wire contract or remote streaming |
| Real control application replay probe | Pause reconstructed before replay; Unpause reconstructed after a new ordinal | Mid-append interruption, network retry or live reactivation callbacks |
| Installed MCP SDK 1.29.0 probe | Explicit cancellation and connection close each abort a started handler signal and reject the client request | OS stdio lifetime, HTTP reconnect, or independently hosted Dalph survival |

Host details: [lifetime validation](./invokee-host-lifetime-validation.md).
MCP sources and version limits: [lifecycle validation](./invokee-mcp-lifecycle.md).
Both new probes are disposable, one-command scripts under `research/prototypes/`.
The control probe imports the existing built Dalph packages; the MCP probe uses
an already installed sibling SDK. No package or lockfile changes were needed.

## Remaining uncertainty

The actual-host chronology is still open: an OS client disconnects while a real
executor is held at a controlled provider boundary, delivery then progresses,
and another client observes the same Run without another coordinator. Current
host tests and the earlier synthetic process probe establish parts separately,
not that composition.

Also unresolved are exact command ownership at client cancellation, graph
transport/reconnect behavior, and the chosen MCP deployment. This round has not
selected a local transport, redesigned executor registration/leases, or changed
native human access and recursive-planning requirements.

The useful continuation is validation of a named remaining uncertainty using
existing seams. If it requires a production API change, record the limitation
rather than implementing that change during research. Task creation remains
outside the current instruction.
