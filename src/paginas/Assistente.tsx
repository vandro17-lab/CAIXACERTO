import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { montarResumo, pendencias } from "@dominio/calculo.ts";
import { formatarReais } from "@dominio/dinheiro.ts";
import { formatarData, NOME_TURNO } from "@dominio/tipos.ts";
import type { Fechamento, Turno } from "@dominio/tipos.ts";
import { api, FalhaApi } from "../api.ts";
import type { Config } from "../api.ts";
import { CampoMoeda } from "../componentes/CampoMoeda.tsx";
import { ColunaLancamentos } from "../componentes/ColunaLancamentos.tsx";
import { faltasIdentificacao, FormIdentificacao } from "../componentes/FormIdentificacao.tsx";
import { Aviso, Moldura } from "../componentes/Moldura.tsx";
import { PainelColunas } from "../componentes/PainelColunas.tsx";
import { FormulaDinheiro, ListaLancar } from "../componentes/Resumo.tsx";
import { novoId } from "../armazenamento.ts";
import { useRascunho } from "../useRascunho.ts";
import type { Situacao } from "../useRascunho.ts";

const ETAPAS = [
  { caminho: "identificacao", nome: "Identificação" },
  { caminho: "abertura", nome: "Abertura" },
  { caminho: "lancamentos", nome: "Lançamentos" },
  { caminho: "dinheiro", nome: "Dinheiro" },
  { caminho: "conferencia", nome: "Conferência" },
] as const;

const SITUACOES: Record<Situacao, { texto: string; classe: string }> = {
  salvo: { texto: "Salvo no servidor", classe: "ok" },
  pendente: { texto: "Salvando…", classe: "andamento" },
  salvando: { texto: "Salvando…", classe: "andamento" },
  offline: { texto: "Sem conexão — guardado só neste aparelho", classe: "alerta" },
  erro: { texto: "Não salvo — veja o aviso", classe: "erro" },
};

interface Props {
  inicial: Fechamento;
  config: Config;
  token: string;
  aoMudarNoServidor(f: Fechamento | null): void;
}

/** Fluxo guiado do rascunho: identificação → abertura → lançamentos → dinheiro → conferência. */
export function Assistente({ inicial, config, token, aoMudarNoServidor }: Props) {
  const navegar = useNavigate();
  const etapa = useParams()["*"] ?? "";
  const indice = ETAPAS.findIndex((e) => e.caminho === etapa);
  const { dados, situacao, erro, alterar, salvarAgora, revisao } = useRascunho({ inicial, token, aoDivergir: aoMudarNoServidor });
  const [tentou, setTentou] = useState(false);
  const [conferido, setConferido] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  const resumo = useMemo(() => montarResumo(dados, config.formas), [dados, config.formas]);
  const pend = pendencias(dados, resumo);
  const formas = config.formas.filter((f) => f.ativa || dados.lancamentos.some((l) => l.formaId === f.formaId));
  const loja = config.lojas.find((l) => l.lojaId === dados.lojaId)?.nome ?? inicial.lojaNome;
  const base = `/f/${inicial.id}`;

  if (indice < 0) return <Navigate replace to={`${base}/${dados.aberturaCentavos === null ? "abertura" : "lancamentos"}`} />;

  const ir = (i: number) => {
    setTentou(false);
    setFalha(null);
    navegar(`${base}/${ETAPAS[i].caminho}`);
    window.scrollTo?.(0, 0);
  };

  const sangriaOk = dados.houveSangria === false || (dados.houveSangria === true && dados.sangriaCentavos > 0);

  async function continuar() {
    setTentou(true);
    if (etapa === "identificacao") {
      if (Object.keys(faltasIdentificacao(dados)).length) return;
      setEnviando(true);
      const ok = await salvarAgora();
      setEnviando(false);
      if (!ok) return;
    }
    if (etapa === "abertura" && dados.aberturaCentavos === null) return;
    if (etapa === "dinheiro" && !sangriaOk) return;
    ir(indice + 1);
  }

  async function finalizar() {
    setEnviando(true);
    setFalha(null);
    try {
      if (!(await salvarAgora())) {
        setFalha("Não foi possível salvar no servidor. Verifique a conexão e tente de novo — seus lançamentos continuam guardados neste aparelho.");
        return;
      }
      const { fechamento } = await api.finalizar(inicial.id, token, revisao(), {
        dinheiroLancarCentavos: resumo.dinheiroLancarCentavos,
        totalLancarCentavos: resumo.totalLancarCentavos,
      });
      navegar(base, { replace: true });
      aoMudarNoServidor(fechamento);
    } catch (e) {
      setFalha(e instanceof FalhaApi ? e.message : "Falha inesperada. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  const s = SITUACOES[situacao];
  return (
    <Moldura
      larga={etapa === "lancamentos"}
      contexto={<>{loja} · {formatarData(dados.dataLocal)} · {dados.turno ? NOME_TURNO[dados.turno as Turno] : ""}</>}
      lado={<span className={`situacao situacao-${s.classe}`} role="status">{s.texto}</span>}
    >
      <nav className="etapas" aria-label="Etapas do fechamento">
        <ol>
          {ETAPAS.map((e, i) => (
            <li key={e.caminho} className={i === indice ? "atual" : i < indice ? "feita" : ""}>
              <button type="button" onClick={() => ir(i)} aria-current={i === indice ? "step" : undefined}>
                <span className="etapa-n">{i + 1}</span>
                <span className="etapa-nome">{e.nome}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {erro && (
        <Aviso tipo="erro">
          <p>{erro.message}</p>
          {erro.codigo === "FECHAMENTO_EXISTENTE" && etapa !== "identificacao" && (
            <button type="button" className="botao botao-contorno" onClick={() => ir(0)}>Rever identificação</button>
          )}
        </Aviso>
      )}

      {etapa === "identificacao" && (
        <section>
          <h1>Identificação</h1>
          <p className="subtitulo">Enquanto o fechamento está em rascunho, estes dados podem ser ajustados.</p>
          <FormIdentificacao valor={dados} lojas={config.lojas} usuarios={config.usuarios} mostrarFaltas={tentou} aoMudar={(v) => alterar((d) => ({ ...d, ...v }))} />
        </section>
      )}

      {etapa === "abertura" && (
        <section>
          <h1>Abertura do caixa</h1>
          <p className="subtitulo">Valor em dinheiro que você recebeu ao abrir o caixa. Se não recebeu nada, digite 0.</p>
          <CampoMoeda
            rotulo="Valor de abertura"
            grande
            autoFocus
            valor={dados.aberturaCentavos}
            aoMudar={(c) => alterar((d) => ({ ...d, aberturaCentavos: c }))}
            aoEnter={() => void continuar()}
          />
          {tentou && dados.aberturaCentavos === null && <Aviso tipo="erro">Informe o valor de abertura (zero é permitido).</Aviso>}
        </section>
      )}

      {etapa === "lancamentos" && (
        <section>
          <h1>Lançamentos</h1>
          <p className="subtitulo">
            Digite cada valor e pressione <kbd>Enter</kbd>. O subtotal soma sozinho.
            <span className="so-desktop"> <kbd>Tab</kbd> ou <kbd>Alt</kbd>+<kbd>→</kbd> muda de coluna; <kbd>↑</kbd> volta a um valor para corrigir.</span>
          </p>
          <PainelColunas formas={formas} lancamentos={dados.lancamentos} autoFocus aoMudar={(fn) => alterar((d) => ({ ...d, lancamentos: fn(d.lancamentos) }))} />
        </section>
      )}

      {etapa === "dinheiro" && (
        <section>
          <h1>Dinheiro e sangria</h1>
          <p className="subtitulo">Conte o dinheiro que está no caixa agora. O valor a lançar é calculado — não digite ele.</p>
          <div className="grade-dinheiro">
            <ColunaLancamentos
              titulo="Dinheiro da gaveta"
              dinheiro
              autoFocus
              itens={dados.lancamentos.filter((l) => l.tipo === "dinheiro_contado")}
              aoAdicionar={(valorCentavos) =>
                alterar((d) => ({ ...d, lancamentos: [...d.lancamentos, { id: novoId(), formaId: null, tipo: "dinheiro_contado", valorCentavos }] }))
              }
              aoEditar={(id, valorCentavos) => alterar((d) => ({ ...d, lancamentos: d.lancamentos.map((l) => (l.id === id ? { ...l, valorCentavos } : l)) }))}
              aoRemover={(id) => alterar((d) => ({ ...d, lancamentos: d.lancamentos.filter((l) => l.id !== id) }))}
            />
            <div className="pilha">
              <CampoSangria
                houve={dados.houveSangria}
                centavos={dados.sangriaCentavos}
                aoMudar={(houveSangria, sangriaCentavos) => alterar((d) => ({ ...d, houveSangria, sangriaCentavos }))}
              />
              {tentou && !sangriaOk && (
                <Aviso tipo="erro">{dados.houveSangria === null ? "Informe se houve sangria de troco." : "Informe o valor da sangria de troco."}</Aviso>
              )}
              <FormulaDinheiro r={resumo} titulo="Cálculo do dinheiro a lançar" />
              {dados.aberturaCentavos !== null && resumo.dinheiroLancarCentavos < 0 && (
                <Aviso tipo="alerta">
                  O dinheiro a lançar está negativo. Enquanto estiver assim, o fechamento não pode ser finalizado: confira a abertura, a sangria e o dinheiro da gaveta.
                </Aviso>
              )}
            </div>
          </div>
        </section>
      )}

      {etapa === "conferencia" && (
        <section>
          <h1>Conferência</h1>
          <p className="subtitulo">Revise tudo antes de finalizar.</p>
          <div className="revisao">
            <div className="revisao-cabecalho">
              <div>
                <strong>{loja}</strong> · {formatarData(dados.dataLocal)} · {dados.turno ? NOME_TURNO[dados.turno as Turno] : ""}
                <br />
                Responsável: {dados.responsavelNome}
              </div>
              <button type="button" className="link" onClick={() => ir(0)}>Editar</button>
            </div>
            <div className="grade-resumo">
              <div>
                <ListaLancar r={resumo} mostrarZerados />
                <p className="links-edicao">
                  <button type="button" className="link" onClick={() => ir(2)}>Corrigir lançamentos</button>
                </p>
              </div>
              <div>
                <FormulaDinheiro r={resumo} />
                <p className="links-edicao">
                  <button type="button" className="link" onClick={() => ir(1)}>Corrigir abertura</button>
                  <button type="button" className="link" onClick={() => ir(3)}>Corrigir dinheiro ou sangria</button>
                </p>
              </div>
            </div>
            <div className="campo">
              <label className="campo-rotulo" htmlFor="obs-final">
                Observação <span className="opcional">opcional</span>
              </label>
              <textarea
                id="obs-final"
                className="entrada"
                rows={3}
                maxLength={2000}
                value={dados.observacao}
                onChange={(e) => alterar((d) => ({ ...d, observacao: e.target.value }))}
              />
            </div>
          </div>

          {pend.length > 0 ? (
            <Aviso tipo="erro">
              <p><strong>Ainda não é possível finalizar:</strong></p>
              <ul>{pend.map((p) => <li key={p}>{p}</li>)}</ul>
            </Aviso>
          ) : (
            <label className="confirmacao">
              <input type="checkbox" checked={conferido} onChange={(e) => setConferido(e.target.checked)} />
              <span>
                Conferi os valores. Sei que, depois de finalizar, será permitida <strong>somente uma correção</strong>.
              </span>
            </label>
          )}
          {falha && <Aviso tipo="erro">{falha}</Aviso>}
        </section>
      )}

      <footer className="barra">
        {indice === 0 ? (
          <Link to="/" className="botao botao-contorno">Início</Link>
        ) : (
          <button type="button" className="botao botao-contorno" onClick={() => ir(indice - 1)}>Voltar</button>
        )}
        <p className="barra-total" aria-live="polite">
          {etapa === "dinheiro" ? (
            <><span>Dinheiro a lançar</span> <strong className={resumo.dinheiroLancarCentavos < 0 ? "negativo" : ""}>{formatarReais(resumo.dinheiroLancarCentavos)}</strong></>
          ) : etapa === "conferencia" ? (
            <><span>Total a lançar</span> <strong>{formatarReais(resumo.totalLancarCentavos)}</strong></>
          ) : (
            <><span>Total parcial</span> <strong>{formatarReais(resumo.totalPagamentosCentavos)}</strong></>
          )}
        </p>
        {etapa === "conferencia" ? (
          <button type="button" className="botao botao-primario" disabled={enviando || pend.length > 0 || !conferido} onClick={() => void finalizar()}>
            {enviando ? "Finalizando…" : "Finalizar fechamento"}
          </button>
        ) : (
          <button type="button" className="botao botao-primario" disabled={enviando} onClick={() => void continuar()}>
            Continuar
          </button>
        )}
      </footer>
    </Moldura>
  );
}

interface SangriaProps {
  houve: boolean | null;
  centavos: number;
  aoMudar(houve: boolean | null, centavos: number): void;
}

/** Sangria de troco: escolha explícita entre "não houve" e "houve", com o valor. */
export function CampoSangria({ houve, centavos, aoMudar }: SangriaProps) {
  return (
    <fieldset className="campo cartao">
      <legend className="campo-rotulo">Sangria de troco</legend>
      <div className="opcoes opcoes-juntas">
        <label className="opcao">
          <input type="radio" name="sangria" checked={houve === false} onChange={() => aoMudar(false, 0)} />
          <span>Não houve sangria</span>
        </label>
        <label className="opcao">
          <input type="radio" name="sangria" checked={houve === true} onChange={() => aoMudar(true, centavos)} />
          <span>Houve sangria</span>
        </label>
      </div>
      {houve === true && (
        <CampoMoeda rotulo="Valor da sangria" valor={centavos > 0 ? centavos : null} autoFocus aoMudar={(c) => aoMudar(true, c ?? 0)} />
      )}
    </fieldset>
  );
}
