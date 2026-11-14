import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { NOME_TURNO, TURNOS } from "@dominio/tipos.ts";
import { api, FalhaApi } from "../../api.ts";
import type { Config } from "../../api.ts";
import { MolduraAdm, useAdm } from "../../adm.tsx";
import { Aviso, Carregando, Etiqueta } from "../../componentes/Moldura.tsx";

interface Item {
  id: string;
  nome: string;
  ativa: boolean;
}

export function Configuracoes() {
  const { chamar, definir } = useAdm();
  const [config, setConfig] = useState<Config | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  /** Executa uma alteração e mostra o estado devolvido pelo servidor. */
  async function aplicar(fn: (token: string) => Promise<Config>): Promise<boolean> {
    setOcupado(true);
    setFalha(null);
    try {
      setConfig(await chamar(fn));
      return true;
    } catch (e) {
      setFalha((e as FalhaApi).message);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  useEffect(() => {
    chamar((t) => api.adm.config(t)).then(setConfig, (e: FalhaApi) => setFalha(e.message));
  }, [chamar]);

  if (!config) return <MolduraAdm>{falha ? <Aviso tipo="erro">{falha}</Aviso> : <Carregando />}</MolduraAdm>;

  const formas = config.formas.map((f) => ({ id: f.formaId, nome: f.nome, ativa: f.ativa }));
  const mover = (i: number, passo: number) => {
    const ids = formas.map((f) => f.id);
    [ids[i], ids[i + passo]] = [ids[i + passo], ids[i]];
    void aplicar((t) => api.adm.ordenarFormas(t, ids));
  };

  return (
    <MolduraAdm>
      <h1>Configurações</h1>
      {falha && <Aviso tipo="erro">{falha}</Aviso>}

      <section className="bloco">
        <h2>Lojas</h2>
        <p className="nota">Lojas desativadas continuam no histórico, mas não aparecem em novos fechamentos.</p>
        <ListaEditavel
          itens={config.lojas.map((l) => ({ id: l.lojaId, nome: l.nome, ativa: l.ativa }))}
          ocupado={ocupado}
          rotuloNovo="Nova loja"
          aoAlterar={(id, m) => aplicar((t) => api.adm.alterar(t, "lojas", id, m))}
          aoCadastrar={(nome) => aplicar((t) => api.adm.cadastrar(t, "lojas", nome))}
        />
      </section>

      <section className="bloco">
        <h2>Usuários</h2>
        <p className="nota">
          Só quem está cadastrado aqui pode abrir ou corrigir um fechamento, e apenas nas lojas marcadas.
          Usuários desativados continuam nos fechamentos antigos, mas somem da lista de nomes.
        </p>
        <Usuarios config={config} ocupado={ocupado} aplicar={aplicar} />
      </section>

      <section className="bloco">
        <h2>Formas de pagamento</h2>
        <p className="nota">A ordem daqui é a ordem das colunas e do resumo. Renomear não altera fechamentos já finalizados.</p>
        <ListaEditavel
          itens={formas}
          ocupado={ocupado}
          rotuloNovo="Nova forma de pagamento"
          aoAlterar={(id, m) => aplicar((t) => api.adm.alterar(t, "formas-pagamento", id, m))}
          aoCadastrar={(nome) => aplicar((t) => api.adm.cadastrar(t, "formas-pagamento", nome))}
          aoMover={mover}
        />
      </section>

      <section className="bloco">
        <h2>Exibição e impressão</h2>
        <label className="confirmacao">
          <input type="checkbox" checked={config.parametros.mostrarZerados} disabled={ocupado} onChange={(e) => void aplicar((t) => api.adm.salvarParametros(t, { mostrarZerados: e.target.checked }))} />
          <span>Mostrar no resumo final as formas de pagamento com R$ 0,00</span>
        </label>
        <label className="confirmacao">
          <input type="checkbox" checked={config.parametros.imprimirMemoria} disabled={ocupado} onChange={(e) => void aplicar((t) => api.adm.salvarParametros(t, { imprimirMemoria: e.target.checked }))} />
          <span>Incluir a memória do cálculo na impressão</span>
        </label>
      </section>

      <section className="bloco">
        <h2>Turnos</h2>
        <p className="etiquetas">{TURNOS.map((t) => <Etiqueta key={t}>{NOME_TURNO[t]}</Etiqueta>)}</p>
        <p className="nota">Os turnos são fixos nesta versão.</p>
      </section>

      <section className="bloco">
        <h2>Fórmula do dinheiro</h2>
        <p className="formula">Dinheiro a lançar = Dinheiro contado − (Abertura − Sangria de troco)</p>
        <p className="nota">Regra v1, fiel à planilha original. Não é editável: uma mudança exige nova versão documentada da regra.</p>
      </section>

      <section className="bloco">
        <h2>Segurança</h2>
        <div className="acoes">
          <Link to="/admin/trocar-senha" state={{ destino: "/admin/configuracoes" }} className="botao botao-contorno">Alterar senha do ADM</Link>
          <button
            type="button"
            className="botao botao-contorno"
            disabled={ocupado}
            onClick={() => {
              if (!window.confirm("Encerrar todas as sessões do administrador, inclusive esta?")) return;
              void chamar((t) => api.adm.encerrarSessoes(t)).then(() => definir(null), (e: FalhaApi) => setFalha(e.message));
            }}
          >
            Encerrar todas as sessões
          </button>
        </div>
      </section>
    </MolduraAdm>
  );
}

interface ListaProps {
  itens: Item[];
  ocupado: boolean;
  rotuloNovo: string;
  aoAlterar(id: string, mudanca: { nome?: string; ativa?: boolean }): Promise<boolean>;
  aoCadastrar(nome: string): Promise<boolean>;
  aoMover?(indice: number, passo: number): void;
}

function ListaEditavel({ itens, ocupado, rotuloNovo, aoAlterar, aoCadastrar, aoMover }: ListaProps) {
  const [novo, setNovo] = useState("");
  return (
    <>
      <ul className="lista-config">
        {itens.map((item, i) => (
          <li key={item.id} className={item.ativa ? "" : "inativa"}>
            <input
              key={item.nome}
              className="entrada"
              defaultValue={item.nome}
              aria-label={`Nome de ${item.nome}`}
              maxLength={60}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              onBlur={async (e) => {
                const campo = e.currentTarget;
                const nome = campo.value.trim();
                if (!nome || nome === item.nome || !(await aoAlterar(item.id, { nome }))) campo.value = item.nome;
              }}
            />
            {aoMover && (
              <span className="mover">
                <button type="button" className="botao-icone" disabled={ocupado || i === 0} aria-label={`Subir ${item.nome}`} onClick={() => aoMover(i, -1)}>↑</button>
                <button type="button" className="botao-icone" disabled={ocupado || i === itens.length - 1} aria-label={`Descer ${item.nome}`} onClick={() => aoMover(i, 1)}>↓</button>
              </span>
            )}
            <label className="chave">
              <input type="checkbox" checked={item.ativa} disabled={ocupado} onChange={(e) => void aoAlterar(item.id, { ativa: e.target.checked })} />
              <span>{item.ativa ? "Ativa" : "Desativada"}</span>
            </label>
          </li>
        ))}
      </ul>
      <form
        className="novo-item"
        onSubmit={async (e) => {
          e.preventDefault();
          if (novo.trim() && (await aoCadastrar(novo.trim()))) setNovo("");
        }}
      >
        <input className="entrada" value={novo} maxLength={60} placeholder={rotuloNovo} aria-label={rotuloNovo} onChange={(e) => setNovo(e.target.value)} />
        <button type="submit" className="botao botao-contorno" disabled={ocupado || !novo.trim()}>Adicionar</button>
      </form>
    </>
  );
}

interface UsuariosProps {
  config: Config;
  ocupado: boolean;
  aplicar(fn: (token: string) => Promise<Config>): Promise<boolean>;
}

/** Cadastro de usuários (funcionários) com as lojas de cada um e filtro por loja. */
function Usuarios({ config, ocupado, aplicar }: UsuariosProps) {
  const [filtro, setFiltro] = useState("");
  const [nome, setNome] = useState("");
  const [lojasNovas, setLojasNovas] = useState<string[]>([]);
  const lojas = config.lojas.filter((l) => l.ativa);
  const visiveis = config.usuarios.filter((u) => !filtro || u.lojaIds.includes(filtro));
  const alternar = (lista: string[], id: string) => (lista.includes(id) ? lista.filter((x) => x !== id) : [...lista, id]);
  const lojasDoNovo = lojasNovas.length ? lojasNovas : filtro ? [filtro] : [];

  return (
    <>
      <label className="campo filtro-usuarios">
        <span className="campo-rotulo">Mostrar usuários da loja</span>
        <select className="entrada" value={filtro} onChange={(e) => setFiltro(e.target.value)}>
          <option value="">Todas as lojas</option>
          {config.lojas.map((l) => <option key={l.lojaId} value={l.lojaId}>{l.nome}{l.ativa ? "" : " (desativada)"}</option>)}
        </select>
      </label>
      {visiveis.length === 0 && (
        <p className="vazio">{config.usuarios.length ? "Nenhum usuário nesta loja." : "Nenhum usuário cadastrado ainda. Cadastre abaixo quem faz fechamento em cada loja."}</p>
      )}
      <ul className="lista-config lista-usuarios">
        {visiveis.map((u) => (
          <li key={u.usuarioId} className={u.ativo ? "" : "inativa"}>
            <input
              key={u.nome}
              className="entrada"
              defaultValue={u.nome}
              aria-label={`Nome de ${u.nome}`}
              maxLength={60}
              onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
              onBlur={async (e) => {
                const campo = e.currentTarget;
                const novo = campo.value.trim();
                if (!novo || novo === u.nome || !(await aplicar((t) => api.adm.alterarUsuario(t, u.usuarioId, { nome: novo })))) campo.value = u.nome;
              }}
            />
            <span className="lojas-usuario" role="group" aria-label={`Lojas de ${u.nome}`}>
              {lojas.map((l) => (
                <label key={l.lojaId} className="marca-loja">
                  <input
                    type="checkbox"
                    checked={u.lojaIds.includes(l.lojaId)}
                    disabled={ocupado}
                    onChange={() => void aplicar((t) => api.adm.alterarUsuario(t, u.usuarioId, { lojaIds: alternar(u.lojaIds, l.lojaId) }))}
                  />
                  <span>{l.nome}</span>
                </label>
              ))}
            </span>
            <label className="chave">
              <input type="checkbox" checked={u.ativo} disabled={ocupado} onChange={(e) => void aplicar((t) => api.adm.alterarUsuario(t, u.usuarioId, { ativo: e.target.checked }))} />
              <span>{u.ativo ? "Ativo" : "Desativado"}</span>
            </label>
          </li>
        ))}
      </ul>
      <form
        className="novo-item novo-usuario"
        onSubmit={async (e) => {
          e.preventDefault();
          if (nome.trim().length < 2 || !lojasDoNovo.length) return;
          if (await aplicar((t) => api.adm.cadastrarUsuario(t, nome.trim(), lojasDoNovo))) {
            setNome("");
            setLojasNovas([]);
          }
        }}
      >
        <input className="entrada" value={nome} maxLength={60} placeholder="Nome do novo usuário" aria-label="Nome do novo usuário" onChange={(e) => setNome(e.target.value)} />
        <span className="lojas-usuario" role="group" aria-label="Lojas do novo usuário">
          {lojas.map((l) => (
            <label key={l.lojaId} className="marca-loja">
              <input type="checkbox" checked={lojasDoNovo.includes(l.lojaId)} onChange={() => setLojasNovas(alternar(lojasDoNovo, l.lojaId))} />
              <span>{l.nome}</span>
            </label>
          ))}
        </span>
        <button type="submit" className="botao botao-contorno" disabled={ocupado || nome.trim().length < 2 || !lojasDoNovo.length}>Adicionar</button>
      </form>
      {nome.trim().length >= 2 && !lojasDoNovo.length && <p className="nota">Marque ao menos uma loja para o novo usuário.</p>}
    </>
  );
}
