export type TaskStatus = "open" | "in_progress" | "done";

export interface Customer {
  id: number;
  name: string;
  company: string | null;
  email: string | null;
  hourlyRateCents: number | null;
  sevdeskContactId: string | null;
  notes: string | null;
  archived: boolean;
  createdAt: string;
}

export interface CustomerSummary extends Customer {
  openTasks: number;
  overdueTasks: number;
  unbilledMinutes: number;
  unbilledCents: number;
  trackedMinutesTotal: number;
}

export interface CustomerInput {
  name: string;
  company: string | null;
  email: string | null;
  hourlyRateCents: number | null;
  notes: string | null;
}

export interface Task {
  id: number;
  customerId: number;
  title: string;
  description: string | null;
  estimatedMinutes: number | null;
  deadline: string | null;
  status: TaskStatus;
  invoiced: boolean;
  createdAt: string;
  completedAt: string | null;
  trackedMinutes: number;
  unbilledMinutes: number;
}

export interface TaskInput {
  customerId: number;
  title: string;
  description: string | null;
  estimatedMinutes: number | null;
  deadline: string | null;
  status: TaskStatus;
}

export interface TimeEntry {
  id: number;
  customerId: number;
  customerName: string;
  taskId: number | null;
  taskTitle: string | null;
  startTime: string;
  endTime: string | null;
  durationMinutes: number | null;
  note: string | null;
  invoiced: boolean;
  createdAt: string;
}

export interface RunningTimer {
  id: number;
  customerId: number;
  customerName: string;
  taskId: number | null;
  taskTitle: string | null;
  startTime: string;
  elapsedSeconds: number;
}

export interface ManualTimeEntryInput {
  customerId: number;
  taskId: number | null;
  startTime: string;
  endTime: string;
  note: string;
}

export interface TimeEntryPatch extends ManualTimeEntryInput {
  id: number;
}

export interface TimeEntryFilter {
  customerId?: number | null;
  taskId?: number | null;
  from?: string | null;
  to?: string | null;
  onlyUnbilled?: boolean | null;
  limit?: number | null;
}

export interface DayBucket {
  date: string;
  minutes: number;
}

export interface CustomerBucket {
  customerId: number;
  customerName: string;
  minutes: number;
  cents: number;
}

export interface OverdueTask {
  id: number;
  customerId: number;
  customerName: string;
  title: string;
  deadline: string;
  daysOverdue: number;
}

export interface Dashboard {
  todayMinutes: number;
  weekMinutes: number;
  monthMinutes: number;
  unbilledMinutes: number;
  unbilledCents: number;
  unbilledMinutesWithoutRate: number;
  openTasks: number;
  overdue: OverdueTask[];
  last14Days: DayBucket[];
  byCustomerUnbilled: CustomerBucket[];
  activeCustomers: number;
}

export interface InvoicePosition {
  taskId: number | null;
  name: string;
  text: string;
  minutes: number;
  billedMinutes: number;
  hours: number;
  unitPriceCents: number;
  netCents: number;
  timeEntryIds: number[];
}

export interface InvoicePreview {
  customerId: number;
  customerName: string;
  hourlyRateCents: number | null;
  sevdeskContactId: string | null;
  positions: InvoicePosition[];
  netTotalCents: number;
  totalMinutes: number;
  taxRate: number;
  taxTotalCents: number;
  grossTotalCents: number;
  tasksWithoutTime: string[];
  blockers: string[];
}

export interface InvoiceResult {
  invoiceNumber: string | null;
  sevdeskInvoiceId: string;
  netTotalCents: number;
  positions: number;
  markedTimeEntries: number;
  markedTasks: number;
  sevdeskUrl: string;
}

export interface InvoiceRecord {
  id: number;
  customerId: number;
  customerName: string;
  sevdeskInvoiceId: string | null;
  invoiceNumber: string | null;
  netTotalCents: number;
  minutes: number;
  status: string;
  createdAt: string;
}

export interface AppSettings {
  taxMode: "auto" | "tax_type" | "tax_rule";
  taxRate: number;
  taxText: string;
  taxRuleId: string;
  taxType: string;
  timeToPayDays: number;
  invoiceHeadText: string;
  invoiceFootText: string;
  billingIncrementMinutes: number;
  positionNameTemplate: string;
  weeklyReportEnabled: boolean;
  bookkeepingVersion: string | null;
  unityId: string | null;
  contactPersonId: string | null;
}

export interface SevdeskStatus {
  connected: boolean;
  userName: string | null;
  bookkeepingVersion: string | null;
  taxMode: string;
  contactCount: number;
}

export interface SevdeskContact {
  id: string;
  label: string;
  customerNumber: string | null;
}

export interface AppInfo {
  version: string;
  databasePath: string;
}

export type ErrorKind =
  | "db"
  | "not_found"
  | "validation"
  | "conflict"
  | "keychain"
  | "sevdesk"
  | "network"
  | "rate_limited"
  | "io"
  | "internal";
