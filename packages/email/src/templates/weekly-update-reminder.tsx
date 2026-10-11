import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from "@react-email/components";
import * as React from "react";

interface ReminderProject {
  name: string;
  lastUpdate: string;
  draftUrl: string;
}

interface WeeklyUpdateReminderEmailProps {
  organizationName: string;
  projects: ReminderProject[];
  settingsUrl: string;
}

export function WeeklyUpdateReminderEmail({
  organizationName,
  projects,
  settingsUrl,
}: WeeklyUpdateReminderEmailProps) {
  const count = projects.length;
  const noun = count === 1 ? "client is" : "clients are";
  return (
    <Html>
      <Head />
      <Preview>
        {String(count)} {noun} waiting for this week&apos;s update
      </Preview>
      <Body style={{ fontFamily: "sans-serif", padding: "40px 0" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto" }}>
          <Heading style={{ fontSize: "24px", marginBottom: "24px" }}>
            Time for this week&apos;s client updates
          </Heading>
          <Text style={{ fontSize: "16px", lineHeight: "24px" }}>
            These {organizationName} projects haven&apos;t had an update in a week. Atrium has
            drafted each one from what you finished, so it takes a minute to review and send.
          </Text>
          {projects.map((project) => (
            <Text key={project.draftUrl} style={{ fontSize: "15px", lineHeight: "22px", margin: "12px 0" }}>
              <strong>{project.name}</strong>
              <br />
              <span style={{ color: "#6b7280", fontSize: "13px" }}>{project.lastUpdate}</span>
              <br />
              <Link href={project.draftUrl} style={{ color: "#006b68", fontSize: "14px" }}>
                Review draft update →
              </Link>
            </Text>
          ))}
          <Text style={{ fontSize: "13px", color: "#6b7280", marginTop: "32px" }}>
            You get this on Fridays when a client project has gone a week without an update.{" "}
            <Link href={settingsUrl} style={{ color: "#6b7280" }}>
              Turn off these reminders
            </Link>
            .
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
