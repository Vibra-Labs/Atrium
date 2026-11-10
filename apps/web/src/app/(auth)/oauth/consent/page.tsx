import { ConsentForm } from "./consent-form";

/**
 * Better Auth signs the whole authorization request onto this page's URL. The
 * form reads it from the address bar and sends it back as-is; the client and
 * destination it shows come from the API's check of that signature, never
 * from the plain query parameters.
 */
export default function ConsentPage(): React.ReactElement {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm space-y-6">
        <ConsentForm />
      </div>
    </div>
  );
}
