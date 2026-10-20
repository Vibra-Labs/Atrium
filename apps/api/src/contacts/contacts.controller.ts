import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ContactsService } from "./contacts.service";
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
} from "../common";

@Controller("contacts")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class ContactsController {
  constructor(private contactsService: ContactsService) {}

  // Static routes (e.g. export, import) must be declared before ":id".

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
