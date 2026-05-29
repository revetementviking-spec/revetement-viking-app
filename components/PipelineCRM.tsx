"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  DndContext, DragOverlay, PointerSensor, TouchSensor, KeyboardSensor,
  useSensor, useSensors, useDraggable, useDroppable, closestCorners,
  type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { useToast } from "@/components/Toasts";

export const PIPELINE_STAGES = [
  { key: "info_1", label: "Info 1ère soumission", couleur: "bg-slate-100 border-slate-300", emoji: "📋" },
  { key: "rdv", label: "Rendez-vous à céduler", couleur: "bg-sky-100 border-sky-300", emoji: "📅" },
  { key: "mesures", label: "Mesures et prise de photo", couleur: "bg-amber-100 border-amber-300", emoji: "📐" },
  { key: "soum_envoyer", label: "Soumission à envoyer", couleur: "bg-orange-100 border-orange-300", emoji: "✉️" },
  { key: "attente", label: "Projet en attente", couleur: "bg-violet-100 border-violet-300", emoji: "⏳" },
  { key: "accepte", label: "Projet accepté", couleur: "bg-emerald-100 border-emerald-300", emoji: "✅" },
] as const;

export const STAGE_PAR_CLE: Record<string, typeof PIPELINE_STAGES[number]> = Object.fromEntries(PIPELINE_STAGES.map((s) => [s.key, s])) as any;
const AUCUN_KEY = "__aucun__";

interface Props { clients: any[]; onUpdate: () => void; }

export default function PipelineCRM({ clients, onUpdate }: Props) {
  const [recherche, setRecherche] = useState("");
  const [ajoutOuvert, setAjoutOuvert] = useState<string | null>(null); // stage où on ajoute
  const [nouveau, setNouveau] = useState({ nom: "", telephone: "", courriel: "" });
  const [dragActif, setDragActif] = useState<any>(null);
  const { toast } = useToast();

  // Capteurs : souris (avec petit délai pour ne pas confondre clic et drag) + touch + clavier
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 6 } }),
    useSensor(KeyboardSensor),
  );

  const changerStage = async (id: number, stage: string | null) => {
    await fetch("/api/clients", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, pipeline_stage: stage }),
    });
    onUpdate();
  };

  const ajouter = async (stage: string) => {
    if (!nouveau.nom.trim()) { toast("Nom requis", "warning"); return; }
    const r = await fetch("/api/clients", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...nouveau, statut: "prospect", pipeline_stage: stage }),
    });
    if ((await r.json()).ok) {
      toast(`${nouveau.nom} ajouté à « ${STAGE_PAR_CLE[stage].label} »`, "success");
      setNouveau({ nom: "", telephone: "", courriel: "" });
      setAjoutOuvert(null);
      onUpdate();
    }
  };

  const filtres = useMemo(() => {
    if (!recherche.trim()) return clients;
    const q = recherche.toLowerCase();
    return clients.filter((c) =>
      [c.nom, c.courriel, c.telephone, c.adresse, c.notes].filter(Boolean).some((x: string) => x.toLowerCase().includes(q))
    );
  }, [clients, recherche]);

  const parStage = useMemo(() => {
    const m = new Map<string, any[]>();
    PIPELINE_STAGES.forEach((s) => m.set(s.key, []));
    m.set(AUCUN_KEY, []);
    for (const c of filtres) {
      const k = c.pipeline_stage && STAGE_PAR_CLE[c.pipeline_stage] ? c.pipeline_stage : AUCUN_KEY;
      m.get(k)!.push(c);
    }
    return m;
  }, [filtres]);

  const onStart = (e: DragStartEvent) => {
    const id = +String(e.active.id).replace("c-", "");
    setDragActif(clients.find((c) => c.id === id));
  };
  const onEnd = (e: DragEndEvent) => {
    setDragActif(null);
    if (!e.over) return;
    const id = +String(e.active.id).replace("c-", "");
    const cible = String(e.over.id).replace("s-", "");
    const client = clients.find((c) => c.id === id);
    if (!client) return;
    const ancien = client.pipeline_stage || AUCUN_KEY;
    if (ancien === cible) return;
    const nouvelleEtape = cible === AUCUN_KEY ? null : cible;
    changerStage(id, nouvelleEtape);
    const label = nouvelleEtape ? STAGE_PAR_CLE[nouvelleEtape].label : "Sans étape";
    toast(`${client.nom} → ${label}`, "success");
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onStart} onDragEnd={onEnd}>
      <div className="space-y-3">
        <input
          type="search"
          placeholder="🔍 Rechercher (nom, courriel, téléphone…)"
          value={recherche}
          onChange={(e) => setRecherche(e.target.value)}
          className="w-full px-3 py-2 border rounded-lg text-sm"
        />
        <p className="text-xs text-slate-500 italic">💡 Astuce : glisse-dépose une carte vers une autre étape pour la déplacer (touche longue 0,15 s sur mobile).</p>

        <div className="lg:grid lg:grid-cols-3 xl:grid-cols-6 lg:gap-3 space-y-3 lg:space-y-0">
          {PIPELINE_STAGES.map((s) => (
            <Colonne
              key={s.key}
              stage={s}
              clients={parStage.get(s.key) || []}
              ajoutOuvert={ajoutOuvert === s.key}
              onOuvrirAjout={() => { setAjoutOuvert(s.key); setNouveau({ nom: "", telephone: "", courriel: "" }); }}
              onFermerAjout={() => setAjoutOuvert(null)}
              nouveau={nouveau}
              setNouveau={setNouveau}
              onAjouter={() => ajouter(s.key)}
            />
          ))}
        </div>

        {(parStage.get(AUCUN_KEY) || []).length > 0 && (
          <Colonne
            stage={{ key: AUCUN_KEY, label: "À classer (clients sans étape)", couleur: "bg-white border-slate-300 border-dashed", emoji: "📥" } as any}
            clients={parStage.get(AUCUN_KEY) || []}
            ajoutOuvert={false} onOuvrirAjout={() => {}} onFermerAjout={() => {}} nouveau={nouveau} setNouveau={setNouveau} onAjouter={() => {}}
            cacherAjout
          />
        )}

        <DragOverlay>
          {dragActif ? <CarteAffichage client={dragActif} ombre /> : null}
        </DragOverlay>
      </div>
    </DndContext>
  );
}

function Colonne({ stage, clients, ajoutOuvert, onOuvrirAjout, onFermerAjout, nouveau, setNouveau, onAjouter, cacherAjout }: {
  stage: { key: string; label: string; couleur: string; emoji: string };
  clients: any[];
  ajoutOuvert: boolean; onOuvrirAjout: () => void; onFermerAjout: () => void;
  nouveau: { nom: string; telephone: string; courriel: string };
  setNouveau: (v: any) => void;
  onAjouter: () => void;
  cacherAjout?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `s-${stage.key}` });
  return (
    <section ref={setNodeRef} className={`rounded-lg border-2 ${stage.couleur} lg:min-h-[200px] transition ${isOver ? "ring-4 ring-emerald-300" : ""}`}>
      <div className="px-3 py-2 flex items-center justify-between font-bold text-sm text-slate-900">
        <span className="text-left">{stage.emoji} {stage.label}</span>
        <span className="ml-2 bg-white/70 text-slate-900 text-xs rounded-full px-2 py-0.5">{clients.length}</span>
      </div>
      <div className="px-2 pb-2 space-y-2 min-h-[60px]">
        {clients.length === 0 ? (
          <div className="text-xs italic text-slate-500 px-2 py-3 text-center">Glisse un client ici.</div>
        ) : clients.map((c) => (
          <CarteDraggable key={c.id} client={c} />
        ))}
        {!cacherAjout && (
          ajoutOuvert ? (
            <div className="bg-white border-2 border-emerald-400 rounded p-2 space-y-1.5">
              <input autoFocus type="text" value={nouveau.nom} onChange={(e) => setNouveau({ ...nouveau, nom: e.target.value })} placeholder="Nom du client *" className="w-full px-2 py-1.5 border rounded text-sm" />
              <input type="tel" value={nouveau.telephone} onChange={(e) => setNouveau({ ...nouveau, telephone: e.target.value })} placeholder="Téléphone" className="w-full px-2 py-1.5 border rounded text-xs" />
              <input type="email" value={nouveau.courriel} onChange={(e) => setNouveau({ ...nouveau, courriel: e.target.value })} placeholder="Courriel" className="w-full px-2 py-1.5 border rounded text-xs" />
              <div className="flex gap-1">
                <button onClick={onAjouter} className="flex-1 px-2 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-bold">✓ Ajouter</button>
                <button onClick={onFermerAjout} className="px-2 py-1.5 bg-slate-200 hover:bg-slate-300 rounded text-xs">✕</button>
              </div>
            </div>
          ) : (
            <button onClick={onOuvrirAjout} className="w-full text-xs text-emerald-700 hover:bg-white/50 rounded py-1.5 font-semibold">➕ Ajouter un client ici</button>
          )
        )}
      </div>
    </section>
  );
}

function CarteDraggable({ client }: { client: any }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: `c-${client.id}` });
  const style = transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined;
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-white rounded p-2 shadow-sm border border-slate-200 cursor-grab active:cursor-grabbing select-none ${isDragging ? "opacity-30" : ""}`}
      {...attributes}
      {...listeners}
    >
      <CarteContenu client={client} />
    </div>
  );
}

function CarteAffichage({ client, ombre }: { client: any; ombre?: boolean }) {
  return (
    <div className={`bg-white rounded p-2 border border-slate-200 ${ombre ? "shadow-2xl ring-2 ring-emerald-400" : "shadow-sm"}`}>
      <CarteContenu client={client} />
    </div>
  );
}

function CarteContenu({ client }: { client: any }) {
  return (
    <>
      <Link href={`/clients/${client.id}`} onPointerDown={(e) => e.stopPropagation()} className="font-semibold text-sm text-slate-900 hover:underline truncate block">{client.nom}</Link>
      <div className="text-xs text-slate-500 truncate">
        {client.telephone && <span>📞 {client.telephone}</span>}
        {client.telephone && client.adresse && <span> · </span>}
        {client.adresse && <span className="truncate">📍 {client.adresse}</span>}
      </div>
      {client.courriel && <div className="text-[10px] text-slate-400 truncate">{client.courriel}</div>}
    </>
  );
}
