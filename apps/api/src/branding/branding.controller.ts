import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  Res,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
  Inject,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { Response } from "express";
import { BrandingService } from "./branding.service";
import { UpdateBrandingDto } from "./branding.dto";
import { AuthGuard, RolesGuard, Roles, CurrentOrg, Public } from "../common";
import type { StorageProvider } from "../files/storage/storage.interface";
import { STORAGE_PROVIDER } from "../files/storage/storage.interface";
import { randomUUID } from "crypto";
import { extname } from "path";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

const MAX_LOGO_SIZE = 2 * 1024 * 1024; // 2MB

@Controller("branding")
@UseGuards(AuthGuard, RolesGuard)
export class BrandingController {
  constructor(
    private brandingService: BrandingService,
    @Inject(STORAGE_PROVIDER) private storage: StorageProvider,
  ) {}

  @Get()
  findByOrg(@CurrentOrg("id") orgId: string) {
    return this.brandingService.findByOrg(orgId);
  }

  @Put()
  @Roles("owner", "admin")
  update(@CurrentOrg("id") orgId: string, @Body() dto: UpdateBrandingDto) {
    return this.brandingService.update(orgId, dto);
  }

  @Post("logo")
  @Roles("owner", "admin")
  @UseInterceptors(FileInterceptor("logo", { limits: { fileSize: MAX_LOGO_SIZE } }))
  async uploadLogo(
    @UploadedFile() file: { originalname: string; buffer: Buffer; mimetype: string; size: number },
    @CurrentOrg("id") orgId: string,
  ) {
    if (!file) throw new BadRequestException("No file provided");

    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        "Invalid file type. Allowed: PNG, JPEG, GIF, WebP",
      );
    }

    if (file.size > MAX_LOGO_SIZE) {
      throw new BadRequestException("Logo must be under 2MB");
    }

    // Delete old logo if one exists
    const existing = await this.brandingService.findByOrgOrNull(orgId);
    if (existing?.logoKey) {
      await this.storage.delete(existing.logoKey).catch(() => {});
    }

    const ext = extname(file.originalname).toLowerCase() || ".png";
    const storageKey = `branding/${orgId}/logo-${randomUUID()}${ext}`;

    await this.storage.upload(storageKey, file.buffer, file.mimetype);

    const branding = await this.brandingService.update(orgId, {
      logoKey: storageKey,
      logoUrl: null,
    });

    return branding;
  }

  @Delete("logo")
  @Roles("owner", "admin")
  async deleteLogo(@CurrentOrg("id") orgId: string) {
    const existing = await this.brandingService.findByOrgOrNull(orgId);
    if (existing?.logoKey) {
      await this.storage.delete(existing.logoKey).catch(() => {});
    }

    return this.brandingService.update(orgId, {
      logoKey: null,
      logoUrl: null,
    });
  }

  @Public()
  @Get("logo/:orgId")
  async serveLogo(
    @Param("orgId") orgId: string,
    @Res() res: Response,
  ) {
    const branding = await this.brandingService.findByOrgOrNull(orgId);

    if (!branding?.logoKey) {
      res.status(404).json({ message: "No logo found" });
      return;
    }

    const { body, contentType } = await this.storage.download(branding.logoKey);
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    body.pipe(res);
  }
}
