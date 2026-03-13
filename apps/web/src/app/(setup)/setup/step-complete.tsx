"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { CheckCircle, ArrowRight } from "lucide-react";
import { track } from "@/lib/track";

interface StepCompleteProps {
  onBack: () => void;
}

export function StepComplete({ onBack }: StepCompleteProps) {
  const [completing, setCompleting] = useState(false);
  const [error, setError] = useState("");

  const handleFinish = async () => {
    setCompleting(true);
    setError("");
    try {
      await apiFetch("/setup/complete", { method: "POST" });
      track("setup_completed");
      window.location.href = "/dashboard";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete setup");
      setCompleting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center py-4">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
          <CheckCircle size={32} className="text-green-600" />
        </div>
        <h2 className="text-xl font-semibold">You are all set!</h2>
        <p className="text-sm text-[var(--muted-foreground)] mt-2 max-w-md mx-auto">
          Your Atrium instance is configured and ready to use. You can always
          adjust these settings later from the dashboard.
        </p>
      </div>

      {error && (
        <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">
          {error}
        </div>
      )}

      {/* Summary */}
      <div className="p-6 border border-[var(--border)] rounded-lg space-y-4">
        <h3 className="text-sm font-medium">What you can do next</h3>
        <ul className="space-y-3">
          <li className="flex items-start gap-3 text-sm">
            <span className="w-5 h-5 rounded-full bg-[var(--muted)] flex items-center justify-center shrink-0 text-xs font-medium">
              1
            </span>
            <span>
              <strong>Create projects</strong> and assign clients to give them
              portal access.
            </span>
          </li>
          <li className="flex items-start gap-3 text-sm">
            <span className="w-5 h-5 rounded-full bg-[var(--muted)] flex items-center justify-center shrink-0 text-xs font-medium">
              2
            </span>
            <span>
              <strong>Upload files</strong> to projects that clients can
              download from their portal.
            </span>
          </li>
          <li className="flex items-start gap-3 text-sm">
            <span className="w-5 h-5 rounded-full bg-[var(--muted)] flex items-center justify-center shrink-0 text-xs font-medium">
              3
            </span>
            <span>
              <strong>Post updates</strong> to keep your clients informed about
              project progress.
            </span>
          </li>
        </ul>
      </div>

      <div className="flex justify-between">
        <button
          onClick={onBack}
          className="px-6 py-2 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors"
        >
          Back
        </button>
        <button
          onClick={handleFinish}
          disabled={completing}
          className="flex items-center gap-2 px-6 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {completing ? "Finishing..." : "Go to Dashboard"}
          {!completing && <ArrowRight size={16} />}
        </button>
      </div>
    </div>
  );
}
