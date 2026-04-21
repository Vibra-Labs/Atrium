"use client";

import { Suspense, useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { StepOrgProfile } from "./step-org-profile";
import { StepEmailConfig } from "./step-email-config";
import { StepFirstProject } from "./step-first-project";
import { StepInviteClient } from "./step-invite-client";
import { StepComplete } from "./step-complete";

const ALL_STEPS = [
  { key: "org", label: "Organization" },
  { key: "email", label: "Email" },
  { key: "project", label: "First Project" },
  { key: "invite", label: "Invite Client" },
  { key: "complete", label: "Complete" },
] as const;

function SetupWizardContent() {
  const searchParams = useSearchParams();
  const [currentStep, setCurrentStep] = useState(0);
  const [orgName, setOrgName] = useState("");
  const [loading, setLoading] = useState(true);
  const [emailPreConfigured, setEmailPreConfigured] = useState(false);
  const [checkoutBanner, setCheckoutBanner] = useState<"success" | "cancelled" | null>(null);

  useEffect(() => {
    // Show checkout status banner
    const checkout = searchParams.get("checkout");
    if (checkout === "success" || checkout === "cancelled") {
      setCheckoutBanner(checkout);
      window.history.replaceState({}, "", "/setup");
    }
  }, [searchParams]);

  useEffect(() => {
    // Check if setup is already complete
    apiFetch<{ completed: boolean; emailConfigured?: boolean }>("/setup/status")
      .then((res) => {
        if (res.completed) {
          window.location.href = "/dashboard";
          return;
        }
        if (res.emailConfigured) setEmailPreConfigured(true);
        setLoading(false);
      })
      .catch(() => {
        setLoading(false);
      });

    // Load org name for pre-filling
    fetch(
      `${process.env.NEXT_PUBLIC_API_URL || ""}/api/auth/organization/get-full-organization`,
      { credentials: "include" },
    )
      .then((res) => res.json())
      .then((org) => {
        if (org?.name) setOrgName(org.name);
      })
      .catch(() => {});
  }, []);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-sm text-[var(--muted-foreground)]">Loading...</div>
      </div>
    );
  }

  const STEPS = emailPreConfigured
    ? ALL_STEPS.filter((s) => s.key !== "email")
    : ALL_STEPS;

  const goNext = () =>
    setCurrentStep((s) => Math.min(s + 1, STEPS.length - 1));
  const goBack = () => setCurrentStep((s) => Math.max(s - 1, 0));

  return (
    <div className="max-w-2xl mx-auto py-8">
      {/* Checkout status banner */}
      {checkoutBanner && (
        <div
          className={`mb-6 px-4 py-3 rounded-lg flex items-center justify-between text-sm ${
            checkoutBanner === "success"
              ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border border-emerald-500/30"
              : "bg-amber-500/15 text-amber-800 dark:text-amber-300 border border-amber-500/30"
          }`}
        >
          <span>
            {checkoutBanner === "success"
              ? "Payment successful! Your plan has been upgraded."
              : "Checkout was cancelled. You\u2019re on the Free plan \u2014 you can upgrade anytime from Settings."}
          </span>
          <button
            onClick={() => setCheckoutBanner(null)}
            className="ml-4 shrink-0 hover:opacity-70"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Welcome to Atrium</h1>
        <p className="text-[var(--muted-foreground)] mt-1">
          Let&apos;s get your client portal set up in a few quick steps.
        </p>
      </div>

      {/* Stepper */}
      <div className="mb-8">
        <div className="flex items-center">
          {STEPS.map((step, index) => (
            <div
              key={step.key}
              className="flex items-center flex-1 last:flex-none"
            >
              <div className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                    index < currentStep
                      ? "bg-green-100 text-green-700"
                      : index === currentStep
                        ? "bg-[var(--primary)] text-white"
                        : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                  }`}
                >
                  {index < currentStep ? (
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    index + 1
                  )}
                </div>
                <span
                  className={`text-sm hidden sm:inline ${
                    index === currentStep
                      ? "font-medium"
                      : "text-[var(--muted-foreground)]"
                  }`}
                >
                  {step.label}
                </span>
              </div>
              {index < STEPS.length - 1 && (
                <div
                  className={`flex-1 h-px mx-3 transition-colors ${
                    index < currentStep ? "bg-green-300" : "bg-[var(--border)]"
                  }`}
                />
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Step Content */}
      <div className="border border-[var(--border)] rounded-xl p-6 sm:p-8">
        {STEPS[currentStep]?.key === "org" && (
          <StepOrgProfile orgName={orgName} onNext={goNext} />
        )}
        {STEPS[currentStep]?.key === "email" && (
          <StepEmailConfig onNext={goNext} onBack={goBack} />
        )}
        {STEPS[currentStep]?.key === "project" && (
          <StepFirstProject onNext={goNext} onBack={goBack} />
        )}
        {STEPS[currentStep]?.key === "invite" && (
          <StepInviteClient onNext={goNext} onBack={goBack} />
        )}
        {STEPS[currentStep]?.key === "complete" && <StepComplete onBack={goBack} />}
      </div>
    </div>
  );
}

export default function SetupWizardPage() {
  return (
    <Suspense>
      <SetupWizardContent />
    </Suspense>
  );
}
