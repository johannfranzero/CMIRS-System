import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Phase 2.5 Unit Test Suite:
 * Role-Aware Mock Report Filtering, Data Isolation & Dashboard Statistics
 */

// Implementation under test (pure logic mirror from utils/reports/mock-filter.ts)
function filterMockReportsForRole(reports, user) {
  if (!user || !user.profile || !user.profile.is_active) {
    return [];
  }

  const role = user.profile.role;
  const userId = user.id ? user.id.trim() : '';
  const userEmail = user.email ? user.email.trim().toLowerCase() : '';
  const userFullName = user.profile.full_name ? user.profile.full_name.trim().toLowerCase() : '';

  // 1. Campus-wide oversight roles see all reports
  if (role === 'coordinator' || role === 'administrator' || role === 'management') {
    return [...reports];
  }

  // Helper: Check if report was submitted by caller
  const isReporter = (report) => {
    if (userId && report.reporterId && report.reporterId === userId) {
      return true;
    }
    if (userEmail && report.reporterEmail && report.reporterEmail.trim().toLowerCase() === userEmail) {
      return true;
    }
    if (userFullName && report.reporterName && report.reporterName.trim().toLowerCase() === userFullName) {
      return true;
    }
    return false;
  };

  // Helper: Check if report is assigned to caller (and not declined)
  const isAssignedTechnician = (report) => {
    // Explicit exclusion of declined assignments (Approved decision OD-NEW-4)
    if (report.assignmentStatus === 'declined') {
      return false;
    }

    if (userId && report.assignedTechnicianId && report.assignedTechnicianId === userId) {
      return true;
    }
    if (
      userEmail &&
      report.assignedTechnicianEmail &&
      report.assignedTechnicianEmail.trim().toLowerCase() === userEmail
    ) {
      return true;
    }
    if (
      userFullName &&
      report.assignedTechnician &&
      report.assignedTechnician.trim().toLowerCase() === userFullName
    ) {
      return true;
    }
    return false;
  };

  // 2. Student Personnel: only reports submitted by the current user
  if (role === 'student_personnel') {
    return reports.filter(isReporter);
  }

  // 3. Maintenance Technician: assigned reports (non-declined) + own submitted reports
  if (role === 'technician') {
    return reports.filter((r) => isAssignedTechnician(r) || isReporter(r));
  }

  // Fails closed for any unmapped role
  return [];
}

function calculateRoleDashboardStats(filteredReports) {
  let totalActive = 0;
  let pendingReview = 0;
  let inProgress = 0;
  let resolvedThisWeek = 0;
  let urgentHazards = 0;

  for (const report of filteredReports) {
    const isResolved = report.status === 'completed' || report.status === 'verified';
    const isCancelled = report.status === 'cancelled';
    const isActive = !isResolved && !isCancelled;

    if (isActive) {
      totalActive += 1;
    }

    if (report.status === 'submitted' || report.status === 'under_review') {
      pendingReview += 1;
    }

    if (
      report.status === 'assigned' ||
      report.status === 'in_progress' ||
      report.status === 'on_hold'
    ) {
      inProgress += 1;
    }

    if (isResolved) {
      resolvedThisWeek += 1;
    }

    if (report.isUrgentHazard || report.priority === 'critical') {
      urgentHazards += 1;
    }
  }

  return {
    totalActive,
    pendingReview,
    inProgress,
    resolvedThisWeek,
    urgentHazards,
  };
}

function getFacilityBreakdown(filteredReports) {
  const countsByBuilding = new Map();

  for (const report of filteredReports) {
    const bldg = report.location?.building || 'Unspecified Facility';
    countsByBuilding.set(bldg, (countsByBuilding.get(bldg) || 0) + 1);
  }

  return Array.from(countsByBuilding.entries()).map(([building, count]) => ({
    building,
    count,
  }));
}

function getRoleDashboardConfig(role, firstName, stats) {
  switch (role) {
    case 'student_personnel':
      return {
        welcomeMessage:
          stats.totalActive > 0
            ? `Welcome back, ${firstName}. You have ${stats.totalActive} active maintenance request${stats.totalActive === 1 ? '' : 's'} in progress.`
            : `Welcome back, ${firstName}. You currently have no active maintenance requests submitted.`,
        tableTitle: 'My Incident & Maintenance Submissions',
        tableDescription:
          'Track status updates, priority classifications, and repair progress for your reported campus issues.',
        cards: [
          { title: 'My Active Reports', description: 'Submitted by your account' },
          { title: 'Pending Triage', description: 'Awaiting coordinator review' },
          { title: 'In Progress', description: 'Being repaired by technicians' },
          { title: 'Urgent Hazards', description: 'Flagged for safety priority' },
        ],
      };

    case 'technician':
      return {
        welcomeMessage:
          stats.totalActive > 0
            ? `Welcome back, ${firstName}. You have ${stats.totalActive} assigned maintenance task${stats.totalActive === 1 ? '' : 's'} in your queue.`
            : `Welcome back, ${firstName}. Your service queue is currently clear with no active assigned tasks.`,
        tableTitle: 'My Assigned Work Orders',
        tableDescription:
          'Execute repairs, log progress updates, place work on hold, or complete assigned work orders.',
        cards: [
          { title: 'Assigned Tasks', description: 'Active tasks in your work queue' },
          { title: 'Pending Start', description: 'Assigned or on hold' },
          { title: 'In Progress', description: 'Repairs currently underway' },
          { title: 'Urgent Hazards', description: 'Critical priority safety tasks' },
        ],
      };

    case 'coordinator':
      return {
        welcomeMessage:
          stats.urgentHazards > 0
            ? `Welcome back, ${firstName}. ${stats.urgentHazards} urgent hazard${stats.urgentHazards === 1 ? '' : 's'} require immediate coordinator triage.`
            : `Welcome back, ${firstName}. Campus facilities monitoring ${stats.totalActive} active reports across all zones.`,
        tableTitle: 'Campus Incident & Maintenance Queue',
        tableDescription:
          'Triage newly submitted issues, confirm severity priorities, dispatch technicians, and verify completed repairs.',
        cards: [
          { title: 'Total Active', description: 'Across 5 campus buildings' },
          { title: 'Pending Triage', description: 'Awaiting coordinator review' },
          { title: 'In Progress', description: 'Assigned to field technicians' },
          { title: 'Critical Hazards', description: 'Immediate safety risk flagged' },
        ],
      };

    case 'administrator':
      return {
        welcomeMessage: `Welcome back, ${firstName}. Administrative overview active across ${stats.totalActive} campus maintenance report${stats.totalActive === 1 ? '' : 's'}.`,
        tableTitle: 'Campus Incident & Maintenance Queue',
        tableDescription:
          'Comprehensive administrative oversight of maintenance operations, facility locations, and role access.',
        cards: [
          { title: 'Total Active', description: 'Across all campus facilities' },
          { title: 'Pending Triage', description: 'Awaiting coordinator review' },
          { title: 'In Progress', description: 'Active technician assignments' },
          { title: 'Critical Hazards', description: 'Active safety hazard flags' },
        ],
      };

    case 'management':
      return {
        welcomeMessage: `Welcome back, ${firstName}. Executive facility performance and SLA monitoring across ${stats.totalActive} active report${stats.totalActive === 1 ? '' : 's'}.`,
        tableTitle: 'Campus Incident & Maintenance Queue',
        tableDescription:
          'Read-only operational analytics, facility resolution rates, and preventative maintenance oversight.',
        cards: [
          { title: 'Total Active', description: 'Campus operational load' },
          { title: 'Pending Triage', description: 'Awaiting coordinator review' },
          { title: 'In Progress', description: 'Active technician assignments' },
          { title: 'Critical Hazards', description: 'Urgent safety hazard alerts' },
        ],
      };
    default:
      return null;
  }
}

// Sample test fixture representing mixed reports
const FIXTURE_REPORTS = [
  {
    id: 'rep-01',
    trackingNumber: 'REP-2026-0001',
    title: 'Water leak in CS server room',
    reporterId: 'user-student-1',
    reporterEmail: 'student1@cmirs.internal',
    reporterName: 'Alice Student',
    reporterRole: 'Student',
    location: { building: 'Science Complex' },
    status: 'in_progress',
    priority: 'critical',
    isUrgentHazard: true,
    assignedTechnicianId: 'user-tech-1',
    assignedTechnicianEmail: 'tech1@cmirs.internal',
    assignedTechnician: 'Bob Tech',
    assignmentStatus: 'in_progress',
  },
  {
    id: 'rep-02',
    trackingNumber: 'REP-2026-0002',
    title: 'Projector buzzing in Hall 101',
    reporterId: 'user-student-2',
    reporterEmail: 'student2@cmirs.internal',
    reporterName: 'Charlie Student',
    reporterRole: 'Student',
    location: { building: 'Main Academic Building' },
    status: 'under_review',
    priority: 'medium',
    isUrgentHazard: false,
    assignedTechnician: undefined,
  },
  {
    id: 'rep-03',
    trackingNumber: 'REP-2026-0003',
    title: 'Broken window latch',
    reporterId: 'user-student-1',
    reporterEmail: 'student1@cmirs.internal',
    reporterName: 'Alice Student',
    reporterRole: 'Student',
    location: { building: 'Science Complex' },
    status: 'completed',
    priority: 'low',
    isUrgentHazard: false,
    assignedTechnicianId: 'user-tech-2',
    assignedTechnicianEmail: 'tech2@cmirs.internal',
    assignedTechnician: 'Dave Tech',
    assignmentStatus: 'completed',
  },
  {
    id: 'rep-04',
    trackingNumber: 'REP-2026-0004',
    title: 'HVAC repair declined by Tech 1',
    reporterId: 'user-faculty-1',
    reporterEmail: 'faculty@cmirs.internal',
    reporterName: 'Prof. Vance',
    reporterRole: 'Faculty',
    location: { building: 'Library' },
    status: 'assigned',
    priority: 'high',
    isUrgentHazard: false,
    assignedTechnicianId: 'user-tech-1',
    assignedTechnicianEmail: 'tech1@cmirs.internal',
    assignedTechnician: 'Bob Tech',
    assignmentStatus: 'declined', // DECLINED ASSIGNMENT (OD-NEW-4)
  },
  {
    id: 'rep-05',
    trackingNumber: 'REP-2026-0005',
    title: 'Tool chest lock repair submitted by Tech 1',
    reporterId: 'user-tech-1',
    reporterEmail: 'tech1@cmirs.internal',
    reporterName: 'Bob Tech',
    reporterRole: 'Maintenance Technician',
    location: { building: 'Maintenance Depot' },
    status: 'submitted',
    priority: 'low',
    isUrgentHazard: false,
    assignedTechnician: undefined,
  },
];

// =============================================================================
// TEST CASES
// =============================================================================

test('Filter: Student Personnel sees only own submissions', () => {
  const studentUser = {
    id: 'user-student-1',
    email: 'student1@cmirs.internal',
    profile: {
      id: 'user-student-1',
      full_name: 'Alice Student',
      role: 'student_personnel',
      is_active: true,
    },
  };

  const results = filterMockReportsForRole(FIXTURE_REPORTS, studentUser);
  const ids = results.map((r) => r.id);

  assert.deepEqual(ids, ['rep-01', 'rep-03']);
  assert.equal(ids.includes('rep-02'), false, 'Cannot see other student report');
  assert.equal(ids.includes('rep-04'), false, 'Cannot see faculty report');
  assert.equal(ids.includes('rep-05'), false, 'Cannot see technician report');
});

test('Filter: Student Personnel matching by email fallback', () => {
  const studentByEmail = {
    id: 'random-uuid-999',
    email: 'student2@cmirs.internal',
    profile: {
      id: 'random-uuid-999',
      full_name: 'Charlie Student',
      role: 'student_personnel',
      is_active: true,
    },
  };

  const results = filterMockReportsForRole(FIXTURE_REPORTS, studentByEmail);
  assert.equal(results.length, 1);
  assert.equal(results[0].id, 'rep-02');
});

test('Filter: Student Personnel with no matching reports returns empty array (empty result)', () => {
  const newStudent = {
    id: 'new-student-uuid',
    email: 'test-student@cmirs.internal',
    profile: {
      id: 'new-student-uuid',
      full_name: 'Brand New Student',
      role: 'student_personnel',
      is_active: true,
    },
  };

  const results = filterMockReportsForRole(FIXTURE_REPORTS, newStudent);
  assert.deepEqual(results, []);
});

test('Filter: Technician sees assigned work orders + own submissions', () => {
  const techUser = {
    id: 'user-tech-1',
    email: 'tech1@cmirs.internal',
    profile: {
      id: 'user-tech-1',
      full_name: 'Bob Tech',
      role: 'technician',
      is_active: true,
    },
  };

  const results = filterMockReportsForRole(FIXTURE_REPORTS, techUser);
  const ids = results.map((r) => r.id);

  // rep-01: assigned to Tech 1 (in_progress) -> visible
  assert.equal(ids.includes('rep-01'), true);

  // rep-04: assigned to Tech 1 BUT status is DECLINED -> MUST BE EXCLUDED (OD-NEW-4)
  assert.equal(ids.includes('rep-04'), false, 'Declined assignment must be excluded');

  // rep-05: submitted by Tech 1 himself -> MUST BE VISIBLE as reporter
  assert.equal(ids.includes('rep-05'), true, 'Own submitted report must be visible to technician');

  // rep-02, rep-03: not assigned to Tech 1, not submitted by Tech 1 -> excluded
  assert.equal(ids.includes('rep-02'), false);
  assert.equal(ids.includes('rep-03'), false);

  assert.deepEqual(ids.sort(), ['rep-01', 'rep-05'].sort());
});

test('Filter: Technician with no assigned work and no submissions returns empty array', () => {
  const unassignedTech = {
    id: 'tech-idle-uuid',
    email: 'idle-tech@cmirs.internal',
    profile: {
      id: 'tech-idle-uuid',
      full_name: 'Idle Technician',
      role: 'technician',
      is_active: true,
    },
  };

  const results = filterMockReportsForRole(FIXTURE_REPORTS, unassignedTech);
  assert.deepEqual(results, []);
});

test('Filter: Coordinator role sees all campus-wide reports', () => {
  const coordUser = {
    id: 'coord-uuid',
    email: 'coordinator@cmirs.internal',
    profile: {
      id: 'coord-uuid',
      full_name: 'Jordan Miller',
      role: 'coordinator',
      is_active: true,
    },
  };

  const results = filterMockReportsForRole(FIXTURE_REPORTS, coordUser);
  assert.equal(results.length, FIXTURE_REPORTS.length);
  assert.deepEqual(results.map((r) => r.id), FIXTURE_REPORTS.map((r) => r.id));
});

test('Filter: Administrator role sees all campus-wide reports', () => {
  const adminUser = {
    id: 'admin-uuid',
    email: 'admin@cmirs.internal',
    profile: {
      id: 'admin-uuid',
      full_name: 'Campus Admin',
      role: 'administrator',
      is_active: true,
    },
  };

  const results = filterMockReportsForRole(FIXTURE_REPORTS, adminUser);
  assert.equal(results.length, FIXTURE_REPORTS.length);
});

test('Filter: Management role sees all campus-wide reports', () => {
  const mgmtUser = {
    id: 'mgmt-uuid',
    email: 'management@cmirs.internal',
    profile: {
      id: 'mgmt-uuid',
      full_name: 'School Management',
      role: 'management',
      is_active: true,
    },
  };

  const results = filterMockReportsForRole(FIXTURE_REPORTS, mgmtUser);
  assert.equal(results.length, FIXTURE_REPORTS.length);
});

test('Filter: Unauthenticated or inactive users fail closed (empty result)', () => {
  // 1. Unauthenticated (null user)
  assert.deepEqual(filterMockReportsForRole(FIXTURE_REPORTS, null), []);

  // 2. Inactive account (is_active === false)
  const inactiveUser = {
    id: 'u-inactive',
    profile: { role: 'coordinator', is_active: false },
  };
  assert.deepEqual(filterMockReportsForRole(FIXTURE_REPORTS, inactiveUser), []);

  // 3. User with unrecognized role
  const rogueUser = {
    id: 'u-rogue',
    profile: { role: 'super_hacker', is_active: true },
  };
  assert.deepEqual(filterMockReportsForRole(FIXTURE_REPORTS, rogueUser), []);
});

test('Statistics Consistency: Derived strictly from visible reports with zero leakage', () => {
  // 1. Student with 1 active urgent report & 1 resolved report
  const studentReports = [FIXTURE_REPORTS[0], FIXTURE_REPORTS[2]]; // rep-01 (in_progress, critical), rep-03 (completed)
  const studentStats = calculateRoleDashboardStats(studentReports);

  assert.equal(studentStats.totalActive, 1, 'Only 1 active report for student');
  assert.equal(studentStats.inProgress, 1);
  assert.equal(studentStats.pendingReview, 0);
  assert.equal(studentStats.resolvedThisWeek, 1);
  assert.equal(studentStats.urgentHazards, 1);

  // 2. Student with 0 reports -> strictly 0 across all KPI cards (no campus leak!)
  const emptyStudentStats = calculateRoleDashboardStats([]);
  assert.deepEqual(emptyStudentStats, {
    totalActive: 0,
    pendingReview: 0,
    inProgress: 0,
    resolvedThisWeek: 0,
    urgentHazards: 0,
  });

  // 3. Coordinator with full fixture -> aggregates all 5 reports
  const coordStats = calculateRoleDashboardStats(FIXTURE_REPORTS);
  assert.equal(coordStats.totalActive, 4, 'rep-01, rep-02, rep-04, rep-05 are active; rep-03 is completed');
  assert.equal(coordStats.pendingReview, 2, 'rep-02, rep-05');
  assert.equal(coordStats.inProgress, 2, 'rep-01, rep-04');
  assert.equal(coordStats.urgentHazards, 1, 'rep-01');
  assert.equal(coordStats.resolvedThisWeek, 1, 'rep-03');
});

test('Facility Breakdown: Aggregates counts strictly from visible reports', () => {
  // 1. Student who only reported in 'Science Complex'
  const studentReports = [FIXTURE_REPORTS[0], FIXTURE_REPORTS[2]]; // both in Science Complex
  const breakdown = getFacilityBreakdown(studentReports);

  assert.equal(breakdown.length, 1);
  assert.equal(breakdown[0].building, 'Science Complex');
  assert.equal(breakdown[0].count, 2);
  // Must NOT reveal reports in 'Main Academic Building' or 'Library'
  assert.equal(breakdown.some((b) => b.building === 'Main Academic Building'), false);
  assert.equal(breakdown.some((b) => b.building === 'Library'), false);

  // 2. Empty reports -> empty breakdown
  assert.deepEqual(getFacilityBreakdown([]), []);
});

test('Dashboard Configuration: Generates role-appropriate greeting and KPI card labels', () => {
  const emptyStats = { totalActive: 0, pendingReview: 0, inProgress: 0, resolvedThisWeek: 0, urgentHazards: 0 };
  const studentConfig = getRoleDashboardConfig('student_personnel', 'Alice', emptyStats);

  // Greeting must NOT contain coordinator alert text
  assert.equal(studentConfig.welcomeMessage.includes('urgent safety hazards require coordinator review'), false);
  assert.equal(studentConfig.welcomeMessage, 'Welcome back, Alice. You currently have no active maintenance requests submitted.');
  assert.equal(studentConfig.tableTitle, 'My Incident & Maintenance Submissions');
  assert.equal(studentConfig.cards[0].title, 'My Active Reports');

  // Technician greeting
  const techStats = { totalActive: 3, pendingReview: 1, inProgress: 2, resolvedThisWeek: 1, urgentHazards: 0 };
  const techConfig = getRoleDashboardConfig('technician', 'Bob', techStats);
  assert.equal(techConfig.welcomeMessage, 'Welcome back, Bob. You have 3 assigned maintenance tasks in your queue.');
  assert.equal(techConfig.tableTitle, 'My Assigned Work Orders');
  assert.equal(techConfig.cards[0].title, 'Assigned Tasks');

  // Coordinator greeting
  const coordStats = { totalActive: 6, pendingReview: 2, inProgress: 4, resolvedThisWeek: 2, urgentHazards: 2 };
  const coordConfig = getRoleDashboardConfig('coordinator', 'Jordan', coordStats);
  assert.equal(coordConfig.welcomeMessage, 'Welcome back, Jordan. 2 urgent hazards require immediate coordinator triage.');
  assert.equal(coordConfig.cards[0].title, 'Total Active');
});
