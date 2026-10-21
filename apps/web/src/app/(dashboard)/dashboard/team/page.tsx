import { redirect } from "next/navigation";
import { TEAM_PATH } from "@/lib/legacy-routes";

/** Team moved into Settings; keeps old links and bookmarks working. */
export default function TeamRedirect(): never {
  redirect(TEAM_PATH);
}
