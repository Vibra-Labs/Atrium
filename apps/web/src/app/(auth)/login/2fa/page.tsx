import { TwoFactorForm } from "./two-factor-form";

export default function TwoFactorChallengePage() {
  return (
    <div className="mx-auto mt-16 max-w-md p-6">
      <h1 className="text-2xl font-bold">Two-factor authentication</h1>
      <p className="mt-1 text-sm text-gray-600">
        Enter the 6-digit code from your authenticator app.
      </p>
      <div className="mt-6">
        <TwoFactorForm />
      </div>
    </div>
  );
}
