import { redirect } from "next/navigation";
import { clientsRedirectTarget } from "@/lib/legacy-routes";

/** The old People page: team moved to Settings → Team, clients are contacts with portal access. */
export default async function ClientsRedirect({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}): Promise<never> {
  const { tab } = await searchParams;
  redirect(clientsRedirectTarget(tab));
}
