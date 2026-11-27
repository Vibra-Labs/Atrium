/**
 * A Prisma delegate call as a spec reads it back off a mock.
 *
 * Spec mocks declare their parameter as `unknown` -- the real args object is
 * far wider than any one test cares about, and a zero-parameter mock cannot
 * record its calls at all -- so assertions cast the captured value to this
 * before reaching into it.
 *
 * The fields are required rather than optional: a spec asserting on
 * `call.where.userId` has already established that the call carried a `where`,
 * and if it did not, the assertion should fail on the value, not fail to
 * compile.
 */
export interface PrismaCall {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
  create: Record<string, unknown>;
  update: Record<string, unknown>;
  select: Record<string, unknown>;
  include: Record<string, unknown>;
  orderBy: unknown;
  take: number;
  skip: number;
}

/** A `deleteMany` pruning on an expiry, as its spec reads the cutoff back. */
export interface ExpiresAtWhere {
  where: { expiresAt: { lt: Date } };
}

/** A `deleteMany` pruning on age, with the extra conditions its spec asserts. */
export interface CreatedAtWhere {
  where: { createdAt: { lt: Date }; OR?: unknown };
}

/** The `where` that prunes unused OAuth clients, as its spec reads it back. */
export interface ClientPruneWhere {
  where: {
    accessTokens: unknown;
    refreshTokens: unknown;
    consents: unknown;
    clientId: unknown;
    OR: [{ createdAt: { lt: Date } }, { createdAt: null }];
  };
}
