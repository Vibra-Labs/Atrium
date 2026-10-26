import { redirect } from "next/navigation";

// Client invoice payments are now unified under the Billing & Payments tab; keep old links working.
export default function PaymentsSettingsPage(): never {
  redirect("/dashboard/settings/billing");
}
