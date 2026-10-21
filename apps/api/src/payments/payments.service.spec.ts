import { describe, test, expect, mock } from "bun:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { PaymentsService } from "./payments.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { StripeService } from "../billing/stripe.service";
import type { SettingsService } from "../settings/settings.service";
import type { NotificationsService } from "../notifications/notifications.service";
import type { ContactSyncService } from "../contact-sync/contact-sync.service";

interface InvoiceWhere {
  id: string;
  organizationId: string;
  status?: { notIn?: string[] };
}

// A findFirst that honours the status filter, so the test checks what a client
// would actually get back rather than the shape of the query.
function makeService(status: string): PaymentsService {
  const invoice = { id: "inv-1", organizationId: "org-1", projectId: "p-1", status, lineItems: [] };
  const prisma = {
    invoice: {
      findFirst: mock(({ where }: { where: InvoiceWhere }) =>
        Promise.resolve(where.status?.notIn?.includes(invoice.status) ? null : invoice),
      ),
    },
    systemSettings: {
      findUnique: mock(() =>
        Promise.resolve({ stripeConnectEnabled: true, stripeConnectAccountId: "acct_1", stripePaymentMethods: null }),
      ),
    },
    projectClient: { findFirst: mock(() => Promise.resolve({ id: "pc-1" })) },
  };
  const config = {
    get: (key: string, fallback?: string) => (key === "WEB_URL" ? "http://localhost:3000" : fallback),
    getOrThrow: () => "x".repeat(32),
  };
  return new PaymentsService(
    prisma as unknown as PrismaService,
    { stripe: {} } as unknown as StripeService,
    {} as SettingsService,
    config as unknown as ConfigService,
    {} as NotificationsService,
    {} as ContactSyncService,
  );
}

const returnUrl = "http://localhost:3000/portal/invoices/inv-1";

function checkout(status: string): Promise<unknown> {
  return makeService(status)
    .createCheckoutSession("inv-1", "user-1", "org-1", returnUrl, returnUrl)
    .catch((e: unknown) => e);
}

describe("PaymentsService.createCheckoutSession", () => {
  for (const status of ["draft", "cancelled"]) {
    test(`a ${status} invoice is not found for a client`, async () => {
      expect(await checkout(status)).toBeInstanceOf(NotFoundException);
    });
  }

  test("a paid invoice is still rejected as unpayable", async () => {
    expect(await checkout("paid")).toBeInstanceOf(BadRequestException);
  });
});
