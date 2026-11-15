// Regra de cálculo v1 — reproduz a cadeia de fórmulas da aba P. CAIXA:
//   O11 = soma da coluna DINHEIRO            → dinheiro da gaveta
//   O14 = ABERTURA − SANGRIA TROCO           → ajuste
//   I16 = O11 − O14  ("VALOR DO CAIXA")      → dinheiro a lançar
// Qualquer mudança aqui exige nova versão documentada da regra (v2) e testes,
// preservando os fechamentos já finalizados, que guardam o próprio retrato.
import { formatarReais } from "./dinheiro.ts";
import type { Forma, Resumo, SituacaoAbertura, Valores } from "./tipos.ts";

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

/** Tamanho mínimo da observação que explica uma abertura com divergência. */
export const MIN_OBSERVACAO_DIVERGENCIA = 5;

/**
 * O que ainda impede a finalização. Lista vazia = pode finalizar.
 * `abertura` traz a conferência da abertura e a observação: valor esperado ainda não conferido
 * e divergência sem explicação também impedem.
 */
export function pendencias(v: Valores, r: Resumo, abertura?: { situacao: SituacaoAbertura; observacao: string }): string[] {
  const p: string[] = [];
  if (abertura?.situacao === "pendente") {
    p.push("Confira a abertura do caixa na etapa Abertura. Se a pergunta não aparecer, atualize a página.");
  } else if (v.aberturaCentavos === null) p.push("Informe o valor de abertura do caixa.");
  if (abertura?.situacao === "divergente" && abertura.observacao.trim().length < MIN_OBSERVACAO_DIVERGENCIA) {
    p.push("Abertura com divergência: escreva na observação o que aconteceu.");
  }
  if (v.houveSangria === null) p.push("Informe se houve sangria de troco.");
  if (v.houveSangria === true && v.sangriaCentavos <= 0) p.push("Informe o valor da sangria de troco.");
  if (v.aberturaCentavos !== null && r.dinheiroLancarCentavos < 0) {
    p.push(
      `O dinheiro a lançar ficou negativo (${formatarReais(r.dinheiroLancarCentavos)}). ` +
        "O dinheiro da gaveta é menor que a abertura menos a sangria. Confira a abertura, a sangria e o dinheiro da gaveta.",
    );
  }
  return p;
}

/**
 * Quais itens mudaram entre dois resultados. Não calcula nada: só compara.
 * Chaves: `forma:<id>`, `abertura`, `sangria`, `dinheiroContado`, `dinheiroLancar`, `total`, `observacao`.
 */
export function diferencas(antes: Resumo & { observacao?: string }, depois: Resumo & { observacao?: string }): string[] {
  const d: string[] = [];
  const lista = (r: Resumo, id: string) => JSON.stringify(r.formas.find((f) => f.formaId === id)?.lancamentos ?? []);
  for (const id of new Set([...antes.formas, ...depois.formas].map((f) => f.formaId))) {
    if (lista(antes, id) !== lista(depois, id)) d.push(`forma:${id}`);
  }
  if (antes.aberturaCentavos !== depois.aberturaCentavos) d.push("abertura");
  if (antes.sangriaCentavos !== depois.sangriaCentavos) d.push("sangria");
  if (JSON.stringify(antes.dinheiroContado) !== JSON.stringify(depois.dinheiroContado)) d.push("dinheiroContado");
  if (antes.dinheiroLancarCentavos !== depois.dinheiroLancarCentavos) d.push("dinheiroLancar");
  if (antes.totalLancarCentavos !== depois.totalLancarCentavos) d.push("total");
  if ((antes.observacao ?? "") !== (depois.observacao ?? "")) d.push("observacao");
  return d;
}
