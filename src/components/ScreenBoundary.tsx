import { Suspense, type ReactNode } from "react";
import ErrorBoundary from "./ErrorBoundary";
import ScreenSkeleton from "./ScreenSkeleton";

// Pojedynczy ekran/modal: własna granica błędu + Suspense. Awaria JEDNEGO ekranu
// nie kładzie całej aplikacji (samoleczenie poddrzewa) — reszta UI żyje dalej.
// Podczas leniwego importu pokazujemy lekki SZKIELET (nie martwą pustkę), a przy błędzie
// oferujemy Ponów i Wróć. `name`/`onBack` są opcjonalne — działa też bez nich.
export default function ScreenBoundary({ children, name, onBack }: { children: ReactNode; name?: string; onBack?: () => void }) {
  return (
    <ErrorBoundary label={name ? `ekranu „${name}"` : "ekranu"} onBack={onBack}>
      <Suspense fallback={<ScreenSkeleton name={name} />}>{children}</Suspense>
    </ErrorBoundary>
  );
}
