// Compression image côté client avant upload
// Réduit drastiquement taille + temps d'upload (5MB → ~300-500 ko)

const MAX_DIMENSION = 1920; // largeur ou hauteur max
const QUALITE = 0.82; // JPEG quality 0-1

export async function compresserImage(file: File): Promise<string> {
  // PDF : on retourne tel quel en base64 (pas de compression)
  if (file.type === "application/pdf") {
    return await new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result as string);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  // Image : compresser via canvas
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

  return await new Promise<string>((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      // Calculer dimensions réduites en gardant ratio
      if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
        if (width > height) {
          height = Math.round(height * (MAX_DIMENSION / width));
          width = MAX_DIMENSION;
        } else {
          width = Math.round(width * (MAX_DIMENSION / height));
          height = MAX_DIMENSION;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return reject(new Error("Canvas non disponible"));
      ctx.drawImage(img, 0, 0, width, height);
      // Conversion JPEG avec qualité contrôlée
      const compressed = canvas.toDataURL("image/jpeg", QUALITE);
      resolve(compressed);
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/** Détecte le support WebP du navigateur (encodage canvas). Mémoïsé. */
let _webpOk: boolean | null = null;
function supporteWebp(): boolean {
  if (_webpOk !== null) return _webpOk;
  try {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    _webpOk = c.toDataURL("image/webp").startsWith("data:image/webp");
  } catch { _webpOk = false; }
  return _webpOk;
}

/** Génère une VIGNETTE (max 400px) — WebP si supporté (~40% plus léger que JPEG),
 *  sinon JPEG. Affiche les grilles de photos sans télécharger les images pleine taille.
 *  Retourne null pour PDF/vidéos. */
export async function genererVignette(file: File, maxDim = 400, qualite = 0.6): Promise<string | null> {
  if (!file.type.startsWith("image/")) return null;
  const dataUrl = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  return await new Promise<string | null>((resolve) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDim || height > maxDim) {
        if (width > height) { height = Math.round(height * (maxDim / width)); width = maxDim; }
        else { width = Math.round(width * (maxDim / height)); height = maxDim; }
      }
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(null);
      ctx.drawImage(img, 0, 0, width, height);
      const mime = supporteWebp() ? "image/webp" : "image/jpeg";
      resolve(canvas.toDataURL(mime, qualite));
    };
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

/** Retourne la taille en ko d'une string base64 dataURL */
export function tailleBase64Ko(dataUrl: string): number {
  return Math.round((dataUrl.length * 0.75) / 1024);
}
