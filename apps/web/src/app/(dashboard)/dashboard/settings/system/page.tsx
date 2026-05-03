import { redirect } from "next/navigation";

export default function SystemSettingsRedirect(): never {
  redirect("/dashboard/settings/workspace");
}
