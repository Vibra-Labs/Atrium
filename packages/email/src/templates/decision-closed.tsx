import {
  Body,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

interface DecisionOption {
  label: string;
  voteCount: number;
  isWinner: boolean;
}

interface DecisionClosedEmailProps {
  clientName: string;
  projectName: string;
  question: string;
  options: DecisionOption[];
  portalUrl: string;
}

export function DecisionClosedEmail({
  clientName,
  projectName,
  question,
  options,
  portalUrl,
}: DecisionClosedEmailProps) {
  const winner = options.find((o) => o.isWinner);

  return (
    <Html>
      <Head />
      <Preview>
        Decision closed on {projectName}: {question}
      </Preview>
      <Body style={{ fontFamily: "sans-serif", padding: "40px 0" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto" }}>
          <Heading style={{ fontSize: "24px", marginBottom: "24px" }}>
            Voting Closed
          </Heading>
          <Text style={{ fontSize: "16px", lineHeight: "24px" }}>
            {clientName}, voting has closed on{" "}
            <strong>{projectName}</strong> for the following decision:
          </Text>
          <Text
            style={{
              fontSize: "16px",
              lineHeight: "24px",
              fontStyle: "italic",
              color: "#374151",
            }}
          >
            &ldquo;{question}&rdquo;
          </Text>
          <Section
            style={{
              margin: "16px 0",
              padding: "16px",
              backgroundColor: "#f9fafb",
              borderRadius: "8px",
            }}
          >
            {options.map((option) => (
              <Text
                key={option.label}
                style={{
                  fontSize: "14px",
                  lineHeight: "20px",
                  margin: "4px 0",
                  fontWeight: option.isWinner ? "bold" : "normal",
                  color: option.isWinner ? "#006b68" : "#374151",
                }}
              >
                {option.isWinner ? "\u2713 " : "  "}
                {option.label} &mdash; {option.voteCount}{" "}
                {option.voteCount === 1 ? "vote" : "votes"}
              </Text>
            ))}
          </Section>
          {winner && (
            <Text
              style={{
                fontSize: "16px",
                lineHeight: "24px",
                fontWeight: "bold",
              }}
            >
              Winner: {winner.label}
            </Text>
          )}
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
            View Decision
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
