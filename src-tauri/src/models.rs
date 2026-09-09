use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------- Kunden

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Customer {
    pub id: i64,
    pub name: String,
    pub company: Option<String>,
    pub email: Option<String>,
    /// Stundensatz in Cent — bewusst ganzzahlig, um Rundungsdrift zu vermeiden.
    pub hourly_rate_cents: Option<i64>,
    pub sevdesk_contact_id: Option<String>,
    pub notes: Option<String>,
    pub archived: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerSummary {
    #[serde(flatten)]
    pub customer: Customer,
    pub open_tasks: i64,
    pub overdue_tasks: i64,
    /// Noch nicht abgerechnete, abgeschlossene Zeit.
    pub unbilled_minutes: i64,
    pub unbilled_cents: i64,
    pub tracked_minutes_total: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerInput {
    pub name: String,
    pub company: Option<String>,
    pub email: Option<String>,
    pub hourly_rate_cents: Option<i64>,
    pub notes: Option<String>,
}

// -------------------------------------------------------------- Aufgaben

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskStatus {
    Open,
    InProgress,
    Done,
}

impl TaskStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            TaskStatus::Open => "open",
            TaskStatus::InProgress => "in_progress",
            TaskStatus::Done => "done",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "open" => Some(TaskStatus::Open),
            "in_progress" => Some(TaskStatus::InProgress),
            "done" => Some(TaskStatus::Done),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: i64,
    pub customer_id: i64,
    pub title: String,
    pub description: Option<String>,
    pub estimated_minutes: Option<i64>,
    pub deadline: Option<String>,
    pub status: TaskStatus,
    pub invoiced: bool,
    pub created_at: String,
    pub completed_at: Option<String>,
    /// Bereits auf diese Aufgabe gebuchte Zeit (abgeschlossene Einträge).
    pub tracked_minutes: i64,
    pub unbilled_minutes: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskInput {
    pub customer_id: i64,
    pub title: String,
    pub description: Option<String>,
    pub estimated_minutes: Option<i64>,
    pub deadline: Option<String>,
    pub status: TaskStatus,
}

// ------------------------------------------------------------ Zeiterfassung

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntry {
    pub id: i64,
    pub customer_id: i64,
    pub customer_name: String,
    pub task_id: Option<i64>,
    pub task_title: Option<String>,
    pub start_time: String,
    pub end_time: Option<String>,
    pub duration_minutes: Option<i64>,
    pub note: Option<String>,
    pub invoiced: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunningTimer {
    pub id: i64,
    pub customer_id: i64,
    pub customer_name: String,
    pub task_id: Option<i64>,
    pub task_title: Option<String>,
    pub start_time: String,
    pub elapsed_seconds: i64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManualTimeEntryInput {
    pub customer_id: i64,
    pub task_id: Option<i64>,
    pub start_time: String,
    pub end_time: String,
    pub note: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntryPatch {
    pub id: i64,
    pub customer_id: i64,
    pub task_id: Option<i64>,
    pub start_time: String,
    pub end_time: String,
    pub note: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntryFilter {
    pub customer_id: Option<i64>,
    pub task_id: Option<i64>,
    /// ISO-Datum (inklusive), lokale Zeitzone des Nutzers.
    pub from: Option<String>,
    pub to: Option<String>,
    pub only_unbilled: Option<bool>,
    pub limit: Option<i64>,
}

// --------------------------------------------------------------- Dashboard

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayBucket {
    pub date: String,
    pub minutes: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomerBucket {
    pub customer_id: i64,
    pub customer_name: String,
    pub minutes: i64,
    pub cents: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverdueTask {
    pub id: i64,
    pub customer_id: i64,
    pub customer_name: String,
    pub title: String,
    pub deadline: String,
    pub days_overdue: i64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Dashboard {
    pub today_minutes: i64,
    pub week_minutes: i64,
    pub month_minutes: i64,
    pub unbilled_minutes: i64,
    pub unbilled_cents: i64,
    /// Anteil unabgerechneter Zeit bei Kunden ohne Stundensatz.
    pub unbilled_minutes_without_rate: i64,
    pub open_tasks: i64,
    pub overdue: Vec<OverdueTask>,
    pub last_14_days: Vec<DayBucket>,
    pub by_customer_unbilled: Vec<CustomerBucket>,
    pub active_customers: i64,
}

// ---------------------------------------------------------- Rechnungslauf

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoicePosition {
    pub task_id: Option<i64>,
    pub name: String,
    pub text: String,
    pub minutes: i64,
    /// Nach optionaler Taktung aufgerundete Minuten.
    pub billed_minutes: i64,
    pub hours: f64,
    pub unit_price_cents: i64,
    pub net_cents: i64,
    pub time_entry_ids: Vec<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoicePreview {
    pub customer_id: i64,
    pub customer_name: String,
    pub hourly_rate_cents: Option<i64>,
    pub sevdesk_contact_id: Option<String>,
    pub positions: Vec<InvoicePosition>,
    pub net_total_cents: i64,
    pub total_minutes: i64,
    pub tax_rate: f64,
    pub tax_total_cents: i64,
    pub gross_total_cents: i64,
    /// Aufgaben ohne offene Zeit — sie erzeugen keine Position und werden
    /// nicht automatisch als abgerechnet markiert.
    pub tasks_without_time: Vec<String>,
    pub blockers: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceResult {
    pub invoice_number: Option<String>,
    pub sevdesk_invoice_id: String,
    pub net_total_cents: i64,
    pub positions: usize,
    pub marked_time_entries: usize,
    pub marked_tasks: usize,
    pub sevdesk_url: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceRecord {
    pub id: i64,
    pub customer_id: i64,
    pub customer_name: String,
    pub sevdesk_invoice_id: Option<String>,
    pub invoice_number: Option<String>,
    pub net_total_cents: i64,
    pub minutes: i64,
    pub status: String,
    pub created_at: String,
}
