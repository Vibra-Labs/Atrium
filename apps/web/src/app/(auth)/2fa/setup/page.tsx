"use client";

import { useRouter } from "next/navigation";
import { TwoFactorSetup } from "@/components/two-factor-setup";

export default function ForcedTwoFactorSetupPage() {
  const router = useRouter();
  return (
    <div className="mx-auto mt-12 max-w-2xl p-6">
      <h1 className="text-2xl font-bold">Two-factor authentication required</h1>
      <p className="mt-2 text-sm text-gray-700">
        Your organization requires 2FA for staff accounts. Please set it up to continue.
      </p>
      <div className="mt-6">
        <TwoFactorSetup onComplete={() => router.push("/dashboard")} />
      </div>
    </div>
  );
}
