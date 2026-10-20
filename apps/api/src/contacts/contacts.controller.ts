import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { ContactsService } from "./contacts.service";
import { parseMapping } from "./contacts-csv";
import {
  CreateContactDto,
  CreateContactNoteDto,
  ListContactsQueryDto,
  SetFollowUpDto,
  SnoozeFollowUpDto,
  UpdateContactDto,
} from "./contacts.dto";
import {
  AuthGuard,
  RolesGuard,
  Roles,
  CurrentUser,
  CurrentOrg,
  PaginationQueryDto,
  contentDisposition,
} from "../common";

const MAX_CSV_BYTES = 2 * 1024 * 1024;

interface CsvUpload {
  originalname: string;
  buffer: Buffer;
}

function readCsvUpload(file: CsvUpload | undefined): string {
  if (!file) throw new BadRequestException("No file provided");
  if (!file.originalname.toLowerCase().endsWith(".csv")) {
    throw new BadRequestException("Only .csv files are supported");
  }
  return file.buffer.toString("utf8");
}

@Controller("contacts")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class ContactsController {
  constructor(private contactsService: ContactsService) {}

  // Static routes (e.g. export, import) must be declared before ":id".

  @Get("export")
  async exportCsv(
    @CurrentOrg("id") orgId: string,
    @Query() query: ListContactsQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const csv = await this.contactsService.exportCsv(orgId, query);
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", contentDisposition("contacts.csv"));
    res.send(csv);
  }

  @Post("import/preview")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_CSV_BYTES } }))
  previewImport(@UploadedFile() file?: CsvUpload) {
    return this.contactsService.previewCsv(readCsvUpload(file));
  }

  @Post("import")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: MAX_CSV_BYTES } }))
  importCsv(
    @UploadedFile() file: CsvUpload | undefined,
    @Body("mapping") rawMapping: unknown,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ) {
    const csv = readCsvUpload(file);
    const mapping = parseMapping(rawMapping);
    if (!mapping) throw new BadRequestException("Invalid mapping");
    return this.contactsService.importCsv({ csv, mapping }, orgId, userId);
  }

  @Get()
  findAll(@CurrentOrg("id") orgId: string, @Query() query: ListContactsQueryDto) {
    return this.contactsService.findAll(orgId, query);
  }

  @Post()
  create(@Body() dto: CreateContactDto, @CurrentOrg("id") orgId: string) {
    return this.contactsService.create(dto, orgId);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentOrg("id") orgId: string) {
    return this.contactsService.findOne(id, orgId);
  }

  @Put(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateContactDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.contactsService.update(id, dto, orgId);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentOrg("id") orgId: string) {
    return this.contactsService.remove(id, orgId);
  }

  @Get(":id/timeline")
  timeline(
    @Param("id") id: string,
    @CurrentOrg("id") orgId: string,
    @Query() pagination: PaginationQueryDto,
  ) {
    return this.contactsService.timeline(id, orgId, pagination.page, pagination.limit);
  }

  @Post(":id/notes")
  addNote(
    @Param("id") id: string,
    @Body() dto: CreateContactNoteDto,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.contactsService.addNote(id, dto.content, orgId, userId);
  }

  @Delete(":id/notes/:noteId")
  removeNote(
    @Param("id") id: string,
    @Param("noteId") noteId: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.contactsService.removeNote(id, noteId, orgId);
  }

  @Post(":id/projects/:projectId")
  linkProject(
    @Param("id") id: string,
    @Param("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.contactsService.linkProject(id, projectId, orgId);
  }

  @Delete(":id/projects/:projectId")
  unlinkProject(
    @Param("id") id: string,
    @Param("projectId") projectId: string,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.contactsService.unlinkProject(id, projectId, orgId);
  }

  @Put(":id/follow-up")
  setFollowUp(
    @Param("id") id: string,
    @Body() dto: SetFollowUpDto,
    @CurrentOrg("id") orgId: string,
    @CurrentUser("id") userId: string,
  ) {
    return this.contactsService.setFollowUp(id, dto, orgId, userId);
  }

  @Post(":id/follow-up/done")
  followUpDone(@Param("id") id: string, @CurrentOrg("id") orgId: string) {
    return this.contactsService.completeFollowUp(id, orgId);
  }

  @Post(":id/follow-up/snooze")
  snoozeFollowUp(
    @Param("id") id: string,
    @Body() dto: SnoozeFollowUpDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.contactsService.snoozeFollowUp(id, dto.days, orgId);
  }
}
