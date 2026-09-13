import { strict as assert } from "node:assert"
import { parseHTML } from "linkedom"
import { AuthoredDeliveryStatusRead } from "../../../packages/dalph/src/cassettes/authored-delivery-status.ts"
import { integrationFinalityFixture } from "../../../packages/orchestrator/src/workflow/protocols/integration-finality/fixtures.ts"
import {
  DeliveryStatusEvidenceIdentity,
  DeliveryStatusEntryIdentity,
  DeliveryStatusProjectionConflict,
  DeliveryStatusRunIdentityUnavailable,
  DeliveryStatusRunMismatch,
  type CurrentDeliveryStatus,
  type DeliveryStatusEntry,
  type DeliveryStatusSubject,
  JournalPosition,
  OperationId,
  ResponsibilityDisposition,
  TaskWorkCapacity,
  TrackerRevision,
  WorkflowResponsibilityEntry,
  makeDeliverySettlement
} from "@dalph/orchestrator"
import { plannedAttemptExecutorCorrelation, RunId, TaskId } from "@dalph/contracts"
import { FixtureTarget } from "../../../packages/orchestrator/src/authorities/task-tracker/fixture/target.ts"
import { BoundedTicketRank } from "../../../packages/orchestrator/src/coordination/delivery/relations.ts"
import { QueuedIntegrationResponsibility } from "../../../packages/orchestrator/src/workflow/protocols/integration-admission/protocol.ts"
import { trackerGraphReadProposalOf } from "../../../packages/orchestrator/src/coordination/delivery/delivery-action-proposal.ts"
import {
  deliveryStatusEntryLabel,
  presentDeliveryStatusRead,
  renderDeliveryStatusRead
} from "./delivery-status-presentation.ts"

const runId = integrationFinalityFixture.runId
const runSubject = { _tag: "Run", runId } satisfies DeliveryStatusSubject
const taskId = (value: string) => TaskId.make(value)
const task = (value: string): Extract<DeliveryStatusSubject, { readonly _tag: "Task" }> => ({
  _tag: "Task",
  runId,
  taskId: taskId(value)
})
const plannedAttemptFor = (value: string) => ({
  ...integrationFinalityFixture.plannedAttempt,
  runId,
  taskId: taskId(value)
})

const executorResponsibility = (value: string) =>
  WorkflowResponsibilityEntry.cases.PlannedAttemptExecutorWorkResponsibility.make({
    beganAt: JournalPosition.make(2),
    plannedAttempt: plannedAttemptFor(value)
  })

const trackerStanding = (responsibility: ReturnType<typeof executorResponsibility>) => ({
  _tag: "ResponsibilitySituation" as const,
  facts: {
    _tag: "PlannedAttemptExecutorFreshFacts" as const,
    disposition: ResponsibilityDisposition.TaskClaimMissingConstraint(),
    responsibility
  }
})

const proposal = trackerGraphReadProposalOf({
  acceptedAt: JournalPosition.make(3),
  purpose: "EstablishCurrentGraph",
  runId,
  target: FixtureTarget.make("presentation-target")
})

const admissionAuthority = { _tag: "TicketProposalAdmission" as const }
const liveOwner = {
  _tag: "AdmittedDeliveryAction" as const,
  admissionAuthority,
  proposal
}
const settledOwner = {
  _tag: "SettledBeforeMaterialization" as const,
  admissionAuthority,
  proposal
}

const queuedIntegration = QueuedIntegrationResponsibility.make({
  acceptedResult: integrationFinalityFixture.promotionCorrelation.qualifiedCandidate.run.session.acceptedResult,
  integrationTarget: integrationFinalityFixture.integrationTarget,
  plannedAttempt: plannedAttemptFor("integration"),
  preIntegrationCancellation: {
    attemptId: plannedAttemptFor("integration").attemptId,
    queuedAt: JournalPosition.make(4),
    runId
  },
  queuedAt: JournalPosition.make(4)
})

const entries = [
  {
    _tag: "DependencyWait",
    classification: "Waiting",
    subject: task("dependency"),
    taskId: taskId("dependency"),
    prerequisiteTaskIds: [taskId("prerequisite")],
    standing: {
      _tag: "GraphExcluded",
      reasons: [{ _tag: "PrerequisitesIncomplete", prerequisiteTaskIds: [taskId("prerequisite")] }]
    }
  },
  {
    _tag: "TrackerFactWait",
    classification: "Waiting",
    subject: task("tracker"),
    responsibility: { _tag: "WorkflowResponsibility", responsibility: executorResponsibility("tracker") },
    fact: { _tag: "Missing", boundary: "TaskTracker" },
    wakeCondition: "ExplicitAppliedTaskClaimReacquisitionDirection",
    standing: trackerStanding(executorResponsibility("tracker"))
  },
  {
    _tag: "TaskWorkCapacityWait",
    classification: "Waiting",
    subject: task("capacity"),
    taskId: taskId("capacity"),
    scope: { _tag: "RunTaskWorkCapacityScope", runId, capacity: TaskWorkCapacity.make(2) },
    holders: [
      {
        taskId: taskId("holder"),
        correlation: plannedAttemptExecutorCorrelation(plannedAttemptFor("holder"))
      }
    ],
    placement: { _tag: "Selected", rank: BoundedTicketRank.make(1) }
  },
  {
    _tag: "ProposedDeliveryAction",
    classification: "Waiting",
    subject: runSubject,
    proposal
  },
  {
    _tag: "LiveDeliveryAction",
    classification: "Progressing",
    subject: task("live"),
    owner: liveOwner
  },
  {
    _tag: "AcceptedFactPublicationWait",
    classification: "Waiting",
    subject: task("accepted"),
    owner: settledOwner,
    acceptedAt: JournalPosition.make(8)
  },
  {
    _tag: "IntegrationTargetWait",
    classification: "Waiting",
    subject: task("integration"),
    plannedAttempt: plannedAttemptFor("integration"),
    integrationTarget: queuedIntegration.integrationTarget,
    responsibility: { _tag: "QueuedIntegration", responsibility: queuedIntegration },
    wait: { _tag: "IntegrationTargetWait", plannedAttempt: plannedAttemptFor("integration") },
    standing: {
      _tag: "IntegrationWait",
      wait: { _tag: "IntegrationTargetWait", plannedAttempt: plannedAttemptFor("integration") }
    }
  },
  {
    _tag: "EvidenceUnavailable",
    classification: "Blocked",
    subject: task("evidence-unavailable"),
    responsibility: null,
    evidence: {
      _tag: "ProposalDerivationIssue",
      issue: {
        _tag: "FreshRouteProvenanceMissing",
        taskId: taskId("evidence-unavailable"),
        transition: "ContinueFreshWorkflowOperation"
      }
    }
  },
  {
    _tag: "EvidenceConflict",
    classification: "Blocked",
    subject: task("evidence-conflict"),
    responsibility: null,
    evidenceIdentities: [DeliveryStatusEvidenceIdentity.make("evidence:left"), DeliveryStatusEvidenceIdentity.make("evidence:right")],
    standing: {
      _tag: "ExactEvidenceConflict",
      evidenceIdentities: ["evidence:left", "evidence:right"]
    }
  },
  {
    _tag: "Settlement",
    classification: "Settled",
    subject: task("settlement"),
    settlement: makeDeliverySettlement({ attemptId: plannedAttemptFor("settlement").attemptId, taskId: taskId("settlement") })
  },
  {
    _tag: "Relinquishment",
    classification: "Relinquished",
    subject: task("relinquishment"),
    responsibility: { _tag: "WorkflowResponsibility", responsibility: executorResponsibility("relinquishment") },
    supporting: {
      _tag: "PlannedAttempt",
      correlation: plannedAttemptExecutorCorrelation(plannedAttemptFor("relinquishment"))
    },
    reason: "AuthorizedHandoff"
  }
] satisfies ReadonlyArray<DeliveryStatusEntry>

const available = {
  _tag: "DeliveryStatusAvailable",
  subject: runSubject,
  acceptedAt: JournalPosition.make(9),
  entries
} satisfies Extract<CurrentDeliveryStatus, { readonly _tag: "DeliveryStatusAvailable" }>

const exactLabels: Readonly<Record<DeliveryStatusEntry["_tag"], string>> = {
  DependencyWait: "Waiting for prerequisites",
  TrackerFactWait: "Waiting for tracker facts",
  TaskWorkCapacityWait: "Waiting for task-work capacity",
  ProposedDeliveryAction: "Proposed delivery action",
  LiveDeliveryAction: "Live delivery action",
  AcceptedFactPublicationWait: "Waiting for accepted fact publication",
  IntegrationTargetWait: "Waiting for integration target",
  EvidenceUnavailable: "Evidence unavailable",
  EvidenceConflict: "Evidence conflict",
  Settlement: "Delivery settlement",
  Relinquishment: "Responsibility relinquished"
}

const expectedEntryOrder = [
  "DependencyWait",
  "TrackerFactWait",
  "TaskWorkCapacityWait",
  "ProposedDeliveryAction",
  "LiveDeliveryAction",
  "AcceptedFactPublicationWait",
  "IntegrationTargetWait",
  "EvidenceUnavailable",
  "EvidenceConflict",
  "Settlement",
  "Relinquishment"
] as const satisfies ReadonlyArray<DeliveryStatusEntry["_tag"]>
const inputEntriesJson = JSON.stringify(entries)

const assertEntryEvidence = (entry: DeliveryStatusEntry): void => {
  switch (entry._tag) {
    case "DependencyWait":
      assert.deepEqual(entry.prerequisiteTaskIds, [taskId("prerequisite")])
      return
    case "TrackerFactWait":
      assert.deepEqual(entry.fact, { _tag: "Missing", boundary: "TaskTracker" })
      assert.notEqual(entry.responsibility, null)
      if (entry.responsibility !== null) assert.equal(entry.responsibility._tag, "WorkflowResponsibility")
      return
    case "TaskWorkCapacityWait":
      assert.deepEqual(entry.scope, { _tag: "RunTaskWorkCapacityScope", runId, capacity: TaskWorkCapacity.make(2) })
      assert.deepEqual(entry.holders.map(({ taskId: holder }) => holder), [taskId("holder")])
      return
    case "ProposedDeliveryAction":
      assert.equal(entry.proposal.id, proposal.id)
      assert.equal(entry.proposal.route._tag, "TrackerGraphReadRoute")
      return
    case "LiveDeliveryAction":
      assert.equal(entry.owner.proposal.id, proposal.id)
      assert.equal(entry.owner._tag, "AdmittedDeliveryAction")
      return
    case "AcceptedFactPublicationWait":
      assert.equal(entry.acceptedAt, JournalPosition.make(8))
      assert.equal(entry.owner._tag, "SettledBeforeMaterialization")
      return
    case "IntegrationTargetWait":
      assert.deepEqual(entry.integrationTarget, queuedIntegration.integrationTarget)
      assert.equal(entry.responsibility._tag, "QueuedIntegration")
      return
    case "EvidenceUnavailable":
      assert.equal(entry.evidence._tag, "ProposalDerivationIssue")
      if (entry.evidence._tag === "ProposalDerivationIssue") {
        assert.equal(entry.evidence.issue.taskId, taskId("evidence-unavailable"))
      }
      return
    case "EvidenceConflict":
      assert.deepEqual(entry.evidenceIdentities, ["evidence:left", "evidence:right"])
      assert.deepEqual(entry.standing.evidenceIdentities, ["evidence:left", "evidence:right"])
      return
    case "Settlement":
      assert.equal(entry.settlement._tag, "DeliverySettlement")
      if (entry.settlement._tag === "DeliverySettlement") {
        assert.equal(entry.settlement.taskId, taskId("settlement"))
      }
      return
    case "Relinquishment":
      assert.equal(entry.reason, "AuthorizedHandoff")
      assert.equal(entry.supporting._tag, "PlannedAttempt")
      return
  }
}

const statusRead = AuthoredDeliveryStatusRead.Status({ status: available })

{
  const presentation = presentDeliveryStatusRead(statusRead)
  assert.equal(presentation.tag, "DeliveryStatusAvailable")
  assert.equal(presentation.label, "Canonical delivery status")
  assert.equal(presentation.exact, JSON.stringify(available, null, 2))
  assert.deepEqual(presentation.entries.map(({ entry }) => entry._tag), expectedEntryOrder)
  assert.deepEqual(entries.map(({ _tag }) => _tag), expectedEntryOrder)
  assert.equal(JSON.stringify(entries), inputEntriesJson)
  assert.deepEqual(
    presentation.entries.map(({ entry, label }) => ({
      tag: entry._tag,
      classification: entry.classification,
      subject: entry.subject,
      label
    })),
    expectedEntryOrder.map((tag, index) => {
      const entry = entries[index]
      if (entry === undefined || entry._tag !== tag) throw new Error("input entry order changed")
      return {
      tag: entry._tag,
      classification: entry.classification,
      subject: entry.subject,
      label: exactLabels[entry._tag]
      }
    })
  )
  for (const [index, item] of presentation.entries.entries()) {
    const entry = entries[index]
    assert.notEqual(entry, undefined)
    if (entry === undefined) throw new Error("presentation lost an entry")
    assert.strictEqual(item.entry, entry)
    assert.equal(item.label, deliveryStatusEntryLabel(entry._tag))
    assert.equal(item.exact, JSON.stringify(entry, null, 2))
    assertEntryEvidence(item.entry)
  }
}

{
  const { document, window } = parseHTML("<!doctype html><html><body></body></html>")
  Object.assign(globalThis, {
    document,
    HTMLElement: window.HTMLElement
  })
  const host = document.createElement("div")
  host.append(document.createElement("p"))
  renderDeliveryStatusRead(host, statusRead)
  assert.equal(JSON.stringify(entries), inputEntriesJson)
  const renderedEntries = [...host.querySelectorAll<HTMLElement>("[data-role='delivery-status-entry']")]
  assert.equal(host.dataset.status, "DeliveryStatusAvailable")
  assert.equal(renderedEntries.length, entries.length)
  assert.deepEqual(renderedEntries.map((item) => item.dataset.entryTag), expectedEntryOrder)
  assert.deepEqual(
    renderedEntries.map((item) => ({ tag: item.dataset.entryTag, classification: item.dataset.classification })),
    entries.map(({ _tag, classification }) => ({ tag: _tag, classification }))
  )
  renderedEntries.forEach((item, index) => {
    const entry = entries[index]
    if (entry === undefined) throw new Error("DOM presentation lost an entry")
    assert.equal(item.querySelector("h6")?.textContent?.includes(exactLabels[entry._tag]), true)
    assert.equal(item.querySelector("h6")?.textContent?.includes(String(entry.subject._tag === "Task" ? entry.subject.taskId : entry.subject.runId)), true)
    assert.equal(item.querySelector("pre")?.textContent, JSON.stringify(entry, null, 2))
  })
  assert.equal(host.querySelector("details pre")?.textContent, JSON.stringify(available, null, 2))
  assert.equal(host.querySelector("p"), null)
}

{
  const statuses: ReadonlyArray<readonly [CurrentDeliveryStatus, string, number]> = [
    [
      { _tag: "DeliveryStatusNotReady", subject: runSubject },
      "Canonical delivery observation is not ready",
      0
    ],
    [
      {
        _tag: "TaskAbsentFromCurrentGraph",
        subject: task("absent"),
        graphSource: {
          _tag: "EstablishedGraph",
          revision: TrackerRevision.make("presentation-revision"),
          operationId: OperationId.make("presentation-graph-read"),
          freshnessOperationId: OperationId.make("presentation-graph-freshness"),
          contentIdentity: TrackerRevision.make("presentation-content"),
          recordedAt: JournalPosition.make(10)
        }
      },
      "Task absent from the current graph",
      0
    ],
    [{ _tag: "DeliveryStatusClosed", subject: runSubject, final: available }, "Canonical delivery source closed (not Run completion or application Exit)", entries.length]
  ]
  for (const [status, label, entryCount] of statuses) {
    const read = AuthoredDeliveryStatusRead.Status({ status })
    const presentation = presentDeliveryStatusRead(read)
    assert.equal(presentation.tag, status._tag)
    assert.equal(presentation.label, label)
    assert.equal(presentation.entries.length, entryCount)
    assert.equal(presentation.exact, JSON.stringify(status, null, 2))
    const host = document.createElement("div")
    renderDeliveryStatusRead(host, read)
    assert.equal(host.dataset.status, status._tag)
    assert.equal(host.querySelector("h5")?.textContent, label)
    assert.equal(host.querySelectorAll("[data-role='delivery-status-entry']").length, entryCount)
    assert.equal(host.querySelector("details pre")?.textContent, JSON.stringify(status, null, 2))
  }
}

{
  const read = AuthoredDeliveryStatusRead.Unobserved()
  const unobserved = presentDeliveryStatusRead(read)
  assert.deepEqual(unobserved, {
    tag: "Unobserved",
    label: "No coherent runtime status read has been observed",
    exact: "",
    entries: []
  })
  const host = document.createElement("div")
  renderDeliveryStatusRead(host, read)
  assert.equal(host.dataset.status, "Unobserved")
  assert.equal(host.querySelector("h5")?.textContent, "No coherent runtime status read has been observed")
  assert.equal(host.querySelectorAll("[data-role='delivery-status-entry']").length, 0)
  assert.equal(host.querySelector("details pre")?.textContent, "")
}

{
  const errors = [
    DeliveryStatusRunMismatch.make({ expectedRunId: runId, requestedRunId: RunId.make("presentation-other-run") }),
    DeliveryStatusRunIdentityUnavailable.make({ subject: runSubject }),
    DeliveryStatusProjectionConflict.make({
      subject: runSubject,
      entryIdentity: DeliveryStatusEntryIdentity.make("presentation-conflict"),
      detail: "presentation fixture conflict"
    })
  ]
  for (const error of errors) {
    const read = AuthoredDeliveryStatusRead.ProjectionFailed({ error })
    const presentation = presentDeliveryStatusRead(read)
    assert.equal(presentation.tag, error._tag)
    assert.equal(presentation.label, error._tag)
    assert.equal(presentation.exact, JSON.stringify(error, null, 2))
    assert.deepEqual(presentation.entries, [])
    const host = document.createElement("div")
    renderDeliveryStatusRead(host, read)
    assert.equal(host.dataset.status, error._tag)
    assert.equal(host.querySelector("h5")?.textContent, error._tag)
    assert.equal(host.querySelectorAll("[data-role='delivery-status-entry']").length, 0)
    assert.equal(host.querySelector("details pre")?.textContent, JSON.stringify(error, null, 2))
  }
}

console.log("✓ presents every canonical delivery status entry, status, and typed projection failure")
