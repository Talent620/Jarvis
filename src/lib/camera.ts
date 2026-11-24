import { Capacitor } from "@capacitor/core";
import { Camera, CameraDirection, CameraResultType, CameraSource } from "@capacitor/camera";

export interface CapturedImage {
  data: string; // base64 (bez prefiksu data:)
  mediaType: string; // np. "image/jpeg"
}

function capturePhotoFromWebInput(): Promise<CapturedImage | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.setAttribute("capture", "environment");
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => {
        const result = String(reader.result);
        const comma = result.indexOf(",");
        const mediaType = result.slice(5, result.indexOf(";")) || file.type || "image/jpeg";
        resolve({ data: result.slice(comma + 1), mediaType });
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
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
