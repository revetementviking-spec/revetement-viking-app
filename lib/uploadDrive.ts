// Upload d'un gros fichier (vidéo) vers une session résumable Google Drive,
// par morceaux (chunks) avec progression. Contourne la limite de taille du serveur
// (le fichier va directement du navigateur à Drive). Reprise par chunk en cas d'erreur.

const TAILLE_CHUNK = 8 * 1024 * 1024; // 8 Mo

export interface ResultatUploadDrive { ok: boolean; driveId?: string; erreur?: string }

/**
 * Envoie `file` à `uploadUrl` (session résumable Drive) par morceaux de 8 Mo.
 * @param onProgress reçoit un pourcentage 0-100
 */
export async function uploaderVideoDrive(
  uploadUrl: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<ResultatUploadDrive> {
  const total = file.size;
  let envoye = 0;

  while (envoye < total) {
    const fin = Math.min(envoye + TAILLE_CHUNK, total);
    const chunk = file.slice(envoye, fin);
    const range = `bytes ${envoye}-${fin - 1}/${total}`;

    let tentative = 0;
    let res: Response | null = null;
    while (tentative < 3) {
      try {
        res = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Range": range },
          body: chunk,
        });
        break;
      } catch {
        tentative++;
        if (tentative >= 3) return { ok: false, erreur: "Réseau interrompu pendant l'envoi de la vidéo." };
        await new Promise((r) => setTimeout(r, 1500 * tentative));
      }
    }
    if (!res) return { ok: false, erreur: "Upload impossible" };

    if (res.status === 200 || res.status === 201) {
      onProgress?.(100);
      // Tente de lire l'id renvoyé par Drive (peut échouer si CORS — le serveur le
      // retrouvera par nom dans ce cas).
      let driveId: string | undefined;
      try { driveId = (await res.json())?.id; } catch { /* ignore */ }
      return { ok: true, driveId };
    }
    if (res.status === 308) {
      // Chunk accepté, Drive indique l'octet confirmé via l'en-tête Range
      const r = res.headers.get("range") || res.headers.get("Range");
      if (r) {
        const m = r.match(/bytes=0-(\d+)/);
        envoye = m ? +m[1] + 1 : fin;
      } else {
        envoye = fin;
      }
      onProgress?.(Math.round((envoye / total) * 100));
      continue;
    }
    return { ok: false, erreur: `Drive a refusé l'envoi (HTTP ${res.status}).` };
  }
  return { ok: true };
}
