"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { ClientItemSkeleton } from "@/components/skeletons";
import { UserPlus, Copy, Check, Trash2, ChevronDown, ChevronRight, UsersRound, Download, Sparkles, ExternalLink, KeyRound, X, Eye } from "lucide-react";
import { track } from "@/lib/track";
import { LabelBadge } from "@/components/label-badge";
import { downloadCsv } from "@/lib/download";
import Link from "next/link";
import { useAppConfig } from "@/lib/app-config";

interface Invitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: string;
  inviteLink: string;
}

interface LabelRecord {
  id: string;
  name: string;
  color: string;
}

interface MemberRecord {
  id: string;
  userId: string;
  role: string;
  user: { id: string; name: string; email: string };
  labels?: { label: LabelRecord }[];
}

interface ClientProfile {
  company?: string;
  phone?: string;
  address?: string;
  website?: string;
  description?: string;
}

interface PaginatedResponse<T> {
  data: T[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

const roleColor = (role: string) => {
  switch (role) {
    case "owner":
      return "bg-purple-100 text-purple-700";
    case "admin":
      return "bg-blue-100 text-blue-700";
    default:
      return "bg-[var(--muted)] text-[var(--foreground)]";
  }
};

type TabId = "team" | "clients";

export default function PeoplePage() {
  const config = useAppConfig();
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>("team");
  const [planLimits, setPlanLimits] = useState<{
    maxMembers: number; membersUsed: number;
    maxClients: number; clientsUsed: number;
  } | null>(null);

  // Shared state
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentRole, setCurrentRole] = useState("");
  const [copied, setCopied] = useState("");

  // Team invite state
  const [teamEmail, setTeamEmail] = useState("");
  const [teamInviteRole, setTeamInviteRole] = useState<"admin" | "owner">("admin");
  const [teamError, setTeamError] = useState("");
  const [teamInviteLink, setTeamInviteLink] = useState("");
  const [teamInviting, setTeamInviting] = useState(false);

  // Client invite state
  const [clientEmail, setClientEmail] = useState("");
  const [clientError, setClientError] = useState("");
  const [clientInviteLink, setClientInviteLink] = useState("");
  const [clientInviting, setClientInviting] = useState(false);

  // Client list state
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, ClientProfile>>({});
  const [editingProfile, setEditingProfile] = useState<Record<string, ClientProfile>>({});
  const [savingProfile, setSavingProfile] = useState<string | null>(null);

  const [resetLink, setResetLink] = useState<{
    url: string;
    email: string;
    emailSent: boolean;
    emailViaOrgConfig: boolean;
  } | null>(null);
  const [resettingMemberId, setResettingMemberId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<{ user: { id: string } }>("/auth/get-session")
      .then((session) => setCurrentUserId(session.user.id))
      .catch(console.error);
    apiFetch<{ role: string }>("/auth/organization/get-active-member")
      .then((member) => setCurrentRole(member.role))
      .catch(console.error);
  }, []);

  const loadMembers = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch<PaginatedResponse<MemberRecord>>(
        `/clients?page=1&limit=100`,
      );
      setMembers(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadInvitations = useCallback(() => {
    apiFetch<Invitation[]>("/clients/invitations")
      .then(setInvitations)
      .catch(console.error);
  }, []);

  useEffect(() => {
    loadMembers();
    loadInvitations();
  }, [loadMembers, loadInvitations]);

  useEffect(() => {
    if (!config?.billingEnabled) return;
    Promise.all([
      apiFetch<{ subscription: { plan: { maxMembers: number; maxClients: number } } | null }>("/billing/subscription").catch(() => null),
      apiFetch<{ members: number; clients: number }>("/billing/usage").catch(() => null),
    ]).then(([sub, usage]) => {
      if (sub?.subscription?.plan && usage != null) {
        setPlanLimits({
          maxMembers: sub.subscription.plan.maxMembers,
          membersUsed: usage.members,
          maxClients: sub.subscription.plan.maxClients,
          clientsUsed: usage.clients,
        });
      }
    });
  }, [config?.billingEnabled]);

  const atMemberLimit = planLimits !== null && planLimits.maxMembers !== -1 && planLimits.membersUsed >= planLimits.maxMembers;
  const atClientLimit = planLimits !== null && planLimits.maxClients !== -1 && planLimits.clientsUsed >= planLimits.maxClients;

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    setCopied(link);
    setTimeout(() => setCopied(""), 2000);
  };

  const handleRemoveMember = async (memberId: string, memberName: string, isTeam: boolean) => {
    const ok = await confirm({
      title: isTeam ? "Remove Team Member" : "Remove Client",
      message: `Remove ${memberName}? They will lose access to all projects.`,
      confirmLabel: "Remove",
      variant: "danger",
    });
    if (!ok) return;
    try {
      await apiFetch(`/clients/${memberId}`, { method: "DELETE" });
      success(`${memberName} removed`);
      loadMembers();
      if (isTeam) {
        setPlanLimits((prev) => prev ? { ...prev, membersUsed: Math.max(0, prev.membersUsed - 1) } : prev);
      } else {
        setPlanLimits((prev) => prev ? { ...prev, clientsUsed: Math.max(0, prev.clientsUsed - 1) } : prev);
      }
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to remove");
    }
  };

  const handleViewAsClient = (
    clientUserId: string,
    clientName: string,
    clientEmail: string,
  ) => {
    track("client_viewed_as");
    const params = new URLSearchParams({
      previewAs: clientUserId,
      previewName: clientName,
      previewEmail: clientEmail,
    });
    window.open(`/portal?${params.toString()}`, "_blank", "noopener");
  };

  const handleResetPassword = async (memberId: string, email: string) => {
    const ok = await confirm({
      title: "Send Password Reset Link",
      message: `Generate a password reset link for ${email}? An email will also be sent if email delivery is configured. You'll see the link here so you can share it directly if needed.`,
      confirmLabel: "Generate Link",
    });
    if (!ok) return;
    setResettingMemberId(memberId);
    try {
      const res = await apiFetch<{
        url: string;
        email: string;
        emailSent: boolean;
        emailViaOrgConfig: boolean;
      }>(`/clients/${memberId}/reset-password`, { method: "POST" });
      setResetLink(res);
      success(
        res.emailViaOrgConfig
          ? `Reset link emailed to ${res.email}`
          : `Reset link generated for ${res.email}`,
      );
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to generate reset link");
    } finally {
      setResettingMemberId(null);
    }
  };

  const handleRoleChange = async (memberId: string, newRole: string) => {
    try {
      await apiFetch(`/clients/${memberId}/role`, {
        method: "PUT",
        body: JSON.stringify({ role: newRole }),
      });
      success("Role updated");
      loadMembers();
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to change role");
    }
  };

  // --- Team invite ---
  const handleTeamInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setTeamError("");
    setTeamInviteLink("");
    setTeamInviting(true);
    try {
      await apiFetch("/auth/organization/invite-member", {
        method: "POST",
        body: JSON.stringify({ email: teamEmail, role: teamInviteRole }),
      });
      track("team_member_invited", { role: teamInviteRole });
      const submittedEmail = teamEmail;
      setTeamEmail("");
      success("Invitation sent");
      setPlanLimits((prev) => prev ? { ...prev, membersUsed: prev.membersUsed + 1 } : prev);

      const updated = await apiFetch<Invitation[]>("/clients/invitations");
      setInvitations(updated);
      const emailLower = submittedEmail.toLowerCase();
      const newest = [...updated]
        .filter((inv) => inv.email.toLowerCase() === emailLower && inv.role !== "member")
        .sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime())[0];
      if (newest) setTeamInviteLink(newest.inviteLink);
    } catch (err) {
      setTeamError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setTeamInviting(false);
    }
  };

  // --- Client invite ---
  const handleClientInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setClientError("");
    setClientInviteLink("");
    setClientInviting(true);
    try {
      await apiFetch("/auth/organization/invite-member", {
        method: "POST",
        body: JSON.stringify({ email: clientEmail, role: "member" }),
      });
      track("client_invited");
      const submittedEmail = clientEmail;
      setClientEmail("");
      success("Invitation sent");
      setPlanLimits((prev) => prev ? { ...prev, clientsUsed: prev.clientsUsed + 1 } : prev);

      const updated = await apiFetch<Invitation[]>("/clients/invitations");
      setInvitations(updated);
      const emailLower = submittedEmail.toLowerCase();
      const newest = [...updated]
        .filter((inv) => inv.email.toLowerCase() === emailLower)
        .sort((a, b) => new Date(b.expiresAt).getTime() - new Date(a.expiresAt).getTime())[0];
      if (newest) setClientInviteLink(newest.inviteLink);
    } catch (err) {
      setClientError(err instanceof Error ? err.message : "Failed to send invite");
    } finally {
      setClientInviting(false);
    }
  };

  // --- Client profile ---
  const handleExpandMember = async (memberId: string, userId: string) => {
    if (expandedMember === memberId) {
      setExpandedMember(null);
      return;
    }
    setExpandedMember(memberId);
    if (!profiles[userId]) {
      try {
        const p = await apiFetch<ClientProfile>(`/clients/${userId}/profile`);
        setProfiles((prev) => ({ ...prev, [userId]: p }));
        setEditingProfile((prev) => ({ ...prev, [userId]: { ...p } }));
      } catch {
        setProfiles((prev) => ({ ...prev, [userId]: {} }));
        setEditingProfile((prev) => ({ ...prev, [userId]: {} }));
      }
    }
  };

  const handleSaveProfile = async (userId: string) => {
    setSavingProfile(userId);
    try {
      await apiFetch(`/clients/${userId}/profile`, {
        method: "PUT",
        body: JSON.stringify(editingProfile[userId] || {}),
      });
      setProfiles((prev) => ({ ...prev, [userId]: { ...editingProfile[userId] } }));
      success("Profile updated");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update profile");
    } finally {
      setSavingProfile(null);
    }
  };

  const team = members.filter((m) => m.role !== "member");
  const clients = members.filter((m) => m.role === "member");
  const teamInvitations = invitations.filter((inv) => inv.role !== "member");
  const clientInvitations = invitations.filter((inv) => inv.role === "member");
  const isOwner = currentRole === "owner";

  const tabs: { id: TabId; label: string; count: number }[] = [
    { id: "team", label: "Team", count: team.length },
    { id: "clients", label: "Clients", count: clients.length },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">People</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Manage your team and clients.
          </p>
        </div>
        <button
          onClick={() => downloadCsv("/clients/export")}
          className="flex items-center gap-1.5 px-3 py-2 border border-[var(--border)] rounded-lg text-sm text-[var(--muted-foreground)] hover:bg-[var(--muted)] transition-colors"
          title="Export CSV"
        >
          <Download size={16} />
          <span className="hidden sm:inline">Export</span>
        </button>
      </div>

      {resetLink && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setResetLink(null);
          }}
        >
          <div className="bg-[var(--background)] rounded-xl shadow-lg w-full max-w-md p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold">Password reset link</h3>
                <p className="text-sm text-[var(--muted-foreground)] mt-0.5">
                  For {resetLink.email}
                </p>
              </div>
              <button
                onClick={() => setResetLink(null)}
                className="p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div
              className={
                resetLink.emailViaOrgConfig
                  ? "p-3 rounded-lg text-sm bg-green-50 text-green-800 border border-green-200"
                  : "p-3 rounded-lg text-sm bg-amber-50 text-amber-900 border border-amber-200"
              }
            >
              {resetLink.emailViaOrgConfig
                ? `An email with this link was sent to ${resetLink.email} via your organization's email config.`
                : resetLink.emailSent
                  ? `Sent via the platform default to ${resetLink.email}. If it doesn't arrive, share the link below directly.`
                  : "No email provider is configured, so no email was sent. Copy the link below and share it with the user directly."}
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-medium text-[var(--muted-foreground)]">
                Reset link (expires in 1 hour)
              </label>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={resetLink.url}
                  onFocus={(e) => e.currentTarget.select()}
                  autoFocus
                  className="flex-1 px-2 py-1.5 text-sm bg-[var(--muted)] text-[var(--foreground)] border border-[var(--border)] rounded font-mono"
                />
                <button
                  onClick={() => copyLink(resetLink.url)}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-[var(--primary)] text-white rounded hover:opacity-90"
                >
                  {copied === resetLink.url ? <Check size={14} /> : <Copy size={14} />}
                  {copied === resetLink.url ? "Copied!" : "Copy"}
                </button>
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">
                Refreshing the page will not retrieve this link again.
              </p>
            </div>

            <div className="flex justify-end">
              <button
                onClick={() => setResetLink(null)}
                className="px-4 py-1.5 border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--muted)] transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="relative">
        <div className="flex">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full ${
                activeTab === tab.id
                  ? "text-[var(--primary)] after:bg-[var(--primary)]"
                  : "text-[var(--muted-foreground)] hover:text-[var(--foreground)] after:bg-transparent"
              }`}
            >
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-1.5 text-xs text-[var(--muted-foreground)]">
                  ({tab.count})
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="absolute bottom-0 left-0 right-0 h-px bg-[var(--border)] -z-10" />
      </div>

      {/* ── Team Tab ── */}
      {activeTab === "team" && (
        <div className="space-y-6">
          {/* Team Invite — owner only */}
          {!isOwner && currentRole === "admin" && (
            <p className="text-sm text-[var(--muted-foreground)]">
              Only the organization owner can invite or manage team members.
            </p>
          )}
          {isOwner && (
            <div className="max-w-lg">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium">Invite a Team Member</h2>
                {planLimits && planLimits.maxMembers !== -1 && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    atMemberLimit ? "bg-rose-500/20 text-rose-700 dark:text-rose-300" : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                  }`}>
                    {planLimits.membersUsed}/{planLimits.maxMembers} members
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
                    href="/dashboard/settings/account?tab=billing&reason=members"
                    className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
                  >
                    Upgrade
                    <ExternalLink size={11} />
                  </Link>
                </div>
              ) : (
              <form onSubmit={handleTeamInvite} className="space-y-3">
                {teamError && (
                  <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{teamError}</div>
                )}
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={teamEmail}
                    onChange={(e) => setTeamEmail(e.target.value)}
                    placeholder="team@example.com"
                    required
                    className="flex-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
                  />
                  <select
                    value={teamInviteRole}
                    onChange={(e) => setTeamInviteRole(e.target.value as "admin" | "owner")}
                    className="px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                  >
                    <option value="admin">Admin</option>
                    <option value="owner">Owner</option>
                  </select>
                  <button
                    type="submit"
                    disabled={teamInviting}
                    className="flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium whitespace-nowrap disabled:opacity-50"
                  >
                    <UserPlus size={16} />
                    {teamInviting ? "Inviting..." : "Invite"}
                  </button>
                </div>
              </form>
              )}

              {teamInviteLink && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-800 font-medium mb-2">
                    Invitation created! Share this link:
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={teamInviteLink}
                      className="flex-1 px-2 py-1 text-sm bg-white text-gray-900 border border-green-300 rounded font-mono"
                    />
                    <button
                      onClick={() => copyLink(teamInviteLink)}
                      className="flex items-center gap-1 px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                    >
                      {copied === teamInviteLink ? <Check size={14} /> : <Copy size={14} />}
                      {copied === teamInviteLink ? "Copied!" : "Copy"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Pending Team Invitations */}
          {teamInvitations.length > 0 && (
            <div>
              <h2 className="text-sm font-medium mb-3">Pending Invitations</h2>
              <div className="space-y-2">
                {teamInvitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between p-3 border border-[var(--border)] rounded-lg"
                  >
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{inv.email}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${roleColor(inv.role)}`}>
                        {inv.role}
                      </span>
                    </div>
                    <button
                      onClick={() => copyLink(inv.inviteLink)}
                      className="flex items-center gap-1 text-sm text-[var(--primary)] hover:underline"
                    >
                      {copied === inv.inviteLink ? <Check size={14} /> : <Copy size={14} />}
                      {copied === inv.inviteLink ? "Copied!" : "Copy Link"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Team Members List */}
          <div>
            <h2 className="text-sm font-medium mb-3">
              Members{team.length > 0 && ` (${team.length})`}
            </h2>
            {loading ? (
              <div className="space-y-2">
                <ClientItemSkeleton />
                <ClientItemSkeleton />
              </div>
            ) : team.length > 0 ? (
              <div className="space-y-2">
                {team.map((member) => {
                  const isSelf = member.userId === currentUserId;
                  const canChangeRole = isOwner && !isSelf;
                  const canRemove = isOwner && !isSelf;
                  const canResetPassword =
                    !isSelf && (isOwner || (currentRole === "admin" && member.role !== "owner"));

                  return (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-3 border border-[var(--border)] rounded-lg"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{member.user.name}</p>
                          {isSelf && (
                            <span className="text-xs text-[var(--muted-foreground)]">(you)</span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {member.user.email}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {canChangeRole ? (
                          <select
                            value={member.role}
                            onChange={(e) => handleRoleChange(member.id, e.target.value)}
                            className={`text-xs px-2 py-1 rounded-full border-0 cursor-pointer ${roleColor(member.role)}`}
                          >
                            <option value="owner">owner</option>
                            <option value="admin">admin</option>
                          </select>
                        ) : (
                          <span className={`text-xs px-2 py-1 rounded-full ${roleColor(member.role)}`}>
                            {member.role}
                          </span>
                        )}
                        {canResetPassword && (
                          <button
                            onClick={() => handleResetPassword(member.id, member.user.email)}
                            disabled={resettingMemberId === member.id}
                            className="p-1.5 text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors disabled:opacity-50"
                            title="Send password reset link"
                          >
                            <KeyRound size={14} />
                          </button>
                        )}
                        {canRemove && (
                          <button
                            onClick={() => handleRemoveMember(member.id, member.user.name, true)}
                            className="p-1.5 text-[var(--muted-foreground)] hover:text-red-500 transition-colors"
                            title="Remove member"
                          >
                            <Trash2 size={14} />
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
                <p className="text-sm text-[var(--muted-foreground)]">
                  Just you for now. Invite team members above.
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Clients Tab ── */}
      {activeTab === "clients" && (
        <div className="space-y-6">
          {/* Client Invite */}
          <div className="max-w-lg">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium">Invite a Client</h2>
              {planLimits && planLimits.maxClients !== -1 && (
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  atClientLimit ? "bg-rose-500/20 text-rose-700 dark:text-rose-300" : "bg-[var(--muted)] text-[var(--muted-foreground)]"
                }`}>
                  {planLimits.clientsUsed}/{planLimits.maxClients} clients
                </span>
              )}
            </div>
            {atClientLimit ? (
              <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--muted)] px-4 py-3.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--background)] border border-[var(--border)] shadow-sm">
                  <Sparkles size={15} className="text-amber-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold">Client limit reached</p>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    Upgrade to Pro for unlimited clients.
                  </p>
                </div>
                <Link
                  href="/dashboard/settings/account?tab=billing&reason=clients"
                  className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold hover:opacity-90 transition-opacity whitespace-nowrap"
                >
                  Upgrade
                  <ExternalLink size={11} />
                </Link>
              </div>
            ) : (
            <form onSubmit={handleClientInvite} className="space-y-3">
              {clientError && (
                <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{clientError}</div>
              )}
              <div className="flex gap-2">
                <input
                  type="email"
                  value={clientEmail}
                  onChange={(e) => setClientEmail(e.target.value)}
                  placeholder="client@example.com"
                  required
                  className="flex-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
                />
                <button
                  type="submit"
                  disabled={clientInviting}
                  className="flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium whitespace-nowrap disabled:opacity-50"
                >
                  <UserPlus size={16} />
                  {clientInviting ? "Inviting..." : "Invite"}
                </button>
              </div>
            </form>
            )}

            {clientInviteLink && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-sm text-green-800 font-medium mb-2">
                  Invitation created! Share this link with your client:
                </p>
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={clientInviteLink}
                    className="flex-1 px-2 py-1 text-sm bg-white border border-green-300 rounded font-mono"
                  />
                  <button
                    onClick={() => copyLink(clientInviteLink)}
                    className="flex items-center gap-1 px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700"
                  >
                    {copied === clientInviteLink ? <Check size={14} /> : <Copy size={14} />}
                    {copied === clientInviteLink ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Pending Client Invitations */}
          {clientInvitations.length > 0 && (
            <div>
              <h2 className="text-sm font-medium mb-3">Pending Invitations</h2>
              <div className="space-y-2">
                {clientInvitations.map((inv) => (
                  <div
                    key={inv.id}
                    className="flex items-center justify-between p-3 border border-[var(--border)] rounded-lg"
                  >
                    <div>
                      <p className="text-sm font-medium">{inv.email}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        Expires {new Date(inv.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => copyLink(inv.inviteLink)}
                      className="flex items-center gap-1 text-sm text-[var(--primary)] hover:underline"
                    >
                      {copied === inv.inviteLink ? <Check size={14} /> : <Copy size={14} />}
                      {copied === inv.inviteLink ? "Copied!" : "Copy Link"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Clients List */}
          <div>
            <h2 className="text-sm font-medium mb-3">
              Clients{clients.length > 0 && ` (${clients.length})`}
            </h2>
            {loading ? (
              <div className="space-y-2">
                <ClientItemSkeleton />
                <ClientItemSkeleton />
              </div>
            ) : clients.length > 0 ? (
              <div className="space-y-2">
                {clients.map((member) => {
                  const isExpanded = expandedMember === member.id;
                  const memberProfile = editingProfile[member.userId];
                  const savedProfile = profiles[member.userId];

                  return (
                    <div
                      key={member.id}
                      className="border border-[var(--border)] rounded-lg"
                    >
                      <div
                        className="flex items-center justify-between p-3 cursor-pointer hover:bg-[var(--muted)] transition-colors"
                        onClick={() => handleExpandMember(member.id, member.userId)}
                      >
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                          <div>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-sm font-medium">{member.user.name}</p>
                              {member.labels && member.labels.length > 0 &&
                                member.labels.map((l) => (
                                  <LabelBadge key={l.label.id} name={l.label.name} color={l.label.color} />
                                ))
                              }
                            </div>
                            <p className="text-xs text-[var(--muted-foreground)]">
                              {member.user.email}
                              {savedProfile?.company && (
                                <span> &middot; {savedProfile.company}</span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                          {(currentRole === "owner" || currentRole === "admin") && (
                            <button
                              onClick={() =>
                                handleViewAsClient(
                                  member.userId,
                                  member.user.name,
                                  member.user.email,
                                )
                              }
                              className="p-1.5 text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors"
                              title="View as customer"
                              aria-label={`View portal as ${member.user.name}`}
                            >
                              <Eye size={14} />
                            </button>
                          )}
                          <button
                            onClick={() => handleResetPassword(member.id, member.user.email)}
                            disabled={resettingMemberId === member.id}
                            className="p-1.5 text-[var(--muted-foreground)] hover:text-[var(--primary)] transition-colors disabled:opacity-50"
                            title="Send password reset link"
                          >
                            <KeyRound size={14} />
                          </button>
                          <button
                            onClick={() => handleRemoveMember(member.id, member.user.name, false)}
                            className="p-1.5 text-[var(--muted-foreground)] hover:text-red-500 transition-colors"
                            title="Remove client"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>

                      {isExpanded && memberProfile && (
                        <div className="px-3 pb-3 pt-1 border-t border-[var(--border)] space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="text-xs text-[var(--muted-foreground)]">Company</label>
                              <input
                                type="text"
                                value={memberProfile.company || ""}
                                onChange={(e) =>
                                  setEditingProfile((prev) => ({
                                    ...prev,
                                    [member.userId]: { ...prev[member.userId], company: e.target.value },
                                  }))
                                }
                                className="w-full mt-0.5 px-2 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-[var(--muted-foreground)]">Phone</label>
                              <input
                                type="text"
                                value={memberProfile.phone || ""}
                                onChange={(e) =>
                                  setEditingProfile((prev) => ({
                                    ...prev,
                                    [member.userId]: { ...prev[member.userId], phone: e.target.value },
                                  }))
                                }
                                className="w-full mt-0.5 px-2 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-[var(--muted-foreground)]">Address</label>
                              <input
                                type="text"
                                value={memberProfile.address || ""}
                                onChange={(e) =>
                                  setEditingProfile((prev) => ({
                                    ...prev,
                                    [member.userId]: { ...prev[member.userId], address: e.target.value },
                                  }))
                                }
                                className="w-full mt-0.5 px-2 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-[var(--muted-foreground)]">Website</label>
                              <input
                                type="text"
                                value={memberProfile.website || ""}
                                onChange={(e) =>
                                  setEditingProfile((prev) => ({
                                    ...prev,
                                    [member.userId]: { ...prev[member.userId], website: e.target.value },
                                  }))
                                }
                                className="w-full mt-0.5 px-2 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-[var(--muted-foreground)]">Description</label>
                            <textarea
                              value={memberProfile.description || ""}
                              onChange={(e) =>
                                setEditingProfile((prev) => ({
                                  ...prev,
                                  [member.userId]: { ...prev[member.userId], description: e.target.value },
                                }))
                              }
                              rows={2}
                              className="w-full mt-0.5 px-2 py-1.5 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm resize-none"
                            />
                          </div>
                          <button
                            onClick={() => handleSaveProfile(member.userId)}
                            disabled={savingProfile === member.userId}
                            className="px-3 py-1.5 bg-[var(--primary)] text-white rounded-lg text-sm hover:opacity-90 disabled:opacity-50"
                          >
                            {savingProfile === member.userId ? "Saving..." : "Save Profile"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-[var(--muted-foreground)] text-center py-4">
                No clients yet. Invite your first client above.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
