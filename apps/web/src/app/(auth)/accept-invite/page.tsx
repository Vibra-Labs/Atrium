"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { setActiveOrgAndRedirect } from "@/lib/api";
import { track } from "@/lib/track";
import { postAuth } from "@/lib/auth-fetch";
import { magicLinkErrorMessage } from "@/lib/magic-link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface InvitationSummary {
  email: string;
  organizationName: string;
  portal: boolean;
}

type PageState =
  | { kind: "loading" }
  | { kind: "invalid" }
  | { kind: "wrong-account"; invitation: InvitationSummary; signedInAs: string }
  | { kind: "ready"; invitation: InvitationSummary };

/** Joins the invited workspace and returns where to send the browser next. */
async function acceptAndRedirect(invitationId: string): Promise<string> {
  const acceptRes = await fetch(`${API_URL}/api/auth/organization/accept-invitation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ invitationId }),
    credentials: "include",
  });
  if (!acceptRes.ok) {
    const data = await acceptRes.json().catch(() => ({}));
    throw new Error(data.message || "Failed to accept invitation");
  }

  // Pin the active org to the one we just joined. Without this, users who
  // already belong to another org (e.g. their own agency) can be routed
  // to that org's dashboard/setup instead of the invited org's portal.
  const acceptData: {
    member?: { organizationId?: string };
    invitation?: { organizationId?: string };
  } = await acceptRes.json().catch(() => ({}));
  const joinedOrgId = acceptData.member?.organizationId ?? acceptData.invitation?.organizationId;

  track("invite_accepted");
  return setActiveOrgAndRedirect("/portal", joinedOrgId);
}

async function signedInEmail(): Promise<string | null> {
  try {
    const res: Response = await fetch(`${API_URL}/api/auth/get-session`, { credentials: "include" });
    if (!res.ok) return null;
    const data: { user?: { email?: string } } | null = await res.json();
    return data?.user?.email ?? null;
  } catch (err) {
    console.error("Failed to read session", err);
    return null;
  }
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6 text-center">{children}</div>
    </div>
  );
}

function AcceptInviteContent() {
  const searchParams = useSearchParams();
  const invitationId: string | null = searchParams.get("id");
  const linkError: string | null = magicLinkErrorMessage(searchParams.get("error"));
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [error, setError] = useState("");
  const [usePassword, setUsePassword] = useState(false);

  useEffect(() => {
    if (!invitationId) {
      setState({ kind: "invalid" });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res: Response = await fetch(`${API_URL}/api/invitations/${encodeURIComponent(invitationId)}`, {
          credentials: "include",
        });
        if (!res.ok) {
          if (!cancelled) setState({ kind: "invalid" });
          return;
        }
        const invitation: InvitationSummary = await res.json();
        const email: string | null = await signedInEmail();
        if (cancelled) return;

        if (!email) {
          setState({ kind: "ready", invitation });
        } else if (email.toLowerCase() !== invitation.email.toLowerCase()) {
          setState({ kind: "wrong-account", invitation, signedInAs: email });
        } else {
          // Signed in as the invitee — including straight back from the sign-in link.
          window.location.href = await acceptAndRedirect(invitationId);
        }
      } catch (err) {
        console.error("Failed to load invitation", err);
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Something went wrong");
          setState({ kind: "invalid" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invitationId]);

  if (state.kind === "loading") {
    return (
      <Centered>
        <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto" />
      </Centered>
    );
  }

  if (state.kind === "invalid" || !invitationId) {
    return (
      <Centered>
        <div>
          <h1 className="text-2xl font-bold mb-2">Invitation unavailable</h1>
          <p className="text-[var(--muted-foreground)]">
            {error || "This invitation has expired or was already used. Ask whoever invited you to send a new one."}
          </p>
        </div>
        <Link href="/login" className="text-sm text-[var(--primary)] hover:underline">
          Already joined? Sign in
        </Link>
      </Centered>
    );
  }

  if (state.kind === "wrong-account") {
    return (
      <Centered>
        <div>
          <h1 className="text-2xl font-bold mb-2">Different account</h1>
          <p className="text-[var(--muted-foreground)]">
            You&apos;re signed in as <strong>{state.signedInAs}</strong>, but this invitation is for{" "}
            <strong>{state.invitation.email}</strong>.
          </p>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              await fetch(`${API_URL}/api/auth/sign-out`, { method: "POST", credentials: "include" });
            } catch (err) {
              console.error("Failed to sign out", err);
            }
            window.location.reload();
          }}
          className="w-full py-2 bg-[var(--primary)] text-white rounded-lg font-medium hover:opacity-90 transition-opacity"
        >
          Sign out and continue
        </button>
      </Centered>
    );
  }

  if (!state.invitation.portal || usePassword) {
    return <PasswordInvite invitationId={invitationId} invitedEmail={state.invitation.email} />;
  }

  return (
    <OneClickInvite
      invitationId={invitationId}
      invitation={state.invitation}
      linkError={linkError}
      onUsePassword={() => setUsePassword(true)}
    />
  );
}

// Client invites: one press and they're in. No name, no password.
function OneClickInvite({
  invitationId,
  invitation,
  linkError,
  onUsePassword,
}: {
  invitationId: string;
  invitation: InvitationSummary;
  linkError: string | null;
  onUsePassword: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [emailed, setEmailed] = useState(false);
  const [error, setError] = useState(linkError ?? "");

  const handleOpen = async () => {
    setLoading(true);
    setError("");
    try {
      const res: Response = await fetch(`${API_URL}/api/invitations/${encodeURIComponent(invitationId)}/sign-in`, {
        method: "POST",
        credentials: "include",
      });
      const data: { url?: string; emailed?: boolean; message?: string } = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message || "Could not open your portal");
      if (data.url) {
        track("invite_one_click");
        window.location.href = data.url;
        return;
      }
      setEmailed(true);
      setLoading(false);
    } catch (err) {
      console.error("Failed to start invite sign-in", err);
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  if (emailed) {
    return (
      <Centered>
        <h1 className="text-2xl font-bold">Check your email</h1>
        <p className="text-[var(--muted-foreground)]">
          <strong>{invitation.email}</strong> already has an account, so we&apos;ve emailed it a sign-in link.
          Open it to join <strong>{invitation.organizationName}</strong>. It expires in an hour.
        </p>
      </Centered>
    );
  }

  return (
    <Centered>
      <div>
        <h1 className="text-2xl font-bold">You&apos;re invited to {invitation.organizationName}</h1>
        <p className="text-[var(--muted-foreground)] mt-2">
          as <strong>{invitation.email}</strong>
        </p>
      </div>
      {error && (
        <div className="p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 rounded-lg">
          {error}
        </div>
      )}
      <button
        type="button"
        onClick={handleOpen}
        disabled={loading}
        className="w-full py-2 bg-[var(--primary)] text-white rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {loading ? "Opening..." : "Open my portal"}
      </button>
      <p className="text-xs text-[var(--muted-foreground)]">
        No password needed.{" "}
        <button type="button" onClick={onUsePassword} className="text-[var(--primary)] hover:underline">
          Use a password instead
        </button>
      </p>
    </Centered>
  );
}

// Team invites: staff sign in with a password, as before.
function PasswordInvite({ invitationId, invitedEmail }: { invitationId: string; invitedEmail: string }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(invitedEmail);
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"signup" | "login">("signup");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // Step 1: Sign up or login. Both go through postAuth, which never
      // follows the 302 Better Auth answers with while a signed
      // `oidc_login_prompt` cookie from an abandoned MCP connection is around.
      if (mode === "signup") {
        const signUp = await postAuth("/sign-up/email", { name, email, password });
        if (!signUp.ok) {
          // If user already exists, auto-switch to login and retry
          if (signUp.status === 422 || signUp.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
            const signIn = await postAuth("/sign-in/email", { email, password });
            if (!signIn.ok) {
              throw new Error(signIn.message || "Account exists but login failed. Try signing in instead.");
            }
            setMode("login");
          } else {
            throw new Error(signUp.message || "Signup failed");
          }
        }
      } else {
        const signIn = await postAuth("/sign-in/email", { email, password });
        if (!signIn.ok) throw new Error(signIn.message || "Login failed");
      }

      // Step 2: Accept the invitation, then go to the portal
      window.location.href = await acceptAndRedirect(invitationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold">Join Project Portal</h1>
          <p className="text-[var(--muted-foreground)] mt-2">
            {mode === "signup"
              ? "Create an account to access your project"
              : "Sign in to accept your invitation"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/50 rounded-lg">
              {error}
            </div>
          )}

          {mode === "signup" && (
            <div className="space-y-2">
              <label htmlFor="name" className="text-sm font-medium">
                Your Name
              </label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
              />
            </div>
          )}

          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={8}
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-[var(--primary)] text-white rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading
              ? "Processing..."
              : mode === "signup"
                ? "Create Account & Join"
                : "Sign In & Join"}
          </button>
        </form>

        <p className="text-center text-sm text-[var(--muted-foreground)]">
          {mode === "signup" ? (
            <>
              Already have an account?{" "}
              <button
                onClick={() => setMode("login")}
                className="text-[var(--primary)] hover:underline"
              >
                Sign in instead
              </button>
            </>
          ) : (
            <>
              Need an account?{" "}
              <button
                onClick={() => setMode("signup")}
                className="text-[var(--primary)] hover:underline"
              >
                Sign up
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense>
      <AcceptInviteContent />
    </Suspense>
  );
}
