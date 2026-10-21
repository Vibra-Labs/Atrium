"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { UserPlus, Copy, Check, Trash2, UsersRound, Sparkles, ExternalLink, KeyRound } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { ClientItemSkeleton } from "@/components/skeletons";
import { track } from "@/lib/track";
import { LabelBadge } from "@/components/label-badge";
import { LabelPicker } from "@/components/label-picker";
import { copyToClipboard } from "@/lib/clipboard";
import { useAppConfig } from "@/lib/app-config";
import { ResetLinkModal, usePasswordReset } from "@/components/password-reset-link";
import { PendingInvitationRow, type Invitation } from "./pending-invitation-row";

interface LabelRecord {
  id: string;
  name: string;
  color: string;
}

interface MemberRecord {
  id: string;
  userId: string;
  role: string;
  hourlyRateCents?: number | null;
  user: { id: string; name: string; email: string };
  labels?: { label: LabelRecord }[];
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const roleColor = (role: string): string => {
  switch (role) {
    case "owner":
      return "bg-purple-100 text-purple-700";
    case "admin":
      return "bg-blue-100 text-blue-700";
    default:
      return "bg-[var(--muted)] text-[var(--foreground)]";
  }
};

/** Settings → Team: your staff (owners and admins). Clients are contacts with portal access. */
export default function TeamPage(): React.ReactElement {
  const config = useAppConfig();
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const { resetLink, resettingMemberId, sendReset, closeReset } = usePasswordReset();
  const [memberLimit, setMemberLimit] = useState<{ max: number; used: number } | null>(null);

  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [currentRole, setCurrentRole] = useState<string>("");
  const [copied, setCopied] = useState<string>("");

  const [email, setEmail] = useState<string>("");
  const [inviteRole, setInviteRole] = useState<"admin" | "owner">("admin");
  const [inviteError, setInviteError] = useState<string>("");
  const [inviteLink, setInviteLink] = useState<string>("");
  const [inviting, setInviting] = useState<boolean>(false);
  const [resendingId, setResendingId] = useState<string>("");
  const [orgLabels, setOrgLabels] = useState<LabelRecord[]>([]);

  useEffect(() => {
    apiFetch<{ user: { id: string } }>("/auth/get-session")
      .then((session) => setCurrentUserId(session.user.id))
      .catch(console.error);
    apiFetch<{ role: string }>("/auth/organization/get-active-member")
      .then((member) => setCurrentRole(member.role))
      .catch(console.error);
    apiFetch<LabelRecord[]>("/labels").then(setOrgLabels).catch(console.error);
  }, []);

  const loadMembers = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      // Staff only, every page: clients never crowd staff out of the list.
      const staff: MemberRecord[] = [];
      for (let page = 1; ; page++) {
        const res = await apiFetch<PaginatedResponse<MemberRecord>>(`/clients?role=staff&page=${page}&limit=100`);
        staff.push(...res.data);
        if (page >= res.meta.totalPages) break;
      }
      setMembers(staff);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadInvitations = useCallback(async (): Promise<Invitation[]> => {
    try {
      const all = await apiFetch<Invitation[]>("/clients/invitations");
      // Portal (client) invitations live on their contacts.
      const staff = all.filter((inv) => inv.role !== "member");
      setInvitations(staff);
      return staff;
    } catch (err) {
      console.error(err);
      return [];
    }
  }, []);

  const loadLimit = useCallback((): void => {
    if (!config?.billingEnabled) return;
    apiFetch<{ subscription: { plan: { maxMembers: number } } | null; usage: { members: number } }>(
      "/billing/subscription",
    )
      .then(({ subscription, usage }) => {
        if (subscription?.plan) setMemberLimit({ max: subscription.plan.maxMembers, used: usage.members });
      })
      .catch((err: unknown) => console.error(err));
  }, [config?.billingEnabled]);

  useEffect(() => {
    loadMembers();
    loadInvitations();
  }, [loadMembers, loadInvitations]);

  useEffect(() => {
    loadLimit();
  }, [loadLimit]);

  const atMemberLimit = memberLimit !== null && memberLimit.max !== -1 && memberLimit.used >= memberLimit.max;

  const copyLink = async (link: string): Promise<void> => {
    if (!(await copyToClipboard(link))) {
      showError("Could not copy link");
      return;
    }
    setCopied(link);
    setTimeout(() => setCopied(""), 2000);
  };

  // Staff tags live on the member (MemberLabel).
  const handleToggleMemberLabel = async (member: MemberRecord, labelId: string): Promise<void> => {
    const assigned = (member.labels ?? []).some((l) => l.label.id === labelId);
    try {
      await apiFetch(`/labels/${labelId}/assign`, {
        method: assigned ? "DELETE" : "POST",
        body: JSON.stringify({ entityType: "member", entityId: member.id }),
      });
      await loadMembers();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to update tags");
    }
  };

  const handleResendInvitation = async (inv: Invitation): Promise<void> => {
    setResendingId(inv.id);
    try {
      // Better Auth extends and re-sends a live invite. An expired one is invisible
      // to it, so the same call creates a fresh invite and the API hides the old row.
      await apiFetch("/auth/organization/invite-member", {
        method: "POST",
        body: JSON.stringify({ email: inv.email, role: inv.role, resend: true }),
      });
      track("invitation_resent", { role: inv.role, expired: inv.expired });
      await loadInvitations();
      loadLimit();
      success(`Invitation resent to ${inv.email}`);
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to resend invitation");
    } finally {
      setResendingId("");
    }
  };

  const handleRemoveMember = async (memberId: string, memberName: string): Promise<void> => {
    const ok = await confirm({
      title: "Remove Team Member",
      message: `Remove ${memberName}? They will lose access to all projects.`,
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/clients/${memberId}`, { method: "DELETE" });
      success(`${memberName} removed`);
      loadMembers();
      loadLimit();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  const handleSetRate = async (memberId: string, rawValue: string): Promise<void> => {
    const trimmed = rawValue.trim();
    let cents: number | null = null;
    if (trimmed !== "") {
      const dollars = Number(trimmed);
      if (!Number.isFinite(dollars) || dollars < 0) {
        showError("Enter a valid non-negative rate");
        return;
      }
      cents = Math.round(dollars * 100);
    }
    try {
      await apiFetch(`/clients/${memberId}/rate`, {
        method: "PUT",
        body: JSON.stringify({ hourlyRateCents: cents }),
      });
      success("Rate updated");
      setMembers((prev) => prev.map((m) => (m.id === memberId ? { ...m, hourlyRateCents: cents } : m)));
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to update rate");
    }
  };

  const handleRoleChange = async (memberId: string, newRole: string): Promise<void> => {
    try {
      await apiFetch(`/clients/${memberId}/role`, {
        method: "PUT",
        body: JSON.stringify({ role: newRole }),
      });
      success("Role updated");
      loadMembers();
    } catch (err) {
      console.error(err);
      showError(err instanceof Error ? err.message : "Failed to change role");
    }
  };

  const handleInvite = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setInviteError("");
    setInviteLink("");
    setInviting(true);
    try {
      await apiFetch("/auth/organization/invite-member", {
        method: "POST",
        body: JSON.stringify({ email, role: inviteRole }),
      });
      track("team_member_invited", { role: inviteRole });
      const submittedEmail = email.toLowerCase();
      setEmail("");
      success("Invitation sent");
      loadLimit();
      const updated = await loadInvitations();
      const newest = [...updated]
        .filter((inv) => inv.email.toLowerCase() === submittedEmail)
        .sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime())[0];
      if (newest) setInviteLink(newest.inviteLink);
    } catch (err) {
      console.error(err);
      setInviteError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setInviting(false);
    }
  };

  const isOwner = currentRole === "owner";
  const canTag = currentRole === "owner" || currentRole === "admin";

  return (
    <div className="space-y-6">
      <p className="text-sm text-[var(--muted-foreground)]">
        People who work in this workspace. Clients are managed on{" "}
        <Link href="/dashboard/contacts?access=portal" className="text-[var(--primary)] hover:underline">
          Contacts
        </Link>
        .
      </p>

      {resetLink && <ResetLinkModal resetLink={resetLink} onClose={closeReset} />}

      {!isOwner && currentRole === "admin" && (
        <p className="text-sm text-[var(--muted-foreground)]">
          Only the organization owner can invite or manage team members.
        </p>
      )}
      {isOwner && (
        <div className="max-w-lg">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-medium">Invite a Team Member</h2>
            {memberLimit && memberLimit.max !== -1 && (
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  atMemberLimit
                    ? "bg-rose-500/20 text-rose-700 dark:text-rose-300"
                    : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                }`}
              >
                {memberLimit.used}/{memberLimit.max} members
              </span>
            )}
          </div>
          {atMemberLimit ? (
            <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--muted)] px-4 py-3.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--background)] border border-[var(--border)] shadow-sm">
                <Sparkles size={15} className="text-amber-500" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold">Team member limit reached</p>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  Upgrade to Pro for up to 5 team members, or Lifetime for 100.
                </p>
              </div>
              <Link
                href="/dashboard/settings/billing?reason=members"
                className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
              >
                Upgrade
                <ExternalLink size={11} />
              </Link>
            </div>
          ) : (
            <form onSubmit={handleInvite} className="space-y-3">
              {inviteError && <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{inviteError}</div>}
              <div className="flex gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="team@example.com"
                  aria-label="Team member email"
                  required
                  className="flex-1 min-w-0 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
                />
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "admin" | "owner")}
                  aria-label="Role"
                  className="px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                >
                  <option value="admin">Admin</option>
                  <option value="owner">Owner</option>
                </select>
                <button
                  type="submit"
                  disabled={inviting}
                  className="flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium whitespace-nowrap disabled:opacity-50"
                >
                  <UserPlus size={16} />
                  {inviting ? "Inviting..." : "Invite"}
                </button>
              </div>
            </form>
          )}

          {inviteLink && (
            <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
              <p className="text-sm text-green-800 font-medium mb-2">Invitation created! Share this link:</p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={inviteLink}
                  className="flex-1 min-w-0 px-2 py-1 text-sm bg-white text-gray-900 border border-green-300 rounded font-mono"
                />
                <button
                  onClick={() => copyLink(inviteLink)}
                  className="flex items-center gap-1 px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                >
                  {copied === inviteLink ? <Check size={14} /> : <Copy size={14} />}
                  {copied === inviteLink ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {invitations.length > 0 && (
        <div>
          <h2 className="text-sm font-medium mb-3">Pending Invitations</h2>
          <div className="space-y-2">
            {invitations.map((inv) => (
              <PendingInvitationRow
                key={inv.id}
                invitation={inv}
                roleBadge={<span className={`text-xs px-2 py-0.5 rounded-full ${roleColor(inv.role)}`}>{inv.role}</span>}
                copied={copied === inv.inviteLink}
                resending={resendingId === inv.id}
                onCopy={() => copyLink(inv.inviteLink)}
                onResend={() => handleResendInvitation(inv)}
              />
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="text-sm font-medium mb-3">Members{members.length > 0 && ` (${members.length})`}</h2>
        {loading ? (
          <div className="space-y-2">
            <ClientItemSkeleton />
            <ClientItemSkeleton />
          </div>
        ) : members.length > 0 ? (
          <div className="space-y-2">
            {members.map((member) => {
              const isSelf = member.userId === currentUserId;
              const canChangeRole = isOwner && !isSelf;
              const canRemove = isOwner && !isSelf;
              const canResetPassword = !isSelf && (isOwner || (currentRole === "admin" && member.role !== "owner"));

              return (
                <div
                  key={member.id}
                  data-testid="team-member-row"
                  className="flex items-center justify-between gap-3 flex-wrap p-3 border border-[var(--border)] rounded-lg"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <p className="text-sm font-medium">{member.user.name}</p>
                      {isSelf && <span className="text-xs text-[var(--muted-foreground)]">(you)</span>}
                      {(member.labels ?? []).map((l) => (
                        <LabelBadge key={l.label.id} name={l.label.name} color={l.label.color} />
                      ))}
                      {canTag && (
                        <LabelPicker
                          labels={orgLabels}
                          assigned={(member.labels ?? []).map((l) => l.label.id)}
                          onToggle={(labelId) => handleToggleMemberLabel(member, labelId)}
                          onLabelsChange={setOrgLabels}
                        />
                      )}
                    </div>
                    <p className="text-xs text-[var(--muted-foreground)] break-all">{member.user.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {isOwner && (
                      <div className="flex items-center gap-1 text-xs text-[var(--muted-foreground)]">
                        <span>$</span>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          placeholder="Rate"
                          aria-label={`Hourly rate for ${member.user.name}`}
                          defaultValue={member.hourlyRateCents != null ? (member.hourlyRateCents / 100).toString() : ""}
                          onBlur={(e) => {
                            const next = e.target.value;
                            const current =
                              member.hourlyRateCents != null ? (member.hourlyRateCents / 100).toString() : "";
                            if (next.trim() === current) return;
                            handleSetRate(member.id, next);
                          }}
                          title="Default hourly rate"
                          className="w-16 rounded border border-[var(--border)] bg-[var(--background)] px-1.5 py-1 text-right text-xs"
                        />
                        <span>/hr</span>
                      </div>
                    )}
                    {canChangeRole ? (
                      <select
                        value={member.role}
                        onChange={(e) => handleRoleChange(member.id, e.target.value)}
                        aria-label={`Role of ${member.user.name}`}
                        className={`text-xs px-2 py-1 rounded-full border-0 cursor-pointer ${roleColor(member.role)}`}
                      >
                        <option value="owner">owner</option>
                        <option value="admin">admin</option>
                      </select>
                    ) : (
                      <span className={`text-xs px-2 py-1 rounded-full ${roleColor(member.role)}`}>{member.role}</span>
                    )}
                    {canResetPassword && (
                      <button
                        onClick={() => sendReset(member.id, member.user.email)}
                        disabled={resettingMemberId === member.id}
                        className="p-1.5 text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors disabled:opacity-50"
                        title="Send password reset link"
                        aria-label={`Send password reset link to ${member.user.name}`}
                      >
                        <KeyRound size={14} aria-hidden />
                      </button>
                    )}
                    {canRemove && (
                      <button
                        onClick={() => handleRemoveMember(member.id, member.user.name)}
                        className="p-1.5 text-[var(--muted-foreground)] hover:text-red-500 transition-colors"
                        title="Remove member"
                        aria-label={`Remove ${member.user.name}`}
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8">
            <UsersRound size={32} className="mx-auto text-[var(--muted-foreground)] mb-2" />
            <p className="text-sm text-[var(--muted-foreground)]">Just you for now. Invite team members above.</p>
          </div>
        )}
      </div>
    </div>
  );
}
