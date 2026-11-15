import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { diferencas, montarResumo, pendencias } from "@dominio/calculo.ts";
import { formatarReais } from "@dominio/dinheiro.ts";
import { formatarData, NOME_TURNO } from "@dominio/tipos.ts";
import type { Fechamento, Forma, Snapshot, Valores } from "@dominio/tipos.ts";
import { api, FalhaApi } from "../../api.ts";
import { MolduraAdm, useAdm } from "../../adm.tsx";
import { CampoMoeda } from "../../componentes/CampoMoeda.tsx";
import { Aviso, Carregando } from "../../componentes/Moldura.tsx";
import { PainelColunas } from "../../componentes/PainelColunas.tsx";
import { FormulaDinheiro } from "../../componentes/Resumo.tsx";
import { CampoSangria } from "../Assistente.tsx";

/** Carrega o fechamento e abre o editor do administrador. */
export function EdicaoAdm() {
  const { id = "" } = useParams();
  const { chamar } = useAdm();
  const [d, setD] = useState<{ fechamento: Fechamento; formas: Forma[] } | null>(null);
  const [falha, setFalha] = useState<string | null>(null);

  useEffect(() => {
    chamar((t) => api.adm.detalhar(t, id)).then(setD, (e: FalhaApi) => setFalha(e.message));
  }, [chamar, id]);

  if (falha) return <MolduraAdm><Aviso tipo="erro">{falha}</Aviso><Link to="/admin/consultas" className="botao botao-contorno">Voltar às consultas</Link></MolduraAdm>;
  if (!d) return <MolduraAdm><Carregando /></MolduraAdm>;
  if (d.fechamento.status !== "finalizado" || !d.fechamento.snapshot) {
    return (
      <MolduraAdm>
        <Aviso tipo="info">Este fechamento ainda está em rascunho: só é possível editar depois de finalizado.</Aviso>
        <Link to={`/admin/consultas/${id}`} className="botao botao-contorno">Voltar</Link>
      </MolduraAdm>
    );
  }
  return <Editor f={d.fechamento} antes={d.fechamento.snapshot} formasTodas={d.formas} />;
}

/**
 * Edição pelo administrador: lança os valores conferidos depois. Pode ser feita quantas vezes for
 * preciso; cada uma fica no histórico e os valores alterados aparecem em outra cor para todos.
 */
function Editor({ f, antes, formasTodas }: { f: Fechamento; antes: Snapshot; formasTodas: Forma[] }) {
  const navegar = useNavigate();
  const { chamar } = useAdm();
  const [valores, setValores] = useState<Valores>({
    aberturaCentavos: f.aberturaCentavos,
    houveSangria: f.houveSangria,
    sangriaCentavos: f.sangriaCentavos,
    lancamentos: f.lancamentos,
  });
  const [observacao, setObservacao] = useState(f.observacao);
  const [motivo, setMotivo] = useState("");
  const [tentou, setTentou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  const depois = useMemo(() => montarResumo(valores, formasTodas), [valores, formasTodas]);
  const pend = pendencias(valores, depois);
  const formas = formasTodas.filter((x) => x.ativa || f.lancamentos.some((l) => l.formaId === x.formaId));
  const mudancas = diferencas(antes, { ...depois, observacao: observacao.trim() });
  const motivoOk = motivo.trim().length >= 5;

  const linhas = [
    ...depois.formas.map((x) => ({ chave: `forma:${x.formaId}`, nome: x.nome, antes: antes.formas.find((a) => a.formaId === x.formaId)?.subtotalCentavos ?? 0, depois: x.subtotalCentavos })),
    { chave: "abertura", nome: "Abertura", antes: antes.aberturaCentavos, depois: depois.aberturaCentavos },
    { chave: "sangria", nome: "Sangria de troco", antes: antes.sangriaCentavos, depois: depois.sangriaCentavos },
    { chave: "dinheiroContado", nome: "Dinheiro da gaveta", antes: antes.dinheiroContadoCentavos, depois: depois.dinheiroContadoCentavos },
    { chave: "dinheiroLancar", nome: "Dinheiro a lançar (calculado)", antes: antes.dinheiroLancarCentavos, depois: depois.dinheiroLancarCentavos },
    { chave: "total", nome: "Total a lançar", antes: antes.totalLancarCentavos, depois: depois.totalLancarCentavos },
  ];

  async function confirmar() {
    setTentou(true);
    if (!motivoOk || pend.length || !mudancas.length) return;
    setEnviando(true);
    setFalha(null);
    try {
      await chamar((t) =>
        api.adm.editar(t, f.id, {
          versaoEsperada: f.versao,
          motivo,
          observacao,
          ...valores,
          confirmacao: { dinheiroLancarCentavos: depois.dinheiroLancarCentavos, totalLancarCentavos: depois.totalLancarCentavos },
        }),
      );
      navegar(`/admin/consultas/${f.id}`, { replace: true });
    } catch (e) {
      setFalha(e instanceof FalhaApi ? e.message : "Falha inesperada. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <MolduraAdm>
      <p><Link to={`/admin/consultas/${f.id}`}>← Voltar sem salvar</Link></p>
      <h1>Editar fechamento</h1>
      <p className="subtitulo">
        {f.lojaNome} · {formatarData(f.dataLocal)} · {NOME_TURNO[f.turno]} · Responsável: {f.responsavelNome} · versão {f.versao}
      </p>
      <Aviso tipo="info">
        <p>
          Edição do <strong>administrador</strong>: os valores que você alterar ficam marcados <span className="valor-adm">nesta cor</span> no
          fechamento e no histórico, com o motivo. A correção única do funcionário não é consumida.
        </p>
      </Aviso>

      <div className="campo">
        <label className="campo-rotulo" htmlFor="adm-motivo">Motivo da edição</label>
        <input
          id="adm-motivo"
          className={`entrada${tentou && !motivoOk ? " com-erro" : ""}`}
          value={motivo}
          maxLength={500}
          placeholder="Ex.: valor do Pix conferido no extrato"
          onChange={(e) => setMotivo(e.target.value)}
        />
        {tentou && !motivoOk && <p className="campo-erro" role="alert">O motivo é obrigatório (mínimo de 5 letras).</p>}
      </div>

      <h2>Lançamentos</h2>
      <PainelColunas formas={formas} comDinheiro lancamentos={valores.lancamentos} aoMudar={(fn) => setValores((v) => ({ ...v, lancamentos: fn(v.lancamentos) }))} />

      <h2>Abertura e sangria</h2>
      <div className="grade-resumo">
        <div className="pilha">
          <CampoMoeda
            rotulo="Valor de abertura"
            valor={valores.aberturaCentavos}
            ajuda={
              f.abertura.esperadoCentavos === null
                ? undefined
                : `Esperado: ${formatarReais(f.abertura.esperadoCentavos)} (dinheiro da gaveta do fechamento anterior). Com outro valor, o fechamento fica marcado como abertura com divergência.`
            }
            aoMudar={(c) => setValores((v) => ({ ...v, aberturaCentavos: c }))}
          />
          <CampoSangria
            houve={valores.houveSangria}
            centavos={valores.sangriaCentavos}
            aoMudar={(houveSangria, sangriaCentavos) => setValores((v) => ({ ...v, houveSangria, sangriaCentavos }))}
          />
        </div>
        <FormulaDinheiro r={depois} titulo="Cálculo do dinheiro a lançar" adm={mudancas} />
      </div>

      <div className="campo">
        <label className="campo-rotulo" htmlFor="adm-obs">
          Observação <span className="opcional">opcional</span>
        </label>
        <textarea id="adm-obs" className="entrada" rows={3} maxLength={2000} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </div>

      <h2>Antes e depois</h2>
      <div className="tabela-rolagem">
        <table className="tabela tabela-compacta">
          <thead>
            <tr><th>Item</th><th className="num">Antes</th><th className="num">Depois</th></tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.chave} className={mudancas.includes(l.chave) ? "valor-adm" : ""}>
                <td>{l.nome}</td>
                <td className="num">{formatarReais(l.antes)}</td>
                <td className="num">{formatarReais(l.depois)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pend.length > 0 && (
        <Aviso tipo="erro">
          <ul>{pend.map((p) => <li key={p}>{p}</li>)}</ul>
        </Aviso>
      )}
      {tentou && !mudancas.length && <Aviso tipo="info">Nenhum valor foi alterado ainda.</Aviso>}
      {falha && <Aviso tipo="erro">{falha}</Aviso>}

      <footer className="barra">
        <Link to={`/admin/consultas/${f.id}`} className="botao botao-contorno">Cancelar</Link>
        <p className="barra-total" aria-live="polite">
          <span>Total a lançar</span> <strong className={depois.dinheiroLancarCentavos < 0 ? "negativo" : ""}>{formatarReais(depois.totalLancarCentavos)}</strong>
        </p>
        <button type="button" className="botao botao-primario" disabled={enviando} onClick={() => void confirmar()}>
          {enviando ? "Gravando…" : "Salvar edição"}
        </button>
      </footer>
    </MolduraAdm>
  );
}
