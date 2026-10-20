import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTIVE_ASSIGNMENT_STATUSES,
  calculateOperationalAnalytics,
  isAnalyticsDatasetComplete,
} from '../../utils/reports/transform.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const myAppRoot = path.resolve(__dirname, '../..');

const reports = [
  {
    id: 'report-1',
    status: 'submitted',
    confirmed_priority: null,
    is_urgent_hazard: true,
    categories: { name: 'Electrical' },
    locations: { building_name: 'Main Academic Building' },
    assignments: [
      { technician_id: 'tech-1', status: 'assigned', technician: { full_name: 'Alex Morgan' } },
    ],
  },
  {
    id: 'report-2',
    status: 'in_progress',
    confirmed_priority: 'high',
    is_urgent_hazard: false,
    categories: { name: 'Electrical' },
    locations: { building_name: 'University Library' },
    assignments: [
      { technician_id: 'tech-1', status: 'in_progress', technician: { full_name: 'Alex Morgan' } },
      { technician_id: 'tech-2', status: 'completed', technician: { full_name: 'Jordan Lee' } },
    ],
  },
  {
    id: 'report-3',
    status: 'completed',
    confirmed_priority: 'low',
    is_urgent_hazard: false,
    categories: null,
    locations: [],
    assignments: [
      { technician_id: 'tech-3', status: 'on_hold', technician: { full_name: 'Taylor Chen' } },
    ],
  },
  {
    id: 'report-4',
    status: 'verified',
    confirmed_priority: 'critical',
    is_urgent_hazard: false,
    categories: { name: 'Plumbing' },
    locations: { building_name: 'Main Academic Building' },
    assignments: [
      { technician_id: 'tech-4', status: 'cancelled', technician: { full_name: 'Sam Rivera' } },
    ],
  },
];

function countTotal(items) {
  return items.reduce((total, item) => total + item.count, 0);
}

test('Analytics transforms: distributions reconcile exactly to the RLS-visible report rows', () => {
  const analytics = calculateOperationalAnalytics(reports);

  assert.equal(analytics.totalReports, reports.length);
  assert.equal(analytics.urgentHazardReports, 1);
  assert.equal(countTotal(analytics.statusDistribution), reports.length);
  assert.equal(countTotal(analytics.priorityDistribution), reports.length);
  assert.equal(countTotal(analytics.categoryDistribution), reports.length);
  assert.equal(countTotal(analytics.locationDistribution), reports.length);
  assert.deepEqual(analytics.statusDistribution, [
    { label: 'Completed', count: 1 },
    { label: 'In Progress', count: 1 },
    { label: 'Submitted', count: 1 },
    { label: 'Verified', count: 1 },
  ]);
  assert.ok(analytics.priorityDistribution.some((item) => item.label === 'Unconfirmed' && item.count === 1));
  assert.ok(analytics.categoryDistribution.some((item) => item.label === 'Uncategorized' && item.count === 1));
  assert.ok(analytics.locationDistribution.some((item) => item.label === 'Unspecified location' && item.count === 1));
});

test('Analytics transforms: workload counts only current active assignment statuses', () => {
  const analytics = calculateOperationalAnalytics(reports);

  assert.deepEqual(ACTIVE_ASSIGNMENT_STATUSES, ['assigned', 'in_progress', 'on_hold']);
  assert.equal(analytics.activeAssignments, 3);
  assert.deepEqual(analytics.technicianWorkload, [
    { technicianId: 'tech-1', technicianName: 'Alex Morgan', activeAssignments: 2 },
    { technicianId: 'tech-3', technicianName: 'Taylor Chen', activeAssignments: 1 },
  ]);
});

test('Analytics transforms: empty and partially populated records use safe labels', () => {
  const emptyAnalytics = calculateOperationalAnalytics([]);
  assert.equal(emptyAnalytics.totalReports, 0);
  assert.equal(emptyAnalytics.urgentHazardReports, 0);
  assert.deepEqual(emptyAnalytics.statusDistribution, []);
  assert.deepEqual(emptyAnalytics.technicianWorkload, []);

  const missingFields = calculateOperationalAnalytics([
    { id: 'report-missing', assignments: [{ status: 'assigned' }] },
  ]);
  assert.deepEqual(missingFields.statusDistribution, [{ label: 'Unspecified status', count: 1 }]);
  assert.deepEqual(missingFields.priorityDistribution, [{ label: 'Unconfirmed', count: 1 }]);
  assert.deepEqual(missingFields.categoryDistribution, [{ label: 'Uncategorized', count: 1 }]);
  assert.deepEqual(missingFields.locationDistribution, [{ label: 'Unspecified location', count: 1 }]);
  assert.deepEqual(missingFields.technicianWorkload, [
    { technicianId: 'unassigned', technicianName: 'Unassigned technician', activeAssignments: 1 },
  ]);
});

test('Analytics completeness: exact count is required and truncated data is refused', () => {
  assert.equal(isAnalyticsDatasetComplete(4, 4), true);
  assert.equal(isAnalyticsDatasetComplete(1001, 1000), false);
  assert.equal(isAnalyticsDatasetComplete(null, 10), false);
  assert.equal(isAnalyticsDatasetComplete(undefined, 10), false);
  assert.equal(isAnalyticsDatasetComplete(5, 4), false);
});

test('Analytics DAL: exact-count bounded RLS query returns no partial analytics on errors or truncation', () => {
  const dal = fs.readFileSync(path.join(myAppRoot, 'utils/reports/dal.ts'), 'utf8');
  const functionStart = dal.indexOf('export async function getOperationalAnalytics');
  const functionEnd = dal.indexOf('\n// =============================================================================', functionStart);
  const functionBody = dal.slice(functionStart, functionEnd);

  assert.ok(functionBody.includes(".from('reports')"));
  assert.ok(functionBody.includes(".select(SELECT_ANALYTICS_REPORTS_FIELDS, { count: 'exact' })"));
  assert.ok(functionBody.includes('.range(0, ANALYTICS_MAX_REPORT_ROWS - 1)'));
  assert.ok(functionBody.includes('isAnalyticsDatasetComplete(count, reports.length)'));
  assert.ok(functionBody.includes("state: 'incomplete'"));
  assert.ok(functionBody.includes('analytics: null'));
  assert.equal(functionBody.includes('getReportsQueue'), false);
  assert.equal(functionBody.includes('FALLBACK_'), false);
});

test('Analytics page: retains server guard, scope disclosure, error state, and loading UI', () => {
  const page = fs.readFileSync(path.join(myAppRoot, 'app/analytics/page.tsx'), 'utf8');
  const loading = fs.readFileSync(path.join(myAppRoot, 'app/analytics/loading.tsx'), 'utf8');
  const navigation = fs.readFileSync(path.join(myAppRoot, 'config/navigation.ts'), 'utf8');

  assert.ok(page.includes("requireRole(['coordinator', 'administrator', 'management'], '/analytics')"));
  assert.ok(page.includes('RLS-visible reporting scope'));
  assert.ok(page.includes('No partial totals are displayed.'));
  assert.ok(page.includes('getOperationalAnalytics()'));
  assert.ok(loading.includes('role="status"'));
  assert.ok(loading.includes('Loading operational analytics'));

  const analyticsNavigation = navigation.slice(
    navigation.indexOf("name: 'Operations Analytics'"),
    navigation.indexOf("name: 'Settings'")
  );
  assert.ok(analyticsNavigation.includes("allowedRoles: ['coordinator', 'administrator', 'management']"));
  assert.ok(analyticsNavigation.includes("badge: 'Active'"));
  assert.ok(analyticsNavigation.includes('isPlaceholder: false'));
});
