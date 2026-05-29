// Outils de traitement d'images pour les reçus de dépenses :
// - autoCadrer  : détecte le contenu (zone non-uniforme) et coupe le surplus
// - filtreDocument : grayscale + auto-niveaux + léger contraste → aspect "scan"
// - ocrRecu : OCR (Tesseract.js, chargé à la demande) + extraction montant/date/fournisseur

function chargerImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = dataUrl;
  });
}

/** Détecte une boîte englobante en cherchant les lignes/colonnes contenant du contenu
 *  (variance / contraste supérieur à un seuil) puis crop. Marche bien pour les reçus
 *  blancs sur fond sombre (ou inverse) — moins bien pour les arrière-plans chargés. */
export async function autoCadrer(dataUrl: string, marge = 0.03): Promise<string> {
  const img = await chargerImage(dataUrl);
  const W = img.naturalWidth, H = img.naturalHeight;
  if (!W || !H) return dataUrl;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, W, H).data;

  // Calcul de la luminance moyenne globale + variance par ligne/colonne (échantillonné)
  const STEP = Math.max(1, Math.round(Math.min(W, H) / 600)); // sous-échantillonnage rapide
  const lumLigne = new Float32Array(H);
  const lumCol = new Float32Array(W);
  for (let y = 0; y < H; y += STEP) {
    let somme = 0, n = 0;
    for (let x = 0; x < W; x += STEP) {
      const i = (y * W + x) * 4;
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      somme += l; n++;
    }
    lumLigne[y] = somme / Math.max(1, n);
  }
  for (let x = 0; x < W; x += STEP) {
    let somme = 0, n = 0;
    for (let y = 0; y < H; y += STEP) {
      const i = (y * W + x) * 4;
      const l = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      somme += l; n++;
    }
    lumCol[x] = somme / Math.max(1, n);
  }
  // luminance globale
  let lumGlobale = 0, ng = 0;
  for (let y = 0; y < H; y += STEP) { lumGlobale += lumLigne[y]; ng++; }
  lumGlobale /= Math.max(1, ng);

  // Seuil : on cherche les lignes/colonnes dont la luminance s'écarte sensiblement de la médiane (bords du document)
  const SEUIL = 25;
  const trouverDebut = (arr: Float32Array, len: number) => {
    for (let i = 0; i < len; i++) if (Math.abs(arr[i] - lumGlobale) > SEUIL) return i;
    return 0;
  };
  const trouverFin = (arr: Float32Array, len: number) => {
    for (let i = len - 1; i >= 0; i--) if (Math.abs(arr[i] - lumGlobale) > SEUIL) return i;
    return len - 1;
  };
  let y0 = trouverDebut(lumLigne, H), y1 = trouverFin(lumLigne, H);
  let x0 = trouverDebut(lumCol, W), x1 = trouverFin(lumCol, W);
  // marge
  const dx = Math.round((x1 - x0) * marge), dy = Math.round((y1 - y0) * marge);
  x0 = Math.max(0, x0 - dx); y0 = Math.max(0, y0 - dy);
  x1 = Math.min(W - 1, x1 + dx); y1 = Math.min(H - 1, y1 + dy);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  if (w < W * 0.4 || h < H * 0.4) return dataUrl; // détection peu fiable → on garde l'original
  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  out.getContext("2d")!.drawImage(c, x0, y0, w, h, 0, 0, w, h);
  return out.toDataURL("image/jpeg", 0.85);
}

/** Grayscale + étirement d'histogramme (auto-niveaux) + boost de contraste → aspect "scan". */
export async function filtreDocument(dataUrl: string, intensite = 1): Promise<string> {
  const img = await chargerImage(dataUrl);
  const W = img.naturalWidth, H = img.naturalHeight;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d");
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0);
  const id = ctx.getImageData(0, 0, W, H);
  const d = id.data;
  // 1. luminance + histogramme
  const hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
    d[i] = d[i + 1] = d[i + 2] = l;
    hist[l]++;
  }
  // 2. trouver les bornes utiles (1% et 99%)
  const total = (d.length / 4);
  const seuilBas = total * 0.01, seuilHaut = total * 0.99;
  let cumul = 0, min = 0, max = 255;
  for (let i = 0; i < 256; i++) { cumul += hist[i]; if (cumul >= seuilBas) { min = i; break; } }
  cumul = 0;
  for (let i = 0; i < 256; i++) { cumul += hist[i]; if (cumul >= seuilHaut) { max = i; break; } }
  const span = Math.max(1, max - min);
  // 3. étirement linéaire + boost contraste (gamma léger)
  for (let i = 0; i < d.length; i += 4) {
    let v = (d[i] - min) * 255 / span;
    v = Math.max(0, Math.min(255, v));
    // contraste plus marqué quand intensite > 1
    const t = v / 255;
    const ajusté = Math.pow(t, 1 / (1 + 0.3 * intensite)) * 255;
    const final = Math.max(0, Math.min(255, ajusté));
    d[i] = d[i + 1] = d[i + 2] = final;
  }
  ctx.putImageData(id, 0, 0);
  return c.toDataURL("image/jpeg", 0.85);
}

/** Lance l'OCR via Tesseract.js (chargement à la demande). */
export async function ocrRecu(dataUrl: string, onProgress?: (p: number) => void): Promise<{
  texte: string;
  montant?: number;
  date?: string;
  fournisseur?: string;
}> {
  const { recognize } = await import("tesseract.js");
  const res: any = await recognize(dataUrl, "fra+eng", {
    logger: (m: any) => { if (m?.status === "recognizing text" && onProgress) onProgress(m.progress || 0); },
  });
  const texte: string = res?.data?.text || "";
  return { texte, ...parserDonneesRecu(texte) };
}

/** Parse le texte OCR pour repérer le total + la date + le fournisseur. */
export function parserDonneesRecu(texte: string): { montant?: number; date?: string; fournisseur?: string } {
  const out: { montant?: number; date?: string; fournisseur?: string } = {};
  // === MONTANT === : on cherche le plus gros nombre sous forme XX.XX ou XX,XX
  const montants: number[] = [];
  const regNum = /(?:\$|CAD|CAN\$)?\s*(\d{1,5}[.,]\d{2})\s*(?:\$|CAD|CAN\$)?/g;
  const lignes = texte.split(/\r?\n/);
  let m: RegExpExecArray | null;
  // priorité : ligne contenant "total", "montant" ou "à payer"
  const motsCle = /total|grand total|montant|à payer|payer|due/i;
  for (const ligne of lignes) {
    if (!motsCle.test(ligne)) continue;
    while ((m = regNum.exec(ligne))) {
      const v = parseFloat(m[1].replace(",", "."));
      if (v > 0 && v < 100000) montants.push(v);
    }
    regNum.lastIndex = 0;
  }
  // sinon, tous les nombres
  if (montants.length === 0) {
    while ((m = regNum.exec(texte))) {
      const v = parseFloat(m[1].replace(",", "."));
      if (v > 0 && v < 100000) montants.push(v);
    }
  }
  if (montants.length) out.montant = Math.max(...montants);

  // === DATE === : YYYY-MM-DD, DD/MM/YYYY ou DD-MM-YYYY
  const dDate =
    texte.match(/\b(20\d{2})[-./](0[1-9]|1[0-2])[-./](0[1-9]|[12]\d|3[01])\b/) ||
    texte.match(/\b(0[1-9]|[12]\d|3[01])[-./](0[1-9]|1[0-2])[-./](20\d{2})\b/);
  if (dDate) {
    let y: string, mo: string, d: string;
    if (dDate[1].length === 4) { y = dDate[1]; mo = dDate[2]; d = dDate[3]; }
    else { d = dDate[1]; mo = dDate[2]; y = dDate[3]; }
    out.date = `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  // === FOURNISSEUR === : la 1re ligne non vide, souvent en majuscules
  const premiere = lignes.find((l) => l.trim().length >= 3 && !/^\d/.test(l.trim()));
  if (premiere) out.fournisseur = premiere.trim().slice(0, 60);

  return out;
}
