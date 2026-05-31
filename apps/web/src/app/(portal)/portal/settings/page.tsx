"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/components/toast";

interface ClientProfile {
  company?: string;
  phone?: string;
  address?: string;
  website?: string;
  description?: string;
}

export default function PortalSettingsPage() {
  const { success, error: showError } = useToast();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  // Password fields
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Profile fields
  const [profile, setProfile] = useState<ClientProfile>({});
  const [profileLoading, setProfileLoading] = useState(true);

  // Delete account
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    apiFetch<{ user: { name: string } }>("/auth/get-session")
      .then((session) => {
        setName(session.user.name);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    apiFetch<ClientProfile>("/clients/me/profile")
      .then((p) => {
        setProfile(p);
        setProfileLoading(false);
      })
      .catch(() => setProfileLoading(false));
  }, []);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/auth/update-user", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      success("Profile updated");
    } catch (err) {
      showError(
        err instanceof Error ? err.message : "Failed to update profile",
      );
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
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
      showError(
        err instanceof Error ? err.message : "Failed to change password",
      );
    }
  };

  const handleDeleteAccount = async () => {
    if (!deletePassword) {
      showError("Please enter your password");
      return;
    }
    if (!confirm("Are you sure you want to delete your account? This action cannot be undone.")) {
      return;
    }
    setDeleteLoading(true);
    try {
      await apiFetch("/account", {
        method: "DELETE",
        body: JSON.stringify({ password: deletePassword }),
      });
      window.location.href = "/portal/sign-in";
    } catch (err) {
      showError(
        err instanceof Error ? err.message : "Failed to delete account",
      );
      setDeleteLoading(false);
    }
  };

  const handleUpdateClientProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/clients/me/profile", {
        method: "PUT",
        body: JSON.stringify(profile),
      });
      success("Profile updated");
    } catch (err) {
      showError(
        err instanceof Error ? err.message : "Failed to update profile",
      );
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold">Account Settings</h1>

      {/* Profile Section */}
      <div className="max-w-md">
        <h2 className="text-sm font-medium mb-3">Profile</h2>
        <form onSubmit={handleUpdateProfile} className="space-y-3">
          <div>
            <label className="text-sm text-[var(--muted-foreground)]">
              Name
            </label>
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

      {/* Change Password Section */}
      <div className="max-w-md">
        <h2 className="text-sm font-medium mb-3">Change Password</h2>
        <form onSubmit={handleChangePassword} className="space-y-3">
          <div>
            <label className="text-sm text-[var(--muted-foreground)]">
              Current Password
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
              className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
            />
          </div>
          <div>
            <label className="text-sm text-[var(--muted-foreground)]">
              New Password
            </label>
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
            <label className="text-sm text-[var(--muted-foreground)]">
              Confirm New Password
            </label>
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

      {/* Client Profile Section */}
      <div className="max-w-md">
        <h2 className="text-sm font-medium mb-3">Your Profile</h2>
        {profileLoading ? (
          <div>Loading...</div>
        ) : (
          <form onSubmit={handleUpdateClientProfile} className="space-y-3">
            <div>
              <label className="text-sm text-[var(--muted-foreground)]">
                Company
              </label>
              <input
                type="text"
                value={profile.company || ""}
                onChange={(e) => setProfile({ ...profile, company: e.target.value })}
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
              />
            </div>
            <div>
              <label className="text-sm text-[var(--muted-foreground)]">
                Phone
              </label>
              <input
                type="text"
                value={profile.phone || ""}
                onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
              />
            </div>
            <div>
              <label className="text-sm text-[var(--muted-foreground)]">
                Address
              </label>
              <input
                type="text"
                value={profile.address || ""}
                onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
              />
            </div>
            <div>
              <label className="text-sm text-[var(--muted-foreground)]">
                Website
              </label>
              <input
                type="text"
                value={profile.website || ""}
                onChange={(e) => setProfile({ ...profile, website: e.target.value })}
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
              />
            </div>
            <div>
              <label className="text-sm text-[var(--muted-foreground)]">
                Description
              </label>
              <textarea
                value={profile.description || ""}
                onChange={(e) => setProfile({ ...profile, description: e.target.value })}
                rows={3}
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)] resize-none"
              />
            </div>
            <button
              type="submit"
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-medium"
            >
              Save Profile
            </button>
          </form>
        )}
      </div>

      {/* Delete Account Section */}
      <div className="max-w-md border-t border-red-200 dark:border-red-900 pt-8">
        <h2 className="text-sm font-medium text-red-600 dark:text-red-400 mb-1">Delete Account</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-4">
          Permanently delete your account and remove your access to all projects. This cannot be undone.
        </p>
        <div className="space-y-3">
          <div>
            <label className="text-sm text-[var(--muted-foreground)]">
              Confirm your password
            </label>
            <input
              type="password"
              value={deletePassword}
              onChange={(e) => setDeletePassword(e.target.value)}
              placeholder="Your current password"
              className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
            />
          </div>
          <button
            onClick={handleDeleteAccount}
            disabled={!deletePassword || deleteLoading}
            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {deleteLoading ? "Deleting..." : "Delete Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
