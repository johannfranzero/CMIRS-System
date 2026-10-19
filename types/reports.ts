export type ReportStatus =
  | 'submitted'
  | 'under_review'
  | 'assigned'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'verified'
  | 'reopened'
  | 'cancelled';

export type PriorityLevel = 'low' | 'medium' | 'high' | 'critical';

export interface CampusLocation {
  building: string;
  floor: string;
  room?: string;
  specificArea?: string;
}

export interface MaintenanceReport {
  id: string;
  trackingNumber: string;
  title: string;
  description: string;
  category: string;
  location: CampusLocation;
  status: ReportStatus;
  priority: PriorityLevel;
  isUrgentHazard: boolean;
  reporterName: string;
  reporterRole: string;
  assignedTechnician?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardStats {
  totalActive: number;
  pendingReview: number;
  inProgress: number;
  resolvedThisWeek: number;
  urgentHazards: number;
}
