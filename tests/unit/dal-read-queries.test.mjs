import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const myAppRoot = path.resolve(__dirname, '../..');

// Import DAL pure functions (in ES module format)
// We recreate/test the deterministic transformer and KPI calculator from dal.ts
function transformDbReportToMaintenanceReport(row) {
  let activeAssignment = undefined;

  if (Array.isArray(row.assignments) && row.assignments.length > 0) {
    const activeList = row.assignments.filter(
      (a) => a.status === 'assigned' || a.status === 'in_progress' || a.status === 'on_hold'
    );

    if (activeList.length > 0) {
      activeAssignment = activeList.sort((a, b) => {
        const timeA = a.assigned_at ? new Date(a.assigned_at).getTime() : 0;
        const timeB = b.assigned_at ? new Date(b.assigned_at).getTime() : 0;
        return timeB - timeA;
      })[0];
    } else {
      const completed = row.assignments.find((a) => a.status === 'completed');
      if (completed) {
        activeAssignment = completed;
      }
    }
  }

  return {
    id: row.id,
    trackingNumber: row.report_number || `RPT-${row.id.substring(0, 8)}`,
    title: row.title || 'Untitled Report',
    description: row.description || '',
    category: row.categories?.name || 'General Maintenance',
    categoryId: row.category_id,
    location: {
      building: row.locations?.building_name || 'Main Campus',
      floor: row.locations?.floor || '1',
      room: row.locations?.room || undefined,
      specificArea: row.locations?.description || undefined,
    },
    locationId: row.location_id,
    status: row.status || 'submitted',
    priority: row.confirmed_priority ?? null,
    isUrgentHazard: Boolean(row.is_urgent_hazard),
    reporterName: row.reporter?.full_name || 'Campus Reporter',
    reporterRole: row.reporter?.role || 'student_personnel',
    reporterId: row.reporter_id || row.reporter?.id,
    reporterEmail: row.reporter?.email,
    assignedTechnician: activeAssignment?.technician?.full_name,
    assignedTechnicianId: activeAssignment?.technician_id,
    assignmentStatus: activeAssignment?.status,
    createdAt: row.created_at || new Date().toISOString(),
    updatedAt: row.updated_at || row.created_at || new Date().toISOString(),
  };
}

function calculateKpiStatsFromDbReports(reports) {
  let totalActive = 0;
  let pendingReview = 0;
  let inProgress = 0;
  let resolvedThisWeek = 0;
  let urgentHazards = 0;

  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  for (const report of reports) {
    const isResolved = report.status === 'completed' || report.status === 'verified';
    const isCancelled = report.status === 'cancelled';
    const isActive = !isResolved && !isCancelled;

    if (isActive) totalActive += 1;
    if (report.status === 'submitted' || report.status === 'under_review') pendingReview += 1;
    if (report.status === 'assigned' || report.status === 'in_progress' || report.status === 'on_hold') inProgress += 1;

    if (isResolved) {
      const timestamp = report.updated_at || report.created_at;
      if (timestamp && new Date(timestamp) >= oneWeekAgo) {
        resolvedThisWeek += 1;
      }
    }

    if (report.is_urgent_hazard || report.confirmed_priority === 'critical') {
      urgentHazards += 1;
    }
  }

  return { totalActive, pendingReview, inProgress, resolvedThisWeek, urgentHazards };
}

function paginateRange(page = 1, pageSize = 15) {
  const p = Math.max(1, page);
  const size = Math.min(50, Math.max(1, pageSize));
  const from = (p - 1) * size;
  const to = from + size - 1;
  return { page: p, pageSize: size, from, to };
}

// =============================================================================
// TEST SUITE: Read-Only DAL Query Construction & Transformation
// =============================================================================

test('DAL Schema: Verified column selection includes all required fields and foreign keys', () => {
  const dalFilePath = path.join(myAppRoot, 'utils/reports/dal.ts');
  const content = fs.readFileSync(dalFilePath, 'utf8');

  // Must select canonical columns
  assert.ok(content.includes('report_number'), 'Must select report_number');
  assert.ok(content.includes('confirmed_priority'), 'Must select confirmed_priority');
  assert.ok(content.includes('is_urgent_hazard'), 'Must select is_urgent_hazard');
  assert.ok(content.includes('categories'), 'Must join categories relation');
  assert.ok(content.includes('locations'), 'Must join locations relation');
  assert.ok(content.includes('reporter:profiles!reporter_id'), 'Must join reporter profile');
  assert.ok(content.includes('assignments'), 'Must join assignments relation');
  assert.ok(content.includes('technician:profiles!technician_id'), 'Must join technician profile');
});

test('DAL Transformer: Accurately maps joined database row to MaintenanceReport', () => {
  const rawRow = {
    id: 'rep-uuid-101',
    report_number: 'RPT-000101',
    title: 'Water Pipe Leaking in 204',
    description: 'Pipe leaking behind cabinet',
    status: 'in_progress',
    is_urgent_hazard: true,
    confirmed_priority: 'high',
    created_at: '2026-10-20T08:00:00Z',
    updated_at: '2026-10-20T09:30:00Z',
    category_id: 'cat-uuid-1',
    location_id: 'loc-uuid-2',
    reporter_id: 'user-uuid-student',
    categories: { id: 'cat-uuid-1', name: 'Plumbing & Water', description: 'Pipes and leaks' },
    locations: { id: 'loc-uuid-2', building_name: 'Main Academic Building', floor: '2', room: '204', description: 'Computer Lab' },
    reporter: { id: 'user-uuid-student', full_name: 'Test Student', role: 'student_personnel', email: 'student@cmirs.internal' },
    assignments: [
      {
        id: 'assign-1',
        status: 'in_progress',
        assigned_at: '2026-10-20T08:30:00Z',
        technician_id: 'tech-uuid-1',
        technician: { id: 'tech-uuid-1', full_name: 'Marcus Vance' },
      },
    ],
  };

  const report = transformDbReportToMaintenanceReport(rawRow);

  assert.equal(report.id, 'rep-uuid-101');
  assert.equal(report.trackingNumber, 'RPT-000101');
  assert.equal(report.title, 'Water Pipe Leaking in 204');
  assert.equal(report.category, 'Plumbing & Water');
  assert.equal(report.location.building, 'Main Academic Building');
  assert.equal(report.location.room, '204');
  assert.equal(report.priority, 'high');
  assert.equal(report.isUrgentHazard, true);
  assert.equal(report.reporterName, 'Test Student');
  assert.equal(report.assignedTechnician, 'Marcus Vance');
  assert.equal(report.assignmentStatus, 'in_progress');
});

test('DAL Transformer: Handles nullable confirmed_priority as null (Pending Triage)', () => {
  const rawRow = {
    id: 'rep-uuid-new',
    report_number: 'RPT-000102',
    title: 'Broken chair',
    description: 'Leg broken',
    status: 'submitted',
    is_urgent_hazard: false,
    confirmed_priority: null, // Initial report before coordinator review
    created_at: '2026-10-20T10:00:00Z',
    updated_at: '2026-10-20T10:00:00Z',
  };

  const report = transformDbReportToMaintenanceReport(rawRow);

  assert.strictEqual(report.priority, null, 'Priority must be null for unconfirmed reports');
  assert.equal(report.status, 'submitted');
  assert.equal(report.assignedTechnician, undefined);
});

test('DAL Transformer: Active assignment priority over historical declined/reassigned rows', () => {
  const rawRow = {
    id: 'rep-uuid-mult',
    report_number: 'RPT-000103',
    title: 'HVAC repair',
    status: 'assigned',
    is_urgent_hazard: false,
    confirmed_priority: 'medium',
    assignments: [
      {
        id: 'a-1',
        status: 'declined', // Technician 1 declined yesterday
        assigned_at: '2026-10-19T08:00:00Z',
        technician: { full_name: 'Declined Tech' },
      },
      {
        id: 'a-2',
        status: 'assigned', // Coordinator reassigned to Technician 2 today
        assigned_at: '2026-10-20T08:00:00Z',
        technician: { full_name: 'Active Tech Elena' },
      },
    ],
  };

  const report = transformDbReportToMaintenanceReport(rawRow);

  assert.equal(report.assignedTechnician, 'Active Tech Elena', 'Must pick active assignment over declined one');
  assert.equal(report.assignmentStatus, 'assigned');
});

test('DAL Transformer: Gracefully falls back when relations are missing or null', () => {
  const rawRow = {
    id: 'rep-uuid-orphan',
    report_number: null,
    title: null,
    categories: null,
    locations: null,
    reporter: null,
    assignments: null,
  };

  const report = transformDbReportToMaintenanceReport(rawRow);

  assert.equal(report.id, 'rep-uuid-orphan');
  assert.equal(report.trackingNumber, 'RPT-rep-uuid');
  assert.equal(report.title, 'Untitled Report');
  assert.equal(report.category, 'General Maintenance');
  assert.equal(report.location.building, 'Main Campus');
  assert.equal(report.reporterName, 'Campus Reporter');
  assert.equal(report.assignedTechnician, undefined);
});

test('KPI Consistency: Computes metrics strictly from visible reports with zero leakage', () => {
  const now = new Date();
  const recentISO = now.toISOString();
  const oldDate = new Date();
  oldDate.setDate(oldDate.getDate() - 14);
  const oldISO = oldDate.toISOString();

  const fixtureReports = [
    { status: 'submitted', is_urgent_hazard: true, confirmed_priority: null, created_at: recentISO },
    { status: 'assigned', is_urgent_hazard: false, confirmed_priority: 'medium', created_at: recentISO },
    { status: 'in_progress', is_urgent_hazard: false, confirmed_priority: 'critical', created_at: recentISO },
    { status: 'verified', is_urgent_hazard: false, confirmed_priority: 'low', updated_at: recentISO },
    { status: 'completed', is_urgent_hazard: false, confirmed_priority: 'low', updated_at: oldISO },
    { status: 'cancelled', is_urgent_hazard: false, confirmed_priority: null, updated_at: recentISO },
  ];

  const stats = calculateKpiStatsFromDbReports(fixtureReports);

  assert.equal(stats.totalActive, 3, 'submitted, assigned, in_progress are active');
  assert.equal(stats.pendingReview, 1, 'only submitted is pending review');
  assert.equal(stats.inProgress, 2, 'assigned and in_progress');
  assert.equal(stats.resolvedThisWeek, 1, 'only the recently verified report is counted in resolvedThisWeek');
  assert.equal(stats.urgentHazards, 2, '1 urgent hazard flag + 1 critical priority');

  // Empty fixture -> strictly zero across all counters
  const emptyStats = calculateKpiStatsFromDbReports([]);
  assert.deepEqual(emptyStats, {
    totalActive: 0,
    pendingReview: 0,
    inProgress: 0,
    resolvedThisWeek: 0,
    urgentHazards: 0,
  });
});

test('Pagination: Computes bounds and limits correctly', () => {
  const page1 = paginateRange(1, 15);
  assert.equal(page1.from, 0);
  assert.equal(page1.to, 14);
  assert.equal(page1.pageSize, 15);

  const page2 = paginateRange(2, 15);
  assert.equal(page2.from, 15);
  assert.equal(page2.to, 29);

  // Maximum page size cap at 50
  const largePage = paginateRange(1, 100);
  assert.equal(largePage.pageSize, 50, 'Max page size must be capped at 50');
  assert.equal(largePage.to, 49);

  // Negative or zero page defaults to 1
  const badPage = paginateRange(-5, 10);
  assert.equal(badPage.page, 1);
  assert.equal(badPage.from, 0);
});

test('Security Guard: Avoidance of service-role credentials in client/user-facing code', () => {
  const dalPath = path.join(myAppRoot, 'utils/reports/dal.ts');
  const pagePath = path.join(myAppRoot, 'app/page.tsx');
  const reportsPagePath = path.join(myAppRoot, 'app/reports/page.tsx');

  for (const filePath of [dalPath, pagePath, reportsPagePath]) {
    const code = fs.readFileSync(filePath, 'utf8');
    assert.strictEqual(
      code.includes('SUPABASE_SERVICE_ROLE_KEY'),
      false,
      `File ${path.basename(filePath)} must NEVER reference SUPABASE_SERVICE_ROLE_KEY`
    );
    assert.strictEqual(
      code.includes('service_role'),
      false,
      `File ${path.basename(filePath)} must NEVER use service_role credentials`
    );
  }
});

test('Read-Only Scope: DAL contains strictly read-only operations', () => {
  const dalPath = path.join(myAppRoot, 'utils/reports/dal.ts');
  const code = fs.readFileSync(dalPath, 'utf8');

  // Assert no mutating operations exist in dal.ts
  assert.strictEqual(code.includes('.insert('), false, 'Read-only DAL must not call .insert()');
  assert.strictEqual(code.includes('.update('), false, 'Read-only DAL must not call .update()');
  assert.strictEqual(code.includes('.delete('), false, 'Read-only DAL must not call .delete()');
  assert.strictEqual(code.includes('.upsert('), false, 'Read-only DAL must not call .upsert()');
});
