import { useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { api, FalhaApi } from "../../api.ts";
import { useAdm } from "../../adm.tsx";
import { Aviso, Moldura } from "../../componentes/Moldura.tsx";

const destinoDe = (estado: unknown) => (estado as { destino?: string } | null)?.destino ?? "/admin/consultas";

/** Autenticação do administrador. A senha é conferida somente no servidor. */
export function Entrar() {
  const { token, definir } = useAdm();
  const navegar = useNavigate();
  const destino = destinoDe(useLocation().state);
  const [usuario, setUsuario] = useState("ADM");
  const [senha, setSenha] = useState("");
  const [falha, setFalha] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [entrou, setEntrou] = useState(false);

  if (token && !entrou) return <Navigate replace to={destino} />;

  async function entrar() {
    setEnviando(true);
    setFalha(null);
    try {
      const s = await api.adm.entrar(usuario, senha);
      setEntrou(true);
      definir(s.token);
      navegar(s.exigeTrocaSenha ? "/admin/trocar-senha" : destino, { replace: true, state: { destino } });
    } catch (e) {
      setFalha((e as FalhaApi).message);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Moldura contexto="Administração">
      <h1>Entrar como administrador</h1>
      <p className="subtitulo">Consultas e Configurações são restritas ao administrador.</p>
      <form
        className="formulario estreito"
        onSubmit={(e) => {
          e.preventDefault();
          void entrar();
        }}
      >
        <div className="campo">
          <label className="campo-rotulo" htmlFor="adm-usuario">Usuário</label>
          <input id="adm-usuario" className="entrada" autoComplete="username" value={usuario} onChange={(e) => setUsuario(e.target.value)} />
        </div>
        <div className="campo">
          <label className="campo-rotulo" htmlFor="adm-senha">Senha</label>
          <input id="adm-senha" className="entrada" type="password" autoComplete="current-password" autoFocus value={senha} onChange={(e) => setSenha(e.target.value)} />
        </div>
        {falha && <Aviso tipo="erro">{falha}</Aviso>}
        <div className="acoes">
          <Link to="/" className="botao botao-contorno">Voltar</Link>
          <button type="submit" className="botao botao-primario" disabled={enviando || !usuario.trim() || !senha}>
            {enviando ? "Entrando…" : "Entrar"}
          </button>
        </div>
      </form>
    </Moldura>
  );
}

/** Troca de senha — obrigatória no primeiro acesso, enquanto valer a senha inicial. */
export function TrocarSenha() {
  const { token, chamar } = useAdm();
  const navegar = useNavigate();
  const destino = destinoDe(useLocation().state);
  const [atual, setAtual] = useState("");
  const [nova, setNova] = useState("");
  const [repetida, setRepetida] = useState("");
  const [falha, setFalha] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const diferente = repetida.length > 0 && nova !== repetida;

  async function trocar() {
    setEnviando(true);
    setFalha(null);
    try {
      await chamar((t) => api.adm.trocarSenha(t, atual, nova));
      navegar(destino, { replace: true });
    } catch (e) {
      setFalha((e as FalhaApi).message);
    } finally {
      setEnviando(false);
    }
  }

  if (!token) return <Navigate replace to="/admin/entrar" />;
  return (
    <Moldura contexto="Administração">
      <h1>Trocar a senha do administrador</h1>
      <p className="subtitulo">A senha inicial é provisória. Escolha uma senha com pelo menos 8 caracteres antes de continuar.</p>
      <form
        className="formulario estreito"
        onSubmit={(e) => {
          e.preventDefault();
          void trocar();
        }}
      >
        <div className="campo">
          <label className="campo-rotulo" htmlFor="senha-atual">Senha atual</label>
          <input id="senha-atual" className="entrada" type="password" autoComplete="current-password" autoFocus value={atual} onChange={(e) => setAtual(e.target.value)} />
        </div>
        <div className="campo">
          <label className="campo-rotulo" htmlFor="senha-nova">Nova senha</label>
          <input id="senha-nova" className="entrada" type="password" autoComplete="new-password" minLength={8} value={nova} onChange={(e) => setNova(e.target.value)} />
        </div>
        <div className="campo">
          <label className="campo-rotulo" htmlFor="senha-repetida">Repita a nova senha</label>
          <input id="senha-repetida" className={`entrada${diferente ? " com-erro" : ""}`} type="password" autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
          {diferente && <p className="campo-erro" role="alert">As senhas não são iguais.</p>}
        </div>
        {falha && <Aviso tipo="erro">{falha}</Aviso>}
        <div className="acoes">
          <Link to="/" className="botao botao-contorno">Início</Link>
          <button type="submit" className="botao botao-primario" disabled={enviando || !atual || nova.length < 8 || nova !== repetida}>
            {enviando ? "Gravando…" : "Trocar senha"}
          </button>
        </div>
      </form>
    </Moldura>
  );
}
