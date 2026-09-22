import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { listerPhotosChantier, getPhotoChantier, getPhotoChantierMeta, ajouterPhotoChantier, supprimerPhotoChantier, getProjet, marquerDriveSync, marquerDriveEnAttente } from "@/lib/db";
import { driveEstActif, trouverOuCreerSousDossier, uploaderFichier } from "@/lib/drive";
import { donneesTropLourdes, LIMITE_ENCODEE_OCTETS, poidsLisible } from "@/lib/limites-fichiers";
import { avecIdempotence } from "@/lib/idempotence";
import { journaliser } from "@/lib/audit";
import { utilisateurActif } from "@/lib/authUser";

// Seules des images ou des vidéos sont acceptées, et le type est DÉRIVÉ du data URL :
// le `photo_type` déclaré par le client n'est jamais cru (il décidait de l'extension sur
// Drive et pouvait annoncer une image pour un contenu HTML).
const TYPE_PHOTO_RX = /^data:((?:image|video)\/[a-z0-9.+-]+);base64,/i;

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get("id");
  if (id) return NextResponse.json(await getPhotoChantier(+id));
  const projet_id = sp.get("projet_id");
  // Sans projet, la liste est TOUJOURS servie sans les blobs : 200 photos plein format en
  // base64 dans un seul JSON, c'était des dizaines de Mo par appel. Le contenu d'une photo
  // passe par /api/photos/[id].
  const sansData = sp.get("data") === "0" || !projet_id;
  return NextResponse.json(await listerPhotosChantier(projet_id ? +projet_id : undefined, { sansData }));
}

// Idempotent : l'écran envoie X-Idempotence-Cle ; un réessai réseau ou un double clic ne
// crée pas deux photos (même contrat que heures/dépenses/extras, lib/idempotence.ts).
export async function POST(req: NextRequest) {
  return avecIdempotence(req, () => creerPhoto(req));
}

async function creerPhoto(req: NextRequest): Promise<NextResponse> {
  const b = await req.json();
  if (!b.projet_id || !b.date || !b.photo_data) {
    return NextResponse.json({ error: "projet_id, date et photo_data requis" }, { status: 400 });
  }
  if (donneesTropLourdes(b.photo_data) || donneesTropLourdes(b.thumb_data)) {
    return NextResponse.json({ error: `photo trop lourde (max ${poidsLisible(LIMITE_ENCODEE_OCTETS)} encodée) — compresse-la avant l'envoi` }, { status: 413 });
  }
  const mType = typeof b.photo_data === "string" ? b.photo_data.match(TYPE_PHOTO_RX) : null;
  if (!mType) return NextResponse.json({ error: "photo_data doit être une image ou une vidéo (data URL)" }, { status: 400 });
  if (b.thumb_data != null && b.thumb_data !== "" && !(typeof b.thumb_data === "string" && TYPE_PHOTO_RX.test(b.thumb_data))) {
    return NextResponse.json({ error: "thumb_data doit être une image (data URL)" }, { status: 400 });
  }
  b.photo_type = mType[1].toLowerCase();
  const id = await ajouterPhotoChantier(b);

  // Push Drive si actif. Deux garde-fous, parce qu'une fonction serverless peut être
  // arrêtée dès la réponse envoyée :
  //  1) on marque la photo « en attente » AVANT de commencer → si l'envoi est interrompu,
  //     elle reste repérable et le bouton « Resynchroniser » la reprendra (avant, elle
  //     n'arrivait ni sur Drive ni dans le journal d'erreurs : perdue en silence) ;
  //  2) after() confie le travail à la plateforme, qui maintient la fonction en vie après
  //     la réponse — contrairement à une promesse lancée et non attendue.
  const driveActif = await driveEstActif();
  if (driveActif) {
    await marquerDriveEnAttente(id).catch(() => {});
    after(async () => {
      try {
        const projet = await getProjet(+b.projet_id);
        const sousDossier = `${projet?.nom || "Projet " + b.projet_id} - Photos`;
        const dossierId = await trouverOuCreerSousDossier(sousDossier);
        const ext = b.photo_type?.includes("png") ? "png" : b.photo_type?.includes("pdf") ? "pdf" : b.photo_type?.startsWith("video/") ? "mp4" : "jpg";
        const nom = `${b.date}_${b.description || "photo"}_${id}.${ext}`.replace(/[/\\]/g, "-");
        const up = await uploaderFichier({ nom, dataUrl: b.photo_data, dossierId, description: `Projet ${projet?.nom || ""} · ${b.date} · ${b.employes || ""}` });
        await marquerDriveSync(id, up.id, null);   // succès : le marqueur d'attente est levé
      } catch (e: any) {
        console.warn("Drive sync failed:", e.message);
        try { await marquerDriveSync(id, null, e.message?.slice(0, 500) || "erreur inconnue"); } catch {}
      }
    });
  }

  return NextResponse.json({ ok: true, id, drive_sync: driveActif });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id requis" }, { status: 400 });
  const user = await utilisateurActif(req);
  // Métadonnées seulement (pas le blob) pour la trace : une photo effacée doit rester
  // retrouvable sur Drive par son projet, sa date et son drive_file_id.
  const avant = await getPhotoChantierMeta(+id).catch(() => null);
  await supprimerPhotoChantier(+id);
  journaliser("photo.supprimee", {
    ref_type: "photo", ref_id: id, utilisateur: user || undefined,
    description: avant ? `projet ${avant.projet_id} · ${avant.date} · ${avant.description || "photo"}` : `Photo #${id}`,
    avant,
  });
  return NextResponse.json({ ok: true });
}
