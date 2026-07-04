import { redirect } from "next/navigation";
import { getAuth } from "@/lib/api";
import { TasksClient } from "@/components/tasks/tasks-client";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const a = await getAuth();
  if ("res" in a) redirect("/login");
  return <TasksClient />;
}
