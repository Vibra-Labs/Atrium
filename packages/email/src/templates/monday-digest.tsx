import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

interface DigestTaskItem {
  title: string;
  projectName: string;
  due: string;
  overdue: boolean;
}

interface DigestActivityItem {
  title: string;
  message: string;
  url: string;
}

interface MondayDigestEmailProps {
  organizationName: string;
  tasks: DigestTaskItem[];
  moreTasks: number;
  activity: DigestActivityItem[];
  moreActivity: number;
  overdueInvoices: { invoiceNumber: string; due: string; url: string }[];
  dashboardUrl: string;
  settingsUrl: string;
}

const heading2 = { fontSize: "17px", margin: "28px 0 8px" };
const item = { fontSize: "15px", lineHeight: "21px", margin: "6px 0" };
const muted = { color: "#6b7280", fontSize: "13px" };

export function MondayDigestEmail({
  organizationName,
  tasks,
  moreTasks,
  activity,
  moreActivity,
  overdueInvoices,
  dashboardUrl,
  settingsUrl,
}: MondayDigestEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your week at {organizationName}</Preview>
      <Body style={{ fontFamily: "sans-serif", padding: "40px 0" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto" }}>
          <Heading style={{ fontSize: "24px", marginBottom: "8px" }}>Your week at {organizationName}</Heading>
          <Text style={{ ...muted, fontSize: "14px" }}>What&apos;s due and what changed since last week.</Text>

          {tasks.length > 0 && (
            <Section>
              <Text style={heading2}>
                <strong>Due this week</strong>
              </Text>
              {tasks.map((t) => (
                <Text key={`${t.projectName}-${t.title}`} style={item}>
                  {t.title} <span style={muted}>· {t.projectName} · </span>
                  <span style={{ ...muted, color: t.overdue ? "#b91c1c" : "#6b7280" }}>
                    {t.overdue ? `overdue since ${t.due}` : `due ${t.due}`}
                  </span>
                </Text>
              ))}
              {moreTasks > 0 && <Text style={muted}>and {moreTasks} more</Text>}
            </Section>
          )}

          {activity.length > 0 && (
            <Section>
              <Text style={heading2}>
                <strong>Since last week</strong>
              </Text>
              {activity.map((a) => (
                <Text key={a.url + a.title} style={item}>
                  <Link href={a.url} style={{ color: "#006b68" }}>
                    {a.title}
                  </Link>
                  {a.message && (
                    <>
                      <br />
                      <span style={muted}>{a.message}</span>
                    </>
                  )}
                </Text>
              ))}
              {moreActivity > 0 && <Text style={muted}>and {moreActivity} more in Atrium</Text>}
            </Section>
          )}

          {overdueInvoices.length > 0 && (
            <Section>
              <Text style={heading2}>
                <strong>Overdue invoices</strong>
              </Text>
              {overdueInvoices.map((inv) => (
                <Text key={inv.invoiceNumber} style={item}>
                  <Link href={inv.url} style={{ color: "#006b68" }}>
                    {inv.invoiceNumber}
                  </Link>{" "}
                  <span style={muted}>· due {inv.due}</span>
                </Text>
              ))}
            </Section>
          )}

          <Link
            href={dashboardUrl}
            style={{
              display: "inline-block",
              padding: "12px 24px",
              backgroundColor: "#006b68",
              color: "#ffffff",
              borderRadius: "6px",
              textDecoration: "none",
              fontSize: "16px",
              marginTop: "28px",
            }}
          >
            Open Atrium
          </Link>
          <Text style={{ ...muted, marginTop: "32px" }}>
            You get this on Mondays when something is due or changed.{" "}
            <Link href={settingsUrl} style={{ color: "#6b7280" }}>
              Turn off the Monday digest
            </Link>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
