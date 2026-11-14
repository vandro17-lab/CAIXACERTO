// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { Lancamento, Snapshot } from "@dominio/tipos.ts";
import { ColunaLancamentos } from "../src/componentes/ColunaLancamentos.tsx";
import { montarCsv, montarRelatorio } from "../src/paginas/admin/Consultas.tsx";
import { textoResumo } from "../src/resumoTexto.ts";

afterEach(cleanup);

function Coluna() {
  const [itens, setItens] = useState<Lancamento[]>([]);
  return (
    <ColunaLancamentos
      titulo="Crédito"
      itens={itens}
      aoAdicionar={(valorCentavos) => setItens((ls) => [...ls, { id: `id-${ls.length}-0000`, formaId: "credito", tipo: "pagamento", valorCentavos }])}
      aoEditar={(id, valorCentavos) => setItens((ls) => ls.map((l) => (l.id === id ? { ...l, valorCentavos } : l)))}
      aoRemover={(id) => setItens((ls) => ls.filter((l) => l.id !== id))}
    />
  );
}

const entrada = () => screen.getByLabelText(/Novo lançamento em Crédito/);
const linhas = () => screen.queryAllByRole("button", { name: /Lançamento \d+ de Crédito/ });
const subtotal = () => screen.getByText(/Subtotal de Crédito/).parentElement!.textContent;

describe("coluna de lançamentos", () => {
  it("T01 — 120 Enter, 35 Enter: duas linhas, subtotal R$ 155,00 e foco na linha seguinte", async () => {
    const u = userEvent.setup();
    render(<Coluna />);
    await u.type(entrada(), "120{Enter}35{Enter}");
    expect(linhas()).toHaveLength(2);
    expect(subtotal()).toContain("R$ 155,00");
    expect(document.activeElement).toBe(entrada());
    expect((entrada() as HTMLInputElement).value).toBe("");
  });

  it("T02 — Enter de novo com o campo vazio não adiciona linha", async () => {
    const u = userEvent.setup();
    render(<Coluna />);
    await u.type(entrada(), "120{Enter}35{Enter}{Enter}{Enter}");
    expect(linhas()).toHaveLength(2);
  });

  it("rejeita valor inválido, ambíguo ou zero, sem criar linha", async () => {
    const u = userEvent.setup();
    render(<Coluna />);
    for (const texto of ["abc", "1.234", "-5", "0"]) {
      await u.clear(entrada());
      await u.type(entrada(), `${texto}{Enter}`);
      expect(screen.getByRole("alert")).toBeTruthy();
      expect(linhas()).toHaveLength(0);
    }
  });

  it("permite corrigir e remover uma linha", async () => {
    const u = userEvent.setup();
    render(<Coluna />);
    await u.type(entrada(), "12,50{Enter}7{Enter}");
    await u.click(linhas()[0]);
    const edicao = screen.getByLabelText(/Novo valor do lançamento 1/);
    await u.clear(edicao);
    await u.type(edicao, "20{Enter}");
    expect(subtotal()).toContain("R$ 27,00");
    await u.click(screen.getByRole("button", { name: /Remover lançamento 2/ }));
    expect(linhas()).toHaveLength(1);
    expect(subtotal()).toContain("R$ 20,00");
  });
});

const SNAPSHOT: Snapshot = {
  versao: 1,
  regra: "v1",
  lojaId: "vila-grill-1",
  lojaNome: "Vila Grill 1",
  dataLocal: "2026-11-14",
  turno: "noite",
  responsavelNome: "Maria",
  observacao: "",
  houveSangria: true,
  registradoEm: "2026-11-14T23:00:00.000Z",
  formas: [
    { formaId: "credito", nome: "Crédito", subtotalCentavos: 15500, lancamentos: [12000, 3500] },
    { formaId: "pix", nome: "Pix", subtotalCentavos: 0, lancamentos: [] },
  ],
  dinheiroContado: [85000],
  dinheiroContadoCentavos: 85000,
  aberturaCentavos: 20000,
  sangriaCentavos: 5000,
  ajusteCentavos: 15000,
  dinheiroLancarCentavos: 70000,
  totalPagamentosCentavos: 15500,
  totalLancarCentavos: 85500,
};

describe("resumo e relatórios", () => {
  it("T20 — o resumo copiado traz o Dinheiro calculado, nunca o contado", () => {
    const texto = textoResumo(SNAPSHOT, true);
    expect(texto).toContain("Dinheiro: R$ 700,00");
    expect(texto).toContain("TOTAL A LANÇAR: R$ 855,00");
    expect(texto).toContain("Pix: R$ 0,00");
    expect(texto).not.toContain("850");
    expect(textoResumo(SNAPSHOT, false)).not.toContain("Pix");
  });

  it("relatório e CSV somam por forma e por loja, só com finalizados", () => {
    const item = {
      id: "a", lojaId: "vila-grill-1", lojaNome: "Vila Grill 1", dataLocal: "2026-11-14", turno: "noite" as const, responsavelNome: "Maria",
      status: "finalizado" as const, versao: 1, quantidadeCorrecoes: 0, criadoEm: "", finalizadoEm: "",
      formas: [{ formaId: "credito", nome: "Crédito", subtotalCentavos: 15500 }], dinheiroLancarCentavos: 70000, totalLancarCentavos: 85500,
    };
    const rascunho = { ...item, id: "b", status: "rascunho" as const, formas: [], dinheiroLancarCentavos: null, totalLancarCentavos: null };
    const r = montarRelatorio([item, { ...item, id: "c" }, rascunho]);
    expect(r).toMatchObject({ quantidade: 2, dinheiro: 140000, total: 171000 });
    expect(r.formas).toEqual([{ nome: "Crédito", total: 31000 }]);
    const csv = montarCsv([item, rascunho]);
    expect(csv.split("\r\n")[1]).toBe('"14/11/2026";"Noite";"Vila Grill 1";"Maria";"Finalizado";"Não";"155,00";"700,00";"855,00"');
  });
});
