## Objectif de session
Finaliser le cockpit, valider le runtime, sécuriser les factures et préparer la voie Factur-X/PDF-A-3 sans déployer en production avant validation.

## Détail important
- Ne rien déployer en prod avant validation complète. Variables tests exclusivement depuis .env.dev.
- Mode Test obligatoire ; activation Réel uniquement via JE-CONFIRME-ENVOIS-REELS.
- Aucun navigateur/Playwright utilisé pour tests visuels (jsdom).

## Travaux réalisés

### Sauvegardes & état dev
- Script `scripts/backup-data.mjs` durci : restauration cible `.env.dev` par défaut, refuse la production sans `--prod`, note l'environnement cible, `ORDER BY id` pour un setval correct.
- État dev restauré depuis `backups/data/dev-avant-003-2026-10-01.sql` (4 devis, 6 lignes de devis, 7 clients, 1 commande/2 lignes). Séquences réalignées sur max(id). Nettoyage des clients de test résiduels.

### Factur-X / conformité
- `src/facturx.ts` : format UN/CEFACT 102 corrigé (`AAAAMMJJ`). Commentaire de cohérence ajouté.
- `scripts/test-facturx.ts` : fixture corrigée (totaux cohérents HT=3500/TVA=650/TTC=4150), assertions sur format 102 sans tirets, contrôles de cohérence (lignes/bases/ventilation = totaux, HT+TVA=TTC, payé+reste=TTC). **62/62** réussis.

### API / cockpit
- `scripts/test-cockpit.ts` : suivi complet des entités créées (`fxQuote2` ajouté aux createdQuoteIds), sauvegarde/restauration explicite des réglages société (patch partiel), nettoyage plus sûr. **85/85** réussis.
- Verrou `DELETE /api/invoices/:id` sur factures finalisées (409) déjà présent et validé.

### Frontend / UX
- Lien `/expenses/new` orphelin corrigé : Layout émet `open-expense-form`, page `Expenses` écoute l'événement, route dédiée `/expenses/new` ajoutée avec fermeture → `/expenses`. Typecheck frontend OK.
- Build Vite OK (avec `VITE_API_URL` prod).

### Qualité
- Typecheck backend TS : 0 erreur. Smoke JSDOM (app) : **46/46** OK. Scripts de tests : `test:facturx`, `test:api`, `test:ui` fonctionnels.

## État dev après restauration
- clients=7, quotes=4, quote_items=6, orders=1, order_items=2, invoices=0, payments=0, expenses=0, stock_movements=0, company=1, app_settings=1, credit_notes=0, credit_note_items=0, reminders=0, reminder_templates=3, bank_accounts=22, bank_transactions=0, counters=4.

## Reste à traiter (hors scope immédiat)
- PDF/A-3 : XMP généré mais embarquement complet (OutputIntent, ICC, validation veraPDF) non implémenté (bloqué validation externe). À ne pas déclarer PDF/A-3 conforme tant que non validé.
- Avoirs (CRUD/API/UI) partiellement présents en schéma, à compléter.
- Vérification visuelle réelle bloquée faute de navigateur.
