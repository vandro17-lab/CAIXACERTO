import { Link } from "react-router-dom";
import { formatarData, NOME_TURNO } from "@dominio/tipos.ts";
import { conhecidos } from "../armazenamento.ts";
import { Instalar } from "../componentes/Instalar.tsx";
import { Etiqueta, LEMA, Logo } from "../componentes/Moldura.tsx";

export function Inicio() {
  const recentes = conhecidos().slice(0, 6);
  return (
    <div className="app">
      <main className="conteudo inicio">
        <header className="inicio-topo">
          <Logo tamanho={132} />
          <div>
            <h1>Fechamento de caixa</h1>
            <p className="inicio-lema">{LEMA}</p>
          </div>
        </header>

        <Link to="/novo" className="botao botao-primario botao-enorme">
          <svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          Novo fechamento
        </Link>

        {recentes.length > 0 && (
          <section className="bloco" aria-labelledby="recentes">
            <h2 id="recentes" className="bloco-titulo">Neste aparelho</h2>
            <ul className="lista-cartoes">
              {recentes.map((c) => (
                <li key={c.id}>
                  <Link to={`/f/${c.id}`} className="cartao-linha">
                    <span className="cartao-principal">
                      <strong>{c.lojaNome}</strong>
                      <span>{formatarData(c.dataLocal)} · {NOME_TURNO[c.turno]} · {c.responsavelNome}</span>
                    </span>
                    {c.status === "rascunho" ? (
                      <Etiqueta cor="ambar">Rascunho — continuar</Etiqueta>
                    ) : c.corrigido ? (
                      <Etiqueta>Corrigido — bloqueado</Etiqueta>
                    ) : (
                      <Etiqueta cor="verde">Finalizado</Etiqueta>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="bloco" aria-labelledby="adm">
          <h2 id="adm" className="bloco-titulo">Administração</h2>
          <div className="dupla">
            <Link to="/admin/consultas" className="botao botao-contorno botao-alto">
              <Cadeado /> Consultas
            </Link>
            <Link to="/admin/configuracoes" className="botao botao-contorno botao-alto">
              <Cadeado /> Configurações
            </Link>
          </div>
          <p className="nota">Consultas e Configurações pedem a senha do administrador.</p>
        </section>

        <Instalar />
      </main>
    </div>
  );
}

function Cadeado() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="3" y="7" width="10" height="7" rx="1.6" fill="currentColor" />
      <path d="M5.2 7V5a2.8 2.8 0 015.6 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}
