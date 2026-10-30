"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { setActiveOrgAndRedirect } from "@/lib/api";
import { track } from "@/lib/track";
import { oauthResumeUrl } from "@/lib/oauth-resume";
import { postAuth } from "@/lib/auth-fetch";
import { LAST_EMAIL_KEY, magicLinkErrorMessage, safeNextPath } from "@/lib/magic-link";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

interface LoginFormProps {
  orgName?: string;
  logoSrc?: string | null;
  hideLogo?: boolean;
}

export function LoginForm({ orgName, logoSrc, hideLogo }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [redirecting, setRedirecting] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const [next, setNext] = useState<string | null>(null);
  // Hidden until the server confirms it can send email, so it never offers a link that can't arrive.
  const [linksAvailable, setLinksAvailable] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/api/sign-in-options`)
      .then((res: Response) => (res.ok ? res.json() : { magicLink: false }))
      .then((options: { magicLink: boolean }) => setLinksAvailable(options.magicLink))
      .catch((err: unknown) => console.error("Could not load sign-in options", err));
  }, []);

  // A notification link sends a signed-out client here with ?next=; a failed
  // magic link comes back with ?error=. The remembered address saves a client
  // whose session lapsed from typing it again.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setNext(safeNextPath(params.get("next")));
    const linkError: string | null = magicLinkErrorMessage(params.get("error"));
    if (linkError) setError(linkError);
    try {
      const remembered: string | null = localStorage.getItem(LAST_EMAIL_KEY);
      if (remembered) setEmail((current) => current || remembered);
    } catch (err) {
      console.error("Could not read the remembered email", err);
    }
  }, []);

  const rememberEmail = (address: string): void => {
    try {
      localStorage.setItem(LAST_EMAIL_KEY, address);
    } catch (err) {
      console.error("Could not remember the email", err);
    }
  };

  const handleSendLink = async () => {
    if (!email) {
      setError("Enter your email and we'll send you a sign-in link.");
      return;
    }
    setSendingLink(true);
    setError("");
    const origin: string = window.location.origin;
    const back = new URL(window.location.pathname, origin);
    back.searchParams.set("error", "link");
    if (next) back.searchParams.set("next", next);
    try {
      const res: Response = await fetch(`${API_URL}/api/auth/sign-in/magic-link`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        redirect: "manual",
        body: JSON.stringify({
          email,
          // The dashboard sends clients on to the portal, so it suits everyone.
          callbackURL: `${origin}${next ?? "/dashboard"}`,
          errorCallbackURL: back.toString(),
        }),
      });
      if (!res.ok && res.type !== "opaqueredirect") {
        const data: { message?: string } = await res.json().catch(() => ({}));
        throw new Error(data.message || "Could not send a sign-in link");
      }
      rememberEmail(email);
      track("magic_link_requested", { branded: Boolean(orgName) });
      setLinkSentTo(email);
    } catch (err) {
      console.error("Failed to request a sign-in link", err);
      setError(err instanceof Error ? err.message : "Could not send a sign-in link");
    } finally {
      setSendingLink(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const resumeUrl: string | null = oauthResumeUrl(window.location.search, API_URL);

      const result = await postAuth("/sign-in/email", { email, password });
      if (!result.ok) throw new Error(result.message || "Invalid credentials");

      // Without a success counterpart, login_failed is uninterpretable: there
      // is no denominator to compute a success rate from.
      track("login_succeeded", { branded: Boolean(orgName), oauth: Boolean(resumeUrl) });
      rememberEmail(email);

      setRedirecting(true);
      window.location.href = resumeUrl ?? next ?? (await setActiveOrgAndRedirect("/portal/projects"));
    } catch (err) {
      const reason = err instanceof Error ? err.message : "Login failed";
      track("login_failed", { reason, branded: Boolean(orgName) });
      setError(reason);
      setLoading(false);
    }
  };

  if (redirecting) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <div className="w-6 h-6 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-sm text-[var(--muted-foreground)]">Signing you in...</p>
        </div>
      </div>
    );
  }

  if (linkSentTo) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="w-full max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-bold">Check your email</h1>
          <p className="text-[var(--muted-foreground)]">
            If <strong>{linkSentTo}</strong> has an account, a sign-in link is on its way. It works
            once and expires in an hour.
          </p>
          <button
            type="button"
            onClick={() => setLinkSentTo(null)}
            className="text-sm text-[var(--primary)] hover:underline"
          >
            Use a different email
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          {logoSrc && !hideLogo && (
            <div className="flex justify-center mb-4">
              <Image
                src={logoSrc}
                alt={orgName ?? "Logo"}
                width={120}
                height={48}
                className="h-12 w-auto object-contain"
              />
            </div>
          )}
          <h1 className="text-2xl font-bold">
            {orgName ? `Sign in to ${orgName}` : "Sign in to Atrium"}
          </h1>
          <p className="text-[var(--muted-foreground)] mt-2">
            Enter your credentials to continue
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">
              {error}
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
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label htmlFor="password" className="text-sm font-medium">
                Password
              </label>
              <Link
                href="/forgot-password"
                className="text-xs text-[var(--primary)] hover:underline"
              >
                Forgot password?
              </Link>
            </div>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2 bg-[var(--primary)] text-white rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && (
              <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        {linksAvailable && (
          <>
            <div className="flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
              <span className="h-px flex-1 bg-[var(--border)]" />
              or
              <span className="h-px flex-1 bg-[var(--border)]" />
            </div>

            <button
              type="button"
              onClick={handleSendLink}
              disabled={sendingLink}
              className="w-full py-2 border border-[var(--border)] rounded-lg font-medium hover:bg-[var(--muted)] transition-colors disabled:opacity-50"
            >
              {sendingLink ? "Sending..." : "Email me a sign-in link"}
            </button>
          </>
        )}

        <p className="text-center text-sm text-[var(--muted-foreground)]">
          Don&apos;t have an account?{" "}
          <Link href="/signup" className="text-[var(--primary)] hover:underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
