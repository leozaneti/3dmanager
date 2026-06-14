export function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function mapStatus(status: string, description: string, map: Map<string, number>, defaultId: number): number {
  const combined = normalize(`${status} ${description}`);
  if (combined.includes("devolvido") || combined.includes("devolucao")) {
    return map.get("devolvido") ?? defaultId;
  }
  if (combined.includes("cancelado") || combined.includes("cancelada")) {
    return map.get("cancelado") ?? defaultId;
  }
  if (combined.includes("entregue")) {
    return map.get("entregue") ?? defaultId;
  }
  if (combined.includes("enviado") || combined.includes("a caminho") || combined.includes("tentaremos") || combined.includes("nao") && combined.includes("entrega")) {
    return map.get("enviado") ?? defaultId;
  }
  if (combined.includes("produção") || combined.includes("producao") || combined.includes("preparando")) {
    return map.get("novo") ?? defaultId;
  }
  return defaultId;
}
