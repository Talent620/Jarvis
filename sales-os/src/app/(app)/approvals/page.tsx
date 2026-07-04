import { redirect } from "next/navigation";
import { getAuth } from "@/lib/api";
import { ApprovalsClient } from "@/components/approvals/approvals-client";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  const a = await getAuth();
  if ("res" in a) redirect("/login");
  return <ApprovalsClient />;
}
