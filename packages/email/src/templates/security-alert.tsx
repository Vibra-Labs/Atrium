import { Body, Container, Head, Heading, Html, Preview, Text } from "@react-email/components";
import * as React from "react";

interface SecurityAlertEmailProps {
  heading: string;
  /** Plain paragraphs describing what happened. */
  paragraphs: string[];
}

/** One template for account security notices: password changed, 2FA off, recovery code used. */
export function SecurityAlertEmail({ heading, paragraphs }: SecurityAlertEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{heading}</Preview>
      <Body style={{ fontFamily: "sans-serif", padding: "40px 0" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto" }}>
          <Heading style={{ fontSize: "24px", marginBottom: "24px" }}>{heading}</Heading>
          {paragraphs.map((text: string, i: number) => (
            <Text key={i} style={{ fontSize: "16px", lineHeight: "24px" }}>
              {text}
            </Text>
          ))}
          <Text style={{ fontSize: "14px", color: "#6b7280", marginTop: "24px" }}>
            If this wasn&apos;t you, reset your password and contact your workspace owner.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
