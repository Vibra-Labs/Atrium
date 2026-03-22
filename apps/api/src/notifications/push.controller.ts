import {
  Controller,
  Get,
  Post,
  Body,
  Req,
} from "@nestjs/common";
import { IsString, IsNotEmpty, IsDefined, ValidateNested, IsUrl } from "class-validator";
import { Type } from "class-transformer";
import { PushService } from "./push.service";

class PushKeys {
  @IsString()
  @IsNotEmpty()
  p256dh!: string;

  @IsString()
  @IsNotEmpty()
  auth!: string;
}

class SubscribeDto {
  @IsUrl({ require_tld: false })
  endpoint!: string;

  @IsDefined()
  @ValidateNested()
  @Type(() => PushKeys)
  keys!: PushKeys;
}

class UnsubscribeDto {
  @IsUrl({ require_tld: false })
  endpoint!: string;
}

@Controller("push")
export class PushController {
  constructor(private readonly pushService: PushService) {}

  @Get("vapid-key")
  async getVapidKey(@Req() req: any) {
    const publicKey = await this.pushService.getPublicKey(req.organization.id);
    return { publicKey };
  }

  @Post("subscribe")
  async subscribe(@Body() dto: SubscribeDto, @Req() req: any) {
    await this.pushService.subscribe(req.user.id, req.organization.id, dto);
    return { ok: true };
  }

  @Post("unsubscribe")
  async unsubscribe(@Body() dto: UnsubscribeDto, @Req() req: any) {
    await this.pushService.unsubscribe(req.user.id, req.organization.id, dto.endpoint);
    return { ok: true };
  }
}
