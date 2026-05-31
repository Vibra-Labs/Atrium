import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { AuthGuard, CurrentOrg, Roles, RolesGuard } from "../common";
import { BillingClientsService } from "./billing-clients.service";
import { BillingClientListQueryDto, CreateBillingClientDto, UpdateBillingClientDto } from "./billing-clients.dto";

@Controller("billing-clients")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class BillingClientsController {
  constructor(private billingClientsService: BillingClientsService) {}

  @Get()
  findAll(
    @CurrentOrg("id") orgId: string,
    @Query() query: BillingClientListQueryDto,
  ) {
    return this.billingClientsService.findAll(orgId, query);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentOrg("id") orgId: string) {
    return this.billingClientsService.findOne(id, orgId);
  }

  @Post()
  create(@Body() dto: CreateBillingClientDto, @CurrentOrg("id") orgId: string) {
    return this.billingClientsService.create(dto, orgId);
  }

  @Patch(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateBillingClientDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.billingClientsService.update(id, dto, orgId);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentOrg("id") orgId: string) {
    return this.billingClientsService.archive(id, orgId);
  }
}
