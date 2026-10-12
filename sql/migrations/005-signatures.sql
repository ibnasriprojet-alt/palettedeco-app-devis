-- Signataires reutilisables (patron, couturiere, ...) et signature des devis.
-- 100% additif : ne supprime ni ne modifie aucune donnee existante.

CREATE TABLE IF NOT EXISTS signatories (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT DEFAULT '',
  image TEXT DEFAULT '',
  active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Signature d'un devis : coche, date, liste des signataires (instantane {id,name,role,image})
-- et mention editable affichee sur le document.
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signed BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signed_at TIMESTAMPTZ;
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signed_by JSONB NOT NULL DEFAULT '[]';
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS signature_mention TEXT DEFAULT '';
