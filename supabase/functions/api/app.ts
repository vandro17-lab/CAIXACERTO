// Roteador da API do Caixa Certo: (Request) => Response, sem depender de plataforma.
import * as adm from "./admin.ts";
import * as fech from "./fechamentos.ts";
import { ErroHttp, json } from "./infra.ts";
import type { Ctx, Deps, Linha } from "./infra.ts";

type Rota = [metodo: string, padrao: RegExp, executar: (c: Ctx, ...partes: string[]) => Promise<Response>];

const ID = "([A-Za-z0-9_-]{1,80})";

const ROTAS: Rota[] = [
  ["GET", /^\/config$/, config],
  ["POST", /^\/fechamentos$/, fech.criar],
  ["GET", new RegExp(`^/fechamentos/${ID}$`), fech.obter],
  ["POST", new RegExp(`^/fechamentos/${ID}/acesso$`), fech.acesso],
  ["PUT", new RegExp(`^/fechamentos/${ID}/rascunho$`), fech.salvarRascunho],
  ["POST", new RegExp(`^/fechamentos/${ID}/abertura$`), fech.conferirAbertura],
  ["POST", new RegExp(`^/fechamentos/${ID}/finalizar$`), fech.finalizar],
  ["POST", new RegExp(`^/fechamentos/${ID}/corrigir$`), fech.corrigir],
  ["POST", /^\/admin\/sessao$/, adm.entrar],
  ["GET", /^\/admin\/sessao$/, adm.sessaoAtual],
  ["DELETE", /^\/admin\/sessao$/, adm.sair],
  ["POST", /^\/admin\/sessoes\/encerrar$/, adm.encerrarSessoes],
  ["POST", /^\/admin\/trocar-senha$/, adm.trocarSenha],
  ["GET", /^\/admin\/fechamentos$/, adm.consultar],
  ["GET", new RegExp(`^/admin/fechamentos/${ID}$`), adm.detalhar],
  ["POST", new RegExp(`^/admin/fechamentos/${ID}/editar$`), adm.editar],
  ["POST", new RegExp(`^/admin/fechamentos/${ID}/excluir$`), adm.excluir],
  ["GET", /^\/admin\/config$/, adm.lerConfig],
  ["POST", /^\/admin\/usuarios$/, adm.cadastrarUsuario],
  ["PUT", new RegExp(`^/admin/usuarios/${ID}$`), adm.alterarUsuario],
  ["POST", /^\/admin\/lojas$/, (c) => adm.cadastrar(c, "lojas")],
  ["PUT", new RegExp(`^/admin/lojas/${ID}$`), (c, id) => adm.alterar(c, "lojas", id)],
  ["POST", /^\/admin\/formas-pagamento$/, (c) => adm.cadastrar(c, "formas")],
  ["PUT", new RegExp(`^/admin/formas-pagamento/${ID}$`), (c, id) => adm.alterar(c, "formas", id)],
  ["PUT", /^\/admin\/formas-pagamento-ordem$/, adm.ordenarFormas],
  ["PUT", /^\/admin\/parametros$/, adm.salvarParametros],
  ["PUT", /^\/admin\/senha-gerente$/, adm.salvarSenhaGerente],
];

/** GET /config — o que a tela de novo fechamento precisa: lojas, formas, usuários ativos e parâmetros. */
async function config(c: Ctx): Promise<Response> {
  // As leituras são independentes: vão ao banco ao mesmo tempo.
  const [lojas, formas, parametros, usuarios] = await Promise.all([
    adm.lojasTodas(c.sql),
    fech.formasTodas(c.sql),
    adm.lerParametros(c.sql),
    adm.usuariosTodos(c.sql),
  ]);
  return json(200, { lojas: lojas.filter((l) => l.ativa), formas, parametros, usuarios: usuarios.filter((u) => u.ativo) });
}

async function lerCorpo(req: Request): Promise<Linha> {
  if (req.method === "GET" || req.method === "DELETE") return {};
  const bruto = await req.text();
  if (bruto.length > 400_000) throw new ErroHttp(413, "GRANDE_DEMAIS", "Requisição grande demais.");
  try {
    const corpo = bruto ? JSON.parse(bruto) : {};
    if (corpo && typeof corpo === "object" && !Array.isArray(corpo)) return corpo;
  } catch { /* cai no erro abaixo */ }
  throw new ErroHttp(400, "JSON_INVALIDO", "Requisição inválida.");
}

export function criarApp(deps: Deps): (req: Request) => Promise<Response> {
  const cors = (req: Request, resp: Response): Response => {
    const origem = req.headers.get("origin") ?? "";
    const livre = !deps.origens?.length;
    if (livre || deps.origens!.includes(origem)) {
      resp.headers.set("access-control-allow-origin", livre ? "*" : origem);
      resp.headers.set("vary", "origin");
    }
    resp.headers.set("access-control-allow-methods", "GET, POST, PUT, DELETE, OPTIONS");
    resp.headers.set("access-control-allow-headers", "content-type, x-fechamento-token, x-admin-sessao, authorization, apikey, x-client-info");
    resp.headers.set("access-control-max-age", "86400");
    return resp;
  };

  return async (req) => {
    if (req.method === "OPTIONS") return cors(req, new Response(null, { status: 204 }));
    try {
      const url = new URL(req.url);
      // A função é publicada em /functions/v1/api/...; aqui só interessa o que vem depois de /api.
      const caminho = url.pathname.replace(/^.*?\/api(?=\/|$)/, "").replace(/\/+$/, "") || "/";
      for (const [metodo, padrao, executar] of ROTAS) {
        const m = req.method === metodo && padrao.exec(caminho);
        if (!m) continue;
        const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "desconhecido";
        const ctx: Ctx = { req, sql: deps.sql, deps, ip, url, corpo: await lerCorpo(req) };
        return cors(req, await executar(ctx, ...m.slice(1)));
      }
      throw new ErroHttp(404, "ROTA_INEXISTENTE", "Rota não encontrada.");
    } catch (e) {
      if (e instanceof ErroHttp) return cors(req, json(e.status, { codigo: e.codigo, mensagem: e.message, ...e.extra }));
      // Violação de unicidade que escapou das checagens (corrida entre duas requisições).
      if ((e as Linha)?.code === "23505") {
        return cors(req, json(409, { codigo: "CONFLITO", mensagem: "Já existe um registro com esses dados. Recarregue e tente de novo." }));
      }
      console.error("Erro interno:", e);
      return cors(req, json(500, { codigo: "ERRO_INTERNO", mensagem: "Erro interno. Tente de novo em instantes." }));
    }
  };
}
