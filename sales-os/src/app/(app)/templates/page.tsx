import { redirect } from "next/navigation";
import { getAuth } from "@/lib/api";
import { TemplatesClient } from "@/components/templates/templates-client";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const a = await getAuth();
  if ("res" in a) redirect("/login");
  return <TemplatesClient />;
}
