import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { formatarData, NOME_TURNO } from "@dominio/tipos.ts";
import type { Turno } from "@dominio/tipos.ts";
import { api, FalhaApi } from "../api.ts";
import type { Config, Identificacao } from "../api.ts";
import { guardarNome, lembrar, novoToken, tokenDe, ultimoNome } from "../armazenamento.ts";
import { faltasIdentificacao, FormIdentificacao, hojeLocal } from "../componentes/FormIdentificacao.tsx";
import { Aviso, Carregando, Moldura } from "../componentes/Moldura.tsx";

interface Existente {
  id: string;
  status: "rascunho" | "finalizado";
  lojaNome: string;
  dataLocal: string;
  turno: Turno;
}

/** Identificação de um novo fechamento. A unicidade loja + data + turno é conferida no servidor. */
export function Novo() {
  const navegar = useNavigate();
  const [config, setConfig] = useState<Config | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [valor, setValor] = useState<Identificacao>({ lojaId: "", dataLocal: hojeLocal(), turno: "", responsavelNome: ultimoNome(), observacao: "" });
  const [tentou, setTentou] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [existente, setExistente] = useState<Existente | null>(null);
  // A mesma chave é reutilizada se o envio precisar ser repetido: o servidor não duplica.
  const [token] = useState(novoToken);

  const carregar = () => {
    setFalha(null);
    api.config().then(setConfig, (e: FalhaApi) => setFalha(e.message));
  };
  useEffect(carregar, []);

  async function criar() {
    setTentou(true);
    setExistente(null);
    if (Object.keys(faltasIdentificacao(valor)).length) return;
    setEnviando(true);
    setFalha(null);
    try {
      const { fechamento } = await api.criar(valor, token);
      guardarNome(fechamento.responsavelNome);
      lembrar(fechamento, token);
      navegar(`/f/${fechamento.id}/abertura`);
    } catch (e) {
      const f = e as FalhaApi;
      if (f.codigo === "FECHAMENTO_EXISTENTE" && f.dados.existente) setExistente(f.dados.existente as Existente);
      else setFalha(f.message);
    } finally {
      setEnviando(false);
    }
  }

  async function abrirExistente(e: Existente) {
    if (tokenDe(e.id)) return navegar(`/f/${e.id}`);
    setEnviando(true);
    setFalha(null);
    try {
      const { fechamento } = await api.acesso(e.id, valor.responsavelNome, token);
      lembrar(fechamento, token);
      navegar(`/f/${e.id}`);
    } catch (erro) {
      setFalha((erro as FalhaApi).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Moldura contexto="Novo fechamento">
      <h1>Identificação</h1>
      <p className="subtitulo">Cada loja tem um único fechamento por data e turno.</p>
      {!config && !falha && <Carregando />}
      {!config && falha && (
        <Aviso tipo="erro">
          <p>{falha}</p>
          <button type="button" className="botao botao-contorno" onClick={carregar}>Tentar de novo</button>
        </Aviso>
      )}
      {config && (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void criar();
          }}
        >
          <FormIdentificacao
            valor={valor}
            lojas={config.lojas}
            mostrarFaltas={tentou}
            aoMudar={(v) => {
              setValor(v);
              setExistente(null);
            }}
          />
          {existente && (
            <Aviso tipo="alerta">
              <p>
                <strong>Já existe um fechamento</strong> para {existente.lojaNome} · {formatarData(existente.dataLocal)} · {NOME_TURNO[existente.turno]} (
                {existente.status === "rascunho" ? "em rascunho" : "finalizado"}). Não é possível criar outro.
              </p>
              <p>
                {tokenDe(existente.id)
                  ? "Ele foi aberto neste aparelho."
                  : "Se foi você quem criou, abra-o com o mesmo nome usado na criação."}
              </p>
              <button type="button" className="botao botao-contorno" disabled={enviando} onClick={() => void abrirExistente(existente)}>
                {tokenDe(existente.id) ? "Abrir o fechamento existente" : `Abrir como ${valor.responsavelNome.trim() || "…"}`}
              </button>
            </Aviso>
          )}
          {falha && <Aviso tipo="erro">{falha}</Aviso>}
          <div className="acoes">
            <Link to="/" className="botao botao-contorno">Voltar</Link>
            <button type="submit" className="botao botao-primario" disabled={enviando}>
              {enviando ? "Verificando…" : "Continuar"}
            </button>
          </div>
        </form>
      )}
    </Moldura>
  );
}
