// Cliente da API. Nada é considerado "salvo" sem a confirmação do servidor.
import type { Alteracao, Fechamento, Forma, ItemConsulta, Lancamento, Loja, Parametros, Turno, Usuario } from "@dominio/tipos.ts";

const BASE = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, "") ?? "/api";

/** Falha de uma chamada. `status` 0 significa que não houve resposta (rede). */
export class FalhaApi extends Error {
  constructor(
    public status: number,
    public codigo: string,
    mensagem: string,
    public dados: Record<string, any> = {},
  ) {
    super(mensagem);
  }
  get semResposta(): boolean {
    return this.status === 0 || this.status >= 500;
  }
}

async function pedir<T>(metodo: string, caminho: string, corpo?: unknown, cabecalhos: Record<string, string> = {}): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(BASE + caminho, {
      method: metodo,
      headers: { ...(corpo === undefined ? {} : { "content-type": "application/json" }), ...cabecalhos },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
  } catch {
    throw new FalhaApi(0, "SEM_CONEXAO", "Sem conexão com o servidor. Verifique a internet e tente de novo.");
  }
  let dados: any = null;
  try {
    dados = await resposta.json();
  } catch { /* resposta sem JSON */ }
  if (!resposta.ok) {
    throw new FalhaApi(resposta.status, dados?.codigo ?? "ERRO", dados?.mensagem ?? "Não foi possível concluir. Tente de novo.", dados ?? {});
  }
  return dados as T;
}

export interface Config {
  lojas: Loja[];
  formas: Forma[];
  parametros: Parametros;
  /** Na configuração pública, só os ativos; na do ADM, todos. */
  usuarios: Usuario[];
}

export interface Identificacao {
  lojaId: string;
  dataLocal: string;
  turno: Turno | "";
  responsavelNome: string;
  observacao: string;
}

export interface DadosRascunho extends Identificacao {
  aberturaCentavos: number | null;
  houveSangria: boolean | null;
  sangriaCentavos: number;
  lancamentos: Lancamento[];
}

export interface Confirmacao {
  dinheiroLancarCentavos: number;
  totalLancarCentavos: number;
}

export interface CorpoCorrecao {
  requisicaoId: string;
  versaoEsperada: number;
  autorDeclarado: string;
  motivo: string;
  observacao: string;
  aberturaCentavos: number | null;
  houveSangria: boolean | null;
  sangriaCentavos: number;
  lancamentos: Lancamento[];
  confirmacao: Confirmacao;
}

export type CorpoEdicaoAdm = Omit<CorpoCorrecao, "requisicaoId" | "autorDeclarado">;

export interface SessaoAdm {
  token: string;
  usuario: string;
  exigeTrocaSenha: boolean;
  expiraEm: string;
}

export interface Filtros {
  loja: string;
  de: string;
  ate: string;
  turno: string;
  responsavel: string;
  status: string;
  corrigido: string;
  ordem: "asc" | "desc";
}

type ComFechamento = { fechamento: Fechamento };
const t = (token: string) => ({ "x-fechamento-token": token });
const a = (token: string) => ({ "x-admin-sessao": token });

export const api = {
  config: () => pedir<Config>("GET", "/config"),
  criar: (ident: Identificacao, token: string) => pedir<ComFechamento>("POST", "/fechamentos", { ...ident, token }),
  acesso: (id: string, nome: string, token: string) => pedir<ComFechamento>("POST", `/fechamentos/${id}/acesso`, { nome, token }),
  obter: (id: string, token: string) => pedir<ComFechamento>("GET", `/fechamentos/${id}`, undefined, t(token)),
  salvar: (id: string, token: string, dados: DadosRascunho, revisao: number) =>
    pedir<ComFechamento & { aplicado: boolean }>("PUT", `/fechamentos/${id}/rascunho`, { ...dados, revisao }, t(token)),
  finalizar: (id: string, token: string, revisao: number, confirmacao: Confirmacao) =>
    pedir<ComFechamento>("POST", `/fechamentos/${id}/finalizar`, { revisao, confirmacao }, t(token)),
  corrigir: (id: string, token: string, corpo: CorpoCorrecao) => pedir<ComFechamento>("POST", `/fechamentos/${id}/corrigir`, corpo, t(token)),

  adm: {
    entrar: (usuario: string, senha: string) => pedir<SessaoAdm>("POST", "/admin/sessao", { usuario, senha }),
    sessao: (s: string) => pedir<Omit<SessaoAdm, "token">>("GET", "/admin/sessao", undefined, a(s)),
    sair: (s: string) => pedir<unknown>("DELETE", "/admin/sessao", undefined, a(s)),
    encerrarSessoes: (s: string) => pedir<unknown>("POST", "/admin/sessoes/encerrar", {}, a(s)),
    trocarSenha: (s: string, senhaAtual: string, novaSenha: string) => pedir<unknown>("POST", "/admin/trocar-senha", { senhaAtual, novaSenha }, a(s)),
    consultar: (s: string, f: Filtros) =>
      pedir<{ itens: ItemConsulta[]; truncado: boolean }>("GET", `/admin/fechamentos?${new URLSearchParams({ ...f })}`, undefined, a(s)),
    detalhar: (s: string, id: string) =>
      pedir<{ fechamento: Fechamento; historico: Alteracao[]; formas: Forma[] }>("GET", `/admin/fechamentos/${id}`, undefined, a(s)),
    editar: (s: string, id: string, corpo: CorpoEdicaoAdm) => pedir<ComFechamento>("POST", `/admin/fechamentos/${id}/editar`, corpo, a(s)),
    config: (s: string) => pedir<Config>("GET", "/admin/config", undefined, a(s)),
    cadastrarUsuario: (s: string, nome: string, lojaIds: string[]) => pedir<Config>("POST", "/admin/usuarios", { nome, lojaIds }, a(s)),
    alterarUsuario: (s: string, id: string, mudanca: { nome?: string; ativo?: boolean; lojaIds?: string[] }) =>
      pedir<Config>("PUT", `/admin/usuarios/${id}`, mudanca, a(s)),
    cadastrar: (s: string, qual: "lojas" | "formas-pagamento", nome: string) => pedir<Config>("POST", `/admin/${qual}`, { nome }, a(s)),
    alterar: (s: string, qual: "lojas" | "formas-pagamento", id: string, mudanca: { nome?: string; ativa?: boolean }) =>
      pedir<Config>("PUT", `/admin/${qual}/${id}`, mudanca, a(s)),
    ordenarFormas: (s: string, ids: string[]) => pedir<Config>("PUT", "/admin/formas-pagamento-ordem", { ids }, a(s)),
    salvarParametros: (s: string, p: Partial<Parametros>) => pedir<Config>("PUT", "/admin/parametros", p, a(s)),
  },
};
