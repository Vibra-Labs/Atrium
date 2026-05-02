import { redirect } from "next/navigation";

export default function ProfileRedirect(): never {
  redirect("/dashboard/settings/account");
}
