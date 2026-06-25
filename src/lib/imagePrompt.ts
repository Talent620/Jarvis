// === Image Prompt Intelligence — wzmacniacz promptu obrazu (Creative OS) ===
// NIEINWAZYJNY, czysty moduł: wzbogaca surowy opis o tokeny kompozycji/światła/jakości i wybrany
// kierunek artystyczny — to podnosi jakość z TEGO SAMEGO modelu (zwł. text→image), bez API/backendu.
// Idempotentny-ostrożny: nie dubluje, gdy prompt już zawiera tokeny jakości; pusty wejściowy → pusty.

export type ImageStyle = "auto" | "photoreal" | "cinematic" | "product" | "3d" | "flat" | "anime" | "watercolor" | "neon";

export const IMAGE_STYLES: { id: ImageStyle; label: string }[] = [
  { id: "auto", label: "✨ Auto" },
  { id: "photoreal", label: "📷 Foto" },
  { id: "cinematic", label: "🎬 Filmowy" },
  { id: "product", label: "📦 Produkt" },
  { id: "3d", label: "🧊 3D" },
  { id: "flat", label: "🎨 Flat" },
  { id: "anime", label: "🌸 Anime" },
  { id: "watercolor", label: "💧 Akwarela" },
  { id: "neon", label: "🌃 Neon" },
];

const STYLE_TOKENS: Record<ImageStyle, string> = {
  auto: "balanced composition, professional lighting, high detail",
  photoreal: "photorealistic, ultra-detailed, natural lighting, 50mm lens, shallow depth of field, high dynamic range",
  cinematic: "cinematic lighting, dramatic shadows, film grain, anamorphic, moody color grade, atmospheric",
  product: "studio product photography, soft box lighting, clean seamless background, crisp focus, commercial quality",
  "3d": "3D render, octane render, soft global illumination, subsurface scattering, physically based materials",
  flat: "flat vector illustration, bold geometric shapes, minimal, clean lines, modern color palette",
  anime: "anime style, cel shading, vibrant colors, clean lineart, expressive",
  watercolor: "watercolor painting, soft washes, textured paper, hand-painted, delicate gradients",
  neon: "neon cyberpunk, glowing accents, dark background, vibrant cyan and magenta, futuristic",
};

const QUALITY = "sharp focus, rule of thirds, intricate detail, 8k, masterpiece";

// Czy prompt już wygląda na „wzmocniony" (zawiera typowe tokeny jakości) — wtedy nie dublujemy.
const ALREADY_RICH = /(8k|photorealistic|cinematic|masterpiece|ultra[- ]detailed|octane|depth of field|studio lighting)/i;

/** Pure: wzbogać prompt obrazu o styl + tokeny jakości. Pusty wejściowy → pusty; już bogaty → bez zmian. */
export function enhanceImagePrompt(prompt: string, style: ImageStyle = "auto"): string {
  const p = (prompt || "").trim();
  if (!p) return p;
  if (ALREADY_RICH.test(p)) return p;
  const tokens = [STYLE_TOKENS[style] || STYLE_TOKENS.auto, QUALITY].join(", ");
  return `${p} — ${tokens}`;
}
