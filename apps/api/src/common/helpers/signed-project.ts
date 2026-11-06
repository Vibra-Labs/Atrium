/**
 * Prisma `where` for projects that clients may see: plain projects and won potential contracts.
 * Open or lost potential contracts are staff-only, whatever ProjectClient rows exist.
 */
export const SIGNED_PROJECT = {
  OR: [{ pursuit: { is: null } }, { pursuit: { is: { outcome: "won" } } }],
};
