import { NotFoundException } from "@nestjs/common";
import { isPrivilegedRole } from "./privileged-role";

/**
 * Items made before a potential contract was won stay internal until staff share them.
 * Clients get a 404, as if the item didn't exist.
 */
export function assertVisibleToRole(item: { internal: boolean }, role: string | null | undefined): void {
  if (item.internal && !isPrivilegedRole(role ?? undefined)) {
    throw new NotFoundException("Not found");
  }
}
