/**
 * The demo workspace's contents, as plain data.
 *
 * Kept pure and separate from the writer so the properties that decide whether
 * the demo works — the pro plan, only @demo.invalid addresses, a project the
 * portal client can see, one paid and one outstanding invoice — are provable
 * without a database.
 */

export const DEMO_EMAIL_DOMAIN = "@demo.invalid";

export interface DemoUser {
  key: string;
  name: string;
  email: string;
  role: "owner" | "member";
}

export interface DemoProject {
  key: string;
  name: string;
  description: string;
  status: string;
  clientKeys: string[];
  startOffsetDays: number;
  endOffsetDays: number;
}

export interface DemoUpdate {
  projectKey: string;
  authorKey: string;
  content: string;
  createdOffsetDays: number;
}

export interface DemoTask {
  projectKey: string;
  title: string;
  status: string;
  order: number;
  assigneeKey: string | null;
  dueOffsetDays: number | null;
  requestedByKey: string | null;
}

export interface DemoInvoiceItem {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface DemoInvoice {
  projectKey: string;
  invoiceNumber: string;
  status: string;
  dueOffsetDays: number;
  items: DemoInvoiceItem[];
}

export interface DemoDocument {
  projectKey: string;
  type: string;
  title: string;
  status: string;
  requiresSignature: boolean;
  filename: string;
}

export interface DemoContact {
  name: string;
  email: string | null;
  status: string;
  jobTitle: string | null;
  company: string | null;
}

export interface DemoTimeEntry {
  projectKey: string;
  userKey: string;
  description: string;
  startedOffsetDays: number;
  durationSec: number;
}

export interface DemoSeedPlan {
  organization: { name: string; slug: string };
  planSlug: string;
  users: DemoUser[];
  projects: DemoProject[];
  updates: DemoUpdate[];
  tasks: DemoTask[];
  invoices: DemoInvoice[];
  documents: DemoDocument[];
  contacts: DemoContact[];
  timeEntries: DemoTimeEntry[];
  companies: string[];
}

function assertDemoAddress(email: string): string {
  if (!email.toLowerCase().endsWith(DEMO_EMAIL_DOMAIN)) {
    throw new Error(
      `Refusing to seed the demo with "${email}": demo accounts must be on ${DEMO_EMAIL_DOMAIN}, ` +
        `so a mistyped address can never point at a real person's account.`,
    );
  }
  return email.toLowerCase();
}

/** The demo workspace, as data. Deterministic: a reset restores exactly this. */
export function demoSeedPlan(slug: string, ownerEmail: string, clientEmail: string): DemoSeedPlan {
  const owner: DemoUser = {
    key: "owner",
    name: "Dana Whitfield",
    email: assertDemoAddress(ownerEmail),
    role: "owner",
  };
  const client: DemoUser = {
    key: "client",
    name: "Priya Raman",
    email: assertDemoAddress(clientEmail),
    role: "member",
  };
  const designer: DemoUser = {
    key: "designer",
    name: "Marcus Hale",
    email: `marcus${DEMO_EMAIL_DOMAIN}`,
    role: "owner",
  };

  return {
    organization: { name: "Northwind Studio", slug },
    planSlug: "pro",
    users: [owner, client, designer],
    companies: ["Lumen Coffee", "Harbour Books"],
    projects: [
      {
        key: "rebrand",
        name: "Lumen Coffee — Brand refresh",
        description: "New identity, packaging and a one-page site for the spring launch.",
        status: "in_progress",
        clientKeys: ["client"],
        startOffsetDays: -32,
        endOffsetDays: 21,
      },
      {
        key: "site",
        name: "Harbour Books — Online store",
        description: "Shopify build, migration of 1,400 titles, and staff training.",
        status: "in_progress",
        clientKeys: ["client"],
        startOffsetDays: -12,
        endOffsetDays: 46,
      },
      {
        key: "report",
        name: "Northwind — Annual report design",
        description: "Editorial layout and print production for the 2026 annual report.",
        status: "completed",
        clientKeys: [],
        startOffsetDays: -96,
        endOffsetDays: -14,
      },
    ],
    updates: [
      {
        projectKey: "rebrand",
        authorKey: "owner",
        content:
          "Packaging proofs are back from the printer and the colour is spot on. Next up: the bag labels, then we hand over the full asset pack.",
        createdOffsetDays: -3,
      },
      {
        projectKey: "rebrand",
        authorKey: "designer",
        content:
          "Logo lockups are final — horizontal, stacked and the icon on its own. Here's a quick walkthrough: https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        createdOffsetDays: -9,
      },
      {
        projectKey: "site",
        authorKey: "owner",
        content:
          "Catalogue import finished — 1,412 titles are in with covers. Staff training is booked for the 28th.",
        createdOffsetDays: -2,
      },
    ],
    tasks: [
      {
        projectKey: "rebrand",
        title: "Final packaging proof to the printer",
        status: "done",
        order: 0,
        assigneeKey: "designer",
        dueOffsetDays: -4,
        requestedByKey: null,
      },
      {
        projectKey: "rebrand",
        title: "Bag label artwork",
        status: "in_progress",
        order: 1,
        assigneeKey: "designer",
        dueOffsetDays: 5,
        requestedByKey: null,
      },
      {
        projectKey: "rebrand",
        title: "Can we also get the logo as an SVG for our signage people?",
        status: "open",
        order: 2,
        assigneeKey: null,
        dueOffsetDays: 9,
        requestedByKey: "client",
      },
      {
        projectKey: "site",
        title: "Migrate remaining 1,400 titles",
        status: "done",
        order: 0,
        assigneeKey: "owner",
        dueOffsetDays: -1,
        requestedByKey: null,
      },
      {
        projectKey: "site",
        title: "Staff training session",
        status: "open",
        order: 1,
        assigneeKey: "owner",
        dueOffsetDays: 12,
        requestedByKey: null,
      },
    ],
    invoices: [
      {
        projectKey: "rebrand",
        invoiceNumber: "INV-0041",
        status: "paid",
        dueOffsetDays: -18,
        items: [
          { description: "Brand strategy workshop", quantity: 1, unitPrice: 180000 },
          { description: "Identity design", quantity: 1, unitPrice: 320000 },
        ],
      },
      {
        projectKey: "site",
        invoiceNumber: "INV-0042",
        status: "sent",
        dueOffsetDays: 9,
        items: [
          { description: "Storefront build", quantity: 1, unitPrice: 450000 },
          { description: "Catalogue migration", quantity: 14, unitPrice: 12000 },
        ],
      },
    ],
    documents: [
      {
        projectKey: "rebrand",
        type: "contract",
        title: "Brand refresh — statement of work",
        status: "signed",
        requiresSignature: true,
        filename: "lumen-sow.pdf",
      },
      {
        projectKey: "site",
        type: "quote",
        title: "Online store — phase 2 quote",
        status: "pending",
        requiresSignature: true,
        filename: "harbour-phase-2.pdf",
      },
    ],
    contacts: [
      {
        name: "Priya Raman",
        email: `client${DEMO_EMAIL_DOMAIN}`,
        status: "client",
        jobTitle: "Operations lead",
        company: "Lumen Coffee",
      },
      {
        name: "Tom Feldt",
        email: `tom${DEMO_EMAIL_DOMAIN}`,
        status: "client",
        jobTitle: "Owner",
        company: "Harbour Books",
      },
      {
        name: "Alina Costa",
        email: `alina${DEMO_EMAIL_DOMAIN}`,
        status: "lead",
        jobTitle: "Marketing manager",
        company: null,
      },
    ],
    timeEntries: [
      {
        projectKey: "rebrand",
        userKey: "designer",
        description: "Packaging proof revisions",
        startedOffsetDays: -4,
        durationSec: 7200,
      },
      {
        projectKey: "rebrand",
        userKey: "owner",
        description: "Printer call and colour check",
        startedOffsetDays: -3,
        durationSec: 2700,
      },
      {
        projectKey: "site",
        userKey: "owner",
        description: "Catalogue import and spot checks",
        startedOffsetDays: -2,
        durationSec: 10800,
      },
    ],
  };
}
