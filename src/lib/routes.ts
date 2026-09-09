export type Route =
  | { name: "dashboard" }
  | { name: "customers"; customerId?: number }
  | { name: "time"; customerId?: number }
  | { name: "invoices" }
  | { name: "settings" };
