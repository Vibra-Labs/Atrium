import { describe, expect, it } from "bun:test";
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { AuthGuard } from "./auth.guard";
import { UserOnlyAuthGuard } from "../../account/user-only-auth.guard";
import { IS_PUBLIC_KEY } from "../decorators/public.decorator";

/**
 * AuthGuard is not global (see app.module.ts), so a route is reachable
 * anonymously unless its controller or handler declares `@UseGuards(AuthGuard)`.
 * `@Public()` is the deliberate opt-out -- webhooks that verify their own
 * signature, the health probe, the signup endpoint.
 *
 * Nothing enforced that, so a new controller could be exposed by omission
 * rather than by choice. This walks every route the app registers and insists
 * each one says which it is. It reads Nest's own metadata rather than the
 * source text, so it cannot be fooled by formatting or by a re-exported
 * decorator.
 */

/**
 * Guards that establish who the caller is: both reject a request with no
 * `req.user`. Others (roles, plan, CSRF, second factor, preview mode) refine an
 * already-identified caller and do not authenticate on their own, so they do
 * not belong here. A new authenticating guard will trip this check, which is
 * the point -- add it here deliberately.
 */
const AUTHENTICATING_GUARDS: unknown[] = [AuthGuard, UserOnlyAuthGuard];

const SRC = join(__dirname, "..", "..");

// The API compiles to CommonJS, so load the controllers the way it does. An
// ESM import would reject the handful of modules that name a type in a value
// import clause -- harmless once tsc erases it, fatal to an ESM loader.
const requireController = createRequire(__filename);

function controllerFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") found.push(...controllerFiles(full));
    } else if (entry.name.endsWith(".controller.ts") && !entry.name.endsWith(".spec.ts")) {
      found.push(full);
    }
  }
  return found;
}

type Ctor = new (...args: never[]) => object;

function isController(value: unknown): value is Ctor {
  return typeof value === "function" && Reflect.hasMetadata(PATH_METADATA, value);
}

/** Guards declared on the class or the handler, whether or not AuthGuard is among them. */
function guardsOf(target: object): unknown[] {
  const declared: unknown = Reflect.getMetadata(GUARDS_METADATA, target);
  return Array.isArray(declared) ? declared : [];
}

function isPublic(target: object): boolean {
  return Reflect.getMetadata(IS_PUBLIC_KEY, target) === true;
}

describe("every registered route declares whether it is authenticated", () => {
  it("has controllers to check", () => {
    expect(controllerFiles(SRC).length).toBeGreaterThan(20);
  });

  it("leaves no route authenticated-or-not by omission", () => {
    const uncovered: string[] = [];

    for (const file of controllerFiles(SRC)) {
      const mod: Record<string, unknown> = requireController(file) as Record<string, unknown>;

      for (const exported of Object.values(mod)) {
        if (!isController(exported)) continue;

        const classGuards = guardsOf(exported);
        const classIsPublic = isPublic(exported);
        const proto: object = exported.prototype;

        for (const name of Object.getOwnPropertyNames(proto)) {
          if (name === "constructor") continue;
          const handler: unknown = Reflect.get(proto, name);
          if (typeof handler !== "function") continue;
          // Only route handlers carry an HTTP method.
          if (!Reflect.hasMetadata(METHOD_METADATA, handler)) continue;

          const declared = [...classGuards, ...guardsOf(handler)];
          const guarded = declared.some((g) => AUTHENTICATING_GUARDS.includes(g));
          if (guarded || classIsPublic || isPublic(handler)) continue;

          uncovered.push(`${exported.name}.${name}  (${relative(SRC, file)})`);
        }
      }
    }

    expect(uncovered).toEqual([]);
  });
});
