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

export interface AnalyticsDistributionItem {
  label: string;
  count: number;
}

export interface TechnicianWorkloadItem {
  technicianId: string;
  technicianName: string;
  activeAssignments: number;
}

export interface OperationalAnalytics {
  totalReports: number;
  urgentHazardReports: number;
  activeAssignments: number;
  statusDistribution: AnalyticsDistributionItem[];
  priorityDistribution: AnalyticsDistributionItem[];
  categoryDistribution: AnalyticsDistributionItem[];
  locationDistribution: AnalyticsDistributionItem[];
  technicianWorkload: TechnicianWorkloadItem[];
}

export type AnalyticsDataState = 'ready' | 'incomplete' | 'error';

export interface AnalyticsDataResult {
  analytics: OperationalAnalytics | null;
  state: AnalyticsDataState;
  totalCount: number | null;
  fetchedCount: number;
  error?: string;
}

export interface CategoryOption {
  id: string;
  name: string;
  description?: string | null;
}

export interface LocationOption {
  id: string;
  building_name: string;
  floor?: string | null;
  room?: string | null;
  description?: string | null;
}

export interface LocationsDirectoryResult {
  locations: LocationOption[];
  error: string | null;
}

/**
 * Phase 4D: reference catalogs (categories, locations, technicians) are loaded from the
 * database or they are reported as unavailable. They are never replaced with demo fixtures.
 */
export interface ReferenceCatalogResult<T> {
  items: T[];
  error: string | null;
}

/**
 * Phase 4D: campus facility breakdown computed from every RLS-visible active report.
 */
export interface FacilityBreakdownResult {
  breakdown: Array<{ building: string; count: number }>;
  error: string | null;
  isTruncated: boolean;
}

export interface TechnicianOption {
  id: string;
  full_name: string;
  email: string;
}

export interface ReportAssignmentDetail {
  id: string;
  technicianId: string;
  technicianName: string;
  technicianEmail?: string;
  technicianPhone?: string;
  assignedAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  status: AssignmentStatus;
  notes?: string | null;
  declineReason?: string | null;
}

export interface ReportStatusHistoryItem {
  id: string;
  previousStatus: ReportStatus | null;
  newStatus: ReportStatus;
  changedBy: string;
  changedByName?: string;
  changedByRole?: string;
  reason?: string | null;
  createdAt: string;
}

export interface ReportWorkLogItem {
  id: string;
  assignmentId: string;
  technicianId: string;
  technicianName?: string;
  description: string;
  hoursSpent: number;
  createdAt: string;
}

export interface ReportVerificationItem {
  id: string;
  verifierId: string;
  verifierName?: string;
  verifierRole?: string;
  isSatisfactory: boolean;
  notes?: string | null;
  verifiedAt: string;
}

export interface ReportAttachmentItem {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string;
  uploaderName?: string;
  createdAt: string;
  deletedAt?: string | null;
}

export interface DetailedReport extends MaintenanceReport {
  assignmentsList: ReportAssignmentDetail[];
  statusHistory: ReportStatusHistoryItem[];
  workLogs: ReportWorkLogItem[];
  verifications: ReportVerificationItem[];
  attachments: ReportAttachmentItem[];
}
