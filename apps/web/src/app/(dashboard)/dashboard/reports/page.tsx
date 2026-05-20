import { redirect } from "next/navigation";

export default function ReportsIndex(): never {
  redirect("/dashboard/reports/time");
}
