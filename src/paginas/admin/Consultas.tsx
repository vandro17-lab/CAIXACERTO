import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { formatarNumero, formatarReais } from "@dominio/dinheiro.ts";
import { formatarData, NOME_TURNO, TURNOS } from "@dominio/tipos.ts";
import type { ItemConsulta, Loja } from "@dominio/tipos.ts";
import { api, FalhaApi } from "../../api.ts";
import type { Filtros } from "../../api.ts";
import { MolduraAdm, useAdm } from "../../adm.tsx";
import { hojeLocal } from "../../componentes/FormIdentificacao.tsx";
import { Aviso, Carregando, Etiqueta } from "../../componentes/Moldura.tsx";

const filtrosIniciais = (): Filtros => ({
  loja: "",
  de: `${hojeLocal().slice(0, 8)}01`,
  ate: hojeLocal(),
  turno: "",
  responsavel: "",
  status: "",
  corrigido: "",
  ordem: "desc",
});

interface Relatorio {
  formas: { nome: string; total: number }[];
  lojas: { nome: string; total: number; quantidade: number }[];
  dinheiro: number;
  total: number;
  quantidade: number;
}

/** Totais por forma de pagamento e por loja, somente de fechamentos finalizados. */
export function montarRelatorio(itens: ItemConsulta[]): Relatorio {
  const formas = new Map<string, { nome: string; total: number }>();
  const lojas = new Map<string, { nome: string; total: number; quantidade: number }>();
  let dinheiro = 0;
  let total = 0;
  let quantidade = 0;
  for (const i of itens) {
    if (i.status !== "finalizado" || i.totalLancarCentavos === null) continue;
    quantidade += 1;
    dinheiro += i.dinheiroLancarCentavos ?? 0;
    total += i.totalLancarCentavos;
    for (const f of i.formas) {
      const a = formas.get(f.formaId) ?? { nome: f.nome, total: 0 };
      formas.set(f.formaId, { nome: a.nome, total: a.total + f.subtotalCentavos });
    }
    const l = lojas.get(i.lojaId) ?? { nome: i.lojaNome, total: 0, quantidade: 0 };
    lojas.set(i.lojaId, { nome: l.nome, total: l.total + i.totalLancarCentavos, quantidade: l.quantidade + 1 });
  }
  return { formas: [...formas.values()], lojas: [...lojas.values()], dinheiro, total, quantidade };
}

/** CSV com ponto e vírgula e valores em formato brasileiro, para abrir direto no Excel. */
export function montarCsv(itens: ItemConsulta[]): string {
  const formas = new Map<string, string>();
  for (const i of itens) for (const f of i.formas) if (!formas.has(f.formaId)) formas.set(f.formaId, f.nome);
  const celula = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const valor = (c: number | null | undefined) => (c == null ? "" : formatarNumero(c));
  const linhas = [
    ["Data", "Turno", "Loja", "Responsável", "Status", "Corrigido", ...formas.values(), "Dinheiro a lançar", "Total a lançar"],
    ...itens.map((i) => [
      formatarData(i.dataLocal),
      NOME_TURNO[i.turno],
      i.lojaNome,
      i.responsavelNome,
      i.status === "finalizado" ? "Finalizado" : "Rascunho",
      i.quantidadeCorrecoes > 0 ? "Sim" : "Não",
      ...[...formas.keys()].map((id) => valor(i.formas.find((f) => f.formaId === id)?.subtotalCentavos)),
      valor(i.dinheiroLancarCentavos),
      valor(i.totalLancarCentavos),
    ]),
  ];
  return "﻿" + linhas.map((l) => l.map(celula).join(";")).join("\r\n");
}

export function Consultas() {
  const { chamar } = useAdm();
  const [filtros, setFiltros] = useState(filtrosIniciais);
  const [lojas, setLojas] = useState<Loja[]>([]);
  const [resultado, setResultado] = useState<{ itens: ItemConsulta[]; truncado: boolean } | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [buscando, setBuscando] = useState(false);

  const buscar = useCallback(
    async (f: Filtros) => {
      setBuscando(true);
      setFalha(null);
      try {
        setResultado(await chamar((t) => api.adm.consultar(t, f)));
      } catch (e) {
        setFalha((e as FalhaApi).message);
      } finally {
        setBuscando(false);
      }
    },
    [chamar],
  );

  useEffect(() => {
    void buscar(filtrosIniciais());
    chamar((t) => api.adm.config(t)).then((c) => setLojas(c.lojas), () => {});
  }, [buscar, chamar]);

  const relatorio = useMemo(() => montarRelatorio(resultado?.itens ?? []), [resultado]);
  const mudar = (parte: Partial<Filtros>) => setFiltros((f) => ({ ...f, ...parte }));

  function exportar() {
    const url = URL.createObjectURL(new Blob([montarCsv(resultado?.itens ?? [])], { type: "text/csv;charset=utf-8" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `fechamentos-${filtros.de}-a-${filtros.ate}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <MolduraAdm>
      <h1>Consultas</h1>
      <form
        className="filtros nao-imprimir"
        onSubmit={(e) => {
          e.preventDefault();
          void buscar(filtros);
        }}
      >
        <label className="campo"><span className="campo-rotulo">Loja</span>
          <select className="entrada" value={filtros.loja} onChange={(e) => mudar({ loja: e.target.value })}>
            <option value="">Todas</option>
            {lojas.map((l) => <option key={l.lojaId} value={l.lojaId}>{l.nome}{l.ativa ? "" : " (desativada)"}</option>)}
          </select>
        </label>
        <label className="campo"><span className="campo-rotulo">De</span>
          <input className="entrada" type="date" value={filtros.de} onChange={(e) => mudar({ de: e.target.value })} />
        </label>
        <label className="campo"><span className="campo-rotulo">Até</span>
          <input className="entrada" type="date" value={filtros.ate} onChange={(e) => mudar({ ate: e.target.value })} />
        </label>
        <label className="campo"><span className="campo-rotulo">Turno</span>
          <select className="entrada" value={filtros.turno} onChange={(e) => mudar({ turno: e.target.value })}>
            <option value="">Todos</option>
            {TURNOS.map((t) => <option key={t} value={t}>{NOME_TURNO[t]}</option>)}
          </select>
        </label>
        <label className="campo"><span className="campo-rotulo">Responsável</span>
          <input className="entrada" value={filtros.responsavel} onChange={(e) => mudar({ responsavel: e.target.value })} />
        </label>
        <div className="filtros-acoes">
          <button type="submit" className="botao botao-primario" disabled={buscando}>{buscando ? "Buscando…" : "Filtrar"}</button>
        </div>
      </form>

      {falha && <Aviso tipo="erro">{falha}</Aviso>}
      {!resultado && !falha && <Carregando />}
      {resultado && (
        <>
          <div className="resultado-topo">
            <h2>{resultado.itens.length === 1 ? "1 fechamento" : `${resultado.itens.length} fechamentos`}</h2>
            <div className="acoes nao-imprimir">
              <button type="button" className="botao botao-contorno botao-pequeno" disabled={!resultado.itens.length} onClick={exportar}>Exportar CSV</button>
              <button type="button" className="botao botao-contorno botao-pequeno" onClick={() => window.print()}>Imprimir</button>
            </div>
          </div>
          {resultado.truncado && <Aviso tipo="alerta">Mostrando os primeiros 1000 registros. Refine os filtros para ver o restante.</Aviso>}
          {resultado.itens.length === 0 ? (
            <p className="vazio">Nenhum fechamento encontrado com esses filtros.</p>
          ) : (
            <div className="tabela-rolagem">
              <table className="tabela">
                <thead>
                  <tr>
                    <th aria-sort={filtros.ordem === "asc" ? "ascending" : "descending"}>
                      <button
                        type="button"
                        className="ordenar"
                        onClick={() => {
                          const f = { ...filtros, ordem: filtros.ordem === "asc" ? "desc" : "asc" } as Filtros;
                          setFiltros(f);
                          void buscar(f);
                        }}
                      >
                        Data {filtros.ordem === "asc" ? "↑" : "↓"}
                      </button>
                    </th>
                    <th>Turno</th>
                    <th>Loja</th>
                    <th>Responsável</th>
                    <th>Status</th>
                    <th className="num">Dinheiro</th>
                    <th className="num">Total a lançar</th>
                  </tr>
                </thead>
                <tbody>
                  {resultado.itens.map((i) => (
                    <tr key={i.id}>
                      <td><Link to={`/admin/consultas/${i.id}`}>{formatarData(i.dataLocal)}</Link></td>
                      <td>{NOME_TURNO[i.turno]}</td>
                      <td>{i.lojaNome}</td>
                      <td>{i.responsavelNome}</td>
                      <td>
                        {i.status === "rascunho" ? <Etiqueta cor="ambar">Rascunho</Etiqueta> : i.quantidadeCorrecoes > 0 ? <Etiqueta>Corrigido</Etiqueta> : <Etiqueta cor="verde">Finalizado</Etiqueta>}
                        {i.quantidadeEdicoesAdm > 0 && <> <Etiqueta cor="azul">Editado pelo ADM</Etiqueta></>}
                      </td>
                      <td className="num">{i.dinheiroLancarCentavos === null ? "—" : formatarReais(i.dinheiroLancarCentavos)}</td>
                      <td className="num">{i.totalLancarCentavos === null ? "—" : formatarReais(i.totalLancarCentavos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {relatorio.quantidade > 0 && (
            <section className="bloco">
              <h2>Totais do período</h2>
              <p className="nota">Somente fechamentos finalizados ({relatorio.quantidade}).</p>
              <div className="grade-resumo">
                <div className="tabela-rolagem">
                  <table className="tabela tabela-compacta">
                    <thead><tr><th>Forma de pagamento</th><th className="num">Total</th></tr></thead>
                    <tbody>
                      {relatorio.formas.map((f) => <tr key={f.nome}><td>{f.nome}</td><td className="num">{formatarReais(f.total)}</td></tr>)}
                      <tr><td>Dinheiro (calculado)</td><td className="num">{formatarReais(relatorio.dinheiro)}</td></tr>
                    </tbody>
                    <tfoot><tr><th>Total a lançar</th><th className="num">{formatarReais(relatorio.total)}</th></tr></tfoot>
                  </table>
                </div>
                <div className="tabela-rolagem">
                  <table className="tabela tabela-compacta">
                    <thead><tr><th>Loja</th><th className="num">Fechamentos</th><th className="num">Total</th></tr></thead>
                    <tbody>
                      {relatorio.lojas.map((l) => <tr key={l.nome}><td>{l.nome}</td><td className="num">{l.quantidade}</td><td className="num">{formatarReais(l.total)}</td></tr>)}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </MolduraAdm>
  );
}
