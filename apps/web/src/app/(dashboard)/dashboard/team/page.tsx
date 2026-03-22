import { redirect } from "next/navigation";

export default function TeamRedirect() {
  redirect("/dashboard/clients");
}
