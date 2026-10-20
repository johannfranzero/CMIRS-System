import { MaintenanceReport, DashboardStats } from '@/types/reports';
import { AuthenticatedUser, UserRole } from '@/types/auth';

/**
 * Filter strategy and prototype limitation notice:
 *
 * Phase 1 mock data records (`MOCK_REPORTS`) were authored as static visual presentation fixtures.
 * They contain human-readable text fields (`reporterName`, `assignedTechnician`), but lack relational
 * database foreign keys (`reporter_id`, `technician_id`) or assignment status transitions (`assignment_status`).
 *
 * To uphold RBAC isolation safely without fabricating realistic user identities:
 * 1. Oversight roles (`coordinator`, `administrator`, `management`) receive campus-wide report visibility.
 * 2. `student_personnel` receives reports where the caller matches `reporterId`, `reporterEmail`,
 *    or `reporterName` (case-insensitive). If no records match the authenticated student, the filter
 *    safely returns an empty array (`[]`) with zero information leakage.
 * 3. `technician` receives reports where the caller matches `assignedTechnicianId`, `assignedTechnicianEmail`,
 *    or `assignedTechnician` (excluding `assignmentStatus === 'declined'`), PLUS any reports submitted by
 *    the technician themselves. If no records match, returns an empty array (`[]`).
 * 4. Statistics are calculated strictly from the visible `filteredReports` subset, ensuring counts
 *    never reveal or leak the existence of hidden reports.
 */

/**
 * Filters a list of maintenance reports to only those permitted for the authenticated user's role.
 */
export function filterMockReportsForRole(
  reports: readonly MaintenanceReport[],
  user?: AuthenticatedUser | null
): MaintenanceReport[] {
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
  const isReporter = (report: MaintenanceReport): boolean => {
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
  const isAssignedTechnician = (report: MaintenanceReport): boolean => {
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

/**
 * Derives dashboard KPI statistics strictly from the role-filtered report subset.
 * Guarantees that counts never reveal the existence or quantity of hidden reports.
 */
export function calculateRoleDashboardStats(
  filteredReports: readonly MaintenanceReport[]
): DashboardStats {
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

export interface RoleDashboardKpiConfig {
  welcomeMessage: string;
  tableTitle: string;
  tableDescription: string;
  cards: [
    { title: string; description: string },
    { title: string; description: string },
    { title: string; description: string },
    { title: string; description: string },
  ];
}

/**
 * Returns role-appropriate titles, card descriptions, and greeting text for the dashboard UI.
 */
export function getRoleDashboardConfig(
  role: UserRole,
  firstName: string,
  stats: DashboardStats
): RoleDashboardKpiConfig {
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
  }
}

export interface FacilityReportCount {
  building: string;
  count: number;
}

/**
 * Computes report counts per campus facility strictly from the filtered reports list.
 */
export function getFacilityBreakdown(
  filteredReports: readonly MaintenanceReport[]
): FacilityReportCount[] {
  const countsByBuilding = new Map<string, number>();

  for (const report of filteredReports) {
    const bldg = report.location?.building || 'Unspecified Facility';
    countsByBuilding.set(bldg, (countsByBuilding.get(bldg) || 0) + 1);
  }

  return Array.from(countsByBuilding.entries()).map(([building, count]) => ({
    building,
    count,
  }));
}
