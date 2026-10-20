'use client';

import React, { useState, useTransition } from 'react';
import Image, { type ImageLoader } from 'next/image';
import { useRouter } from 'next/navigation';
import {
  createAttachmentViewUrlAction,
  softDeleteReportAttachmentAction,
  uploadReportAttachmentAction,
} from '@/actions/reports';
import type { AuthenticatedUser } from '@/types/auth';
import type { DetailedReport } from '@/types/reports';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import {
  ClockIcon,
  CheckCircleIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  PaperclipIcon,
  PhotoIcon,
  TrashIcon,
  UploadIcon,
  UserIcon,
} from '@/components/ui/icons';

interface ReportTimelineProps {
  report: DetailedReport;
  user: AuthenticatedUser;
}

const signedAttachmentImageLoader: ImageLoader = ({ src }) => src;

export function ReportTimeline({ report, user }: ReportTimelineProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'history' | 'work_logs' | 'verifications' | 'attachments'>('history');
  const [selectedAttachment, setSelectedAttachment] = useState<File | null>(null);
  const [attachmentMessage, setAttachmentMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<{
    attachmentId: string;
    fileName: string;
    signedUrl: string;
    expiresAt: number;
  } | null>(null);
  const [isAttachmentPending, startAttachmentTransition] = useTransition();

  const history = report.statusHistory || [];
  const workLogs = report.workLogs || [];
  const verifications = report.verifications || [];
  const attachments = report.attachments || [];
  const isTerminal = report.status === 'verified' || report.status === 'cancelled';
  const hasActiveAssignment = report.assignmentsList.some(
    (assignment) =>
      assignment.technicianId === user.id &&
      ['assigned', 'in_progress', 'on_hold'].includes(assignment.status)
  );
  const canUploadAttachment =
    attachments.length < 5 &&
    ((user.profile.role === 'coordinator' && !isTerminal) ||
      (user.profile.role === 'student_personnel' &&
        report.reporterId === user.id &&
        ['submitted', 'under_review'].includes(report.status)) ||
      (user.profile.role === 'technician' && hasActiveAssignment));
  const canDeleteAttachment = user.profile.role === 'coordinator';

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

  const handleAttachmentUpload = () => {
    if (!selectedAttachment) {
      setAttachmentMessage('Choose an image before uploading.');
      return;
    }

    const formData = new FormData();
    formData.set('reportId', report.id);
    formData.set('attachment', selectedAttachment);

    startAttachmentTransition(async () => {
      setAttachmentMessage(null);
      const result = await uploadReportAttachmentAction(formData);
      if (result.status !== 'success') {
        setAttachmentMessage(result.message ?? 'Unable to upload the attachment.');
        return;
      }

      setSelectedAttachment(null);
      setAttachmentMessage('Attachment uploaded successfully.');
      router.refresh();
    });
  };

  const handleAttachmentView = (attachmentId: string) => {
    const formData = new FormData();
    formData.set('reportId', report.id);
    formData.set('attachmentId', attachmentId);

    startAttachmentTransition(async () => {
      setAttachmentMessage(null);
      const result = await createAttachmentViewUrlAction(formData);
      if (result.status !== 'success' || !result.data) {
        setPreview(null);
        setAttachmentMessage(result.message ?? 'Unable to create a viewing link.');
        return;
      }

      setPreview({
        attachmentId: result.data.attachmentId,
        fileName: result.data.fileName,
        signedUrl: result.data.signedUrl,
        expiresAt: Date.now() + result.data.expiresInSeconds * 1000,
      });
    });
  };

  const handleAttachmentDelete = (attachmentId: string) => {
    if (!window.confirm('Remove this attachment from the report? The original file remains retained for authorized cleanup.')) {
      return;
    }

    const formData = new FormData();
    formData.set('reportId', report.id);
    formData.set('attachmentId', attachmentId);

    startAttachmentTransition(async () => {
      setAttachmentMessage(null);
      const result = await softDeleteReportAttachmentAction(formData);
      if (result.status !== 'success') {
        setAttachmentMessage(result.message ?? 'Unable to remove the attachment.');
        return;
      }

      if (preview?.attachmentId === attachmentId) {
        setPreview(null);
      }
      setAttachmentMessage('Attachment removed from this report.');
      router.refresh();
    });
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
            {canUploadAttachment && (
              <div className="mb-4 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
                <div className="flex flex-col sm:flex-row sm:items-end gap-3">
                  <label className="flex-1 text-xs font-semibold text-slate-800">
                    Add a photo
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="mt-1.5 block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-indigo-700 hover:file:bg-indigo-100"
                      disabled={isAttachmentPending}
                      onChange={(event) => setSelectedAttachment(event.target.files?.[0] ?? null)}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    disabled={!selectedAttachment || isAttachmentPending}
                    onClick={handleAttachmentUpload}
                    leftIcon={<UploadIcon size={14} />}
                  >
                    {isAttachmentPending ? 'Working...' : 'Upload Photo'}
                  </Button>
                </div>
                <p className="mt-2 text-[11px] text-slate-600">JPG, PNG, or WebP only; maximum 10 MB per image and 5 active attachments per report.</p>
              </div>
            )}

            {attachmentMessage && (
              <p role="status" className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-xs text-slate-700">
                {attachmentMessage}
              </p>
            )}

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
                        <PhotoIcon size={16} className="w-4 h-4" />
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
                    <div className="mt-3 flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={isAttachmentPending}
                        onClick={() => handleAttachmentView(att.id)}
                        leftIcon={<EyeIcon size={14} />}
                      >
                        View Photo
                      </Button>
                      {canDeleteAttachment && (
                        <Button
                          type="button"
                          variant="danger"
                          size="sm"
                          disabled={isAttachmentPending}
                          onClick={() => handleAttachmentDelete(att.id)}
                          leftIcon={<TrashIcon size={14} />}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {preview && (
              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
                  <p className="truncate text-xs font-semibold text-slate-800">Preview: {preview.fileName}</p>
                  <a
                    href={preview.signedUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 text-xs font-semibold text-indigo-700 hover:text-indigo-900"
                  >
                    Open image
                  </a>
                </div>
                <div className="relative h-[32rem] p-4">
                  <Image
                    loader={signedAttachmentImageLoader}
                    unoptimized
                    fill
                    sizes="(min-width: 640px) 42rem, 100vw"
                    src={preview.signedUrl}
                    alt={`Attachment preview for ${preview.fileName}`}
                    className="rounded-lg object-contain bg-slate-100"
                    onError={() => {
                      setPreview(null);
                      setAttachmentMessage('The viewing link has expired or the image is no longer available. Generate a new link to try again.');
                    }}
                  />
                  <p className="mt-2 text-[11px] text-slate-500">
                    This private viewing link expires at {new Date(preview.expiresAt).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour: '2-digit', minute: '2-digit' })}.
                  </p>
                </div>
              </div>
            )}

            <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-600 leading-relaxed">
              <strong className="font-semibold text-slate-800">Storage Security:</strong> Photos stay in a private bucket. Viewing links are generated on demand after server-side authorization and expire after one hour.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
