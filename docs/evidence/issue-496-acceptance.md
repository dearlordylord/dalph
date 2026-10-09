# The Operator applies attached whole-Run controls through the owning host

The Operator sends Pause or Cancel to the existing production host for its
selected Run. The host admits the command independently of optional history,
then reuses the accepted control or cancellation boundary. Applied responses
carry the existing durable cursor; they do not claim safe Pause boundaries or
completed cancellation. [The chronology and scoped test map](../scenarios/attached-run-pause-cancel.md)
define the accepted boundaries under [#491](https://github.com/dearlordylord/dalph/issues/491)
and its #496 slice.

The [machine-readable evidence](issue-496-results.json) binds all named tests,
raw profile samples and environment facts to candidate
`4c99e3367085d7f356bf44c9590f700461ccb161`, based on
`3413d06b27b6e8a03b4313b9679bb6ff53339741`. Subsequent evidence documentation
cannot change Dalph runtime behavior. Native Git and SQLite serve the real
production composition with controlled tracker/executor providers.

| Requirement | Passing named boundary |
| --- | --- |
| C1 attached controls and existing owner | Native CLI and MCP `public clients apply whole-Run controls while history remains busy`; contract/HTTP/MCP/CLI files; installed-owner bootstrap test. The production entry offers cancellation to the existing reactivation owner and never invokes offline Cancel. |
| Correlation and honest application | Contract tests reject foreign Run, unsafe ordinal and wrong request correlation. The executing-attempt acceptance test holds separate receipt, application, reply and executor-observation cuts. Receipt appends no cancellation; application retains the claim and has no terminal fact. |
| History cannot bar admission; existing Pause and cancellation protocols | Native held-page tests complete both controls while history stays pending. Existing owner tests preserve Pause admission. The exact-stop acceptance test orders stop evidence, abandonment, claim settlement and Run termination. |
| Unavailable/foreign evidence and disconnect | Both executor-evidence tests retain the exact claim and forbid abandonment and termination; public status stays available. Four native client disconnect cuts and four ambiguous-reply cuts retain one admitted control without replay. |
| Public acceptance and required local-admission target | All 14 new physical acceptance tests pass. Six declared native HTTP API profiles each retain 20 raw admission samples and paired client/application samples; all meet p95 ≤100 ms. |
| Chronology, scope and offline Cancel | The preimplementation scenario register maps every chronology to scoped tests and governing laws. Five offline cancellation cassette cases pass, including fresh classification, foreign-claim retention and uncertain terminal append recovery. No task controls, authorization policy or new progress fields are introduced. |

## Admission measurement

| Profile | Pause p95 ms | Cancel p95 ms | Historical work |
| --- | ---: | ---: | --- |
| Idle | 22.253 | 22.056 | No concurrent historical page |
| BusyHistory | 14.651 | 77.438 | A page held before optional preparation |
| ExpandingHistory | 8.101 | 5.365 | 256 additional durable controls; overlapping actual native occurrence preparation |

The controlled experiment uses two clocks for the same exact request ID:
server headers received to host-owned command entry, and public client call
through handshake and application reply. The first includes body decoding,
correlation and the compact terminal fence. Durable application and provider
settlement occur afterward. This profile runs the native HTTP API client;
CLI/MCP child startup belongs to their separate physical functional checks.
The raw paired durations permit checking the measurement boundary without
attributing delays to child startup or shared CPU.

The [earlier stopped diagnostic](issue-496-early-profile.json) preserves four
summaries above 100 ms from an incorrectly named client-to-application timer.
It is incomplete and has no exact complete dirty-candidate or individual-sample
capture, so it receives no qualification credit. The corrected clock does not
relax 100 ms: the final test asserts every declared profile meets it and stores
raw evidence before that assertion. No causal shared-load explanation is
established or used as a waiver. The 10 ms cooperative quantum remains an
unmeasured provisional reference, with no hard real-time guarantee claimed.

## Checks, repairs and remaining qualification

The dependency-closure build, `check:fast`, documentation links and all nine
selected test files pass on the source candidate: 206 tests, zero failures.
The results file retains exact selected files, individual test names and log
hashes. Initial qualification failures remain separate: the native CLI output
wait exceeded its old ten-second fixture budget; subsequent native checks
passed with a twenty-second output budget. The profile's incomplete diagnostic
was stopped with progress retained, then the timing boundary was corrected.
Commit lint required explicit Node imports and moving executor-evidence controls
to their existing fixture module. A fresh typecheck found two index-signature
accesses; the focused repaired typecheck passed before a complete `check:fast`
passed. These fixture budgets do not replace or relax the admission target.

A fresh reviewer reported no reasonable blocking findings against the fixed
implementation candidate; the only subsequent source edit uses checked bracket
access in two test expressions. Evidence documentation receives final scoped
review and link checks before handoff. This slice claims neither a full local
gate nor live-provider qualification. **#501 must independently qualify the
final integrated candidate**; these measurements cannot substitute for that
parent acceptance.
