/**
 * Modeles de relance par defaut.
 *
 * Paliers : J+7 rappel aimable, J+15 relance ferme, J+30 mise en demeure
 * (avec les mentions legales d'indemnite de 40 EUR et penalites de retard).
 * Les textes restent entierement editables depuis Reglages.
 */
export type ReminderTemplate = {
  level: number;
  label: string;
  delay_days: number;
  tone: "rappel" | "mise_en_demeure" | "contentieux";
  subject: string;
  body: string;
};

export const DEFAULT_REMINDER_TEMPLATES: ReminderTemplate[] = [
  {
    level: 1,
    label: "Rappel aimable (J+7)",
    delay_days: 7,
    tone: "rappel",
    subject: "Rappel : facture {numero} en attente de règlement",
    body: `Bonjour {client},

Sauf erreur de notre part, la facture {numero} d'un montant de {montant}, arrivée à échéance le {echeance}, demeure impayée.

Nous vous remercions de bien vouloir procéder à son règlement de {reste} dans les meilleurs délais.

Si le règlement a déjà été effectué, merci de ne pas tenir compte de ce message.

Bien cordialement,
{entreprise}
{telephone}
{email}`,
  },
  {
    level: 2,
    label: "Relance ferme (J+15)",
    delay_days: 15,
    tone: "rappel",
    subject: "Relance : facture {numero} toujours impayée",
    body: `Bonjour {client},

Malgré notre précédent rappel, la facture {numero} reste impayée à ce jour. Le solde restant dû s'élève à {reste}.

Nous vous invitons à régulariser cette situation sous huit jours, par virement sur le compte suivant :

IBAN : {iban}

À défaut de règlement, nous serions contraints d'engager la procédure de recouvrement, ce qui entraînerait l'application des pénalités de retard prévues ({penalites}) ainsi que l'indemnité forfaitaire pour frais de recouvrement de {indemnite}.

Cordialement,
{entreprise}
{telephone}
{email}`,
  },
  {
    level: 3,
    label: "Mise en demeure (J+30)",
    delay_days: 30,
    tone: "mise_en_demeure",
    subject: "MISE EN DEMEURE DE PAYER - Facture {numero}",
    body: `Madame, Monsieur,

Par la présente, nous vous mettons en demeure de procéder au règlement de la facture {numero}, échue le {echeance}, d'un montant restant dû de {reste}.

Ce courrier constitue une mise en demeure au sens de l'article 1231-6 du Code civil. À défaut de règlement sous huit jours, la recouvrance de cette créance sera confiée à notre conseil et la juridiction compétente sera saisie.

Les pénalités de retard ({penalites}) ainsi que l'indemnité forfaitaire pour frais de recouvrement de {indemnite} restent dues.

Cordialement,
{entreprise} — SIRET {siret}
{telephone}
{email}`,
  },
];