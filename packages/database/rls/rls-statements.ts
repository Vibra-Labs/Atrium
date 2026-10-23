/**
 * Splits enable-rls.sql into single statements (PgBouncer/pooled connections reject
 * multi-statement queries). Comment lines are removed first, so a statement that
 * follows a comment block isn't dropped along with it.
 */
export function rlsStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line: string) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 0 && s !== "BEGIN" && s !== "COMMIT");
}
