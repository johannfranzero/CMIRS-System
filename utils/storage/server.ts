import type { SupabaseClient } from '@supabase/supabase-js';
import type { AuthenticatedUser } from '../../types/auth';
import type {
  AttachmentViewUrlResult,
  MutationResult,
  SoftDeletedAttachmentResult,
  UploadedAttachmentResult,
} from '../../types/mutations';
import type { ReportStatus } from '../../types/reports';
import {
  getAttachmentExtensionForMime,
  isAllowedAttachmentMimeType,
  isValidUuid,
  MAX_ATTACHMENTS_PER_REPORT,
  validateAttachmentMetaInput,
} from '../reports/validation.ts';
import { sanitizeErrorMessage } from '../reports/transform.ts';

export const ATTACHMENTS_BUCKET = 'report-attachments';
export const ATTACHMENT_VIEW_URL_TTL_SECONDS = 3600 as const;

const CANONICAL_ATTACHMENT_PATH = /^reports\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/i;
const TERMINAL_REPORT_STATUSES: readonly ReportStatus[] = ['verified', 'cancelled'];

type AttachmentMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export interface AttachmentFile {
  name: string;
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface StorageMutationContext {
  supabase?: SupabaseClient;
  user?: AuthenticatedUser | null;
}

interface AttachmentAuthorization {
  report: { id: string; status: ReportStatus; reporter_id: string };
}

function isAttachmentFile(value: unknown): value is AttachmentFile {
  if (!value || typeof value !== 'object') return false;
  const file = value as Partial<AttachmentFile>;
  return (
    typeof file.name === 'string' &&
    typeof file.size === 'number' &&
    typeof file.type === 'string' &&
    typeof file.arrayBuffer === 'function'
  );
}

async function resolveAuthenticatedUser(
  context?: StorageMutationContext
): Promise<AuthenticatedUser | null> {
  let user = context?.user;
  if (user === undefined) {
    const { getCurrentUserAndProfile } = await import('@/utils/auth/server');
    user = await getCurrentUserAndProfile();
  }

  return user ?? null;
}

async function resolveAuthAndClient(context?: StorageMutationContext) {
  const user = await resolveAuthenticatedUser(context);

  if (!user || !user.profile.is_active) {
    return { user, supabase: context?.supabase ?? null };
  }

  let supabase = context?.supabase;
  if (supabase === undefined) {
    const { createClient } = await import('@/utils/supabase/server');
    supabase = await createClient();
  }

  return { user, supabase: supabase as SupabaseClient };
}

function matchesMimeSignature(bytes: Uint8Array, mimeType: AttachmentMimeType): boolean {
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }

  if (mimeType === 'image/png') {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }

  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

async function verifyImageContent(file: AttachmentFile, mimeType: AttachmentMimeType): Promise<boolean> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return matchesMimeSignature(bytes, mimeType);
  } catch {
    return false;
  }
}

export function buildAttachmentStoragePath(
  reportId: string,
  attachmentId: string,
  mimeType: AttachmentMimeType
): string {
  if (!isValidUuid(reportId) || !isValidUuid(attachmentId)) {
    throw new Error('Attachment paths require valid report and attachment identifiers.');
  }

  return `reports/${reportId}/${attachmentId}.${getAttachmentExtensionForMime(mimeType)}`;
}

export function isCanonicalAttachmentStoragePath(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_ATTACHMENT_PATH.test(value);
}

async function getAuthorizedReportForUpload(
  supabase: SupabaseClient,
  user: AuthenticatedUser,
  reportId: string
): Promise<MutationResult<AttachmentAuthorization>> {
  const { data: report, error: reportError } = await supabase
    .from('reports')
    .select('id, status, reporter_id')
    .eq('id', reportId)
    .single();

  if (reportError || !report) {
    return { success: false, error: 'Report not found or access denied.' };
  }

  const typedReport = report as { id: string; status: ReportStatus; reporter_id: string };
  const isTerminal = TERMINAL_REPORT_STATUSES.includes(typedReport.status);
  const role = user.profile.role;

  if (role === 'coordinator') {
    if (isTerminal) {
      return { success: false, error: 'Attachments cannot be added to a closed or cancelled report.' };
    }
    return { success: true, data: { report: typedReport } };
  }

  if (role === 'student_personnel') {
    if (
      typedReport.reporter_id !== user.id ||
      !['submitted', 'under_review'].includes(typedReport.status)
    ) {
      return { success: false, error: 'You are not authorized to add attachments to this report.' };
    }
    return { success: true, data: { report: typedReport } };
  }

  if (role === 'technician') {
    const { data: assignment, error: assignmentError } = await supabase
      .from('assignments')
      .select('id')
      .eq('report_id', reportId)
      .eq('technician_id', user.id)
      .in('status', ['assigned', 'in_progress', 'on_hold'])
      .maybeSingle();

    if (assignmentError || !assignment) {
      return { success: false, error: 'You do not have an active assignment on this report.' };
    }
    return { success: true, data: { report: typedReport } };
  }

  return { success: false, error: 'Your role is not authorized to add attachments.' };
}

async function getActiveAttachmentCount(
  supabase: SupabaseClient,
  reportId: string
): Promise<MutationResult<number>> {
  const { data, error } = await supabase
    .from('report_attachments')
    .select('id')
    .eq('report_id', reportId)
    .is('deleted_at', null);

  if (error) {
    return { success: false, error: 'Unable to verify the report attachment limit.' };
  }

  return { success: true, data: data?.length ?? 0 };
}

/**
 * Uploads a validated image, then registers immutable metadata. Both database RLS and Storage RLS
 * remain authoritative; this layer duplicates the essential rules for clear user-facing errors.
 */
export async function uploadReportAttachment(
  input: { reportId: unknown; file: unknown },
  context?: StorageMutationContext
): Promise<MutationResult<UploadedAttachmentResult>> {
  if (!isAttachmentFile(input.file)) {
    return { success: false, error: 'Choose a valid image file to upload.' };
  }

  const validation = validateAttachmentMetaInput({
    reportId: input.reportId,
    fileName: input.file.name,
    fileSize: input.file.size,
    mimeType: input.file.type,
  });
  if (!validation.success) {
    return { success: false, error: 'Invalid attachment.', fieldErrors: validation.errors };
  }

  if (!isAllowedAttachmentMimeType(input.file.type)) {
    return { success: false, error: 'Only JPG, PNG, and WebP images are allowed.' };
  }

  if (!(await verifyImageContent(input.file, validation.data.mimeType))) {
    return { success: false, error: 'The file contents do not match the declared image type.' };
  }

  const { user, supabase } = await resolveAuthAndClient(context);
  if (!user || !user.profile.is_active || !supabase) {
    return { success: false, error: 'Authentication required. Please log in with an active account.' };
  }

  try {
    const authorization = await getAuthorizedReportForUpload(supabase, user, validation.data.reportId);
    if (!authorization.success) return { success: false, error: authorization.error };

    const attachmentCount = await getActiveAttachmentCount(supabase, validation.data.reportId);
    if (!attachmentCount.success) return { success: false, error: attachmentCount.error };
    if ((attachmentCount.data ?? 0) >= MAX_ATTACHMENTS_PER_REPORT) {
      return { success: false, error: 'This report already has the maximum of 5 active attachments.' };
    }

    const attachmentId = crypto.randomUUID();
    const storagePath = buildAttachmentStoragePath(
      validation.data.reportId,
      attachmentId,
      validation.data.mimeType
    );
    const storage = supabase.storage.from(ATTACHMENTS_BUCKET);
    const { error: uploadError } = await storage.upload(storagePath, input.file as File, {
      contentType: validation.data.mimeType,
      upsert: false,
    });

    if (uploadError) {
      console.error('[uploadReportAttachment] Storage upload error:', uploadError);
      return { success: false, error: 'Unable to upload this attachment. Please try again.' };
    }

    const { data: metadata, error: metadataError } = await supabase
      .from('report_attachments')
      .insert({
        id: attachmentId,
        report_id: validation.data.reportId,
        file_path: storagePath,
        file_name: validation.data.fileName,
        file_size: validation.data.fileSize,
        mime_type: validation.data.mimeType,
        uploaded_by: user.id,
      })
      .select('id, report_id, file_name, file_size, mime_type, created_at')
      .single();

    if (metadataError || !metadata) {
      // Client-side Storage DELETE is intentionally denied by existing RLS. Do not attempt an
      // unauthorized cleanup; the existing service-role cleanup worker owns orphaned binaries.
      console.error('[uploadReportAttachment] Metadata insert failed after successful storage upload:', metadataError);
      return {
        success: false,
        error:
          'The file could not be registered as an attachment. No attachment was added to the report; support may need to clean up the uploaded file.',
      };
    }

    return {
      success: true,
      data: {
        attachmentId: metadata.id,
        reportId: metadata.report_id,
        fileName: metadata.file_name,
        fileSize: metadata.file_size,
        mimeType: metadata.mime_type as AttachmentMimeType,
        createdAt: metadata.created_at,
      },
    };
  } catch (error) {
    console.error('[uploadReportAttachment] Unexpected exception:', error);
    return { success: false, error: 'An unexpected error occurred while uploading the attachment.' };
  }
}

async function getAuthorizedActiveAttachment(
  supabase: SupabaseClient,
  reportId: string,
  attachmentId: string
) {
  const { data: report, error: reportError } = await supabase
    .from('reports')
    .select('id')
    .eq('id', reportId)
    .maybeSingle();

  if (reportError || !report) {
    return { success: false as const, error: 'Report not found or access denied.' };
  }

  const { data: attachment, error: attachmentError } = await supabase
    .from('report_attachments')
    .select('id, report_id, file_path, file_name, mime_type, deleted_at')
    .eq('id', attachmentId)
    .eq('report_id', reportId)
    .maybeSingle();

  if (attachmentError || !attachment || attachment.deleted_at) {
    return { success: false as const, error: 'Attachment not found, deleted, or access denied.' };
  }

  if (!isCanonicalAttachmentStoragePath(attachment.file_path)) {
    console.error('[getAuthorizedActiveAttachment] Invalid stored attachment path:', attachment.id);
    return { success: false as const, error: 'This attachment cannot be viewed safely.' };
  }

  if (!isAllowedAttachmentMimeType(attachment.mime_type)) {
    return { success: false as const, error: 'This attachment has an unsupported media type.' };
  }

  return {
    success: true as const,
    data: attachment as {
      id: string;
      report_id: string;
      file_path: string;
      file_name: string;
      mime_type: AttachmentMimeType;
    },
  };
}

export async function createAttachmentViewUrl(
  input: { reportId: unknown; attachmentId: unknown },
  context?: StorageMutationContext
): Promise<MutationResult<AttachmentViewUrlResult>> {
  if (!isValidUuid(input.reportId) || !isValidUuid(input.attachmentId)) {
    return { success: false, error: 'A valid report and attachment identifier are required.' };
  }

  const { user, supabase } = await resolveAuthAndClient(context);
  if (!user || !user.profile.is_active || !supabase) {
    return { success: false, error: 'Authentication required. Please log in with an active account.' };
  }

  try {
    const attachment = await getAuthorizedActiveAttachment(supabase, input.reportId, input.attachmentId);
    if (!attachment.success) return attachment;

    const { data, error } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .createSignedUrl(attachment.data.file_path, ATTACHMENT_VIEW_URL_TTL_SECONDS);

    if (error || !data?.signedUrl) {
      console.error('[createAttachmentViewUrl] Signed URL error:', error);
      return {
        success: false,
        error: 'Unable to create a viewing link. The attachment may be unavailable; please try again.',
      };
    }

    return {
      success: true,
      data: {
        attachmentId: attachment.data.id,
        reportId: attachment.data.report_id,
        fileName: attachment.data.file_name,
        mimeType: attachment.data.mime_type,
        signedUrl: data.signedUrl,
        expiresInSeconds: ATTACHMENT_VIEW_URL_TTL_SECONDS,
      },
    };
  } catch (error) {
    console.error('[createAttachmentViewUrl] Unexpected exception:', error);
    return { success: false, error: 'An unexpected error occurred while creating the viewing link.' };
  }
}

export async function softDeleteReportAttachment(
  input: { reportId: unknown; attachmentId: unknown },
  context?: StorageMutationContext
): Promise<MutationResult<SoftDeletedAttachmentResult>> {
  if (!isValidUuid(input.reportId) || !isValidUuid(input.attachmentId)) {
    return { success: false, error: 'A valid report and attachment identifier are required.' };
  }

  const user = await resolveAuthenticatedUser(context);
  if (!user || !user.profile.is_active) {
    return { success: false, error: 'Authentication required. Please log in with an active account.' };
  }
  if (user.profile.role !== 'coordinator') {
    return { success: false, error: 'Access denied: Only Maintenance Coordinators may remove attachments.' };
  }

  const { supabase } = await resolveAuthAndClient({ ...context, user });
  if (!supabase) {
    return { success: false, error: 'Authentication required. Please log in with an active account.' };
  }

  try {
    const { data: attachment, error: attachmentError } = await supabase
      .from('report_attachments')
      .select('id, report_id, deleted_at')
      .eq('id', input.attachmentId)
      .eq('report_id', input.reportId)
      .maybeSingle();

    if (attachmentError || !attachment || attachment.deleted_at) {
      return { success: false, error: 'Attachment not found or already removed.' };
    }

    const { error: rpcError } = await supabase.rpc('soft_delete_attachment', {
      attachment_id: input.attachmentId,
    });
    if (rpcError) {
      console.error('[softDeleteReportAttachment] RPC error:', rpcError);
      return { success: false, error: sanitizeErrorMessage(rpcError, 'Unable to remove the attachment.') };
    }

    return { success: true, data: { attachmentId: input.attachmentId, reportId: input.reportId } };
  } catch (error) {
    console.error('[softDeleteReportAttachment] Unexpected exception:', error);
    return { success: false, error: 'An unexpected error occurred while removing the attachment.' };
  }
}
