// Client-side wrapper for the AI avatar generator (Replicate.com via the
// Vite / prod-backend proxy at `/api/ai/avatar`).
//
// Wire shape (JSON + base64) — the same in dev and prod so the client
// doesn't have to switch paths. The proxy forwards to Replicate, polls
// until the prediction settles, downloads the output bytes, and returns
// a data URL the client can render directly in <img src=...> without a
// CORS round-trip.
//
// Style presets mirror Replicate's `fofr/face-to-many` model inputs —
// adding a preset here means adding it to the model's accepted values;
// removing one would silently fall back to the model's default. The
// list is the canonical surface; the modal just renders it.

export type AvatarStyle =
  | "3D"
  | "Anime"
  | "Cartoon"
  | "Emoji"
  | "Video game"
  | "Pixel art"
  | "Clay"
  | "Illustration"
  | "Toy";

export interface AvatarStyleOption {
  value: AvatarStyle;
  label: string;
}

export const AVATAR_STYLES: AvatarStyleOption[] = [
  { value: "3D", label: "3D" },
  { value: "Anime", label: "Anime" },
  { value: "Cartoon", label: "Cartoon" },
  { value: "Emoji", label: "Emoji" },
  { value: "Video game", label: "Video game" },
  { value: "Pixel art", label: "Pixel art" },
  { value: "Clay", label: "Clay" },
  { value: "Illustration", label: "Illustration" },
  { value: "Toy", label: "Toy" },
];

export interface GenerateAvatarInput {
  image: Blob;
  style: AvatarStyle;
}

export interface GenerateAvatarResult {
  /** Data URL ready for <img src=...>. Includes the base64 payload. */
  avatarDataUrl: string;
  /** Mime type Replicate returned (image/png or image/webp usually). */
  contentType: string;
  /** Wall-clock duration the proxy took. */
  durationMs: number;
}

// Soft client-side resize before posting. `fofr/face-to-many` accepts up
// to 1024 px on the long edge; anything bigger just costs Replicate CPU
// and doesn't change the output. Resize to 1024 max via an
// OffscreenCanvas (preferred — non-blocking on the main thread where
// available; falls back to a regular <canvas> on Safari iOS < 16.4).
//
// Returns the same Blob when no resize is needed (most phone photos
// are larger, so this re-encodes most inputs).
async function resizeForModel(file: Blob): Promise<Blob> {
  if (file.size <= 200 * 1024) return file; // already small enough
  const bitmap = await createImageBitmap(file);
  const maxEdge = 1024;
  const ratio = bitmap.width / bitmap.height;
  let targetW: number;
  let targetH: number;
  if (bitmap.width >= bitmap.height) {
    targetW = Math.min(bitmap.width, maxEdge);
    targetH = Math.round(targetW / ratio);
  } else {
    targetH = Math.min(bitmap.height, maxEdge);
    targetW = Math.round(targetH * ratio);
  }
  // Re-encode as JPEG (smaller than PNG for photos, and `fofr/face-to-many`
  // accepts JPEG just fine). Quality 0.92 is the standard "visually
  // lossless for portraits" threshold — matches the chat attachment
  // path's choice.
  const canvas = document.createElement("canvas");
  canvas.width = targetW;
  canvas.height = targetH;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, targetW, targetH);
  return new Promise<Blob>((resolve) => {
    canvas.toBlob(
      (b) => resolve(b ?? file),
      "image/jpeg",
      0.92,
    );
  });
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Unexpected reader result"));
        return;
      }
      // FileReader.readAsDataURL already returns a `data:...;base64,...`
      // string, which is what the proxy expects. Don't strip the prefix.
      resolve(result);
    };
    reader.readAsDataURL(blob);
  });
}

export async function generateAvatar(
  input: GenerateAvatarInput,
  signal?: AbortSignal,
): Promise<GenerateAvatarResult> {
  const resized = await resizeForModel(input.image);
  const imageBase64 = await blobToBase64(resized);
  const res = await fetch("/api/ai/avatar", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ imageBase64, style: input.style }),
    signal,
  });
  if (!res.ok) {
    // Surface the proxy's `error` code so the modal can show a
    // meaningful message; fall back to a generic "AI avatars disabled"
    // when the body isn't JSON.
    let errCode = "upstream_failure";
    let message = `Avatar generation failed (${res.status}).`;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      if (typeof data.error === "string") errCode = data.error;
      if (typeof data.message === "string") message = data.message;
    } catch {
      // Body wasn't JSON — keep the generic message.
    }
    throw new Error(`${errCode}: ${message}`);
  }
  const data = (await res.json()) as {
    avatarDataUrl?: string;
    contentType?: string;
    durationMs?: number;
  };
  if (!data.avatarDataUrl) {
    throw new Error("Avatar generation returned no image data.");
  }
  return {
    avatarDataUrl: data.avatarDataUrl,
    contentType: data.contentType ?? "image/png",
    durationMs: data.durationMs ?? 0,
  };
}

// Capability probe. Pings the proxy with a deliberately-invalid POST
// (missing `imageBase64`) — a configured proxy returns 400 `bad_request`,
// an unconfigured proxy returns 503 `avatar_not_configured`. Used by
// `AIAvatarButton` to decide whether to render at all, so the Settings
// page stays honest about feature availability on this environment.
export async function probeAvatarAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/ai/avatar", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    // 400 = wired up (we sent an invalid body, the proxy rejected it
    // cleanly). 503 = not configured. Any other status is treated as
    // "available" — the click flow has its own error path for genuine
    // upstream failures.
    return res.status === 400;
  } catch {
    // Network error — treat as unavailable so we don't render a button
    // that can't possibly work.
    return false;
  }
}
