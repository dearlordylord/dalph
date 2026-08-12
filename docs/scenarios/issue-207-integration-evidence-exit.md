# Bound integration, verification, promotion, and evidence work during Exit

Issue: [#207](https://github.com/dearlordylord/dalph/issues/207)

## Exit arrives after one integration-family action has entered its boundary

### Starting situation

Alice has a Run with one exact integration obligation. Dalph has already
admitted one action for that obligation and the action has entered exactly one
of these boundary families: constructing an integration candidate, running the
configured target-verification wrapper and sealing its immutable evidence, or
reading/updating the target ref for promotion. The action's existing protocol
has recorded every intent required before an ambiguous outside effect. Its
candidate, evidence references, manifest inputs, accepted result, and
integration obligation remain ordinary Run facts; no application-Exit fact is
in the Run journal.

Concretely, the candidate lane has accepted result commit C, target head H,
candidate session S, and a recorded construction intent before asking the
integration-candidate agent to build or continue M. The verification lane has
Git-proved candidate M with exact parents `[H, C]`, recorded verification
request V, and the configured public wrapper is running or the evidence store
is atomically publishing/rereading one content-addressed object. The promotion
lane has a sealed passing manifest, target ref H, candidate M, and either a
read in progress or a recorded numbered compare-and-set intent before asking
Git to replace H with M. These are separate test lanes; no test invents all
three calls inside one occurrence.

### Trigger and chronological behavior

1. Alice or the process supervisor requests graceful application Exit.
2. The application shell closes the one process-wide admission cutoff and
   starts no later delivery action.
3. The already-entered integration-family action may finish only inside the
   remainder of the original five-second drain. Depending on the lane, Dalph
   waits for the exact candidate-session call and records its report/Git
   observation, waits for wrapper V and publishes/rereads its artifacts and
   manifest before sealing the terminal record, or finishes the current target
   read/compare-and-set result under the existing promotion intent. This
   admitted action is the smallest production section that owns that ordinary
   protocol result.
4. If the action returns before the limit, Dalph records the already-produced
   result through the action's ordinary protocol, releases the process-local
   owner, and interrupts the continuation before the delivery runtime can
   start a successor action.
5. If the action is still running at five seconds, the application shell
   reports `TimedOut` best-effort and requests nonzero forced process
   termination. It does not wait for unbounded cleanup.
6. On a later ordinary startup, Dalph reconstructs the same integration
   obligation. Candidate construction resumes its exact session, target
   verification resumes its exact request and content-addressed evidence, and
   promotion reconciles an acknowledged compare-and-set intent before another
   attempt. The application does not restore an Exit mode or timer.

A process crash may occur after the candidate agent returns but before its
report record, after wrapper V returns while an evidence object or manifest is
being published/reread, or after Git applies H-to-M but before Dalph records the
promotion observation. In each cut, restart sees the already-recorded
candidate, verification, or promotion intent: it resumes S or V, or reads Git
before another numbered compare-and-set. It does not infer the lost response
or manufacture an application-Exit workflow event.

An Exit request cannot make an already-entered boundary return, and there is no
retry inside the Exit drain. Dalph must not start another candidate request,
verification wrapper, evidence object, manifest, promotion attempt, tracker or
Git read, or cleanup action after the current section returns. It must not
delete or rewrite candidates, immutable evidence, manifests, accepted results,
or exact integration obligations to make Exit succeed.

### Boundary classification

| Boundary family | Exit classification | Concrete reason |
| --- | --- | --- |
| Integration-candidate construction | admitted atomic section | One delivery action owns one exact candidate-session continuation and records its report/observation before the relation can propose another continuation. Interrupting between its outside result and journal record would discard the result. |
| Target verification and evidence sealing | admitted atomic section | One delivery action owns the wrapper terminal result, content-addressed artifact put/reread, manifest put/reread, and terminal journal record. The evidence store publishes complete immutable objects; the action may be killed by the process deadline, and Dalph begins no later evidence or delivery proposal after this admitted sequence returns under Exit. |
| Target promotion | admitted atomic section | One delivery action owns at most the protocol's already-journaled compare-and-set attempt and reconciliation read. A process death after the request remains recoverable from the existing attempt intent; Exit does not manufacture a second request. |
| Integration-target permit release | ordinary process-local finalizer | Releasing this in-memory permit does not dispose the durable candidate, accepted result, evidence, manifest, or integration obligation. A later startup reconstructs the obligation from the journal. |
| Run-journal append | existing journal atomicity and produced-write drain | The journal already owns idempotent record keys and complete append publication; #204's shell waits for admitted owners/produced writes. #207 adds no second journal protocol. |

### Crash, retry, and visible result

If Dalph dies before the action returns, Alice sees no graceful-success result.
Restart follows the ordinary candidate, verification, or promotion recovery
path described above. If the action returns before the limit, Alice sees one
successful Exit only after the owner has released; if it remains stuck, she
sees a timed-out nonzero termination request. Repeated Exit requests join the
same result and never reset the deadline; that shared-shell behavior remains
owned by #204.

### Scenario-to-test mapping

| Outcome | Executable evidence |
| --- | --- |
| Every #207 family receives the atomic owner and later finality/cleanup remains outside | `classifies %s as the admitted %s atomic section`; `does not absorb %s from later finality or cleanup tickets` |
| A result returns inside the original drain, releases the owner, and starts no successor | `lets an admitted atomic section return under Exit and starts no successor phase`; the three-family authored/recorded cassette test drives the same lifecycle owner for candidate, verification/evidence, and promotion |
| An owner that has not returned remains live through the deadline | `keeps a stuck atomic section owned after the application Exit cutoff`; `forcefully terminates at five seconds while an atomic integration section remains active` |
| A section cannot start after the cutoff | `starts no atomic integration section after the application Exit cutoff`; existing delivery-runtime `interrupts an admitted tracker owner under Exit and starts no successor action` proves the shared runtime stops later proposals |
| Candidate response loss/crash resumes the exact session | existing `reopens an ambiguously constructed candidate before retrying it`, `preserves conflicting candidate work across restart`, and `reconciles a limit-reaching Git observation after a crash before another agent call` |
| Verification response loss resumes the exact wrapper request and evidence identity | existing `reconciles a lost verification response by the same request identity` |
| Promotion response loss/crash reconciles the acknowledged attempt before another compare-and-set | existing `restart reconciles promotion intent before another compare-and-set`, `discovers M in current target ancestry after losing the promotion response`, and `crash after retry attempt record but before response never issues a duplicate numbered attempt` |
| Actor-readable and recorded chronology preserves candidate, verification/evidence, and promotion facts without an Exit workflow event | `preserves candidate verification promotion and evidence chronologies in authored and recorded cassettes`; existing maintained cassette tests `runs maintained conflict, unreadable-Git, correction, exhaustion, and contradiction stories`, `runs only the selected public wrapper and seals passing evidence for exact M`, `promotes verified M by exact compare-and-set and records exact ancestry`, and `reconciles a lost promotion response and never sends a fourth request` |
| Production decision conformance reaches atomic return and stuck timeout while workflow Exit history stays empty | `replays application Exit decisions through the production lifecycle kernel` plus canonical `admittedAtomicBoundaryFinishesInsideTheOriginalDrainTest`, `fifthTickForceTerminatesAStuckAtomicBoundaryTest`, and `everyExitOutcomeLeavesWorkflowExitRecordCountZeroTest` |

The canonical `applicationExit` model already represents these actions with
`prepareAtomicOwnerA`, `registerOwnerA`, `finishAtomicOwnerA`, `acceptExit`, and
the fifth monotonic tick. Issue #207 changes its production conformance and
scenario mapping, not the accepted model transition system.
