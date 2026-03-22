import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from "@nestjs/common";
import { LabelsService } from "./labels.service";
import { CreateLabelDto, UpdateLabelDto, AssignLabelDto } from "./labels.dto";
import { AuthGuard, RolesGuard, Roles, CurrentOrg } from "../common";

@Controller("labels")
@UseGuards(AuthGuard, RolesGuard)
export class LabelsController {
  constructor(private labelsService: LabelsService) {}

  @Get()
  findAll(@CurrentOrg("id") orgId: string) {
    return this.labelsService.findAll(orgId);
  }

  @Post()
  @Roles("owner", "admin")
  create(@Body() dto: CreateLabelDto, @CurrentOrg("id") orgId: string) {
    return this.labelsService.create(dto, orgId);
  }

  @Put(":id")
  @Roles("owner", "admin")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateLabelDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.labelsService.update(id, dto, orgId);
  }

  @Delete(":id")
  @Roles("owner", "admin")
  remove(@Param("id") id: string, @CurrentOrg("id") orgId: string) {
    return this.labelsService.remove(id, orgId);
  }

  @Post(":id/assign")
  @Roles("owner", "admin")
  assign(
    @Param("id") id: string,
    @Body() dto: AssignLabelDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.labelsService.assign(id, dto, orgId);
  }

  @Delete(":id/assign")
  @Roles("owner", "admin")
  unassign(
    @Param("id") id: string,
    @Body() dto: AssignLabelDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.labelsService.unassign(id, dto, orgId);
  }
}
