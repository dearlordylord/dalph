# Alice restarts after GitHub rejects completion with a throttle

## Starting facts and trigger

Alice starts P1 with the exact authorized fixture Q. The ordinary built command
uses real SQLite and Git and controlled GitHub responses. Run R has promoted its
candidate and holds its unfinished completion responsibility. P1 records the
first completion attempt for request K, then GitHub returns HTTP 429 to the one
CloseIssue call. The response does not prove that the mutation was not applied.

## Ordered boundaries and visible result

1. P1 emits `delivery.provider_throttled` and exits with code one. Its journal
   retains the unresolved original request and attempt. Failure is not graceful
   application Exit, Run termination, settlement, or claim-cleanup permission.
2. Alice starts P2 with the same Q, SQLite, Git and controlled-provider state.
   The controller and child authorize Q again before host acquisition. The
   ordinary command recovers the same Run R; it does not begin a successor Run.
3. Recovery first checks the task's current lifecycle, then records the exact
   request K's completion-authority lookup and observation for the original
   attempt. GitHub cannot query a previous CloseIssue clientMutationId, so the
   ordinary GitHub completion service returns `Unreadable`. This lookup is a
   local capability result, not an invented GitHub HTTP endpoint.
4. P2 reports coherent current status and remains waiting. The original request
   and responsibility remain unresolved. No second completion attempt or
   CloseIssue call occurs; another graph read does not grant mutation permission.
5. Alice sends SIGTERM. P2 records ordinary application Exit and exits with code
   zero. Run R remains unfinished. Neither graceful process exit nor the lookup
   authorizes settlement, Run termination, claim deletion, or an automatic retry.

There is no live GitHub mutation here. P1 fails through the known throttle
boundary rather than an abrupt kill. Abrupt-death recovery remains covered by
the separate completion-response cut. The production protocol is unchanged.

## Scenario-to-test mapping

- Built throttle-cut test: assert one P1 CloseIssue call, typed public failure,
  code one, original unfinished request, and no graceful lifecycle or cleanup.
- Restart the same fixture: assert the same Run/request/attempt, lifecycle read
  before the exact lookup intent/`Unreadable` observation, coherent waiting,
  and no second attempt or CloseIssue call.
- Send SIGTERM only after those waiting facts: assert process code zero and
  application Exit without Run termination, settlement, or claim deletion.
- Existing fixture-disposal assertions retain exact unresolved resources.

This refines #339's usable throttle restart seam using the actual ordinary GitHub
adapter. It removes an impossible readable-lookup fixture assumption. #306 still
owns its complete negative-control acceptance and #340 evidence assertions;
neither issue nor any blocking edge is declared complete by this repair.
