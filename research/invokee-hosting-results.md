# Independent hosting experiment: evidence

Status: controlled process experiment passed; independent scoped review complete. This file records executed checks separately
from source inspection and architectural recommendations. All work is in
`research/invoker-invokee-interview`, outside master. No production source,
package manifest, lockfile, or Quint model is changed by this experiment.

## Existing component baseline

Executed in the isolated worktree with Node 24.20.0 and pnpm 10.29.3:

```sh
pnpm install --frozen-lockfile
pnpm --filter @dalph/contracts build
pnpm --filter @dalph/orchestrator build
pnpm exec vitest run packages/orchestrator/src/control/task-work-capacity.test.ts packages/orchestrator/src/coordination/delivery/delivery-status.test.ts packages/orchestrator/src/coordination/run/run-reactivation-owner.test.ts
```

The focused run passed: 3 files, 87 tests. This verifies the existing component
baseline; it does not prove future CLI/MCP attachment behavior.

| Existing behavior | Executed test file |
| --- | --- |
| Capacity revisions, stale request rejection, policy reconstruction | `packages/orchestrator/src/control/task-work-capacity.test.ts` |
| Passive status and current-first reconnection | `packages/orchestrator/src/coordination/delivery/delivery-status.test.ts` |
| Wake/refresh coalescing and paused/Unpause behavior | `packages/orchestrator/src/coordination/run/run-reactivation-owner.test.ts` |

Installation emitted missing-bin warnings because other production packages
were not built. Those bins were not used for the focused component run. The
frozen install did not change dependency declarations or the lockfile.

## Review criteria for the experiment

The experiment must distinguish process-lifetime evidence from full delivery
qualification. Its review will check:

- Actual independently launched client processes, not two in-memory calls.
- Host-owned controlled work progresses after a client process terminates.
- Capacity changes go through Dalph's existing revision-aware component.
- Retrying a request with an old expected revision cannot overwrite a newer
  direction; observing the desired value is not falsely called proof of which
  caller's request won.
- A negative control detects a host incorrectly tied to client lifetime.
- Child processes and any scratch resources are settled when the harness ends.
- Simulated tracker/Git/executor behavior and any omitted MCP protocol exchange
  are named explicitly. Successful socket exchange is not MCP conformance.

## Source-grounded recommendation

The [hosting research](./invokee-hosting-research.md) identifies a narrow seam:
retain the production host scope and expose shared operations from its existing
Run context. Client connections own only requests/subscriptions. They never
own delivery or translate EOF into application Exit.

Use a local throwaway connection for the experiment. This is not a selected
production protocol. Keep wake separate from explicit Unpause; keep capacity's
existing expected-revision check. A task-ID refresh hint could be satisfied by
reading the whole root graph when that is the simplest sufficient observation;
it need not become an arbitrary task-selection operation.

## Executed process experiment

Executed `node research/prototypes/invokee-hosting/run.mjs`. Both `SmokePassed` and
`SourceSeamsPassed` were emitted with exit status zero.

The host now uses the actual `TaskWorkCapacityControl` and scoped live Journal
publication over in-memory storage, through `dalph-capacity.mjs`. This replaced
an initial hand-written capacity imitation after review. The host's task work
and status view remain synthetic. There is no real coordinator lock or
production host instance in this experiment.

| Scenario | Observed result |
| --- | --- |
| Separately launched clients inspect host | Both observe `prototype-run` and the same starting policy |
| Lost capacity response | Host applies capacity two at revision two, then drops the response |
| Exact capacity direction retried | HTTP 409, current capacity two/revision two; journal remains two records |
| Competing clients | One success and one conflict; final policy revision three and three journal records |
| Client process terminated | Reconnection sees the same Run and progress later than the watch observation |
| Deliberately client-owned host | Closing its watcher stops it; the independently owned host continues |
| Existing passive status function | `deliveryStatusOf` returns the expected NotReady projection; the broader existing status suite separately passed |

The prototype transports HTTP over a Unix-domain socket in a scratch directory.
This is a local attachment probe, not an MCP client or a production CLI command.
The research's loopback TCP suggestion was not required for this experiment:
Unix-socket HTTP uses the same request/response model without allocating a port.
Neither transport is selected for production.

## What the experiment does not establish

- Full production-host attachment, exclusive repository ownership, or execution
  through Dalph's real scheduler. Those remain an implementation/composition seam.
- Production task graph/frontier serialization or a native graph UI.
- MCP initialization, tools, cancellation or SDK interoperability.
- Wake, Unpause or tracker-refresh transport behavior; their existing source
  and component tests inform the recommendation, not this socket experiment.
- Git worktree cleanup, tracker completion, actual agents, or host-crash recovery.
- Durable attribution of which client's ambiguous capacity request won.

These limits keep the finding narrow: one independently owned process can
serve short-lived clients while hosting Dalph's existing capacity protocol;
request retries can reuse its revision checks without a new lease mechanism.

## Review and validation scope

The Sol research agent independently reviewed the experiment for domain/spec,
architecture and correctness. Review caused these concrete corrections:

- Replace the host's capacity imitation with the real Dalph service and a
  scoped in-memory Journal.
- Repeat the exact ambiguous capacity direction and assert that no duplicate
  journal record appears before the competing-client scenario.
- Observe the watcher's first event before terminating it, and compare progress
  against that observation rather than a value from before all control calls.
- Add a deliberately client-owned host and state the limited negative-control
  evidence precisely: it stops on watcher close while the good host continues.
- Use the public `InRunJournal` export, not an unnecessary internal build path.

Full production-host and MCP tests are not deferred fixes to this harness;
they are explicitly outside its controlled experiment. Production integration
must supply those tests before claiming the first milestone implemented.

Verification follows the repository's tooling/documentation check category:
focused component suites, executable prototype checks, syntax, links and diff
whitespace. No production/model behavior, shared build configuration or gate
orchestration changed, so `check:all` and exhaustive Quint checking are not
claimed or used as proof for this research-only handoff.

## Final check

After the cold-start readiness correction, the final parent-run command exited
zero and printed both success records. The process probe reported revision
three, three journal records, one capacity-race winner, one conflict, and HTTP
409 for the exact lost-response replay. The final run after relocation observed tick 51 versus
initial tick 3; the assertion compares task progress with the immediate watched
state, not merely those initial ticks. Synthetic work remains progressing until
host stop so slow startup/client scheduling cannot exhaust the fixture first.

One earlier independent run failed because the five-second host readiness
allowance expired during cold module loading. The corrected 60-second bound
also detects early host exit. No retry was added. Final independent review found
no remaining material issue within the documented experimental scope.

Recommended next step: research the existing host composition and command
semantics, then use a disposable composition experiment only where source
inspection cannot resolve the uncertainty. Convert the findings into proposed
tasks before implementation. The experiment does not qualify the first invokee
milestone for production. See [research continuation](./invokee-research-next.md).

The first commit attempt correctly rejected the scripts outside the repository's
existing disposable `prototypes/` classification. They were moved to
`research/prototypes/invokee-hosting/`; no lint rule or hook was disabled.
The harness was rerun after the path correction.
