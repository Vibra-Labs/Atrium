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
import { CompaniesService } from "./companies.service";
import { CreateCompanyDto, UpdateCompanyDto } from "./contacts.dto";
import {
  AuthGuard,
  RolesGuard,
  Roles,
  CurrentOrg,
  PaginationQueryDto,
} from "../common";

@Controller("companies")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class CompaniesController {
  constructor(private companiesService: CompaniesService) {}

  @Get()
  findAll(@CurrentOrg("id") orgId: string, @Query() pagination: PaginationQueryDto) {
    return this.companiesService.findAll(orgId, pagination.page, pagination.limit);
  }

  @Post()
  create(@Body() dto: CreateCompanyDto, @CurrentOrg("id") orgId: string) {
    return this.companiesService.create(dto, orgId);
  }

  @Get(":id")
  findOne(@Param("id") id: string, @CurrentOrg("id") orgId: string) {
    return this.companiesService.findOne(id, orgId);
  }

  @Put(":id")
  update(
    @Param("id") id: string,
    @Body() dto: UpdateCompanyDto,
    @CurrentOrg("id") orgId: string,
  ) {
    return this.companiesService.update(id, dto, orgId);
  }

  @Delete(":id")
  remove(@Param("id") id: string, @CurrentOrg("id") orgId: string) {
    return this.companiesService.remove(id, orgId);
  }
}
