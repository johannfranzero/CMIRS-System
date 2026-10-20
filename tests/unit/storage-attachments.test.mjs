import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ATTACHMENT_VIEW_URL_TTL_SECONDS,
  buildAttachmentStoragePath,
  createAttachmentViewUrl,
  isCanonicalAttachmentStoragePath,
  softDeleteReportAttachment,
  uploadReportAttachment,
} from '../../utils/storage/server.ts';
import { uploadReportAttachmentAction } from '../../actions/reports.ts';

const UUID_REPORT = '33333333-3333-3333-3333-333333333333';
const UUID_ATTACHMENT = '44444444-4444-4444-4444-444444444444';
const UUID_STUDENT = '77777777-7777-7777-7777-777777777777';
const UUID_COORDINATOR = '66666666-6666-6666-6666-666666666666';

const studentUser = {
  id: UUID_STUDENT,
  email: 'student@example.edu',
  profile: {
    id: UUID_STUDENT,
    email: 'student@example.edu',
    full_name: 'Student User',
    role: 'student_personnel',
    is_active: true,
  },
};

const coordinatorUser = {
  id: UUID_COORDINATOR,
  email: 'coordinator@example.edu',
  profile: {
    id: UUID_COORDINATOR,
    email: 'coordinator@example.edu',
    full_name: 'Coordinator User',
    role: 'coordinator',
    is_active: true,
  },
};

function createImageFile({
  name = 'leak.jpg',
  type = 'image/jpeg',
  bytes = [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10],
  size = bytes.length,
} = {}) {
  const content = Uint8Array.from(bytes);
  return {
    name,
    type,
    size,
    async arrayBuffer() {
      return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
    },
  };
}

function createMockSupabase({ handlers = {}, storageHandlers = {} } = {}) {
  const operations = [];

  const client = {
    operations,
    from(table) {
      const operation = { table, type: 'from', filters: {}, payload: undefined };
      operations.push(operation);

      const builder = {
        select(fields) {
          operation.fields = fields;
          if (operation.type === 'from') {
            operation.type = 'select';
          }
          return builder;
        },
        insert(payload) {
          operation.type = 'insert';
          operation.payload = payload;
          return builder;
        },
        eq(column, value) {
          operation.filters[column] = value;
          return builder;
        },
        is(column, value) {
          operation.filters[`${column}_is`] = value;
          return builder;
        },
        in(column, values) {
          operation.filters[`${column}_in`] = values;
          return builder;
        },
        single() {
          return Promise.resolve(handlers[table]?.single?.(operation) ?? { data: null, error: null });
        },
        maybeSingle() {
          return Promise.resolve(handlers[table]?.maybeSingle?.(operation) ?? { data: null, error: null });
        },
        then(resolve) {
          return Promise.resolve(handlers[table]?.exec?.(operation) ?? { data: [], error: null }).then(resolve);
        },
      };

      return builder;
    },
    storage: {
      from(bucket) {
        operations.push({ type: 'storage.from', bucket });
        return {
          upload(path, file, options) {
            operations.push({ type: 'storage.upload', bucket, path, file, options });
            return Promise.resolve(storageHandlers.upload?.({ bucket, path, file, options }) ?? { data: { path }, error: null });
          },
          createSignedUrl(path, expiresIn) {
            operations.push({ type: 'storage.createSignedUrl', bucket, path, expiresIn });
            return Promise.resolve(
              storageHandlers.createSignedUrl?.({ bucket, path, expiresIn }) ?? {
                data: { signedUrl: 'https://example.test/private-view' },
                error: null,
              }
            );
          },
        };
      },
    },
    rpc(fnName, args) {
      operations.push({ type: 'rpc', fnName, args });
      return Promise.resolve(handlers.rpc?.(fnName, args) ?? { data: null, error: null });
    },
  };

  return client;
}

function createUploadReadySupabase({ storageHandlers, attachmentCount = 0, metadataResult } = {}) {
  return createMockSupabase({
    storageHandlers,
    handlers: {
      reports: {
        single: () => ({
          data: { id: UUID_REPORT, status: 'submitted', reporter_id: UUID_STUDENT },
          error: null,
        }),
      },
      report_attachments: {
        exec: () => ({ data: Array.from({ length: attachmentCount }, (_, index) => ({ id: String(index) })), error: null }),
        single: (operation) =>
          metadataResult ?? {
            data: {
              id: operation.payload.id,
              report_id: operation.payload.report_id,
              file_name: operation.payload.file_name,
              file_size: operation.payload.file_size,
              mime_type: operation.payload.mime_type,
              created_at: '2026-10-20T10:00:00Z',
            },
            error: null,
          },
      },
    },
  });
}

test('Attachment helpers derive canonical paths from trusted MIME types', () => {
  assert.equal(
    buildAttachmentStoragePath(UUID_REPORT, UUID_ATTACHMENT, 'image/jpeg'),
    `reports/${UUID_REPORT}/${UUID_ATTACHMENT}.jpg`
  );
  assert.equal(
    buildAttachmentStoragePath(UUID_REPORT, UUID_ATTACHMENT, 'image/webp'),
    `reports/${UUID_REPORT}/${UUID_ATTACHMENT}.webp`
  );
  assert.equal(isCanonicalAttachmentStoragePath(`reports/${UUID_REPORT}/${UUID_ATTACHMENT}.png`), true);
  assert.equal(isCanonicalAttachmentStoragePath(`reports/${UUID_REPORT}/spoofed.exe`), false);
  assert.throws(() => buildAttachmentStoragePath('not-a-uuid', UUID_ATTACHMENT, 'image/png'));
});

test('Attachment upload validates MIME, magic bytes, size, and authentication before I/O', async () => {
  const unauthenticated = await uploadReportAttachment(
    { reportId: UUID_REPORT, file: createImageFile() },
    { user: null }
  );
  assert.equal(unauthenticated.success, false);
  assert.match(unauthenticated.error, /Authentication required/);

  const spoofedMime = await uploadReportAttachment(
    { reportId: UUID_REPORT, file: createImageFile({ type: 'image/png' }) },
    { user: studentUser }
  );
  assert.equal(spoofedMime.success, false);
  assert.match(spoofedMime.error, /contents do not match/);

  const rejectedMime = await uploadReportAttachment(
    { reportId: UUID_REPORT, file: createImageFile({ type: 'application/pdf' }) },
    { user: studentUser }
  );
  assert.equal(rejectedMime.success, false);
  assert.ok(rejectedMime.fieldErrors?.mimeType);

  const oversized = await uploadReportAttachment(
    { reportId: UUID_REPORT, file: createImageFile({ size: 10 * 1024 * 1024 + 1 }) },
    { user: studentUser }
  );
  assert.equal(oversized.success, false);
  assert.ok(oversized.fieldErrors?.fileSize);
});

test('Attachment upload writes binary before immutable metadata registration', async () => {
  const supabase = createUploadReadySupabase();
  const result = await uploadReportAttachment(
    { reportId: UUID_REPORT, file: createImageFile({ name: '../leak photo.jpg' }) },
    { user: studentUser, supabase }
  );

  assert.equal(result.success, true);
  assert.equal(result.data.fileName, 'leak photo.jpg');
  const uploadIndex = supabase.operations.findIndex((operation) => operation.type === 'storage.upload');
  const metadataIndex = supabase.operations.findIndex(
    (operation) => operation.table === 'report_attachments' && operation.type === 'insert'
  );
  assert.ok(uploadIndex >= 0);
  assert.ok(metadataIndex > uploadIndex, 'Metadata must be registered only after the binary upload succeeds');
  const metadata = supabase.operations[metadataIndex].payload;
  assert.equal(metadata.uploaded_by, UUID_STUDENT);
  assert.match(metadata.file_path, new RegExp(`^reports/${UUID_REPORT}/[0-9a-f-]{36}\\.jpg$`, 'i'));
});

test('Attachment upload surfaces storage failures and does not insert metadata', async () => {
  const supabase = createUploadReadySupabase({
    storageHandlers: { upload: () => ({ data: null, error: { message: 'forbidden' } }) },
  });
  const result = await uploadReportAttachment(
    { reportId: UUID_REPORT, file: createImageFile() },
    { user: studentUser, supabase }
  );

  assert.equal(result.success, false);
  assert.match(result.error, /Unable to upload/);
  assert.equal(
    supabase.operations.some((operation) => operation.table === 'report_attachments' && operation.type === 'insert'),
    false
  );
});

test('Attachment upload reports metadata failures after a successful binary upload without unauthorized cleanup', async () => {
  const supabase = createUploadReadySupabase({
    metadataResult: { data: null, error: { message: 'metadata policy denied' } },
  });
  const result = await uploadReportAttachment(
    { reportId: UUID_REPORT, file: createImageFile() },
    { user: studentUser, supabase }
  );

  assert.equal(result.success, false);
  assert.match(result.error, /could not be registered/);
  assert.equal(supabase.operations.some((operation) => operation.type === 'storage.upload'), true);
  assert.equal(supabase.operations.some((operation) => operation.type === 'storage.remove'), false);
});

test('Attachment upload honors the active attachment count boundary', async () => {
  const supabase = createUploadReadySupabase({ attachmentCount: 5 });
  const result = await uploadReportAttachment(
    { reportId: UUID_REPORT, file: createImageFile() },
    { user: studentUser, supabase }
  );

  assert.equal(result.success, false);
  assert.match(result.error, /maximum of 5/);
  assert.equal(supabase.operations.some((operation) => operation.type === 'storage.upload'), false);
});

test('Signed viewing URLs require an active, authorized attachment and use a 60-minute expiry', async () => {
  const storagePath = `reports/${UUID_REPORT}/${UUID_ATTACHMENT}.jpg`;
  const supabase = createMockSupabase({
    handlers: {
      reports: { maybeSingle: () => ({ data: { id: UUID_REPORT }, error: null }) },
      report_attachments: {
        maybeSingle: () => ({
          data: {
            id: UUID_ATTACHMENT,
            report_id: UUID_REPORT,
            file_path: storagePath,
            file_name: 'leak.jpg',
            mime_type: 'image/jpeg',
            deleted_at: null,
          },
          error: null,
        }),
      },
    },
  });
  const result = await createAttachmentViewUrl(
    { reportId: UUID_REPORT, attachmentId: UUID_ATTACHMENT },
    { user: studentUser, supabase }
  );

  assert.equal(result.success, true);
  assert.equal(result.data.expiresInSeconds, ATTACHMENT_VIEW_URL_TTL_SECONDS);
  const signedOperation = supabase.operations.find((operation) => operation.type === 'storage.createSignedUrl');
  assert.equal(signedOperation.expiresIn, 3600);

  const deletedSupabase = createMockSupabase({
    handlers: {
      reports: { maybeSingle: () => ({ data: { id: UUID_REPORT }, error: null }) },
      report_attachments: {
        maybeSingle: () => ({ data: { id: UUID_ATTACHMENT, deleted_at: '2026-10-20T10:00:00Z' }, error: null }),
      },
    },
  });
  const deletedResult = await createAttachmentViewUrl(
    { reportId: UUID_REPORT, attachmentId: UUID_ATTACHMENT },
    { user: studentUser, supabase: deletedSupabase }
  );
  assert.equal(deletedResult.success, false);
  assert.equal(deletedSupabase.operations.some((operation) => operation.type === 'storage.createSignedUrl'), false);
});

test('Soft deletion is coordinator-only and invokes the approved RPC only for active attachments', async () => {
  const denied = await softDeleteReportAttachment(
    { reportId: UUID_REPORT, attachmentId: UUID_ATTACHMENT },
    { user: studentUser }
  );
  assert.equal(denied.success, false);
  assert.match(denied.error, /Only Maintenance Coordinators/);

  const supabase = createMockSupabase({
    handlers: {
      report_attachments: {
        maybeSingle: () => ({ data: { id: UUID_ATTACHMENT, report_id: UUID_REPORT, deleted_at: null }, error: null }),
      },
    },
  });
  const deleted = await softDeleteReportAttachment(
    { reportId: UUID_REPORT, attachmentId: UUID_ATTACHMENT },
    { user: coordinatorUser, supabase }
  );
  assert.equal(deleted.success, true);
  assert.deepEqual(
    supabase.operations.find((operation) => operation.type === 'rpc'),
    { type: 'rpc', fnName: 'soft_delete_attachment', args: { attachment_id: UUID_ATTACHMENT } }
  );
});

test('Attachment action rejects spoofed identity fields and upload retries do not create another report', async () => {
  const spoofed = await uploadReportAttachmentAction(
    { reportId: UUID_REPORT, attachment: createImageFile(), uploadedBy: UUID_COORDINATOR },
    { user: studentUser }
  );
  assert.equal(spoofed.status, 'error');
  assert.match(spoofed.message, /Invalid attachment request/);

  const supabase = createUploadReadySupabase({
    storageHandlers: { upload: () => ({ data: null, error: { message: 'temporary failure' } }) },
  });
  const firstAttempt = await uploadReportAttachment(
    { reportId: UUID_REPORT, file: createImageFile() },
    { user: studentUser, supabase }
  );
  const retryAttempt = await uploadReportAttachment(
    { reportId: UUID_REPORT, file: createImageFile() },
    { user: studentUser, supabase }
  );

  assert.equal(firstAttempt.success, false);
  assert.equal(retryAttempt.success, false);
  assert.equal(
    supabase.operations.some((operation) => operation.table === 'reports' && operation.type === 'insert'),
    false,
    'Retries operate on the established report and never create a duplicate report record'
  );
});
