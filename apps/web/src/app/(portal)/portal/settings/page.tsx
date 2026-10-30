"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch } from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { useToast } from "@/components/toast";

/** Stored on the client's contact in the workspace; null when not set. */
interface ClientProfile {
  company?: string | null;
  phone?: string | null;
  address?: string | null;
  website?: string | null;
  description?: string | null;
}

export default function PortalSettingsPage() {
  const router = useRouter();
  const { success, error: showError } = useToast();
  const { userName } = useSession();
  const [name, setName] = useState(userName);

  // Password fields. A client who joined by link has no password: null until we know.
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const linkOnly: boolean = hasPassword === false;
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Profile fields
  const [profile, setProfile] = useState<ClientProfile>({});
  const [profileLoading, setProfileLoading] = useState(true);

  // Delete account
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteLoading, setDeleteLoading] = useState(false);

  useEffect(() => {
    apiFetch<ClientProfile>("/clients/me/profile")
      .then((p) => {
        setProfile(p);
        setProfileLoading(false);
      })
      .catch(() => setProfileLoading(false));
    apiFetch<{ hasPassword: boolean }>("/account/password")
      .then((res) => setHasPassword(res.hasPassword))
      .catch((err: unknown) => {
        console.error("Could not load password status", err);
        setHasPassword(true);
      });
  }, []);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/auth/update-user", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      success("Profile updated");
      router.refresh();
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
      if (!linkOnly) {
        await apiFetch("/auth/change-password", {
          method: "POST",
          body: JSON.stringify({ currentPassword, newPassword }),
        });
        success("Password changed");
      } else {
        await apiFetch("/account/password", {
          method: "POST",
          body: JSON.stringify({ newPassword }),
        });
        success("Password set");
        setHasPassword(true);
      }
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
    if (!deleteConfirmation) {
      showError(linkOnly ? "Please enter your email address" : "Please enter your password");
      return;
    }
    if (!confirm("Are you sure you want to delete your account? This action cannot be undone.")) {
      return;
    }
    setDeleteLoading(true);
    try {
      await apiFetch("/account", {
        method: "DELETE",
        body: JSON.stringify(linkOnly ? { email: deleteConfirmation } : { password: deleteConfirmation }),
      });
      window.location.href = "/login";
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
      // Only the five profile fields: the API rejects anything else.
      const { company, phone, address, website, description } = profile;
      await apiFetch("/clients/me/profile", {
        method: "PUT",
        body: JSON.stringify({
          company: company ?? "",
          phone: phone ?? "",
          address: address ?? "",
          website: website ?? "",
          description: description ?? "",
        }),
      });
      success("Profile updated");
      router.refresh();
    } catch (err) {
      showError(
        err instanceof Error ? err.message : "Failed to update profile",
      );
    }
  };

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
        <h2 className="text-sm font-medium mb-1">{linkOnly ? "Set a Password" : "Change Password"}</h2>
        {linkOnly && (
          <p className="text-sm text-[var(--muted-foreground)] mb-3">
            You sign in with emailed links. Add a password if you&apos;d also like to sign in with one.
          </p>
        )}
        <form onSubmit={handleChangePassword} className="space-y-3 mt-2">
          {!linkOnly && (
            <div>
              <label htmlFor="current-password" className="text-sm text-[var(--muted-foreground)]">
                Current Password
              </label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
              />
            </div>
          )}
          <div>
            <label htmlFor="new-password" className="text-sm text-[var(--muted-foreground)]">
              New Password
            </label>
            <input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={8}
              className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
            />
          </div>
          <div>
            <label htmlFor="confirm-password" className="text-sm text-[var(--muted-foreground)]">
              Confirm New Password
            </label>
            <input
              id="confirm-password"
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
            {linkOnly ? "Set Password" : "Change Password"}
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
              <label htmlFor="profile-company" className="text-sm text-[var(--muted-foreground)]">
                Company
              </label>
              <input
                id="profile-company"
                type="text"
                value={profile.company || ""}
                onChange={(e) => setProfile({ ...profile, company: e.target.value })}
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
              />
            </div>
            <div>
              <label htmlFor="profile-phone" className="text-sm text-[var(--muted-foreground)]">
                Phone
              </label>
              <input
                id="profile-phone"
                type="text"
                value={profile.phone || ""}
                onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
              />
            </div>
            <div>
              <label htmlFor="profile-address" className="text-sm text-[var(--muted-foreground)]">
                Address
              </label>
              <input
                id="profile-address"
                type="text"
                value={profile.address || ""}
                onChange={(e) => setProfile({ ...profile, address: e.target.value })}
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
              />
            </div>
            <div>
              <label htmlFor="profile-website" className="text-sm text-[var(--muted-foreground)]">
                Website
              </label>
              <input
                id="profile-website"
                type="text"
                value={profile.website || ""}
                onChange={(e) => setProfile({ ...profile, website: e.target.value })}
                className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
              />
            </div>
            <div>
              <label htmlFor="profile-description" className="text-sm text-[var(--muted-foreground)]">
                Description
              </label>
              <textarea
                id="profile-description"
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
            <label htmlFor="delete-confirmation" className="text-sm text-[var(--muted-foreground)]">
              {linkOnly ? "Type your email address to confirm" : "Confirm your password"}
            </label>
            <input
              id="delete-confirmation"
              type={linkOnly ? "email" : "password"}
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              placeholder={linkOnly ? "you@example.com" : "Your current password"}
              className="w-full mt-1 px-3 py-2 border border-[var(--border)] rounded-lg bg-[var(--background)]"
            />
          </div>
          <button
            onClick={handleDeleteAccount}
            disabled={!deleteConfirmation || deleteLoading}
            className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            {deleteLoading ? "Deleting..." : "Delete Account"}
          </button>
        </div>
      </div>
    </div>
  );
}
