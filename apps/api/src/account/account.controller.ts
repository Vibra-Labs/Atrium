import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import { IsEmail, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { AccountService } from "./account.service";
import { AuthService } from "../auth/auth.service";
import { CurrentUser } from "../common";
import { UserOnlyAuthGuard } from "./user-only-auth.guard";

/** A password, or for someone without one, their email address. */
class DeleteAccountDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  password?: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}

class SetPasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}

@Controller("account")
@UseGuards(UserOnlyAuthGuard)
export class AccountController {
  constructor(
    private accountService: AccountService,
    private authService: AuthService,
  ) {}

  @Get("deletion-info")
  getDeletionInfo(@CurrentUser("id") userId: string) {
    return this.accountService.getDeletionInfo(userId);
  }

  @Get("password")
  async getPasswordStatus(@CurrentUser("id") userId: string): Promise<{ hasPassword: boolean }> {
    return { hasPassword: await this.accountService.hasPassword(userId) };
  }

  /** First password for someone who joined by link; changing one goes through Better Auth. */
  @Post("password")
  @HttpCode(HttpStatus.NO_CONTENT)
  setPassword(@Req() req: Request, @Body() dto: SetPasswordDto): Promise<void> {
    return this.authService.setPassword(req.headers, dto.newPassword);
  }

  @Delete()
  @HttpCode(HttpStatus.NO_CONTENT)
  deleteAccount(
    @CurrentUser("id") userId: string,
    @Body() dto: DeleteAccountDto,
  ) {
    return this.accountService.deleteAccount(userId, dto.password, dto.email);
  }
}
