"use client";

import { useEffect, useState, useCallback } from "react";
import { apiFetch } from "@/lib/api";
import { useConfirm } from "@/components/confirm-modal";
import { useToast } from "@/components/toast";
import { Pagination } from "@/components/pagination";
import { ClientItemSkeleton } from "@/components/skeletons";
import { UserPlus, Copy, Check, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { track } from "@/lib/track";

interface Invitation {
  id: string;
  email: string;
  status: string;
  expiresAt: string;
  inviteLink: string;
}

interface ClientMember {
  id: string;
  userId: string;
  role: string;
  user: { id: string; name: string; email: string };
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

export default function ClientsPage() {
  const confirm = useConfirm();
  const { success, error: showError } = useToast();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [members, setMembers] = useState<ClientMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Record<string, ClientProfile>>({});
  const [editingProfile, setEditingProfile] = useState<Record<string, ClientProfile>>({});
  const [savingProfile, setSavingProfile] = useState<string | null>(null);

  // Get current user to know their role
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentRole, setCurrentRole] = useState("");

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
      const res = await apiFetch<PaginatedResponse<ClientMember>>(
        `/clients?page=${page}&limit=20`,
      );
      setMembers(res.data);
      setTotalPages(res.meta.totalPages);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [page]);

  const loadInvitations = useCallback(() => {
    apiFetch<Invitation[]>("/clients/invitations")
      .then(setInvitations)
      .catch(console.error);
  }, []);

  useEffect(() => {
    loadMembers();
    loadInvitations();
  }, [loadMembers, loadInvitations]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setInviteLink("");
    try {
      await apiFetch("/auth/organization/invite-member", {
        method: "POST",
        body: JSON.stringify({ email, role: "member" }),
      });
      track("client_invited");
      const submittedEmail = email;
      setEmail("");
      loadInvitations();
      success("Invitation sent");

      const updated = await apiFetch<Invitation[]>("/clients/invitations");
      setInvitations(updated);
      const newest = updated.find(
        (inv) => inv.email === submittedEmail.toLowerCase() || inv.email === submittedEmail,
      );
      if (newest) {
        setInviteLink(newest.inviteLink);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send invite");
    }
  };

  const copyLink = (link: string) => {
    navigator.clipboard.writeText(link);
    setCopied(link);
    setTimeout(() => setCopied(""), 2000);
  };

  const handleRemoveMember = async (memberId: string, memberName: string) => {
    const ok = await confirm({
      title: "Remove Client",
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
      showError(err instanceof Error ? err.message : "Failed to remove client");
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

  // Separate clients (member role) from agency team (owner/admin)
  const clients = members.filter((m) => m.role === "member");
  const team = members.filter((m) => m.role !== "member");

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Clients</h1>
        <p className="text-sm text-[var(--muted-foreground)] mt-1">
          Manage your clients and their access to projects.
        </p>
      </div>

      {/* Invite Form */}
      <div className="max-w-lg">
        <h2 className="text-sm font-medium mb-3">Invite a Client</h2>
        <form onSubmit={handleInvite} className="space-y-3">
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">
              {error}
            </div>
          )}
          <div className="flex gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="client@example.com"
              required
              className="flex-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
            />
            <button
              type="submit"
              className="flex items-center gap-2 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium whitespace-nowrap"
            >
              <UserPlus size={16} />
              Invite
            </button>
          </div>
        </form>

        {inviteLink && (
          <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
            <p className="text-sm text-green-800 font-medium mb-2">
              Invitation created! Share this link with your client:
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={inviteLink}
                className="flex-1 px-2 py-1 text-sm bg-white border border-green-300 rounded font-mono"
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

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <div>
          <h2 className="text-sm font-medium mb-3">Pending Invitations</h2>
          <div className="space-y-2">
            {invitations.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between p-3 border border-[var(--border)] rounded-lg"
              >
                <div>
                  <p className="text-sm font-medium">{inv.email}</p>
                  <p className="text-xs text-[var(--muted-foreground)]">
                    Expires{" "}
                    {new Date(inv.expiresAt).toLocaleDateString()}
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
                        <p className="text-sm font-medium">{member.user.name}</p>
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
                        onClick={() => handleRemoveMember(member.id, member.user.name)}
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
        <div className="mt-4">
          <Pagination page={page} totalPages={totalPages} onPageChange={setPage} />
        </div>
      </div>

      {/* Agency Team */}
      {team.length > 0 && (
        <div>
          <h2 className="text-sm font-medium mb-1">Your Team</h2>
          <p className="text-xs text-[var(--muted-foreground)] mb-3">
            Agency members who manage projects. Clients cannot see this list.
          </p>
          <div className="space-y-2">
            {team.map((member) => {
              const isSelf = member.userId === currentUserId;
              const canChangeRole = currentRole === "owner" && !isSelf;
              const canRemove = currentRole === "owner" && !isSelf;

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
                        onClick={() => handleRemoveMember(member.id, member.user.name)}
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
        </div>
      )}
    </div>
  );
}
