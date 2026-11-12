import { headers } from "next/headers";
import { SetupClient } from "./setup-client";

export default async function TwoFactorSetupPage(): Promise<React.ReactElement> {
  const onCustomDomain: boolean = Boolean((await headers()).get("x-custom-host"));
  return <SetupClient onCustomDomain={onCustomDomain} />;
}
