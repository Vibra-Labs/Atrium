import { describe, expect, it, mock, beforeEach } from "bun:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { CostsService } from "./costs.service";
import type { PrismaService } from "../prisma/prisma.service";

interface Args {
  where?: Record<string, unknown>;
  data?: Record<string, unknown>;
}

interface LineRow {
  id: string;
  label: string;
  amountCents: number;
}

interface PursuitRow {
  projectId: string;
  outcome: string;
  valueCents: number | null;
  costCents: number | null;
  laborRateCents: number | null;
  project: { archivedAt: Date | null };
  costLines: LineRow[];
}

let pursuit: PursuitRow | null;
let lineCount: number;
let line: LineRow | null;

const prisma = {
  projectPursuit: {
    findFirst: mock(() => Promise.resolve(pursuit)),
    update: mock((args: Args) => {
      // Like Prisma, undefined leaves a field as it was.
      const set = Object.fromEntries(Object.entries(args.data ?? {}).filter(([, v]) => v !== undefined));
      pursuit = { ...(pursuit as PursuitRow), ...set };
      return Promise.resolve(pursuit);
    }),
  },
  projectCostLine: {
    count: mock(() => Promise.resolve(lineCount)),
    create: mock((args: Args) => Promise.resolve({ id: "l-new", ...args.data })),
    findFirst: mock(() => Promise.resolve(line)),
    update: mock((args: Args) => Promise.resolve({ ...line, ...args.data })),
    delete: mock(() => Promise.resolve(line)),
  },
  timeEntry: { aggregate: mock(() => Promise.resolve({ _sum: { durationSec: 5400 } })) },
  $queryRaw: mock(() => Promise.resolve([])),
  $transaction: mock((fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
};

const service = new CostsService(prisma as unknown as PrismaService);

beforeEach(() => {
  pursuit = {
    projectId: "p1",
    outcome: "open",
    valueCents: 2500000,
    costCents: null,
    laborRateCents: null,
    project: { archivedAt: null },
    costLines: [],
  };
  lineCount = 0;
  line = { id: "l1", label: "Materials", amountCents: 500000 };
  for (const group of Object.values(prisma)) for (const m of Object.values(group)) m.mockClear();
});

describe("CostsService", () => {
  it("counts only finished time entries on the project", async () => {
    const costs = await service.get("p1", "org1");
    expect(costs.trackedSeconds).toBe(5400);
    const where = (prisma.timeEntry.aggregate.mock.calls[0] as unknown as [Args])[0].where;
    expect(where).toEqual({ projectId: "p1", organizationId: "org1", endedAt: { not: null } });
  });

  it("returns the summary worked out from the stored costs", async () => {
    pursuit!.laborRateCents = 4000;
    pursuit!.costLines = [line!];
    const costs = await service.get("p1", "org1");
    // 1.5h × $40 = $60, plus $5,000 materials.
    expect(costs.summary).toMatchObject({ detailed: true, laborCents: 6000, costCents: 506000 });
    expect(costs.lines).toEqual([{ id: "l1", label: "Materials", amountCents: 500000 }]);
  });

  it("404s when the project has no potential contract", async () => {
    pursuit = null;
    await expect(service.get("p1", "org1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("stays editable after a win", async () => {
    pursuit!.outcome = "won";
    const costs = await service.update("p1", { costCents: 1700000 }, "org1");
    expect(costs.summary.profitCents).toBe(800000);
  });

  it("is read-only on a lost contract", async () => {
    pursuit!.outcome = "lost";
    await expect(service.update("p1", { costCents: 1 }, "org1")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("is read-only on an archived won project", async () => {
    pursuit!.outcome = "won";
    pursuit!.project.archivedAt = new Date();
    await expect(service.addLine("p1", { label: "Paint", amountCents: 1 }, "org1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("the first cost line clears the typed cost, so removing every line can't bring an old one back", async () => {
    pursuit!.costCents = 1000000;
    await service.addLine("p1", { label: "Materials", amountCents: 500000 }, "org1");
    expect(pursuit!.costCents).toBeNull();
  });

  it("later cost lines leave the cost alone", async () => {
    lineCount = 1;
    pursuit!.costCents = 1000000;
    await service.addLine("p1", { label: "Paint", amountCents: 1 }, "org1");
    expect(prisma.projectPursuit.update).not.toHaveBeenCalled();
  });

  it("caps the number of cost lines", async () => {
    lineCount = 50;
    await expect(service.addLine("p1", { label: "One more", amountCents: 1 }, "org1")).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it("404s on a line from another contract", async () => {
    line = null;
    await expect(service.removeLine("p1", "other", "org1")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("setting a labor rate clears the typed cost, so clearing the rate can't bring it back", async () => {
    pursuit!.costCents = 1000000;
    await service.update("p1", { laborRateCents: 15000 }, "org-1");
    expect(pursuit!.costCents).toBeNull();
    expect(pursuit!.laborRateCents).toBe(15000);
  });

  it("adds a line under a lock on the contract", async () => {
    lineCount = 0;
    await service.addLine("p1", { label: "Hosting", amountCents: 5000 }, "org-1");
    expect(prisma.$queryRaw).toHaveBeenCalled();
  });
});
