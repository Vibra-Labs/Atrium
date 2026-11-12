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

interface TrialEndingEmailProps extends TrialOfferProps {
  organizationName: string;
  daysLeft: number;
  endsOn: string;
}

const PRO_FEATURES = [
  "Your custom domain",
  "E-signatures on contracts and proposals",
  "Online invoice payments from the portal",
  "A white-label portal without Atrium branding",
];

export function TrialEndingEmail({
  organizationName,
  daysLeft,
  endsOn,
  activityLine,
  proUrl,
  lifetimeUrl,
  lifetimeLabel,
}: TrialEndingEmailProps) {
  const dayWord = daysLeft === 1 ? "day" : "days";
  return (
    <Html>
      <Head />
      <Preview>Your Atrium Pro trial ends in {String(daysLeft)} {dayWord}</Preview>
      <Body style={{ fontFamily: "sans-serif", padding: "40px 0" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto" }}>
          <Heading style={{ fontSize: "24px", marginBottom: "24px" }}>
            Your Pro trial ends in {daysLeft} {dayWord}
          </Heading>
          {activityLine && <Text style={{ fontSize: "16px", lineHeight: "24px" }}>{activityLine}</Text>}
          <Text style={{ fontSize: "16px", lineHeight: "24px" }}>
            The Pro trial for <strong>{organizationName}</strong> ends on {endsOn}.
            After that, your workspace moves to the Free plan and these switch off:
          </Text>
          {PRO_FEATURES.map((feature) => (
            <Text key={feature} style={{ fontSize: "15px", lineHeight: "20px", margin: "4px 0 4px 12px" }}>
              • {feature}
            </Text>
          ))}
          <Text style={{ fontSize: "14px", color: "#374151", marginTop: "16px" }}>
            Your projects, files and clients stay exactly as they are.
          </Text>
          <OfferButtons proUrl={proUrl} proLabel="Keep Pro" lifetimeUrl={lifetimeUrl} lifetimeLabel={lifetimeLabel} />
          <Text style={{ fontSize: "14px", color: "#6b7280", marginTop: "24px" }}>
            You are receiving this email because you own an Atrium workspace on a Pro trial.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
