# Deprecations

Things that still work but are scheduled for removal. Before a major release,
go through this list: remove what is due, note it under "Removed" in
CHANGELOG.md, and delete the entry here.

| Deprecated | Use instead | Since | Remove in | Where |
|------------|-------------|-------|-----------|-------|
| `NEXT_PUBLIC_TRACKERS` env var | `ATRIUM_TRACKERS` (same value) | next release after 1.12.1 | 2.0.0 | `apps/web/src/lib/trackers.ts` |

## `NEXT_PUBLIC_TRACKERS`

Next.js replaces `process.env.NEXT_PUBLIC_*` with its build-time value, even in
server code. Images built without the variable ignored the runtime value, which
silently stopped analytics from September to October 2026. Trackers are now
read at runtime from `ATRIUM_TRACKERS`, falling back to `NEXT_PUBLIC_TRACKERS`.
The web server logs a warning at startup when only the old name is set.

To remove it:

- Drop the `|| env.NEXT_PUBLIC_TRACKERS` fallback and
  `trackersDeprecationWarning` in `apps/web/src/lib/trackers.ts`, plus its call
  in `apps/web/src/instrumentation.ts` and their tests.
- Remove the fallback mention in `docs/telemetry.md`.
- Add a "Removed" note to CHANGELOG.md telling operators to rename the variable.
