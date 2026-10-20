# CMIRS Phase 4A — Storage & Attachments Implementation Report

> **Date:** 2026-10-20  
> **Scope:** Phase 4A only — authenticated attachment upload, metadata registration, signed viewing, and soft deletion.  
> **Status:** Complete local implementation and mock validation. No remote Supabase operations were performed.

## Summary

Phase 4A extends the existing report lifecycle implementation with private image attachment handling using the existing `report-attachments` Storage bucket, `report_attachments` metadata table, Storage RLS policies, and `soft_delete_attachment(UUID)` RPC. The implementation uses the authenticated server-side Supabase client only; it does not introduce a service-role client, database schema change, migration, or policy change.

## Files Changed

| File | Change |
| --- | --- |
| `utils/storage/server.ts` | Added the authenticated Storage DAL for upload, metadata registration, signed viewing URLs, canonical path helpers, content-signature checks, report authorization, and RPC soft deletion. |
| `actions/reports.ts` | Added server actions for upload, signed URL generation, and coordinator-only soft deletion. |
| `utils/reports/validation.ts` | Centralized attachment MIME, size, count, server-derived extension, and safe display-name helpers. |
| `types/mutations.ts` | Added attachment result contracts that intentionally omit private Storage paths. |
| `types/reports.ts` | Removed the private Storage path from the client-facing attachment model. |
| `utils/reports/dal.ts` | Stops selecting `file_path` for the report-detail client payload. |
| `utils/reports/transform.ts` | Stops transforming private Storage paths into UI data. |
| `components/reports/report-submission-form.tsx` | Retains selected `File` objects locally, creates the report first, uploads images sequentially afterwards, reports partial outcomes, and retries only failed images. |
| `components/reports/report-timeline.tsx` | Adds authorized upload, signed preview/open, expiry/error states, and coordinator delete controls. |
| `app/reports/[id]/page.tsx` | Passes the authenticated user to the attachment UI for client-side usability gating. |
| `tests/unit/storage-attachments.test.mjs` | Added mock-only coverage for Storage and attachment action flows. |
| `tests/unit/mutation-validation.test.mjs` | Updated the metadata assertion for server-derived Storage extensions. |

## Implemented Flows

### Upload and Metadata Registration

1. The report submission form validates normal report fields and local image-selection constraints.
2. `submitReportAction` creates the report first. No attachment upload starts if report creation fails.
3. After a successful report creation, the client calls `uploadReportAttachmentAction` once per selected file. It preserves the report tracking number regardless of attachment outcomes.
4. The server validates report UUID, image MIME type, byte size (maximum 10 MB), content magic bytes, safe display name, authenticated identity, upload role/state, and active attachment count (maximum five).
5. The server generates both the attachment UUID and `reports/{report_id}/{attachment_id}.{extension}` path. The extension comes from the fixed MIME allowlist, never the supplied filename.
6. The binary uploads to `report-attachments` before immutable metadata is inserted into `report_attachments`.
7. Successful images remain registered if another image fails. Failed images can be retried without creating another report.

### Viewing and Deletion

- A view request verifies the active report and attachment through the authenticated session and existing RLS before creating a 3,600-second (60-minute) signed URL.
- The timeline renders a private signed preview and an open-in-new-tab link. A missing or expired image resets the preview and gives a safe retry message.
- Only coordinators see the remove control in the UI. The server action independently enforces this restriction and calls the existing `soft_delete_attachment` RPC.
- Soft deletion does not alter immutable metadata or hard-delete the Storage object.

## Authorization and Security Decisions

- Identity, role, uploader ID, attachment ID, and Storage path are server-derived. The actions reject client-supplied uploader IDs, roles, and paths.
- Upload permissions mirror existing Storage/table RLS: coordinators on non-terminal reports, reporters on their own `submitted`/`under_review` reports, and technicians with active assignments.
- Signed URLs are never stored in the database. They are returned only to a caller that has passed server-side report and attachment authorization.
- The report-detail client payload no longer includes raw `file_path` values.
- Application checks are defense in depth; the existing database constraints, attachment-count trigger, and Storage/Table RLS policies remain authoritative.

## Validation Results

All commands were local only. The deferred RLS integration runner was not run.

| Command | Result |
| --- | --- |
| `node --test tests/unit/*.test.mjs` | Passed: 109 tests, 0 failures. Includes mocked MIME/signature, size/count, canonical path, authorization, upload ordering, upload failure, metadata failure, signed URL, deleted attachment, coordinator deletion, partial failure, and retry coverage. |
| `npx tsc --noEmit` | Passed: exit code 0. |
| `npm run lint` | Passed: exit code 0, no warnings. |

The Node test command emitted existing module-type performance warnings and intentional console output from mocked failure paths. Neither represents a test failure.

## Limitations and Remaining Risks

- **Orphaned objects:** Storage upload and metadata insertion cannot be one transaction. If metadata registration fails after a successful upload, authenticated clients cannot delete the object because current Storage DELETE policy intentionally denies it. The implementation reports the error and leaves cleanup to the existing trusted service-role cleanup worker; the unregistered object remains inaccessible through application Storage reads.
- **Remote verification deferred:** No remote uploads, signed URLs, RPC calls, database queries, or RLS integration tests were performed. Production behavior must be validated in the authorized remote integration phase.
- **Content validation depth:** The server verifies JPEG/PNG/WebP magic bytes and declared MIME type. It does not yet perform image decoding, malware scanning, or antivirus inspection; those controls require a dedicated future scanning pipeline.
- **Concurrency:** The application checks the current active count before upload, but the existing database trigger and Storage RLS count check are the final protections against concurrent attempts exceeding five attachments.
- **Signed link exposure:** An authorized user receives a time-limited link in their browser only after server authorization. The 60-minute expiry is enforced by Storage; links are not persisted.

## Scope Compliance

- No migration, schema, bucket configuration, RLS policy, or database function was modified.
- No dependency was installed.
- No `.env.local` value or secret was read, printed, or changed.
- No remote Supabase operation, deferred RLS test, commit, push, or Phase 4B/4C/4D work was performed.
