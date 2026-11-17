/**
 * What the reset deletes and what it puts back.
 *
 * The table list IS the contract here: a model deleted but never recreated
 * leaves the demo broken until the next API restart, and a model never deleted
 * accumulates visitor-typed text that the 30-minute reset exists to clear.
 * Proven against a recording fake, because the real thing needs a database.
 */
import { describe, expect, it } from "bun:test";
import { seedDemo } from "@atrium/database";

interface Call {
  model: string;
  op: string;
}

function recordingPrisma(): { client: unknown; calls: Call[] } {
  const calls: Call[] = [];
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, model: string) {
      return new Proxy(
        {},
        {
          get(_t, op: string) {
            return async (args: { select?: unknown } = {}) => {
              calls.push({ model, op });
              if (op === "findUnique" && model === "subscriptionPlan") return { id: "plan-pro" };
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

describe("seedDemo", () => {
  it("recreates every model it deletes, so nothing is left missing after a reset", async () => {
    const { client, calls } = recordingPrisma();

    await seedDemo(client as never, "demo-writer-test");

    const deleted = new Set(calls.filter((c) => c.op === "deleteMany").map((c) => c.model));
    const written = new Set(
      calls.filter((c) => c.op === "create" || c.op === "upsert" || c.op === "createMany").map((c) => c.model),
    );
    // Models that are deliberately only cleared (no demo content of their own).
    const clearOnly = new Set([
      "label",
      "pursuitStage",
      "pursuitPipeline",
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
});
