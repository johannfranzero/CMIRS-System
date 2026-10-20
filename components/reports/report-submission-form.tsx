'use client';

import React, { useActionState, useState } from 'react';
import Link from 'next/link';
import { submitReportAction, INITIAL_ACTION_STATE } from '@/actions/reports';
import type { CategoryOption, LocationOption } from '@/types/reports';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import {
  ExclamationTriangleIcon,
  CheckCircleIcon,
  UploadIcon,
  PaperclipIcon,
  TrashIcon,
  PlusCircleIcon,
} from '@/components/ui/icons';

interface ReportSubmissionFormProps {
  categories: CategoryOption[];
  locations: LocationOption[];
  userRole?: string;
}

export function ReportSubmissionForm({
  categories,
  locations,
}: ReportSubmissionFormProps) {
  const [state, formAction, isPending] = useActionState(
    submitReportAction,
    INITIAL_ACTION_STATE
  );

  // Form input local state for client usability validation
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [locationId, setLocationId] = useState('');
  const [description, setDescription] = useState('');
  const [isUrgentHazard, setIsUrgentHazard] = useState(false);
  const [clientErrors, setClientErrors] = useState<Record<string, string>>({});

  // Attachment groundwork state
  const [selectedFiles, setSelectedFiles] = useState<Array<{ name: string; size: number; type: string }>>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);

  // Merge client usability errors with server-returned field errors
  const activeErrors: Record<string, string> = {
    ...clientErrors,
    ...(state.fieldErrors || {}),
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setAttachmentError(null);
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (selectedFiles.length + files.length > 5) {
      setAttachmentError('Maximum of 5 photos allowed per report.');
      return;
    }

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    const maxSizeBytes = 10 * 1024 * 1024; // 10 MB per Storage setup policy

    const newFiles: Array<{ name: string; size: number; type: string }> = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!allowedMimeTypes.includes(file.type)) {
        setAttachmentError(`"${file.name}" has an unsupported format. Only JPG, PNG, and WebP are allowed.`);
        return;
      }
      if (file.size > maxSizeBytes) {
        setAttachmentError(`"${file.name}" exceeds the 10 MB limit (${(file.size / (1024 * 1024)).toFixed(1)} MB).`);
        return;
      }
      newFiles.push({ name: file.name, size: file.size, type: file.type });
    }

    setSelectedFiles((prev) => [...prev, ...newFiles]);
  };

  const removeFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClientValidation = (e: React.FormEvent<HTMLFormElement>) => {
    const errors: Record<string, string> = {};

    if (!title.trim()) {
      errors.title = 'Report title is required.';
    } else if (title.trim().length < 5) {
      errors.title = 'Title must be at least 5 characters.';
    } else if (title.trim().length > 120) {
      errors.title = 'Title must not exceed 120 characters.';
    }

    if (!categoryId) {
      errors.categoryId = 'Please select an incident category.';
    }

    if (!locationId) {
      errors.locationId = 'Please select a campus location.';
    }

    if (!description.trim()) {
      errors.description = 'Detailed description is required.';
    } else if (description.trim().length < 10) {
      errors.description = 'Description must be at least 10 characters.';
    } else if (description.trim().length > 2000) {
      errors.description = 'Description must not exceed 2000 characters.';
    }

    if (Object.keys(errors).length > 0) {
      e.preventDefault();
      setClientErrors(errors);
      return;
    }

    setClientErrors({});
  };

  const handleResetForm = () => {
    setTitle('');
    setCategoryId('');
    setLocationId('');
    setDescription('');
    setIsUrgentHazard(false);
    setSelectedFiles([]);
    setAttachmentError(null);
    setClientErrors({});
  };

  // 1. Success State Feedback Screen
  if (state.status === 'success' && state.data) {
    return (
      <Card className="max-w-2xl mx-auto border-emerald-200 bg-white shadow-sm">
        <CardContent className="p-8 sm:p-10 flex flex-col items-center text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-5 shadow-xs">
            <CheckCircleIcon size={36} className="w-9 h-9" />
          </div>

          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200 mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-600" />
            Report #{state.data.reportNumber}
          </span>

          <h2 className="text-2xl font-bold text-slate-900 tracking-tight">
            Maintenance Report Submitted
          </h2>

          <p className="mt-2 text-sm text-slate-600 max-w-md leading-relaxed">
            Your incident report has been securely registered in the system. Campus Maintenance Coordinators will triage and dispatch technician assistance.
          </p>

          <div className="mt-8 flex flex-col sm:flex-row items-center gap-3 w-full justify-center">
            <Link href={`/reports/${state.data.id}`} className="w-full sm:w-auto">
              <Button variant="primary" className="w-full">
                View Submitted Report
              </Button>
            </Link>
            <Link href="/reports" className="w-full sm:w-auto">
              <Button variant="secondary" className="w-full">
                Reports Queue
              </Button>
            </Link>
            <Button
              variant="outline"
              onClick={handleResetForm}
              className="w-full sm:w-auto"
            >
              Submit Another Report
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // 2. Active Submission Form Screen
  return (
    <Card className="max-w-3xl mx-auto border-slate-200 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-100 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shadow-xs shrink-0">
            <PlusCircleIcon size={22} className="w-5.5 h-5.5" />
          </div>
          <div>
            <CardTitle className="text-xl font-bold text-slate-900">
              Submit Maintenance Report
            </CardTitle>
            <p className="text-xs text-slate-500 mt-0.5">
              Report campus facilities damage, electrical faults, plumbing leaks, or safety hazards.
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-6 sm:p-8">
        {/* Global Error Banner */}
        {state.status === 'error' && state.message && (
          <div
            role="alert"
            className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 flex items-start gap-3 text-rose-900 text-sm"
          >
            <ExclamationTriangleIcon size={20} className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-rose-950">Submission Error</p>
              <p className="mt-0.5 text-xs text-rose-800 leading-relaxed">{state.message}</p>
            </div>
          </div>
        )}

        <form action={formAction} onSubmit={handleClientValidation} className="flex flex-col gap-6">
          {/* Title Field */}
          <div>
            <label htmlFor="title" className="block text-sm font-semibold text-slate-800 mb-1.5">
              Report Title <span className="text-rose-500">*</span>
            </label>
            <input
              id="title"
              name="title"
              type="text"
              required
              disabled={isPending}
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                if (clientErrors.title) {
                  setClientErrors((prev) => ({ ...prev, title: '' }));
                }
              }}
              placeholder="e.g. Water pipe leaking directly above server rack"
              className={`w-full px-3.5 py-2.5 text-sm bg-white border rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 transition-shadow ${
                activeErrors.title
                  ? 'border-rose-400 focus:ring-rose-200'
                  : 'border-slate-300 focus:ring-indigo-200 focus:border-indigo-600'
              } disabled:bg-slate-50 disabled:text-slate-400`}
            />
            {activeErrors.title ? (
              <p className="mt-1.5 text-xs text-rose-600 font-medium">{activeErrors.title}</p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">Brief, specific summary (5-120 characters).</p>
            )}
          </div>

          {/* Category & Location Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {/* Category Select */}
            <div>
              <label htmlFor="categoryId" className="block text-sm font-semibold text-slate-800 mb-1.5">
                Maintenance Category <span className="text-rose-500">*</span>
              </label>
              <select
                id="categoryId"
                name="categoryId"
                required
                disabled={isPending}
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  if (clientErrors.categoryId) {
                    setClientErrors((prev) => ({ ...prev, categoryId: '' }));
                  }
                }}
                className={`w-full px-3.5 py-2.5 text-sm bg-white border rounded-lg text-slate-900 focus:outline-none focus:ring-2 transition-shadow ${
                  activeErrors.categoryId
                    ? 'border-rose-400 focus:ring-rose-200'
                    : 'border-slate-300 focus:ring-indigo-200 focus:border-indigo-600'
                } disabled:bg-slate-50 disabled:text-slate-400`}
              >
                <option value="">Select a category...</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
              {activeErrors.categoryId && (
                <p className="mt-1.5 text-xs text-rose-600 font-medium">{activeErrors.categoryId}</p>
              )}
            </div>

            {/* Location Select */}
            <div>
              <label htmlFor="locationId" className="block text-sm font-semibold text-slate-800 mb-1.5">
                Campus Location <span className="text-rose-500">*</span>
              </label>
              <select
                id="locationId"
                name="locationId"
                required
                disabled={isPending}
                value={locationId}
                onChange={(e) => {
                  setLocationId(e.target.value);
                  if (clientErrors.locationId) {
                    setClientErrors((prev) => ({ ...prev, locationId: '' }));
                  }
                }}
                className={`w-full px-3.5 py-2.5 text-sm bg-white border rounded-lg text-slate-900 focus:outline-none focus:ring-2 transition-shadow ${
                  activeErrors.locationId
                    ? 'border-rose-400 focus:ring-rose-200'
                    : 'border-slate-300 focus:ring-indigo-200 focus:border-indigo-600'
                } disabled:bg-slate-50 disabled:text-slate-400`}
              >
                <option value="">Select a campus location...</option>
                {locations.map((loc) => {
                  const labelParts = [loc.building_name];
                  if (loc.floor) labelParts.push(`Fl ${loc.floor}`);
                  if (loc.room) labelParts.push(`Rm ${loc.room}`);
                  return (
                    <option key={loc.id} value={loc.id}>
                      {labelParts.join(' — ')}
                    </option>
                  );
                })}
              </select>
              {activeErrors.locationId && (
                <p className="mt-1.5 text-xs text-rose-600 font-medium">{activeErrors.locationId}</p>
              )}
            </div>
          </div>

          {/* Description Textarea */}
          <div>
            <label htmlFor="description" className="block text-sm font-semibold text-slate-800 mb-1.5">
              Issue Description <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="description"
              name="description"
              rows={4}
              required
              disabled={isPending}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
                if (clientErrors.description) {
                  setClientErrors((prev) => ({ ...prev, description: '' }));
                }
              }}
              placeholder="Describe what is broken, specific location indicators, and any danger or disruption observed..."
              className={`w-full px-3.5 py-2.5 text-sm bg-white border rounded-lg text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 transition-shadow ${
                activeErrors.description
                  ? 'border-rose-400 focus:ring-rose-200'
                  : 'border-slate-300 focus:ring-indigo-200 focus:border-indigo-600'
              } disabled:bg-slate-50 disabled:text-slate-400`}
            />
            {activeErrors.description ? (
              <p className="mt-1.5 text-xs text-rose-600 font-medium">{activeErrors.description}</p>
            ) : (
              <p className="mt-1 text-xs text-slate-500">Provide detailed observation (10-2000 characters).</p>
            )}
          </div>

          {/* Urgent Safety Hazard Banner & Checkbox */}
          <div
            className={`p-4 rounded-xl border transition-colors ${
              isUrgentHazard
                ? 'bg-amber-50/80 border-amber-300 ring-2 ring-amber-200'
                : 'bg-slate-50 border-slate-200'
            }`}
          >
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                id="isUrgentHazard"
                name="isUrgentHazard"
                type="checkbox"
                disabled={isPending}
                checked={isUrgentHazard}
                onChange={(e) => setIsUrgentHazard(e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              />
              <div className="flex-1">
                <div className="flex items-center gap-1.5">
                  <ExclamationTriangleIcon
                    size={16}
                    className={`w-4 h-4 ${isUrgentHazard ? 'text-amber-600' : 'text-slate-400'}`}
                  />
                  <span className="text-sm font-semibold text-slate-900">
                    Flag as Urgent Safety Hazard
                  </span>
                </div>
                <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                  Check this if the incident poses an immediate physical danger, severe environmental risk, or catastrophic campus disruption (e.g. live exposed wires, gas odor, active structural collapse).
                </p>
              </div>
            </label>
          </div>

          {/* Attachment Dropzone Groundwork (Approved Boundary Groundwork) */}
          <div className="border border-dashed border-slate-300 rounded-xl p-5 bg-slate-50/50">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <PaperclipIcon size={18} className="w-4.5 h-4.5 text-slate-500" />
                <span className="text-sm font-semibold text-slate-800">Photo Attachments Groundwork</span>
              </div>
              <span className="text-xs text-slate-500">Up to 5 images • Max 10 MB each</span>
            </div>

            <div className="mt-2 flex flex-col items-center justify-center p-4 border border-dashed border-slate-200 rounded-lg bg-white text-center">
              <UploadIcon size={24} className="w-6 h-6 text-slate-400 mb-2" />
              <p className="text-xs text-slate-700 font-medium">
                Select photos to attach to this maintenance request
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Supported formats: JPG, PNG, WebP (10MB max per file)
              </p>

              <label className="mt-3 cursor-pointer">
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100 transition-colors">
                  Choose Image Files
                </span>
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp"
                  disabled={isPending}
                  onChange={handleFileChange}
                  className="sr-only"
                />
              </label>
            </div>

            {/* Selected Files List */}
            {selectedFiles.length > 0 && (
              <div className="mt-3 space-y-2">
                <p className="text-xs font-semibold text-slate-700">Selected Files ({selectedFiles.length}/5):</p>
                <div className="flex flex-wrap gap-2">
                  {selectedFiles.map((file, idx) => (
                    <div
                      key={idx}
                      className="inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-800 shadow-2xs"
                    >
                      <span className="truncate max-w-[150px]">{file.name}</span>
                      <span className="text-[10px] text-slate-500">
                        ({(file.size / 1024).toFixed(0)} KB)
                      </span>
                      <button
                        type="button"
                        onClick={() => removeFile(idx)}
                        disabled={isPending}
                        className="text-slate-400 hover:text-rose-600 transition-colors"
                        aria-label={`Remove ${file.name}`}
                      >
                        <TrashIcon size={14} className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {attachmentError && (
              <p className="mt-2 text-xs text-rose-600 font-medium">{attachmentError}</p>
            )}

            {/* Explicit Scope & Architecture Callout */}
            <div className="mt-3 p-2.5 rounded-lg bg-indigo-50/70 border border-indigo-100 text-[11px] text-indigo-900 leading-relaxed">
              <strong className="font-semibold text-indigo-950">Storage Policy Groundwork:</strong> Client photo validation enforces the canonical 10 MB limit and image MIME restrictions defined in the approved storage configuration. Direct binary file upload to the private Storage bucket will be enabled in the upcoming storage authorization phase.
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-3 border-t border-slate-100">
            <Link href="/reports" className="w-full sm:w-auto">
              <Button type="button" variant="outline" disabled={isPending} className="w-full sm:w-auto">
                Cancel
              </Button>
            </Link>
            <Button
              type="submit"
              variant="primary"
              disabled={isPending}
              className="w-full sm:w-auto min-w-[160px]"
            >
              {isPending ? (
                <span className="flex items-center gap-2">
                  <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Submitting Report...
                </span>
              ) : (
                'Submit Maintenance Report'
              )}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
