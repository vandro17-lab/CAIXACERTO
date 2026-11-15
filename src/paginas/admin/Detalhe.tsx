import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { montarResumo } from "@dominio/calculo.ts";
import { formatarNumero, formatarReais } from "@dominio/dinheiro.ts";
import { formatarData, NOME_TURNO } from "@dominio/tipos.ts";
import type { Alteracao, Fechamento, Forma, Resumo, Snapshot } from "@dominio/tipos.ts";
import { api, FalhaApi } from "../../api.ts";
import { MolduraAdm, useAdm } from "../../adm.tsx";
import { Aviso, Carregando, Etiqueta } from "../../componentes/Moldura.tsx";
import { Cupom80 } from "../../componentes/Cupom80.tsx";
import { FormulaDinheiro, LegendaAdm, ListaLancar } from "../../componentes/Resumo.tsx";
import { dataHora } from "../Resultado.tsx";

const TIPO_ALTERACAO = { finalizacao: "Finalização", correcao: "Correção do funcionário", edicao_adm: "Edição do administrador" } as const;

/** Detalhe de um fechamento, com lançamentos individuais e histórico. Daqui o ADM imprime e edita. */
export function Detalhe() {
  const { id = "" } = useParams();
  const { chamar } = useAdm();
  const [d, setD] = useState<{ fechamento: Fechamento; historico: Alteracao[]; formas: Forma[] } | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  useEffect(() => {
    chamar((t) => api.adm.detalhar(t, id)).then(setD, (e: FalhaApi) => setFalha(e.message));
  }, [chamar, id]);

  if (falha) return <MolduraAdm><Aviso tipo="erro">{falha}</Aviso><Link to="/admin/consultas" className="botao botao-contorno">Voltar às consultas</Link></MolduraAdm>;
  if (!d) return <MolduraAdm><Carregando /></MolduraAdm>;

  const f = d.fechamento;
  const r: Resumo = f.snapshot ?? montarResumo(f, d.formas);
  const observacao = f.snapshot?.observacao ?? f.observacao;
  const adm = f.snapshot?.alteradoPeloAdm;
  const marcaAdm = (chave: string) => (adm?.includes(chave) ? "valor-adm" : "");
  return (
    <MolduraAdm>
      <p className="nao-imprimir"><Link to="/admin/consultas">← Consultas</Link></p>
      <div className="resultado-topo">
        <h1>{f.lojaNome} · {formatarData(f.dataLocal)} · {NOME_TURNO[f.turno]}</h1>
        <div className="etiquetas">
          {f.status === "rascunho" ? <Etiqueta cor="ambar">Rascunho</Etiqueta> : <Etiqueta cor="verde">Finalizado · versão {f.versao}</Etiqueta>}
          {f.quantidadeCorrecoes > 0 && <Etiqueta>Corrigido uma vez pelo funcionário</Etiqueta>}
          {f.quantidadeEdicoesAdm > 0 && <Etiqueta cor="azul">Editado pelo administrador ({f.quantidadeEdicoesAdm})</Etiqueta>}
        </div>
      </div>
      <div className="acoes nao-imprimir">
        {f.status === "finalizado" && <Link to={`/admin/consultas/${f.id}/editar`} className="botao botao-primario">Editar valores</Link>}
        <button type="button" className="botao botao-contorno" onClick={() => window.print()}>Imprimir cupom (80 mm)</button>
      </div>
      <Cupom80
        dados={{
          lojaNome: f.lojaNome, dataLocal: f.dataLocal, turno: f.turno, responsavelNome: f.responsavelNome,
          situacao: f.status === "rascunho" ? "RASCUNHO — ainda não finalizado" : `Versão ${f.versao} · ${dataHora(f.versao > 1 ? f.atualizadoEm : f.finalizadoEm ?? f.atualizadoEm)}`,
          avisos: [...(f.quantidadeCorrecoes > 0 ? ["Corrigido uma vez pelo funcionário"] : []), ...(f.quantidadeEdicoesAdm > 0 ? ["Editado pelo administrador"] : [])],
          observacao,
        }}
        r={r}
        adm={adm}
        mostrarZerados
        comMemoria
      />
      <p className="subtitulo">
        Responsável (nome declarado): {f.responsavelNome} · criado em {dataHora(f.criadoEm)}
        {f.finalizadoEm && <> · finalizado em {dataHora(f.finalizadoEm)}</>}
      </p>
      {f.status === "rascunho" && <Aviso tipo="info">Este fechamento ainda não foi finalizado: os valores abaixo são parciais.</Aviso>}

      <div className="grade-resumo">
        <ListaLancar r={r} mostrarZerados adm={adm} />
        <div>
          <FormulaDinheiro r={r} adm={adm} />
          <p className="nota">
            Fórmula aplicada (regra v1, fiel à planilha): Dinheiro a lançar = Dinheiro da gaveta − (Abertura − Sangria de troco).
          </p>
        </div>
      </div>

      <LegendaAdm adm={adm} />

      {observacao && (
        <div className={`observacao ${marcaAdm("observacao")}`}>
          <h3>Observação</h3>
          <p>{observacao}</p>
        </div>
      )}

      <h2>Lançamentos individuais</h2>
      <div className="tabela-rolagem">
        <table className="tabela tabela-compacta">
          <thead><tr><th>Coluna</th><th>Lançamentos</th><th className="num">Subtotal</th></tr></thead>
          <tbody>
            {r.formas.map((x) => (
              <tr key={x.formaId} className={marcaAdm(`forma:${x.formaId}`)}>
                <td>{x.nome}</td>
                <td className="valores">{x.lancamentos.length ? x.lancamentos.map(formatarNumero).join("  ·  ") : "—"}</td>
                <td className="num">{formatarReais(x.subtotalCentavos)}</td>
              </tr>
            ))}
            <tr className={marcaAdm("dinheiroContado")}>
              <td>Dinheiro da gaveta</td>
              <td className="valores">{r.dinheiroContado.length ? r.dinheiroContado.map(formatarNumero).join("  ·  ") : "—"}</td>
              <td className="num">{formatarReais(r.dinheiroContadoCentavos)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2>Histórico de alterações</h2>
      {d.historico.length === 0 && <p className="vazio">Sem registros: o fechamento ainda está em rascunho.</p>}
      <ol className="historico">
        {d.historico.map((h) => (
          <li key={h.auditoriaId} className={`cartao${h.tipo === "edicao_adm" ? " cartao-adm" : ""}`}>
            <p>
              <strong>{TIPO_ALTERACAO[h.tipo]} — versão {h.versaoNova}</strong>
              <br />
              {dataHora(h.alteradoEm)} · por {h.autorDeclarado}{h.tipo === "edicao_adm" ? "" : " (nome declarado)"}
            </p>
            {h.tipo !== "finalizacao" && (
              <>
                <p><strong>Motivo:</strong> {h.motivo}</p>
                {h.antes && <Comparacao antes={h.antes} depois={h.depois} />}
              </>
            )}
          </li>
        ))}
      </ol>
      <p className="nota">O histórico é permanente: cada edição do administrador fica registrada com o motivo, o antes e o depois.</p>
    </MolduraAdm>
  );
}

function Comparacao({ antes, depois }: { antes: Snapshot; depois: Snapshot }) {
  const ids = [...new Set([...antes.formas, ...depois.formas].map((f) => f.formaId))];
  const forma = (s: Snapshot, id: string) => s.formas.find((f) => f.formaId === id);
  const linhas: [string, number, number][] = [
    ...ids.map((id): [string, number, number] => [
      (forma(depois, id) ?? forma(antes, id))!.nome,
      forma(antes, id)?.subtotalCentavos ?? 0,
      forma(depois, id)?.subtotalCentavos ?? 0,
    ]),
    ["Abertura", antes.aberturaCentavos, depois.aberturaCentavos],
    ["Sangria de troco", antes.sangriaCentavos, depois.sangriaCentavos],
    ["Dinheiro da gaveta", antes.dinheiroContadoCentavos, depois.dinheiroContadoCentavos],
    ["Dinheiro a lançar", antes.dinheiroLancarCentavos, depois.dinheiroLancarCentavos],
    ["Total a lançar", antes.totalLancarCentavos, depois.totalLancarCentavos],
  ];
  return (
    <div className="tabela-rolagem">
      <table className="tabela tabela-compacta">
        <thead><tr><th>Item</th><th className="num">Antes (v{antes.versao})</th><th className="num">Depois (v{depois.versao})</th></tr></thead>
        <tbody>
          {linhas.map(([nome, a, b]) => (
            <tr key={nome} className={a !== b ? "mudou" : ""}>
              <td>{nome}</td>
              <td className="num">{formatarReais(a)}</td>
              <td className="num">{formatarReais(b)}</td>
            </tr>
          ))}
          {antes.observacao !== depois.observacao && (
            <tr className="mudou"><td>Observação</td><td>{antes.observacao || "—"}</td><td>{depois.observacao || "—"}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
