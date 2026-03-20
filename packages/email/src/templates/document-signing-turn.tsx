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

interface DocumentSigningTurnEmailProps {
  clientName: string;
  projectName: string;
  documentTitle: string;
  documentType: string;
  portalUrl: string;
}

export function DocumentSigningTurnEmail({
  clientName,
  projectName,
  documentTitle,
  documentType,
  portalUrl,
}: DocumentSigningTurnEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your turn to sign: {documentTitle}</Preview>
      <Body style={{ fontFamily: "sans-serif", padding: "40px 0" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto" }}>
          <Heading style={{ fontSize: "24px", marginBottom: "24px" }}>
            It's Your Turn to Sign
          </Heading>
          <Text style={{ fontSize: "16px", lineHeight: "24px" }}>
            {clientName}, the {documentType}{" "}
            <strong>{documentTitle}</strong> on {projectName} is ready for
            your signature. Previous signers have completed their fields.
          </Text>
          <Text style={{ fontSize: "14px", color: "#374151" }}>
            Please review and sign the document at your earliest convenience.
          </Text>
          <Link
            href={portalUrl}
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
            Sign Document
          </Link>
          <Text
            style={{ fontSize: "14px", color: "#6b7280", marginTop: "24px" }}
          >
            You are receiving this email because you are a client on this
            project.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
