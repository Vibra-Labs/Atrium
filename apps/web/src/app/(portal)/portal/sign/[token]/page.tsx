"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";

const SigningViewer = dynamic(
  () => import("@/components/signing-viewer").then((m) => m.SigningViewer),
  { ssr: false },
);

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface TokenData {
  documentId: string;
  userId: string;
  document: {
    id: string;
    title: string;
    type: string;
    status: string;
    requiresSignature: boolean;
    organizationId: string;
    signatureFields?: { id: string }[];
  };
}

export default function DirectSignPage() {
  const { token } = useParams<{ token: string }>();
  const [tokenData, setTokenData] = useState<TokenData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/documents/sign-via-token/${token}`, {
          credentials: "include",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.message || "Invalid or expired signing link");
          return;
        }
        const data = await res.json();
        setTokenData(data);
      } catch {
        setError("Failed to validate signing link");
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-sm text-[var(--muted-foreground)]">Validating signing link...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <h1 className="text-xl font-semibold">Signing Link Error</h1>
          <p className="text-sm text-red-600">{error}</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            Please contact the sender for a new signing link.
          </p>
        </div>
      </div>
    );
  }

  if (completed) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center space-y-4">
          <h1 className="text-xl font-semibold text-green-700">Document Signed</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Thank you for signing. You can close this page.
          </p>
        </div>
      </div>
    );
  }

  if (tokenData?.document.requiresSignature) {
    return (
      <SigningViewer
        documentId={tokenData.document.id}
        tokenMode={token}
        onClose={() => setCompleted(true)}
        onSigned={() => setCompleted(true)}
      />
    );
  }

  // Non-signature document — just show confirmation
  return (
    <div className="flex items-center justify-center min-h-screen">
      <div className="text-center space-y-4">
        <h1 className="text-xl font-semibold">{tokenData?.document.title}</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          This document has been opened via a direct link.
        </p>
      </div>
    </div>
  );
}
