import { Controller, Get } from "@nestjs/common";
import { Public } from "../common";
import { AuthService } from "./auth.service";

export interface SignInOptions {
  /** False when nothing can send email, so the login page hides "Email me a sign-in link". */
  magicLink: boolean;
}

@Controller("sign-in-options")
@Public()
export class SignInOptionsController {
  constructor(private authService: AuthService) {}

  @Get()
  async get(): Promise<SignInOptions> {
    return { magicLink: await this.authService.signInLinksAvailable() };
  }
}
