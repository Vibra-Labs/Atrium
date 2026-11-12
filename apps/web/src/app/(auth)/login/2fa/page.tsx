import type { Metadata } from "next";
import { TwoFactorForm } from "./two-factor-form";

export const metadata: Metadata = { title: "Two-factor authentication" };

export default function TwoFactorPage(): React.ReactElement {
  return <TwoFactorForm />;
}
