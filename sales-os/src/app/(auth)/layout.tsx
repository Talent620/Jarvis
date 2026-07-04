import Link from "next/link";
import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { auth } from "@/lib/auth";

export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (session?.user) redirect("/dashboard");

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <Link href="/" className="mb-10 inline-flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </span>
            <span className="font-display text-lg font-semibold">AI Sales OS</span>
          </Link>
          {children}
        </div>
      </div>

      <div className="relative hidden overflow-hidden bg-primary lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(120%_120%_at_0%_0%,hsl(var(--primary))_0%,#0d2a20_60%,#091d16_100%)]" />
        <div className="relative flex h-full flex-col justify-between p-12 text-primary-foreground">
          <div className="max-w-md">
            <p className="font-display text-3xl font-semibold leading-tight">
              Turn scattered outreach into one calm, measurable acquisition system.
            </p>
            <p className="mt-4 text-sm text-primary-foreground/70">
              Capture leads, score them automatically, and let the AI copilot tell you exactly what to do next —
              all without the chaos of ten disconnected tools.
            </p>
          </div>
          <ul className="space-y-3 text-sm text-primary-foreground/80">
            <li>· Automatic lead scoring &amp; next-best-action</li>
            <li>· AI message, ad &amp; follow-up generation</li>
            <li>· Pipeline, tasks &amp; weekly performance in one place</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
