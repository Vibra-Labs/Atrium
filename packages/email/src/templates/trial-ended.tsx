import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Text,
} from "@react-email/components";
import * as React from "react";
import { OfferButtons, type TrialOfferProps } from "./trial-offer";

interface TrialEndedEmailProps extends TrialOfferProps {
  organizationName: string;
}

const SWITCHED_OFF = [
  "Your custom domain no longer serves the portal",
  "Signature documents can't be sent",
  "Clients can't pay invoices online",
  "The portal shows \"Powered by Atrium\"",
];

export function TrialEndedEmail({
  organizationName,
  activityLine,
  proUrl,
  lifetimeUrl,
  lifetimeLabel,
}: TrialEndedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your Atrium Pro trial has ended</Preview>
      <Body style={{ fontFamily: "sans-serif", padding: "40px 0" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto" }}>
          <Heading style={{ fontSize: "24px", marginBottom: "24px" }}>
            Your Pro trial has ended
          </Heading>
          {activityLine && <Text style={{ fontSize: "16px", lineHeight: "24px" }}>{activityLine}</Text>}
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
          <OfferButtons proUrl={proUrl} proLabel="Upgrade to Pro" lifetimeUrl={lifetimeUrl} lifetimeLabel={lifetimeLabel} />
          <Text style={{ fontSize: "14px", color: "#6b7280", marginTop: "24px" }}>
            You are receiving this email because you own an Atrium workspace.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
