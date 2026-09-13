# Alice starts only the authorized fixture and can locate failed setup resources

## Governing behavior

These accepted #339 review repairs preserve the manifest's exact local-resource
authorization and its requirement to retain exact unresolved setup locators.
They introduce no alternate workflow, tracker fact, retry or model transition.
The setup inventory describes actual fixture creation boundaries, not derived
workflow state. #340 still owns qualification artifact publication/provenance;
these repairs do not implement its bundle or waive downstream scenarios.

## Alice changes configuration before restarting the child

### Starting facts and trigger

The controller owns original Q, its manifest, configuration and creation ledger.
P1 has stopped and its original output/request fibers have joined. Parent
controlled-provider state and original SQLite/Git facts remain available to P2.
Alice edits the configuration to name a different existing integration ref or
another local resource, then asks the same controller to start P2.

### Ordered calls, visible result and forbidden result

1. Before each child spawn, the controller rereads and authorizes the exact Q
   documents using the existing authorization boundary, not a creation-time cache.
2. A mismatch returns the typed authorization failure before spawning a child.
   Original fixture/provider state is retained; no foreign ref, Journal, worktree,
   private store, coordinator lock or executor session is opened or mutated.
3. A successfully spawned child validates the actual schema-decoded configuration
   that the ordinary CLI will pass to its host against its expected manifest
   before host acquisition. It must not validate one file read and then allow a
   separate changed configuration read to select the host's resources.
4. With unchanged Q, the child enters the same ordinary parser, production host,
   SQLite/Git and provider Layers as before. P2 recovers the same unfinished Run.

Abrupt death still leaves ordinary recovery obligations. Authorization failure
is neither graceful Exit nor cleanup permission; correcting input does not
authorize an automatic provider retry. No live GitHub call applies to Q.

### Scenario-to-test mapping

- Configuration changed after controller creation or P1 → attempt P2, assert
  typed mismatch, zero new child starts and unchanged original/foreign resources.
- Child-side actual decoded configuration differs from expected Q → controlled
  built-entry test proves rejection before host acquisition/resources open.
- Unchanged Q → retain all four ordinary built recovery chronologies and their
  exact same-Run, SQLite/Git and original-child disposal assertions.

## Fixture creation fails after some local resources were created

### Starting facts and trigger

Alice requests a fresh fixture. The controller has allocated a known exact local
container and successfully created several resources. No child or provider
mutation has started. A later filesystem creation/write or built-entry digest
read fails, so the completed fixture cannot be returned.

### Ordered calls, visible result and forbidden result

1. Creation records each exact attempted locator before crossing its boundary,
   then records the actual successful creation/identity observation afterward.
2. Failure returns typed retained setup evidence containing the known container,
   original observed resources and exact unresolved attempted locators. Unknown
   identity is reported as unresolved, never refreshed or invented as ownership.
3. Alice can locate the retained partial fixture. No automatic deletion, recursive
   cleanup, repeated allocation or retry of the failed boundary occurs.
4. Successful creation still returns the complete original creation ledger.

No Dalph runtime behavior changes: this is controlled fixture setup, before any
workflow is started. A crash cannot justify deletion; only actual known locators
and observations are reported. The normal cleanup API still requires its full
authorized fixture and preserves foreign/replaced resources.

### Scenario-to-test mapping

- Controlled filesystem failure after several real successful creations →
  assert typed retained evidence with exact original resources/identities and
  unresolved failing locator, actual files retained, no child or second attempt.
- Digest/read failure after container creation → assert known retained container
  and all already observed/attempted resources, not a misleading complete ledger.
- Successful setup → retain the complete-ledger and exact cleanup tests.
