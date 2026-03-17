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

interface DocumentUploadedEmailProps {
  clientName: string;
  projectName: string;
  documentTitle: string;
  documentType: string;
  portalUrl: string;
}

export function DocumentUploadedEmail({
  clientName,
  projectName,
  documentTitle,
  documentType,
  portalUrl,
}: DocumentUploadedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>New {documentType} on {projectName}: {documentTitle}</Preview>
      <Body style={{ fontFamily: "sans-serif", padding: "40px 0" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto" }}>
          <Heading style={{ fontSize: "24px", marginBottom: "24px" }}>
            New Document Available
          </Heading>
          <Text style={{ fontSize: "16px", lineHeight: "24px" }}>
            {clientName}, a new {documentType} has been added to{" "}
            {projectName}: <strong>{documentTitle}</strong>
          </Text>
          <Text style={{ fontSize: "14px", color: "#374151" }}>
            Please review the document and provide your response.
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
            View Document
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
