import { invoke } from "@tauri-apps/api/core";
import type {
  AppInfo,
  AppSettings,
  Customer,
  CustomerInput,
  CustomerSummary,
  Dashboard,
  ErrorKind,
  InvoicePreview,
  InvoiceRecord,
  InvoiceResult,
  ManualTimeEntryInput,
  RunningTimer,
  SevdeskContact,
  SevdeskStatus,
  Task,
  TaskInput,
  TaskStatus,
  TimeEntry,
  TimeEntryFilter,
  TimeEntryPatch,
} from "./types";

/** Fehler aus dem Rust-Backend, angereichert um Kategorie und Wiederholbarkeit. */
export class KontorError extends Error {
  readonly kind: ErrorKind;
  readonly retryable: boolean;

  constructor(message: string, kind: ErrorKind, retryable: boolean) {
    super(message);
    this.name = "KontorError";
    this.kind = kind;
    this.retryable = retryable;
  }
}

function isBackendError(
  value: unknown,
): value is { kind: ErrorKind; message: string; retryable: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "message" in value &&
    typeof (value as { message: unknown }).message === "string"
  );
}

export function toKontorError(error: unknown): KontorError {
  if (error instanceof KontorError) return error;
  if (isBackendError(error)) {
    return new KontorError(error.message, error.kind, Boolean(error.retryable));
  }
  if (error instanceof Error) {
    return new KontorError(error.message, "internal", false);
  }
  return new KontorError(String(error), "internal", false);
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw toKontorError(error);
  }
}

export const api = {
  appInfo: () => call<AppInfo>("app_info"),

  // ------------------------------------------------------------ Kunden
  listCustomers: (includeArchived: boolean, search: string | null) =>
    call<CustomerSummary[]>("list_customers", { includeArchived, search }),
  createCustomer: (input: CustomerInput) => call<Customer>("create_customer", { input }),
  updateCustomer: (id: number, input: CustomerInput) =>
    call<Customer>("update_customer", { id, input }),
  setCustomerArchived: (id: number, archived: boolean) =>
    call<Customer>("set_customer_archived", { id, archived }),
  deleteCustomer: (id: number) => call<void>("delete_customer", { id }),

  // ---------------------------------------------------------- Aufgaben
  listTasks: (customerId: number) => call<Task[]>("list_tasks", { customerId }),
  createTask: (input: TaskInput) => call<Task>("create_task", { input }),
  updateTask: (id: number, input: TaskInput) => call<Task>("update_task", { id, input }),
  setTaskStatus: (id: number, status: TaskStatus) =>
    call<Task>("set_task_status", { id, status }),
  setTaskInvoiced: (id: number, invoiced: boolean) =>
    call<Task>("set_task_invoiced", { id, invoiced }),
  deleteTask: (id: number) => call<void>("delete_task", { id }),

  // ------------------------------------------------------------- Zeit
  getRunningTimer: () => call<RunningTimer | null>("get_running_timer"),
  startTimer: (customerId: number, taskId: number | null) =>
    call<RunningTimer>("start_timer", { customerId, taskId }),
  stopTimer: (note: string) => call<TimeEntry>("stop_timer", { note }),
  discardTimer: () => call<void>("discard_timer"),
  updateRunningTimer: (taskId: number | null, startTime: string | null) =>
    call<RunningTimer>("update_running_timer", { taskId, startTime }),
  createTimeEntry: (input: ManualTimeEntryInput) =>
    call<TimeEntry>("create_time_entry", { input }),
  updateTimeEntry: (input: TimeEntryPatch) => call<TimeEntry>("update_time_entry", { input }),
  setTimeEntryInvoiced: (id: number, invoiced: boolean) =>
    call<TimeEntry>("set_time_entry_invoiced", { id, invoiced }),
  deleteTimeEntry: (id: number) => call<void>("delete_time_entry", { id }),
  listTimeEntries: (filter: TimeEntryFilter) =>
    call<TimeEntry[]>("list_time_entries", { filter }),

  // -------------------------------------------------------- Auswertung
  dashboard: () => call<Dashboard>("get_dashboard"),
  exportCsv: (path: string, filter: TimeEntryFilter) =>
    call<number>("export_time_entries_csv", { path, filter }),

  // ------------------------------------------------------ Einstellungen
  getSettings: () => call<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) => call<AppSettings>("save_settings", { settings }),
  setSevdeskToken: (token: string) => call<string | null>("set_sevdesk_token", { token }),
  clearSevdeskToken: () => call<void>("clear_sevdesk_token"),
  sevdeskTokenHint: () => call<string | null>("sevdesk_token_hint"),

  // ----------------------------------------------------------- SevDesk
  sevdeskStatus: () => call<SevdeskStatus>("sevdesk_status"),
  sevdeskListContacts: (search: string | null) =>
    call<SevdeskContact[]>("sevdesk_list_contacts", { search }),
  sevdeskLinkCustomer: (customerId: number, contactId: string) =>
    call<void>("sevdesk_link_customer", { link: { customerId, contactId } }),
  sevdeskUnlinkCustomer: (customerId: number) =>
    call<void>("sevdesk_unlink_customer", { customerId }),
  sevdeskCreateContact: (customerId: number) =>
    call<SevdeskContact>("sevdesk_create_contact", { customerId }),
  invoicePreview: (customerId: number) =>
    call<InvoicePreview>("invoice_preview", { customerId }),
  createInvoice: (customerId: number) =>
    call<InvoiceResult>("create_sevdesk_invoice", { customerId }),
  listInvoices: () => call<InvoiceRecord[]>("list_invoices"),
};
