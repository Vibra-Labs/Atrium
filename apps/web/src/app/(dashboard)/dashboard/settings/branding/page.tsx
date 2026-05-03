import { redirect } from "next/navigation";

export default function BrandingRedirect(): never {
  redirect("/dashboard/settings/workspace");
}
