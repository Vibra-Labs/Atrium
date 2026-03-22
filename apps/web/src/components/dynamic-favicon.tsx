"use client";

import { useEffect } from "react";

export function DynamicFavicon({ href }: { href: string }) {
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      document.head.appendChild(link);
    }
    link.href = href;
  }, [href]);

  return null;
}
