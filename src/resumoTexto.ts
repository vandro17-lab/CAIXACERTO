import { formatarReais } from "@dominio/dinheiro.ts";
import { formatarData, NOME_TURNO } from "@dominio/tipos.ts";
import type { Snapshot } from "@dominio/tipos.ts";

/**
 * Texto do botão "Copiar resumo": a lista para lançar no sistema oficial.
 * A linha Dinheiro leva o valor CALCULADO, nunca o dinheiro contado.
 */
export function textoResumo(s: Snapshot, mostrarZerados: boolean): string {
  const formas = s.formas.filter((f) => mostrarZerados || f.subtotalCentavos !== 0);
  return [
    `FECHAMENTO DE CAIXA — ${s.lojaNome}`,
    `${formatarData(s.dataLocal)} · ${NOME_TURNO[s.turno]} · Responsável: ${s.responsavelNome}`,
    "",
    ...formas.map((f) => `${f.nome}: ${formatarReais(f.subtotalCentavos)}`),
    `Dinheiro: ${formatarReais(s.dinheiroLancarCentavos)}`,
    `TOTAL A LANÇAR: ${formatarReais(s.totalLancarCentavos)}`,
    ...(s.observacao ? ["", `Observação: ${s.observacao}`] : []),
    ...(s.versao > 1 ? ["", "(Fechamento corrigido uma vez)"] : []),
  ].join("\n");
}
