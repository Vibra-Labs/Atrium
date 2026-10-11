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

interface TrialEndedEmailProps {
  organizationName: string;
  billingUrl: string;
}

const SWITCHED_OFF = [
  "Your custom domain no longer serves the portal",
  "Signature documents can't be sent",
  "Clients can't pay invoices online",
  "The portal shows \"Powered by Atrium\"",
];

export function TrialEndedEmail({ organizationName, billingUrl }: TrialEndedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your Atrium Pro trial has ended</Preview>
      <Body style={{ fontFamily: "sans-serif", padding: "40px 0" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto" }}>
          <Heading style={{ fontSize: "24px", marginBottom: "24px" }}>
            Your Pro trial has ended
          </Heading>
          <Text style={{ fontSize: "16px", lineHeight: "24px" }}>
            <strong>{organizationName}</strong> is now on the Free plan. Here is what changed:
          </Text>
          {SWITCHED_OFF.map((item) => (
            <Text key={item} style={{ fontSize: "15px", lineHeight: "20px", margin: "4px 0 4px 12px" }}>
              • {item}
            </Text>
          ))}
          <Text style={{ fontSize: "14px", color: "#374151", marginTop: "16px" }}>
            Nothing was deleted. Upgrade and everything, including your custom domain, comes back right away.
          </Text>
          <Link
            href={billingUrl}
            style={{
              display: "inline-block",
              padding: "12px 24px",
              backgroundColor: "#006b68",
              color: "#ffffff",
              borderRadius: "6px",
              textDecoration: "none",
              fontSize: "16px",
              marginTop: "16px",
            }}
          >
            Upgrade to Pro
          </Link>
          <Text style={{ fontSize: "14px", color: "#6b7280", marginTop: "24px" }}>
            You are receiving this email because you own an Atrium workspace.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
