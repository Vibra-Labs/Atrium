import { ConsentForm } from "./consent-form";

interface ConsentPageProps {
  searchParams: Promise<{ consent_code?: string }>;
}

/**
 * The plugin also puts `client_id` on this URL. It is ignored on purpose: the
 * client the user is being asked about is read out of the consent code's own
 * row, so a link that names a different one changes nothing.
 */
export default async function ConsentPage({ searchParams }: ConsentPageProps): Promise<React.ReactElement> {
  const { consent_code: consentCode } = await searchParams;

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        {!consentCode ? (
          <p className="text-sm text-red-600">
            This link is incomplete. Start the connection again from your AI assistant.
          </p>
        ) : (
          <ConsentForm consentCode={consentCode} />
        )}
      </div>
    </div>
  );
}
