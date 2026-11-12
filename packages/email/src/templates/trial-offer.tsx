import { Link, Text } from "@react-email/components";
import * as React from "react";

export interface TrialActivity {
  sharedProjects: number;
  clients: number;
  updates: number;
}

export interface TrialOfferProps {
  /** From activitySentence(); null hides the line. */
  activityLine: string | null;
  proUrl: string;
  /** Null once Lifetime has sold out. */
  lifetimeUrl: string | null;
  /** e.g. "Limited to 100 seats". */
  lifetimeLabel: string | null;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "So far Acme has 2 projects shared with clients, …", or null when there's nothing to say yet. */
export function activitySentence(organizationName: string, activity: TrialActivity): string | null {
  const parts: string[] = [];
  if (activity.sharedProjects > 0) parts.push(`${plural(activity.sharedProjects, "project")} shared with clients`);
  if (activity.clients > 0) parts.push(`${plural(activity.clients, "client")} in the portal`);
  if (activity.updates > 0) parts.push(`${plural(activity.updates, "update")} posted`);
  if (parts.length === 0) return null;
  const list: string = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `So far ${organizationName} has ${list}.`;
}

const BUTTON = {
  display: "inline-block",
  padding: "12px 24px",
  borderRadius: "6px",
  textDecoration: "none",
  fontSize: "16px",
  marginTop: "16px",
  marginRight: "8px",
};

export function OfferButtons({ proUrl, proLabel, lifetimeUrl, lifetimeLabel }: {
  proUrl: string;
  proLabel: string;
  lifetimeUrl: string | null;
  lifetimeLabel: string | null;
}): React.ReactElement {
  return (
    <>
      <Link href={proUrl} style={{ ...BUTTON, backgroundColor: "#006b68", color: "#ffffff" }}>
        {proLabel}
      </Link>
      {lifetimeUrl && (
        <Link href={lifetimeUrl} style={{ ...BUTTON, border: "1px solid #006b68", color: "#006b68" }}>
          Get Lifetime
        </Link>
      )}
      {lifetimeUrl && lifetimeLabel && (
        <Text style={{ fontSize: "13px", color: "#6b7280", marginTop: "8px" }}>
          {`Lifetime is a one-time payment. ${lifetimeLabel}.`}
        </Text>
      )}
    </>
  );
}
