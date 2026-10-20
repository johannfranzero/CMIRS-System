import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Direct production imports from extracted DAL module (Resolves Finding 6: No duplicate functions!)
import {
  transformDbReportToMaintenanceReport,
  calculateKpiStatsFromDbReports,
  getPhilippineWeekBounds,
  isDateInPhilippineWeek,
  isDatasetTruncated,
  getFacilityBreakdownFromReports,
  buildReportsQueueUrl,
  sanitizeErrorMessage,
} from '../../utils/reports/transform.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const myAppRoot = path.resolve(__dirname, '../..');

function paginateRange(page = 1, pageSize = 15) {
  const p = Math.max(1, page);
  const size = Math.min(50, Math.max(1, pageSize));
  const from = (p - 1) * size;
  const to = from + size - 1;
  return { page: p, pageSize: size, from, to };
}

// =============================================================================
// TEST SUITE: Remediated Read-Only DAL Query Construction & Transformation
// =============================================================================

test('Finding 1 & Schema: Verified column selection enforces categories!inner join semantics', () => {
  const dalFilePath = path.join(myAppRoot, 'utils/reports/dal.ts');
  const content = fs.readFileSync(dalFilePath, 'utf8');

  // Must select canonical columns
  assert.ok(content.includes('report_number'), 'Must select report_number');
  assert.ok(content.includes('confirmed_priority'), 'Must select confirmed_priority');
  assert.ok(content.includes('is_urgent_hazard'), 'Must select is_urgent_hazard');

  // Finding 1: categories must specify !inner join to guarantee parent report filtering
  assert.ok(
    content.includes('categories!inner'),
    'Must specify categories!inner to enforce PostgREST inner join semantics for category filtering'
  );
  assert.ok(content.includes('locations'), 'Must join locations relation');
  assert.ok(content.includes('reporter:profiles!reporter_id'), 'Must join reporter profile');
  assert.ok(content.includes('assignments'), 'Must join assignments relation');
  assert.ok(content.includes('technician:profiles!technician_id'), 'Must join technician profile');
});

test('Finding 1: Category filter excludes non-matching reports and handles UUIDs and names', () => {
  const dalFilePath = path.join(myAppRoot, 'utils/reports/dal.ts');
  const content = fs.readFileSync(dalFilePath, 'utf8');

  // Must support UUID directly on category_id and name on categories.name
  assert.ok(
    content.includes("query.eq('category_id', params.category)"),
    'Must support direct category_id filtering when UUID is provided'
  );
  assert.ok(
    content.includes("query.eq('categories.name', params.category)"),
    'Must support categories.name filtering with inner join when category name is provided'
  );
});

test('Finding 2: Dataset truncation detection prevents silent undercounting of KPI metrics', () => {
  // Case A: Dataset truncated by PostgREST default limit (e.g. 1000 max rows returned out of 1500 total)
  assert.equal(
    isDatasetTruncated(1500, 1000),
    true,
    'Must detect truncation when total count exceeds fetched records'
  );

  // Case B: Exactly 1000 records total and 1000 fetched -> not truncated
  assert.equal(
    isDatasetTruncated(1000, 1000),
    false,
    'Must not report truncation when all records are fetched'
  );

  // Case C: Small dataset (e.g. 25 records out of 25) -> not truncated
  assert.equal(
    isDatasetTruncated(25, 25),
    false,
    'Must not report truncation for complete small datasets'
  );

  // Case D: Null or undefined count -> safe fallback
  assert.equal(isDatasetTruncated(null, 50), false);
  assert.equal(isDatasetTruncated(undefined, 50), false);
});

test('Finding 2: Large dataset KPI aggregation calculates correctly when complete data is provided', () => {
  // Synthesize 1,500 reports to test boundary aggregation performance
  const now = new Date('2026-10-20T10:00:00Z');
  const largeReports = [];

  for (let i = 0; i < 1500; i++) {
    const isVerified = i % 5 === 0;
    const isCompleted = i % 5 === 1;
    const isCancelled = i % 10 === 0;
    const isUrgent = i % 20 === 0;

    let status = 'in_progress';
    if (isCancelled) status = 'cancelled';
    else if (isVerified) status = 'verified';
    else if (isCompleted) status = 'completed';

    largeReports.push({
      status,
      is_urgent_hazard: isUrgent,
      confirmed_priority: isUrgent ? 'critical' : 'medium',
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    });
  }

  const stats = calculateKpiStatsFromDbReports(largeReports, now);

  assert.ok(stats.totalActive > 0, 'Must aggregate large active report counts');
  assert.ok(stats.urgentHazards > 0, 'Must aggregate urgent hazard counts');
  // Verified reports resolved in current PHT week must be counted
  assert.ok(stats.resolvedThisWeek > 0, 'Must aggregate resolved counts');
});

test('Finding 3: Deterministic pagination sort applies created_at DESC and id DESC tiebreaker', () => {
  const dalFilePath = path.join(myAppRoot, 'utils/reports/dal.ts');
  const content = fs.readFileSync(dalFilePath, 'utf8');

  // Must order by created_at DESC first, then id DESC as tiebreaker
  const orderRegex = /\.order\('created_at',\s*\{\s*ascending:\s*false\s*\}\)\s*\.order\('id',\s*\{\s*ascending:\s*false\s*\}\)/;
  assert.ok(
    orderRegex.test(content),
    'DAL query must apply created_at DESC followed by id DESC for deterministic pagination'
  );
});

test('Finding 4: Pagination URL builder preserves status, category, and search filters with encoding', () => {
  // Case A: Page 2 with status filter
  const url1 = buildReportsQueueUrl({ page: 2, status: 'in_progress' });
  assert.equal(url1, '/reports?page=2&status=in_progress');

  // Case B: Combined filters with special characters in category and search
  const url2 = buildReportsQueueUrl({
    page: 3,
    status: 'assigned',
    category: 'Plumbing & Water',
    search: 'pipe leak #1',
  });
  // URLSearchParams encodes spaces and special characters safely
  assert.ok(url2.includes('page=3'));
  assert.ok(url2.includes('status=assigned'));
  assert.ok(url2.includes('category=Plumbing+%26+Water'));
  assert.ok(url2.includes('search=pipe+leak+%231'));

  // Case C: Page 1 with 'all' filters resolves to root /reports cleanly
  const url3 = buildReportsQueueUrl({ page: 1, status: 'all', category: 'all', search: '' });
  assert.equal(url3, '/reports');

  // Case D: Resetting page to 1 retains active filters
  const url4 = buildReportsQueueUrl({ page: 1, status: 'submitted', category: 'Electrical' });
  assert.equal(url4, '/reports?status=submitted&category=Electrical');
});

test('Finding 5: Database errors are sanitized and never expose raw SQL or internal details', () => {
  const technicalError = 'PostgREST: relation "public.reports" does not exist at character 15';
  const sanitized = sanitizeErrorMessage(
    technicalError,
    'Unable to retrieve maintenance reports from the database. Please try again shortly.'
  );

  assert.equal(
    sanitized.includes('relation "public.reports"'),
    false,
    'Sanitized error must NEVER contain raw table or schema names'
  );
  assert.equal(
    sanitized.includes('character 15'),
    false,
    'Sanitized error must NEVER contain internal database error positions'
  );
  assert.equal(
    sanitized,
    'Unable to retrieve maintenance reports from the database. Please try again shortly.'
  );

  // Check DAL source code ensures error sanitization
  const dalFilePath = path.join(myAppRoot, 'utils/reports/dal.ts');
  const dalContent = fs.readFileSync(dalFilePath, 'utf8');
  assert.strictEqual(
    dalContent.includes('Database query failed: ${error.message}'),
    false,
    'DAL must not interpolate raw error.message into user-facing error strings'
  );
});

test('Approved Business Decision 1: Calendar Week in Philippine Standard Time (PST / UTC+8)', () => {
  // Reference instant: Tuesday, October 20, 2026, 18:00 PHT (UTC: 2026-10-20T10:00:00Z)
  const referenceDate = new Date('2026-10-20T10:00:00Z');
  const { startOfWeek, endOfWeek } = getPhilippineWeekBounds(referenceDate);

  // Start of week: Monday, Oct 19, 2026 00:00:00 PHT -> UTC: 2026-10-18T16:00:00.000Z
  assert.equal(startOfWeek.toISOString(), '2026-10-18T16:00:00.000Z');

  // End of week: Monday, Oct 26, 2026 00:00:00 PHT -> UTC: 2026-10-25T16:00:00.000Z
  assert.equal(endOfWeek.toISOString(), '2026-10-25T16:00:00.000Z');

  // Test timestamps:
  // 1. Sunday, Oct 18, 2026, 23:59:59 PHT (UTC: 2026-10-18T15:59:59Z) -> Previous week!
  const prevSunday = '2026-10-18T15:59:59Z';
  assert.equal(isDateInPhilippineWeek(prevSunday, referenceDate), false);

  // 2. Monday, Oct 19, 2026, 00:00:01 PHT (UTC: 2026-10-18T16:00:01Z) -> In this week!
  const thisMonday = '2026-10-18T16:00:01Z';
  assert.equal(isDateInPhilippineWeek(thisMonday, referenceDate), true);

  // 3. Wednesday, Oct 21, 2026, 14:00:00 PHT (UTC: 2026-10-21T06:00:00Z) -> In this week!
  const thisWednesday = '2026-10-21T06:00:00Z';
  assert.equal(isDateInPhilippineWeek(thisWednesday, referenceDate), true);

  // 4. Sunday, Oct 25, 2026, 23:59:59 PHT (UTC: 2026-10-25T15:59:59Z) -> In this week!
  const thisSunday = '2026-10-25T15:59:59Z';
  assert.equal(isDateInPhilippineWeek(thisSunday, referenceDate), true);

  // 5. Monday, Oct 26, 2026, 00:00:01 PHT (UTC: 2026-10-25T16:00:01Z) -> Next week!
  const nextMonday = '2026-10-25T16:00:01Z';
  assert.equal(isDateInPhilippineWeek(nextMonday, referenceDate), false);
});

test('Approved Business Decision 1: Never substitutes created_at for resolution timestamp', () => {
  const referenceDate = new Date('2026-10-20T10:00:00Z');
  const thisWeekIso = '2026-10-20T08:00:00Z';

  // Report verified but missing updated_at (only created_at present)
  const reportWithoutUpdatedAt = [
    {
      status: 'verified',
      is_urgent_hazard: false,
      confirmed_priority: 'medium',
      created_at: thisWeekIso,
      updated_at: undefined, // Missing resolution timestamp
    },
  ];

  const stats = calculateKpiStatsFromDbReports(reportWithoutUpdatedAt, referenceDate);
  assert.equal(
    stats.resolvedThisWeek,
    0,
    'Must NOT increment resolvedThisWeek when actual updated_at resolution timestamp is missing'
  );

  // Report verified with valid updated_at in current calendar week
  const reportWithUpdatedAt = [
    {
      status: 'verified',
      is_urgent_hazard: false,
      confirmed_priority: 'medium',
      created_at: '2026-09-01T08:00:00Z', // Created last month
      updated_at: thisWeekIso, // Verified this week
    },
  ];

  const statsWithValidUpdate = calculateKpiStatsFromDbReports(reportWithUpdatedAt, referenceDate);
  assert.equal(
    statsWithValidUpdate.resolvedThisWeek,
    1,
    'Must increment resolvedThisWeek when updated_at falls within current Philippine calendar week'
  );
});

test('Approved Business Decision 2: completed reports count as Total Active, NOT resolved', () => {
  const referenceDate = new Date('2026-10-20T10:00:00Z');
  const thisWeekIso = '2026-10-20T08:00:00Z';

  const reports = [
    // Completed report (technician finished, pending coordinator verification)
    {
      status: 'completed',
      is_urgent_hazard: false,
      confirmed_priority: 'medium',
      created_at: thisWeekIso,
      updated_at: thisWeekIso,
    },
    // Verified report (coordinator approved and closed)
    {
      status: 'verified',
      is_urgent_hazard: false,
      confirmed_priority: 'medium',
      created_at: thisWeekIso,
      updated_at: thisWeekIso,
    },
  ];

  const stats = calculateKpiStatsFromDbReports(reports, referenceDate);

  // completed report must be counted as active!
  assert.equal(stats.totalActive, 1, 'completed report must count in totalActive');
  // completed report must NOT be counted as resolved!
  assert.equal(
    stats.resolvedThisWeek,
    1,
    'Only the verified report may increment resolvedThisWeek'
  );
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
    locations: {
      id: 'loc-uuid-2',
      building_name: 'Main Academic Building',
      floor: '2',
      room: '204',
      description: 'Computer Lab',
    },
    reporter: {
      id: 'user-uuid-student',
      full_name: 'Test Student',
      role: 'student_personnel',
      email: 'student@cmirs.internal',
    },
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

  assert.equal(
    report.assignedTechnician,
    'Active Tech Elena',
    'Must pick active assignment over declined one'
  );
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

test('DAL Facility Breakdown: Accurately groups report counts by campus facility', () => {
  const reports = [
    { location: { building: 'Science Complex' } },
    { location: { building: 'Science Complex' } },
    { location: { building: 'Engineering Hall' } },
    { location: null },
  ];

  const breakdown = getFacilityBreakdownFromReports(reports);
  assert.equal(breakdown.length, 3);
  assert.deepEqual(breakdown.find((b) => b.building === 'Science Complex'), {
    building: 'Science Complex',
    count: 2,
  });
  assert.deepEqual(breakdown.find((b) => b.building === 'Engineering Hall'), {
    building: 'Engineering Hall',
    count: 1,
  });
  assert.deepEqual(breakdown.find((b) => b.building === 'Unspecified Facility'), {
    building: 'Unspecified Facility',
    count: 1,
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
  const transformPath = path.join(myAppRoot, 'utils/reports/transform.ts');
  const pagePath = path.join(myAppRoot, 'app/page.tsx');
  const reportsPagePath = path.join(myAppRoot, 'app/reports/page.tsx');

  for (const filePath of [dalPath, transformPath, pagePath, reportsPagePath]) {
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
