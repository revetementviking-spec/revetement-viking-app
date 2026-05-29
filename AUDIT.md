# 🔍 Dossier d'audit — App Revêtement Viking

> Document destiné à un agent IA / développeur externe pour **auditer, tester et améliorer** l'application.
> Dernière mise à jour : 2026-05-28.

---

## 1. C'est quoi

App de gestion pour **Revêtement Viking Inc.** (entrepreneur en revêtement extérieur résidentiel, Québec — RBQ 5811-4299-01).
Gère : soumissions, projets/chantiers, heures (paie), dépenses, factures, CRM, contrats, photos chantier, signature client en ligne.

- **Live** : https://app.revetementviking.com
- **Accès** : protégé par mot de passe partagé (cookie HMAC). Demander le mot de passe au propriétaire.
- **Repos GitHub** :
  - `github.com/Entreprisesxpress/revetement-viking` (principal)
  - `github.com/revetementviking-spec/revetement-viking-app` (miroir déployé sur Vercel)

---

## 2. Stack technique

| Couche | Techno |
|---|---|
| Framework | Next.js 16.2.6 (App Router, React 19, TypeScript) |
| Base de données | Turso (libsql) — SQLite cloud, `@libsql/client` |
| Hébergement | Vercel (serverless, edge CDN) |
| PDF | `@react-pdf/renderer` (lazy-loaded) |
| Auth | Cookie HMAC-SHA256 (middleware.ts), pas de compte multi-utilisateur |
| Stockage fichiers | base64 dans Turso + sync Google Drive (OAuth) |
| Tests | Vitest (`npm test`) — 21 tests sur la logique paie/marge/dates |
| PWA | manifest + service worker (public/sw.js) |

---

## 3. Lancer en local

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # 21 tests unitaires (logique business)
npm run build      # vérifie la compilation production
```

Variables d'environnement (`.env.local`) :
```
APP_PASSWORD=...            # mot de passe d'accès
TURSO_URL=libsql://...      # base cloud (sinon SQLite local data/)
TURSO_AUTH_TOKEN=...
GOOGLE_OAUTH_CLIENT_ID=...  # optionnel (sync Drive)
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_DRIVE_FOLDER_ID=...
CRON_SECRET=...             # protège /api/backup (cron quotidien)
```

---

## 4. Architecture des fichiers

```
app/
  page.tsx                 # Dashboard (landing)
  soumissions/nouveau/     # Builder de soumission
  projets/[id]/            # Détail projet (heures grille, dépenses, factures, photos)
  heures/                  # Horaire — vue grille hebdo + liste, sélection multiple
  depenses/                # Dépenses — tri, filtres, édition, sélection multiple
  clients/[id]/            # CRM
  finances/  finances/paye # Finances + Paie (talons PDF)
  soumission/[numero]/     # ★ Page PUBLIQUE de signature client (token HMAC)
  admin/journal            # Journal d'activité (audit trail)
  admin/diagnostic         # État système + validation backup
  api/*                    # ~25 routes API
lib/
  db.ts                    # Toute la couche données (migrations idempotentes)
  calculs.ts               # ★ Logique métier PURE (marge, paie, dates) — TESTÉE
  calculs.test.ts          # 13 tests
  divers.test.ts           # 8 tests (csv, dates, tokens)
  audit.ts                 # Journal d'activité
  date.ts                  # Helpers timezone Montréal (anti-bug UTC)
  drive.ts / asana.ts      # Intégrations
  pdf-*.tsx                # Générateurs PDF
middleware.ts              # Auth + security headers + routes publiques
```

---

## 5. Modèle de sécurité

- Cookie `xpress_auth` = HMAC-SHA256 du mot de passe (jamais le password en clair).
- Headers OWASP : HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy.
- Rate-limiting sur `/api/login` et `/api/log-erreur`.
- Validation serveur des entrées heures (date ISO, heures 0-24).
- Pages publiques (`/soumission/[numero]`, `/api/soumission-publique`) : sécurisées par **token HMAC** dans l'URL — le numéro seul ne donne pas accès (anti-énumération). L'API publique ne renvoie JAMAIS les coûts/marges internes.
- Audit trail complet (`journal_activite`) : qui/quand/quoi/IP sur soumissions, heures, clients, dépenses.

---

## 6. Points connus à auditer / améliorer (suggestions)

**Performance**
- Photos & reçus stockés en **base64 dans Turso** → lecture lourde. Servies via `/api/photos/[id]` et `/api/depenses/[id]/recu` (binaire + cache 30j immutable). Piste : vraies vignettes (sharp / resize) pour les grilles.
- Pas encore de pagination sur les très longues listes (LIMIT 500).
- Bundle : `@react-pdf/renderer` lazy-loadé ✓.

**Fonctionnel**
- Mono-utilisateur (pas d'isolation multi-compte) — bloquant si on veut en faire un SaaS.
- Pas de paiements intégrés (Stripe).
- Factures : pas de calcul TPS/TVQ automatique sur les factures de projet (le builder de soumission le fait).
- Couverture de tests : logique pure couverte ; routes API non couvertes (pas de tests d'intégration).

**Données**
- Turso single-region. Backups quotidiens auto vers Drive (`/api/backup`, cron 8h UTC).

---

## 7. Comment tester un flux complet

1. Login (cookie) → dashboard.
2. Créer une soumission → bouton "🔗 Lien client" → ouvrir le lien en navigation privée → signer → vérifier statut "acceptée" + trace dans `/admin/journal`.
3. Créer un projet → onglet Heures → saisir des heures sur plusieurs jours → vérifier la grille hebdo (Lun-Dim) + le total.
4. Ajouter une dépense → vérifier que la marge du projet baisse (`/api/projets?id=X`).
5. Finances → vérifier le flux mensuel (revenus reconnus = contrat ou facturé).
6. Paie → bouton "📄 Talon" → PDF par employé.

`npm test` doit afficher **21/21 ✓**.
