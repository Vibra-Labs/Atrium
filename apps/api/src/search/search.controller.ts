import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AuthGuard } from "../common/guards/auth.guard";
import { RolesGuard } from "../common/guards/roles.guard";
import { Roles } from "../common/decorators/roles.decorator";
import { CurrentOrg } from "../common/decorators/current-org.decorator";
import { SearchService } from "./search.service";
import { SearchQueryDto } from "./search.dto";

@Controller("search")
@UseGuards(AuthGuard, RolesGuard)
@Roles("owner", "admin")
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  search(@Query() query: SearchQueryDto, @CurrentOrg("id") orgId: string) {
    return this.searchService.search(orgId, query.q);
  }
}
