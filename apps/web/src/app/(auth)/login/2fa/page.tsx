import type { Metadata } from "next";
import { headers } from "next/headers";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = { title: "Two-factor authentication" };

export default async function TwoFactorPage(): Promise<React.ReactElement> {
  const onCustomDomain: boolean = Boolean((await headers()).get("x-custom-host"));
  const webUrl: string = process.env.WEB_URL || "http://localhost:3000";
  return <TwoFactorForm onCustomDomain={onCustomDomain} webUrl={webUrl} />;
}
