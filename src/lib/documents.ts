export interface ExtractedDoc {
  name: string;
  mime: string;
  text: string;
}

// Ładuj pdf.js dopiero przy pierwszym dokumencie (code-splitting — lekki start).
async function loadPdfjs() {
  const pdfjs = await import("pdfjs-dist");
  // @ts-expect-error — Vite zwróci URL workera jako string
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default as string;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

async function extractPdf(buf: ArrayBuffer): Promise<string> {
  const pdfjs = await loadPdfjs();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const parts: string[] = [];
  const maxPages = Math.min(pdf.numPages, 50);
  for (let p = 1; p <= maxPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    parts.push(content.items.map((it: any) => it.str).join(" "));
  }
  return parts.join("\n\n").trim();
}

function readArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(file);
  });
}

function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

// Otwiera wybór pliku i zwraca wyekstrahowaną treść (PDF lub tekst).
export async function importDocument(): Promise<ExtractedDoc | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf,.txt,.md,.csv,.json,.html,text/*,application/pdf";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      try {
        let text = "";
        if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
          text = await extractPdf(await readArrayBuffer(file));
        } else {
          text = await readText(file);
        }
        resolve({ name: file.name, mime: file.type || "text/plain", text: text.slice(0, 200_000) });
      } catch (e) {
        resolve({ name: file.name, mime: file.type, text: `(Nie udało się odczytać: ${e instanceof Error ? e.message : e})` });
      }
    };
    input.click();
  });
}
