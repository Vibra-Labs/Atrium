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

interface DocumentRespondedEmailProps {
  recipientName: string;
  clientName: string;
  projectName: string;
  documentTitle: string;
  documentType: string;
  action: string;
  dashboardUrl: string;
}

export function DocumentRespondedEmail({
  recipientName,
  clientName,
  projectName,
  documentTitle,
  documentType,
  action,
  dashboardUrl,
}: DocumentRespondedEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>{clientName} {action} {documentType}: {documentTitle}</Preview>
      <Body style={{ fontFamily: "sans-serif", padding: "40px 0" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto" }}>
          <Heading style={{ fontSize: "24px", marginBottom: "24px" }}>
            Document Response
          </Heading>
          <Text style={{ fontSize: "16px", lineHeight: "24px" }}>
            {recipientName}, <strong>{clientName}</strong> has {action} the{" "}
            {documentType} <strong>{documentTitle}</strong> on {projectName}.
          </Text>
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
              marginTop: "16px",
            }}
          >
            View Document
          </Link>
          <Text
            style={{ fontSize: "14px", color: "#6b7280", marginTop: "24px" }}
          >
            You are receiving this email because you are an admin on this
            project.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
