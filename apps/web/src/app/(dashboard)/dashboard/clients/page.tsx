"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { ClientItemSkeleton } from "@/components/skeletons";
import { UserPlus, Copy, Check, Trash2, ChevronDown, ChevronRight, UsersRound, Download } from "lucide-react";
import { track } from "@/lib/track";
import { LabelBadge } from "@/components/label-badge";
import { downloadCsv } from "@/lib/download";

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
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>("team");

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
        `/clients?page=1&limit=250`,
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
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to remove");
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
              <h2 className="text-sm font-medium mb-3">Invite a Team Member</h2>
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

              {teamInviteLink && (
                <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                  <p className="text-sm text-green-800 font-medium mb-2">
                    Invitation created! Share this link:
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={teamInviteLink}
                      className="flex-1 px-2 py-1 text-sm bg-white border border-green-300 rounded font-mono"
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
            <h2 className="text-sm font-medium mb-3">Invite a Client</h2>
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
