import { ConsentForm } from "./consent-form";

interface ConsentPageProps {
  searchParams: Promise<{ client_id?: string; consent_code?: string }>;
}

export default async function ConsentPage({ searchParams }: ConsentPageProps): Promise<React.ReactElement> {
  const { client_id: clientId, consent_code: consentCode } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {!clientId || !consentCode ? (
          <p className="text-sm text-red-600">
            This link is incomplete. Start the connection again from your AI assistant.
          </p>
        ) : (
          <ConsentForm clientId={clientId} consentCode={consentCode} />
        )}
      </div>
    </div>
  );
}
