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
    const clearOnly = new Set(["label", "pursuitStage", "pursuitPipeline", "notification", "clientProfile", "leadSource"]);
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
});
