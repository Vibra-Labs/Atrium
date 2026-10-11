import { Injectable } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";

export interface EmailPreferences {
  weeklyUpdateReminders: boolean;
  mondayDigest: boolean;
}

const SELECT = { weeklyUpdateReminders: true, mondayDigest: true } as const;

/** Per-member switches for the owner/admin emails (Friday update reminder, Monday digest). */
@Injectable()
export class EmailPreferencesService {
  constructor(private prisma: PrismaService) {}

  get(memberId: string): Promise<EmailPreferences> {
    return this.prisma.member.findUniqueOrThrow({ where: { id: memberId }, select: SELECT });
  }

  update(memberId: string, changes: Partial<EmailPreferences>): Promise<EmailPreferences> {
    return this.prisma.member.update({ where: { id: memberId }, data: changes, select: SELECT });
  }
}
