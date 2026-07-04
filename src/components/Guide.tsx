import type { ReactNode } from "react";

// Luźny, krótki poradnik przy narzędziu: domyślnie zwinięty, „ℹ Jak to działa".
// Lekki (czysty <details>), spójny wygląd przez klasę .guide w index.css.
export default function Guide({ title = "ℹ Jak to działa", children, open = false }: { title?: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="guide" open={open}>
      <summary>{title}</summary>
      <div className="guide-body">{children}</div>
    </details>
  );
}
