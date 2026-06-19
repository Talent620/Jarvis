import { Suspense, type ReactNode } from "react";
import ErrorBoundary from "./ErrorBoundary";

// Pojedynczy ekran/modal: własna granica błędu + Suspense. Awaria JEDNEGO ekranu
// nie kładzie całej aplikacji (samoleczenie poddrzewa) — reszta UI żyje dalej.
export default function ScreenBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary label="ekranu">
      <Suspense fallback={null}>{children}</Suspense>
    </ErrorBoundary>
  );
}
