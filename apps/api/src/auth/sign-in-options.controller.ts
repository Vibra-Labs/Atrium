import { Controller, Get } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Public } from "../common";
import { passkeysEnabled } from "../common/helpers/passkeys";
import { AuthService } from "./auth.service";

export interface SignInOptions {
  /** False when nothing can send email, so the login page hides "Email me a sign-in link". */
  magicLink: boolean;
  /** False on installs where passkeys can't work (plain HTTP), so the login page hides them. */
  passkey: boolean;
}

@Controller("sign-in-options")
@Public()
export class SignInOptionsController {
  constructor(
    private authService: AuthService,
    private config: ConfigService,
  ) {}

  @Get()
  async get(): Promise<SignInOptions> {
    return { magicLink: await this.authService.signInLinksAvailable(), passkey: passkeysEnabled(this.config) };
  }
}
