/**
 * Unidades Federativas do Brasil — fonte única para o frontend.
 * Espelho de `server/brazilianStates.ts` (sincronizado manualmente).
 */

export const STATE_NAMES: Record<string, string> = {
  AC: "Acre",
  AL: "Alagoas",
  AP: "Amapá",
  AM: "Amazonas",
  BA: "Bahia",
  CE: "Ceará",
  DF: "Distrito Federal",
  ES: "Espírito Santo",
  GO: "Goiás",
  MA: "Maranhão",
  MT: "Mato Grosso",
  MS: "Mato Grosso do Sul",
  MG: "Minas Gerais",
  PA: "Pará",
  PB: "Paraíba",
  PR: "Paraná",
  PE: "Pernambuco",
  PI: "Piauí",
  RJ: "Rio de Janeiro",
  RN: "Rio Grande do Norte",
  RS: "Rio Grande do Sul",
  RO: "Rondônia",
  RR: "Roraima",
  SC: "Santa Catarina",
  SP: "São Paulo",
  SE: "Sergipe",
  TO: "Tocantins",
};

export const STATES: readonly string[] = Object.keys(STATE_NAMES);

/** Converte uma sigla (UF) em nome completo. Retorna o input se já for nome completo. */
export function getStateName(uf: string): string {
  if (!uf) return "";
  const upper = uf.trim().toUpperCase();
  if (STATE_NAMES[upper]) return STATE_NAMES[upper];
  return uf;
}
