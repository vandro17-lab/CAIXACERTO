import { useId, useState } from "react";
import { MIN_OBSERVACAO_DIVERGENCIA } from "@dominio/calculo.ts";
import { formatarReais } from "@dominio/dinheiro.ts";
import { formatarData, NOME_TURNO } from "@dominio/tipos.ts";
import type { ConferenciaAbertura } from "@dominio/tipos.ts";
import type { CorpoAbertura } from "../api.ts";
import { CampoMoeda } from "./CampoMoeda.tsx";
import { Aviso } from "./Moldura.tsx";

/** Senha do gerente: 4 dígitos. Só é conferida no servidor; nunca fica guardada no aparelho. */
export function CampoSenhaGerente({ valor, aoMudar, erro }: { valor: string; aoMudar(v: string): void; erro?: boolean }) {
  const id = useId();
  return (
    <div className="campo">
      <label className="campo-rotulo" htmlFor={id}>Senha do gerente</label>
      <input
        id={id}
        className={`entrada entrada-senha-curta${erro ? " com-erro" : ""}`}
        type="password"
        inputMode="numeric"
        autoComplete="off"
        maxLength={4}
        value={valor}
        onChange={(e) => aoMudar(e.target.value.replace(/\D/g, "").slice(0, 4))}
      />
      {erro ? <p className="campo-erro" role="alert">Informe a senha do gerente (4 dígitos).</p> : <p className="campo-ajuda">4 dígitos, digitados pelo gerente.</p>}
    </div>
  );
}

interface Props {
  abertura: ConferenciaAbertura;
  /** Abertura atual do rascunho, em centavos. */
  valor: number | null;
  observacao: string;
  /** O funcionário tentou continuar sem resolver a etapa. */
  tentou: boolean;
  aoDigitar(centavos: number | null): void;
  aoObservar(texto: string): void;
  /** Envia a resposta ao servidor. Devolve a mensagem de erro, ou `null` se deu certo. */
  aoResponder(corpo: CorpoAbertura): Promise<string | null>;
  aoEnter(): void;
}

/**
 * Etapa de abertura. Havendo fechamento anterior com dinheiro na gaveta, o funcionário não digita:
 * confere o valor esperado e responde Sim ou Não. O "Não" exige o gerente junto, com a senha dele.
 */
export function EtapaAbertura({ abertura, valor, observacao, tentou, aoDigitar, aoObservar, aoResponder, aoEnter }: Props) {
  const [negando, setNegando] = useState(false);
  const [encontrado, setEncontrado] = useState<number | null>(null);
  const [senha, setSenha] = useState("");
  const [tentouNegar, setTentouNegar] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);
  const idObs = useId();

  if (abertura.situacao === "livre" || abertura.esperadoCentavos === null) {
    return (
      <section>
        <h1>Abertura do caixa</h1>
        <p className="subtitulo">Valor em dinheiro que você recebeu ao abrir o caixa. Se não recebeu nada, digite 0.</p>
        {abertura.anteriorEmRascunho && (
          <Aviso tipo="alerta">O fechamento anterior desta loja ainda não foi finalizado. Por isso a abertura está sendo digitada, sem conferência.</Aviso>
        )}
        <CampoMoeda rotulo="Valor de abertura" grande autoFocus valor={valor} aoMudar={aoDigitar} aoEnter={aoEnter} />
        {tentou && valor === null && <Aviso tipo="erro">Informe o valor de abertura (zero é permitido).</Aviso>}
      </section>
    );
  }

  const esperado = abertura.esperadoCentavos;
  const senhaOk = /^\d{4}$/.test(senha);

  async function responder(corpo: CorpoAbertura) {
    setEnviando(true);
    setFalha(null);
    const erro = await aoResponder(corpo);
    setEnviando(false);
    setFalha(erro);
    if (!erro) {
      setNegando(false);
      setSenha("");
      setEncontrado(null);
      setTentouNegar(false);
    }
  }

  function confirmarDivergencia() {
    setTentouNegar(true);
    if (encontrado === null || !senhaOk) return;
    void responder({ confere: false, esperadoCentavos: esperado, valorCentavos: encontrado, senhaGerente: senha });
  }

  return (
    <section>
      <h1>Abertura do caixa</h1>
      <div className="cartao conferencia-abertura">
        <p className="conferencia-pergunta">
          Confira se há <strong>{formatarReais(esperado)}</strong> na gaveta
        </p>
        {abertura.origem && (
          <p className="nota">
            É o dinheiro da gaveta do fechamento de {formatarData(abertura.origem.dataLocal)} · {NOME_TURNO[abertura.origem.turno]}.
          </p>
        )}
        {abertura.anteriorEmRascunho && (
          <Aviso tipo="alerta">O turno anterior desta loja ainda não foi finalizado: este valor vem do último fechamento finalizado.</Aviso>
        )}

        {abertura.situacao === "sim" && <Aviso tipo="ok">Abertura conferida: {formatarReais(esperado)}.</Aviso>}
        {abertura.situacao === "divergente" && (
          <Aviso tipo="alerta">
            <strong>Abertura com divergência.</strong> Esperado {formatarReais(esperado)}, encontrado {formatarReais(valor ?? 0)}, liberado com a senha do gerente.
          </Aviso>
        )}

        {!negando && (
          <div className="acoes">
            {abertura.situacao !== "sim" && (
              <button type="button" className="botao botao-primario" disabled={enviando} onClick={() => void responder({ confere: true, esperadoCentavos: esperado })}>
                {abertura.situacao === "divergente" ? `Na verdade, há ${formatarReais(esperado)}` : "Sim"}
              </button>
            )}
            <button type="button" className="botao botao-contorno" disabled={enviando} onClick={() => { setNegando(true); setFalha(null); }}>
              {abertura.situacao === "pendente" ? "Não" : abertura.situacao === "sim" ? "A gaveta não tem esse valor" : "Alterar o valor encontrado"}
            </button>
          </div>
        )}

        {negando && (
          <div className="pilha">
            <p><strong>Chame o gerente.</strong> Os dois conferem a gaveta juntos; o gerente digita a senha dele para liberar o valor encontrado.</p>
            <CampoMoeda rotulo="Valor encontrado na gaveta" grande autoFocus valor={encontrado} aoMudar={setEncontrado} />
            {tentouNegar && encontrado === null && <p className="campo-erro" role="alert">Informe o valor encontrado na gaveta (zero é permitido).</p>}
            <CampoSenhaGerente valor={senha} aoMudar={setSenha} erro={tentouNegar && !senhaOk} />
            <div className="acoes">
              <button type="button" className="botao botao-contorno" disabled={enviando} onClick={() => { setNegando(false); setFalha(null); }}>Cancelar</button>
              <button type="button" className="botao botao-primario" disabled={enviando} onClick={confirmarDivergencia}>
                {enviando ? "Conferindo…" : "Liberar com a senha do gerente"}
              </button>
            </div>
          </div>
        )}
        {falha && <Aviso tipo="erro">{falha}</Aviso>}
      </div>

      {abertura.situacao === "divergente" && (
        <div className="campo">
          <label className="campo-rotulo" htmlFor={idObs}>
            Observação <span className="opcional">obrigatória</span>
          </label>
          <textarea
            id={idObs}
            className="entrada"
            rows={3}
            maxLength={2000}
            placeholder="Explique o que aconteceu com a abertura"
            value={observacao}
            onChange={(e) => aoObservar(e.target.value)}
          />
          {tentou && observacao.trim().length < MIN_OBSERVACAO_DIVERGENCIA && (
            <p className="campo-erro" role="alert">Escreva na observação o que aconteceu com a abertura.</p>
          )}
        </div>
      )}
      {tentou && abertura.situacao === "pendente" && <Aviso tipo="erro">Responda Sim ou Não para continuar.</Aviso>}
    </section>
  );
}
