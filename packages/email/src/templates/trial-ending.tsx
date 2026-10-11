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

interface TrialEndingEmailProps {
  organizationName: string;
  daysLeft: number;
  endsOn: string;
  billingUrl: string;
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
  billingUrl,
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
            Keep Pro
          </Link>
          <Text style={{ fontSize: "14px", color: "#6b7280", marginTop: "24px" }}>
            You are receiving this email because you own an Atrium workspace on a Pro trial.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
