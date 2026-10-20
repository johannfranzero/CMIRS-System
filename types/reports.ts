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

export type AssignmentStatus =
  | 'assigned'
  | 'in_progress'
  | 'on_hold'
  | 'completed'
  | 'reassigned'
  | 'cancelled'
  | 'declined';

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
  categoryId?: string;
  location: CampusLocation;
  locationId?: string;
  status: ReportStatus;
  priority: PriorityLevel | null;
  isUrgentHazard: boolean;
  reporterName: string;
  reporterRole: string;
  reporterId?: string;
  reporterEmail?: string;
  assignedTechnician?: string;
  assignedTechnicianId?: string;
  assignedTechnicianEmail?: string;
  assignmentStatus?: AssignmentStatus;
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

export interface ReportQueueParams {
  page?: number;
  pageSize?: number;
  status?: ReportStatus | 'all';
  category?: string | 'all';
  search?: string;
}

export interface PaginatedReportsResult {
  reports: MaintenanceReport[];
  totalCount: number;
  currentPage: number;
  pageSize: number;
  totalPages: number;
  hasMore: boolean;
  isLiveData: boolean;
  error?: string;
}

export interface DashboardKpiResult {
  stats: DashboardStats;
  isLiveData: boolean;
  error?: string;
}

