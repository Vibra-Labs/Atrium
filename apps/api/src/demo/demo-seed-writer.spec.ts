/**
 * What the reset deletes and what it puts back.
 *
 * The table list IS the contract here: a model deleted but never recreated
 * leaves the demo broken until the next API restart, and a model never deleted
 * accumulates visitor-typed text that the 30-minute reset exists to clear.
 * Proven against a recording fake, because the real thing needs a database.
 */
import { describe, expect, it } from "bun:test";
import { seedDemo } from "./demo-seed";

interface Call {
  model: string;
  op: string;
  args?: Record<string, unknown>;
}

function recordingPrisma(
  options: { ownerEmail?: string; exists?: boolean; slugHeldBy?: string } = {},
): { client: unknown; calls: Call[] } {
  const ownerEmail: string = options.ownerEmail ?? "owner@demo.invalid";
  const exists: boolean = options.exists ?? true;
  /** Another workspace sitting on the demo's slug, if any. */
  const slugHeldBy: string | undefined = options.slugHeldBy;
  const calls: Call[] = [];
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, model: string) {
      return new Proxy(
        {},
        {
          get(_t, op: string) {
            return async (args: Record<string, unknown> = {}) => {
              calls.push({ model, op, args });
              if (op === "findUnique" && model === "subscriptionPlan") return { id: "plan-pro" };
              // The pre-flight safety check. Answers by which key it is asked
              // about, because the whole point is that the row the guard
              // inspects is the row the seed is about to empty.
              if (op === "findUnique" && model === "organization") {
                const where = args.where as { id?: string; slug?: string };
                if (where.id !== undefined) {
                  return exists
                    ? {
                        id: where.id,
                        members: [{ user: { email: ownerEmail } }],
                      }
                    : null;
                }
                return slugHeldBy ? { id: slugHeldBy } : null;
              }
              if (op === "findUnique" || op === "upsert" || op === "create") {
                return { id: `${model}-1`, slug: "demo-writer-test" };
              }
              return { count: 0 };
            };
          },
        },
      );
    },
  };
  const client = new Proxy({}, handler);
  return { client, calls };
}

/** Relation field on a create -> the model those nested rows belong to. */
const NESTED_WRITES: Record<string, string> = { stages: "pursuitStage" };

describe("seedDemo", () => {
  it("recreates every model it deletes, so nothing is left missing after a reset", async () => {
    const { client, calls } = recordingPrisma();

    await seedDemo(client as never, "demo-writer-test");

    const deleted = new Set(calls.filter((c) => c.op === "deleteMany").map((c) => c.model));
    const writes = calls.filter(
      (c) => c.op === "create" || c.op === "upsert" || c.op === "createMany",
    );
    const written = new Set(writes.map((c) => c.model));
    // A nested relation create is a write the recording proxy cannot see: it
    // arrives inside the parent's args, not as a call of its own.
    for (const call of writes) {
      const data = call.args?.data as Record<string, unknown> | undefined;
      for (const [relation, model] of Object.entries(NESTED_WRITES)) {
        const nested = data?.[relation] as { create?: unknown } | undefined;
        if (nested?.create) written.add(model);
      }
    }
    // Models that are deliberately only cleared (no demo content of their own).
    //
    // Nothing goes in this list because the reset happens to leave it empty.
    // It is for models whose empty state is the correct one — a workspace with
    // no labels is a workspace with no labels. A model the app needs a default
    // row of belongs in the recreate path instead, and widening this list to
    // make this test pass is how the pipelines went missing for a release.
    const clearOnly = new Set([
      "label",
      "notification",
      "clientProfile",
      "leadSource",
      // Credentials a visitor added to the demo accounts. Cleared, never seeded.
      "twoFactor",
      "passkey",
    ]);
    const missing = [...deleted].filter((model) => !written.has(model) && !clearOnly.has(model));
    expect(missing).toEqual([]);
  });

  it("recreates the project statuses it deletes", async () => {
    // Without these, assertStatus 400s on every status change and the status
    // chips render nothing until the API restarts and backfills them.
    const { client, calls } = recordingPrisma();

    await seedDemo(client as never, "demo-writer-test");

    expect(calls.some((c) => c.model === "projectStatus" && c.op === "deleteMany")).toBe(true);
    expect(
      calls.some((c) => c.model === "projectStatus" && (c.op === "create" || c.op === "createMany")),
    ).toBe(true);
  });

  it("recreates the default pursuit pipeline and its stages", async () => {
    // A visitor can add and delete pipelines and stages, so they have to be
    // cleared — but only `pipelineFor` self-heals a workspace with none, and
    // the contracts board lists through `findAll`, which does not. Deleted and
    // not recreated, the board is empty until the API restarts.
    const { client, calls } = recordingPrisma();

    await seedDemo(client as never, "demo-writer-test");

    const created = calls.find((c) => c.model === "pursuitPipeline" && c.op === "create");
    expect(created).toBeDefined();
    const data = created?.args?.data as { name?: string; stages?: { create?: unknown[] } };
    expect(data.name).toBe("Sales");
    expect(data.stages?.create).toHaveLength(3);
  });

  it("puts back a logo a visitor set, which a public endpoint would keep serving", async () => {
    // `PUT /branding` takes logoUrl and hideLogo, and `GET /branding/:slug` is
    // @Public. A logo URL left behind by one visitor is served to every later
    // one — and collects their IP and user agent — so the reset has to clear
    // every field the branding DTO accepts, not just the colours.
    const { client, calls } = recordingPrisma();

    await seedDemo(client as never, "demo-writer-test");

    const branding = calls.find((c) => c.model === "branding" && c.op === "upsert");
    const update = branding?.args?.update as Record<string, unknown>;
    expect(update.logoUrl).toBeNull();
    expect(update.logoKey).toBeNull();
    expect(update.hideLogo).toBe(false);
  });

  it("refuses to clear a workspace whose owner is not a demo account", async () => {
    // The assertion used to live only in DemoResetService, so the scheduled
    // reset was guarded and `bun run db:seed:demo` was not — and that script
    // defaults to slug "demo" against whatever DATABASE_URL is set. Anyone
    // whose real workspace is on that slug lost every project, invoice and
    // contact in it. The guard belongs here, where the deletes are.
    const { client, calls } = recordingPrisma({ ownerEmail: "edgar@vibralabs.co" });

    await expect(seedDemo(client as never, "demo-writer-test")).rejects.toThrow(/demo/i);
    expect(calls.some((c) => c.op === "deleteMany")).toBe(false);
  });

  it("seeds a workspace that does not exist yet, so first boot works", async () => {
    const { client, calls } = recordingPrisma({ exists: false });

    await seedDemo(client as never, "demo-writer-test");

    expect(calls.some((c) => c.op === "deleteMany")).toBe(true);
  });

  it("vets the workspace it is about to empty, not whichever row holds the slug", async () => {
    // The seed upserts and clears strictly by the stable id `demo-<slug>-org`.
    // The guard originally looked the workspace up with findFirst on
    // `OR: [{ id }, { slug }]`, and an unordered OR returns whichever row
    // Postgres hands back first — so the row that satisfied the check and the
    // row that got emptied were not necessarily the same row.
    const { client, calls } = recordingPrisma();

    await seedDemo(client as never, "demo-writer-test");

    const byId = calls.find(
      (c) =>
        c.model === "organization" &&
        c.op === "findUnique" &&
        (c.args?.where as { id?: string })?.id !== undefined,
    );
    expect((byId?.args?.where as { id: string }).id).toBe("demo-demo-writer-test-org");
    expect(calls.some((c) => c.model === "organization" && c.op === "findFirst")).toBe(false);
  });

  it("refuses when another workspace already holds the demo's slug", async () => {
    // The upsert would otherwise die on the slug's unique constraint. Failing
    // here says which workspace is in the way instead.
    const { client, calls } = recordingPrisma({ exists: false, slugHeldBy: "org-real" });

    await expect(seedDemo(client as never, "demo-writer-test")).rejects.toThrow(/slug/i);
    expect(calls.some((c) => c.op === "deleteMany")).toBe(false);
  });

  it("clears notifications, which have no cascade and would otherwise grow forever", async () => {
    const { client, calls } = recordingPrisma();

    await seedDemo(client as never, "demo-writer-test");

    expect(calls.some((c) => c.model === "notification" && c.op === "deleteMany")).toBe(true);
  });

  it("never deletes the organization or user rows, so live sessions survive", async () => {
    const { client, calls } = recordingPrisma();

    await seedDemo(client as never, "demo-writer-test");

    expect(calls.some((c) => c.model === "organization" && c.op.startsWith("delete"))).toBe(false);
    expect(calls.some((c) => c.model === "user" && c.op.startsWith("delete"))).toBe(false);
  });

  it("clears the workspace-level 2FA requirement, which survives everything else", async () => {
    // SystemSettings is deliberately not cascaded by the reset, so if the
    // requirement were ever set it would gate every later visitor forever.
    const { client, calls } = recordingPrisma();

    await seedDemo(client as never, "demo-writer-test");

    expect(calls.some((c) => c.model === "systemSettings" && c.op === "upsert")).toBe(true);
  });

  it("clears any second factor the demo users picked up", async () => {
    const { client, calls } = recordingPrisma();

    await seedDemo(client as never, "demo-writer-test");

    expect(calls.some((c) => c.model === "twoFactor" && c.op === "deleteMany")).toBe(true);
    expect(calls.some((c) => c.model === "passkey" && c.op === "deleteMany")).toBe(true);
  });

  it("finds the workspace by its stable id, not only by slug", async () => {
    // A renamed slug would otherwise make the lookup miss and the upsert take
    // the create branch with an id the renamed row still holds -- a unique
    // violation that breaks every reset from then on.
    const { client, calls } = recordingPrisma();

    await seedDemo(client as never, "demo-writer-test");

    const orgOps = calls.filter((c) => c.model === "organization");
    expect(orgOps.length).toBeGreaterThan(0);
  });

  it("resets the per-member preferences that survive on the Member row", async () => {
    // dashboardHidden and the email-digest flags live on Member, which the
    // reset keeps (deleting it would drop the membership). A visitor hiding
    // every dashboard card would otherwise leave it hidden for everyone after.
    const { client, calls } = recordingPrisma();

    await seedDemo(client as never, "demo-writer-test");

    expect(calls.some((c) => c.model === "member" && c.op === "upsert")).toBe(true);
  });

  it("gives the demo workspace a timezone, so nothing tries to sync one", () => {
    // The dashboard syncs the browser's timezone into the workspace whenever
    // it has none. In the demo that write is refused — correctly, since
    // SystemSettings survives a reset and the first visitor's zone would stick
    // for everyone — so the fix is to leave nothing to sync.
    const { client, calls } = recordingPrisma();

    return seedDemo(client as never, "demo-writer-test").then(() => {
      const settings = calls.find((c) => c.model === "systemSettings" && c.op === "upsert");
      const update = settings?.args?.update as Record<string, unknown> | undefined;
      const create = settings?.args?.create as Record<string, unknown> | undefined;
      expect(update?.timezone).toBeTruthy();
      expect(create?.timezone).toBeTruthy();
    });
  });
});
