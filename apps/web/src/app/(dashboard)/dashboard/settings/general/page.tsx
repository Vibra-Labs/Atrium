import { redirect } from "next/navigation";

export default function GeneralRedirect(): never {
  redirect("/dashboard/settings/workspace");
}
