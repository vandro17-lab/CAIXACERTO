// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConferenciaAbertura, Lancamento, Snapshot } from "@dominio/tipos.ts";
import type { CorpoAbertura } from "../src/api.ts";
import { ColunaLancamentos } from "../src/componentes/ColunaLancamentos.tsx";
import { EtapaAbertura } from "../src/componentes/ConferenciaAbertura.tsx";
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
      status: "finalizado" as const, versao: 1, quantidadeCorrecoes: 0, quantidadeEdicoesAdm: 0, criadoEm: "", finalizadoEm: "",
      formas: [{ formaId: "credito", nome: "Crédito", subtotalCentavos: 15500 }], dinheiroLancarCentavos: 70000, totalLancarCentavos: 85500,
      aberturaDivergente: null,
    };
    const rascunho = { ...item, id: "b", status: "rascunho" as const, formas: [], dinheiroLancarCentavos: null, totalLancarCentavos: null };
    const r = montarRelatorio([item, { ...item, id: "c" }, rascunho]);
    expect(r).toMatchObject({ quantidade: 2, dinheiro: 140000, total: 171000 });
    expect(r.formas).toEqual([{ nome: "Crédito", total: 31000 }]);
    const csv = montarCsv([item, rascunho]);
    expect(csv.split("\r\n")[1]).toBe('"14/11/2026";"Noite";"Vila Grill 1";"Maria";"Finalizado";"Não";"155,00";"700,00";"855,00";"Não"');
  });
});

describe("etapa de abertura", () => {
  const ESPERADO: ConferenciaAbertura = { situacao: "pendente", esperadoCentavos: 60000, origem: { dataLocal: "2026-11-14", turno: "manha" }, anteriorEmRascunho: false };
  const montar = (abertura: ConferenciaAbertura, valor: number | null = null, aoResponder = vi.fn(async (_: CorpoAbertura) => null as string | null)) => {
    const aoDigitar = vi.fn();
    render(<EtapaAbertura abertura={abertura} valor={valor} observacao="" tentou={false} aoDigitar={aoDigitar} aoObservar={() => {}} aoResponder={aoResponder} aoEnter={() => {}} />);
    return { aoResponder, aoDigitar };
  };

  it("com fechamento anterior, mostra o valor para conferir e não deixa digitar a abertura", async () => {
    const u = userEvent.setup();
    const { aoResponder } = montar(ESPERADO);
    expect(screen.getByText(/Confira se há/).textContent).toBe("Confira se há R$ 600,00 na gaveta");
    expect(screen.getByText(/14\/11\/2026 · Manhã/)).toBeTruthy();
    expect(screen.queryByLabelText("Valor de abertura")).toBeNull();
    await u.click(screen.getByRole("button", { name: "Sim" }));
    expect(aoResponder).toHaveBeenCalledWith({ confere: true, esperadoCentavos: 60000 });
  });

  it("Não: pede o valor encontrado e a senha do gerente (4 dígitos) antes de enviar", async () => {
    const u = userEvent.setup();
    const { aoResponder } = montar(ESPERADO);
    await u.click(screen.getByRole("button", { name: "Não" }));
    expect(screen.getByText(/Chame o gerente/)).toBeTruthy();
    await u.click(screen.getByRole("button", { name: /Liberar com a senha do gerente/ }));
    expect(aoResponder).not.toHaveBeenCalled();
    await u.type(screen.getByLabelText("Valor encontrado na gaveta"), "550");
    await u.type(screen.getByLabelText("Senha do gerente"), "12a345");
    expect((screen.getByLabelText("Senha do gerente") as HTMLInputElement).value).toBe("1234");
    await u.click(screen.getByRole("button", { name: /Liberar com a senha do gerente/ }));
    expect(aoResponder).toHaveBeenCalledWith({ confere: false, esperadoCentavos: 60000, valorCentavos: 55000, senhaGerente: "1234" });
  });

  it("mostra o erro do servidor (senha incorreta) e mantém o formulário aberto", async () => {
    const u = userEvent.setup();
    montar(ESPERADO, null, vi.fn(async () => "Senha do gerente incorreta."));
    await u.click(screen.getByRole("button", { name: "Não" }));
    await u.type(screen.getByLabelText("Valor encontrado na gaveta"), "550");
    await u.type(screen.getByLabelText("Senha do gerente"), "0000");
    await u.click(screen.getByRole("button", { name: /Liberar com a senha do gerente/ }));
    expect(screen.getByRole("alert").textContent).toContain("Senha do gerente incorreta.");
    expect(screen.getByLabelText("Senha do gerente")).toBeTruthy();
  });

  it("divergência: mostra esperado e encontrado e exige a observação", () => {
    montar({ ...ESPERADO, situacao: "divergente" }, 55000);
    expect(screen.getByText(/Abertura com divergência/)).toBeTruthy();
    expect(screen.getByText(/encontrado R\$ 550,00/)).toBeTruthy();
    expect(screen.getByLabelText(/Observação/)).toBeTruthy();
  });

  it("sem fechamento anterior, a abertura é digitada como antes", async () => {
    const u = userEvent.setup();
    const { aoDigitar } = montar({ situacao: "livre", esperadoCentavos: null, origem: null, anteriorEmRascunho: false });
    await u.type(screen.getByLabelText("Valor de abertura"), "200");
    expect(aoDigitar).toHaveBeenLastCalledWith(20000);
    expect(screen.queryByRole("button", { name: "Sim" })).toBeNull();
  });

  it("o resumo copiado leva a marca de abertura com divergência", () => {
    const texto = textoResumo({ ...SNAPSHOT, aberturaDivergente: { esperadoCentavos: 60000, encontradoCentavos: 20000 } }, true);
    expect(texto).toContain("Abertura com divergência: esperado R$ 600,00, encontrado R$ 200,00");
    expect(textoResumo(SNAPSHOT, true)).not.toContain("divergência");
  });
});
