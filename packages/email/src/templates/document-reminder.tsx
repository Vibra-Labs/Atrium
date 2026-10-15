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

interface DocumentReminderEmailProps {
  clientName: string;
  projectName: string;
  documentTitle: string;
  documentType: string;
  portalUrl: string;
  expiresAt?: string;
  variant?: "document" | "approval";
}

export function DocumentReminderEmail({
  clientName,
  projectName,
  documentTitle,
  documentType,
  portalUrl,
  expiresAt,
  variant = "document",
}: DocumentReminderEmailProps) {
  const isApproval: boolean = variant === "approval";
  return (
    <Html>
      <Head />
      <Preview>Reminder: {documentType} awaiting your response — {documentTitle}</Preview>
      <Body style={{ fontFamily: "sans-serif", padding: "40px 0" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto" }}>
          <Heading style={{ fontSize: "24px", marginBottom: "24px" }}>
            {isApproval ? "Waiting for your approval" : "Document Reminder"}
          </Heading>
          <Text style={{ fontSize: "16px", lineHeight: "24px" }}>
            {clientName}, the {documentType}{" "}
            <strong>{documentTitle}</strong> on {projectName} is still
            awaiting your response.
          </Text>
          {expiresAt && (
            <Text style={{ fontSize: "14px", color: "#b91c1c" }}>
              This document expires on {expiresAt}. Please respond before then.
            </Text>
          )}
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
            {isApproval ? "Review" : "View Document"}
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
