import { unstable_rethrow } from "next/navigation";
import { serverFetch } from "./server-api";

export async function getSession() {
  try {
    const res: Response = await serverFetch("/api/auth/get-session");
    if (!res.ok) return null;
    return res.json();
  } catch (err) {
    // cookies() throws a control-flow signal during static render; let it through.
    unstable_rethrow(err);
    console.error("Failed to load session", err);
    return null;
  }
}
