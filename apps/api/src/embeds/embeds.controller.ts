import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Query,
  UseGuards,
} from "@nestjs/common";
import { AuthGuard } from "../common";
import { EmbedsService, OEmbedResult } from "./embeds.service";
import { findProvider } from "./providers";
import { UnfurlCard, UnfurlService } from "./unfurl.service";

@Controller("embeds")
@UseGuards(AuthGuard)
export class EmbedsController {
  constructor(
    private readonly embedsService: EmbedsService,
    private readonly unfurlService: UnfurlService,
  ) {}

  @Get("resolve")
  async resolve(@Query("url") url: string): Promise<OEmbedResult> {
    if (!url || typeof url !== "string") {
      throw new BadRequestException("Missing url query parameter");
    }

    if (!findProvider(url)) {
      throw new NotFoundException("No oEmbed provider for this URL");
    }

    const result = await this.embedsService.resolve(url);
    if (!result) {
      throw new NotFoundException("Unable to resolve embed for this URL");
    }
    return result;
  }

  @Get("unfurl")
  async unfurl(@Query("url") url: string): Promise<UnfurlCard> {
    if (!url || typeof url !== "string") {
      throw new BadRequestException("Missing url query parameter");
    }
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException("Invalid URL");
    }
    if (parsed.protocol !== "https:") {
      throw new BadRequestException("Only https URLs are supported");
    }

    const card = await this.unfurlService.unfurl(url);
    if (!card) {
      throw new NotFoundException("Could not unfurl this URL");
    }
    return card;
  }
}
