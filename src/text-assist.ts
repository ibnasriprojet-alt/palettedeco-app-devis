/**
 * Assistant de redaction des descriptifs de devis.
 *
 * Moteur "maison" : aucune dependance externe, aucun appel reseau, aucune
 * donnee qui sort de l'application. Il combine trois etages :
 *
 *   1. Memoire apprise  : les paires avant -> apres que l'artisan a VALIDEES
 *      (table correction_learnings). Priorite maximale : c'est sa facon de
 *      parler qui est reproduite.
 *   2. Dictionnaire     : fautes de frappe et mots mal orthographies frequents.
 *   3. Regles           : ponctuation, majuscules, espaces insecables,
 *      normalisation des unites et des mesures du bois/deco.
 *
 * Le resultat est toujours propose a l'utilisateur, jamais applique seul.
 */

/* ---------- Atelier 1 : le dictionnaire ---------- */

/* Cles TOUJOURS en minuscules, valeurs avec la casse correcte. Le remplacement
   teste la casse du mot d'origine (MAJUSCULES / Capitale / minuscule). */
const DICTIONARY: Record<string, string> = {
  /* Fautes de frappe : le bois et la palette */
  boi: "bois", boix: "bois", boixs: "bois", boiss: "bois", boiis: "bois",
  pall: "palette", pallete: "palette", palaette: "palette", palete: "palette",
  planche: "planche", planchhes: "planches", planches: "planches",
  contreplaque: "contreplaqué", "contre-plaque": "contreplaqué",
  medium: "MDF", agglo: "aggloméré", agglomere: "aggloméré",
  chene: "chêne", hetre: "hêtre", noisetier: "noisetier",
  /* Dimensions et mesures */
  dimenssions: "dimensions", dimentions: "dimensions", dimention: "dimension",
  hauter: "hauteur", hauteure: "hauteur", hauteur: "hauteur",
  largeure: "largeur", longueure: "longueur", profondeure: "profondeur",
  epaisseure: "épaisseur", epaisseur: "épaisseur", epaisse: "épaisse",
  epais: "épais", epaisseurs: "épaisseurs",
  /* Verbes et noms de metier */
  realiser: "réaliser", realisation: "réalisation", realise: "réalisé",
  realises: "réalisés", realisee: "réalisée",
  revetement: "revêtement", revetements: "revêtements",
  structurre: "structure", assemblag: "assemblage",
  fabriquation: "fabrication", traittement: "traitement",
  proctection: "protection", finission: "finition",
  contenace: "contenance", rangemant: "rangement",
  livrasion: "livraison", instalation: "installation", montag: "montage",
  qualite: "qualité", qualites: "qualités",
  possibilite: "possibilité", possibilites: "possibilités",
  personnalise: "personnalisé", personnalisee: "personnalisée",
  customisation: "personnalisation",
  /* Accents manquants tres frequents */
  equilibre: "équilibre", equilibree: "équilibrée",
  tres: "très", deja: "déjà", apres: "après", arriere: "arrière",
  derriere: "derrière", etage: "étage", etages: "étages",
  complete: "complète", completer: "compléter",
  unite: "unité", unites: "unités", integre: "intégré", integree: "intégrée",
  electricite: "électricité", lumiere: "lumière", lumieres: "lumières",
  interieur: "intérieur", interieure: "intérieure",
  exterieur: "extérieur", exterieure: "extérieure",
  reglable: "réglable", reglage: "réglage", regler: "régler",
  etirable: "étirable", etroite: "étroite",
  premiere: "première", derniere: "dernière",
  necessaire: "nécessaire", necessite: "nécessite",
  different: "différent", differents: "différents", differente: "différente",
  special: "spécial", speciale: "spéciale", speciaux: "spéciaux",
  facon: "façon", facade: "façade", facades: "façades",
  reception: "réception", receptionne: "réceptionné",
  prevoir: "prévoir", prevu: "prévu", prevue: "prévue",
  reservation: "réservation", reserver: "réserver",
  /* Mobilier */
  etagere: "étagère", etageres: "étagères",
  comode: "commode", armoir: "armoire", armoirs: "armoires",
  tabble: "table", chaisse: "chaise", litt: "lit", cadrre: "cadre",
  patere: "patère", mirroir: "miroir", chevets: "chevets",
  "tete de lit": "tête de lit", "meuble tele": "meuble TV", "meuble tv": "meuble TV",
  bibliotheque: "bibliothèque", bibliotheques: "bibliothèques",
  entree: "entrée", vestiaire: "vestiaire",
  "porte manteau": "porte-manteau", "porte-manteaux": "porte-manteaux",
  /* Materiaux et finitions */
  huilee: "huilée", huile: "huile", lasure: "lasure",
  brillante: "brillante", mat: "mat", mate: "mate",
  metal: "métal", metallique: "métallique", metalliques: "métalliques",
  "fer forge": "fer forgé", acier: "acier", laiton: "laiton",
  verriere: "verrière", ceramique: "céramique", velours: "velours",
  rembourre: "rembourré", rembourree: "rembourrée",
  poignee: "poignée", poignees: "poignées",
  charniere: "charnière", charnieres: "charnières",
  cremaillere: "crémaillère", cremailleres: "crémaillères",
  reglette: "réglette", reglettes: "réglettes",
  glissiere: "glissière", glissieres: "glissières",
  equipement: "équipement", plaque: "plaque",
  /* Traitements */
  fongicide: "fongicide", insecticide: "insecticide", xylophene: "xylophène",
  "anti humidite": "anti-humidité", "anti-humidite": "anti-humidité",
  "sous couche": "sous-couche", poncage: "ponçage",
  ponce: "poncé", poncee: "poncée", recycle: "recyclé", recyclee: "recyclée",
  ecologique: "écologique", "eco-responsable": "éco-responsable",
  /* Abreviations */
  approx: "environ", environs: "environ", cad: "c'est-à-dire",
  cest: "c'est", svp: "s'il vous plaît", stp: "s'il te plaît",
  "peut-etre": "peut-être", peutetre: "peut-être",
  "sur mesure": "sur-mesure", surmesure: "sur-mesure",
  surdemande: "sur demande", faitmain: "fait main",
  /* Divers */
  opiton: "option", delait: "délai", colori: "coloris",
  chantiers: "chantiers", travau: "travaux", traveaux: "travaux",
  plusieur: "plusieurs", plusieures: "plusieurs", quelqu: "quelques",
  toujour: "toujours", toutjour: "toujours", jamai: "jamais",
  enfait: "en fait", biensure: "bien sûr", biensur: "bien sûr",
  malgres: "malgré", parmi: "parmi", emploi: "emploi",
};

/* ---------- Atelier 2 : les regles ---------- */

/* Espaces insecables avant la ponctuation double (regle typographique FR).
   On n'insere jamais un espace normal : on utilise U+00A0. */
const NBSP = "\u00A0";

const PROTECTED = /(https?:\/\/[^\s]+|[\w.+-]+@[\w.-]+\.\w+)/g;

/* Remplace les jetons proteges (URL, e-mail) par des marqueurs neutres le temps
   des corrections, puis les restaure. Sans cela les regles de ponctuation
   abiment les adresses (@, points, ://). */
function protect(text: string): { masked: string; tokens: string[] } {
  const tokens: string[] = [];
  const masked = text.replace(PROTECTED, (m) => {
    tokens.push(m);
    return `\uE000${tokens.length - 1}\uE001`;
  });
  return { masked, tokens };
}
function restore(text: string, tokens: string[]): string {
  return text.replace(/\uE000(\d+)\uE001/g, (_m, i) => tokens[Number(i)] ?? "");
}

function matchCase(source: string, replacement: string): string {
  if (source === source.toUpperCase() && source.toLowerCase() !== source) {
    return replacement.toUpperCase();
  }
  if (source[0] === source[0]?.toUpperCase() && source[0] !== source[0]?.toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

/* --- etage 1 : memoire apprise --- */
function applyLearnings(text: string, learnings: Array<{ from_text: string; to_text: string }>): string {
  let out = text;
  for (const l of learnings) {
    const from = String(l.from_text || "").trim();
    const to = String(l.to_text || "").trim();
    if (from.length < 3 || !to || from === to) continue;
    const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, "giu"), (match) => matchCase(match, to));
  }
  return out;
}

/* --- etage 2 : dictionnaire --- */
/* Les entrees multi-mots (ex. "meuble tele") sont traitees d'abord, des plus
   longues aux plus courtes, puis les mots seuls. */
const MULTI_WORDS = Object.keys(DICTIONARY)
  .filter((k) => k.includes(" "))
  .sort((a, b) => b.length - a.length);

function applyDictionary(text: string): string {
  let out = text;
  for (const key of MULTI_WORDS) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+");
    out = out.replace(new RegExp(`(?<!\\p{L})${escaped}(?!\\p{L})`, "giu"), (m) => matchCase(m, DICTIONARY[key]));
  }
  return out.replace(/\p{L}[\p{L}-]*/gu, (word) => {
    const key = word.toLowerCase();
    const fix = DICTIONARY[key];
    if (!fix || fix === word) return word;
    return matchCase(word, fix);
  });
}

/* --- etage 3 : regles de ponctuation / espaces / unites --- */
function applyRules(text: string): string {
  let out = text;

  /* Multi-espaces -> un seul */
  out = out.replace(/[ \t]{2,}/g, " ");
  /* Espace avant la ponctuation : on la retire */
  out = out.replace(/\s+([,.;…])/g, "$1");
  /* Ponctuation double : espace insecable AVANT, si absent */
  out = out.replace(/\s*([:;!?])/g, `${NBSP}$1`);
  /* Guillemets francais */
  out = out.replace(/"([^"]*)"/g, `«${NBSP}$1${NBSP}»`);
  /* Espace apres ponctuation, jamais avant le dernier caractere */
  out = out.replace(/([,.;:!?])(?=[\p{L}\p{N}])/gu, "$1 ");

  /* Unites et mesures */
  out = out.replace(/(\d)\s?(cm|mm|m|kg|g|ml|cl|l)(?![a-z])/gi, (_m, n, u) => `${n}\u00A0${String(u).toLowerCase()}`);
  out = out.replace(/(\d)\s?[xX]\s?(\d)/g, (_m, a, b) => `${a}\u00A0×\u00A0${b}`);
  out = out.replace(/(\d)\s?(m2|m²)/gi, (_m, n) => `${n}\u00A0m²`);
  out = out.replace(/(\d)\s?%/g, (_m, n) => `${n}\u00A0%`);
  out = out.replace(/€\s*(\d)/g, "$1\u00A0€");
  out = out.replace(/(\d)\s?€/g, "$1\u00A0€");
  out = out.replace(/(\d)\s?h(\d)/gi, (_m, a, b) => `${a}\u00A0h${b}`);

  /* Majuscule apres ponctuation forte et en debut de ligne */
  out = out.replace(/(^|[.!?]\s+|\n\s*)(\p{Ll})/gu, (_m, p, ch) => p + ch.toUpperCase());
  /* Debut de texte : majuscule */
  out = out.replace(/^(\s*)(\p{Ll})/u, (_m, s, ch) => s + ch.toUpperCase());

  /* Nettoyage final des espaces avant retour a la ligne */
  out = out.replace(/[ \t]+\n/g, "\n");
  return out;
}

export type AssistResult = {
  original: string;
  suggestion: string;
  changes: boolean;
};

/**
 * Corrige un descriptif de devis. `learnings` provient de la memoire apprise
 * (peut etre vide). Aucun effet de bord : la fonction est pure.
 */
export function rewrite(
  input: string,
  learnings: Array<{ from_text: string; to_text: string }> = [],
): AssistResult {
  const original = String(input ?? "");
  if (!original.trim()) return { original, suggestion: original, changes: false };

  const { masked, tokens } = protect(original);
  let out = applyLearnings(masked, learnings);
  out = applyDictionary(out);
  out = applyRules(out);
  /* Fin de texte : point si la phrase n'a pas de ponctuation finale, une fois
     seulement et hors jeton protege. */
  out = out.replace(/([\p{L}\p{N}])(\s*)$/u, "$1.$2");
  out = out.replace(/\s+$/, "");
  const suggestion = restore(out, tokens);
  return { original, suggestion, changes: suggestion !== original };
}

/**
 * Extrait les paires avant -> apres a partir d'un avant/arriere valide.
 * On aligne les deux suites de mots ; seules les positions ou le mot change
 * produisent une paire (correction ciblee, pas de bruit combinatoire).
 */
export function learningPairs(
  before: string,
  after: string,
  limit = 400,
): Array<{ from_text: string; to_text: string }> {
  const norm = (t: string) =>
    String(t || "")
      .split(/\s+/)
      .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
      .filter(Boolean);
  const a = norm(before);
  const b = norm(after);
  if (!a.length || !b.length || a.length !== b.length) return [];

  const pairs: Array<{ from_text: string; to_text: string }> = [];
  const seen = new Set<string>();
  for (let i = 0; i < a.length && pairs.length < limit; i++) {
    const src = a[i].toLowerCase();
    const dst = b[i];
    if (src.length < 4 || src === dst.toLowerCase()) continue;
    if (Math.abs(src.length - dst.length) > Math.max(4, src.length)) continue;
    const key = `${src}\u0000${dst}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({ from_text: src, to_text: dst });
  }
  return pairs;
}
