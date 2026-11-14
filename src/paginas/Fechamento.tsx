import { useCallback, useEffect, useState } from "react";
import { Link, Route, Routes, useParams } from "react-router-dom";
import type { Fechamento } from "@dominio/tipos.ts";
import { api, FalhaApi } from "../api.ts";
import type { Config } from "../api.ts";
import { lembrar, novoToken, tokenDe, ultimoNome } from "../armazenamento.ts";
import { Aviso, Carregando, Moldura } from "../componentes/Moldura.tsx";
import { Assistente } from "./Assistente.tsx";
import { Correcao } from "./Correcao.tsx";
import { Resultado } from "./Resultado.tsx";

/** Carrega o fechamento do servidor e mostra o rascunho, o resultado ou a correção. */
export function PaginaFechamento() {
  const { id = "" } = useParams();
  const [token, setToken] = useState(() => tokenDe(id));
  const [dados, setDados] = useState<{ f: Fechamento; config: Config; carga: number } | null>(null);
  const [falha, setFalha] = useState<FalhaApi | null>(null);

  const carregar = useCallback(async () => {
    if (!token) return;
    setFalha(null);
    try {
      const [{ fechamento }, config] = await Promise.all([api.obter(id, token), api.config()]);
      lembrar(fechamento, token);
      setDados((d) => ({ f: fechamento, config, carga: (d?.carga ?? 0) + 1 }));
    } catch (e) {
      setFalha(e as FalhaApi);
    }
  }, [id, token]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  const atualizar = useCallback(
    (f: Fechamento | null) => {
      if (!f || !token) return void carregar();
      lembrar(f, token);
      setDados((d) => d && { ...d, f, carga: d.carga + 1 });
    },
    [carregar, token],
  );

  if (!token || falha?.codigo === "SEM_ACESSO") {
    return (
      <PedirAcesso
        id={id}
        aoLiberar={(f, novo) => {
          lembrar(f, novo);
          setFalha(null);
          setToken(novo);
        }}
      />
    );
  }
  if (falha) {
    return (
      <Moldura>
        <Aviso tipo="erro">
          <p>{falha.message}</p>
          <div className="acoes">
            <Link to="/" className="botao botao-contorno">Início</Link>
            {falha.status !== 404 && <button type="button" className="botao botao-primario" onClick={() => void carregar()}>Tentar de novo</button>}
          </div>
        </Aviso>
      </Moldura>
    );
  }
  if (!dados) return <Moldura><Carregando texto="Buscando o fechamento no servidor…" /></Moldura>;

  const { f, config } = dados;
  if (f.status === "rascunho") return <Assistente key={dados.carga} inicial={f} config={config} token={token} aoMudarNoServidor={atualizar} />;
  return (
    <Routes>
      <Route path="corrigir" element={<Correcao f={f} config={config} token={token} aoCorrigir={atualizar} />} />
      <Route path="*" element={<Resultado f={f} config={config} />} />
    </Routes>
  );
}

function PedirAcesso({ id, aoLiberar }: { id: string; aoLiberar(f: Fechamento, token: string): void }) {
  const [nome, setNome] = useState(ultimoNome());
  const [falha, setFalha] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [token] = useState(novoToken);

  async function abrir() {
    setEnviando(true);
    setFalha(null);
    try {
      aoLiberar((await api.acesso(id, nome, token)).fechamento, token);
    } catch (e) {
      setFalha((e as FalhaApi).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Moldura>
      <h1>Abrir fechamento</h1>
      <p className="subtitulo">Este aparelho ainda não tem acesso a este fechamento. Informe o nome de quem o criou.</p>
      <form
        className="formulario"
        onSubmit={(e) => {
          e.preventDefault();
          void abrir();
        }}
      >
        <div className="campo">
          <label className="campo-rotulo" htmlFor="acesso-nome">Nome usado na criação</label>
          <input id="acesso-nome" className="entrada" value={nome} maxLength={60} autoFocus onChange={(e) => setNome(e.target.value)} />
        </div>
        {falha && <Aviso tipo="erro">{falha}</Aviso>}
        <div className="acoes">
          <Link to="/" className="botao botao-contorno">Início</Link>
          <button type="submit" className="botao botao-primario" disabled={enviando || nome.trim().length < 1}>
            {enviando ? "Verificando…" : "Abrir"}
          </button>
        </div>
      </form>
    </Moldura>
  );
}
