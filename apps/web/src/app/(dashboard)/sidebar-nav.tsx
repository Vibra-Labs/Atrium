"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  Palette,
  UserCog,
  Settings,
} from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/projects", label: "Projects", icon: FolderKanban },
  { href: "/dashboard/clients", label: "Clients", icon: Users },
  { href: "/dashboard/settings/branding", label: "Branding", icon: Palette },
  { href: "/dashboard/settings/system", label: "System", icon: Settings },
  { href: "/dashboard/settings/account", label: "Account", icon: UserCog },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav className="space-y-1 flex-1">
      {navItems.map(({ href, label, icon: Icon }) => {
        const isActive =
          pathname === href ||
          (href !== "/dashboard" && pathname.startsWith(href));
        return (
          <Link
            key={href}
            href={href}
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              isActive
                ? "bg-[var(--muted)] font-medium"
                : "hover:bg-[var(--muted)] text-[var(--muted-foreground)]"
            }`}
          >
            <Icon size={18} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
