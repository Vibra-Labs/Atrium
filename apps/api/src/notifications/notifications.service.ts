import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectPinoLogger, PinoLogger } from "nestjs-pino";
import { render } from "@react-email/render";
import {
  ProjectUpdateEmail,
  TaskAssignedEmail,
  InvoiceSentEmail,
  InvoicePaidEmail,
  DecisionClosedEmail,
  DocumentUploadedEmail,
  DocumentRespondedEmail,
  DocumentReminderEmail,
  DocumentSigningTurnEmail,
} from "@atrium/email";
import { MailService } from "../mail/mail.service";
import { PrismaService } from "../prisma/prisma.service";
import { InAppNotificationsService } from "./in-app-notifications.service";
import { PushService } from "./push.service";
import { calculateInvoiceTotal } from "../payments/invoice-total";

@Injectable()
export class NotificationsService {
  private webUrl: string;

  constructor(
    private mail: MailService,
    private prisma: PrismaService,
    private config: ConfigService,
    private inApp: InAppNotificationsService,
    private push: PushService,
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

  /**
   * Notify org owners/admins that an invoice was paid via Stripe.
   * Fire-and-forget: errors are logged but never thrown.
   */
  notifyInvoicePaid(invoiceId: string): void {
    this.sendInvoicePaidEmails(invoiceId).catch((err) => {
      this.logger.error(
        { err, invoiceId },
        "Failed to send invoice paid notifications",
      );
    });
  }

  private async sendInvoicePaidEmails(invoiceId: string): Promise<void> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        lineItems: { select: { quantity: true, unitPrice: true } },
        project: { select: { id: true, name: true } },
      },
    });
    if (!invoice) return;

    const totalCents = calculateInvoiceTotal(invoice);
    const amount = `$${(totalCents / 100).toFixed(2)}`;
    const projectName = invoice.project?.name ?? "Unknown project";

    const admins = await this.getOrgAdmins(invoice.organizationId, true);
    if (admins.length === 0) return;

    const dashboardUrl = invoice.project
      ? `${this.webUrl}/dashboard/projects/${invoice.project.id}`
      : `${this.webUrl}/dashboard`;
    const link = invoice.project
      ? `/dashboard/projects/${invoice.project.id}`
      : `/dashboard`;

    // In-app + push
    this.createInAppAndPush(
      admins.map((a) => a.userId),
      invoice.organizationId,
      "invoice_paid",
      `Invoice ${invoice.invoiceNumber} paid`,
      `${amount} received for ${projectName}`,
      link,
    );

    await Promise.allSettled(
      admins.map(async (admin) => {
        try {
          const html = await render(
            InvoicePaidEmail({
              recipientName: admin.user.name,
              invoiceNumber: invoice.invoiceNumber,
              amount,
              projectName,
              dashboardUrl,
            }),
          );
          await this.mail.send(
            admin.user.email,
            `Invoice ${invoice.invoiceNumber} paid — ${amount}`,
            html,
            invoice.organizationId,
          );
        } catch (err) {
          this.logger.warn(
            { err, email: admin.user.email, invoiceId },
            "Failed to send invoice paid email to admin",
          );
        }
      }),
    );
  }

  /**
   * Notify org owners that their Stripe account was disconnected externally.
   * Fire-and-forget.
   */
  notifyStripeDisconnected(organizationId: string): void {
    this.sendStripeDisconnectedNotifications(organizationId).catch((err) => {
      this.logger.error(
        { err, organizationId },
        "Failed to send Stripe disconnected notifications",
      );
    });
  }

  private async sendStripeDisconnectedNotifications(
    organizationId: string,
  ): Promise<void> {
    const admins = await this.getOrgAdmins(organizationId);
    if (admins.length === 0) return;

    this.createInAppAndPush(
      admins.map((a) => a.userId),
      organizationId,
      "stripe_disconnected",
      "Stripe account disconnected",
      "Your Stripe account was disconnected. Clients can no longer pay invoices online. Reconnect from Settings.",
      "/dashboard/settings/system",
    );
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
    const link = `/portal/projects/${projectId}`;

    // In-app + push (fire-and-forget)
    this.createInAppAndPush(
      clients.map((c) => c.id),
      project.organizationId,
      "project_update",
      `New update on ${project.name}`,
      updateContent.length > 100 ? updateContent.slice(0, 100) + "…" : updateContent,
      link,
    );

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
    const link = `/portal/projects/${projectId}`;
    const formattedDueDate = dueDate
      ? dueDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : undefined;

    // In-app + push
    this.createInAppAndPush(
      clients.map((c) => c.id),
      project.organizationId,
      "task_created",
      `New task on ${project.name}`,
      taskTitle,
      link,
    );

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

  /**
   * Notify all clients assigned to a decision task's project that voting is closed.
   * Fire-and-forget: errors are logged but never thrown.
   */
  notifyDecisionClosed(taskId: string): void {
    this.sendDecisionClosedEmails(taskId).catch((err) => {
      this.logger.error(
        { err, taskId },
        "Failed to send decision closed notifications",
      );
    });
  }

  private async sendDecisionClosedEmails(taskId: string): Promise<void> {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        question: true,
        projectId: true,
        project: { select: { name: true, organizationId: true } },
        options: {
          select: {
            label: true,
            votes: { select: { id: true } },
          },
        },
      },
    });
    if (!task || !task.question) return;

    const clients = await this.getProjectClients(task.projectId);
    if (clients.length === 0) return;

    const optionsWithCounts = task.options.map((opt) => ({
      label: opt.label,
      voteCount: opt.votes.length,
      isWinner: false,
    }));

    const maxVotes = optionsWithCounts.length > 0
      ? Math.max(...optionsWithCounts.map((o) => o.voteCount))
      : 0;
    if (maxVotes > 0) {
      for (const opt of optionsWithCounts) {
        if (opt.voteCount === maxVotes) opt.isWinner = true;
      }
    }

    const portalUrl = `${this.webUrl}/portal/projects/${task.projectId}`;
    const link = `/portal/projects/${task.projectId}`;

    // In-app + push
    this.createInAppAndPush(
      clients.map((c) => c.id),
      task.project.organizationId,
      "decision_closed",
      `Decision closed on ${task.project.name}`,
      task.question,
      link,
    );

    await Promise.allSettled(
      clients.map(async (client) => {
        try {
          const html = await render(
            DecisionClosedEmail({
              clientName: client.name,
              projectName: task.project.name,
              question: task.question!,
              options: optionsWithCounts,
              portalUrl,
            }),
          );
          await this.mail.send(
            client.email,
            `Decision closed on ${task.project.name}: ${task.question}`,
            html,
            task.project.organizationId,
          );
        } catch (err) {
          this.logger.warn(
            { err, email: client.email, taskId },
            "Failed to send decision closed email to client",
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

    const totalCents = calculateInvoiceTotal(invoice);
    const amount = `$${(totalCents / 100).toFixed(2)}`;
    const dueDate = invoice.dueDate
      ? invoice.dueDate.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : "upon receipt";
    const portalUrl = `${this.webUrl}/portal/invoices`;
    const link = `/portal/projects/${invoice.projectId}`;

    // In-app + push
    this.createInAppAndPush(
      clients.map((c) => c.id),
      invoice.organizationId,
      "invoice_sent",
      `Invoice ${invoice.invoiceNumber}`,
      `${amount} due ${dueDate}`,
      link,
    );

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
   * Notify all clients assigned to a document's project that a new document was uploaded.
   * Fire-and-forget: errors are logged but never thrown.
   */
  notifyDocumentUploaded(documentId: string): void {
    this.sendDocumentUploadedEmails(documentId).catch((err) => {
      this.logger.error(
        { err, documentId },
        "Failed to send document uploaded notifications",
      );
    });
  }

  /**
   * Notify org owners/admins that a client responded to a document.
   * Fire-and-forget: errors are logged but never thrown.
   */
  notifyDocumentResponded(
    documentId: string,
    userId: string,
    action: string,
  ): void {
    this.sendDocumentRespondedEmails(documentId, userId, action).catch(
      (err) => {
        this.logger.error(
          { err, documentId, userId, action },
          "Failed to send document responded notifications",
        );
      },
    );
  }

  private async sendDocumentUploadedEmails(
    documentId: string,
  ): Promise<void> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        title: true,
        type: true,
        projectId: true,
        organizationId: true,
      },
    });
    if (!doc) return;

    const project = await this.prisma.project.findUnique({
      where: { id: doc.projectId },
      select: { name: true },
    });
    if (!project) return;

    const clients = await this.getProjectClients(doc.projectId);
    if (clients.length === 0) return;

    const portalUrl = `${this.webUrl}/portal/projects/${doc.projectId}`;
    const link = `/portal/projects/${doc.projectId}`;

    // In-app + push
    this.createInAppAndPush(
      clients.map((c) => c.id),
      doc.organizationId,
      "document_uploaded",
      `New ${doc.type} on ${project.name}`,
      doc.title,
      link,
    );

    await Promise.allSettled(
      clients.map(async (client) => {
        try {
          const html = await render(
            DocumentUploadedEmail({
              clientName: client.name,
              projectName: project.name,
              documentTitle: doc.title,
              documentType: doc.type,
              portalUrl,
            }),
          );
          await this.mail.send(
            client.email,
            `New ${doc.type} on ${project.name}: ${doc.title}`,
            html,
            doc.organizationId,
          );
        } catch (err) {
          this.logger.warn(
            { err, email: client.email, documentId },
            "Failed to send document uploaded email to client",
          );
        }
      }),
    );
  }

  private async sendDocumentRespondedEmails(
    documentId: string,
    userId: string,
    action: string,
  ): Promise<void> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        title: true,
        type: true,
        projectId: true,
        organizationId: true,
      },
    });
    if (!doc) return;

    const [project, respondent] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: doc.projectId },
        select: { name: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true },
      }),
    ]);
    if (!project) return;

    const clientName = respondent?.name || "A client";

    const admins = await this.getOrgAdmins(doc.organizationId, true);
    if (admins.length === 0) return;

    const dashboardUrl = `${this.webUrl}/dashboard/projects/${doc.projectId}`;
    const link = `/dashboard/projects/${doc.projectId}`;

    // In-app + push
    this.createInAppAndPush(
      admins.map((a) => a.userId),
      doc.organizationId,
      "document_responded",
      `${clientName} ${action} ${doc.type}`,
      doc.title,
      link,
    );

    await Promise.allSettled(
      admins.map(async (admin) => {
        try {
          const html = await render(
            DocumentRespondedEmail({
              recipientName: admin.user.name,
              clientName,
              projectName: project.name,
              documentTitle: doc.title,
              documentType: doc.type,
              action,
              dashboardUrl,
            }),
          );
          await this.mail.send(
            admin.user.email,
            `${clientName} ${action} ${doc.type}: ${doc.title}`,
            html,
            doc.organizationId,
          );
        } catch (err) {
          this.logger.warn(
            { err, email: admin.user.email, documentId },
            "Failed to send document responded email to admin",
          );
        }
      }),
    );
  }

  /**
   * Notify all clients assigned to a document's project about a reminder.
   * Fire-and-forget: errors are logged but never thrown.
   */
  notifyDocumentReminder(documentId: string): void {
    this.sendDocumentReminderEmails(documentId).catch((err) => {
      this.logger.error(
        { err, documentId },
        "Failed to send document reminder notifications",
      );
    });
  }

  private async sendDocumentReminderEmails(
    documentId: string,
  ): Promise<void> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        title: true,
        type: true,
        projectId: true,
        organizationId: true,
        expiresAt: true,
        responses: { select: { userId: true, action: true } },
      },
    });
    if (!doc) return;

    const project = await this.prisma.project.findUnique({
      where: { id: doc.projectId },
      select: { name: true },
    });
    if (!project) return;

    // Only remind clients who haven't responded
    const respondedUserIds = new Set(doc.responses.map((r) => r.userId));
    const clients = await this.getProjectClients(doc.projectId);
    const unrespondedClients = clients.filter(
      (c) => !respondedUserIds.has(c.id),
    );
    if (unrespondedClients.length === 0) return;

    const portalUrl = `${this.webUrl}/portal/projects/${doc.projectId}`;
    const link = `/portal/projects/${doc.projectId}`;
    const expiresAt = doc.expiresAt
      ? doc.expiresAt.toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        })
      : undefined;

    // In-app + push
    this.createInAppAndPush(
      unrespondedClients.map((c) => c.id),
      doc.organizationId,
      "document_reminder",
      `Reminder: ${doc.type} awaiting response`,
      doc.title,
      link,
    );

    await Promise.allSettled(
      unrespondedClients.map(async (client) => {
        try {
          const html = await render(
            DocumentReminderEmail({
              clientName: client.name,
              projectName: project.name,
              documentTitle: doc.title,
              documentType: doc.type,
              portalUrl,
              expiresAt,
            }),
          );
          await this.mail.send(
            client.email,
            `Reminder: ${doc.type} awaiting your response — ${doc.title}`,
            html,
            doc.organizationId,
          );
        } catch (err) {
          this.logger.warn(
            { err, email: client.email, documentId },
            "Failed to send document reminder email to client",
          );
        }
      }),
    );
  }

  /**
   * Notify a specific user that it's their turn to sign a document.
   * Fire-and-forget.
   */
  notifyDocumentSigningTurn(documentId: string, userId: string): void {
    this.sendDocumentSigningTurnEmail(documentId, userId).catch((err) => {
      this.logger.error(
        { err, documentId, userId },
        "Failed to send signing turn notification",
      );
    });
  }

  private async sendDocumentSigningTurnEmail(
    documentId: string,
    userId: string,
  ): Promise<void> {
    const doc = await this.prisma.document.findUnique({
      where: { id: documentId },
      select: {
        title: true,
        type: true,
        projectId: true,
        organizationId: true,
      },
    });
    if (!doc) return;

    const [project, user] = await Promise.all([
      this.prisma.project.findUnique({
        where: { id: doc.projectId },
        select: { name: true },
      }),
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true },
      }),
    ]);
    if (!project || !user) return;

    const portalUrl = `${this.webUrl}/portal/projects/${doc.projectId}`;
    const link = `/portal/projects/${doc.projectId}`;

    // In-app + push
    this.createInAppAndPush(
      [userId],
      doc.organizationId,
      "signing_turn",
      `Your turn to sign: ${doc.title}`,
      `${doc.type} on ${project.name}`,
      link,
    );

    try {
      const html = await render(
        DocumentSigningTurnEmail({
          clientName: user.name,
          projectName: project.name,
          documentTitle: doc.title,
          documentType: doc.type,
          portalUrl,
        }),
      );
      await this.mail.send(
        user.email,
        `Your turn to sign: ${doc.title}`,
        html,
        doc.organizationId,
      );
    } catch (err) {
      this.logger.warn(
        { err, email: user.email, documentId },
        "Failed to send signing turn email",
      );
    }
  }

  /**
   * Create in-app notifications and send push notifications for a set of users.
   * Fire-and-forget — errors are swallowed.
   */
  private createInAppAndPush(
    userIds: string[],
    organizationId: string,
    type: string,
    title: string,
    message: string,
    link?: string,
  ): void {
    const notifications = userIds.map((userId) => ({
      userId,
      organizationId,
      type,
      title,
      message,
      link,
    }));

    this.inApp.createMany(notifications).catch((err) => {
      this.logger.warn({ err }, "Failed to create in-app notifications");
    });

    this.push
      .sendToMany(userIds, organizationId, { title, message, link })
      .catch((err) => {
        this.logger.warn({ err }, "Failed to send push notifications");
      });
  }

  /**
   * Send comment notification to relevant users.
   * Called from CommentsService.
   */
  async notifyComment(
    projectId: string,
    organizationId: string,
    authorId: string,
    authorRole: string,
    content: string,
    targetType: "update" | "task",
  ): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { name: true },
    });
    if (!project) return;

    const truncatedContent =
      content.length > 100 ? content.slice(0, 100) + "…" : content;

    const isClientComment = authorRole === "member";

    if (isClientComment) {
      const admins = await this.getOrgAdmins(organizationId);
      const adminIds = admins.map((a) => a.userId);
      if (adminIds.length === 0) return;

      this.createInAppAndPush(
        adminIds,
        organizationId,
        "comment",
        `New comment on ${project.name}`,
        truncatedContent,
        `/dashboard/projects/${projectId}`,
      );
    } else {
      // Notify project clients
      const clients = await this.getProjectClients(projectId);
      const clientIds = clients
        .filter((c) => c.id !== authorId)
        .map((c) => c.id);
      if (clientIds.length === 0) return;

      this.createInAppAndPush(
        clientIds,
        organizationId,
        "comment",
        `New comment on ${project.name}`,
        truncatedContent,
        `/portal/projects/${projectId}`,
      );
    }
  }

  private async getOrgAdmins(
    organizationId: string,
    includeDetails?: false,
  ): Promise<Array<{ userId: string }>>;
  private async getOrgAdmins(
    organizationId: string,
    includeDetails: true,
  ): Promise<Array<{ userId: string; user: { name: string; email: string } }>>;
  private async getOrgAdmins(organizationId: string, includeDetails = false) {
    return this.prisma.member.findMany({
      where: {
        organizationId,
        role: { in: ["owner", "admin"] },
      },
      select: {
        userId: true,
        ...(includeDetails && { user: { select: { name: true, email: true } } }),
      },
    });
  }

  private async getProjectClients(
    projectId: string,
  ): Promise<Array<{ id: string; name: string; email: string }>> {
    const assignments = await this.prisma.projectClient.findMany({
      where: { projectId },
      select: {
        user: { select: { id: true, name: true, email: true } },
      },
    });
    return assignments.map(
      (a: { user: { id: string; name: string; email: string } }) => a.user,
    );
  }
}
