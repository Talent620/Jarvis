import { Capacitor } from "@capacitor/core";
import { Camera, CameraDirection, CameraResultType, CameraSource } from "@capacitor/camera";

export interface CapturedImage {
  data: string; // base64 (bez prefiksu data:)
  mediaType: string; // np. "image/jpeg"
}

const MAX_IMAGE_FILE_BYTES = 12 * 1024 * 1024;

/** Bezpiecznie wczytaj plik obrazu (z wklejenia Ctrl+V lub przeciągnięcia) do CapturedImage. */
export function readImageFile(file: File): Promise<CapturedImage | null> {
  return new Promise((resolve) => {
    if (!file || !/^image\//i.test(file.type || "") || file.size > MAX_IMAGE_FILE_BYTES) {
      resolve(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      if (comma < 0) { resolve(null); return; }
      const mediaType = result.slice(5, result.indexOf(";")) || file.type || "image/jpeg";
      resolve({ data: result.slice(comma + 1), mediaType });
    };
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function capturePhotoFromWebInput(): Promise<CapturedImage | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (img: CapturedImage | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener("focus", onFocus);
      resolve(img);
    };
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("capture", "environment");
    // Jeśli użytkownik kliknie Anuluj w systemowym oknie aparatu/pliku, onchange nie odpali —
    // zdarzenie cancel + powrót focusu gwarantuje czyste zakończenie bez zawieszenia UI.
    const onFocus = () => {
      setTimeout(() => {
        if (!input.files?.length) finish(null);
      }, 400);
    };
    input.addEventListener("cancel", () => finish(null), { once: true });
    window.addEventListener("focus", onFocus, { once: true });
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return finish(null);
      void readImageFile(file).then(finish);
    };
    input.click();
  });
}

// Zrób/wybierz zdjęcie. Na urządzeniu używa aparatu (Capacitor Camera),
// w przeglądarce robi fallback na input pliku.
export async function capturePhoto(): Promise<CapturedImage | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Base64,
        source: CameraSource.Prompt,
        quality: 70,
        width: 1280,
        correctOrientation: true,
      });
      if (photo.base64String) {
        return { data: photo.base64String, mediaType: `image/${photo.format || "jpeg"}` };
      }
    } catch {
      return null;
    }
    return null;
  }

  return capturePhotoFromWebInput();
}

/**
 * Sprint 2 / Live Vision („Pokaż Jarvisowi”): szybka, skompresowana klatka prosto
 * z TYLNEJ kamery (bez menu wyboru galerii, mniejsza waga pod szybki upload multimodalny).
 */
export async function captureRearCameraFrame(): Promise<CapturedImage | null> {
  if (Capacitor.isNativePlatform()) {
    try {
      const photo = await Camera.getPhoto({
        resultType: CameraResultType.Base64,
        source: CameraSource.Camera,
        direction: CameraDirection.Rear,
        quality: 60,
        width: 960,
        correctOrientation: true,
        saveToGallery: false,
      });
      if (photo.base64String) {
        return { data: photo.base64String, mediaType: `image/${photo.format || "jpeg"}` };
      }
    } catch {
      return null;
    }
    return null;
  }

  return capturePhotoFromWebInput();
}
