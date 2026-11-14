import { describe, expect, it } from "vitest";
import { montarResumo, pendencias } from "@dominio/calculo.ts";
import { formatarReais, interpretarReais } from "@dominio/dinheiro.ts";
import type { Forma, Lancamento, Valores } from "@dominio/tipos.ts";

const centavos = (t: string) => {
  const r = interpretarReais(t);
  return r.ok ? r.centavos : null;
};

describe("valores em reais", () => {
  it("aceita 12, 12,50 e 12.50 de forma previsível", () => {
    expect(centavos("12")).toBe(1200);
    expect(centavos("12,50")).toBe(1250);
    expect(centavos("12.50")).toBe(1250);
    expect(centavos("12,5")).toBe(1250);
    expect(centavos(" R$ 1.234,56 ")).toBe(123456);
    expect(centavos("1,234.56")).toBe(123456);
    expect(centavos("0")).toBe(0);
    expect(centavos("0,07")).toBe(7);
  });

  it("rejeita entradas ambíguas ou inválidas", () => {
    for (const t of ["", "  ", "1.234", "1,234", "12,345", "1.2.3", "12,", ",50", "abc", "12a", "-5", "1e3", "Infinity", "NaN", "12,50,10", "99999999999"]) {
      expect(centavos(t), t).toBeNull();
    }
  });

  it("formata em reais", () => {
    expect(formatarReais(0)).toBe("R$ 0,00");
    expect(formatarReais(70000)).toBe("R$ 700,00");
    expect(formatarReais(123456789)).toBe("R$ 1.234.567,89");
    expect(formatarReais(-5005)).toBe("-R$ 50,05");
  });
});

const FORMAS: Forma[] = [
  { formaId: "credito", nome: "Crédito", ordem: 1, ativa: true },
  { formaId: "pix", nome: "Pix", ordem: 2, ativa: true },
  { formaId: "cheque", nome: "Cheque", ordem: 3, ativa: false },
];
let n = 0;
const l = (formaId: string | null, valorCentavos: number): Lancamento => ({
  id: `l${++n}`.padEnd(8, "0"),
  formaId,
  tipo: formaId ? "pagamento" : "dinheiro_contado",
  valorCentavos,
});
const valores = (extra: Partial<Valores> = {}): Valores => ({
  aberturaCentavos: 20000,
  houveSangria: true,
  sangriaCentavos: 5000,
  lancamentos: [l(null, 85000)],
  ...extra,
});

describe("cálculo fiel à planilha P. CAIXA (regra v1)", () => {
  it("T03 — abertura 200, contado 850, sangria 50 → dinheiro a lançar 700", () => {
    const r = montarResumo(valores(), FORMAS);
    expect(r.dinheiroContadoCentavos).toBe(85000);
    expect(r.ajusteCentavos).toBe(15000);
    expect(r.dinheiroLancarCentavos).toBe(70000);
    expect(r.totalLancarCentavos).toBe(70000);
  });

  it("T01 — soma lançamentos por forma; total = formas + dinheiro a lançar (nunca o contado)", () => {
    const r = montarResumo(valores({ lancamentos: [l("credito", 12000), l("credito", 3500), l("pix", 1000), l(null, 85000)] }), FORMAS);
    expect(r.formas.map((f) => [f.nome, f.subtotalCentavos])).toEqual([["Crédito", 15500], ["Pix", 1000]]);
    expect(r.totalPagamentosCentavos).toBe(16500);
    expect(r.totalLancarCentavos).toBe(16500 + 70000);
  });

  it("forma sem lançamento vale R$ 0,00; forma inativa só aparece se tiver lançamento", () => {
    expect(montarResumo(valores(), FORMAS).formas.map((f) => f.subtotalCentavos)).toEqual([0, 0]);
    const r = montarResumo(valores({ lancamentos: [l("cheque", 900)] }), FORMAS);
    expect(r.formas.map((f) => f.nome)).toEqual(["Crédito", "Pix", "Cheque"]);
  });

  it("sem sangria, o valor digitado antes é ignorado", () => {
    const r = montarResumo(valores({ houveSangria: false, sangriaCentavos: 5000 }), FORMAS);
    expect(r.sangriaCentavos).toBe(0);
    expect(r.dinheiroLancarCentavos).toBe(65000);
  });

  it("T04 — resultado negativo vira pendência, nunca zero silencioso", () => {
    const v = valores({ lancamentos: [l(null, 10000)] });
    const r = montarResumo(v, FORMAS);
    expect(r.dinheiroLancarCentavos).toBe(-5000);
    expect(pendencias(v, r).join(" ")).toContain("negativo");
  });

  it("aponta abertura e sangria não informadas", () => {
    const v = valores({ aberturaCentavos: null, houveSangria: null });
    expect(pendencias(v, montarResumo(v, FORMAS))).toHaveLength(2);
    const semValor = valores({ sangriaCentavos: 0 });
    expect(pendencias(semValor, montarResumo(semValor, FORMAS))).toHaveLength(1);
    expect(pendencias(valores(), montarResumo(valores(), FORMAS))).toEqual([]);
  });
});
