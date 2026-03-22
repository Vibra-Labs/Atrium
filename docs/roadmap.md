# Roadmap

A living document tracking what's been shipped and what's planned for Atrium.

## Shipped

- [x] Project management with customizable status pipeline
- [x] File sharing (S3, MinIO, Cloudflare R2, local storage)
- [x] White-label branding (colors, logo)
- [x] Role-based access (owner, admin, client)
- [x] Email/password and magic link authentication
- [x] Multi-tenant organizations
- [x] Billing & subscriptions (Stripe)
- [x] Setup wizard for new organizations
- [x] Email notifications (Resend + SMTP)
- [x] Invoicing with PDF generation
- [x] Task management with drag-and-drop ordering
- [x] Project updates with image attachments
- [x] Internal notes (admin-only)
- [x] Client profiles (company, phone, address, website)
- [x] Docker Hub image (`vibralabs/atrium`)
- [x] Unraid Community App template
- [x] Account deletion with data cleanup
- [x] Comments & discussions on updates and tasks
- [x] In-app notifications with real-time polling
- [x] Push notifications (Web Push / VAPID)
- [x] Team members (invite admins/owners to organization)
- [x] Tags & labels (cross-entity tagging for projects, clients, tasks, files)
- [x] CSV data export (projects, invoices, people, tasks)
- [x] Dynamic favicon (updates to org logo)

## Planned

### v1.3 -- Communication & Payments (March 2026)

Make the portal the primary channel between agency and client.

- [x] **Comments & discussions** -- Two-way communication on updates, tasks, and files
- [x] **In-app notifications** -- Real-time alerts for new updates, files, and invoices
- [ ] **In-portal messaging** -- Dedicated project-scoped chat with email fallback
- [x] **Team members** -- Invite additional staff to your organization beyond owner/admin
- [x] **Tags & labels** -- Cross-entity tagging for projects, clients, tasks, and files
- [ ] **Client-facing invoice payments** -- Pay invoices directly from the portal (Stripe)
- [ ] **Recurring invoices** -- Auto-generate invoices on a schedule for retainer clients

### v1.4 -- Contracts, Approvals & Scheduling (April 2026)

Turn the portal into the system of record for client work.

- [ ] **Contracts & proposals** -- Generate, send, and manage agreements
- [ ] **E-signatures** -- Sign off on contracts and deliverables
- [ ] **Client approval workflows** -- Clients can approve/reject deliverables and milestones
- [ ] **Calendar view** -- Visualize project timelines, tasks, and deadlines
- [ ] **Time tracking** -- Log hours against projects and tasks
- [x] **Data export** -- CSV/PDF export for projects, invoices, and client data
- [ ] **Global search** -- Full-text search across projects, files, tasks, clients, and messages

### v1.5 -- Security & Intelligence (May 2026)

Enterprise auth, automation, and analytics.

- [ ] **SAML/SSO** -- Enterprise single sign-on for teams and clients
- [ ] **2FA/MFA** -- TOTP and passkey support via Better Auth plugins
- [ ] **Granular permissions** -- Per-project and per-section access control beyond owner/admin/member roles
- [ ] **Activity / audit log** -- Track who did what and when across the organization
- [ ] **Workflow automations** -- Trigger-action engine for automated task assignment, notifications, and status changes
- [ ] **Reporting & analytics** -- Revenue trends, project metrics, client activity, and invoice aging dashboards
- [ ] **Webhooks / Zapier integration** -- Notify external systems of portal events
- [ ] **Knowledge base / help center** -- Self-service docs, FAQs, and guides for clients

### v2.0 -- Platform & Extensibility (June 2026)

Transform from portal to platform.

- [ ] **Custom domains** -- Serve the client portal on your own domain (reverse proxy supported today)
- [ ] **Content embedding** -- Embed Figma, Google Docs, Loom, and other external content in project pages
- [ ] **Dashboard customization** -- Drag-and-drop widgets to personalize admin and client dashboards
- [ ] **Embeddable widgets** -- JavaScript snippets for forms, status badges, and file uploads on external sites
- [ ] **PWA / mobile app** -- Installable progressive web app for on-the-go access
- [ ] **Multi-language / i18n** -- Localized portal UI with per-client language preferences
- [ ] **AI assistant** -- Contextual AI for drafting emails, summarizing projects, and answering client questions (self-hosted LLM compatible)

---

Have a feature request? [Open an issue](https://github.com/Vibra-Labs/Atrium/issues) or start a [discussion](https://github.com/Vibra-Labs/Atrium/discussions).
