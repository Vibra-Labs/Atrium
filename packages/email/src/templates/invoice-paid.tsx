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

interface InvoicePaidEmailProps {
  recipientName: string;
  invoiceNumber: string;
  amount: string;
  projectName: string;
  dashboardUrl: string;
}

export function InvoicePaidEmail({
  recipientName,
  invoiceNumber,
  amount,
  projectName,
  dashboardUrl,
}: InvoicePaidEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Invoice {invoiceNumber} paid — {amount}</Preview>
      <Body style={{ fontFamily: "sans-serif", padding: "40px 0" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto" }}>
          <Heading style={{ fontSize: "24px", marginBottom: "24px" }}>
            Payment Received
          </Heading>
          <Text style={{ fontSize: "16px", lineHeight: "24px" }}>
            {recipientName}, invoice {invoiceNumber} for {amount} on project{" "}
            {projectName} has been paid.
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
            View Invoice
          </Link>
          <Text
            style={{ fontSize: "14px", color: "#6b7280", marginTop: "24px" }}
          >
            This payment was processed via Stripe.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
