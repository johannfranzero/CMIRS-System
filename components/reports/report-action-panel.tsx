'use client';

import React, { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  triageReportAction,
  assignTechnicianAction,
  declineAssignmentAction,
  transitionReportStatusAction,
  createWorkLogAction,
  verifyReportAction,
} from '@/actions/reports';
import { INITIAL_ACTION_STATE } from '@/utils/reports/action-state';
import type {
  DetailedReport,
  TechnicianOption,
  PriorityLevel,
} from '@/types/reports';
import type { AuthenticatedUser } from '@/types/auth';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
} from '@/components/ui/icons';

interface ReportActionPanelProps {
  report: DetailedReport;
  user: AuthenticatedUser;
  availableTechnicians?: TechnicianOption[];
  technicianDirectoryError?: string | null;
}

export function ReportActionPanel({
  report,
  user,
  availableTechnicians = [],
  technicianDirectoryError = null,
}: ReportActionPanelProps) {
  const router = useRouter();
  const role = user.profile.role;
  const userId = user.id;

  // Active assignment
  const activeAssignment = report.assignmentsList.find(
    (a) => a.status === 'assigned' || a.status === 'in_progress' || a.status === 'on_hold'
  );
  const isAssignedTech = Boolean(activeAssignment && activeAssignment.technicianId === userId);
  const isReporter = Boolean(report.reporterId && report.reporterId === userId);

  // Active sub-form tab in the action panel.
  //
  // The panel opens on the tab that holds the viewer's next action, so a technician who is
  // assigned the work sees "Work Order Controls" immediately and a coordinator sees the step
  // the report is waiting for. The viewer's explicit choice is remembered per report.
  const [tabOverride, setTabOverride] = useState<{ reportId: string; tab: string } | null>(null);
  const setActiveTab = (tab: string) => setTabOverride({ reportId: report.id, tab });

  // Server Action hooks
  const [triageState, triageFormAction, triagePending] = useActionState(
    triageReportAction,
    INITIAL_ACTION_STATE
  );
  const [assignState, assignFormAction, assignPending] = useActionState(
    assignTechnicianAction,
    INITIAL_ACTION_STATE
  );
  const [declineState, declineFormAction, declinePending] = useActionState(
    declineAssignmentAction,
    INITIAL_ACTION_STATE
  );
  const [transitionState, transitionFormAction, transitionPending] = useActionState(
    transitionReportStatusAction,
    INITIAL_ACTION_STATE
  );
  const [workLogState, workLogFormAction, workLogPending] = useActionState(
    createWorkLogAction,
    INITIAL_ACTION_STATE
  );
  const [verifyState, verifyFormAction, verifyPending] = useActionState(
    verifyReportAction,
    INITIAL_ACTION_STATE
  );

  // Idempotency token for the notification-bearing command RPCs (Phase 4C, S-03).
  //
  // The token is minted on the first submit of an attempt and reused for every retry of that
  // attempt, so a double submit or a retry after a dropped response is answered by the
  // database as a REPLAY of the original command. It is cleared once the action settles, so
  // the next command of the same kind is a new command.
  const requestTokenRef = useRef<string>('');
  /**
   * Stamps the idempotency token into the form before the Server Action runs, so that a
   * double submit or a retry after a dropped response is answered by the database as a
   * REPLAY of the original command instead of creating a second report.
   */
  const stampRequestToken = (event: React.FormEvent<HTMLFormElement>) => {
    if (!requestTokenRef.current) {
      requestTokenRef.current = globalThis.crypto.randomUUID();
    }
    const tokenField = event.currentTarget.elements.namedItem('requestId');
    if (tokenField instanceof HTMLInputElement) {
      tokenField.value = requestTokenRef.current;
    }
  };

  useEffect(() => {
    requestTokenRef.current = '';
  }, [triageState, assignState, transitionState, verifyState]);

  // Local state for interactive controls
  const [triagePriority, setTriagePriority] = useState<PriorityLevel>(
    report.priority || (report.isUrgentHazard ? 'critical' : 'medium')
  );
  // Triage always sets 'under_review'; technician assignment is a separate dedicated command.
  const [selectedTechId, setSelectedTechId] = useState<string>('');
  const [dispatchNotes, setDispatchNotes] = useState<string>('');
  const [declineReason, setDeclineReason] = useState<string>('');
  const [holdReason, setHoldReason] = useState<string>('');
  const [completionNotes, setCompletionNotes] = useState<string>('');
  const [cancelReason, setCancelReason] = useState<string>('');
  const [workHours, setWorkHours] = useState<string>('1.0');
  const [workDescription, setWorkDescription] = useState<string>('');
  const [isVerificationSatisfactory, setIsVerificationSatisfactory] = useState<boolean>(true);
  const [verificationNotes, setVerificationNotes] = useState<string>('');

  // Separation of duties verification calculation
  const isAuthor = Boolean(report.reporterId && report.reporterId === userId);
  const isTechnicianWorker = report.assignmentsList.some((a) => a.technicianId === userId);
  const isDisqualifiedFromVerification = isAuthor || isTechnicianWorker;
  const disqualificationReason = isAuthor
    ? 'Separation of duties: Coordinators who authored this report cannot verify the repair (PD-R4).'
    : isTechnicianWorker
    ? 'Separation of duties: Coordinators who performed repair work cannot verify the repair (D2).'
    : null;

  // The coordinator verifies what the technician actually did. These are derived from the
  // report's own real records: the most recent transition into 'completed' (which carries the
  // technician's repair notes as its reason), the most recent work log, and the number of
  // active evidence attachments.
  const latestCompletionNote = [...report.statusHistory]
    .filter((entry) => entry.newStatus === 'completed' && Boolean(entry.reason))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];

  const latestWorkLog = [...report.workLogs].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)
  )[0];

  const activeEvidenceCount = report.attachments.filter(
    (attachment) => !attachment.deletedAt
  ).length;

  const anyErrorMessage =
    (triageState.status === 'error' && triageState.message) ||
    (assignState.status === 'error' && assignState.message) ||
    (declineState.status === 'error' && declineState.message) ||
    (transitionState.status === 'error' && transitionState.message) ||
    (workLogState.status === 'error' && workLogState.message) ||
    (verifyState.status === 'error' && verifyState.message) ||
    null;

  const anySuccessMessage =
    (triageState.status === 'success' && triageState.message) ||
    (assignState.status === 'success' && assignState.message) ||
    (declineState.status === 'success' && declineState.message) ||
    (transitionState.status === 'success' && transitionState.message) ||
    (workLogState.status === 'success' && workLogState.message) ||
    (verifyState.status === 'success' && verifyState.message) ||
    null;

  // Determine eligible actions by role
  const canCoordinatorTriage =
    (role === 'coordinator' || role === 'administrator') &&
    (report.status === 'submitted' || report.status === 'under_review');

  const canCoordinatorAssign =
    (role === 'coordinator' || role === 'administrator') &&
    report.status !== 'verified' &&
    report.status !== 'cancelled';

  const canCoordinatorVerify =
    (role === 'coordinator' || role === 'administrator') &&
    report.status === 'completed';

  const canCoordinatorCancel =
    (role === 'coordinator' || role === 'administrator') &&
    report.status !== 'verified' &&
    report.status !== 'cancelled';

  const canTechDecline =
    role === 'technician' && isAssignedTech && report.status === 'assigned';

  const canTechStart =
    role === 'technician' && isAssignedTech && report.status === 'assigned';

  // A coordinator may return a repair for further work, which puts the report back into the
  // technician's hands as 'reopened'. The technician must then be able to resume the repair,
  // place it on hold again, or complete it.
  const isReopenedForRepair = report.status === 'reopened';

  const canTechHold =
    role === 'technician' && isAssignedTech && (report.status === 'in_progress' || isReopenedForRepair);

  const canTechResume =
    role === 'technician' && isAssignedTech && (report.status === 'on_hold' || isReopenedForRepair);

  const canTechComplete =
    role === 'technician' &&
    isAssignedTech &&
    (report.status === 'in_progress' || report.status === 'on_hold' || isReopenedForRepair);

  const canTechLogWork =
    role === 'technician' &&
    isAssignedTech &&
    (report.status === 'in_progress' || report.status === 'on_hold' || isReopenedForRepair);

  const canReporterCancel =
    isReporter && (report.status === 'submitted' || report.status === 'under_review');

  const hasAnyActions =
    canCoordinatorTriage ||
    canCoordinatorAssign ||
    canCoordinatorVerify ||
    canCoordinatorCancel ||
    canTechDecline ||
    canTechStart ||
    canTechHold ||
    canTechResume ||
    canTechComplete ||
    canTechLogWork ||
    canReporterCancel;

  // The tab the panel opens on: the one that holds this viewer's next action.
  const defaultTab = (() => {
    if (role === 'technician' && isAssignedTech) {
      if (canTechStart || canTechResume || canTechComplete || canTechHold) return 'tech_work';
      if (canTechLogWork) return 'work_log';
    }
    if (canCoordinatorVerify) return 'verify';
    if (canCoordinatorTriage) return 'triage';
    if (canCoordinatorAssign) return 'assign';
    if (canReporterCancel || canCoordinatorCancel) return 'cancel';
    return 'overview';
  })();

  const activeTab = tabOverride?.reportId === report.id ? tabOverride.tab : defaultTab;

  // A short, status-aware note that tells the viewer what the report is waiting for.
  const nextStepHint = (() => {
    if (role === 'technician' && isAssignedTech) {
      return 'Your work order: start the work, log the hours you spent, then complete it with repair notes so the coordinator can verify it.';
    }
    if (canCoordinatorVerify) {
      return 'Inspection step: review the technician\u2019s notes and evidence, then verify the repair or return it for further work.';
    }
    if (canCoordinatorTriage) {
      return 'Step 1 of 2: confirm the priority. Step 2: assign an active technician to the report.';
    }
    if (canCoordinatorAssign) {
      return 'Assign an active technician account to dispatch this report.';
    }
    if (canReporterCancel) {
      return 'This report is waiting for a coordinator to review it and dispatch a technician.';
    }
    return null;
  })();

  return (
    <Card className="border-slate-200 bg-white shadow-sm overflow-hidden">
      <CardHeader className="bg-slate-50/80 border-b border-slate-200/80 px-5 py-3.5">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-indigo-600" />
            Operational Action Controls
          </CardTitle>
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-white text-indigo-700 border border-slate-200 shadow-2xs">
            Role: {role.replace('_', ' ')}
          </span>
        </div>
      </CardHeader>

      <CardContent className="p-5 flex flex-col gap-4">
        {/* Success Alert Banner */}
        {anySuccessMessage && (
          <div
            role="status"
            className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-start gap-2.5 text-emerald-900 text-xs"
          >
            <CheckCircleIcon size={16} className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">{anySuccessMessage}</p>
              <button
                type="button"
                onClick={() => router.refresh()}
                className="mt-1 text-emerald-700 underline font-medium hover:text-emerald-900"
              >
                Refresh Report Status
              </button>
            </div>
          </div>
        )}

        {/* Error Alert Banner */}
        {anyErrorMessage && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-2.5 text-rose-900 text-xs"
          >
            <ExclamationTriangleIcon size={16} className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-950">Action Failed</p>
              <p className="mt-0.5 text-rose-800">{anyErrorMessage}</p>
            </div>
          </div>
        )}

        {!hasAnyActions ? (
          <div className="text-center py-6 px-4 bg-slate-50/60 rounded-xl border border-dashed border-slate-200 text-xs text-slate-500">
            <ClockIcon size={24} className="w-6 h-6 mx-auto mb-2 text-slate-400" />
            <p className="font-semibold text-slate-700">No Actions Available</p>
            <p className="mt-1">
              {report.status === 'verified'
                ? 'This report has been verified and closed.'
                : report.status === 'cancelled'
                ? 'This report has been cancelled.'
                : 'Current report status does not require immediate operational action from your account.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {nextStepHint && (
              <p className="text-xs text-slate-600 bg-slate-50/70 border border-slate-100 rounded-lg px-3 py-2 leading-relaxed">
                {nextStepHint}
              </p>
            )}

            {/* Action Navigation Buttons */}
            <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-lg text-xs">
              {canCoordinatorTriage && (
                <button
                  type="button"
                  onClick={() => setActiveTab('triage')}
                  className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                    activeTab === 'triage'
                      ? 'bg-white text-indigo-700 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Triage Priority
                </button>
              )}
              {canCoordinatorAssign && (
                <button
                  type="button"
                  onClick={() => setActiveTab('assign')}
                  className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                    activeTab === 'assign'
                      ? 'bg-white text-indigo-700 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {report.assignedTechnician ? 'Reassign Tech' : 'Assign Tech'}
                </button>
              )}
              {canCoordinatorVerify && (
                <button
                  type="button"
                  onClick={() => setActiveTab('verify')}
                  className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                    activeTab === 'verify'
                      ? 'bg-white text-indigo-700 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Verify Repair
                </button>
              )}
              {role === 'technician' && isAssignedTech && (
                <button
                  type="button"
                  onClick={() => setActiveTab('tech_work')}
                  className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                    activeTab === 'tech_work'
                      ? 'bg-white text-indigo-700 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Work Order Controls
                </button>
              )}
              {canTechLogWork && (
                <button
                  type="button"
                  onClick={() => setActiveTab('work_log')}
                  className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                    activeTab === 'work_log'
                      ? 'bg-white text-indigo-700 shadow-2xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Log Hours
                </button>
              )}
              {(canCoordinatorCancel || canReporterCancel) && (
                <button
                  type="button"
                  onClick={() => setActiveTab('cancel')}
                  className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                    activeTab === 'cancel'
                      ? 'bg-white text-rose-700 shadow-2xs'
                      : 'text-slate-600 hover:text-rose-700'
                  }`}
                >
                  Cancel Report
                </button>
              )}
            </div>

            {/* TAB 1: Coordinator Triage */}
            {canCoordinatorTriage && activeTab === 'triage' && (
              <form action={triageFormAction} onSubmit={stampRequestToken} className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/30 flex flex-col gap-3">
                <input type="hidden" name="reportId" value={report.id} />
                    <input type="hidden" name="requestId" defaultValue="" />
                <input type="hidden" name="requestId" defaultValue="" />

                <div>
                  <label htmlFor="confirmedPriority" className="block text-xs font-semibold text-slate-800 mb-1">
                    Confirmed Priority Level <span className="text-rose-500">*</span>
                  </label>
                  <select
                    id="confirmedPriority"
                    name="confirmedPriority"
                    value={triagePriority}
                    onChange={(e) => setTriagePriority(e.target.value as PriorityLevel)}
                    disabled={triagePending}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  >
                    <option value="low">Low — Routine maintenance / cosmetic</option>
                    <option value="medium">Medium — Standard facilities repair</option>
                    <option value="high">High — Significant functional impairment</option>
                    <option value="critical">Critical — Immediate safety hazard</option>
                  </select>
                </div>

                <div className="p-2.5 rounded-lg bg-indigo-50 border border-indigo-100 text-[11px] text-indigo-900 leading-snug">
                  Triage sets this report to <strong>Under Review</strong> and locks in the confirmed priority.
                  Use the <em>Assign Tech</em> tab to dispatch a technician to this report.
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  disabled={triagePending}
                  className="w-full text-xs mt-1"
                >
                  {triagePending ? 'Confirming Triage...' : 'Confirm Priority & Triage'}
                </Button>
              </form>
            )}

            {/* TAB 2: Coordinator Assign / Reassign */}
            {canCoordinatorAssign && activeTab === 'assign' && (
              <form action={assignFormAction} onSubmit={stampRequestToken} className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/30 flex flex-col gap-3">
                <input type="hidden" name="reportId" value={report.id} />
                    <input type="hidden" name="requestId" defaultValue="" />
                <input type="hidden" name="requestId" defaultValue="" />

                {/* Approved Decision 1 Notice */}
                {report.status === 'in_progress' && (
                  <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 leading-snug">
                    <strong className="font-semibold text-amber-950">Notice:</strong> This report is In Progress. Reassigning will revert status to <em>Assigned</em> for the new technician per approved workflow.
                  </div>
                )}

                <div>
                  <label htmlFor="technicianId" className="block text-xs font-semibold text-slate-800 mb-1">
                    Select Technician <span className="text-rose-500">*</span>
                  </label>
                  {technicianDirectoryError && (
                    <div
                      role="alert"
                      className="mb-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900 leading-snug"
                    >
                      <strong className="font-semibold text-amber-950">Technician directory unavailable:</strong>{' '}
                      {technicianDirectoryError} Assignment is disabled until the directory loads.
                    </div>
                  )}
                  <select
                    id="technicianId"
                    name="technicianId"
                    required
                    value={selectedTechId}
                    onChange={(e) => setSelectedTechId(e.target.value)}
                    disabled={assignPending || Boolean(technicianDirectoryError)}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600 disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">
                      {technicianDirectoryError
                        ? 'Technician directory unavailable...'
                        : availableTechnicians.length === 0
                          ? 'No active technicians are available for assignment.'
                          : 'Choose an active technician...'}
                    </option>
                    {availableTechnicians.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.full_name} ({t.email})
                      </option>
                    ))}
                  </select>
                  {assignState.fieldErrors?.technicianId && (
                    <p className="mt-1 text-xs text-rose-600 font-medium">
                      {assignState.fieldErrors.technicianId}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="assignNotes" className="block text-xs font-semibold text-slate-800 mb-1">
                    Dispatch Instructions (Optional)
                  </label>
                  <textarea
                    id="assignNotes"
                    name="notes"
                    rows={2}
                    value={dispatchNotes}
                    onChange={(e) => setDispatchNotes(e.target.value)}
                    disabled={assignPending}
                    placeholder="Provide specific access instructions, safety warnings, or priority notes..."
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  disabled={assignPending || !selectedTechId || Boolean(technicianDirectoryError)}
                  className="w-full text-xs mt-1"
                >
                  {assignPending ? 'Dispatching Technician...' : 'Dispatch Technician Work Order'}
                </Button>
              </form>
            )}

            {/* TAB 3: Coordinator Verification */}
            {canCoordinatorVerify && activeTab === 'verify' && (
              <div className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/30 flex flex-col gap-3">
                {isDisqualifiedFromVerification ? (
                  <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 text-xs text-rose-900">
                    <div className="flex items-center gap-1.5 font-bold text-rose-950 mb-1">
                      <ExclamationTriangleIcon size={16} className="w-4 h-4 text-rose-600" />
                      Verification Disqualified
                    </div>
                    <p>{disqualificationReason}</p>
                    <p className="mt-1 text-[11px] text-rose-700">
                      Another authorized Coordinator must perform this inspection.
                    </p>
                  </div>
                ) : (
                  <form action={verifyFormAction} onSubmit={stampRequestToken} className="flex flex-col gap-3">
                    <input type="hidden" name="reportId" value={report.id} />
                    <input type="hidden" name="requestId" defaultValue="" />

                    {/* The coordinator must be able to inspect what the technician actually did
                        before deciding whether the repair is acceptable. Everything below is
                        read-only and comes from the report's own real records. */}
                    <div className="p-3 rounded-lg bg-white border border-slate-200 flex flex-col gap-2">
                      <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
                        Technician&apos;s Reported Work
                      </span>

                      {latestCompletionNote ? (
                        <div>
                          <p className="text-[11px] font-semibold text-slate-700">
                            Repair completion notes
                            {latestCompletionNote.changedByName
                              ? ` — ${latestCompletionNote.changedByName}`
                              : ''}
                          </p>
                          <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-line">
                            {latestCompletionNote.reason}
                          </p>
                        </div>
                      ) : (
                        <p className="text-xs text-slate-500 italic">
                          No repair completion notes were recorded for this work order.
                        </p>
                      )}

                      {latestWorkLog && (
                        <div>
                          <p className="text-[11px] font-semibold text-slate-700">
                            Latest work log
                            {latestWorkLog.technicianName ? ` — ${latestWorkLog.technicianName}` : ''} ·{' '}
                            {latestWorkLog.hoursSpent} h
                          </p>
                          <p className="text-xs text-slate-800 leading-relaxed whitespace-pre-line">
                            {latestWorkLog.description}
                          </p>
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                        <p className="text-[11px] text-slate-600">
                          Evidence attachments:{' '}
                          <strong className="font-semibold text-slate-800">
                            {activeEvidenceCount}
                          </strong>
                        </p>
                        <p className="text-[11px] text-slate-500">
                          Open the Attachments tab to inspect the photos.
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2">
                      <span className="text-xs font-semibold text-slate-800">Inspection Outcome:</span>
                      <div className="grid grid-cols-2 gap-2">
                        <label
                          className={`p-2.5 rounded-lg border text-xs font-semibold cursor-pointer flex items-center justify-center gap-1.5 transition-colors ${
                            isVerificationSatisfactory
                              ? 'bg-emerald-50 border-emerald-300 text-emerald-800 ring-2 ring-emerald-200'
                              : 'bg-white border-slate-200 text-slate-700'
                          }`}
                        >
                          <input
                            type="radio"
                            name="isSatisfactory"
                            value="true"
                            checked={isVerificationSatisfactory}
                            onChange={() => setIsVerificationSatisfactory(true)}
                            className="sr-only"
                          />
                          <CheckCircleIcon size={14} className="w-3.5 h-3.5 text-emerald-600" />
                          Satisfactory (Close)
                        </label>
                        <label
                          className={`p-2.5 rounded-lg border text-xs font-semibold cursor-pointer flex items-center justify-center gap-1.5 transition-colors ${
                            !isVerificationSatisfactory
                              ? 'bg-amber-50 border-amber-300 text-amber-800 ring-2 ring-amber-200'
                              : 'bg-white border-slate-200 text-slate-700'
                          }`}
                        >
                          <input
                            type="radio"
                            name="isSatisfactory"
                            value="false"
                            checked={!isVerificationSatisfactory}
                            onChange={() => setIsVerificationSatisfactory(false)}
                            className="sr-only"
                          />
                          <ExclamationTriangleIcon size={14} className="w-3.5 h-3.5 text-amber-600" />
                          Reject (Reopen)
                        </label>
                      </div>
                    </div>

                    <div>
                      <label htmlFor="verifyNotes" className="block text-xs font-semibold text-slate-800 mb-1">
                        Verification Inspection Notes {!isVerificationSatisfactory && <span className="text-rose-500">* (Min 5 chars)</span>}
                      </label>
                      <textarea
                        id="verifyNotes"
                        name="notes"
                        rows={3}
                        required={!isVerificationSatisfactory}
                        value={verificationNotes}
                        onChange={(e) => setVerificationNotes(e.target.value)}
                        disabled={verifyPending}
                        placeholder={
                          isVerificationSatisfactory
                            ? 'Document findings from physical inspection and confirm repair meets standards...'
                            : 'Specify required rework, outstanding defects, or reasons why repair failed inspection...'
                        }
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                      />
                      {verifyState.fieldErrors?.notes && (
                        <p className="mt-1 text-xs text-rose-600 font-medium">
                          {verifyState.fieldErrors.notes}
                        </p>
                      )}
                    </div>

                    <Button
                      type="submit"
                      variant={isVerificationSatisfactory ? 'primary' : 'danger'}
                      disabled={verifyPending || (!isVerificationSatisfactory && verificationNotes.trim().length < 5)}
                      className="w-full text-xs mt-1"
                    >
                      {verifyPending
                        ? 'Recording Verification...'
                        : isVerificationSatisfactory
                        ? 'Approve Repair & Close Report'
                        : 'Reject Repair & Reopen Ticket'}
                    </Button>
                  </form>
                )}
              </div>
            )}

            {/* TAB 4: Technician Work Order Controls */}
            {role === 'technician' && isAssignedTech && activeTab === 'tech_work' && (
              <div className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/30 flex flex-col gap-3">
                {/* 4A. Start Work */}
                {canTechStart && (
                  <form action={transitionFormAction} onSubmit={stampRequestToken} className="flex flex-col gap-2">
                    <input type="hidden" name="reportId" value={report.id} />
                    <input type="hidden" name="requestId" defaultValue="" />
                    <input type="hidden" name="targetStatus" value="in_progress" />
                    <p className="text-xs text-slate-600">
                      Begin active maintenance work on this work order.
                    </p>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={transitionPending}
                      className="w-full text-xs"
                    >
                      {transitionPending ? 'Starting Work...' : 'Start Work (Mark In Progress)'}
                    </Button>
                  </form>
                )}

                {/* 4B. Resume Work */}
                {canTechResume && (
                  <form action={transitionFormAction} onSubmit={stampRequestToken} className="flex flex-col gap-2">
                    <input type="hidden" name="reportId" value={report.id} />
                    <input type="hidden" name="requestId" defaultValue="" />
                    <input type="hidden" name="targetStatus" value="in_progress" />
                    <p className="text-xs text-slate-600">
                      Resume active work after pause or parts delivery.
                    </p>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={transitionPending}
                      className="w-full text-xs"
                    >
                      {transitionPending ? 'Resuming Work...' : 'Resume Work'}
                    </Button>
                  </form>
                )}

                {/* 4C. Complete Work — repair completion notes are REQUIRED so the coordinator
                    can inspect what was actually repaired at verification time. */}
                {canTechComplete && (
                  <form action={transitionFormAction} onSubmit={stampRequestToken} className="flex flex-col gap-2 pt-2 border-t border-slate-200">
                    <input type="hidden" name="reportId" value={report.id} />
                    <input type="hidden" name="requestId" defaultValue="" />
                    <input type="hidden" name="targetStatus" value="completed" />
                    <p className="text-xs text-slate-600">
                      Mark repair complete and request Coordinator physical verification.
                    </p>
                    <label htmlFor="completionNotes" className="block text-xs font-semibold text-slate-800">
                      Repair Completion Notes <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      id="completionNotes"
                      name="reason"
                      rows={3}
                      required
                      minLength={5}
                      maxLength={500}
                      value={completionNotes}
                      onChange={(e) => setCompletionNotes(e.target.value)}
                      disabled={transitionPending}
                      placeholder="Describe the repair performed, the parts or materials used, and the checks you carried out..."
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 disabled:opacity-60"
                    />
                    {transitionState.fieldErrors?.reason && (
                      <p className="text-xs text-rose-600 font-medium">
                        {transitionState.fieldErrors.reason}
                      </p>
                    )}
                    <p className="text-[11px] text-slate-500">
                      Photo evidence is optional. Attach it in the Attachments tab before completing
                      if the repair needs visual confirmation.
                    </p>
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={transitionPending || completionNotes.trim().length < 5}
                      className="w-full text-xs bg-emerald-600 hover:bg-emerald-700"
                    >
                      {transitionPending ? 'Completing Work...' : 'Complete Repair (Submit for Verification)'}
                    </Button>
                  </form>
                )}

                {/* 4D. Needs Further Repair — the work order stays with the technician and the
                    coordinator is notified that more repair is outstanding. A reason is required
                    so the coordinator can see what still has to be done. */}
                {canTechHold && (
                  <form action={transitionFormAction} onSubmit={stampRequestToken} className="flex flex-col gap-2 pt-2 border-t border-slate-200">
                    <input type="hidden" name="reportId" value={report.id} />
                    <input type="hidden" name="requestId" defaultValue="" />
                    <input type="hidden" name="targetStatus" value="on_hold" />
                    <label htmlFor="holdReason" className="block text-xs font-semibold text-slate-800">
                      Further Repair Reason <span className="text-rose-500">*</span>
                    </label>
                    <textarea
                      id="holdReason"
                      name="reason"
                      rows={2}
                      required
                      minLength={5}
                      maxLength={500}
                      value={holdReason}
                      onChange={(e) => setHoldReason(e.target.value)}
                      disabled={transitionPending}
                      placeholder="e.g. Awaiting replacement valve from supplier; further repair still outstanding..."
                      className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600 disabled:opacity-60"
                    />
                    {transitionState.fieldErrors?.reason && (
                      <p className="text-xs text-rose-600 font-medium">
                        {transitionState.fieldErrors.reason}
                      </p>
                    )}
                    <Button
                      type="submit"
                      variant="secondary"
                      disabled={transitionPending || holdReason.trim().length < 5}
                      className="w-full text-xs"
                    >
                      {transitionPending ? 'Recording...' : 'Needs Further Repair (Put Work On Hold)'}
                    </Button>
                  </form>
                )}

                {/* 4E. Decline Assignment */}
                {canTechDecline && (
                  <form action={declineFormAction} onSubmit={stampRequestToken} className="flex flex-col gap-2 pt-2 border-t border-rose-200">
                    <input type="hidden" name="assignmentId" value={activeAssignment?.id || ''} />
                    <label htmlFor="declineReason" className="block text-xs font-semibold text-rose-900">
                      Decline Work Order <span className="text-rose-600">* (Reason Required)</span>
                    </label>
                    <textarea
                      id="declineReason"
                      name="reason"
                      rows={2}
                      required
                      value={declineReason}
                      onChange={(e) => setDeclineReason(e.target.value)}
                      disabled={declinePending}
                      placeholder="Explain scheduling conflict, equipment unavailability, or lack of certification..."
                      className="w-full px-3 py-2 text-xs bg-white border border-rose-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
                    />
                    {declineState.fieldErrors?.reason && (
                      <p className="text-xs text-rose-600 font-medium">
                        {declineState.fieldErrors.reason}
                      </p>
                    )}
                    <Button
                      type="submit"
                      variant="danger"
                      disabled={declinePending || !declineReason.trim()}
                      className="w-full text-xs"
                    >
                      {declinePending ? 'Declining...' : 'Decline Work Order'}
                    </Button>
                  </form>
                )}
              </div>
            )}

            {/* TAB 5: Technician Work Log */}
            {canTechLogWork && activeTab === 'work_log' && (
              <form action={workLogFormAction} onSubmit={stampRequestToken} className="p-4 rounded-xl border border-indigo-100 bg-indigo-50/30 flex flex-col gap-3">
                <input type="hidden" name="assignmentId" value={activeAssignment?.id || ''} />

                <div>
                  <label htmlFor="hoursSpent" className="block text-xs font-semibold text-slate-800 mb-1">
                    Hours Spent <span className="text-rose-500">* (0.25 - 24.00)</span>
                  </label>
                  <input
                    id="hoursSpent"
                    name="hoursSpent"
                    type="number"
                    step="0.25"
                    min="0.25"
                    max="24.00"
                    required
                    value={workHours}
                    onChange={(e) => setWorkHours(e.target.value)}
                    disabled={workLogPending}
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                  {workLogState.fieldErrors?.hoursSpent && (
                    <p className="mt-1 text-xs text-rose-600 font-medium">
                      {workLogState.fieldErrors.hoursSpent}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="logDesc" className="block text-xs font-semibold text-slate-800 mb-1">
                    Actions Performed <span className="text-rose-500">* (Min 5 chars)</span>
                  </label>
                  <textarea
                    id="logDesc"
                    name="description"
                    rows={2}
                    required
                    value={workDescription}
                    onChange={(e) => setWorkDescription(e.target.value)}
                    disabled={workLogPending}
                    placeholder="Document diagnostic procedures, replaced components, or maintenance actions..."
                    className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-600"
                  />
                  {workLogState.fieldErrors?.description && (
                    <p className="mt-1 text-xs text-rose-600 font-medium">
                      {workLogState.fieldErrors.description}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  disabled={workLogPending || !workDescription.trim()}
                  className="w-full text-xs mt-1"
                >
                  {workLogPending ? 'Recording Work Log...' : 'Record Work Hours'}
                </Button>
              </form>
            )}

            {/* TAB 6: Cancellation (Reporter or Coordinator) */}
            {(canCoordinatorCancel || canReporterCancel) && activeTab === 'cancel' && (
              <form action={transitionFormAction} onSubmit={stampRequestToken} className="p-4 rounded-xl border border-rose-200 bg-rose-50/40 flex flex-col gap-3">
                <input type="hidden" name="reportId" value={report.id} />
                    <input type="hidden" name="requestId" defaultValue="" />
                <input type="hidden" name="targetStatus" value="cancelled" />

                <div>
                  <label htmlFor="cancelReason" className="block text-xs font-semibold text-rose-950 mb-1">
                    Cancellation Reason <span className="text-rose-600">*</span>
                  </label>
                  <textarea
                    id="cancelReason"
                    name="reason"
                    rows={2}
                    required
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                    disabled={transitionPending}
                    placeholder="Explain why this report is being cancelled (duplicate ticket, issue resolved independently, etc.)..."
                    className="w-full px-3 py-2 text-xs bg-white border border-rose-300 rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                  {transitionState.fieldErrors?.reason && (
                    <p className="mt-1 text-xs text-rose-600 font-medium">
                      {transitionState.fieldErrors.reason}
                    </p>
                  )}
                </div>

                <Button
                  type="submit"
                  variant="danger"
                  disabled={transitionPending || !cancelReason.trim()}
                  className="w-full text-xs"
                >
                  {transitionPending ? 'Cancelling Report...' : 'Cancel Report'}
                </Button>
              </form>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
