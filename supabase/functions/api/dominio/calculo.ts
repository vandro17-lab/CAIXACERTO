// Regra de cálculo v1 — reproduz a cadeia de fórmulas da aba P. CAIXA:
//   O11 = soma da coluna DINHEIRO            → dinheiro contado
//   O14 = ABERTURA − SANGRIA TROCO           → ajuste
//   I16 = O11 − O14  ("VALOR DO CAIXA")      → dinheiro a lançar
// Qualquer mudança aqui exige nova versão documentada da regra (v2) e testes,
// preservando os fechamentos já finalizados, que guardam o próprio retrato.
import { formatarReais } from "./dinheiro.ts";
import type { Forma, Resumo, Valores } from "./tipos.ts";

export const REGRA_CALCULO = "v1" as const;

const soma = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

/**
 * Calcula subtotais, dinheiro a lançar e total a lançar.
 * Entram no resumo as formas ativas (mesmo zeradas) e as inativas que tenham lançamentos.
 */
export function montarResumo(v: Valores, formas: Forma[]): Resumo {
  const porForma = new Map<string, number[]>();
  const dinheiroContado: number[] = [];
  for (const l of v.lancamentos) {
    if (l.tipo === "dinheiro_contado") dinheiroContado.push(l.valorCentavos);
    else if (l.formaId) porForma.set(l.formaId, [...(porForma.get(l.formaId) ?? []), l.valorCentavos]);
  }
  const resumoFormas = [...formas]
    .sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome))
    .filter((f) => f.ativa || porForma.has(f.formaId))
    .map((f) => {
      const lancamentos = porForma.get(f.formaId) ?? [];
      return { formaId: f.formaId, nome: f.nome, subtotalCentavos: soma(lancamentos), lancamentos };
    });

  const aberturaCentavos = v.aberturaCentavos ?? 0;
  const sangriaCentavos = v.houveSangria ? v.sangriaCentavos : 0;
  const dinheiroContadoCentavos = soma(dinheiroContado);
  const ajusteCentavos = aberturaCentavos - sangriaCentavos;
  const dinheiroLancarCentavos = dinheiroContadoCentavos - ajusteCentavos;
  const totalPagamentosCentavos = soma(resumoFormas.map((f) => f.subtotalCentavos));
  return {
    formas: resumoFormas,
    dinheiroContado,
    dinheiroContadoCentavos,
    aberturaCentavos,
    sangriaCentavos,
    ajusteCentavos,
    dinheiroLancarCentavos,
    totalPagamentosCentavos,
    totalLancarCentavos: totalPagamentosCentavos + dinheiroLancarCentavos,
  };
}

/** O que ainda impede a finalização. Lista vazia = pode finalizar. */
export function pendencias(v: Valores, r: Resumo): string[] {
  const p: string[] = [];
  if (v.aberturaCentavos === null) p.push("Informe o valor de abertura do caixa.");
  if (v.houveSangria === null) p.push("Informe se houve sangria de troco.");
  if (v.houveSangria === true && v.sangriaCentavos <= 0) p.push("Informe o valor da sangria de troco.");
  if (v.aberturaCentavos !== null && r.dinheiroLancarCentavos < 0) {
    p.push(
      `O dinheiro a lançar ficou negativo (${formatarReais(r.dinheiroLancarCentavos)}). ` +
        "O dinheiro contado é menor que a abertura menos a sangria. Confira a abertura, a sangria e o dinheiro contado.",
    );
  }
  return p;
}
