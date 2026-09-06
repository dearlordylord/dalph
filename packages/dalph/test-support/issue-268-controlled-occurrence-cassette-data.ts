/* eslint-disable max-lines -- This checked-in cassette is the exact 1,014-item accepted observation order. */
import type { Issue268AcceptedOccurrence } from "./issue-268-controlled-occurrence-cassette.js"

export const issue268AcceptedOccurrenceOrderDigest = "ccae78199aa01062521d470c017524e665d0ea3a5bdbf3a9f29030c79440bd4d"

/**
 * Exact semantic order accepted from the cassette-free DS-01 through DS-13 run.
 * Source: 7100fe3af2103bba753e089e8ec78279c5426eb5.
 * SHA-256 of JSON.stringify(this array): ccae78199aa01062521d470c017524e665d0ea3a5bdbf3a9f29030c79440bd4d.
 */
export const issue268AcceptedOccurrenceOrder = [
  {
    detail: "1|_tag=WorkflowRunBegan|initialControlPolicy.taskExecutionCapacity=3|initiatedBy._tag=DalphCoordinator",
    kind: "WorkflowRunBegan",
    source: "Journal"
  },
  { detail: 'run:issue-268-controlled:"fixture:issue-268"', kind: "JournalRecoveryReadCalled", source: "Journal" },
  {
    detail: "1|_tag=WorkflowRunBegan|initialControlPolicy.taskExecutionCapacity=3|initiatedBy._tag=DalphCoordinator",
    kind: "JournalRecoveryReadReturned",
    source: "Journal"
  },
  { detail: "graph._tag=GraphNotEstablished", kind: "DeliveryPublicationObserved", source: "Publication" },
  { detail: "acceptedAt=1|held=|live=", kind: "DeliveryRuntimeObservationPublished", source: "Publication" },
  { detail: "acceptedAt=1|held=|live=", kind: "DeliveryRuntimeObservationPublished", source: "Publication" },
  {
    detail: "acceptedAt=1|held=|live=Run:TrackerGraphReadRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=1|held=|live=Run:TrackerGraphReadRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "Run:TrackerGraphReadRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:0|operation.readShape._tag=CompleteTargetClosure",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "2|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:0|operation.readShape._tag=CompleteTargetClosure",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=1|held=|live=Run:TrackerGraphReadRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268"', kind: "TrackerGraphReadCalled", source: "Tracker" },
  { detail: "G0", kind: "TrackerGraphReadReturned", source: "Tracker" },
  {
    detail:
      "3|_tag=TaskTrackerFactsObserved|observation._tag=CompleteTaskTrackerFacts|observation.factFamilies.0._tag=TaskIdentities|observation.factFamilies.0.contentIdentity=G0|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:0|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecycles|observation.factFamilies.1.contentIdentity=G0|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:0|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.1.lifecycles.0.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.0.taskId=A|observation.factFamilies.1.lifecycles.1.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.1.taskId=B|observation.factFamilies.1.lifecycles.2.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.2.taskId=C|observation.factFamilies.1.lifecycles.3.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.3.taskId=D|observation.factFamilies.1.lifecycles.4.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.4.taskId=E|observation.factFamilies.2._tag=TaskPrerequisites|observation.factFamilies.2.contentIdentity=G0|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:0|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.2.prerequisites.0.taskId=A|observation.factFamilies.2.prerequisites.1.taskId=B|observation.factFamilies.2.prerequisites.2.taskId=C|observation.factFamilies.2.prerequisites.3.taskId=D|observation.factFamilies.2.prerequisites.4.taskId=E|observation.factFamilies.3._tag=TaskGroupings|observation.factFamilies.3.contentIdentity=G0|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:0|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.3.groupings.0.taskId=A|observation.factFamilies.3.groupings.1.taskId=B|observation.factFamilies.3.groupings.2.taskId=C|observation.factFamilies.3.groupings.3.taskId=D|observation.factFamilies.3.groupings.4.taskId=E|observation.factFamilies.4._tag=TaskTargetMembership|observation.factFamilies.4.contentIdentity=G0|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:0|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:0|operationId=issue-268:run:issue-268-controlled:startup:0",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskTrackerFactsObserved|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:0|operation.readShape._tag=CompleteTargetClosure|observation._tag=CompleteTaskTrackerFacts|observation.factFamilies.0._tag=TaskIdentities|observation.factFamilies.0.contentIdentity=G0|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:0|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecycles|observation.factFamilies.1.contentIdentity=G0|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:0|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.1.lifecycles.0.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.0.taskId=A|observation.factFamilies.1.lifecycles.1.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.1.taskId=B|observation.factFamilies.1.lifecycles.2.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.2.taskId=C|observation.factFamilies.1.lifecycles.3.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.3.taskId=D|observation.factFamilies.1.lifecycles.4.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.4.taskId=E|observation.factFamilies.2._tag=TaskPrerequisites|observation.factFamilies.2.contentIdentity=G0|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:0|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.2.prerequisites.0.taskId=A|observation.factFamilies.2.prerequisites.1.taskId=B|observation.factFamilies.2.prerequisites.2.taskId=C|observation.factFamilies.2.prerequisites.3.taskId=D|observation.factFamilies.2.prerequisites.4.taskId=E|observation.factFamilies.3._tag=TaskGroupings|observation.factFamilies.3.contentIdentity=G0|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:0|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.3.groupings.0.taskId=A|observation.factFamilies.3.groupings.1.taskId=B|observation.factFamilies.3.groupings.2.taskId=C|observation.factFamilies.3.groupings.3.taskId=D|observation.factFamilies.3.groupings.4.taskId=E|observation.factFamilies.4._tag=TaskTargetMembership|observation.factFamilies.4.contentIdentity=G0|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:0|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:0",
    kind: "TaskTrackerFactsObserved",
    source: "Trace"
  },
  { detail: "Run:TrackerGraphReadRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:0|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:0",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  { detail: "A", kind: "TaskEligibilityPublished", source: "Publication" },
  { detail: "B", kind: "TaskEligibilityPublished", source: "Publication" },
  { detail: "C", kind: "TaskEligibilityPublished", source: "Publication" },
  {
    detail: "acceptedAt=3|held=|live=Run:TrackerGraphReadRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=3|held=|live=Run:TrackerGraphReadRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "acceptedAt=3|held=|live=", kind: "DeliveryRuntimeObservationPublished", source: "Publication" },
  {
    detail: "acceptedAt=3|held=|live=A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A:A:ReserveOrReuse:FreshWorkflowRoute", kind: "TaskWorkPositionAdmissionBound", source: "Publication" },
  {
    detail: "acceptedAt=3|held=|live=A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ReadCurrentTaskGraph:A", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:1|operation.readShape._tag=CompleteTargetClosure",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "4|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:1|operation.readShape._tag=CompleteTargetClosure",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=3|held=|live=A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268"', kind: "TrackerGraphReadCalled", source: "Tracker" },
  { detail: "G0", kind: "TrackerGraphReadReturned", source: "Tracker" },
  {
    detail:
      "5|_tag=TaskTrackerFactsObserved|observation._tag=UnchangedTaskTrackerFactsReconfirmed|observation.factFamilies.0._tag=TaskIdentitiesReconfirmed|observation.factFamilies.0.contentIdentity=G0|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:1|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecyclesReconfirmed|observation.factFamilies.1.contentIdentity=G0|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:1|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.2._tag=TaskPrerequisitesReconfirmed|observation.factFamilies.2.contentIdentity=G0|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:1|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.3._tag=TaskGroupingsReconfirmed|observation.factFamilies.3.contentIdentity=G0|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:1|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.4._tag=TaskTargetMembershipReconfirmed|observation.factFamilies.4.contentIdentity=G0|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:1|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:1|operationId=issue-268:run:issue-268-controlled:startup:1",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskTrackerFactsObserved|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:1|operation.readShape._tag=CompleteTargetClosure|observation._tag=CompleteTaskTrackerFacts|observation.factFamilies.0._tag=TaskIdentities|observation.factFamilies.0.contentIdentity=G0|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:1|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecycles|observation.factFamilies.1.contentIdentity=G0|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:1|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.1.lifecycles.0.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.0.taskId=A|observation.factFamilies.1.lifecycles.1.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.1.taskId=B|observation.factFamilies.1.lifecycles.2.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.2.taskId=C|observation.factFamilies.1.lifecycles.3.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.3.taskId=D|observation.factFamilies.1.lifecycles.4.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.4.taskId=E|observation.factFamilies.2._tag=TaskPrerequisites|observation.factFamilies.2.contentIdentity=G0|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:1|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.2.prerequisites.0.taskId=A|observation.factFamilies.2.prerequisites.1.taskId=B|observation.factFamilies.2.prerequisites.2.taskId=C|observation.factFamilies.2.prerequisites.3.taskId=D|observation.factFamilies.2.prerequisites.4.taskId=E|observation.factFamilies.3._tag=TaskGroupings|observation.factFamilies.3.contentIdentity=G0|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:1|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.3.groupings.0.taskId=A|observation.factFamilies.3.groupings.1.taskId=B|observation.factFamilies.3.groupings.2.taskId=C|observation.factFamilies.3.groupings.3.taskId=D|observation.factFamilies.3.groupings.4.taskId=E|observation.factFamilies.4._tag=TaskTargetMembership|observation.factFamilies.4.contentIdentity=G0|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:1|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:1",
    kind: "TaskTrackerFactsObserved",
    source: "Trace"
  },
  { detail: "ReadCurrentTaskGraph:A", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail: "acceptedAt=3|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "B:B:ReserveOrReuse:FreshWorkflowRoute", kind: "TaskWorkPositionAdmissionBound", source: "Publication" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:1|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:1",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=3|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ReadCurrentTaskGraph:B", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:2|operation.readShape._tag=CompleteTargetClosure",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "6|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:2|operation.readShape._tag=CompleteTargetClosure",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=3|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268"', kind: "TrackerGraphReadCalled", source: "Tracker" },
  { detail: "G0", kind: "TrackerGraphReadReturned", source: "Tracker" },
  {
    detail:
      "7|_tag=TaskTrackerFactsObserved|observation._tag=UnchangedTaskTrackerFactsReconfirmed|observation.factFamilies.0._tag=TaskIdentitiesReconfirmed|observation.factFamilies.0.contentIdentity=G0|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:2|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecyclesReconfirmed|observation.factFamilies.1.contentIdentity=G0|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:2|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.2._tag=TaskPrerequisitesReconfirmed|observation.factFamilies.2.contentIdentity=G0|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:2|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.3._tag=TaskGroupingsReconfirmed|observation.factFamilies.3.contentIdentity=G0|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:2|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.4._tag=TaskTargetMembershipReconfirmed|observation.factFamilies.4.contentIdentity=G0|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:2|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:2|operationId=issue-268:run:issue-268-controlled:startup:2",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskTrackerFactsObserved|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:2|operation.readShape._tag=CompleteTargetClosure|observation._tag=CompleteTaskTrackerFacts|observation.factFamilies.0._tag=TaskIdentities|observation.factFamilies.0.contentIdentity=G0|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:2|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecycles|observation.factFamilies.1.contentIdentity=G0|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:2|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.1.lifecycles.0.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.0.taskId=A|observation.factFamilies.1.lifecycles.1.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.1.taskId=B|observation.factFamilies.1.lifecycles.2.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.2.taskId=C|observation.factFamilies.1.lifecycles.3.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.3.taskId=D|observation.factFamilies.1.lifecycles.4.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.4.taskId=E|observation.factFamilies.2._tag=TaskPrerequisites|observation.factFamilies.2.contentIdentity=G0|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:2|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.2.prerequisites.0.taskId=A|observation.factFamilies.2.prerequisites.1.taskId=B|observation.factFamilies.2.prerequisites.2.taskId=C|observation.factFamilies.2.prerequisites.3.taskId=D|observation.factFamilies.2.prerequisites.4.taskId=E|observation.factFamilies.3._tag=TaskGroupings|observation.factFamilies.3.contentIdentity=G0|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:2|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.3.groupings.0.taskId=A|observation.factFamilies.3.groupings.1.taskId=B|observation.factFamilies.3.groupings.2.taskId=C|observation.factFamilies.3.groupings.3.taskId=D|observation.factFamilies.3.groupings.4.taskId=E|observation.factFamilies.4._tag=TaskTargetMembership|observation.factFamilies.4.contentIdentity=G0|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:2|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:2",
    kind: "TaskTrackerFactsObserved",
    source: "Trace"
  },
  { detail: "ReadCurrentTaskGraph:B", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail: "acceptedAt=3|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "C:C:ReserveOrReuse:FreshWorkflowRoute", kind: "TaskWorkPositionAdmissionBound", source: "Publication" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:2|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:2",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=3|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ReadCurrentTaskGraph:C", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:3|operation.readShape._tag=CompleteTargetClosure",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "8|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:3|operation.readShape._tag=CompleteTargetClosure",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=3|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268"', kind: "TrackerGraphReadCalled", source: "Tracker" },
  { detail: "G0", kind: "TrackerGraphReadReturned", source: "Tracker" },
  {
    detail:
      "9|_tag=TaskTrackerFactsObserved|observation._tag=UnchangedTaskTrackerFactsReconfirmed|observation.factFamilies.0._tag=TaskIdentitiesReconfirmed|observation.factFamilies.0.contentIdentity=G0|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:3|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecyclesReconfirmed|observation.factFamilies.1.contentIdentity=G0|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:3|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.2._tag=TaskPrerequisitesReconfirmed|observation.factFamilies.2.contentIdentity=G0|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:3|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.3._tag=TaskGroupingsReconfirmed|observation.factFamilies.3.contentIdentity=G0|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:3|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.4._tag=TaskTargetMembershipReconfirmed|observation.factFamilies.4.contentIdentity=G0|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:3|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:3|operationId=issue-268:run:issue-268-controlled:startup:3",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskTrackerFactsObserved|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:3|operation.readShape._tag=CompleteTargetClosure|observation._tag=CompleteTaskTrackerFacts|observation.factFamilies.0._tag=TaskIdentities|observation.factFamilies.0.contentIdentity=G0|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:3|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecycles|observation.factFamilies.1.contentIdentity=G0|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:3|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.1.lifecycles.0.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.0.taskId=A|observation.factFamilies.1.lifecycles.1.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.1.taskId=B|observation.factFamilies.1.lifecycles.2.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.2.taskId=C|observation.factFamilies.1.lifecycles.3.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.3.taskId=D|observation.factFamilies.1.lifecycles.4.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.4.taskId=E|observation.factFamilies.2._tag=TaskPrerequisites|observation.factFamilies.2.contentIdentity=G0|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:3|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.2.prerequisites.0.taskId=A|observation.factFamilies.2.prerequisites.1.taskId=B|observation.factFamilies.2.prerequisites.2.taskId=C|observation.factFamilies.2.prerequisites.3.taskId=D|observation.factFamilies.2.prerequisites.4.taskId=E|observation.factFamilies.3._tag=TaskGroupings|observation.factFamilies.3.contentIdentity=G0|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:3|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.3.groupings.0.taskId=A|observation.factFamilies.3.groupings.1.taskId=B|observation.factFamilies.3.groupings.2.taskId=C|observation.factFamilies.3.groupings.3.taskId=D|observation.factFamilies.3.groupings.4.taskId=E|observation.factFamilies.4._tag=TaskTargetMembership|observation.factFamilies.4.contentIdentity=G0|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:3|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:3",
    kind: "TaskTrackerFactsObserved",
    source: "Trace"
  },
  { detail: "ReadCurrentTaskGraph:C", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail: "acceptedAt=5|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=5|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=5|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=5|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A:A:ReserveOrReuse:FreshWorkflowRoute", kind: "TaskWorkPositionAdmissionBound", source: "Publication" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:3|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:3",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=5|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "AcquireTaskClaim:A", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=AcquireTaskClaim|operation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:4|operation.acquisition.taskId=A|operation.authority._tag=TaskSelectionAuthority",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "_tag=TaskClaimAcquisitionIntended|operation._tag=AcquireTaskClaim|operation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:4|operation.acquisition.taskId=A|operation.authority._tag=TaskSelectionAuthority",
    kind: "TaskClaimAcquisitionIntended",
    source: "Trace"
  },
  {
    detail:
      "10|_tag=TaskClaimAcquisitionIntended|operation._tag=AcquireTaskClaim|operation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:4|operation.acquisition.taskId=A|operation.authority._tag=TaskSelectionAuthority",
    kind: "TaskClaimAcquisitionIntended",
    source: "Journal"
  },
  {
    detail: "acceptedAt=5|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A", kind: "TaskClaimReadCalled", source: "Tracker" },
  { detail: "A:UnclaimedTask", kind: "TaskClaimReadReturned", source: "Tracker" },
  { detail: "A:issue-268:run:issue-268-controlled:startup:4", kind: "TaskClaimAcquireCalled", source: "Tracker" },
  {
    detail: "acceptedAt=7|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=7|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=7|held=|live=A:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=7|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "B:B:ReserveOrReuse:FreshWorkflowRoute", kind: "TaskWorkPositionAdmissionBound", source: "Publication" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:3|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:3",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=7|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "AcquireTaskClaim:B", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=AcquireTaskClaim|operation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:5|operation.acquisition.taskId=B|operation.authority._tag=TaskSelectionAuthority",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "_tag=TaskClaimAcquisitionIntended|operation._tag=AcquireTaskClaim|operation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:5|operation.acquisition.taskId=B|operation.authority._tag=TaskSelectionAuthority",
    kind: "TaskClaimAcquisitionIntended",
    source: "Trace"
  },
  {
    detail:
      "11|_tag=TaskClaimAcquisitionIntended|operation._tag=AcquireTaskClaim|operation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:5|operation.acquisition.taskId=B|operation.authority._tag=TaskSelectionAuthority",
    kind: "TaskClaimAcquisitionIntended",
    source: "Journal"
  },
  {
    detail: "acceptedAt=7|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "B", kind: "TaskClaimReadCalled", source: "Tracker" },
  { detail: "B:UnclaimedTask", kind: "TaskClaimReadReturned", source: "Tracker" },
  { detail: "B:issue-268:run:issue-268-controlled:startup:5", kind: "TaskClaimAcquireCalled", source: "Tracker" },
  {
    detail: "acceptedAt=9|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=9|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=9|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=9|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "C:C:ReserveOrReuse:FreshWorkflowRoute", kind: "TaskWorkPositionAdmissionBound", source: "Publication" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:3|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:3",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=9|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "AcquireTaskClaim:C", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=AcquireTaskClaim|operation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:6|operation.acquisition.taskId=C|operation.authority._tag=TaskSelectionAuthority",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "_tag=TaskClaimAcquisitionIntended|operation._tag=AcquireTaskClaim|operation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:6|operation.acquisition.taskId=C|operation.authority._tag=TaskSelectionAuthority",
    kind: "TaskClaimAcquisitionIntended",
    source: "Trace"
  },
  {
    detail:
      "12|_tag=TaskClaimAcquisitionIntended|operation._tag=AcquireTaskClaim|operation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:6|operation.acquisition.taskId=C|operation.authority._tag=TaskSelectionAuthority",
    kind: "TaskClaimAcquisitionIntended",
    source: "Journal"
  },
  {
    detail: "acceptedAt=9|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "C", kind: "TaskClaimReadCalled", source: "Tracker" },
  { detail: "C:UnclaimedTask", kind: "TaskClaimReadReturned", source: "Tracker" },
  { detail: "C:issue-268:run:issue-268-controlled:startup:6", kind: "TaskClaimAcquireCalled", source: "Tracker" },
  {
    detail: "acceptedAt=10|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=11|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:3|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:3",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  { detail: "A", kind: "ClaimResponseReadinessReleased", source: "Control" },
  { detail: "A:issue-268:run:issue-268-controlled:startup:4", kind: "TaskClaimAcquireReturned", source: "Tracker" },
  { detail: "A", kind: "TaskClaimReadCalled", source: "Tracker" },
  { detail: "A:ActiveTaskClaim", kind: "TaskClaimReadReturned", source: "Tracker" },
  {
    detail:
      "13|_tag=TaskClaimAcquired|claim._tag=ActiveTaskClaim|claim.operationId=issue-268:run:issue-268-controlled:startup:4|claim.taskId=A",
    kind: "TaskClaimAcquired",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskClaimAcquired|claim._tag=ActiveTaskClaim|claim.operationId=issue-268:run:issue-268-controlled:startup:4|claim.taskId=A|operation._tag=AcquireTaskClaim|operation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:4|operation.acquisition.taskId=A|operation.authority._tag=TaskSelectionAuthority",
    kind: "TaskClaimAcquired",
    source: "Trace"
  },
  { detail: "AcquireTaskClaim:A", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:3|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:3",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=13|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=13|held=|live=A:FreshWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=13|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=13|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=13|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ReadPostClaimGraph:A", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:7|operation.readShape._tag=CompleteTargetClosure",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "14|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:7|operation.readShape._tag=CompleteTargetClosure",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=13|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268"', kind: "TrackerGraphReadCalled", source: "Tracker" },
  { detail: "G0", kind: "TrackerGraphReadReturned", source: "Tracker" },
  {
    detail:
      "15|_tag=TaskTrackerFactsObserved|observation._tag=UnchangedTaskTrackerFactsReconfirmed|observation.factFamilies.0._tag=TaskIdentitiesReconfirmed|observation.factFamilies.0.contentIdentity=G0|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:7|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecyclesReconfirmed|observation.factFamilies.1.contentIdentity=G0|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:7|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.2._tag=TaskPrerequisitesReconfirmed|observation.factFamilies.2.contentIdentity=G0|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:7|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.3._tag=TaskGroupingsReconfirmed|observation.factFamilies.3.contentIdentity=G0|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:7|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.4._tag=TaskTargetMembershipReconfirmed|observation.factFamilies.4.contentIdentity=G0|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:7|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:7|operationId=issue-268:run:issue-268-controlled:startup:7",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskTrackerFactsObserved|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:7|operation.readShape._tag=CompleteTargetClosure|observation._tag=CompleteTaskTrackerFacts|observation.factFamilies.0._tag=TaskIdentities|observation.factFamilies.0.contentIdentity=G0|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:7|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecycles|observation.factFamilies.1.contentIdentity=G0|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:7|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.1.lifecycles.0.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.0.taskId=A|observation.factFamilies.1.lifecycles.1.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.1.taskId=B|observation.factFamilies.1.lifecycles.2.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.2.taskId=C|observation.factFamilies.1.lifecycles.3.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.3.taskId=D|observation.factFamilies.1.lifecycles.4.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.4.taskId=E|observation.factFamilies.2._tag=TaskPrerequisites|observation.factFamilies.2.contentIdentity=G0|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:7|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.2.prerequisites.0.taskId=A|observation.factFamilies.2.prerequisites.1.taskId=B|observation.factFamilies.2.prerequisites.2.taskId=C|observation.factFamilies.2.prerequisites.3.taskId=D|observation.factFamilies.2.prerequisites.4.taskId=E|observation.factFamilies.3._tag=TaskGroupings|observation.factFamilies.3.contentIdentity=G0|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:7|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.3.groupings.0.taskId=A|observation.factFamilies.3.groupings.1.taskId=B|observation.factFamilies.3.groupings.2.taskId=C|observation.factFamilies.3.groupings.3.taskId=D|observation.factFamilies.3.groupings.4.taskId=E|observation.factFamilies.4._tag=TaskTargetMembership|observation.factFamilies.4.contentIdentity=G0|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:7|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:7",
    kind: "TaskTrackerFactsObserved",
    source: "Trace"
  },
  {
    detail:
      "_tag=TrackerExecutionAdmitted|claimOperation._tag=AcquireTaskClaim|claimOperation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:4|claimOperation.acquisition.taskId=A|claimOperation.authority._tag=TaskSelectionAuthority|observationOperation._tag=ReadTrackerGraph|observationOperation.cause._tag=WorkflowEstablishment|observationOperation.operationId=issue-268:run:issue-268-controlled:startup:7|observationOperation.readShape._tag=CompleteTargetClosure",
    kind: "TrackerExecutionAdmitted",
    source: "Trace"
  },
  { detail: "ReadPostClaimGraph:A", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:7|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:7",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=15|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=15|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=15|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=15|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=15|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ReadTaskWorkSpecification:A", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:startup:8|operation.taskId=A",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "16|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:startup:8|operation.taskId=A",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=15|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268":A', kind: "TaskWorkSpecificationReadCalled", source: "Tracker" },
  {
    detail: "A:tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBBLiIsInRpdGxlIjoiSW1wbGVtZW50IEEifQ",
    kind: "TaskWorkSpecificationReadReturned",
    source: "Tracker"
  },
  {
    detail:
      "17|_tag=TaskTrackerFactsObserved|observation._tag=FocusedTaskWorkSpecificationFacts|observation.factFamily._tag=TaskWorkSpecification|observation.factFamily.contentIdentity=tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBBLiIsInRpdGxlIjoiSW1wbGVtZW50IEEifQ|observation.factFamily.coverage._tag=ExactTaskWorkSpecification|observation.factFamily.coverage.taskId=A|observation.factFamily.freshness._tag=ObservedDuringLogicalRead|observation.factFamily.freshness.operationId=issue-268:run:issue-268-controlled:startup:8|observation.factFamily.taskId=A|observation.operationId=issue-268:run:issue-268-controlled:startup:8|operationId=issue-268:run:issue-268-controlled:startup:8",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "ReadTaskWorkSpecification:A", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:7|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:7",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=17|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=17|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=17|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=17|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=17|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "RecordTaskAttemptPlan:A", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=RecordTaskAttemptPlan|operation.operationId=issue-268:run:issue-268-controlled:startup:9|operation.plannedAttempt.attemptId=attempt:A:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=A",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "18|_tag=TaskAttemptPlanned|operation._tag=RecordTaskAttemptPlan|operation.operationId=issue-268:run:issue-268-controlled:startup:9|operation.plannedAttempt.attemptId=attempt:A:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=A",
    kind: "TaskAttemptPlanned",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskAttemptPlanAcknowledged|operation._tag=RecordTaskAttemptPlan|operation.operationId=issue-268:run:issue-268-controlled:startup:9|operation.plannedAttempt.attemptId=attempt:A:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=A",
    kind: "TaskAttemptPlanAcknowledged",
    source: "Trace"
  },
  { detail: "RecordTaskAttemptPlan:A", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:7|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:7",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=18|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=18|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=18|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=18|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=18|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ReconcileTaskWorktree:A", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReconcileTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:startup:10|operation.plannedAttempt.attemptId=attempt:A:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=A",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "19|_tag=TaskWorktreeReconciliationIntended|operation._tag=ReconcileTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:startup:10|operation.plannedAttempt.attemptId=attempt:A:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=A",
    kind: "TaskWorktreeReconciliationIntended",
    source: "Journal"
  },
  {
    detail: "acceptedAt=18|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A:attempt:A:1", kind: "WorktreeReadCalled", source: "Git" },
  { detail: "A:attempt:A:1:PlannedWorktreeAbsent", kind: "WorktreeReadReturned", source: "Git" },
  { detail: "A:attempt:A:1", kind: "WorktreeCreateCalled", source: "Git" },
  { detail: "A:attempt:A:1", kind: "WorktreeCreateReturned", source: "Git" },
  { detail: "A:attempt:A:1", kind: "WorktreeReadCalled", source: "Git" },
  { detail: "A:attempt:A:1:PlannedWorktreeReady", kind: "WorktreeReadReturned", source: "Git" },
  {
    detail:
      "20|_tag=TaskWorktreeReady|operationId=issue-268:run:issue-268-controlled:startup:10|proof._tag=PlannedWorktreeReady",
    kind: "TaskWorktreeReady",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskWorktreeReady|operation._tag=ReconcileTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:startup:10|operation.plannedAttempt.attemptId=attempt:A:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=A|proof._tag=PlannedWorktreeReady",
    kind: "TaskWorktreeReady",
    source: "Trace"
  },
  { detail: "ReconcileTaskWorktree:A", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:7|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:7",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=20|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=20|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute,A:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=20|held=|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=20|held=|live=A:FreshExecutorWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "A:A:ReserveOrReuse:FreshExecutorWorkflowRoute",
    kind: "TaskWorkPositionAdmissionBound",
    source: "Publication"
  },
  {
    detail: "acceptedAt=20|held=|live=A:FreshExecutorWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "BeginPlannedAttemptExecutorWork:A", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "21|_tag=PlannedAttemptExecutorWorkResponsibilityBegan|plannedAttempt.attemptId=attempt:A:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=A",
    kind: "PlannedAttemptExecutorWorkResponsibilityBegan",
    source: "Journal"
  },
  {
    detail:
      "22|_tag=PlannedAttemptExecutorCommandIntended|command=Begin|initiatedBy._tag=DalphCoordinator|ordinal=1|plannedAttempt.attemptId=attempt:A:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=A",
    kind: "PlannedAttemptExecutorCommandIntended",
    source: "Journal"
  },
  { detail: "attempt:A:1", kind: "ExecutorBeginCalled", source: "Executor" },
  { detail: "attempt:A:1:ExecutorWorkExecuting", kind: "ExecutorBeginReturned", source: "Executor" },
  {
    detail:
      "23|_tag=PlannedAttemptExecutorCommandResponseObserved|plannedAttempt.attemptId=attempt:A:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=A|report._tag=ExecutorWorkExecuting|report.correlation.attemptId=attempt:A:1|report.correlation.runId=run:issue-268-controlled",
    kind: "PlannedAttemptExecutorCommandResponseObserved",
    source: "Journal"
  },
  {
    detail:
      "24|_tag=PlannedAttemptExecutorWorkReported|ordinal=1|report._tag=ExecutorWorkExecuting|report.correlation.attemptId=attempt:A:1|report.correlation.runId=run:issue-268-controlled",
    kind: "PlannedAttemptExecutorWorkReported",
    source: "Journal"
  },
  { detail: "attempt:A:1:PassiveLifecycleObservation", kind: "ExecutorObserveCalled", source: "Executor" },
  { detail: "attempt:A:1:Exact", kind: "ExecutorObserveReturned", source: "Executor" },
  { detail: "BeginPlannedAttemptExecutorWork:A", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:7|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:7",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  { detail: "B", kind: "ClaimResponseReadinessReleased", source: "Control" },
  { detail: "B:issue-268:run:issue-268-controlled:startup:5", kind: "TaskClaimAcquireReturned", source: "Tracker" },
  { detail: "B", kind: "TaskClaimReadCalled", source: "Tracker" },
  { detail: "B:ActiveTaskClaim", kind: "TaskClaimReadReturned", source: "Tracker" },
  {
    detail:
      "25|_tag=TaskClaimAcquired|claim._tag=ActiveTaskClaim|claim.operationId=issue-268:run:issue-268-controlled:startup:5|claim.taskId=B",
    kind: "TaskClaimAcquired",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskClaimAcquired|claim._tag=ActiveTaskClaim|claim.operationId=issue-268:run:issue-268-controlled:startup:5|claim.taskId=B|operation._tag=AcquireTaskClaim|operation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:5|operation.acquisition.taskId=B|operation.authority._tag=TaskSelectionAuthority",
    kind: "TaskClaimAcquired",
    source: "Trace"
  },
  { detail: "AcquireTaskClaim:B", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=24|held=attempt:A:1|live=A:FreshExecutorWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "attempt:A:1", kind: "TaskWorkPositionBound", source: "Publication" },
  {
    detail:
      "acceptedAt=24|held=attempt:A:1|live=A:FreshExecutorWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=24|held=attempt:A:1|live=B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=24|held=attempt:A:1|live=A:FreshExecutorWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "A:A:ReserveOrReuse:FreshExecutorWorkflowRoute",
    kind: "TaskWorkPositionAdmissionBound",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:7|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:7",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=24|held=attempt:A:1|live=A:FreshExecutorWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ObservePlannedAttemptExecutorWork:A", kind: "DeliveryActionExecuting", source: "Action" },
  { detail: "ObservePlannedAttemptExecutorWork:A", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=25|held=attempt:A:1|live=A:FreshExecutorWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=25|held=attempt:A:1|live=A:FreshExecutorWorkflowRoute,B:FreshWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=25|held=attempt:A:1|live=A:FreshExecutorWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=25|held=attempt:A:1|live=A:FreshExecutorWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=25|held=attempt:A:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=25|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=25|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ReadPostClaimGraph:B", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:11|operation.readShape._tag=CompleteTargetClosure",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "26|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:11|operation.readShape._tag=CompleteTargetClosure",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=25|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268"', kind: "TrackerGraphReadCalled", source: "Tracker" },
  { detail: "G0", kind: "TrackerGraphReadReturned", source: "Tracker" },
  {
    detail:
      "27|_tag=TaskTrackerFactsObserved|observation._tag=UnchangedTaskTrackerFactsReconfirmed|observation.factFamilies.0._tag=TaskIdentitiesReconfirmed|observation.factFamilies.0.contentIdentity=G0|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:11|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecyclesReconfirmed|observation.factFamilies.1.contentIdentity=G0|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:11|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.2._tag=TaskPrerequisitesReconfirmed|observation.factFamilies.2.contentIdentity=G0|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:11|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.3._tag=TaskGroupingsReconfirmed|observation.factFamilies.3.contentIdentity=G0|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:11|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.4._tag=TaskTargetMembershipReconfirmed|observation.factFamilies.4.contentIdentity=G0|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:11|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:11|operationId=issue-268:run:issue-268-controlled:startup:11",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskTrackerFactsObserved|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:11|operation.readShape._tag=CompleteTargetClosure|observation._tag=CompleteTaskTrackerFacts|observation.factFamilies.0._tag=TaskIdentities|observation.factFamilies.0.contentIdentity=G0|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:11|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecycles|observation.factFamilies.1.contentIdentity=G0|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:11|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.1.lifecycles.0.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.0.taskId=A|observation.factFamilies.1.lifecycles.1.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.1.taskId=B|observation.factFamilies.1.lifecycles.2.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.2.taskId=C|observation.factFamilies.1.lifecycles.3.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.3.taskId=D|observation.factFamilies.1.lifecycles.4.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.4.taskId=E|observation.factFamilies.2._tag=TaskPrerequisites|observation.factFamilies.2.contentIdentity=G0|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:11|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.2.prerequisites.0.taskId=A|observation.factFamilies.2.prerequisites.1.taskId=B|observation.factFamilies.2.prerequisites.2.taskId=C|observation.factFamilies.2.prerequisites.3.taskId=D|observation.factFamilies.2.prerequisites.4.taskId=E|observation.factFamilies.3._tag=TaskGroupings|observation.factFamilies.3.contentIdentity=G0|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:11|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.3.groupings.0.taskId=A|observation.factFamilies.3.groupings.1.taskId=B|observation.factFamilies.3.groupings.2.taskId=C|observation.factFamilies.3.groupings.3.taskId=D|observation.factFamilies.3.groupings.4.taskId=E|observation.factFamilies.4._tag=TaskTargetMembership|observation.factFamilies.4.contentIdentity=G0|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:11|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:11",
    kind: "TaskTrackerFactsObserved",
    source: "Trace"
  },
  {
    detail:
      "_tag=TrackerExecutionAdmitted|claimOperation._tag=AcquireTaskClaim|claimOperation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:5|claimOperation.acquisition.taskId=B|claimOperation.authority._tag=TaskSelectionAuthority|observationOperation._tag=ReadTrackerGraph|observationOperation.cause._tag=WorkflowEstablishment|observationOperation.operationId=issue-268:run:issue-268-controlled:startup:11|observationOperation.readShape._tag=CompleteTargetClosure",
    kind: "TrackerExecutionAdmitted",
    source: "Trace"
  },
  { detail: "ReadPostClaimGraph:B", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:11|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:11",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=27|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=27|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=27|held=attempt:A:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=27|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=27|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ReadTaskWorkSpecification:B", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:startup:12|operation.taskId=B",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "28|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:startup:12|operation.taskId=B",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=27|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268":B', kind: "TaskWorkSpecificationReadCalled", source: "Tracker" },
  {
    detail: "B:tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBCLiIsInRpdGxlIjoiSW1wbGVtZW50IEIifQ",
    kind: "TaskWorkSpecificationReadReturned",
    source: "Tracker"
  },
  {
    detail:
      "29|_tag=TaskTrackerFactsObserved|observation._tag=FocusedTaskWorkSpecificationFacts|observation.factFamily._tag=TaskWorkSpecification|observation.factFamily.contentIdentity=tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBCLiIsInRpdGxlIjoiSW1wbGVtZW50IEIifQ|observation.factFamily.coverage._tag=ExactTaskWorkSpecification|observation.factFamily.coverage.taskId=B|observation.factFamily.freshness._tag=ObservedDuringLogicalRead|observation.factFamily.freshness.operationId=issue-268:run:issue-268-controlled:startup:12|observation.factFamily.taskId=B|observation.operationId=issue-268:run:issue-268-controlled:startup:12|operationId=issue-268:run:issue-268-controlled:startup:12",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "ReadTaskWorkSpecification:B", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:11|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:11",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=29|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=29|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=29|held=attempt:A:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=29|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=29|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "RecordTaskAttemptPlan:B", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=RecordTaskAttemptPlan|operation.operationId=issue-268:run:issue-268-controlled:startup:13|operation.plannedAttempt.attemptId=attempt:B:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=B",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "30|_tag=TaskAttemptPlanned|operation._tag=RecordTaskAttemptPlan|operation.operationId=issue-268:run:issue-268-controlled:startup:13|operation.plannedAttempt.attemptId=attempt:B:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=B",
    kind: "TaskAttemptPlanned",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskAttemptPlanAcknowledged|operation._tag=RecordTaskAttemptPlan|operation.operationId=issue-268:run:issue-268-controlled:startup:13|operation.plannedAttempt.attemptId=attempt:B:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=B",
    kind: "TaskAttemptPlanAcknowledged",
    source: "Trace"
  },
  { detail: "RecordTaskAttemptPlan:B", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:11|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:11",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=30|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=30|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=30|held=attempt:A:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=30|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=30|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ReconcileTaskWorktree:B", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReconcileTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:startup:14|operation.plannedAttempt.attemptId=attempt:B:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=B",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "31|_tag=TaskWorktreeReconciliationIntended|operation._tag=ReconcileTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:startup:14|operation.plannedAttempt.attemptId=attempt:B:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=B",
    kind: "TaskWorktreeReconciliationIntended",
    source: "Journal"
  },
  {
    detail: "acceptedAt=30|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "B:attempt:B:1", kind: "WorktreeReadCalled", source: "Git" },
  { detail: "B:attempt:B:1:PlannedWorktreeAbsent", kind: "WorktreeReadReturned", source: "Git" },
  { detail: "B:attempt:B:1", kind: "WorktreeCreateCalled", source: "Git" },
  { detail: "B:attempt:B:1", kind: "WorktreeCreateReturned", source: "Git" },
  { detail: "B:attempt:B:1", kind: "WorktreeReadCalled", source: "Git" },
  { detail: "B:attempt:B:1:PlannedWorktreeReady", kind: "WorktreeReadReturned", source: "Git" },
  {
    detail:
      "32|_tag=TaskWorktreeReady|operationId=issue-268:run:issue-268-controlled:startup:14|proof._tag=PlannedWorktreeReady",
    kind: "TaskWorktreeReady",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskWorktreeReady|operation._tag=ReconcileTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:startup:14|operation.plannedAttempt.attemptId=attempt:B:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=B|proof._tag=PlannedWorktreeReady",
    kind: "TaskWorktreeReady",
    source: "Trace"
  },
  { detail: "ReconcileTaskWorktree:B", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:11|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:11",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=32|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=32|held=attempt:A:1|live=C:FreshWorkflowRoute,B:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=32|held=attempt:A:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=32|held=attempt:A:1|live=B:FreshExecutorWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "B:B:ReserveOrReuse:FreshExecutorWorkflowRoute",
    kind: "TaskWorkPositionAdmissionBound",
    source: "Publication"
  },
  {
    detail: "acceptedAt=32|held=attempt:A:1|live=B:FreshExecutorWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "BeginPlannedAttemptExecutorWork:B", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "33|_tag=PlannedAttemptExecutorWorkResponsibilityBegan|plannedAttempt.attemptId=attempt:B:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=B",
    kind: "PlannedAttemptExecutorWorkResponsibilityBegan",
    source: "Journal"
  },
  {
    detail:
      "34|_tag=PlannedAttemptExecutorCommandIntended|command=Begin|initiatedBy._tag=DalphCoordinator|ordinal=1|plannedAttempt.attemptId=attempt:B:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=B",
    kind: "PlannedAttemptExecutorCommandIntended",
    source: "Journal"
  },
  { detail: "attempt:B:1", kind: "ExecutorBeginCalled", source: "Executor" },
  { detail: "attempt:B:1:ExecutorWorkExecuting", kind: "ExecutorBeginReturned", source: "Executor" },
  {
    detail:
      "35|_tag=PlannedAttemptExecutorCommandResponseObserved|plannedAttempt.attemptId=attempt:B:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=B|report._tag=ExecutorWorkExecuting|report.correlation.attemptId=attempt:B:1|report.correlation.runId=run:issue-268-controlled",
    kind: "PlannedAttemptExecutorCommandResponseObserved",
    source: "Journal"
  },
  {
    detail:
      "36|_tag=PlannedAttemptExecutorWorkReported|ordinal=1|report._tag=ExecutorWorkExecuting|report.correlation.attemptId=attempt:B:1|report.correlation.runId=run:issue-268-controlled",
    kind: "PlannedAttemptExecutorWorkReported",
    source: "Journal"
  },
  { detail: "attempt:B:1:PassiveLifecycleObservation", kind: "ExecutorObserveCalled", source: "Executor" },
  { detail: "attempt:B:1:Exact", kind: "ExecutorObserveReturned", source: "Executor" },
  { detail: "BeginPlannedAttemptExecutorWork:B", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:11|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:11",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  { detail: "C", kind: "ClaimResponseReadinessReleased", source: "Control" },
  { detail: "C:issue-268:run:issue-268-controlled:startup:6", kind: "TaskClaimAcquireReturned", source: "Tracker" },
  { detail: "C", kind: "TaskClaimReadCalled", source: "Tracker" },
  { detail: "C:ActiveTaskClaim", kind: "TaskClaimReadReturned", source: "Tracker" },
  {
    detail:
      "37|_tag=TaskClaimAcquired|claim._tag=ActiveTaskClaim|claim.operationId=issue-268:run:issue-268-controlled:startup:6|claim.taskId=C",
    kind: "TaskClaimAcquired",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskClaimAcquired|claim._tag=ActiveTaskClaim|claim.operationId=issue-268:run:issue-268-controlled:startup:6|claim.taskId=C|operation._tag=AcquireTaskClaim|operation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:6|operation.acquisition.taskId=C|operation.authority._tag=TaskSelectionAuthority",
    kind: "TaskClaimAcquired",
    source: "Trace"
  },
  { detail: "AcquireTaskClaim:C", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail: "acceptedAt=36|held=attempt:A:1,attempt:B:1|live=B:FreshExecutorWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "attempt:B:1", kind: "TaskWorkPositionBound", source: "Publication" },
  {
    detail: "acceptedAt=36|held=attempt:A:1,attempt:B:1|live=B:FreshExecutorWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=36|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=36|held=attempt:A:1,attempt:B:1|live=B:FreshExecutorWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "B:B:ReserveOrReuse:FreshExecutorWorkflowRoute",
    kind: "TaskWorkPositionAdmissionBound",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:11|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:11",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=36|held=attempt:A:1,attempt:B:1|live=B:FreshExecutorWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ObservePlannedAttemptExecutorWork:B", kind: "DeliveryActionExecuting", source: "Action" },
  { detail: "ObservePlannedAttemptExecutorWork:B", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail: "acceptedAt=37|held=attempt:A:1,attempt:B:1|live=B:FreshExecutorWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=37|held=attempt:A:1,attempt:B:1|live=B:FreshExecutorWorkflowRoute,C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=37|held=attempt:A:1,attempt:B:1|live=B:FreshExecutorWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=37|held=attempt:A:1,attempt:B:1|live=B:FreshExecutorWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=37|held=attempt:A:1,attempt:B:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=37|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=37|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ReadPostClaimGraph:C", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:15|operation.readShape._tag=CompleteTargetClosure",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "38|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:15|operation.readShape._tag=CompleteTargetClosure",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=37|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268"', kind: "TrackerGraphReadCalled", source: "Tracker" },
  { detail: "G0", kind: "TrackerGraphReadReturned", source: "Tracker" },
  {
    detail:
      "39|_tag=TaskTrackerFactsObserved|observation._tag=UnchangedTaskTrackerFactsReconfirmed|observation.factFamilies.0._tag=TaskIdentitiesReconfirmed|observation.factFamilies.0.contentIdentity=G0|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:15|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecyclesReconfirmed|observation.factFamilies.1.contentIdentity=G0|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:15|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.2._tag=TaskPrerequisitesReconfirmed|observation.factFamilies.2.contentIdentity=G0|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:15|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.3._tag=TaskGroupingsReconfirmed|observation.factFamilies.3.contentIdentity=G0|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:15|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.4._tag=TaskTargetMembershipReconfirmed|observation.factFamilies.4.contentIdentity=G0|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:15|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:15|operationId=issue-268:run:issue-268-controlled:startup:15",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskTrackerFactsObserved|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:15|operation.readShape._tag=CompleteTargetClosure|observation._tag=CompleteTaskTrackerFacts|observation.factFamilies.0._tag=TaskIdentities|observation.factFamilies.0.contentIdentity=G0|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:15|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecycles|observation.factFamilies.1.contentIdentity=G0|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:15|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.1.lifecycles.0.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.0.taskId=A|observation.factFamilies.1.lifecycles.1.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.1.taskId=B|observation.factFamilies.1.lifecycles.2.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.2.taskId=C|observation.factFamilies.1.lifecycles.3.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.3.taskId=D|observation.factFamilies.1.lifecycles.4.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.4.taskId=E|observation.factFamilies.2._tag=TaskPrerequisites|observation.factFamilies.2.contentIdentity=G0|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:15|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.2.prerequisites.0.taskId=A|observation.factFamilies.2.prerequisites.1.taskId=B|observation.factFamilies.2.prerequisites.2.taskId=C|observation.factFamilies.2.prerequisites.3.taskId=D|observation.factFamilies.2.prerequisites.4.taskId=E|observation.factFamilies.3._tag=TaskGroupings|observation.factFamilies.3.contentIdentity=G0|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:15|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.3.groupings.0.taskId=A|observation.factFamilies.3.groupings.1.taskId=B|observation.factFamilies.3.groupings.2.taskId=C|observation.factFamilies.3.groupings.3.taskId=D|observation.factFamilies.3.groupings.4.taskId=E|observation.factFamilies.4._tag=TaskTargetMembership|observation.factFamilies.4.contentIdentity=G0|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:15|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:15",
    kind: "TaskTrackerFactsObserved",
    source: "Trace"
  },
  {
    detail:
      "_tag=TrackerExecutionAdmitted|claimOperation._tag=AcquireTaskClaim|claimOperation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:6|claimOperation.acquisition.taskId=C|claimOperation.authority._tag=TaskSelectionAuthority|observationOperation._tag=ReadTrackerGraph|observationOperation.cause._tag=WorkflowEstablishment|observationOperation.operationId=issue-268:run:issue-268-controlled:startup:15|observationOperation.readShape._tag=CompleteTargetClosure",
    kind: "TrackerExecutionAdmitted",
    source: "Trace"
  },
  { detail: "ReadPostClaimGraph:C", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:15|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:15",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=39|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=39|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=39|held=attempt:A:1,attempt:B:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=39|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=39|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ReadTaskWorkSpecification:C", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:startup:16|operation.taskId=C",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "40|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:startup:16|operation.taskId=C",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=39|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268":C', kind: "TaskWorkSpecificationReadCalled", source: "Tracker" },
  {
    detail: "C:tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBDLiIsInRpdGxlIjoiSW1wbGVtZW50IEMifQ",
    kind: "TaskWorkSpecificationReadReturned",
    source: "Tracker"
  },
  {
    detail:
      "41|_tag=TaskTrackerFactsObserved|observation._tag=FocusedTaskWorkSpecificationFacts|observation.factFamily._tag=TaskWorkSpecification|observation.factFamily.contentIdentity=tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBDLiIsInRpdGxlIjoiSW1wbGVtZW50IEMifQ|observation.factFamily.coverage._tag=ExactTaskWorkSpecification|observation.factFamily.coverage.taskId=C|observation.factFamily.freshness._tag=ObservedDuringLogicalRead|observation.factFamily.freshness.operationId=issue-268:run:issue-268-controlled:startup:16|observation.factFamily.taskId=C|observation.operationId=issue-268:run:issue-268-controlled:startup:16|operationId=issue-268:run:issue-268-controlled:startup:16",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "ReadTaskWorkSpecification:C", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:15|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:15",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=41|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=41|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=41|held=attempt:A:1,attempt:B:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=41|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=41|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "RecordTaskAttemptPlan:C", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=RecordTaskAttemptPlan|operation.operationId=issue-268:run:issue-268-controlled:startup:17|operation.plannedAttempt.attemptId=attempt:C:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=C",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "42|_tag=TaskAttemptPlanned|operation._tag=RecordTaskAttemptPlan|operation.operationId=issue-268:run:issue-268-controlled:startup:17|operation.plannedAttempt.attemptId=attempt:C:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=C",
    kind: "TaskAttemptPlanned",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskAttemptPlanAcknowledged|operation._tag=RecordTaskAttemptPlan|operation.operationId=issue-268:run:issue-268-controlled:startup:17|operation.plannedAttempt.attemptId=attempt:C:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=C",
    kind: "TaskAttemptPlanAcknowledged",
    source: "Trace"
  },
  { detail: "RecordTaskAttemptPlan:C", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:15|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:15",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=42|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=42|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=42|held=attempt:A:1,attempt:B:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=42|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=42|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ReconcileTaskWorktree:C", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReconcileTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:startup:18|operation.plannedAttempt.attemptId=attempt:C:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=C",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "43|_tag=TaskWorktreeReconciliationIntended|operation._tag=ReconcileTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:startup:18|operation.plannedAttempt.attemptId=attempt:C:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=C",
    kind: "TaskWorktreeReconciliationIntended",
    source: "Journal"
  },
  {
    detail: "acceptedAt=42|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "C:attempt:C:1", kind: "WorktreeReadCalled", source: "Git" },
  { detail: "C:attempt:C:1:PlannedWorktreeAbsent", kind: "WorktreeReadReturned", source: "Git" },
  { detail: "C:attempt:C:1", kind: "WorktreeCreateCalled", source: "Git" },
  { detail: "C:attempt:C:1", kind: "WorktreeCreateReturned", source: "Git" },
  { detail: "C:attempt:C:1", kind: "WorktreeReadCalled", source: "Git" },
  { detail: "C:attempt:C:1:PlannedWorktreeReady", kind: "WorktreeReadReturned", source: "Git" },
  {
    detail:
      "44|_tag=TaskWorktreeReady|operationId=issue-268:run:issue-268-controlled:startup:18|proof._tag=PlannedWorktreeReady",
    kind: "TaskWorktreeReady",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskWorktreeReady|operation._tag=ReconcileTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:startup:18|operation.plannedAttempt.attemptId=attempt:C:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=C|proof._tag=PlannedWorktreeReady",
    kind: "TaskWorktreeReady",
    source: "Trace"
  },
  { detail: "ReconcileTaskWorktree:C", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:15|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:15",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=44|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=44|held=attempt:A:1,attempt:B:1|live=C:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=44|held=attempt:A:1,attempt:B:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=44|held=attempt:A:1,attempt:B:1|live=C:FreshExecutorWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "C:C:ReserveOrReuse:FreshExecutorWorkflowRoute",
    kind: "TaskWorkPositionAdmissionBound",
    source: "Publication"
  },
  {
    detail: "acceptedAt=44|held=attempt:A:1,attempt:B:1|live=C:FreshExecutorWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "BeginPlannedAttemptExecutorWork:C", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "45|_tag=PlannedAttemptExecutorWorkResponsibilityBegan|plannedAttempt.attemptId=attempt:C:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=C",
    kind: "PlannedAttemptExecutorWorkResponsibilityBegan",
    source: "Journal"
  },
  {
    detail:
      "46|_tag=PlannedAttemptExecutorCommandIntended|command=Begin|initiatedBy._tag=DalphCoordinator|ordinal=1|plannedAttempt.attemptId=attempt:C:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=C",
    kind: "PlannedAttemptExecutorCommandIntended",
    source: "Journal"
  },
  { detail: "attempt:C:1", kind: "ExecutorBeginCalled", source: "Executor" },
  { detail: "attempt:C:1:ExecutorWorkExecuting", kind: "ExecutorBeginReturned", source: "Executor" },
  {
    detail:
      "47|_tag=PlannedAttemptExecutorCommandResponseObserved|plannedAttempt.attemptId=attempt:C:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=C|report._tag=ExecutorWorkExecuting|report.correlation.attemptId=attempt:C:1|report.correlation.runId=run:issue-268-controlled",
    kind: "PlannedAttemptExecutorCommandResponseObserved",
    source: "Journal"
  },
  {
    detail:
      "48|_tag=PlannedAttemptExecutorWorkReported|ordinal=1|report._tag=ExecutorWorkExecuting|report.correlation.attemptId=attempt:C:1|report.correlation.runId=run:issue-268-controlled",
    kind: "PlannedAttemptExecutorWorkReported",
    source: "Journal"
  },
  { detail: "attempt:C:1:PassiveLifecycleObservation", kind: "ExecutorObserveCalled", source: "Executor" },
  { detail: "attempt:C:1:Exact", kind: "ExecutorObserveReturned", source: "Executor" },
  { detail: "BeginPlannedAttemptExecutorWork:C", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:15|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:15",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=48|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:FreshExecutorWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "attempt:C:1", kind: "TaskWorkPositionBound", source: "Publication" },
  {
    detail: "acceptedAt=48|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:FreshExecutorWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=48|held=attempt:A:1,attempt:B:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=48|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:FreshExecutorWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "C:C:ReserveOrReuse:FreshExecutorWorkflowRoute",
    kind: "TaskWorkPositionAdmissionBound",
    source: "Publication"
  },
  {
    detail: "acceptedAt=48|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:FreshExecutorWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ObservePlannedAttemptExecutorWork:C", kind: "DeliveryActionExecuting", source: "Action" },
  { detail: "ObservePlannedAttemptExecutorWork:C", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail: "acceptedAt=48|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:FreshExecutorWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=48|held=attempt:A:1,attempt:B:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=48|held=attempt:A:1,attempt:B:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G0|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:15|graph.observation.contentIdentity=G0|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:15",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "B:tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBCLiIsInRpdGxlIjoiSW1wbGVtZW50IEIifQ->tr1.eyJib2R5IjoiQWxpY2UgY2hhbmdlZCBjb250cm9sbGVkIGRlbGl2ZXJ5IHRhc2sgQi4iLCJ0aXRsZSI6IkltcGxlbWVudCBjaGFuZ2VkIEIifQ",
    kind: "AliceTaskSpecificationEditAccepted",
    source: "Control"
  },
  { detail: 'run:issue-268-controlled:"fixture:issue-268"', kind: "JournalRecoveryReadCalled", source: "Journal" },
  {
    detail: "1|_tag=WorkflowRunBegan|initialControlPolicy.taskExecutionCapacity=3|initiatedBy._tag=DalphCoordinator",
    kind: "JournalRecoveryReadReturned",
    source: "Journal"
  },
  { detail: "graph._tag=GraphNotEstablished", kind: "DeliveryPublicationObserved", source: "Publication" },
  {
    detail: "acceptedAt=48|held=attempt:A:1,attempt:B:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=48|held=attempt:A:1,attempt:B:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=48|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=48|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTrackerGraph|operation.cause._tag=ExecutingWorkAuthorityCheck|operation.operationId=issue-268:run:issue-268-controlled:startup:19|operation.readShape._tag=CompleteTargetClosure",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "49|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTrackerGraph|operation.cause._tag=ExecutingWorkAuthorityCheck|operation.operationId=issue-268:run:issue-268-controlled:startup:19|operation.readShape._tag=CompleteTargetClosure",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=48|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268"', kind: "TrackerGraphReadCalled", source: "Tracker" },
  { detail: "G1", kind: "TrackerGraphReadReturned", source: "Tracker" },
  {
    detail:
      "50|_tag=TaskTrackerFactsObserved|observation._tag=CompleteTaskTrackerFacts|observation.factFamilies.0._tag=TaskIdentities|observation.factFamilies.0.contentIdentity=G1|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:19|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecycles|observation.factFamilies.1.contentIdentity=G1|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:19|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.1.lifecycles.0.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.0.taskId=A|observation.factFamilies.1.lifecycles.1.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.1.taskId=B|observation.factFamilies.1.lifecycles.2.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.2.taskId=C|observation.factFamilies.1.lifecycles.3.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.3.taskId=D|observation.factFamilies.1.lifecycles.4.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.4.taskId=E|observation.factFamilies.2._tag=TaskPrerequisites|observation.factFamilies.2.contentIdentity=G1|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:19|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.2.prerequisites.0.taskId=A|observation.factFamilies.2.prerequisites.1.taskId=B|observation.factFamilies.2.prerequisites.2.taskId=C|observation.factFamilies.2.prerequisites.3.taskId=D|observation.factFamilies.2.prerequisites.4.taskId=E|observation.factFamilies.3._tag=TaskGroupings|observation.factFamilies.3.contentIdentity=G1|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:19|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.3.groupings.0.taskId=A|observation.factFamilies.3.groupings.1.taskId=B|observation.factFamilies.3.groupings.2.taskId=C|observation.factFamilies.3.groupings.3.taskId=D|observation.factFamilies.3.groupings.4.taskId=E|observation.factFamilies.4._tag=TaskTargetMembership|observation.factFamilies.4.contentIdentity=G1|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:19|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:19|operationId=issue-268:run:issue-268-controlled:startup:19",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:19|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:19",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=50|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=50|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=50|held=attempt:A:1,attempt:B:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=50|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=50|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:startup:20|operation.taskId=A",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "51|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:startup:20|operation.taskId=A",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=50|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268":A', kind: "TaskWorkSpecificationReadCalled", source: "Tracker" },
  {
    detail: "A:tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBBLiIsInRpdGxlIjoiSW1wbGVtZW50IEEifQ",
    kind: "TaskWorkSpecificationReadReturned",
    source: "Tracker"
  },
  {
    detail:
      "52|_tag=TaskTrackerFactsObserved|observation._tag=FocusedTaskWorkSpecificationFacts|observation.factFamily._tag=TaskWorkSpecification|observation.factFamily.contentIdentity=tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBBLiIsInRpdGxlIjoiSW1wbGVtZW50IEEifQ|observation.factFamily.coverage._tag=ExactTaskWorkSpecification|observation.factFamily.coverage.taskId=A|observation.factFamily.freshness._tag=ObservedDuringLogicalRead|observation.factFamily.freshness.operationId=issue-268:run:issue-268-controlled:startup:20|observation.factFamily.taskId=A|observation.operationId=issue-268:run:issue-268-controlled:startup:20|operationId=issue-268:run:issue-268-controlled:startup:20",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=50|held=attempt:A:1,attempt:B:1,attempt:C:1|live=B:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:19|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:19",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=50|held=attempt:A:1,attempt:B:1,attempt:C:1|live=B:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "B:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:startup:21|operation.taskId=B",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "53|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:startup:21|operation.taskId=B",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail:
      "acceptedAt=50|held=attempt:A:1,attempt:B:1,attempt:C:1|live=B:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268":B', kind: "TaskWorkSpecificationReadCalled", source: "Tracker" },
  {
    detail:
      "B:tr1.eyJib2R5IjoiQWxpY2UgY2hhbmdlZCBjb250cm9sbGVkIGRlbGl2ZXJ5IHRhc2sgQi4iLCJ0aXRsZSI6IkltcGxlbWVudCBjaGFuZ2VkIEIifQ",
    kind: "TaskWorkSpecificationReadReturned",
    source: "Tracker"
  },
  {
    detail:
      "54|_tag=TaskTrackerFactsObserved|observation._tag=FocusedTaskWorkSpecificationFacts|observation.factFamily._tag=TaskWorkSpecification|observation.factFamily.contentIdentity=tr1.eyJib2R5IjoiQWxpY2UgY2hhbmdlZCBjb250cm9sbGVkIGRlbGl2ZXJ5IHRhc2sgQi4iLCJ0aXRsZSI6IkltcGxlbWVudCBjaGFuZ2VkIEIifQ|observation.factFamily.coverage._tag=ExactTaskWorkSpecification|observation.factFamily.coverage.taskId=B|observation.factFamily.freshness._tag=ObservedDuringLogicalRead|observation.factFamily.freshness.operationId=issue-268:run:issue-268-controlled:startup:21|observation.factFamily.taskId=B|observation.operationId=issue-268:run:issue-268-controlled:startup:21|operationId=issue-268:run:issue-268-controlled:startup:21",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "B:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=50|held=attempt:A:1,attempt:B:1,attempt:C:1|live=B:RecoveredNewActionRoute,C:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:19|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:19",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=50|held=attempt:A:1,attempt:B:1,attempt:C:1|live=B:RecoveredNewActionRoute,C:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "C:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:startup:22|operation.taskId=C",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "55|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:startup:22|operation.taskId=C",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail:
      "acceptedAt=50|held=attempt:A:1,attempt:B:1,attempt:C:1|live=B:RecoveredNewActionRoute,C:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268":C', kind: "TaskWorkSpecificationReadCalled", source: "Tracker" },
  {
    detail: "C:tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBDLiIsInRpdGxlIjoiSW1wbGVtZW50IEMifQ",
    kind: "TaskWorkSpecificationReadReturned",
    source: "Tracker"
  },
  {
    detail:
      "56|_tag=TaskTrackerFactsObserved|observation._tag=FocusedTaskWorkSpecificationFacts|observation.factFamily._tag=TaskWorkSpecification|observation.factFamily.contentIdentity=tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBDLiIsInRpdGxlIjoiSW1wbGVtZW50IEMifQ|observation.factFamily.coverage._tag=ExactTaskWorkSpecification|observation.factFamily.coverage.taskId=C|observation.factFamily.freshness._tag=ObservedDuringLogicalRead|observation.factFamily.freshness.operationId=issue-268:run:issue-268-controlled:startup:22|observation.factFamily.taskId=C|observation.operationId=issue-268:run:issue-268-controlled:startup:22|operationId=issue-268:run:issue-268-controlled:startup:22",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "C:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=52|held=attempt:A:1,attempt:B:1,attempt:C:1|live=B:RecoveredNewActionRoute,C:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=52|held=attempt:A:1,attempt:B:1,attempt:C:1|live=B:RecoveredNewActionRoute,C:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=52|held=attempt:A:1,attempt:B:1,attempt:C:1|live=B:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=52|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,B:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:19|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:19",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=52|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,B:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskClaim|operation.operationId=issue-268:run:issue-268-controlled:startup:23|operation.taskId=A",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "57|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTaskClaim|operation.operationId=issue-268:run:issue-268-controlled:startup:23|operation.taskId=A",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail:
      "acceptedAt=52|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,B:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A", kind: "TaskClaimReadCalled", source: "Tracker" },
  { detail: "A:ActiveTaskClaim", kind: "TaskClaimReadReturned", source: "Tracker" },
  {
    detail:
      "58|_tag=TaskTrackerFactsObserved|observation._tag=FocusedTaskClaimFacts|observation.coverage._tag=ExactTaskClaim|observation.coverage.taskId=A|observation.freshness._tag=ObservedDuringLogicalRead|observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:23|observation.observation._tag=ActiveTaskClaim|observation.observation.operationId=issue-268:run:issue-268-controlled:startup:4|observation.observation.taskId=A|observation.operationId=issue-268:run:issue-268-controlled:startup:23|operationId=issue-268:run:issue-268-controlled:startup:23",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=54|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,B:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=54|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,B:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=54|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=56|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=56|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=56|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=56|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:19|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:19",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=56|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "C:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskClaim|operation.operationId=issue-268:run:issue-268-controlled:startup:24|operation.taskId=C",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "59|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTaskClaim|operation.operationId=issue-268:run:issue-268-controlled:startup:24|operation.taskId=C",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail:
      "acceptedAt=56|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "C", kind: "TaskClaimReadCalled", source: "Tracker" },
  { detail: "C:ActiveTaskClaim", kind: "TaskClaimReadReturned", source: "Tracker" },
  {
    detail:
      "60|_tag=TaskTrackerFactsObserved|observation._tag=FocusedTaskClaimFacts|observation.coverage._tag=ExactTaskClaim|observation.coverage.taskId=C|observation.freshness._tag=ObservedDuringLogicalRead|observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:24|observation.observation._tag=ActiveTaskClaim|observation.observation.operationId=issue-268:run:issue-268-controlled:startup:6|observation.observation.taskId=C|observation.operationId=issue-268:run:issue-268-controlled:startup:24|operationId=issue-268:run:issue-268-controlled:startup:24",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "C:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=58|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=58|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=58|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=58|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:19|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:19",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=58|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:startup:25|operation.plannedAttempt.attemptId=attempt:A:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=A",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "61|_tag=GitReadIntentRecorded|initiatedBy._tag=DalphCoordinator|operation._tag=ReadTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:startup:25|operation.plannedAttempt.attemptId=attempt:A:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=A",
    kind: "GitReadIntentRecorded",
    source: "Journal"
  },
  {
    detail:
      "acceptedAt=58|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A:attempt:A:1", kind: "WorktreeReadCalled", source: "Git" },
  { detail: "A:attempt:A:1:PlannedWorktreeReady", kind: "WorktreeReadReturned", source: "Git" },
  {
    detail:
      "62|_tag=PlannedAttemptWorktreeObserved|observation._tag=PlannedWorktreeReady|operationId=issue-268:run:issue-268-controlled:startup:25",
    kind: "PlannedAttemptWorktreeObserved",
    source: "Journal"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=60|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=60|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=60|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=60|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:19|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:19",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=60|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "C:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:startup:26|operation.plannedAttempt.attemptId=attempt:C:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=C",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "63|_tag=GitReadIntentRecorded|initiatedBy._tag=DalphCoordinator|operation._tag=ReadTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:startup:26|operation.plannedAttempt.attemptId=attempt:C:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=C",
    kind: "GitReadIntentRecorded",
    source: "Journal"
  },
  {
    detail:
      "acceptedAt=60|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "C:attempt:C:1", kind: "WorktreeReadCalled", source: "Git" },
  { detail: "C:attempt:C:1:PlannedWorktreeReady", kind: "WorktreeReadReturned", source: "Git" },
  {
    detail:
      "64|_tag=PlannedAttemptWorktreeObserved|observation._tag=PlannedWorktreeReady|operationId=issue-268:run:issue-268-controlled:startup:26",
    kind: "PlannedAttemptWorktreeObserved",
    source: "Journal"
  },
  { detail: "C:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=62|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=62|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=62|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=62|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:19|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:19",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=62|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTargetLineage|operation.operationId=issue-268:run:issue-268-controlled:startup:27|operation.plannedAttempt.attemptId=attempt:A:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=A",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "65|_tag=GitReadIntentRecorded|initiatedBy._tag=DalphCoordinator|operation._tag=ReadTargetLineage|operation.operationId=issue-268:run:issue-268-controlled:startup:27|operation.plannedAttempt.attemptId=attempt:A:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=A",
    kind: "GitReadIntentRecorded",
    source: "Journal"
  },
  {
    detail:
      "acceptedAt=62|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      '1111111111111111111111111111111111111111:{"repository":"/dalph/controlled-characterization/issue-268.git","ref":"refs/heads/main"}',
    kind: "TargetLineageReadCalled",
    source: "Git"
  },
  {
    detail: "1111111111111111111111111111111111111111:1111111111111111111111111111111111111111",
    kind: "TargetLineageReadReturned",
    source: "Git"
  },
  {
    detail:
      "66|_tag=TargetLineageObserved|operationId=issue-268:run:issue-268-controlled:startup:27|plannedAttempt.attemptId=attempt:A:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=A",
    kind: "TargetLineageObserved",
    source: "Journal"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=64|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=64|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=64|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=64|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:19|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:19",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=64|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "C:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTargetLineage|operation.operationId=issue-268:run:issue-268-controlled:startup:28|operation.plannedAttempt.attemptId=attempt:C:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=C",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "67|_tag=GitReadIntentRecorded|initiatedBy._tag=DalphCoordinator|operation._tag=ReadTargetLineage|operation.operationId=issue-268:run:issue-268-controlled:startup:28|operation.plannedAttempt.attemptId=attempt:C:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=C",
    kind: "GitReadIntentRecorded",
    source: "Journal"
  },
  {
    detail:
      "acceptedAt=64|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      '1111111111111111111111111111111111111111:{"repository":"/dalph/controlled-characterization/issue-268.git","ref":"refs/heads/main"}',
    kind: "TargetLineageReadCalled",
    source: "Git"
  },
  {
    detail: "1111111111111111111111111111111111111111:1111111111111111111111111111111111111111",
    kind: "TargetLineageReadReturned",
    source: "Git"
  },
  {
    detail:
      "68|_tag=TargetLineageObserved|operationId=issue-268:run:issue-268-controlled:startup:28|plannedAttempt.attemptId=attempt:C:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=C",
    kind: "TargetLineageObserved",
    source: "Journal"
  },
  { detail: "C:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=66|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=66|held=attempt:A:1,attempt:B:1,attempt:C:1|live=A:RecoveredNewActionRoute,C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=66|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:19|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:19",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=68|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=68|held=attempt:A:1,attempt:B:1,attempt:C:1|live=C:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=68|held=attempt:A:1,attempt:B:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=68|held=attempt:A:1,attempt:B:1,attempt:C:1|live=B:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "B:B:Existing:SuspendPlannedAttemptExecutorWork",
    kind: "TaskWorkPositionAdmissionBound",
    source: "Publication"
  },
  {
    detail: "acceptedAt=68|held=attempt:A:1,attempt:B:1,attempt:C:1|live=B:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "B:SuspendPlannedAttemptExecutorWork", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "69|_tag=PlannedAttemptExecutorCommandIntended|command=Suspend|initiatedBy._tag=DalphCoordinator|ordinal=2|plannedAttempt.attemptId=attempt:B:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=B",
    kind: "PlannedAttemptExecutorCommandIntended",
    source: "Journal"
  },
  { detail: "attempt:B:1", kind: "ExecutorSuspendCalled", source: "Executor" },
  { detail: "attempt:B:1:ExecutorWorkExecuting", kind: "ExecutorSuspendReturned", source: "Executor" },
  {
    detail:
      "70|_tag=PlannedAttemptExecutorCommandResponseObserved|plannedAttempt.attemptId=attempt:B:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=B|report._tag=ExecutorWorkExecuting|report.correlation.attemptId=attempt:B:1|report.correlation.runId=run:issue-268-controlled",
    kind: "PlannedAttemptExecutorCommandResponseObserved",
    source: "Journal"
  },
  { detail: "B:SuspendPlannedAttemptExecutorWork", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:19|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:19",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  { detail: "attempt:B:1:ExecutorWorkSafelySuspended", kind: "ExecutorSafeReportReady", source: "Control" },
  {
    detail: "acceptedAt=70|held=attempt:A:1,attempt:B:1,attempt:C:1|live=B:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "71|_tag=PlannedAttemptExecutorStateObserved|observation._tag=ExactExecutorReport|observation.report._tag=ExecutorWorkSafelySuspended|observation.report.correlation.attemptId=attempt:B:1|observation.report.correlation.runId=run:issue-268-controlled|ordinal=1|plannedAttempt.attemptId=attempt:B:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=B",
    kind: "PlannedAttemptExecutorStateObserved",
    source: "Journal"
  },
  {
    detail:
      "72|_tag=PlannedAttemptExecutorWorkReported|ordinal=2|report._tag=ExecutorWorkSafelySuspended|report.correlation.attemptId=attempt:B:1|report.correlation.runId=run:issue-268-controlled",
    kind: "PlannedAttemptExecutorWorkReported",
    source: "Journal"
  },
  {
    detail: "acceptedAt=70|held=attempt:A:1,attempt:B:1,attempt:C:1|live=B:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=70|held=attempt:A:1,attempt:B:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=70|held=attempt:A:1,attempt:B:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTrackerGraph|operation.cause._tag=PostQuiescenceReconfirmation|operation.operationId=issue-268:run:issue-268-controlled:startup:29|operation.readShape._tag=CompleteTargetClosure",
    kind: "OperationSelected",
    source: "Trace"
  },
  { detail: "issue-268:run:issue-268-controlled:startup:19", kind: "PostQuiescenceWitnessObserved", source: "Control" },
  {
    detail:
      "73|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTrackerGraph|operation.cause._tag=PostQuiescenceReconfirmation|operation.operationId=issue-268:run:issue-268-controlled:startup:29|operation.readShape._tag=CompleteTargetClosure",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  { detail: '"fixture:issue-268"', kind: "TrackerGraphReadCalled", source: "Tracker" },
  { detail: "G1", kind: "TrackerGraphReadReturned", source: "Tracker" },
  {
    detail:
      "74|_tag=TaskTrackerFactsObserved|observation._tag=UnchangedTaskTrackerFactsReconfirmed|observation.factFamilies.0._tag=TaskIdentitiesReconfirmed|observation.factFamilies.0.contentIdentity=G1|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:29|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecyclesReconfirmed|observation.factFamilies.1.contentIdentity=G1|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:29|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.2._tag=TaskPrerequisitesReconfirmed|observation.factFamilies.2.contentIdentity=G1|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:29|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.3._tag=TaskGroupingsReconfirmed|observation.factFamilies.3.contentIdentity=G1|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:29|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.4._tag=TaskTargetMembershipReconfirmed|observation.factFamilies.4.contentIdentity=G1|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:29|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:29|operationId=issue-268:run:issue-268-controlled:startup:29",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskTrackerFactsObserved|operation._tag=ReadTrackerGraph|operation.cause._tag=PostQuiescenceReconfirmation|operation.operationId=issue-268:run:issue-268-controlled:startup:29|operation.readShape._tag=CompleteTargetClosure|observation._tag=CompleteTaskTrackerFacts|observation.factFamilies.0._tag=TaskIdentities|observation.factFamilies.0.contentIdentity=G1|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:29|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecycles|observation.factFamilies.1.contentIdentity=G1|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:29|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.1.lifecycles.0.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.0.taskId=A|observation.factFamilies.1.lifecycles.1.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.1.taskId=B|observation.factFamilies.1.lifecycles.2.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.2.taskId=C|observation.factFamilies.1.lifecycles.3.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.3.taskId=D|observation.factFamilies.1.lifecycles.4.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.4.taskId=E|observation.factFamilies.2._tag=TaskPrerequisites|observation.factFamilies.2.contentIdentity=G1|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:29|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.2.prerequisites.0.taskId=A|observation.factFamilies.2.prerequisites.1.taskId=B|observation.factFamilies.2.prerequisites.2.taskId=C|observation.factFamilies.2.prerequisites.3.taskId=D|observation.factFamilies.2.prerequisites.4.taskId=E|observation.factFamilies.3._tag=TaskGroupings|observation.factFamilies.3.contentIdentity=G1|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:29|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.3.groupings.0.taskId=A|observation.factFamilies.3.groupings.1.taskId=B|observation.factFamilies.3.groupings.2.taskId=C|observation.factFamilies.3.groupings.3.taskId=D|observation.factFamilies.3.groupings.4.taskId=E|observation.factFamilies.4._tag=TaskTargetMembership|observation.factFamilies.4.contentIdentity=G1|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:29|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:29",
    kind: "TaskTrackerFactsObserved",
    source: "Trace"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=PostQuiescenceReconfirmation|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:29|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:29",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=74|held=attempt:A:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "attempt:B:1", kind: "TaskWorkPositionReleased", source: "Publication" },
  {
    detail: "acceptedAt=74|held=attempt:A:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=74|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "D:D:ReserveOrReuse:FreshWorkflowRoute", kind: "TaskWorkPositionAdmissionBound", source: "Publication" },
  {
    detail: "acceptedAt=74|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ReadCurrentTaskGraph:D", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:30|operation.readShape._tag=CompleteTargetClosure",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "75|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:30|operation.readShape._tag=CompleteTargetClosure",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=74|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268"', kind: "TrackerGraphReadCalled", source: "Tracker" },
  { detail: "G1", kind: "TrackerGraphReadReturned", source: "Tracker" },
  {
    detail:
      "76|_tag=TaskTrackerFactsObserved|observation._tag=UnchangedTaskTrackerFactsReconfirmed|observation.factFamilies.0._tag=TaskIdentitiesReconfirmed|observation.factFamilies.0.contentIdentity=G1|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:30|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecyclesReconfirmed|observation.factFamilies.1.contentIdentity=G1|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:30|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.2._tag=TaskPrerequisitesReconfirmed|observation.factFamilies.2.contentIdentity=G1|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:30|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.3._tag=TaskGroupingsReconfirmed|observation.factFamilies.3.contentIdentity=G1|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:30|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.4._tag=TaskTargetMembershipReconfirmed|observation.factFamilies.4.contentIdentity=G1|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:30|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:30|operationId=issue-268:run:issue-268-controlled:startup:30",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskTrackerFactsObserved|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:30|operation.readShape._tag=CompleteTargetClosure|observation._tag=CompleteTaskTrackerFacts|observation.factFamilies.0._tag=TaskIdentities|observation.factFamilies.0.contentIdentity=G1|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:30|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecycles|observation.factFamilies.1.contentIdentity=G1|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:30|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.1.lifecycles.0.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.0.taskId=A|observation.factFamilies.1.lifecycles.1.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.1.taskId=B|observation.factFamilies.1.lifecycles.2.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.2.taskId=C|observation.factFamilies.1.lifecycles.3.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.3.taskId=D|observation.factFamilies.1.lifecycles.4.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.4.taskId=E|observation.factFamilies.2._tag=TaskPrerequisites|observation.factFamilies.2.contentIdentity=G1|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:30|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.2.prerequisites.0.taskId=A|observation.factFamilies.2.prerequisites.1.taskId=B|observation.factFamilies.2.prerequisites.2.taskId=C|observation.factFamilies.2.prerequisites.3.taskId=D|observation.factFamilies.2.prerequisites.4.taskId=E|observation.factFamilies.3._tag=TaskGroupings|observation.factFamilies.3.contentIdentity=G1|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:30|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.3.groupings.0.taskId=A|observation.factFamilies.3.groupings.1.taskId=B|observation.factFamilies.3.groupings.2.taskId=C|observation.factFamilies.3.groupings.3.taskId=D|observation.factFamilies.3.groupings.4.taskId=E|observation.factFamilies.4._tag=TaskTargetMembership|observation.factFamilies.4.contentIdentity=G1|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:30|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:30",
    kind: "TaskTrackerFactsObserved",
    source: "Trace"
  },
  { detail: "ReadCurrentTaskGraph:D", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:30|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:30",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=76|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=76|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=76|held=attempt:A:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=76|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "D:D:ReserveOrReuse:FreshWorkflowRoute", kind: "TaskWorkPositionAdmissionBound", source: "Publication" },
  {
    detail: "acceptedAt=76|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "AcquireTaskClaim:D", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=AcquireTaskClaim|operation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:31|operation.acquisition.taskId=D|operation.authority._tag=TaskSelectionAuthority",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "_tag=TaskClaimAcquisitionIntended|operation._tag=AcquireTaskClaim|operation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:31|operation.acquisition.taskId=D|operation.authority._tag=TaskSelectionAuthority",
    kind: "TaskClaimAcquisitionIntended",
    source: "Trace"
  },
  {
    detail:
      "77|_tag=TaskClaimAcquisitionIntended|operation._tag=AcquireTaskClaim|operation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:31|operation.acquisition.taskId=D|operation.authority._tag=TaskSelectionAuthority",
    kind: "TaskClaimAcquisitionIntended",
    source: "Journal"
  },
  {
    detail: "acceptedAt=76|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "D", kind: "TaskClaimReadCalled", source: "Tracker" },
  { detail: "D:UnclaimedTask", kind: "TaskClaimReadReturned", source: "Tracker" },
  { detail: "D:issue-268:run:issue-268-controlled:startup:31", kind: "TaskClaimAcquireCalled", source: "Tracker" },
  { detail: "D:issue-268:run:issue-268-controlled:startup:31", kind: "TaskClaimAcquireReturned", source: "Tracker" },
  { detail: "D", kind: "TaskClaimReadCalled", source: "Tracker" },
  { detail: "D:ActiveTaskClaim", kind: "TaskClaimReadReturned", source: "Tracker" },
  {
    detail:
      "78|_tag=TaskClaimAcquired|claim._tag=ActiveTaskClaim|claim.operationId=issue-268:run:issue-268-controlled:startup:31|claim.taskId=D",
    kind: "TaskClaimAcquired",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskClaimAcquired|claim._tag=ActiveTaskClaim|claim.operationId=issue-268:run:issue-268-controlled:startup:31|claim.taskId=D|operation._tag=AcquireTaskClaim|operation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:31|operation.acquisition.taskId=D|operation.authority._tag=TaskSelectionAuthority",
    kind: "TaskClaimAcquired",
    source: "Trace"
  },
  { detail: "AcquireTaskClaim:D", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:30|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:30",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=78|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=78|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=78|held=attempt:A:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=78|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=78|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ReadPostClaimGraph:D", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:32|operation.readShape._tag=CompleteTargetClosure",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "79|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:32|operation.readShape._tag=CompleteTargetClosure",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=78|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268"', kind: "TrackerGraphReadCalled", source: "Tracker" },
  { detail: "G1", kind: "TrackerGraphReadReturned", source: "Tracker" },
  {
    detail:
      "80|_tag=TaskTrackerFactsObserved|observation._tag=UnchangedTaskTrackerFactsReconfirmed|observation.factFamilies.0._tag=TaskIdentitiesReconfirmed|observation.factFamilies.0.contentIdentity=G1|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:32|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecyclesReconfirmed|observation.factFamilies.1.contentIdentity=G1|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:32|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.2._tag=TaskPrerequisitesReconfirmed|observation.factFamilies.2.contentIdentity=G1|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:32|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.3._tag=TaskGroupingsReconfirmed|observation.factFamilies.3.contentIdentity=G1|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:32|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.4._tag=TaskTargetMembershipReconfirmed|observation.factFamilies.4.contentIdentity=G1|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:32|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:32|operationId=issue-268:run:issue-268-controlled:startup:32",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskTrackerFactsObserved|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:startup:32|operation.readShape._tag=CompleteTargetClosure|observation._tag=CompleteTaskTrackerFacts|observation.factFamilies.0._tag=TaskIdentities|observation.factFamilies.0.contentIdentity=G1|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:startup:32|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecycles|observation.factFamilies.1.contentIdentity=G1|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:startup:32|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.1.lifecycles.0.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.0.taskId=A|observation.factFamilies.1.lifecycles.1.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.1.taskId=B|observation.factFamilies.1.lifecycles.2.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.2.taskId=C|observation.factFamilies.1.lifecycles.3.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.3.taskId=D|observation.factFamilies.1.lifecycles.4.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.4.taskId=E|observation.factFamilies.2._tag=TaskPrerequisites|observation.factFamilies.2.contentIdentity=G1|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:startup:32|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.2.prerequisites.0.taskId=A|observation.factFamilies.2.prerequisites.1.taskId=B|observation.factFamilies.2.prerequisites.2.taskId=C|observation.factFamilies.2.prerequisites.3.taskId=D|observation.factFamilies.2.prerequisites.4.taskId=E|observation.factFamilies.3._tag=TaskGroupings|observation.factFamilies.3.contentIdentity=G1|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:startup:32|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.3.groupings.0.taskId=A|observation.factFamilies.3.groupings.1.taskId=B|observation.factFamilies.3.groupings.2.taskId=C|observation.factFamilies.3.groupings.3.taskId=D|observation.factFamilies.3.groupings.4.taskId=E|observation.factFamilies.4._tag=TaskTargetMembership|observation.factFamilies.4.contentIdentity=G1|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:startup:32|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:startup:32",
    kind: "TaskTrackerFactsObserved",
    source: "Trace"
  },
  {
    detail:
      "_tag=TrackerExecutionAdmitted|claimOperation._tag=AcquireTaskClaim|claimOperation.acquisition.operationId=issue-268:run:issue-268-controlled:startup:31|claimOperation.acquisition.taskId=D|claimOperation.authority._tag=TaskSelectionAuthority|observationOperation._tag=ReadTrackerGraph|observationOperation.cause._tag=WorkflowEstablishment|observationOperation.operationId=issue-268:run:issue-268-controlled:startup:32|observationOperation.readShape._tag=CompleteTargetClosure",
    kind: "TrackerExecutionAdmitted",
    source: "Trace"
  },
  { detail: "ReadPostClaimGraph:D", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:32|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:32",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=80|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=80|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=80|held=attempt:A:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=80|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=80|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ReadTaskWorkSpecification:D", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:startup:33|operation.taskId=D",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "81|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:startup:33|operation.taskId=D",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=80|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268":D', kind: "TaskWorkSpecificationReadCalled", source: "Tracker" },
  {
    detail: "D:tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBELiIsInRpdGxlIjoiSW1wbGVtZW50IEQifQ",
    kind: "TaskWorkSpecificationReadReturned",
    source: "Tracker"
  },
  {
    detail:
      "82|_tag=TaskTrackerFactsObserved|observation._tag=FocusedTaskWorkSpecificationFacts|observation.factFamily._tag=TaskWorkSpecification|observation.factFamily.contentIdentity=tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBELiIsInRpdGxlIjoiSW1wbGVtZW50IEQifQ|observation.factFamily.coverage._tag=ExactTaskWorkSpecification|observation.factFamily.coverage.taskId=D|observation.factFamily.freshness._tag=ObservedDuringLogicalRead|observation.factFamily.freshness.operationId=issue-268:run:issue-268-controlled:startup:33|observation.factFamily.taskId=D|observation.operationId=issue-268:run:issue-268-controlled:startup:33|operationId=issue-268:run:issue-268-controlled:startup:33",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "ReadTaskWorkSpecification:D", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:32|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:32",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=82|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=82|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=82|held=attempt:A:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=82|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=82|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "RecordTaskAttemptPlan:D", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=RecordTaskAttemptPlan|operation.operationId=issue-268:run:issue-268-controlled:startup:34|operation.plannedAttempt.attemptId=attempt:D:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=D",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "83|_tag=TaskAttemptPlanned|operation._tag=RecordTaskAttemptPlan|operation.operationId=issue-268:run:issue-268-controlled:startup:34|operation.plannedAttempt.attemptId=attempt:D:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=D",
    kind: "TaskAttemptPlanned",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskAttemptPlanAcknowledged|operation._tag=RecordTaskAttemptPlan|operation.operationId=issue-268:run:issue-268-controlled:startup:34|operation.plannedAttempt.attemptId=attempt:D:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=D",
    kind: "TaskAttemptPlanAcknowledged",
    source: "Trace"
  },
  { detail: "RecordTaskAttemptPlan:D", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:32|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:32",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=83|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=83|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=83|held=attempt:A:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=83|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=83|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ReconcileTaskWorktree:D", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReconcileTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:startup:35|operation.plannedAttempt.attemptId=attempt:D:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=D",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "84|_tag=TaskWorktreeReconciliationIntended|operation._tag=ReconcileTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:startup:35|operation.plannedAttempt.attemptId=attempt:D:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=D",
    kind: "TaskWorktreeReconciliationIntended",
    source: "Journal"
  },
  {
    detail: "acceptedAt=83|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "D:attempt:D:1", kind: "WorktreeReadCalled", source: "Git" },
  { detail: "D:attempt:D:1:PlannedWorktreeAbsent", kind: "WorktreeReadReturned", source: "Git" },
  { detail: "D:attempt:D:1", kind: "WorktreeCreateCalled", source: "Git" },
  { detail: "D:attempt:D:1", kind: "WorktreeCreateReturned", source: "Git" },
  { detail: "D:attempt:D:1", kind: "WorktreeReadCalled", source: "Git" },
  { detail: "D:attempt:D:1:PlannedWorktreeReady", kind: "WorktreeReadReturned", source: "Git" },
  {
    detail:
      "85|_tag=TaskWorktreeReady|operationId=issue-268:run:issue-268-controlled:startup:35|proof._tag=PlannedWorktreeReady",
    kind: "TaskWorktreeReady",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskWorktreeReady|operation._tag=ReconcileTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:startup:35|operation.plannedAttempt.attemptId=attempt:D:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=D|proof._tag=PlannedWorktreeReady",
    kind: "TaskWorktreeReady",
    source: "Trace"
  },
  { detail: "ReconcileTaskWorktree:D", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:32|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:32",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=85|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=85|held=attempt:A:1,attempt:C:1|live=D:FreshWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=85|held=attempt:A:1,attempt:C:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=85|held=attempt:A:1,attempt:C:1|live=D:FreshExecutorWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "D:D:ReserveOrReuse:FreshExecutorWorkflowRoute",
    kind: "TaskWorkPositionAdmissionBound",
    source: "Publication"
  },
  {
    detail: "acceptedAt=85|held=attempt:A:1,attempt:C:1|live=D:FreshExecutorWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "BeginPlannedAttemptExecutorWork:D", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "86|_tag=PlannedAttemptExecutorWorkResponsibilityBegan|plannedAttempt.attemptId=attempt:D:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=D",
    kind: "PlannedAttemptExecutorWorkResponsibilityBegan",
    source: "Journal"
  },
  {
    detail:
      "87|_tag=PlannedAttemptExecutorCommandIntended|command=Begin|initiatedBy._tag=DalphCoordinator|ordinal=1|plannedAttempt.attemptId=attempt:D:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=D",
    kind: "PlannedAttemptExecutorCommandIntended",
    source: "Journal"
  },
  { detail: "attempt:D:1", kind: "ExecutorBeginCalled", source: "Executor" },
  { detail: "attempt:D:1:ExecutorWorkExecuting", kind: "ExecutorBeginReturned", source: "Executor" },
  {
    detail:
      "88|_tag=PlannedAttemptExecutorCommandResponseObserved|plannedAttempt.attemptId=attempt:D:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=D|report._tag=ExecutorWorkExecuting|report.correlation.attemptId=attempt:D:1|report.correlation.runId=run:issue-268-controlled",
    kind: "PlannedAttemptExecutorCommandResponseObserved",
    source: "Journal"
  },
  {
    detail:
      "89|_tag=PlannedAttemptExecutorWorkReported|ordinal=1|report._tag=ExecutorWorkExecuting|report.correlation.attemptId=attempt:D:1|report.correlation.runId=run:issue-268-controlled",
    kind: "PlannedAttemptExecutorWorkReported",
    source: "Journal"
  },
  { detail: "attempt:D:1:PassiveLifecycleObservation", kind: "ExecutorObserveCalled", source: "Executor" },
  { detail: "attempt:D:1:Exact", kind: "ExecutorObserveReturned", source: "Executor" },
  { detail: "BeginPlannedAttemptExecutorWork:D", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:32|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:32",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  { detail: "2", kind: "OperatorCapacityChangeCalled", source: "Control" },
  {
    detail: "90|_tag=TaskWorkCapacityChanged|capacity=2|initiatedBy._tag=Operator|revision=2",
    kind: "TaskWorkCapacityChanged",
    source: "Journal"
  },
  { detail: "2:2", kind: "OperatorCapacityChangeReturned", source: "Control" },
  {
    detail: "acceptedAt=89|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:FreshExecutorWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "attempt:D:1", kind: "TaskWorkPositionBound", source: "Publication" },
  {
    detail: "acceptedAt=89|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:FreshExecutorWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=89|held=attempt:A:1,attempt:C:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=89|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:FreshExecutorWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "D:D:ReserveOrReuse:FreshExecutorWorkflowRoute",
    kind: "TaskWorkPositionAdmissionBound",
    source: "Publication"
  },
  {
    detail: "acceptedAt=89|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:FreshExecutorWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "ObservePlannedAttemptExecutorWork:D", kind: "DeliveryActionExecuting", source: "Action" },
  { detail: "ObservePlannedAttemptExecutorWork:D", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:32|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:32",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=89|held=attempt:A:1,attempt:C:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:startup:32|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:startup:32",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  { detail: "DS08", kind: "CoordinatorProcessLoss", source: "Control" },
  { detail: 'run:issue-268-controlled:"fixture:issue-268"', kind: "JournalRecoveryReadCalled", source: "Journal" },
  {
    detail: "1|_tag=WorkflowRunBegan|initialControlPolicy.taskExecutionCapacity=3|initiatedBy._tag=DalphCoordinator",
    kind: "JournalRecoveryReadReturned",
    source: "Journal"
  },
  { detail: "graph._tag=GraphNotEstablished", kind: "DeliveryPublicationObserved", source: "Publication" },
  {
    detail: "acceptedAt=90|held=attempt:A:1,attempt:C:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "attempt:A:1", kind: "TaskWorkPositionBound", source: "Publication" },
  { detail: "attempt:C:1", kind: "TaskWorkPositionBound", source: "Publication" },
  { detail: "attempt:D:1", kind: "TaskWorkPositionBound", source: "Publication" },
  {
    detail: "acceptedAt=90|held=attempt:A:1,attempt:C:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=90|held=attempt:A:1,attempt:C:1,attempt:D:1|live=Run:TrackerGraphReadRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=90|held=attempt:A:1,attempt:C:1,attempt:D:1|live=Run:TrackerGraphReadRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "Run:TrackerGraphReadRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:restart:0|operation.readShape._tag=CompleteTargetClosure",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "91|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:restart:0|operation.readShape._tag=CompleteTargetClosure",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=90|held=attempt:A:1,attempt:C:1,attempt:D:1|live=Run:TrackerGraphReadRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268"', kind: "TrackerGraphReadCalled", source: "Tracker" },
  { detail: "G1", kind: "TrackerGraphReadReturned", source: "Tracker" },
  {
    detail:
      "92|_tag=TaskTrackerFactsObserved|observation._tag=UnchangedTaskTrackerFactsReconfirmed|observation.factFamilies.0._tag=TaskIdentitiesReconfirmed|observation.factFamilies.0.contentIdentity=G1|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:restart:0|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecyclesReconfirmed|observation.factFamilies.1.contentIdentity=G1|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:restart:0|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.2._tag=TaskPrerequisitesReconfirmed|observation.factFamilies.2.contentIdentity=G1|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:restart:0|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.3._tag=TaskGroupingsReconfirmed|observation.factFamilies.3.contentIdentity=G1|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:restart:0|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.4._tag=TaskTargetMembershipReconfirmed|observation.factFamilies.4.contentIdentity=G1|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:restart:0|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:restart:0|operationId=issue-268:run:issue-268-controlled:restart:0",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskTrackerFactsObserved|operation._tag=ReadTrackerGraph|operation.cause._tag=WorkflowEstablishment|operation.operationId=issue-268:run:issue-268-controlled:restart:0|operation.readShape._tag=CompleteTargetClosure|observation._tag=CompleteTaskTrackerFacts|observation.factFamilies.0._tag=TaskIdentities|observation.factFamilies.0.contentIdentity=G1|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:restart:0|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecycles|observation.factFamilies.1.contentIdentity=G1|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:restart:0|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.1.lifecycles.0.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.0.taskId=A|observation.factFamilies.1.lifecycles.1.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.1.taskId=B|observation.factFamilies.1.lifecycles.2.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.2.taskId=C|observation.factFamilies.1.lifecycles.3.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.3.taskId=D|observation.factFamilies.1.lifecycles.4.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.4.taskId=E|observation.factFamilies.2._tag=TaskPrerequisites|observation.factFamilies.2.contentIdentity=G1|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:restart:0|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.2.prerequisites.0.taskId=A|observation.factFamilies.2.prerequisites.1.taskId=B|observation.factFamilies.2.prerequisites.2.taskId=C|observation.factFamilies.2.prerequisites.3.taskId=D|observation.factFamilies.2.prerequisites.4.taskId=E|observation.factFamilies.3._tag=TaskGroupings|observation.factFamilies.3.contentIdentity=G1|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:restart:0|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.3.groupings.0.taskId=A|observation.factFamilies.3.groupings.1.taskId=B|observation.factFamilies.3.groupings.2.taskId=C|observation.factFamilies.3.groupings.3.taskId=D|observation.factFamilies.3.groupings.4.taskId=E|observation.factFamilies.4._tag=TaskTargetMembership|observation.factFamilies.4.contentIdentity=G1|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:restart:0|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:restart:0",
    kind: "TaskTrackerFactsObserved",
    source: "Trace"
  },
  { detail: "Run:TrackerGraphReadRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:0|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:0",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=Run:TrackerGraphReadRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=Run:TrackerGraphReadRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "A:A:ReserveOrReuse:ObservePlannedAttemptExecutorWork",
    kind: "TaskWorkPositionAdmissionBound",
    source: "Publication"
  },
  {
    detail: "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A:ObservePlannedAttemptExecutorWork", kind: "DeliveryActionExecuting", source: "Action" },
  { detail: "attempt:A:1:PassiveLifecycleObservation", kind: "ExecutorObserveCalled", source: "Executor" },
  {
    detail:
      "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:IdentityFreeWorkflowRoute,C:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "C:C:ReserveOrReuse:ObservePlannedAttemptExecutorWork",
    kind: "TaskWorkPositionAdmissionBound",
    source: "Publication"
  },
  { detail: "attempt:A:1:Exact", kind: "ExecutorObserveReturned", source: "Executor" },
  { detail: "A:ObservePlannedAttemptExecutorWork", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:IdentityFreeWorkflowRoute,C:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "C:ObservePlannedAttemptExecutorWork", kind: "DeliveryActionExecuting", source: "Action" },
  { detail: "attempt:C:1:PassiveLifecycleObservation", kind: "ExecutorObserveCalled", source: "Executor" },
  {
    detail:
      "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:IdentityFreeWorkflowRoute,C:IdentityFreeWorkflowRoute,D:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "D:D:ReserveOrReuse:ObservePlannedAttemptExecutorWork",
    kind: "TaskWorkPositionAdmissionBound",
    source: "Publication"
  },
  { detail: "attempt:C:1:Exact", kind: "ExecutorObserveReturned", source: "Executor" },
  { detail: "C:ObservePlannedAttemptExecutorWork", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:IdentityFreeWorkflowRoute,C:IdentityFreeWorkflowRoute,D:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "D:ObservePlannedAttemptExecutorWork", kind: "DeliveryActionExecuting", source: "Action" },
  { detail: "attempt:D:1:PassiveLifecycleObservation", kind: "ExecutorObserveCalled", source: "Executor" },
  {
    detail:
      "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:IdentityFreeWorkflowRoute,C:IdentityFreeWorkflowRoute,D:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=C:IdentityFreeWorkflowRoute,D:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=C:IdentityFreeWorkflowRoute,D:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "attempt:D:1:Exact", kind: "ExecutorObserveReturned", source: "Executor" },
  { detail: "D:ObservePlannedAttemptExecutorWork", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail: "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=WorkflowEstablishment|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G1|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:0|graph.observation.contentIdentity=G1|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:0",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  { detail: "RunMustRemainActive", kind: "OrdinaryActivationReturned", source: "Control" },
  { detail: "C:G2", kind: "AliceTaskClosure", source: "Control" },
  { detail: "C:G2", kind: "TrackerNotificationDelivered", source: "Control" },
  { detail: "TrackerNotification", kind: "ActiveRefreshStarted", source: "Control" },
  { detail: 'run:issue-268-controlled:"fixture:issue-268"', kind: "JournalRecoveryReadCalled", source: "Journal" },
  {
    detail: "1|_tag=WorkflowRunBegan|initialControlPolicy.taskExecutionCapacity=3|initiatedBy._tag=DalphCoordinator",
    kind: "JournalRecoveryReadReturned",
    source: "Journal"
  },
  { detail: "graph._tag=GraphNotEstablished", kind: "DeliveryPublicationObserved", source: "Publication" },
  {
    detail: "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTrackerGraph|operation.cause._tag=ExecutingWorkAuthorityCheck|operation.operationId=issue-268:run:issue-268-controlled:restart:1|operation.readShape._tag=CompleteTargetClosure",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "93|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTrackerGraph|operation.cause._tag=ExecutingWorkAuthorityCheck|operation.operationId=issue-268:run:issue-268-controlled:restart:1|operation.readShape._tag=CompleteTargetClosure",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=92|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268"', kind: "TrackerGraphReadCalled", source: "Tracker" },
  { detail: "G2", kind: "TrackerGraphReadReturned", source: "Tracker" },
  {
    detail:
      "94|_tag=TaskTrackerFactsObserved|observation._tag=CompleteTaskTrackerFacts|observation.factFamilies.0._tag=TaskIdentities|observation.factFamilies.0.contentIdentity=G2|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:restart:1|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecycles|observation.factFamilies.1.contentIdentity=G2|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:restart:1|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.1.lifecycles.0.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.0.taskId=A|observation.factFamilies.1.lifecycles.1.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.1.taskId=B|observation.factFamilies.1.lifecycles.2.lifecycle._tag=TerminalWithoutSuccess|observation.factFamilies.1.lifecycles.2.taskId=C|observation.factFamilies.1.lifecycles.3.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.3.taskId=D|observation.factFamilies.1.lifecycles.4.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.4.taskId=E|observation.factFamilies.2._tag=TaskPrerequisites|observation.factFamilies.2.contentIdentity=G2|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:restart:1|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.2.prerequisites.0.taskId=A|observation.factFamilies.2.prerequisites.1.taskId=B|observation.factFamilies.2.prerequisites.2.taskId=C|observation.factFamilies.2.prerequisites.3.taskId=D|observation.factFamilies.2.prerequisites.4.taskId=E|observation.factFamilies.3._tag=TaskGroupings|observation.factFamilies.3.contentIdentity=G2|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:restart:1|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.3.groupings.0.taskId=A|observation.factFamilies.3.groupings.1.taskId=B|observation.factFamilies.3.groupings.2.taskId=C|observation.factFamilies.3.groupings.3.taskId=D|observation.factFamilies.3.groupings.4.taskId=E|observation.factFamilies.4._tag=TaskTargetMembership|observation.factFamilies.4.contentIdentity=G2|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:restart:1|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:restart:1|operationId=issue-268:run:issue-268-controlled:restart:1",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:1|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:1",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=94|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=94|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=94|held=attempt:A:1,attempt:C:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=94|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=94|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:restart:2|operation.taskId=A",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "95|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:restart:2|operation.taskId=A",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=94|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268":A', kind: "TaskWorkSpecificationReadCalled", source: "Tracker" },
  {
    detail: "A:tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBBLiIsInRpdGxlIjoiSW1wbGVtZW50IEEifQ",
    kind: "TaskWorkSpecificationReadReturned",
    source: "Tracker"
  },
  {
    detail:
      "96|_tag=TaskTrackerFactsObserved|observation._tag=FocusedTaskWorkSpecificationFacts|observation.factFamily._tag=TaskWorkSpecification|observation.factFamily.contentIdentity=tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBBLiIsInRpdGxlIjoiSW1wbGVtZW50IEEifQ|observation.factFamily.coverage._tag=ExactTaskWorkSpecification|observation.factFamily.coverage.taskId=A|observation.factFamily.freshness._tag=ObservedDuringLogicalRead|observation.factFamily.freshness.operationId=issue-268:run:issue-268-controlled:restart:2|observation.factFamily.taskId=A|observation.operationId=issue-268:run:issue-268-controlled:restart:2|operationId=issue-268:run:issue-268-controlled:restart:2",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=94|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:1|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:1",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=94|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "D:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:restart:3|operation.taskId=D",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "97|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:restart:3|operation.taskId=D",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail:
      "acceptedAt=94|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268":D', kind: "TaskWorkSpecificationReadCalled", source: "Tracker" },
  {
    detail: "D:tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBELiIsInRpdGxlIjoiSW1wbGVtZW50IEQifQ",
    kind: "TaskWorkSpecificationReadReturned",
    source: "Tracker"
  },
  {
    detail:
      "98|_tag=TaskTrackerFactsObserved|observation._tag=FocusedTaskWorkSpecificationFacts|observation.factFamily._tag=TaskWorkSpecification|observation.factFamily.contentIdentity=tr1.eyJib2R5IjoiSW1wbGVtZW50IGNvbnRyb2xsZWQgZGVsaXZlcnkgdGFzayBELiIsInRpdGxlIjoiSW1wbGVtZW50IEQifQ|observation.factFamily.coverage._tag=ExactTaskWorkSpecification|observation.factFamily.coverage.taskId=D|observation.factFamily.freshness._tag=ObservedDuringLogicalRead|observation.factFamily.freshness.operationId=issue-268:run:issue-268-controlled:restart:3|observation.factFamily.taskId=D|observation.operationId=issue-268:run:issue-268-controlled:restart:3|operationId=issue-268:run:issue-268-controlled:restart:3",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "D:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=96|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=96|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=96|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=96|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:1|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:1",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=96|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskClaim|operation.operationId=issue-268:run:issue-268-controlled:restart:4|operation.taskId=A",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "99|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTaskClaim|operation.operationId=issue-268:run:issue-268-controlled:restart:4|operation.taskId=A",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail:
      "acceptedAt=96|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A", kind: "TaskClaimReadCalled", source: "Tracker" },
  { detail: "A:ActiveTaskClaim", kind: "TaskClaimReadReturned", source: "Tracker" },
  {
    detail:
      "100|_tag=TaskTrackerFactsObserved|observation._tag=FocusedTaskClaimFacts|observation.coverage._tag=ExactTaskClaim|observation.coverage.taskId=A|observation.freshness._tag=ObservedDuringLogicalRead|observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:4|observation.observation._tag=ActiveTaskClaim|observation.observation.operationId=issue-268:run:issue-268-controlled:startup:4|observation.observation.taskId=A|observation.operationId=issue-268:run:issue-268-controlled:restart:4|operationId=issue-268:run:issue-268-controlled:restart:4",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=98|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=98|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=98|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=98|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:1|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:1",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=98|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "D:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskClaim|operation.operationId=issue-268:run:issue-268-controlled:restart:5|operation.taskId=D",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "101|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTaskClaim|operation.operationId=issue-268:run:issue-268-controlled:restart:5|operation.taskId=D",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail:
      "acceptedAt=98|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "D", kind: "TaskClaimReadCalled", source: "Tracker" },
  { detail: "D:ActiveTaskClaim", kind: "TaskClaimReadReturned", source: "Tracker" },
  {
    detail:
      "102|_tag=TaskTrackerFactsObserved|observation._tag=FocusedTaskClaimFacts|observation.coverage._tag=ExactTaskClaim|observation.coverage.taskId=D|observation.freshness._tag=ObservedDuringLogicalRead|observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:5|observation.observation._tag=ActiveTaskClaim|observation.observation.operationId=issue-268:run:issue-268-controlled:startup:31|observation.observation.taskId=D|observation.operationId=issue-268:run:issue-268-controlled:restart:5|operationId=issue-268:run:issue-268-controlled:restart:5",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "D:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=100|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=100|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=100|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=100|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:1|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:1",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=100|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:restart:6|operation.plannedAttempt.attemptId=attempt:A:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=A",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "103|_tag=GitReadIntentRecorded|initiatedBy._tag=DalphCoordinator|operation._tag=ReadTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:restart:6|operation.plannedAttempt.attemptId=attempt:A:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=A",
    kind: "GitReadIntentRecorded",
    source: "Journal"
  },
  {
    detail:
      "acceptedAt=100|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A:attempt:A:1", kind: "WorktreeReadCalled", source: "Git" },
  { detail: "A:attempt:A:1:PlannedWorktreeReady", kind: "WorktreeReadReturned", source: "Git" },
  {
    detail:
      "104|_tag=PlannedAttemptWorktreeObserved|observation._tag=PlannedWorktreeReady|operationId=issue-268:run:issue-268-controlled:restart:6",
    kind: "PlannedAttemptWorktreeObserved",
    source: "Journal"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=102|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=102|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:RecoveredNewActionRoute,A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=102|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=102|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:1|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:1",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=102|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "D:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:restart:7|operation.plannedAttempt.attemptId=attempt:D:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=D",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "105|_tag=GitReadIntentRecorded|initiatedBy._tag=DalphCoordinator|operation._tag=ReadTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:restart:7|operation.plannedAttempt.attemptId=attempt:D:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=D",
    kind: "GitReadIntentRecorded",
    source: "Journal"
  },
  {
    detail:
      "acceptedAt=102|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "D:attempt:D:1", kind: "WorktreeReadCalled", source: "Git" },
  { detail: "D:attempt:D:1:PlannedWorktreeReady", kind: "WorktreeReadReturned", source: "Git" },
  {
    detail:
      "106|_tag=PlannedAttemptWorktreeObserved|observation._tag=PlannedWorktreeReady|operationId=issue-268:run:issue-268-controlled:restart:7",
    kind: "PlannedAttemptWorktreeObserved",
    source: "Journal"
  },
  { detail: "D:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=104|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=104|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=104|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=104|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:1|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:1",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=104|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTargetLineage|operation.operationId=issue-268:run:issue-268-controlled:restart:8|operation.plannedAttempt.attemptId=attempt:A:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=A",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "107|_tag=GitReadIntentRecorded|initiatedBy._tag=DalphCoordinator|operation._tag=ReadTargetLineage|operation.operationId=issue-268:run:issue-268-controlled:restart:8|operation.plannedAttempt.attemptId=attempt:A:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=A",
    kind: "GitReadIntentRecorded",
    source: "Journal"
  },
  {
    detail:
      "acceptedAt=104|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      '1111111111111111111111111111111111111111:{"repository":"/dalph/controlled-characterization/issue-268.git","ref":"refs/heads/main"}',
    kind: "TargetLineageReadCalled",
    source: "Git"
  },
  {
    detail: "1111111111111111111111111111111111111111:1111111111111111111111111111111111111111",
    kind: "TargetLineageReadReturned",
    source: "Git"
  },
  {
    detail:
      "108|_tag=TargetLineageObserved|operationId=issue-268:run:issue-268-controlled:restart:8|plannedAttempt.attemptId=attempt:A:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=A",
    kind: "TargetLineageObserved",
    source: "Journal"
  },
  { detail: "A:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=106|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=106|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=106|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=106|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:1|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:1",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=106|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "D:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTargetLineage|operation.operationId=issue-268:run:issue-268-controlled:restart:9|operation.plannedAttempt.attemptId=attempt:D:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=D",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "109|_tag=GitReadIntentRecorded|initiatedBy._tag=DalphCoordinator|operation._tag=ReadTargetLineage|operation.operationId=issue-268:run:issue-268-controlled:restart:9|operation.plannedAttempt.attemptId=attempt:D:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=D",
    kind: "GitReadIntentRecorded",
    source: "Journal"
  },
  {
    detail:
      "acceptedAt=106|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      '1111111111111111111111111111111111111111:{"repository":"/dalph/controlled-characterization/issue-268.git","ref":"refs/heads/main"}',
    kind: "TargetLineageReadCalled",
    source: "Git"
  },
  {
    detail: "1111111111111111111111111111111111111111:1111111111111111111111111111111111111111",
    kind: "TargetLineageReadReturned",
    source: "Git"
  },
  {
    detail:
      "110|_tag=TargetLineageObserved|operationId=issue-268:run:issue-268-controlled:restart:9|plannedAttempt.attemptId=attempt:D:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=D",
    kind: "TargetLineageObserved",
    source: "Journal"
  },
  { detail: "D:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "acceptedAt=108|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "acceptedAt=108|held=attempt:A:1,attempt:C:1,attempt:D:1|live=A:RecoveredNewActionRoute,D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=108|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:1|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:1",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=110|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=110|held=attempt:A:1,attempt:C:1,attempt:D:1|live=D:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=110|held=attempt:A:1,attempt:C:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=110|held=attempt:A:1,attempt:C:1,attempt:D:1|live=C:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "C:C:Existing:SuspendPlannedAttemptExecutorWork",
    kind: "TaskWorkPositionAdmissionBound",
    source: "Publication"
  },
  {
    detail: "acceptedAt=110|held=attempt:A:1,attempt:C:1,attempt:D:1|live=C:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "C:SuspendPlannedAttemptExecutorWork", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "111|_tag=PlannedAttemptExecutorCommandIntended|command=Suspend|initiatedBy._tag=DalphCoordinator|ordinal=2|plannedAttempt.attemptId=attempt:C:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=C",
    kind: "PlannedAttemptExecutorCommandIntended",
    source: "Journal"
  },
  { detail: "attempt:C:1", kind: "ExecutorSuspendCalled", source: "Executor" },
  { detail: "attempt:C:1:ExecutorWorkExecuting", kind: "ExecutorSuspendReturned", source: "Executor" },
  {
    detail:
      "112|_tag=PlannedAttemptExecutorCommandResponseObserved|plannedAttempt.attemptId=attempt:C:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=C|report._tag=ExecutorWorkExecuting|report.correlation.attemptId=attempt:C:1|report.correlation.runId=run:issue-268-controlled",
    kind: "PlannedAttemptExecutorCommandResponseObserved",
    source: "Journal"
  },
  { detail: "C:SuspendPlannedAttemptExecutorWork", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=ExecutingWorkAuthorityCheck|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:1|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:1",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  { detail: "attempt:C:1:ExecutorWorkSafelySuspended", kind: "ExecutorSafeReportReady", source: "Control" },
  {
    detail: "acceptedAt=112|held=attempt:A:1,attempt:C:1,attempt:D:1|live=C:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "113|_tag=PlannedAttemptExecutorStateObserved|observation._tag=ExactExecutorReport|observation.report._tag=ExecutorWorkSafelySuspended|observation.report.correlation.attemptId=attempt:C:1|observation.report.correlation.runId=run:issue-268-controlled|ordinal=1|plannedAttempt.attemptId=attempt:C:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=C",
    kind: "PlannedAttemptExecutorStateObserved",
    source: "Journal"
  },
  {
    detail:
      "114|_tag=PlannedAttemptExecutorWorkReported|ordinal=2|report._tag=ExecutorWorkSafelySuspended|report.correlation.attemptId=attempt:C:1|report.correlation.runId=run:issue-268-controlled",
    kind: "PlannedAttemptExecutorWorkReported",
    source: "Journal"
  },
  {
    detail: "acceptedAt=112|held=attempt:A:1,attempt:C:1,attempt:D:1|live=C:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=112|held=attempt:A:1,attempt:C:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=112|held=attempt:A:1,attempt:C:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTrackerGraph|operation.cause._tag=PostQuiescenceReconfirmation|operation.operationId=issue-268:run:issue-268-controlled:restart:10|operation.readShape._tag=CompleteTargetClosure",
    kind: "OperationSelected",
    source: "Trace"
  },
  { detail: "issue-268:run:issue-268-controlled:restart:1", kind: "PostQuiescenceWitnessObserved", source: "Control" },
  {
    detail:
      "115|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTrackerGraph|operation.cause._tag=PostQuiescenceReconfirmation|operation.operationId=issue-268:run:issue-268-controlled:restart:10|operation.readShape._tag=CompleteTargetClosure",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  { detail: '"fixture:issue-268"', kind: "TrackerGraphReadCalled", source: "Tracker" },
  { detail: "G2", kind: "TrackerGraphReadReturned", source: "Tracker" },
  {
    detail:
      "116|_tag=TaskTrackerFactsObserved|observation._tag=UnchangedTaskTrackerFactsReconfirmed|observation.factFamilies.0._tag=TaskIdentitiesReconfirmed|observation.factFamilies.0.contentIdentity=G2|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:restart:10|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecyclesReconfirmed|observation.factFamilies.1.contentIdentity=G2|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:restart:10|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.2._tag=TaskPrerequisitesReconfirmed|observation.factFamilies.2.contentIdentity=G2|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:restart:10|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.3._tag=TaskGroupingsReconfirmed|observation.factFamilies.3.contentIdentity=G2|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:restart:10|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.4._tag=TaskTargetMembershipReconfirmed|observation.factFamilies.4.contentIdentity=G2|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:restart:10|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:restart:10|operationId=issue-268:run:issue-268-controlled:restart:10",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  {
    detail:
      "_tag=TaskTrackerFactsObserved|operation._tag=ReadTrackerGraph|operation.cause._tag=PostQuiescenceReconfirmation|operation.operationId=issue-268:run:issue-268-controlled:restart:10|operation.readShape._tag=CompleteTargetClosure|observation._tag=CompleteTaskTrackerFacts|observation.factFamilies.0._tag=TaskIdentities|observation.factFamilies.0.contentIdentity=G2|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:restart:10|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecycles|observation.factFamilies.1.contentIdentity=G2|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:restart:10|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.1.lifecycles.0.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.0.taskId=A|observation.factFamilies.1.lifecycles.1.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.1.taskId=B|observation.factFamilies.1.lifecycles.2.lifecycle._tag=TerminalWithoutSuccess|observation.factFamilies.1.lifecycles.2.taskId=C|observation.factFamilies.1.lifecycles.3.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.3.taskId=D|observation.factFamilies.1.lifecycles.4.lifecycle._tag=Open|observation.factFamilies.1.lifecycles.4.taskId=E|observation.factFamilies.2._tag=TaskPrerequisites|observation.factFamilies.2.contentIdentity=G2|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:restart:10|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.2.prerequisites.0.taskId=A|observation.factFamilies.2.prerequisites.1.taskId=B|observation.factFamilies.2.prerequisites.2.taskId=C|observation.factFamilies.2.prerequisites.3.taskId=D|observation.factFamilies.2.prerequisites.4.taskId=E|observation.factFamilies.3._tag=TaskGroupings|observation.factFamilies.3.contentIdentity=G2|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:restart:10|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.3.groupings.0.taskId=A|observation.factFamilies.3.groupings.1.taskId=B|observation.factFamilies.3.groupings.2.taskId=C|observation.factFamilies.3.groupings.3.taskId=D|observation.factFamilies.3.groupings.4.taskId=E|observation.factFamilies.4._tag=TaskTargetMembership|observation.factFamilies.4.contentIdentity=G2|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:restart:10|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:restart:10",
    kind: "TaskTrackerFactsObserved",
    source: "Trace"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=PostQuiescenceReconfirmation|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:10|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:10",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  { detail: "attempt:B:1", kind: "OperatorContinueCalled", source: "Control" },
  {
    detail:
      "117|_tag=AttemptChoiceApplied|initiatedBy._tag=Operator|requestId.runId=run:issue-268-controlled|subject.plannedAttempt.attemptId=attempt:B:1|subject.plannedAttempt.runId=run:issue-268-controlled|subject.plannedAttempt.taskId=B",
    kind: "AttemptChoiceApplied",
    source: "Journal"
  },
  { detail: "attempt:B:1:ContinueApplied", kind: "OperatorContinueReturned", source: "Control" },
  {
    detail: "acceptedAt=116|held=attempt:A:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "attempt:C:1", kind: "TaskWorkPositionReleased", source: "Publication" },
  {
    detail: "acceptedAt=116|held=attempt:A:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=PostQuiescenceReconfirmation|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:10|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:10",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=117|held=attempt:A:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=117|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=117|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "B:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTrackerGraph|operation.cause._tag=AttemptContinuation|operation.operationId=issue-268:run:issue-268-controlled:restart:11|operation.readShape._tag=CompleteTargetClosure",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "118|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTrackerGraph|operation.cause._tag=AttemptContinuation|operation.operationId=issue-268:run:issue-268-controlled:restart:11|operation.readShape._tag=CompleteTargetClosure",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=117|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268"', kind: "TrackerGraphReadCalled", source: "Tracker" },
  { detail: "G2", kind: "TrackerGraphReadReturned", source: "Tracker" },
  {
    detail:
      "119|_tag=TaskTrackerFactsObserved|observation._tag=UnchangedTaskTrackerFactsReconfirmed|observation.factFamilies.0._tag=TaskIdentitiesReconfirmed|observation.factFamilies.0.contentIdentity=G2|observation.factFamilies.0.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.0.freshness.operationId=issue-268:run:issue-268-controlled:restart:11|observation.factFamilies.0.coverage._tag=CompleteTargetClosure|observation.factFamilies.1._tag=TaskLifecyclesReconfirmed|observation.factFamilies.1.contentIdentity=G2|observation.factFamilies.1.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.1.freshness.operationId=issue-268:run:issue-268-controlled:restart:11|observation.factFamilies.1.coverage._tag=CompleteTargetClosure|observation.factFamilies.2._tag=TaskPrerequisitesReconfirmed|observation.factFamilies.2.contentIdentity=G2|observation.factFamilies.2.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.2.freshness.operationId=issue-268:run:issue-268-controlled:restart:11|observation.factFamilies.2.coverage._tag=CompleteTargetClosure|observation.factFamilies.3._tag=TaskGroupingsReconfirmed|observation.factFamilies.3.contentIdentity=G2|observation.factFamilies.3.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.3.freshness.operationId=issue-268:run:issue-268-controlled:restart:11|observation.factFamilies.3.coverage._tag=CompleteTargetClosure|observation.factFamilies.4._tag=TaskTargetMembershipReconfirmed|observation.factFamilies.4.contentIdentity=G2|observation.factFamilies.4.freshness._tag=ObservedDuringLogicalRead|observation.factFamilies.4.freshness.operationId=issue-268:run:issue-268-controlled:restart:11|observation.factFamilies.4.coverage._tag=CompleteTargetClosure|observation.operationId=issue-268:run:issue-268-controlled:restart:11|operationId=issue-268:run:issue-268-controlled:restart:11",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "B:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=AttemptContinuation|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:11|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:11",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=119|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=119|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=119|held=attempt:A:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=119|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=119|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "B:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:restart:12|operation.taskId=B",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "120|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTaskWorkSpecification|operation.operationId=issue-268:run:issue-268-controlled:restart:12|operation.taskId=B",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=119|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: '"fixture:issue-268":B', kind: "TaskWorkSpecificationReadCalled", source: "Tracker" },
  {
    detail:
      "B:tr1.eyJib2R5IjoiQWxpY2UgY2hhbmdlZCBjb250cm9sbGVkIGRlbGl2ZXJ5IHRhc2sgQi4iLCJ0aXRsZSI6IkltcGxlbWVudCBjaGFuZ2VkIEIifQ",
    kind: "TaskWorkSpecificationReadReturned",
    source: "Tracker"
  },
  {
    detail:
      "121|_tag=TaskTrackerFactsObserved|observation._tag=FocusedTaskWorkSpecificationFacts|observation.factFamily._tag=TaskWorkSpecification|observation.factFamily.contentIdentity=tr1.eyJib2R5IjoiQWxpY2UgY2hhbmdlZCBjb250cm9sbGVkIGRlbGl2ZXJ5IHRhc2sgQi4iLCJ0aXRsZSI6IkltcGxlbWVudCBjaGFuZ2VkIEIifQ|observation.factFamily.coverage._tag=ExactTaskWorkSpecification|observation.factFamily.coverage.taskId=B|observation.factFamily.freshness._tag=ObservedDuringLogicalRead|observation.factFamily.freshness.operationId=issue-268:run:issue-268-controlled:restart:12|observation.factFamily.taskId=B|observation.operationId=issue-268:run:issue-268-controlled:restart:12|operationId=issue-268:run:issue-268-controlled:restart:12",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "B:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=AttemptContinuation|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:11|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:11",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=121|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=121|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=121|held=attempt:A:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=121|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=121|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "B:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskClaim|operation.operationId=issue-268:run:issue-268-controlled:restart:13|operation.taskId=B",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "122|_tag=TaskTrackerReadIntentRecorded|operation._tag=ReadTaskClaim|operation.operationId=issue-268:run:issue-268-controlled:restart:13|operation.taskId=B",
    kind: "TaskTrackerReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=121|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "B", kind: "TaskClaimReadCalled", source: "Tracker" },
  { detail: "B:ActiveTaskClaim", kind: "TaskClaimReadReturned", source: "Tracker" },
  {
    detail:
      "123|_tag=TaskTrackerFactsObserved|observation._tag=FocusedTaskClaimFacts|observation.coverage._tag=ExactTaskClaim|observation.coverage.taskId=B|observation.freshness._tag=ObservedDuringLogicalRead|observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:13|observation.observation._tag=ActiveTaskClaim|observation.observation.operationId=issue-268:run:issue-268-controlled:startup:5|observation.observation.taskId=B|observation.operationId=issue-268:run:issue-268-controlled:restart:13|operationId=issue-268:run:issue-268-controlled:restart:13",
    kind: "TaskTrackerFactsObserved",
    source: "Journal"
  },
  { detail: "B:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=AttemptContinuation|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:11|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:11",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=123|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=123|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=123|held=attempt:A:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=123|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=123|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "B:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:restart:14|operation.plannedAttempt.attemptId=attempt:B:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=B",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "124|_tag=GitReadIntentRecorded|initiatedBy._tag=DalphCoordinator|operation._tag=ReadTaskWorktree|operation.operationId=issue-268:run:issue-268-controlled:restart:14|operation.plannedAttempt.attemptId=attempt:B:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=B",
    kind: "GitReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=123|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "B:attempt:B:1", kind: "WorktreeReadCalled", source: "Git" },
  { detail: "B:attempt:B:1:PlannedWorktreeReady", kind: "WorktreeReadReturned", source: "Git" },
  {
    detail:
      "125|_tag=PlannedAttemptWorktreeObserved|observation._tag=PlannedWorktreeReady|operationId=issue-268:run:issue-268-controlled:restart:14",
    kind: "PlannedAttemptWorktreeObserved",
    source: "Journal"
  },
  { detail: "B:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=AttemptContinuation|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:11|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:11",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=125|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=125|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=125|held=attempt:A:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=125|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=125|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "B:RecoveredNewActionRoute", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "_tag=OperationSelected|operation._tag=ReadTargetLineage|operation.operationId=issue-268:run:issue-268-controlled:restart:15|operation.plannedAttempt.attemptId=attempt:B:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=B",
    kind: "OperationSelected",
    source: "Trace"
  },
  {
    detail:
      "126|_tag=GitReadIntentRecorded|initiatedBy._tag=DalphCoordinator|operation._tag=ReadTargetLineage|operation.operationId=issue-268:run:issue-268-controlled:restart:15|operation.plannedAttempt.attemptId=attempt:B:1|operation.plannedAttempt.runId=run:issue-268-controlled|operation.plannedAttempt.taskId=B",
    kind: "GitReadIntentRecorded",
    source: "Journal"
  },
  {
    detail: "acceptedAt=125|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      '1111111111111111111111111111111111111111:{"repository":"/dalph/controlled-characterization/issue-268.git","ref":"refs/heads/main"}',
    kind: "TargetLineageReadCalled",
    source: "Git"
  },
  {
    detail: "1111111111111111111111111111111111111111:1111111111111111111111111111111111111111",
    kind: "TargetLineageReadReturned",
    source: "Git"
  },
  {
    detail:
      "127|_tag=TargetLineageObserved|operationId=issue-268:run:issue-268-controlled:restart:15|plannedAttempt.attemptId=attempt:B:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=B",
    kind: "TargetLineageObserved",
    source: "Journal"
  },
  { detail: "B:RecoveredNewActionRoute", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=AttemptContinuation|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:11|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:11",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  { detail: "attempt:B:1", kind: "B1ResumeResponsibilityPublished", source: "Publication" },
  { detail: "attempt:A:1:Accepted", kind: "ExecutorTerminalReportReady", source: "Control" },
  {
    detail:
      "128|_tag=PlannedAttemptExecutorStateObserved|observation._tag=ExactExecutorReport|observation.report._tag=ExecutorWorkTerminal|observation.report.correlation.attemptId=attempt:A:1|observation.report.correlation.runId=run:issue-268-controlled|observation.report.result._tag=Accepted|ordinal=1|plannedAttempt.attemptId=attempt:A:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=A",
    kind: "PlannedAttemptExecutorStateObserved",
    source: "Journal"
  },
  {
    detail:
      "129|_tag=PlannedAttemptExecutorWorkReported|ordinal=2|report._tag=ExecutorWorkTerminal|report.correlation.attemptId=attempt:A:1|report.correlation.runId=run:issue-268-controlled|report.result._tag=Accepted",
    kind: "PlannedAttemptExecutorWorkReported",
    source: "Journal"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=AttemptContinuation|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:11|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:11",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=127|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=127|held=attempt:A:1,attempt:D:1|live=B:RecoveredNewActionRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=127|held=attempt:A:1,attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=129|held=attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "attempt:A:1", kind: "TaskWorkPositionReleased", source: "Publication" },
  {
    detail: "acceptedAt=129|held=attempt:D:1|live=B:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "B:B:ReserveOrReuse:ResumePlannedAttemptExecutorWorkAfterCurrentFacts",
    kind: "TaskWorkPositionAdmissionBound",
    source: "Publication"
  },
  {
    detail: "acceptedAt=129|held=attempt:D:1|live=B:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  { detail: "B:ResumePlannedAttemptExecutorWorkAfterCurrentFacts", kind: "DeliveryActionExecuting", source: "Action" },
  {
    detail:
      "130|_tag=PlannedAttemptContinuationAuthorized|plannedAttempt.attemptId=attempt:B:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=B",
    kind: "PlannedAttemptContinuationAuthorized",
    source: "Journal"
  },
  {
    detail:
      "131|_tag=PlannedAttemptExecutorCommandIntended|command=Resume|initiatedBy._tag=DalphCoordinator|ordinal=3|plannedAttempt.attemptId=attempt:B:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=B",
    kind: "PlannedAttemptExecutorCommandIntended",
    source: "Journal"
  },
  { detail: "attempt:B:1", kind: "ExecutorResumeCalled", source: "Executor" },
  { detail: "attempt:B:1:ExecutorWorkExecuting", kind: "ExecutorResumeReturned", source: "Executor" },
  {
    detail:
      "132|_tag=PlannedAttemptExecutorCommandResponseObserved|plannedAttempt.attemptId=attempt:B:1|plannedAttempt.runId=run:issue-268-controlled|plannedAttempt.taskId=B|report._tag=ExecutorWorkExecuting|report.correlation.attemptId=attempt:B:1|report.correlation.runId=run:issue-268-controlled",
    kind: "PlannedAttemptExecutorCommandResponseObserved",
    source: "Journal"
  },
  {
    detail:
      "133|_tag=PlannedAttemptExecutorWorkReported|ordinal=3|report._tag=ExecutorWorkExecuting|report.correlation.attemptId=attempt:B:1|report.correlation.runId=run:issue-268-controlled",
    kind: "PlannedAttemptExecutorWorkReported",
    source: "Journal"
  },
  { detail: "B:ResumePlannedAttemptExecutorWorkAfterCurrentFacts", kind: "DeliveryActionReturned", source: "Action" },
  {
    detail: "acceptedAt=129|held=attempt:D:1|live=A:IdentityFreeWorkflowRoute,B:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=AttemptContinuation|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:11|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:11",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  },
  {
    detail: "acceptedAt=129|held=attempt:D:1|live=B:IdentityFreeWorkflowRoute",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail: "acceptedAt=129|held=attempt:D:1|live=",
    kind: "DeliveryRuntimeObservationPublished",
    source: "Publication"
  },
  {
    detail:
      "graph._tag=GraphEstablished|graph.observation.cause._tag=AttemptContinuation|graph.observation._tag=JournaledTrackerGraphObservation|graph.observation.snapshot.revision=G2|graph.observation.snapshot.nodeIndexByTaskId._root._tag=IndexedNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.0._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.1._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.2._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.3._tag=LeafNode|graph.observation.snapshot.nodeIndexByTaskId._root.children.4._tag=LeafNode|graph.observation.operationId=issue-268:run:issue-268-controlled:restart:11|graph.observation.contentIdentity=G2|graph.observation.freshness._tag=ObservedDuringLogicalRead|graph.observation.freshness.operationId=issue-268:run:issue-268-controlled:restart:11",
    kind: "DeliveryPublicationObserved",
    source: "Publication"
  }
] as const satisfies ReadonlyArray<Issue268AcceptedOccurrence>
