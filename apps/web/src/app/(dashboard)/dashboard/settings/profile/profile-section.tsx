"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-modal";
import type { DeletionInfo } from "@atrium/shared";

export function ProfileSection(): React.ReactElement {
  const { success, error: showError } = useToast();
  const confirm = useConfirm();
  const [name, setName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);

  const [currentPassword, setCurrentPassword] = useState<string>("");
  const [newPassword, setNewPassword] = useState<string>("");
  const [confirmPassword, setConfirmPassword] = useState<string>("");
  const [deleting, setDeleting] = useState<boolean>(false);
  const [deletePassword, setDeletePassword] = useState<string>("");
  const [deletionInfo, setDeletionInfo] = useState<DeletionInfo | null>(null);

  useEffect(() => {
    apiFetch<{ user: { name: string } }>("/auth/get-session")
      .then((session) => {
        setName(session.user.name);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });

    apiFetch<DeletionInfo>("/account/deletion-info")
      .then(setDeletionInfo)
      .catch((err) => console.error(err));
  }, []);

  const handleUpdateProfile = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    try {
      await apiFetch("/auth/update-user", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      success("Profile updated");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to update profile");
    }
  };

  const handleChangePassword = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (newPassword.length < 8) {
      showError("Password must be at least 8 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      showError("Passwords do not match");
      return;
    }
    try {
      await apiFetch("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      success("Password changed");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to change password");
    }
  };

  const handleDeleteAccount = async (): Promise<void> => {
    if (!deletePassword) {
      showError("Enter your password to confirm account deletion.");
      return;
    }

    const orgsToDelete = deletionInfo?.ownedOrganizations.filter((o) => o.isSoleOwner) || [];
    const orgName = orgsToDelete[0]?.name;

    const message = orgName
      ? `This will permanently delete your account and your organization "${orgName}" including all its projects, files, invoices, and client access. This action cannot be undone.`
      : "This will permanently delete your account and all associated data. This action cannot be undone.";

    const confirmText = orgName ? `DELETE ${orgName}` : "DELETE";

    const confirmed = await confirm({
      title: "Delete Account",
      message,
      confirmLabel: "Delete Account",
      confirmText,
      variant: "danger",
    });
    if (!confirmed) return;

    setDeleting(true);
    try {
      await apiFetch("/account", {
        method: "DELETE",
        body: JSON.stringify({ password: deletePassword }),
      });
      window.location.href = "/login";
    } catch (err) {
      showError(err instanceof Error ? err.message : "Failed to delete account");
      setDeletePassword("");
    } finally {
      setDeleting(false);
    }
  };

  if (loading) return <div>Loading...</div>;

  const isOwner = deletionInfo !== null && deletionInfo.ownedOrganizations.length > 0;

  return (
    <div className="space-y-8">
      <div className="max-w-md">
        <h2 className="text-base font-semibold mb-3">Profile</h2>
        <form onSubmit={handleUpdateProfile} className="space-y-3">
          <div>
            <label className="text-sm text-[var(--muted-foreground)]">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium"
          >
            Save
          </button>
        </form>
      </div>

      <div className="max-w-md">
        <h2 className="text-base font-semibold mb-3">Change Password</h2>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <div>
            <label className="text-sm text-[var(--muted-foreground)]">Current Password</label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
            />
          </div>
          <div>
            <label className="text-sm text-[var(--muted-foreground)]">New Password</label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
            />
          </div>
          <div>
            <label className="text-sm text-[var(--muted-foreground)]">Confirm New Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
            />
          </div>
          <button
            type="submit"
            className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium"
          >
            Change Password
          </button>
        </form>
      </div>

      <div className="max-w-md border border-red-300 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-medium text-red-600">Danger Zone</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          {isOwner
            ? "Permanently delete your account and your organization. All projects, files, invoices, and client access will be removed."
            : "Permanently delete your account. You will be removed from this organization and lose access to all projects."}
        </p>
        <div>
          <label className="text-sm text-[var(--muted-foreground)]">
            Enter your password to confirm
          </label>
          <input
            type="password"
            value={deletePassword}
            onChange={(e) => setDeletePassword(e.target.value)}
            placeholder="Your current password"
            className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] text-sm"
          />
        </div>
        <button
          onClick={handleDeleteAccount}
          disabled={deleting || !deletePassword}
          className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors disabled:opacity-50"
        >
          {deleting ? "Deleting..." : "Delete Account"}
        </button>
      </div>
    </div>
  );
}
