import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { montarResumo, pendencias } from "@dominio/calculo.ts";
import { formatarReais } from "@dominio/dinheiro.ts";
import { formatarData, NOME_TURNO } from "@dominio/tipos.ts";
import type { Fechamento, Valores } from "@dominio/tipos.ts";
import { api, FalhaApi } from "../api.ts";
import type { Config } from "../api.ts";
import { novoId } from "../armazenamento.ts";
import { CampoMoeda } from "../componentes/CampoMoeda.tsx";
import { usuariosDaLoja } from "../componentes/FormIdentificacao.tsx";
import { Aviso, Moldura } from "../componentes/Moldura.tsx";
import { PainelColunas } from "../componentes/PainelColunas.tsx";
import { FormulaDinheiro } from "../componentes/Resumo.tsx";
import { CampoSangria } from "./Assistente.tsx";

interface Props {
  f: Fechamento;
  config: Config;
  token: string;
  aoCorrigir(f: Fechamento | null): void;
}

/**
 * A única correção de um fechamento finalizado. Nada é enviado até a confirmação:
 * sair desta tela sem confirmar não consome a correção.
 */
export function Correcao({ f, config, token, aoCorrigir }: Props) {
  const navegar = useNavigate();
  const antes = f.snapshot!;
  const [valores, setValores] = useState<Valores>({
    aberturaCentavos: f.aberturaCentavos,
    houveSangria: f.houveSangria,
    sangriaCentavos: f.sangriaCentavos,
    lancamentos: f.lancamentos,
  });
  const [observacao, setObservacao] = useState(f.observacao);
  const nomes = usuariosDaLoja(config.usuarios, f.lojaId);
  const [autor, setAutor] = useState(() => nomes.find((n) => n === f.responsavelNome) ?? "");
  const [motivo, setMotivo] = useState("");
  const [ciente, setCiente] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  // Mesma requisição em caso de reenvio: o servidor reconhece e não aplica duas vezes.
  const [requisicaoId] = useState(novoId);

  const depois = useMemo(() => montarResumo(valores, config.formas), [valores, config.formas]);
  const pend = pendencias(valores, depois);
  const formas = config.formas.filter((x) => x.ativa || f.lancamentos.some((l) => l.formaId === x.formaId));

  if (f.quantidadeCorrecoes > 0) return <Navigate replace to={`/f/${f.id}`} />;

  const linhas = [
    ...depois.formas.map((d) => ({ nome: d.nome, antes: antes.formas.find((a) => a.formaId === d.formaId)?.subtotalCentavos ?? 0, depois: d.subtotalCentavos })),
    { nome: "Dinheiro (calculado)", antes: antes.dinheiroLancarCentavos, depois: depois.dinheiroLancarCentavos },
    { nome: "Total a lançar", antes: antes.totalLancarCentavos, depois: depois.totalLancarCentavos },
  ];
  const mudou =
    observacao.trim() !== antes.observacao ||
    JSON.stringify([antes.aberturaCentavos, antes.sangriaCentavos, antes.dinheiroContado, antes.formas.map((x) => x.lancamentos)]) !==
      JSON.stringify([depois.aberturaCentavos, depois.sangriaCentavos, depois.dinheiroContado, depois.formas.map((x) => x.lancamentos)]);
  const motivoOk = motivo.trim().length >= 5;
  const autorOk = autor.trim().length >= 2;

  async function confirmar() {
    setTentou(true);
    if (!motivoOk || !autorOk || pend.length || !mudou || !ciente) return;
    setEnviando(true);
    setFalha(null);
    try {
      const { fechamento } = await api.corrigir(f.id, token, {
        requisicaoId,
        versaoEsperada: f.versao,
        autorDeclarado: autor,
        motivo,
        observacao,
        ...valores,
        confirmacao: { dinheiroLancarCentavos: depois.dinheiroLancarCentavos, totalLancarCentavos: depois.totalLancarCentavos },
      });
      navegar(`/f/${f.id}`, { replace: true });
      aoCorrigir(fechamento);
    } catch (e) {
      const erro = e instanceof FalhaApi ? e : null;
      setFalha(erro?.message ?? "Falha inesperada. Tente de novo.");
      if (erro?.codigo === "CORRECAO_JA_UTILIZADA" || erro?.codigo === "VERSAO_DESATUALIZADA") aoCorrigir(null);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Moldura larga contexto={<>{antes.lojaNome} · {formatarData(antes.dataLocal)} · {NOME_TURNO[antes.turno]}</>}>
      <h1>Corrigir fechamento</h1>
      <Aviso tipo="alerta">
        <p><strong>Você tem apenas uma correção disponível.</strong></p>
        <p>Ajuste tudo o que for preciso e confirme de uma vez. Depois disso o fechamento fica bloqueado. Cancelar sem confirmar não consome a correção.</p>
      </Aviso>

      <div className="formulario">
        <div className="dupla">
          <div className="campo">
            <label className="campo-rotulo" htmlFor="cor-autor">Quem está corrigindo</label>
            <select id="cor-autor" className={`entrada${tentou && !autorOk ? " com-erro" : ""}`} value={autor} onChange={(e) => setAutor(e.target.value)}>
              <option value="">Escolha seu nome…</option>
              {nomes.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
            {nomes.length === 0 && <p className="campo-erro" role="alert">Nenhum usuário cadastrado para esta loja. Peça ao administrador.</p>}
            {tentou && !autorOk && nomes.length > 0 && <p className="campo-erro" role="alert">Escolha seu nome.</p>}
          </div>
          <div className="campo">
            <label className="campo-rotulo" htmlFor="cor-motivo">Motivo da correção</label>
            <input
              id="cor-motivo"
              className={`entrada${tentou && !motivoOk ? " com-erro" : ""}`}
              value={motivo}
              maxLength={500}
              placeholder="Ex.: faltou lançar um comprovante de Pix"
              onChange={(e) => setMotivo(e.target.value)}
            />
            {tentou && !motivoOk && <p className="campo-erro" role="alert">O motivo é obrigatório.</p>}
          </div>
        </div>
      </div>

      <h2>Lançamentos</h2>
      <PainelColunas formas={formas} comDinheiro lancamentos={valores.lancamentos} aoMudar={(fn) => setValores((v) => ({ ...v, lancamentos: fn(v.lancamentos) }))} />

      <h2>Abertura e sangria</h2>
      <div className="grade-resumo">
        <div className="pilha">
          <CampoMoeda rotulo="Valor de abertura" valor={valores.aberturaCentavos} aoMudar={(c) => setValores((v) => ({ ...v, aberturaCentavos: c }))} />
          <CampoSangria
            houve={valores.houveSangria}
            centavos={valores.sangriaCentavos}
            aoMudar={(houveSangria, sangriaCentavos) => setValores((v) => ({ ...v, houveSangria, sangriaCentavos }))}
          />
        </div>
        <FormulaDinheiro r={depois} titulo="Cálculo do dinheiro a lançar" />
      </div>

      <div className="campo">
        <label className="campo-rotulo" htmlFor="cor-obs">
          Observação <span className="opcional">opcional</span>
        </label>
        <textarea id="cor-obs" className="entrada" rows={3} maxLength={2000} value={observacao} onChange={(e) => setObservacao(e.target.value)} />
      </div>

      <h2>Antes e depois</h2>
      <div className="tabela-rolagem">
        <table className="tabela tabela-compacta">
          <thead>
            <tr><th>Para lançar</th><th className="num">Antes</th><th className="num">Depois</th></tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.nome} className={l.antes !== l.depois ? "mudou" : ""}>
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
      {tentou && !mudou && <Aviso tipo="info">Nenhum valor foi alterado ainda.</Aviso>}
      {falha && <Aviso tipo="erro">{falha}</Aviso>}

      <label className="confirmacao">
        <input type="checkbox" checked={ciente} onChange={(e) => setCiente(e.target.checked)} />
        <span>Entendo que esta é a <strong>única correção</strong> e que o fechamento ficará bloqueado depois dela.</span>
      </label>
      {tentou && !ciente && <p className="campo-erro" role="alert">Marque a confirmação acima.</p>}

      <footer className="barra">
        <Link to={`/f/${f.id}`} className="botao botao-contorno">Cancelar</Link>
        <p className="barra-total" aria-live="polite">
          <span>Total a lançar</span> <strong className={depois.dinheiroLancarCentavos < 0 ? "negativo" : ""}>{formatarReais(depois.totalLancarCentavos)}</strong>
        </p>
        <button type="button" className="botao botao-primario" disabled={enviando} onClick={() => void confirmar()}>
          {enviando ? "Gravando…" : "Confirmar correção"}
        </button>
      </footer>
    </Moldura>
  );
}
