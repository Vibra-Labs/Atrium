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

interface MagicLinkEmailProps {
  url: string;
  organizationName?: string;
}

export function MagicLinkEmail({ url, organizationName }: MagicLinkEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Sign in to {organizationName ?? "Atrium"}</Preview>
      <Body style={{ fontFamily: "sans-serif", padding: "40px 0" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto" }}>
          <Heading style={{ fontSize: "24px", marginBottom: "24px" }}>
            Sign in to {organizationName ?? "Atrium"}
          </Heading>
          <Text style={{ fontSize: "16px", lineHeight: "24px" }}>
            Click the link below to sign in. This link expires in 1 hour and works once.
          </Text>
          <Link
            href={url}
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
            Sign In
          </Link>
          <Text
            style={{ fontSize: "14px", color: "#6b7280", marginTop: "24px" }}
          >
            If you didn&apos;t request this email, you can safely ignore it.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
