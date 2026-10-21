-- Assistant de redaction : memoire des corrections validees par l'utilisateur.
--
-- Chaque fois qu'une proposition de reformulation est ACCEPTEE, on enregistre
-- les mots qui ont change (avant -> apres). Le moteur les reapplique ensuite
-- en priorite, ce qui rend la correction de plus en plus proche du style de
-- l'artisan. 100% additif.

CREATE TABLE IF NOT EXISTS correction_learnings (
  id SERIAL PRIMARY KEY,
  from_text TEXT NOT NULL,
  to_text TEXT NOT NULL,
  hits INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Une seule ligne par paire : l'upsert incremente `hits`.
CREATE UNIQUE INDEX IF NOT EXISTS idx_correction_learnings_pair
  ON correction_learnings (lower(from_text), to_text);

CREATE INDEX IF NOT EXISTS idx_correction_learnings_hits
  ON correction_learnings (hits DESC);
