// Rotas administrativas: sessão ADM, consultas e configurações.
// A senha só existe como hash bcrypt no banco; a conferência é sempre no servidor.
import { ehTurno } from "./dominio/tipos.ts";
import type { Alteracao, ItemConsulta, Parametros, Usuario } from "./dominio/tipos.ts";
import { carregarFechamento, editarComoAdm, formasTodas } from "./fechamentos.ts";
import { ErroHttp, iso, json, limitar, novoId, novoToken, sha256, texto } from "./infra.ts";
import type { Ctx, Linha, Sql } from "./infra.ts";

const HORAS_SESSAO = 8;
// Hash sem senha correspondente: mantém o tempo de resposta quando o usuário não existe.
const HASH_FALSO = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8n1rO6fPpXkq0oY0lGdYvG0m8mW1bS";

interface Sessao {
  sessaoId: string;
  adminId: string;
  usuario: string;
  senhaHash: string;
  exigeTrocaSenha: boolean;
  expiraEm: string;
}

/** Valida a sessão ADM. Enquanto a senha inicial não for trocada, só a troca é permitida. */
export async function exigirAdmin(c: Ctx, permitirSenhaProvisoria = false): Promise<Sessao> {
  const token = c.req.headers.get("x-admin-sessao") ?? "";
  const [s] = /^[a-f0-9]{64}$/.test(token)
    ? await c.sql.q(
        `select s.sessao_id, s.expira_em, a.admin_id, a.usuario, a.senha_hash, a.exige_troca_senha
         from admin_sessoes s join admin_credenciais a on a.admin_id = s.admin_id
         where s.token_hash = $1::text and s.revogada_em is null and s.expira_em > now()`,
        [await sha256(token)],
      )
    : [];
  if (!s) throw new ErroHttp(401, "SESSAO_INVALIDA", "Entre como administrador para continuar.");
  if (s.exige_troca_senha && !permitirSenhaProvisoria) {
    throw new ErroHttp(403, "TROCA_SENHA_OBRIGATORIA", "Troque a senha inicial antes de continuar.");
  }
  return {
    sessaoId: s.sessao_id,
    adminId: s.admin_id,
    usuario: s.usuario,
    senhaHash: s.senha_hash,
    exigeTrocaSenha: s.exige_troca_senha,
    expiraEm: iso(s.expira_em)!,
  };
}

// ---- sessão ---------------------------------------------------------------

/** POST /admin/sessao */
export async function entrar(c: Ctx): Promise<Response> {
  const usuario = texto(c.corpo.usuario, "Usuário", 1, 40);
  const senha = typeof c.corpo.senha === "string" ? c.corpo.senha.slice(0, 200) : "";
  await limitar(c.sql, `login:${c.ip}`, 8, 900);
  const [a] = await c.sql.q("select * from admin_credenciais where upper(usuario) = upper($1::text)", [usuario]);
  const confere = await c.deps.conferirSenha(senha, a?.senha_hash ?? HASH_FALSO);
  if (!a || !confere) throw new ErroHttp(401, "CREDENCIAIS_INVALIDAS", "Usuário ou senha incorretos.");
  await c.sql.q("delete from limites where chave = $1::text", [`login:${c.ip}`]);
  const token = novoToken();
  const [s] = await c.sql.q(
    `insert into admin_sessoes (sessao_id, admin_id, token_hash, expira_em)
     values ($1::text, $2::text, $3::text, now() + ($4::int * interval '1 hour')) returning expira_em`,
    [novoId(), a.admin_id, await sha256(token), HORAS_SESSAO],
  );
  return json(200, { token, usuario: a.usuario, exigeTrocaSenha: a.exige_troca_senha, expiraEm: iso(s.expira_em) });
}

/** GET /admin/sessao */
export async function sessaoAtual(c: Ctx): Promise<Response> {
  const s = await exigirAdmin(c, true);
  return json(200, { usuario: s.usuario, exigeTrocaSenha: s.exigeTrocaSenha, expiraEm: s.expiraEm });
}

/** DELETE /admin/sessao */
export async function sair(c: Ctx): Promise<Response> {
  const s = await exigirAdmin(c, true);
  await c.sql.q("update admin_sessoes set revogada_em = now() where sessao_id = $1::text", [s.sessaoId]);
  return json(200, { ok: true });
}

/** POST /admin/sessoes/encerrar — revoga todas as sessões, inclusive a atual. */
export async function encerrarSessoes(c: Ctx): Promise<Response> {
  const s = await exigirAdmin(c);
  await c.sql.q("update admin_sessoes set revogada_em = now() where admin_id = $1::text and revogada_em is null", [s.adminId]);
  return json(200, { ok: true });
}

/** POST /admin/trocar-senha */
export async function trocarSenha(c: Ctx): Promise<Response> {
  const s = await exigirAdmin(c, true);
  const atual = typeof c.corpo.senhaAtual === "string" ? c.corpo.senhaAtual.slice(0, 200) : "";
  const nova = typeof c.corpo.novaSenha === "string" ? c.corpo.novaSenha : "";
  await limitar(c.sql, `login:${c.ip}`, 8, 900);
  if (!(await c.deps.conferirSenha(atual, s.senhaHash))) {
    throw new ErroHttp(401, "CREDENCIAIS_INVALIDAS", "A senha atual não confere.");
  }
  const fraca = nova.length < 8 || nova.length > 100 || nova === atual || /^(.)\1+$/.test(nova) ||
    nova.toUpperCase() === s.usuario.toUpperCase();
  if (fraca) {
    throw new ErroHttp(422, "SENHA_FRACA", "A nova senha precisa ter ao menos 8 caracteres e ser diferente da atual.");
  }
  await c.sql.q("delete from limites where chave = $1::text", [`login:${c.ip}`]);
  const hash = await c.deps.hashSenha(nova);
  await c.sql.tx(async (t) => {
    await t.q(
      "update admin_credenciais set senha_hash = $2::text, exige_troca_senha = false, atualizado_em = now() where admin_id = $1::text",
      [s.adminId, hash],
    );
    await t.q(
      "update admin_sessoes set revogada_em = now() where admin_id = $1::text and sessao_id <> $2::text and revogada_em is null",
      [s.adminId, s.sessaoId],
    );
  });
  return json(200, { ok: true });
}

// ---- consultas ------------------------------------------------------------

/** GET /admin/fechamentos?loja&de&ate&turno&responsavel&status&corrigido&ordem */
export async function consultar(c: Ctx): Promise<Response> {
  await exigirAdmin(c);
  const p = c.url.searchParams;
  const cond: string[] = [];
  const args: unknown[] = [];
  const filtro = (sql: string, valor: unknown) => {
    args.push(valor);
    cond.push(sql.replace("?", `$${args.length}`));
  };
  const data = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (p.get("loja")) filtro("f.loja_id = ?::text", p.get("loja"));
  if (data(p.get("de") ?? "")) filtro("f.data_local >= ?::text", p.get("de"));
  if (data(p.get("ate") ?? "")) filtro("f.data_local <= ?::text", p.get("ate"));
  if (ehTurno(p.get("turno"))) filtro("f.turno = ?::text", p.get("turno"));
  if (p.get("responsavel")) filtro("f.responsavel_nome ilike '%' || ?::text || '%'", p.get("responsavel")!.replace(/[%_\\]/g, "\\$&"));
  if (p.get("status") === "rascunho" || p.get("status") === "finalizado") filtro("f.status = ?::text", p.get("status"));
  if (p.get("corrigido") === "sim") cond.push("f.quantidade_correcoes = 1");
  if (p.get("corrigido") === "nao") cond.push("f.quantidade_correcoes = 0");
  const ordem = p.get("ordem") === "asc" ? "asc" : "desc";
  const linhas = await c.sql.q(
    `select f.*, l.nome as loja_nome from fechamentos f join lojas l on l.loja_id = f.loja_id
     ${cond.length ? `where ${cond.join(" and ")}` : ""}
     order by f.data_local ${ordem}, case f.turno when 'manha' then 1 when 'tarde' then 2 else 3 end ${ordem}, l.nome
     limit 1001`,
    args,
  );
  const itens: ItemConsulta[] = linhas.slice(0, 1000).map((l) => {
    const snap = l.snapshot_json ? JSON.parse(l.snapshot_json) : null;
    return {
      id: l.fechamento_id,
      lojaId: l.loja_id,
      lojaNome: l.loja_nome,
      dataLocal: l.data_local,
      turno: l.turno,
      responsavelNome: l.responsavel_nome,
      status: l.status,
      versao: l.versao,
      quantidadeCorrecoes: l.quantidade_correcoes,
      quantidadeEdicoesAdm: l.quantidade_edicoes_adm,
      criadoEm: iso(l.criado_em)!,
      finalizadoEm: iso(l.finalizado_em),
      formas: (snap?.formas ?? []).map((f: Linha) => ({ formaId: f.formaId, nome: f.nome, subtotalCentavos: f.subtotalCentavos })),
      dinheiroLancarCentavos: snap ? l.dinheiro_lancar_centavos : null,
      totalLancarCentavos: snap ? l.total_lancar_centavos : null,
      aberturaDivergente: snap?.aberturaDivergente ?? null,
    };
  });
  return json(200, { itens, truncado: linhas.length > 1000 });
}

/** GET /admin/fechamentos/:id — detalhe com lançamentos e histórico (somente leitura). */
export async function detalhar(c: Ctx, id: string): Promise<Response> {
  await exigirAdmin(c);
  const fechamento = await carregarFechamento(c.sql, id);
  const hs = await c.sql.q("select * from historico_alteracoes where fechamento_id = $1::text order by versao_nova", [id]);
  const historico: Alteracao[] = hs.map((h) => ({
    auditoriaId: h.auditoria_id,
    tipo: h.tipo,
    versaoAnterior: h.versao_anterior,
    versaoNova: h.versao_nova,
    autorDeclarado: h.autor_declarado,
    motivo: h.motivo,
    alteradoEm: iso(h.alterado_em)!,
    antes: h.snapshot_antes_json ? JSON.parse(h.snapshot_antes_json) : null,
    depois: JSON.parse(h.snapshot_depois_json),
  }));
  return json(200, { fechamento, historico, formas: await formasTodas(c.sql) });
}

/** POST /admin/fechamentos/:id/editar — o administrador corrige os valores de um fechamento finalizado. */
export async function editar(c: Ctx, id: string): Promise<Response> {
  await exigirAdmin(c);
  return editarComoAdm(c, id);
}

// ---- configurações --------------------------------------------------------

export async function lerParametros(s: Sql): Promise<Parametros> {
  const ps = await s.q("select chave, valor from parametros");
  const v = (k: string) => ps.find((p) => p.chave === k)?.valor !== "false";
  return { mostrarZerados: v("mostrar_zerados"), imprimirMemoria: v("imprimir_memoria") };
}

export async function lojasTodas(s: Sql) {
  const ls = await s.q("select loja_id, nome, ativa from lojas order by nome");
  return ls.map((l) => ({ lojaId: l.loja_id, nome: l.nome, ativa: l.ativa }));
}

export async function usuariosTodos(s: Sql): Promise<Usuario[]> {
  const us = await s.q(
    `select u.usuario_id, u.nome, u.ativo,
       (select coalesce(json_agg(ul.loja_id order by ul.loja_id), '[]'::json)::text
        from usuario_lojas ul where ul.usuario_id = u.usuario_id) as lojas_json
     from usuarios u order by lower(u.nome)`,
  );
  return us.map((u) => ({ usuarioId: u.usuario_id, nome: u.nome, ativo: u.ativo, lojaIds: JSON.parse(u.lojas_json) }));
}

async function configCompleta(c: Ctx): Promise<Response> {
  return json(200, {
    lojas: await lojasTodas(c.sql),
    formas: await formasTodas(c.sql),
    parametros: await lerParametros(c.sql),
    usuarios: await usuariosTodos(c.sql),
    senhaGerenteCadastrada: (await c.sql.q("select 1 as ok from gerente_credencial")).length > 0,
  });
}

// ---- usuários -------------------------------------------------------------

async function lojasValidas(s: Sql, v: unknown): Promise<string[]> {
  if (!Array.isArray(v) || v.length > 200 || v.some((i) => typeof i !== "string")) {
    throw new ErroHttp(422, "DADOS_INVALIDOS", "Lojas: lista inválida.", { campo: "Lojas" });
  }
  const ids = [...new Set(v as string[])];
  if (!ids.length) throw new ErroHttp(422, "DADOS_INVALIDOS", "Lojas: marque ao menos uma loja para o usuário.", { campo: "Lojas" });
  const existentes = new Set((await lojasTodas(s)).map((l) => l.lojaId));
  if (ids.some((i) => !existentes.has(i))) throw new ErroHttp(422, "DADOS_INVALIDOS", "Lojas: loja inexistente.", { campo: "Lojas" });
  return ids;
}

async function exigirNomeDeUsuarioLivre(s: Sql, nome: string, ignorarId = ""): Promise<void> {
  const [igual] = await s.q(
    "select 1 as ok from usuarios where ativo and lower(nome) = lower($1::text) and usuario_id <> $2::text",
    [nome, ignorarId],
  );
  if (igual) throw new ErroHttp(409, "NOME_DUPLICADO", "Já existe um usuário ativo com esse nome.");
}

async function gravarLojasDoUsuario(s: Sql, id: string, lojaIds: string[]): Promise<void> {
  await s.q("delete from usuario_lojas where usuario_id = $1::text", [id]);
  await s.q(
    `insert into usuario_lojas (usuario_id, loja_id)
     select $1::text, x from json_array_elements_text(($2::text)::json) as x`,
    [id, JSON.stringify(lojaIds)],
  );
}

/** POST /admin/usuarios { nome, lojaIds } */
export async function cadastrarUsuario(c: Ctx): Promise<Response> {
  await exigirAdmin(c);
  const nome = texto(c.corpo.nome, "Nome", 2, 60);
  const lojaIds = await lojasValidas(c.sql, c.corpo.lojaIds);
  await exigirNomeDeUsuarioLivre(c.sql, nome);
  const id = `u_${novoId().slice(0, 8)}`;
  await c.sql.tx(async (s) => {
    await s.q("insert into usuarios (usuario_id, nome) values ($1::text, $2::text)", [id, nome]);
    await gravarLojasDoUsuario(s, id, lojaIds);
  });
  return configCompleta(c);
}

/** PUT /admin/usuarios/:id { nome?, ativo?, lojaIds? } — fechamentos antigos guardam o nome da época. */
export async function alterarUsuario(c: Ctx, id: string): Promise<Response> {
  await exigirAdmin(c);
  const [atual] = await c.sql.q("select nome, ativo from usuarios where usuario_id = $1::text", [id]);
  if (!atual) throw new ErroHttp(404, "NAO_ENCONTRADO", "Usuário não encontrado.");
  const nome = c.corpo.nome === undefined ? (atual.nome as string) : texto(c.corpo.nome, "Nome", 2, 60);
  const ativo = typeof c.corpo.ativo === "boolean" ? c.corpo.ativo : (atual.ativo as boolean);
  const lojaIds = c.corpo.lojaIds === undefined ? null : await lojasValidas(c.sql, c.corpo.lojaIds);
  if (ativo) await exigirNomeDeUsuarioLivre(c.sql, nome, id);
  await c.sql.tx(async (s) => {
    await s.q(
      "update usuarios set nome = $2::text, ativo = $3::boolean, atualizado_em = now() where usuario_id = $1::text",
      [id, nome, ativo],
    );
    if (lojaIds) await gravarLojasDoUsuario(s, id, lojaIds);
  });
  return configCompleta(c);
}

/** GET /admin/config */
export async function lerConfig(c: Ctx): Promise<Response> {
  await exigirAdmin(c);
  return configCompleta(c);
}

const TABELAS = {
  lojas: { tabela: "lojas", id: "loja_id", max: 60, atualizada: "atualizada_em", rotulo: "loja" },
  formas: { tabela: "formas_pagamento", id: "forma_id", max: 40, atualizada: "atualizada_em", rotulo: "forma de pagamento" },
} as const;

async function exigirNomeLivre(s: Sql, t: (typeof TABELAS)[keyof typeof TABELAS], nome: string, ignorarId = ""): Promise<void> {
  const [igual] = await s.q(
    `select 1 as ok from ${t.tabela} where ativa and lower(nome) = lower($1::text) and ${t.id} <> $2::text`,
    [nome, ignorarId],
  );
  if (igual) throw new ErroHttp(409, "NOME_DUPLICADO", `Já existe uma ${t.rotulo} ativa com esse nome.`);
}

/** POST /admin/lojas e POST /admin/formas-pagamento */
export async function cadastrar(c: Ctx, qual: keyof typeof TABELAS): Promise<Response> {
  await exigirAdmin(c);
  const t = TABELAS[qual];
  const nome = texto(c.corpo.nome, "Nome", 1, t.max);
  await exigirNomeLivre(c.sql, t, nome);
  const id = `${qual === "lojas" ? "l" : "f"}_${novoId().slice(0, 8)}`;
  if (qual === "lojas") {
    await c.sql.q("insert into lojas (loja_id, nome) values ($1::text, $2::text)", [id, nome]);
  } else {
    await c.sql.q(
      `insert into formas_pagamento (forma_id, nome, ordem)
       select $1::text, $2::text, coalesce(max(ordem), 0) + 1 from formas_pagamento`,
      [id, nome],
    );
  }
  return configCompleta(c);
}

/** PUT /admin/lojas/:id e PUT /admin/formas-pagamento/:id — renomear, ativar ou desativar. O id nunca muda. */
export async function alterar(c: Ctx, qual: keyof typeof TABELAS, id: string): Promise<Response> {
  await exigirAdmin(c);
  const t = TABELAS[qual];
  const [atual] = await c.sql.q(`select nome, ativa from ${t.tabela} where ${t.id} = $1::text`, [id]);
  if (!atual) throw new ErroHttp(404, "NAO_ENCONTRADO", "Registro não encontrado.");
  const nome = c.corpo.nome === undefined ? (atual.nome as string) : texto(c.corpo.nome, "Nome", 1, t.max);
  const ativa = typeof c.corpo.ativa === "boolean" ? c.corpo.ativa : (atual.ativa as boolean);
  if (ativa) await exigirNomeLivre(c.sql, t, nome, id);
  await c.sql.q(
    `update ${t.tabela} set nome = $2::text, ativa = $3::boolean, ${t.atualizada} = now() where ${t.id} = $1::text`,
    [id, nome, ativa],
  );
  return configCompleta(c);
}

/** PUT /admin/formas-pagamento-ordem { ids } */
export async function ordenarFormas(c: Ctx): Promise<Response> {
  await exigirAdmin(c);
  const ids: unknown = c.corpo.ids;
  if (!Array.isArray(ids) || ids.length > 200 || ids.some((i) => typeof i !== "string")) {
    throw new ErroHttp(422, "DADOS_INVALIDOS", "Ordem inválida.");
  }
  await c.sql.q(
    `update formas_pagamento f set ordem = x.ordem::int, atualizada_em = now()
     from json_array_elements_text(($1::text)::json) with ordinality as x(id, ordem) where f.forma_id = x.id`,
    [JSON.stringify(ids)],
  );
  return configCompleta(c);
}

/** PUT /admin/parametros */
export async function salvarParametros(c: Ctx): Promise<Response> {
  await exigirAdmin(c);
  const mapa: Record<string, unknown> = { mostrar_zerados: c.corpo.mostrarZerados, imprimir_memoria: c.corpo.imprimirMemoria };
  for (const [chave, valor] of Object.entries(mapa)) {
    if (typeof valor !== "boolean") continue;
    await c.sql.q(
      `insert into parametros (chave, valor) values ($1::text, $2::text)
       on conflict (chave) do update set valor = excluded.valor`,
      [chave, String(valor)],
    );
  }
  return configCompleta(c);
}

/**
 * PUT /admin/senha-gerente { senha } — cadastra ou troca a senha do gerente (4 dígitos, a mesma para todas as lojas).
 * Só o hash é guardado. A senha libera apenas a divergência de abertura; não abre consultas nem configurações.
 */
export async function salvarSenhaGerente(c: Ctx): Promise<Response> {
  await exigirAdmin(c);
  const senha = c.corpo.senha;
  if (typeof senha !== "string" || !/^\d{4}$/.test(senha)) {
    throw new ErroHttp(422, "DADOS_INVALIDOS", "Senha do gerente: informe exatamente 4 dígitos.", { campo: "Senha do gerente" });
  }
  await c.sql.q(
    `insert into gerente_credencial (unica, senha_hash) values (true, $1::text)
     on conflict (unica) do update set senha_hash = excluded.senha_hash, atualizado_em = now()`,
    [await c.deps.hashSenha(senha)],
  );
  // Senha nova: zera as tentativas erradas acumuladas com a antiga.
  await c.sql.q("delete from limites where chave like 'gerente:%'");
  return configCompleta(c);
}
