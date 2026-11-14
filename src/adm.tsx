import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { Navigate, NavLink, useLocation, useNavigate } from "react-router-dom";
import { api, FalhaApi } from "./api.ts";
import { guardarSessaoAdm, lerSessaoAdm } from "./armazenamento.ts";
import { Moldura } from "./componentes/Moldura.tsx";

const Contexto = createContext<{ token: string | null; definir(token: string | null): void }>({ token: null, definir: () => {} });

export function ProvedorAdm({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(lerSessaoAdm);
  const definir = useCallback((t: string | null) => {
    guardarSessaoAdm(t);
    setToken(t);
  }, []);
  return <Contexto.Provider value={{ token, definir }}>{children}</Contexto.Provider>;
}

/**
 * Sessão ADM. `chamar` executa uma chamada autenticada; se o servidor recusar a sessão,
 * volta para o login, e se a senha inicial ainda não foi trocada, leva à troca.
 */
export function useAdm() {
  const { token, definir } = useContext(Contexto);
  const navegar = useNavigate();
  const chamar = useCallback(
    async <T,>(fn: (token: string) => Promise<T>): Promise<T> => {
      try {
        return await fn(token ?? "");
      } catch (e) {
        if (e instanceof FalhaApi && e.codigo === "SESSAO_INVALIDA") definir(null);
        if (e instanceof FalhaApi && e.codigo === "TROCA_SENHA_OBRIGATORIA") navegar("/admin/trocar-senha", { replace: true });
        throw e;
      }
    },
    [token, definir, navegar],
  );
  return { token, definir, chamar };
}

/** Só mostra o conteúdo com sessão ADM; sem ela, abre a autenticação e depois volta para cá. */
export function RotaAdm({ children }: { children: ReactNode }) {
  const { token } = useContext(Contexto);
  const local = useLocation();
  if (!token) return <Navigate replace to="/admin/entrar" state={{ destino: local.pathname }} />;
  return <>{children}</>;
}

export function MolduraAdm({ children }: { children: ReactNode }) {
  const { token, definir } = useAdm();
  return (
    <Moldura
      larga
      contexto="Administração"
      lado={
        <nav className="nav-adm nao-imprimir" aria-label="Administração">
          <NavLink to="/admin/consultas">Consultas</NavLink>
          <NavLink to="/admin/configuracoes">Configurações</NavLink>
          <button
            type="button"
            className="link"
            onClick={() => {
              if (token) api.adm.sair(token).catch(() => {});
              definir(null);
            }}
          >
            Sair
          </button>
        </nav>
      }
    >
      {children}
    </Moldura>
  );
}
