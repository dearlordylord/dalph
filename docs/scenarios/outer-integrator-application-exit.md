# Reclassify graceful Exit around the outer Integrator

Issue: [#224](https://github.com/dearlordylord/dalph/issues/224)

Status: implemented for issue #224. This replaces the obsolete
candidate-construction and target-verification Exit lanes in issue #207. The
application-lifecycle cutoff, original five-second drain, and ordinary restart
reconciliation remain unchanged.

## Alice exits after one outer Integrator call has started

### Starting situation

Alice operates one running Dalph application. Run R retains one accepted task
result at commit C, one integration responsibility for target T at head H, and
one fixed outer Integrator session S. Dalph has recorded the start of exact
Integrator run `(S, 1)` and admitted its provider call before any Exit request.
The target ref still names H. No Integrator result or Git qualification exists.

### Trigger and chronology

1. Alice requests graceful application Exit.
2. The application shell closes process-wide forward admission and starts the
   original five-second drain. No later delivery proposal can acquire an owner.
3. The already-admitted Integrator call returns a prepared candidate M before
   the limit.
4. The same admitted action records the exact result for `(S, 1)` and releases
   its process-local owner.
5. Dalph does not read M from Git, qualify its parents, promote T, update the
   tracker, publish evidence, or start cleanup. With no other unsafe local
   owner, the shell reports successful Exit and ends the process.

There is no retry during Exit. Alice sees one successful Exit and the task's
session, result, candidate resource, accepted result, and integration
responsibility remain durable. Dalph must not treat the returned result as
permission to admit Git qualification or any successor action after the
cutoff.

### Acceptance-test mapping

- `classifies RunIntegrator as the admitted IntegratorPreparation atomic section`
  proves the production proposal receives the atomic owner.
- `lets an admitted atomic section return under Exit and starts no successor phase`
  proves that the produced result may finish while its continuation is cut off.
- `process loss before the outer result reuses the same unfinished session`
  proves that an unfinished result is recovered by exact Integrator run identity.

## The already-admitted Integrator call remains stuck at five seconds

### Starting situation

The same exact outer Integrator call `(S, 1)` is inside its provider boundary,
but the provider has not returned. Its session, run start, candidate resource,
accepted result, and integration responsibility are already durable. No person
or outside system has reported a result.

### Trigger and chronology

1. Alice or the process supervisor requests graceful Exit.
2. The shell closes admission and begins the one five-second drain.
3. The Integrator call remains live. A repeated Exit request joins the existing
   request and does not reset or extend the deadline.
4. At the fifth tick the shell reports `TimedOut` best-effort and requests
   nonzero forced process termination. It records no invented Integrator result
   and performs no cleanup.

The caller sees a timed-out Exit rather than graceful success. Dalph must not
wait indefinitely, cancel the durable responsibility, release its resource as
if work were safe, or start a second Integrator run.

### Acceptance-test mapping

- `forcefully terminates at five seconds while an atomic integration section remains active`
- `keeps a stuck atomic section owned after the application Exit cutoff`
- `fifthTickForceTerminatesAStuckAtomicBoundaryTest`

## The Integrator response is lost before Dalph records it

### Starting situation

Run R contains the same exact fixed session S and started run `(S, 1)`. The
Integrator may have produced M, but the process loses the response before an
exact result reaches the journal. An Exit request has already closed admission,
or the process dies before it can report an Exit result.

### Crash, restart, and retry

1. The drain never invents whether the provider produced M. It starts no Git
   qualification and records no Exit fact in the Run journal.
2. If the five-second limit wins, the shell requests forced termination. If the
   process dies first, no graceful-success result is reported.
3. On ordinary startup, Dalph reconstructs S and `(S, 1)` from the journal and
   calls the existing Integrator boundary with that same run correlation.
4. The provider resumes or reconciles its own exact session. Dalph records the
   one returned result, then ordinary delivery may qualify M. No Exit mode or
   drain timer survives restart.

Alice sees preserved work rather than a fabricated failure or a fresh session.
Dalph must not allocate `(S, 2)`, create a successor session, infer that no
candidate exists, or use Exit as a special recovery protocol.

### Acceptance-test mapping

- `process loss before the outer result reuses the same unfinished session`
- `automatically restores the same unfinished integration session after process loss`
- `classifies RunIntegrator as the admitted IntegratorPreparation atomic section`
  together with `lets an admitted atomic section return under Exit and starts no successor phase`
  proves that no successor action is admitted before process loss.

## Process loss occurs around exact-head promotion

### Starting situation

The outer Integrator reported M for exact run `(S, 1)`, and Git qualification
proved M has direct parents `[H, C]`. Dalph has admitted one target-promotion
action for T. Its ordinary protocol records the exact read or numbered
compare-and-set intent before asking Git. No later finality, tracker, evidence,
or cleanup action is admitted.

### Trigger, process loss, and recovery

1. A supervisor requests graceful Exit while the admitted promotion action is
   reading T or asking Git to replace H with M. The shell closes admission.
2. If Git returns before the limit, the same action records the exact ordinary
   promotion observation and releases its owner. Dalph starts no completion or
   cleanup action after it.
3. The process may instead die after Git changes T to M but before Dalph records
   the response, or the fifth tick may force termination while the call remains
   unresolved.
4. On ordinary restart, Dalph reads the recorded promotion intent and checks
   Git before another compare-and-set. It records that M is current or in the
   target ancestry, or continues the existing bounded promotion protocol from
   the observed facts.

The Operator sees successful Exit only when the admitted owner returned and
released before the limit; otherwise the result is timeout or process loss.
The exact candidate, promotion intent, accepted result, evidence references,
and integration responsibility remain preserved. Dalph must not send a second
compare-and-set without reconciliation, roll back M, complete the tracker task,
or dispose any durable resource merely to make Exit succeed.

### Acceptance-test mapping

- `classifies RunTargetPromotion as the admitted TargetPromotion atomic section`
- `lets an admitted atomic section return under Exit and starts no successor phase`
- `reconciles a lost promotion response and never sends a fourth request`
- `discovers M in current target ancestry after losing the promotion response`
- `workflowExitRecordIsDetectedTest` is the negative control proving Exit state
  cannot be written into workflow history.

## Boundary classification and infrastructure bracket

| Delivery action | Exit treatment | Reason |
| --- | --- | --- |
| `RunIntegrator` | admitted atomic integration boundary | One exact outer Integrator run may return and record only its own result. |
| `RunTargetPromotion` | admitted atomic integration boundary | One exact target read or compare-and-set attempt may return and record only its own result. |
| Legacy candidate construction and target verification | ordinary/obsolete route, never an outer-Integrator Exit boundary | The outer Integrator now owns candidate preparation and repository checks; retaining the old classification would describe a pipeline Dalph no longer accepts. |
| Git qualification after an Integrator result | later action, forbidden after cutoff | The result does not admit its successor. |
| Finality, tracker mutation, evidence publication, and cleanup | later action, forbidden after cutoff | These are separate proposals and are not part of the admitted Integrator or promotion call. |

Focused production tests are authoritative for the two boundary families and
their no-successor rule. Existing maintained Integrator and promotion
cassettes prove response-loss and process-loss recovery; the application Exit
model and shell tests prove the common return/stuck behavior. No new cassette
or Reducer Lab story duplicates those existing seams.
