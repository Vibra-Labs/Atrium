import { redirect } from "next/navigation";

/** The old People page: team moved to /dashboard/team, clients are contacts with portal access. */
export default async function ClientsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}): Promise<never> {
  const { tab } = await searchParams;
  redirect(tab === "team" ? "/dashboard/team" : "/dashboard/contacts?access=portal");
}
