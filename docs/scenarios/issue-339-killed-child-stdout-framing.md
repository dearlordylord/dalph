# Alice kills P1 while its last stdout record is incomplete

## Starting facts and trigger

The controller owns the exact registered P1 child for fixture Q and its stdout
and stderr pipes. P1 uses the ordinary public newline-delimited encoder. It has
written complete records and may be writing the next record when Alice requests
the accepted SIGKILL cut at the held completion-response boundary. SQLite, Git
and controlled-provider state belong to the same recoverable Run R.

The installed line splitter emits a buffered non-newline tail at EOF. The
original focused run reported an invalid-JSON failure in `startChild`, but its
stack does not distinguish manifest encoding from stdout decoding. This scenario
addresses the concrete supported pipe-interruption hazard; it does not claim
that the original failure's source has been proved by a passing rerun.

## Ordered boundaries and visible result

1. Preserve and strictly schema-decode each complete newline-terminated stdout
   record once. Chunk boundaries and split Unicode bytes are not record endings.
2. The controller requests SIGKILL only for its exact registered child. Observe
   that child's actual signal-termination result separately from pipe draining.
   A requested kill alone, an unrelated child, or `isRunning=false` is not proof.
3. Drain both owned pipes and join their readers. Only an unterminated final
   fragment associated with this observed controller SIGKILL is interrupted
   output. Do not decode or publish it as a canonical record. Any retained
   interruption receipt contains only safe shape/count facts, not fragment bytes.
4. Return the actual killed-process observation. Complete earlier records remain
   available. No graceful Exit, Run termination, completion observation or
   provider permission is invented from the fragment or process disposition.
5. P2 can recover R using the original Q and provider/journal facts. The ordinary
   recovery protocol still decides whether any outside call is permissible.

A malformed complete newline-terminated JSON/schema record remains a failure,
including when SIGKILL follows it. A normal or unclassified EOF with trailing
text remains a typed framing failure. There is no broad SchemaError catch,
automatic rerun, relaxed complete-frame decoder, or change to the production
workflow/encoder. No live GitHub boundary applies to this controlled fixture.

## Scenario-to-test mapping

- Actual controlled Node child writes a valid complete record and a known partial
  record, acknowledges writes on a separate control boundary, then waits:
  request SIGKILL, assert observed signal termination, complete record once,
  joined pipes, no fragment publication or fabricated lifecycle record.
- Malformed complete JSON and schema-invalid complete frames, including followed
  by SIGKILL: assert strict decoding failure.
- Normal/unclassified EOF with a tail: assert typed framing failure.
- Split byte chunks and split Unicode character: preserve complete valid frames.
- Existing built completion-response cut: preserve same-Run restart, exact one
  completion call, journal responsibilities and original-child disposal checks.

This is a narrow #339 controller-output repair, not another workflow interpreter,
generic test DSL, #340 artifact implementation, or completion of #304/#306.
All issue acceptance scenarios and blocking edges remain required.
