import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { montarResumo } from "@dominio/calculo.ts";
import { formatarNumero, formatarReais } from "@dominio/dinheiro.ts";
import { formatarData, NOME_TURNO } from "@dominio/tipos.ts";
import type { Alteracao, Fechamento, Forma, Resumo, Snapshot } from "@dominio/tipos.ts";
import { api, FalhaApi } from "../../api.ts";
import { MolduraAdm, useAdm } from "../../adm.tsx";
import { Aviso, Carregando, Etiqueta } from "../../componentes/Moldura.tsx";
import { FormulaDinheiro, ListaLancar } from "../../componentes/Resumo.tsx";
import { dataHora } from "../Resultado.tsx";

/** Detalhe de um fechamento: somente leitura, com lançamentos individuais e histórico. */
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
  return (
    <MolduraAdm>
      <p className="nao-imprimir"><Link to="/admin/consultas">← Consultas</Link></p>
      <div className="resultado-topo">
        <h1>{f.lojaNome} · {formatarData(f.dataLocal)} · {NOME_TURNO[f.turno]}</h1>
        <div className="etiquetas">
          {f.status === "rascunho" ? <Etiqueta cor="ambar">Rascunho</Etiqueta> : <Etiqueta cor="verde">Finalizado · versão {f.versao}</Etiqueta>}
          {f.quantidadeCorrecoes > 0 && <Etiqueta>Corrigido uma vez — bloqueado</Etiqueta>}
        </div>
      </div>
      <p className="subtitulo">
        Responsável (nome declarado): {f.responsavelNome} · criado em {dataHora(f.criadoEm)}
        {f.finalizadoEm && <> · finalizado em {dataHora(f.finalizadoEm)}</>}
      </p>
      {f.status === "rascunho" && <Aviso tipo="info">Este fechamento ainda não foi finalizado: os valores abaixo são parciais.</Aviso>}

      <div className="grade-resumo">
        <ListaLancar r={r} mostrarZerados />
        <div>
          <FormulaDinheiro r={r} />
          <p className="nota">
            Fórmula aplicada (regra v1, fiel à planilha): Dinheiro a lançar = Dinheiro contado − (Abertura − Sangria de troco).
          </p>
        </div>
      </div>

      {observacao && (
        <div className="observacao">
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
              <tr key={x.formaId}>
                <td>{x.nome}</td>
                <td className="valores">{x.lancamentos.length ? x.lancamentos.map(formatarNumero).join("  ·  ") : "—"}</td>
                <td className="num">{formatarReais(x.subtotalCentavos)}</td>
              </tr>
            ))}
            <tr>
              <td>Dinheiro contado</td>
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
          <li key={h.auditoriaId} className="cartao">
            <p>
              <strong>{h.tipo === "finalizacao" ? "Finalização" : "Correção"} — versão {h.versaoNova}</strong>
              <br />
              {dataHora(h.alteradoEm)} · por {h.autorDeclarado} (nome declarado)
            </p>
            {h.tipo === "correcao" && (
              <>
                <p><strong>Motivo:</strong> {h.motivo}</p>
                {h.antes && <Comparacao antes={h.antes} depois={h.depois} />}
              </>
            )}
          </li>
        ))}
      </ol>
      <p className="nota">Os números não podem ser alterados por esta tela. O histórico é permanente.</p>
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
    ["Dinheiro contado", antes.dinheiroContadoCentavos, depois.dinheiroContadoCentavos],
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
