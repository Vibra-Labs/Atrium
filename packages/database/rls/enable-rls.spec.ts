import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { rlsStatements } from "./rls-statements";

const schema: string = readFileSync(resolve(__dirname, "../prisma/schema.prisma"), "utf-8");
const sql: string = readFileSync(resolve(__dirname, "enable-rls.sql"), "utf-8");

// Tables only: enums also use @@map but aren't tables.
const tables: string[] = [...schema.matchAll(/^model \w+ \{[\s\S]*?^\}/gm)].map((m: RegExpMatchArray) => {
  const name: RegExpMatchArray | null = m[0].match(/@@map\("([a-z_]+)"\)/);
  if (!name) throw new Error(`Model without @@map: ${m[0].split("\n")[0]}`);
  return name[1];
});

// A table left out is readable and writable through Supabase's Data API with the anon key.
describe("enable-rls.sql", () => {
  it("finds the schema's tables", () => {
    expect(tables.length).toBe((schema.match(/^model /gm) ?? []).length);
  });

  it.each(tables)("enables RLS on %s", (table: string) => {
    expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`);
  });

  it.each(tables)("revokes anon/authenticated access to %s", (table: string) => {
    expect(sql).toContain(`REVOKE ALL ON "${table}" FROM anon, authenticated;`);
  });
});

describe("rlsStatements", () => {
  it("keeps a statement that follows a comment block", () => {
    const statements: string[] = rlsStatements(sql);
    expect(statements).toContain('ALTER TABLE "user" ENABLE ROW LEVEL SECURITY');
    expect(statements).toContain('REVOKE ALL ON "user" FROM anon, authenticated');
  });

  it("applies every statement in the file, without BEGIN/COMMIT or comments", () => {
    const statements: string[] = rlsStatements(sql);
    expect(statements.length).toBe(tables.length * 2);
    expect(statements.some((s: string) => s.includes("--") || s === "BEGIN" || s === "COMMIT")).toBe(false);
  });
});
