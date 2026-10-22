/**
 * CMIRS — Role-Aware Dashboard Presentation Configuration
 *
 * Phase 4D: this module replaces `utils/reports/mock-filter.ts`, which mixed the dashboard copy
 * helper with the Phase 1 mock-only report filtering and statistics helpers. The mock helpers
 * are not part of the runtime data path: the dashboard reads exclusively from the authenticated
 * Supabase DAL (`utils/reports/dal.ts`). The isolated Phase 2.5 unit test
 * (`tests/unit/role-mock-filtering.test.mjs`) keeps its own in-file mirror of that pure logic.
 *
 * Rules:
 * - Presentation copy only. Every number rendered by the dashboard comes from the DAL.
 * - No hardcoded record counts, building totals, or SLA figures. Descriptions therefore state
 *   scope instead of a fabricated quantity.
 */

import type { DashboardStats } from '@/types/reports';
import type { UserRole } from '@/types/auth';

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
 * Options that let the caller declare whether the supplied statistics may be trusted.
 *
 * The DAL returns an all-zero statistics object when a query fails. Rendering that object as
 * if it were real would publish a fabricated "there is nothing to do" claim, so the caller
 * passes `statsAvailable: false` and the configuration degrades to a message that states the
 * metrics are unavailable instead of asserting a zero.
 */
export interface RoleDashboardConfigOptions {
  statsAvailable?: boolean;
}

const UNAVAILABLE_WELCOME_MESSAGE_PREFIX = 'Operational metrics are temporarily unavailable';

/**
 * Returns role-appropriate titles, card descriptions, and greeting text for the dashboard UI.
 */
export function getRoleDashboardConfig(
  role: UserRole,
  firstName: string,
  stats: DashboardStats,
  options: RoleDashboardConfigOptions = {}
): RoleDashboardKpiConfig {
  const statsAvailable = options.statsAvailable !== false;

  const welcomeMessage = (buildMessage: (stats: DashboardStats) => string): string => {
    if (!statsAvailable) {
      return `Welcome back, ${firstName}. ${UNAVAILABLE_WELCOME_MESSAGE_PREFIX}, so the current workload cannot be displayed.`;
    }
    return buildMessage(stats);
  };

  switch (role) {
    case 'student_personnel':
      return {
        welcomeMessage: welcomeMessage((s) =>
          s.totalActive > 0
            ? `Welcome back, ${firstName}. You have ${s.totalActive} active maintenance request${s.totalActive === 1 ? '' : 's'} in progress.`
            : `Welcome back, ${firstName}. You currently have no active maintenance requests submitted.`
        ),
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
        welcomeMessage: welcomeMessage((s) =>
          s.totalActive > 0
            ? `Welcome back, ${firstName}. You have ${s.totalActive} assigned maintenance task${s.totalActive === 1 ? '' : 's'} in your queue.`
            : `Welcome back, ${firstName}. Your service queue is currently clear with no active assigned tasks.`
        ),
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
        welcomeMessage: welcomeMessage((s) =>
          s.urgentHazards > 0
            ? `Welcome back, ${firstName}. ${s.urgentHazards} urgent hazard${s.urgentHazards === 1 ? '' : 's'} require immediate coordinator triage.`
            : `Welcome back, ${firstName}. Campus facilities monitoring ${s.totalActive} active reports across all zones.`
        ),
        tableTitle: 'Campus Incident & Maintenance Queue',
        tableDescription:
          'Triage newly submitted issues, confirm severity priorities, dispatch technicians, and verify completed repairs.',
        cards: [
          { title: 'Total Active', description: 'Across reports visible to your role' },
          { title: 'Pending Triage', description: 'Awaiting coordinator review' },
          { title: 'In Progress', description: 'Assigned to field technicians' },
          { title: 'Critical Hazards', description: 'Immediate safety risk flagged' },
        ],
      };

    case 'administrator':
      return {
        welcomeMessage: welcomeMessage(
          (s) =>
            `Welcome back, ${firstName}. Administrative overview active across ${s.totalActive} campus maintenance report${s.totalActive === 1 ? '' : 's'}.`
        ),
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
        welcomeMessage: welcomeMessage(
          (s) =>
            `Welcome back, ${firstName}. Executive facility performance oversight across ${s.totalActive} active report${s.totalActive === 1 ? '' : 's'}.`
        ),
        tableTitle: 'Campus Incident & Maintenance Queue',
        tableDescription:
          'Read-only operational analytics, facility reporting distributions, and maintenance oversight.',
        cards: [
          { title: 'Total Active', description: 'Campus operational load' },
          { title: 'Pending Triage', description: 'Awaiting coordinator review' },
          { title: 'In Progress', description: 'Active technician assignments' },
          { title: 'Critical Hazards', description: 'Urgent safety hazard alerts' },
        ],
      };
  }
}
