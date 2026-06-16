"use client";

import { useEffect } from "react";
import { ErrorState } from "@/components/error-state";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="py-10">
      <ErrorState
        title="This view hit a snag"
        description="An unexpected error occurred while loading this page. You can retry, or head back to the dashboard."
        onRetry={reset}
      />
    </div>
  );
}
