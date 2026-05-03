"use client";

import { useEffect } from "react";

export default function BillingRedirect(): React.ReactElement {
  useEffect(() => {
    const search = typeof window !== "undefined" ? window.location.search : "";
    window.location.replace(`/dashboard/settings/account${search}#billing`);
  }, []);
  return <div>Redirecting...</div>;
}
