/**
 * Unidades Federativas do Brasil — fonte única para o backend.
 * O frontend consome a versão espelhada em `src/shared/brazilianStates.ts`
 * (sincronizada manualmente neste projeto; idealmente viraria um pacote).
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

/** Versão uppercase para uso em queries SQL (e comparação case-insensitive) */
export const STATE_NAMESUpper: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([uf, name]) => [uf.toUpperCase(), name.toUpperCase()]),
);

/** Converte uma sigla (UF) em nome completo. Retorna o input se já for nome completo. */
export function getStateName(uf: string): string {
  if (!uf) return "";
  const upper = uf.trim().toUpperCase();
  if (STATE_NAMES[upper]) return STATE_NAMES[upper];
  /* Aceita também nome completo (ex: "São Paulo" → "São Paulo") */
  const byUpperName = STATE_NAMESUpper[upper];
  return byUpperName ?? uf;
}

/** Converte nome completo (ou sigla) em sigla UF. Retorna "" se não reconhecido. */
export function getStateAbbreviation(name: string): string {
  if (!name) return "";
  const target = name.trim().toUpperCase();
  for (const [uf, fullName] of Object.entries(STATE_NAMES)) {
    if (fullName.toUpperCase() === target) return uf;
  }
  const upper = name.trim().toUpperCase();
  if (STATE_NAMES[upper]) return upper;
  return "";
}
