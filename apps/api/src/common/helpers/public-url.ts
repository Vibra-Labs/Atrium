type Env = Record<string, string | undefined>;

const PUBLIC_URL_VARS: string[] = ["WEB_URL", "API_URL", "BETTER_AUTH_URL"];

function isHttpUrl(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * A startup error for the first public URL variable that is set but is not a
 * full http(s) URL, or null when they are all fine. Without it, a value like
 * 192.168.1.10:8080 crashes deep inside a service constructor with a bare
 * "Invalid URL".
 */
export function publicUrlError(env: Env = process.env): string | null {
  for (const key of PUBLIC_URL_VARS) {
    const value: string = (env[key] ?? "").trim();
    if (value && !isHttpUrl(value)) {
      return `${key} is "${value}", which is not a full URL. Include the scheme, e.g. http://192.168.1.10:8080 or https://atrium.example.com.`;
    }
  }
  return null;
}
