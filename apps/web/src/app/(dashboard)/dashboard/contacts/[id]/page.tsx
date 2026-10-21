"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useAppConfig } from "@/lib/app-config";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";
import { ProjectDetailSkeleton } from "@/components/skeletons";
import { STATUS_LABELS } from "../shared";
import { RatingBadge } from "../rating-badge";
import { RevenueStrip } from "./revenue-strip";
import { Timeline } from "./timeline";
import { ContactSidePanel } from "./contact-side-panel";
import { EditContactModal } from "./edit-contact-modal";
import type { ContactDetail } from "./types";

export default function ContactPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { success, error: showError } = useToast();
  const confirm = useConfirm();
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [timelineKey, setTimelineKey] = useState(0);
  const [atClientLimit, setAtClientLimit] = useState(false);
  const config = useAppConfig();

  const load = useCallback(async (): Promise<void> => {
    try {
      setContact(await apiFetch<ContactDetail>(`/contacts/${id}`));
    } catch (err) {
      console.error(err);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // At the plan's client limit (the rule the invite API enforces), offer the upgrade instead.
  useEffect(() => {
    if (!config?.billingEnabled) return;
    apiFetch<{
      subscription: { plan: { maxClients: number } } | null;
      usage: { clients: number };
    }>("/billing/subscription")
      .then(({ subscription, usage }) => {
        const max = subscription?.plan.maxClients;
        setAtClientLimit(max !== undefined && max !== -1 && usage.clients >= max);
      })
      .catch((err: unknown) => console.error(err));
  }, [config?.billingEnabled]);

  // Any change on the page may have added an automatic timeline event.
  const refresh = useCallback((): void => {
    setTimelineKey((k) => k + 1);
    load();
  }, [load]);

  async function invite(): Promise<void> {
    if (!contact?.email) return;
    setInviting(true);
    try {
      await apiFetch("/auth/organization/invite-member", {
        method: "POST",
        body: JSON.stringify({ email: contact.email, role: "member" }),
      });
      success("Invitation sent");
      refresh();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to send invitation");
    } finally {
      setInviting(false);
    }
  }

  async function remove(): Promise<void> {
    if (!contact) return;
    const ok = await confirm({
      title: "Delete contact",
      message: `Delete ${contact.name}? Their notes and history are removed too.`,
      confirmLabel: "Delete",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/contacts/${contact.id}`, { method: "DELETE" });
      router.push("/dashboard/contacts");
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to delete contact");
    }
  }

  if (loading) return <ProjectDetailSkeleton />;
  if (notFound || !contact) {
    return (
      <div className="py-12 text-center space-y-2">
        <p className="text-[var(--muted-foreground)]">Contact not found.</p>
        <Link href="/dashboard/contacts" className="text-sm hover:underline">
          Back to contacts
        </Link>
      </div>
    );
  }

  const buttonClass =
    "px-3 py-2 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors";

  return (
    <div className="space-y-4">
      <Link href="/dashboard/contacts" className="text-sm text-[var(--muted-foreground)] hover:underline">
        ‹ Contacts
      </Link>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">
            {contact.name}
            {contact.company && (
              <span className="text-lg font-normal text-[var(--muted-foreground)]">
                {" · "}
                <Link
                  href={`/dashboard/contacts/companies/${contact.company.id}`}
                  className="hover:underline"
                >
                  {contact.company.name}
                </Link>
              </span>
            )}
          </h1>
          {(contact.jobTitle || contact.department) && (
            <p data-testid="contact-role" className="text-sm text-[var(--muted-foreground)] mt-0.5">
              {[contact.jobTitle, contact.department].filter(Boolean).join(" · ")}
            </p>
          )}
          <p className="text-sm text-[var(--muted-foreground)] mt-1 flex items-center gap-2 flex-wrap">
            <span
              data-testid="contact-status"
              className="inline-flex px-2 py-0.5 rounded-full bg-[var(--muted)] text-xs font-medium text-[var(--foreground)]"
            >
              {STATUS_LABELS[contact.status] ?? contact.status}
            </span>
            <RatingBadge rating={contact.rating} />
            {contact.hasLogin && <span>has portal login</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {contact.email && !contact.hasLogin && atClientLimit && (
            <Link
              href="/dashboard/settings/billing?reason=clients"
              title="Client limit reached. Upgrade to Pro for unlimited clients."
              className="px-3 py-2 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90"
            >
              Upgrade to invite
            </Link>
          )}
          {contact.email && !contact.hasLogin && !atClientLimit && (
            <button
              onClick={invite}
              disabled={inviting}
              className="px-3 py-2 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-40"
            >
              {inviting ? "Inviting..." : "Invite to portal"}
            </button>
          )}
          <button onClick={() => setEditing(true)} className={buttonClass}>
            Edit
          </button>
          <button onClick={remove} className={`${buttonClass} text-red-600`}>
            Delete
          </button>
        </div>
      </div>

      <RevenueStrip revenue={contact.revenue} />

      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <Timeline contactId={contact.id} refreshKey={timelineKey} />
        <ContactSidePanel contact={contact} onChanged={refresh} />
      </div>

      {editing && (
        <EditContactModal
          contact={contact}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}
