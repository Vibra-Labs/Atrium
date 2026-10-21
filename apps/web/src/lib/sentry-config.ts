type Env = Record<string, string | undefined>;

/** Build time: the browser SDK is bundled only when a public DSN is baked in. */
export function shouldBundleSentry(env: Env): boolean {
  return Boolean(env.NEXT_PUBLIC_SENTRY_DSN);
}

/** Runtime on the server: Sentry starts only with a server DSN. */
export function shouldInitServerSentry(env: Env): boolean {
  return Boolean(env.SENTRY_DSN);
}
