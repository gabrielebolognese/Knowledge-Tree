import { IMAGE_MAX_EDGE } from "./config.js";

/** Turns an image file into a stored image and returns the URL to render. */
export type ImageUploader = (blob: Blob) => Promise<string>;

/**
 * Reads an image file and downscales it, returning a Blob. Uploading the blob
 * keeps its real binary size; falling back to a data URL costs 33% more, which
 * is why local-only storage runs out of room so much sooner.
 */
export async function prepareImage(file: File): Promise<Blob> {
  try {
    return await downscale(file);
  } catch {
    return file;
  }
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("Unreadable file"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unreadable file"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Not an image"));
    img.src = src;
  });
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Could not encode image"))),
      type,
      quality,
    );
  });
}

async function downscale(file: File): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const longest = Math.max(img.naturalWidth, img.naturalHeight);
    if (longest <= IMAGE_MAX_EDGE) return file;

    const ratio = IMAGE_MAX_EDGE / longest;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * ratio);
    canvas.height = Math.round(img.naturalHeight * ratio);

    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await toBlob(canvas, "image/webp", 0.85);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
