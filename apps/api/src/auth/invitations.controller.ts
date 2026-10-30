import { Controller, Get, HttpCode, NotFoundException, Param, Post } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { Public } from "../common";
import { AuthService, type InvitationSummary, type InviteSignInResult } from "./auth.service";

/**
 * The accept-invite page's calls, made before the invitee has a session. The
 * invitation id is the secret here, as it already is in the invite email's link.
 */
@Controller("invitations")
@Public()
export class InvitationsController {
  constructor(private authService: AuthService) {}

  @Get(":id")
  async describe(@Param("id") id: string): Promise<InvitationSummary> {
    const summary: InvitationSummary | null = await this.authService.describeInvitation(id);
    if (!summary) throw new NotFoundException("This invitation has expired or was already used");
    return summary;
  }

  // Can email a sign-in link, so held well below the global limit.
  @Post(":id/sign-in")
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  signIn(@Param("id") id: string): Promise<InviteSignInResult> {
    return this.authService.startInviteSignIn(id);
  }
}
