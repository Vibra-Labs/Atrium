import { Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import PDFDocument from "pdfkit";
import { PassThrough } from "stream";

@Injectable()
export class InvoicePdfService {
  constructor(private prisma: PrismaService) {}

  async generate(invoiceId: string, orgId: string): Promise<{ stream: PassThrough; filename: string }> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, organizationId: orgId },
      include: {
        lineItems: true,
        project: { select: { name: true } },
      },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true },
    });

    const branding = await this.prisma.branding.findUnique({
      where: { organizationId: orgId },
      select: { primaryColor: true },
    });

    const primaryColor = branding?.primaryColor || "#2563eb";
    const orgName = org?.name || "Organization";

    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const stream = new PassThrough();
    doc.pipe(stream);

    // Header
    doc.fontSize(24).fillColor(primaryColor).text(orgName, 50, 50);
    doc.fontSize(10).fillColor("#6b7280").text("INVOICE", 400, 50, { align: "right" });
    doc.fontSize(18).fillColor("#111827").text(invoice.invoiceNumber, 400, 65, { align: "right" });

    // Meta info
    const metaY = 110;
    doc.fontSize(9).fillColor("#6b7280");
    doc.text("Date", 50, metaY);
    doc.text("Status", 150, metaY);
    if (invoice.dueDate) doc.text("Due Date", 250, metaY);
    if (invoice.project) doc.text("Project", 370, metaY);

    doc.fontSize(10).fillColor("#111827");
    doc.text(new Date(invoice.createdAt).toLocaleDateString(), 50, metaY + 14);
    doc.text(invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1), 150, metaY + 14);
    if (invoice.dueDate) {
      doc.text(new Date(invoice.dueDate).toLocaleDateString(), 250, metaY + 14);
    }
    if (invoice.project) {
      doc.text(invoice.project.name, 370, metaY + 14);
    }

    // Divider
    const tableStart = metaY + 50;
    doc.moveTo(50, tableStart).lineTo(545, tableStart).strokeColor("#e5e7eb").lineWidth(1).stroke();

    // Table header
    const headerY = tableStart + 10;
    doc.fontSize(9).fillColor("#6b7280");
    doc.text("Description", 50, headerY);
    doc.text("Qty", 340, headerY, { width: 50, align: "right" });
    doc.text("Unit Price", 400, headerY, { width: 70, align: "right" });
    doc.text("Total", 475, headerY, { width: 70, align: "right" });

    doc.moveTo(50, headerY + 16).lineTo(545, headerY + 16).strokeColor("#e5e7eb").lineWidth(0.5).stroke();

    // Line items
    let y = headerY + 26;
    let grandTotal = 0;
    const pageBottom = doc.page.height - doc.page.margins.bottom;

    for (const item of invoice.lineItems) {
      if (y + 20 > pageBottom) {
        doc.addPage();
        y = doc.page.margins.top;
      }

      const lineTotal = item.quantity * item.unitPrice;
      grandTotal += lineTotal;

      doc.fontSize(10).fillColor("#111827");
      doc.text(item.description, 50, y, { width: 280 });
      doc.text(String(item.quantity), 340, y, { width: 50, align: "right" });
      doc.text(formatCents(item.unitPrice), 400, y, { width: 70, align: "right" });
      doc.text(formatCents(lineTotal), 475, y, { width: 70, align: "right" });

      y += 20;
    }

    // Total line
    doc.moveTo(350, y + 5).lineTo(545, y + 5).strokeColor("#e5e7eb").lineWidth(1).stroke();
    y += 15;
    doc.fontSize(11).fillColor("#111827").font("Helvetica-Bold");
    doc.text("Total", 350, y, { width: 120, align: "right" });
    doc.text(formatCents(grandTotal), 475, y, { width: 70, align: "right" });
    doc.font("Helvetica");

    // Notes
    if (invoice.notes) {
      y += 40;
      doc.fontSize(9).fillColor("#6b7280").text("Notes", 50, y);
      y += 14;
      doc.fontSize(10).fillColor("#374151").text(invoice.notes, 50, y, { width: 495 });
    }

    doc.end();

    const filename = `${invoice.invoiceNumber}.pdf`;
    return { stream, filename };
  }
}

function formatCents(cents: number): string {
  return "$" + (cents / 100).toFixed(2);
}
