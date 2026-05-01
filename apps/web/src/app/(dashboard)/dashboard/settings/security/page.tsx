"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { SecuritySection } from "./security-section";

export default function SecuritySettingsPage() {
  const [isOwner, setIsOwner] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<{ role?: string }>("/auth/organization/get-active-member")
      .then((m) => {
        setIsOwner(m?.role === "owner");
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="text-2xl font-bold">Security</h1>
      <p className="mt-1 text-sm text-gray-600">
        Manage two-factor authentication and org-wide security policies.
      </p>
      <div className="mt-6">
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <SecuritySection isOwner={isOwner} />
        )}
      </div>
    </div>
  );
}
