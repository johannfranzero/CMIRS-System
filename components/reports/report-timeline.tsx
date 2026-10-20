'use client';

import React, { useState } from 'react';
import type { DetailedReport } from '@/types/reports';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import {
  ClockIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  PaperclipIcon,
  UserIcon,
} from '@/components/ui/icons';

interface ReportTimelineProps {
  report: DetailedReport;
}

export function ReportTimeline({ report }: ReportTimelineProps) {
  const [activeTab, setActiveTab] = useState<'history' | 'work_logs' | 'verifications' | 'attachments'>('history');

  const history = report.statusHistory || [];
  const workLogs = report.workLogs || [];
  const verifications = report.verifications || [];
  const attachments = report.attachments || [];

  const formatDate = (isoString?: string) => {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      return d.toLocaleString('en-PH', {
        timeZone: 'Asia/Manila',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  return (
    <Card className="border-slate-200 bg-white shadow-sm overflow-hidden">
      <CardHeader className="bg-slate-50/60 border-b border-slate-200/80 px-6 py-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="text-base font-bold text-slate-900">
            Lifecycle & Activity Timeline
          </CardTitle>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 p-1 bg-slate-200/70 rounded-lg text-xs font-semibold">
            <button
              type="button"
              onClick={() => setActiveTab('history')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                activeTab === 'history'
                  ? 'bg-white text-indigo-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Status Audit ({history.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('work_logs')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                activeTab === 'work_logs'
                  ? 'bg-white text-indigo-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Work Logs ({workLogs.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('verifications')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                activeTab === 'verifications'
                  ? 'bg-white text-indigo-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Verifications ({verifications.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('attachments')}
              className={`px-3 py-1.5 rounded-md transition-colors ${
                activeTab === 'attachments'
                  ? 'bg-white text-indigo-700 shadow-2xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Photos ({attachments.length})
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6">
        {/* TAB 1: Status Audit History */}
        {activeTab === 'history' && (
          <div>
            {history.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">
                <ClockIcon size={24} className="w-6 h-6 mx-auto mb-2 text-slate-400" />
                <p className="font-semibold text-slate-700">Initial Submission State</p>
                <p className="mt-0.5">Report created on {formatDate(report.createdAt)} with status &quot;{report.status}&quot;.</p>
              </div>
            ) : (
              <ol className="relative border-l border-slate-200 ml-3 space-y-6">
                {history.map((item, idx) => (
                  <li key={item.id || idx} className="ml-6">
                    <span className="absolute -left-2.5 flex items-center justify-center w-5 h-5 bg-white rounded-full ring-4 ring-white border-2 border-indigo-600">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-600" />
                    </span>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                      <div className="flex items-center gap-2">
                        {item.previousStatus && (
                          <>
                            <StatusBadge status={item.previousStatus} />
                            <span className="text-slate-400 text-xs">→</span>
                          </>
                        )}
                        <StatusBadge status={item.newStatus} />
                      </div>
                      <time className="text-[11px] text-slate-500 font-mono">
                        {formatDate(item.createdAt)}
                      </time>
                    </div>

                    <div className="mt-2 text-xs text-slate-600 flex items-center gap-1.5">
                      <UserIcon size={14} className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span>
                        Changed by <strong className="font-semibold text-slate-800">{item.changedByName || 'System'}</strong>
                        {item.changedByRole && ` (${item.changedByRole.replace('_', ' ')})`}
                      </span>
                    </div>

                    {item.reason && (
                      <p className="mt-1.5 p-2 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-700 italic">
                        &quot;{item.reason}&quot;
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {/* TAB 2: Technician Work Logs */}
        {activeTab === 'work_logs' && (
          <div>
            {workLogs.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">
                <ClockIcon size={24} className="w-6 h-6 mx-auto mb-2 text-slate-400" />
                <p className="font-semibold text-slate-700">No Work Hours Recorded Yet</p>
                <p className="mt-0.5">Technicians assigned to this ticket log active repair actions and hours here.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {workLogs.map((log) => (
                  <div
                    key={log.id}
                    className="p-3.5 rounded-xl border border-slate-200 bg-white hover:border-indigo-200 transition-colors shadow-2xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs text-slate-800 font-semibold">
                        <UserIcon size={14} className="w-3.5 h-3.5 text-slate-400" />
                        <span>{log.technicianName || 'Technician'}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-100">
                        {log.hoursSpent.toFixed(2)} hrs
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-700 leading-relaxed">
                      {log.description}
                    </p>
                    <div className="mt-2 text-[11px] text-slate-400 font-mono">
                      Recorded: {formatDate(log.createdAt)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: Verifications */}
        {activeTab === 'verifications' && (
          <div>
            {verifications.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">
                <CheckCircleIcon size={24} className="w-6 h-6 mx-auto mb-2 text-slate-400" />
                <p className="font-semibold text-slate-700">No Verification Inspections Yet</p>
                <p className="mt-0.5">Physical inspections and closure determinations will appear once repair work is completed.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {verifications.map((v) => (
                  <div
                    key={v.id}
                    className={`p-4 rounded-xl border ${
                      v.isSatisfactory
                        ? 'border-emerald-200 bg-emerald-50/40'
                        : 'border-amber-200 bg-amber-50/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {v.isSatisfactory ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircleIcon size={14} className="w-3.5 h-3.5 text-emerald-600" />
                            Repair Satisfactory — Closed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-900 border border-amber-200">
                            <ExclamationTriangleIcon size={14} className="w-3.5 h-3.5 text-amber-600" />
                            Inspection Rejected — Reopened for Repair
                          </span>
                        )}
                      </div>
                      <time className="text-[11px] text-slate-500 font-mono">
                        {formatDate(v.verifiedAt)}
                      </time>
                    </div>

                    <div className="mt-2 text-xs text-slate-700">
                      Inspector: <strong className="font-semibold text-slate-900">{v.verifierName || 'Coordinator'}</strong>
                      {v.verifierRole && ` (${v.verifierRole.replace('_', ' ')})`}
                    </div>

                    {v.notes && (
                      <p className="mt-2 p-2.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-800 leading-relaxed">
                        &quot;{v.notes}&quot;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 4: Attachments */}
        {activeTab === 'attachments' && (
          <div>
            {attachments.length === 0 ? (
              <div className="text-center py-8 text-xs text-slate-500">
                <PaperclipIcon size={24} className="w-6 h-6 mx-auto mb-2 text-slate-400" />
                <p className="font-semibold text-slate-700">No Photo Attachments Registered</p>
                <p className="mt-0.5">Photo evidence submitted with this report will be displayed here.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {attachments.map((att) => (
                  <div
                    key={att.id}
                    className="p-3.5 rounded-xl border border-slate-200 bg-white shadow-2xs flex flex-col justify-between"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                        <PaperclipIcon size={16} className="w-4 h-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-slate-900 truncate">
                          {att.fileName}
                        </p>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          {(att.fileSize / (1024 * 1024)).toFixed(2)} MB • {att.mimeType}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                      <span>By {att.uploaderName || 'Reporter'}</span>
                      <span>{formatDate(att.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Scope Limitation Notice */}
            <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
              <strong className="font-semibold text-slate-800">Storage Security Notice:</strong> Attachment files in the private bucket (<code className="text-indigo-700">report-attachments</code>) are governed by authenticated Supabase Storage RLS policies. Signed URLs and download endpoints will be integrated in the authorized Storage implementation phase.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
