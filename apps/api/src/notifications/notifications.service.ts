import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { render } from "@react-email/render";
import {
  ProjectUpdateEmail,
  TaskAssignedEmail,
  InvoiceSentEmail,
} from "@atrium/email";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";

@Injectable()
export class NotificationsService {
  private webUrl: string;

  constructor(
    private mail: MailService,
    private prisma: PrismaService,
    private config: ConfigService,
    @InjectPinoLogger(NotificationsService.name)
    private readonly logger: PinoLogger,
  ) {
    this.webUrl = this.config.get("WEB_URL", "http://localhost:3000");
  }

  /**
   * Notify all clients assigned to a project about a new update.
   * Fire-and-forget: errors are logged but never thrown.
   */
  notifyProjectUpdate(projectId: string, updateContent: string): void {
    this.sendProjectUpdateEmails(projectId, updateContent).catch((err) => {
      this.logger.error(
        { err, projectId },
        "Failed to send project update notifications",
      );
    });
  }

  /**
   * Notify all clients assigned to a project about a new task.
   * Fire-and-forget: errors are logged but never thrown.
   */
  notifyTaskCreated(
    projectId: string,
    taskTitle: string,
    dueDate?: Date,
  ): void {
    this.sendTaskCreatedEmails(projectId, taskTitle, dueDate).catch((err) => {
      this.logger.error(
        { err, projectId },
        "Failed to send task created notifications",
      );
    });
  }

  /**
   * Notify all clients assigned to the invoice's project about the invoice.
   * Fire-and-forget: errors are logged but never thrown.
   */
  notifyInvoiceSent(invoiceId: string): void {
    this.sendInvoiceSentEmails(invoiceId).catch((err) => {
      this.logger.error(
        { err, invoiceId },
        "Failed to send invoice sent notifications",
      );
    });
  }

  private async sendProjectUpdateEmails(
    projectId: string,
    updateContent: string,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, organizationId: true },
    });
    if (!project) return;

    const clients = await this.getProjectClients(projectId);
    if (clients.length === 0) return;

    const portalUrl = `${this.webUrl}/portal/projects/${projectId}`;

    await Promise.allSettled(
      clients.map(async (client) => {
        try {
          const html = await render(
            ProjectUpdateEmail({
              clientName: client.name,
              projectName: project.name,
              updateContent,
              portalUrl,
            }),
          );
          await this.mail.send(
            client.email,
            `New update on ${project.name}`,
            html,
            project.organizationId,
          );
        } catch (err) {
          this.logger.warn(
            { err, email: client.email, projectId },
            "Failed to send project update email to client",
          );
        }
      }),
    );
  }

  private async sendTaskCreatedEmails(
    projectId: string,
    taskTitle: string,
    dueDate?: Date,
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true, organizationId: true },
    });
    if (!project) return;

    const clients = await this.getProjectClients(projectId);
    if (clients.length === 0) return;

    const portalUrl = `${this.webUrl}/portal/projects/${projectId}`;
    const formattedDueDate = dueDate
      ? dueDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : undefined;

    await Promise.allSettled(
      clients.map(async (client) => {
        try {
          const html = await render(
            TaskAssignedEmail({
              clientName: client.name,
              projectName: project.name,
              taskTitle,
              dueDate: formattedDueDate,
              portalUrl,
            }),
          );
          await this.mail.send(
            client.email,
            `New task on ${project.name}: ${taskTitle}`,
            html,
            project.organizationId,
          );
        } catch (err) {
          this.logger.warn(
            { err, email: client.email, projectId },
            "Failed to send task created email to client",
          );
        }
      }),
    );
  }

  private async sendInvoiceSentEmails(invoiceId: string): Promise<void> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: { select: { quantity: true, unitPrice: true } },
      },
    });
    if (!invoice || !invoice.projectId) return;

    const clients = await this.getProjectClients(invoice.projectId);
    if (clients.length === 0) return;

    const totalCents = invoice.lineItems.reduce(
      (sum: number, item: { quantity: number; unitPrice: number }) =>
        sum + item.quantity * item.unitPrice,
      0,
    );
    const amount = `$${(totalCents / 100).toFixed(2)}`;
    const dueDate = invoice.dueDate
      ? invoice.dueDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "upon receipt";
    const portalUrl = `${this.webUrl}/portal/invoices`;

    await Promise.allSettled(
      clients.map(async (client) => {
        try {
          const html = await render(
            InvoiceSentEmail({
              clientName: client.name,
              invoiceNumber: invoice.invoiceNumber,
              amount,
              dueDate,
              portalUrl,
            }),
          );
          await this.mail.send(
            client.email,
            `Invoice ${invoice.invoiceNumber} — ${amount}`,
            html,
            invoice.organizationId,
          );
        } catch (err) {
          this.logger.warn(
            { err, email: client.email, invoiceId },
            "Failed to send invoice email to client",
          );
        }
      }),
    );
  }

  /**
   * Fetch all client users assigned to a project with their name + email.
   */
  private async getProjectClients(
    projectId: string,
  ): Promise<Array<{ name: string; email: string }>> {
    const assignments = await this.prisma.projectClient.findMany({
      where: { projectId },
      select: {
        user: { select: { name: true, email: true } },
      },
    });
    return assignments.map(
      (a: { user: { name: string; email: string } }) => a.user,
    );
  }
}
