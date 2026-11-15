// Rotas operacionais (sem login): rascunho, finalização e correção única.
// Todas as regras são conferidas aqui de novo — o navegador nunca é a fonte da verdade.
import { diferencas, montarResumo, pendencias, REGRA_CALCULO } from "./dominio/calculo.ts";
import { MAX_CENTAVOS } from "./dominio/dinheiro.ts";
import { ehTurno, normalizarNome } from "./dominio/tipos.ts";
import type { ConferenciaAbertura, Fechamento, Forma, Lancamento, Resumo, Snapshot, Valores } from "./dominio/tipos.ts";
import { ErroHttp, inteiro, iso, json, limitar, novoId, sha256, texto, textoLongo } from "./infra.ts";
import type { Ctx, Linha, Sql } from "./infra.ts";

const MAX_LANCAMENTOS = 1000;
const MAX_TOTAL_CENTAVOS = 2_000_000_000;

// ---- leitura --------------------------------------------------------------

const JSON_LANCAMENTOS = `(select coalesce(json_agg(json_build_object('id', x.lancamento_id, 'formaId', x.forma_id,
    'tipo', x.tipo, 'valorCentavos', x.valor_centavos) order by x.ordem), '[]'::json)::text
  from lancamentos x where x.fechamento_id = f.fechamento_id)`;
const JSON_FORMAS = `(select coalesce(json_agg(json_build_object('formaId', p.forma_id, 'nome', p.nome, 'ordem', p.ordem,
    'ativa', p.ativa) order by p.ordem, p.nome), '[]'::json)::text from formas_pagamento p)`;

// Posição de um fechamento na linha do tempo da loja: data e, dentro dela, manhã, tarde, noite.
const posicao = (a: string) => `(${a}.data_local, case ${a}.turno when 'manha' then 1 when 'tarde' then 2 else 3 end)`;

/**
 * Fechamento anterior de (loja, data, turno): o último FINALIZADO da mesma loja antes dessa posição,
 * mesmo que seja de dias atrás. É dele o "Dinheiro da gaveta" que vira a abertura esperada.
 * `alvo` é uma expressão SQL com as colunas loja_id, data_local e turno.
 */
const jsonAnterior = (alvo: string) => `(select row_to_json(a)::text from (
    select p.fechamento_id as id, p.data_local as "dataLocal", p.turno, p.dinheiro_contado_centavos as "gavetaCentavos"
    from fechamentos p where p.loja_id = ${alvo}.loja_id and p.status = 'finalizado' and ${posicao("p")} < ${posicao(alvo)}
    order by p.data_local desc, case p.turno when 'manha' then 1 when 'tarde' then 2 else 3 end desc limit 1) a)`;
/** O fechamento imediatamente anterior da loja (em qualquer situação) ainda está em rascunho? */
const anteriorEmRascunho = (alvo: string) => `coalesce((select p.status = 'rascunho' from fechamentos p
    where p.loja_id = ${alvo}.loja_id and ${posicao("p")} < ${posicao(alvo)}
    order by p.data_local desc, case p.turno when 'manha' then 1 when 'tarde' then 2 else 3 end desc limit 1), false)`;
const JSON_ORIGEM = `(select json_build_object('dataLocal', o.data_local, 'turno', o.turno)::text
    from fechamentos o where o.fechamento_id = f.abertura_origem_id)`;

interface Anterior {
  id: string;
  dataLocal: string;
  turno: Fechamento["turno"];
  gavetaCentavos: number;
}

const anteriorDe = (l: Linha): Anterior | null => (l.anterior_json ? JSON.parse(l.anterior_json) : null);
/** Regra: sem fechamento anterior, ou com a gaveta dele zerada, a abertura é digitada livremente. */
const esperadoDe = (a: Anterior | null): number | null => (a && a.gavetaCentavos > 0 ? a.gavetaCentavos : null);

/** Situação da conferência de abertura. No rascunho ainda não respondido, o esperado é lido na hora. */
function conferenciaDe(l: Linha): ConferenciaAbertura {
  if (l.abertura_conferida) {
    return {
      situacao: l.abertura_conferida,
      esperadoCentavos: l.abertura_esperada_centavos,
      origem: l.origem_json ? JSON.parse(l.origem_json) : null,
      anteriorEmRascunho: false,
    };
  }
  const anterior = l.status === "rascunho" ? anteriorDe(l) : null;
  const esperado = esperadoDe(anterior);
  return {
    situacao: esperado === null ? "livre" : "pendente",
    esperadoCentavos: esperado,
    origem: esperado === null ? null : { dataLocal: anterior!.dataLocal, turno: anterior!.turno },
    anteriorEmRascunho: l.status === "rascunho" && l.anterior_rascunho === true,
  };
}

/**
 * Lê tudo o que uma requisição precisa em UMA ida ao banco: o fechamento, seus lançamentos,
 * as formas de pagamento, o fechamento anterior da loja (abertura esperada) e se a chave de
 * acesso informada confere (`autorizado`).
 */
async function buscar(s: Sql, id: string, travar = false, tokenHash: string | null = null): Promise<Linha> {
  const [l] = await s.q(
    `select f.*, l.nome as loja_nome, ${JSON_LANCAMENTOS} as lancamentos_json, ${JSON_FORMAS} as formas_json,
       ${jsonAnterior("f")} as anterior_json, ${anteriorEmRascunho("f")} as anterior_rascunho, ${JSON_ORIGEM} as origem_json,
       exists (select 1 from fechamento_tokens t
               where t.fechamento_id = f.fechamento_id and t.token_hash = $2::text) as autorizado
     from fechamentos f join lojas l on l.loja_id = f.loja_id
     where f.fechamento_id = $1::text ${travar ? "for update of f" : ""}`,
    [id, tokenHash],
  );
  if (!l) throw new ErroHttp(404, "NAO_ENCONTRADO", "Fechamento não encontrado.");
  return l;
}

const lancamentosDe = (l: Linha): Lancamento[] => JSON.parse(l.lancamentos_json);
const formasDe = (l: Linha): Forma[] => JSON.parse(l.formas_json);

export async function formasTodas(s: Sql): Promise<Forma[]> {
  const fs = await s.q("select forma_id, nome, ordem, ativa from formas_pagamento order by ordem, nome");
  return fs.map((f) => ({ formaId: f.forma_id, nome: f.nome, ordem: f.ordem, ativa: f.ativa }));
}

function paraDto(l: Linha, lancamentos: Lancamento[] = lancamentosDe(l)): Fechamento {
  return {
    id: l.fechamento_id,
    lojaId: l.loja_id,
    lojaNome: l.loja_nome,
    dataLocal: l.data_local,
    turno: l.turno,
    responsavelNome: l.responsavel_nome,
    observacao: l.observacao,
    aberturaCentavos: l.abertura_centavos,
    houveSangria: l.houve_sangria,
    sangriaCentavos: l.sangria_centavos,
    lancamentos,
    status: l.status,
    versao: l.versao,
    quantidadeCorrecoes: l.quantidade_correcoes,
    quantidadeEdicoesAdm: l.quantidade_edicoes_adm,
    revisao: l.revisao,
    criadoEm: iso(l.criado_em)!,
    finalizadoEm: iso(l.finalizado_em),
    atualizadoEm: iso(l.atualizado_em)!,
    snapshot: l.snapshot_json ? JSON.parse(l.snapshot_json) : null,
    abertura: conferenciaDe(l),
  };
}

export async function carregarFechamento(s: Sql, id: string): Promise<Fechamento> {
  return paraDto(await buscar(s, id));
}

/**
 * Lê o fechamento exigindo a chave de acesso (guardada no aparelho de quem o abriu).
 * A conferência da chave vai na mesma consulta da leitura.
 */
async function abrir(c: Ctx, s: Sql, id: string, travar = false): Promise<Linha> {
  const token = c.req.headers.get("x-fechamento-token") ?? "";
  const l = await buscar(s, id, travar, /^[a-f0-9]{64}$/.test(token) ? await sha256(token) : null); // 404 se não existir
  if (!l.autorizado) {
    throw new ErroHttp(403, "SEM_ACESSO", "Este aparelho não tem acesso a este fechamento. Informe o nome de quem o criou.");
  }
  return l;
}

// ---- validação ------------------------------------------------------------

function validarData(v: unknown): string {
  const d = typeof v === "string" ? v : "";
  const valida = /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T00:00:00Z`)) &&
    new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
  if (!valida) throw new ErroHttp(422, "DADOS_INVALIDOS", "Data: informe uma data válida.", { campo: "Data" });
  const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  if (d > amanha || d < "2020-01-01") {
    throw new ErroHttp(422, "DADOS_INVALIDOS", "Data: fora do período permitido (não pode ser futura).", { campo: "Data" });
  }
  return d;
}

function validarIdentificacao(b: Linha) {
  if (!ehTurno(b.turno)) {
    throw new ErroHttp(422, "DADOS_INVALIDOS", "Turno: escolha Manhã, Tarde ou Noite.", { campo: "Turno" });
  }
  return {
    lojaId: texto(b.lojaId, "Loja", 1, 80),
    dataLocal: validarData(b.dataLocal),
    turno: b.turno,
    responsavelNome: texto(b.responsavelNome, "Nome do responsável", 2, 60),
    observacao: textoLongo(b.observacao, "Observação", 2000),
  };
}

function validarValores(b: Linha, formas: Forma[]): Valores {
  const conhecidas = new Set(formas.map((f) => f.formaId));
  if (b.houveSangria != null && typeof b.houveSangria !== "boolean") {
    throw new ErroHttp(422, "DADOS_INVALIDOS", "Sangria de troco: resposta inválida.");
  }
  if (!Array.isArray(b.lancamentos) || b.lancamentos.length > MAX_LANCAMENTOS) {
    throw new ErroHttp(422, "DADOS_INVALIDOS", "Lançamentos: lista inválida ou grande demais.");
  }
  const ids = new Set<string>();
  let total = 0;
  const lancamentos: Lancamento[] = b.lancamentos.map((l: Linha) => {
    const dinheiro = l?.tipo === "dinheiro_contado";
    const ok = l && typeof l.id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(l.id) && !ids.has(l.id) &&
      (dinheiro ? l.formaId == null : l.tipo === "pagamento" && conhecidas.has(l.formaId));
    if (!ok) throw new ErroHttp(422, "DADOS_INVALIDOS", "Lançamentos: há um lançamento inválido ou repetido.");
    ids.add(l.id);
    const valorCentavos = inteiro(l.valorCentavos, "Lançamento", 1, MAX_CENTAVOS);
    total += valorCentavos;
    return { id: l.id, formaId: dinheiro ? null : l.formaId, tipo: l.tipo, valorCentavos };
  });
  if (total > MAX_TOTAL_CENTAVOS) throw new ErroHttp(422, "DADOS_INVALIDOS", "Lançamentos: soma acima do limite permitido.");
  const houveSangria: boolean | null = b.houveSangria ?? null;
  return {
    aberturaCentavos: b.aberturaCentavos == null ? null : inteiro(b.aberturaCentavos, "Valor de abertura", 0, MAX_CENTAVOS),
    houveSangria,
    sangriaCentavos: houveSangria ? inteiro(b.sangriaCentavos ?? 0, "Sangria de troco", 0, MAX_CENTAVOS) : 0,
    lancamentos,
  };
}

/**
 * Recalcula tudo no servidor e exige que os valores vistos pelo operador sejam
 * exatamente os mesmos. Divergência = dado manipulado ou tela desatualizada.
 */
function conferirCalculo(b: Linha, v: Valores, r: Resumo, abertura?: Parameters<typeof pendencias>[2]): void {
  const p = pendencias(v, r, abertura);
  if (p.length) throw new ErroHttp(422, "PENDENCIAS", p[0], { pendencias: p });
  const visto = b.confirmacao ?? {};
  if (visto.dinheiroLancarCentavos !== r.dinheiroLancarCentavos || visto.totalLancarCentavos !== r.totalLancarCentavos) {
    throw new ErroHttp(422, "CALCULO_DIVERGENTE", "Os valores enviados não conferem com o cálculo do servidor. Revise e tente de novo.", {
      dinheiroLancarCentavos: r.dinheiroLancarCentavos,
      totalLancarCentavos: r.totalLancarCentavos,
    });
  }
}

/** `esperadoCentavos`: valor de abertura que o servidor esperava; se a abertura for outra, o retrato leva a marca de divergência. */
function montarSnapshot(l: Linha, v: Valores, r: Resumo, versao: number, observacao: string, esperadoCentavos: number | null): Snapshot {
  return {
    ...r,
    versao,
    regra: REGRA_CALCULO,
    lojaId: l.loja_id,
    lojaNome: l.loja_nome,
    dataLocal: l.data_local,
    turno: l.turno,
    responsavelNome: l.responsavel_nome,
    observacao,
    houveSangria: v.houveSangria === true,
    registradoEm: new Date().toISOString(),
    ...(esperadoCentavos !== null && esperadoCentavos !== r.aberturaCentavos
      ? { aberturaDivergente: { esperadoCentavos, encontradoCentavos: r.aberturaCentavos } }
      : {}),
  };
}

/**
 * Troca os lançamentos do fechamento $1 pela lista em $2 (JSON) dentro de um único comando:
 * apaga os que saíram e insere/atualiza os demais. Serve de prefixo (`with ...`) para o comando principal.
 */
const COM_LANCAMENTOS = `with novos as (
    select x.id, x."formaId" as forma_id, x.tipo, x."valorCentavos" as valor_centavos, x.ordem
    from json_to_recordset(($2::text)::json) as x(id text, "formaId" text, tipo text, "valorCentavos" int, ordem int)
  ), removidos as (
    delete from lancamentos where fechamento_id = $1::text and lancamento_id not in (select id from novos)
  ), gravados as (
    insert into lancamentos as a (fechamento_id, lancamento_id, forma_id, tipo, valor_centavos, ordem)
    select $1::text, n.id, n.forma_id, n.tipo, n.valor_centavos, n.ordem from novos n
    on conflict (fechamento_id, lancamento_id) do update
      set forma_id = excluded.forma_id, tipo = excluded.tipo, valor_centavos = excluded.valor_centavos, ordem = excluded.ordem
      where (a.forma_id, a.tipo, a.valor_centavos, a.ordem)
        is distinct from (excluded.forma_id, excluded.tipo, excluded.valor_centavos, excluded.ordem)
  )`;

const jsonLancamentos = (lancamentos: Lancamento[]): string =>
  JSON.stringify(lancamentos.map((l, ordem) => ({ ...l, ordem })));

async function erroExistente(s: Sql, lojaId: string, dataLocal: string, turno: string): Promise<ErroHttp> {
  const [e] = await s.q(
    `select f.fechamento_id, f.status, f.criado_em, l.nome as loja_nome from fechamentos f
     join lojas l on l.loja_id = f.loja_id where f.loja_id = $1::text and f.data_local = $2::text and f.turno = $3::text`,
    [lojaId, dataLocal, turno],
  );
  return new ErroHttp(409, "FECHAMENTO_EXISTENTE", "Já existe um fechamento para esta loja, data e turno.", {
    existente: e && { id: e.fechamento_id, status: e.status, lojaNome: e.loja_nome, dataLocal, turno, criadoEm: iso(e.criado_em) },
  });
}

/**
 * Confere, em uma consulta, que a loja está ativa e que o nome é de um usuário ativo cadastrado
 * para ela. Devolve o nome como está no cadastro.
 */
async function exigirUsuarioDaLoja(s: Sql, lojaId: string, nome: string, campo: string, lojaPrecisaEstarAtiva = true): Promise<string> {
  const [r] = await s.q(
    `select exists (select 1 from lojas where loja_id = $1::text and ativa) as loja_ativa,
       (select u.nome from usuarios u join usuario_lojas ul on ul.usuario_id = u.usuario_id
        where ul.loja_id = $1::text and u.ativo and lower(u.nome) = lower($2::text)) as usuario`,
    [lojaId, nome],
  );
  if (lojaPrecisaEstarAtiva && !r.loja_ativa) {
    throw new ErroHttp(422, "DADOS_INVALIDOS", "Loja: escolha uma loja ativa.", { campo: "Loja" });
  }
  if (!r.usuario) {
    throw new ErroHttp(422, "USUARIO_NAO_CADASTRADO", `${campo}: escolha um usuário cadastrado para esta loja.`, { campo });
  }
  return r.usuario as string;
}

const tokenDoCorpo = (b: Linha): string => {
  if (typeof b.token !== "string" || !/^[a-f0-9]{64}$/.test(b.token)) {
    throw new ErroHttp(422, "DADOS_INVALIDOS", "Chave de acesso inválida.");
  }
  return b.token;
};

// ---- senha do gerente -----------------------------------------------------

const TENTATIVAS_GERENTE = [5, 15, 60] as const;

/**
 * Confere a senha do gerente (4 dígitos; no banco só existe o hash). Serve apenas para liberar
 * divergência de abertura. Limite de erros por fechamento, por aparelho e geral, porque a senha é curta.
 * Chamar FORA de transação, para a contagem de tentativas não ser desfeita junto com um erro.
 */
async function exigirSenhaGerente(c: Ctx, id: string, senha: unknown): Promise<void> {
  if (typeof senha !== "string" || !/^\d{4}$/.test(senha)) {
    throw new ErroHttp(403, "SENHA_GERENTE_NECESSARIA", "Informe a senha do gerente (4 dígitos).");
  }
  const [g] = await c.sql.q("select senha_hash from gerente_credencial");
  if (!g) {
    throw new ErroHttp(409, "SENHA_GERENTE_NAO_CADASTRADA", "A senha do gerente ainda não foi cadastrada. Peça ao administrador para cadastrá-la em Configurações.");
  }
  const chaves = [`gerente:f:${id}`, `gerente:ip:${c.ip}`, "gerente:todos"];
  await limitar(c.sql, chaves[0], TENTATIVAS_GERENTE[0], 900);
  await limitar(c.sql, chaves[1], TENTATIVAS_GERENTE[1], 900);
  await limitar(c.sql, chaves[2], TENTATIVAS_GERENTE[2], 3600);
  if (!(await c.deps.conferirSenha(senha, g.senha_hash))) {
    throw new ErroHttp(403, "SENHA_GERENTE_INCORRETA", "Senha do gerente incorreta.");
  }
  // Senha certa não conta como tentativa.
  await c.sql.q(
    "update limites set contagem = greatest(contagem - 1, 0) where chave in ($1::text, $2::text, $3::text)",
    chaves,
  );
}

// ---- rotas ----------------------------------------------------------------

/** POST /fechamentos — cria o rascunho; a unicidade loja+data+turno é garantida pelo banco. */
export async function criar(c: Ctx): Promise<Response> {
  const ident = validarIdentificacao(c.corpo);
  const tokenHash = await sha256(tokenDoCorpo(c.corpo));
  await limitar(c.sql, `criar:${c.ip}`, 60, 3600);
  ident.responsavelNome = await exigirUsuarioDaLoja(c.sql, ident.lojaId, ident.responsavelNome, "Nome do responsável");
  const id = novoId();
  const r = await c.sql.tx(async (s) => {
    const criado = await s.q(
      `insert into fechamentos (fechamento_id, loja_id, data_local, turno, responsavel_nome, observacao)
       values ($1::text, $2::text, $3::text, $4::text, $5::text, $6::text)
       on conflict on constraint fechamentos_loja_data_turno do nothing returning fechamento_id`,
      [id, ident.lojaId, ident.dataLocal, ident.turno, ident.responsavelNome, ident.observacao],
    );
    if (criado.length) {
      await s.q("insert into fechamento_tokens (token_hash, fechamento_id) values ($1::text, $2::text)", [tokenHash, id]);
      return { status: 201, id };
    }
    // Reenvio da mesma criação (mesma chave) devolve o registro já criado, sem duplicar.
    const [meu] = await s.q(
      `select f.fechamento_id from fechamentos f join fechamento_tokens t on t.fechamento_id = f.fechamento_id
       where f.loja_id = $1::text and f.data_local = $2::text and f.turno = $3::text and t.token_hash = $4::text`,
      [ident.lojaId, ident.dataLocal, ident.turno, tokenHash],
    );
    if (meu) return { status: 200, id: meu.fechamento_id as string };
    throw await erroExistente(s, ident.lojaId, ident.dataLocal, ident.turno);
  });
  return json(r.status, { fechamento: await carregarFechamento(c.sql, r.id) });
}

/**
 * POST /fechamentos/:id/acesso — abre um fechamento existente em outro aparelho.
 * O nome é apenas declarado: isto NÃO comprova identidade.
 */
export async function acesso(c: Ctx, id: string): Promise<Response> {
  const tokenHash = await sha256(tokenDoCorpo(c.corpo));
  const nome = texto(c.corpo.nome, "Nome", 1, 60);
  await limitar(c.sql, `acesso:${c.ip}:${id}`, 10, 900);
  const l = await buscar(c.sql, id);
  if (normalizarNome(nome) !== normalizarNome(l.responsavel_nome)) {
    throw new ErroHttp(403, "NOME_NAO_CONFERE", "O nome informado não confere com o de quem criou este fechamento.");
  }
  await c.sql.q(
    "insert into fechamento_tokens (token_hash, fechamento_id) values ($1::text, $2::text) on conflict do nothing",
    [tokenHash, id],
  );
  return json(200, { fechamento: await carregarFechamento(c.sql, id) });
}

/** GET /fechamentos/:id */
export async function obter(c: Ctx, id: string): Promise<Response> {
  return json(200, { fechamento: paraDto(await abrir(c, c.sql, id)) });
}

/** PUT /fechamentos/:id/rascunho — grava o rascunho inteiro; revisões antigas são ignoradas. */
export async function salvarRascunho(c: Ctx, id: string): Promise<Response> {
  // Idas ao banco no caminho normal: início da transação, leitura travada, gravação única, confirmação.
  const r = await c.sql.tx(async (s) => {
    const l = await abrir(c, s, id, true);
    const ident = validarIdentificacao(c.corpo);
    const revisao = inteiro(c.corpo.revisao, "Revisão", 1, 2_000_000_000);
    const v = validarValores(c.corpo, formasDe(l));
    if (l.status !== "rascunho") {
      throw new ErroHttp(409, "JA_FINALIZADO", "Este fechamento já foi finalizado.");
    }
    // Chegou atrasado: o servidor já tem esta revisão ou outra mais nova.
    if (revisao <= l.revisao) return { aplicado: false, fechamento: paraDto(l) };
    if (ident.responsavelNome !== l.responsavel_nome && ident.lojaId === l.loja_id) {
      ident.responsavelNome = await exigirUsuarioDaLoja(s, ident.lojaId, ident.responsavelNome, "Nome do responsável", false);
    }
    const mudouPosicao = ident.lojaId !== l.loja_id || ident.dataLocal !== l.data_local || ident.turno !== l.turno;
    // Abertura esperada: lida junto com o fechamento; só é consultada de novo se loja, data ou turno mudarem.
    let vizinho = { anterior_json: l.anterior_json, anterior_rascunho: l.anterior_rascunho };
    if (mudouPosicao) {
      if (ident.lojaId !== l.loja_id) {
        ident.responsavelNome = await exigirUsuarioDaLoja(s, ident.lojaId, ident.responsavelNome, "Nome do responsável");
      }
      const [outro] = await s.q(
        `select 1 as ok from fechamentos where loja_id = $1::text and data_local = $2::text and turno = $3::text
         and fechamento_id <> $4::text`,
        [ident.lojaId, ident.dataLocal, ident.turno, id],
      );
      if (outro) throw await erroExistente(s, ident.lojaId, ident.dataLocal, ident.turno);
      [vizinho] = await s.q(
        `select ${jsonAnterior("x")} as anterior_json, ${anteriorEmRascunho("x")} as anterior_rascunho
         from (select $1::text as loja_id, $2::text as data_local, $3::text as turno) x`,
        [ident.lojaId, ident.dataLocal, ident.turno],
      ) as never[];
    }
    // Quem decide a abertura é o servidor. Mudou loja, data ou turno: a conferência é refeita.
    // Com valor esperado, a abertura só entra pela rota de conferência; o que a tela mandar aqui é ignorado.
    const conferida: string | null = mudouPosicao ? null : l.abertura_conferida;
    if (conferida) v.aberturaCentavos = l.abertura_centavos;
    else if (esperadoDe(anteriorDe(vizinho)) !== null) v.aberturaCentavos = null;
    const resumo = montarResumo(v, []);
    const [novo] = await s.q(
      `${COM_LANCAMENTOS}
       update fechamentos f set loja_id = $3::text, data_local = $4::text, turno = $5::text, responsavel_nome = $6::text,
         observacao = $7::text, abertura_centavos = $8::int, houve_sangria = $9::boolean, sangria_centavos = $10::int,
         dinheiro_contado_centavos = $11::int, revisao = $12::int, atualizado_em = now(),
         abertura_conferida = $13::text,
         abertura_esperada_centavos = case when $13::text is null then null else abertura_esperada_centavos end,
         abertura_origem_id = case when $13::text is null then null else abertura_origem_id end
       where f.fechamento_id = $1::text
       returning f.*, (select l.nome from lojas l where l.loja_id = f.loja_id) as loja_nome`,
      [id, jsonLancamentos(v.lancamentos), ident.lojaId, ident.dataLocal, ident.turno, ident.responsavelNome,
        ident.observacao, v.aberturaCentavos, v.houveSangria, v.sangriaCentavos, resumo.dinheiroContadoCentavos, revisao,
        conferida],
    );
    return { aplicado: true, fechamento: paraDto({ ...l, ...novo, ...vizinho }, v.lancamentos) };
  });
  return json(200, r);
}

/** POST /fechamentos/:id/finalizar — valida o rascunho salvo e grava a versão 1. */
export async function finalizar(c: Ctx, id: string): Promise<Response> {
  const fechamento = await c.sql.tx(async (s) => {
    const l = await abrir(c, s, id, true);
    if (l.status === "finalizado") return paraDto(l); // reenvio: devolve o estado confirmado, sem duplicar
    if (c.corpo.revisao !== l.revisao) {
      throw new ErroHttp(409, "RASCUNHO_DESATUALIZADO", "O servidor ainda não recebeu suas últimas alterações. Aguarde salvar e tente de novo.");
    }
    const v: Valores = {
      aberturaCentavos: l.abertura_centavos,
      houveSangria: l.houve_sangria,
      sangriaCentavos: l.sangria_centavos,
      lancamentos: lancamentosDe(l),
    };
    const r = montarResumo(v, formasDe(l));
    conferirCalculo(c.corpo, v, r, { situacao: conferenciaDe(l).situacao, observacao: l.observacao });
    const snap = JSON.stringify(montarSnapshot(l, v, r, 1, l.observacao, l.abertura_esperada_centavos));
    // Finalização e registro no histórico no mesmo comando.
    const [novo] = await s.q(
      `with historico as (
         insert into historico_alteracoes (auditoria_id, fechamento_id, tipo, versao_anterior, versao_nova,
           snapshot_depois_json, autor_declarado) values ($8::text, $1::text, 'finalizacao', 0, 1, $7::text, $9::text)
       )
       update fechamentos f set status = 'finalizado', versao = 1, dinheiro_contado_centavos = $2::int,
         dinheiro_lancar_centavos = $3::int, total_lancar_centavos = $4::int, sangria_centavos = $5::int,
         regra_calculo = $6::text, snapshot_json = $7::text, finalizado_em = now(), atualizado_em = now()
       where f.fechamento_id = $1::text returning f.*`,
      [id, r.dinheiroContadoCentavos, r.dinheiroLancarCentavos, r.totalLancarCentavos, r.sangriaCentavos, REGRA_CALCULO,
        snap, novoId(), l.responsavel_nome],
    );
    return paraDto({ ...l, ...novo }, v.lancamentos);
  });
  return json(200, { fechamento });
}

/**
 * POST /fechamentos/:id/abertura — conferência da abertura do caixa.
 * `{ confere: true, esperadoCentavos }`: o funcionário confirma que há na gaveta o valor esperado.
 * `{ confere: false, esperadoCentavos, valorCentavos, senhaGerente }`: o valor é outro; exige a senha do gerente.
 * O valor esperado é sempre o do servidor; `esperadoCentavos` só garante que a pessoa respondeu sobre o valor atual.
 */
export async function conferirAbertura(c: Ctx, id: string): Promise<Response> {
  const b = c.corpo;
  if (typeof b.confere !== "boolean") throw new ErroHttp(422, "DADOS_INVALIDOS", "Abertura: responda Sim ou Não.");
  const encontrado = b.confere ? null : inteiro(b.valorCentavos, "Valor encontrado na gaveta", 0, MAX_CENTAVOS);
  // A senha só é conferida para quem tem acesso ao fechamento, e antes da transação (ver exigirSenhaGerente).
  if (!b.confere) {
    await abrir(c, c.sql, id);
    await exigirSenhaGerente(c, id, b.senhaGerente);
  }
  const fechamento = await c.sql.tx(async (s) => {
    const l = await abrir(c, s, id, true);
    if (l.status !== "rascunho") throw new ErroHttp(409, "JA_FINALIZADO", "Este fechamento já foi finalizado.");
    const anterior = anteriorDe(l);
    const esperado = esperadoDe(anterior);
    if (esperado === null) {
      throw new ErroHttp(409, "ABERTURA_LIVRE", "Não há valor de abertura para conferir neste fechamento: digite a abertura.", { fechamento: paraDto(l) });
    }
    if (b.esperadoCentavos !== esperado) {
      throw new ErroHttp(409, "ABERTURA_MUDOU", "O valor esperado na gaveta mudou. Confira de novo.", { fechamento: paraDto({ ...l, abertura_conferida: null }) });
    }
    const valor = encontrado ?? esperado;
    const [novo] = await s.q(
      `update fechamentos f set abertura_centavos = $2::int, abertura_conferida = $3::text,
         abertura_esperada_centavos = $4::int, abertura_origem_id = $5::text, atualizado_em = now()
       where f.fechamento_id = $1::text returning f.*`,
      [id, valor, valor === esperado ? "sim" : "divergente", esperado, anterior!.id],
    );
    return paraDto({ ...l, ...novo, origem_json: JSON.stringify({ dataLocal: anterior!.dataLocal, turno: anterior!.turno }) });
  });
  return json(200, { fechamento });
}

/** Depois de finalizado: a abertura continua comparada com o valor esperado guardado na conferência. */
const conferidaApos = (l: Linha, aberturaCentavos: number | null): "sim" | "divergente" | null =>
  l.abertura_esperada_centavos == null ? null : aberturaCentavos === l.abertura_esperada_centavos ? "sim" : "divergente";

const essencia = (s: Resumo & { observacao: string; houveSangria: boolean | null }) =>
  JSON.stringify([s.aberturaCentavos, s.houveSangria === true, s.sangriaCentavos, s.observacao, s.dinheiroContado,
    s.formas.filter((f) => f.lancamentos.length).map((f) => [f.formaId, f.lancamentos])]);

/**
 * POST /fechamentos/:id/corrigir — a única correção após finalizar.
 * A linha fica travada durante a transação: de duas correções simultâneas, só uma passa.
 */
export async function corrigir(c: Ctx, id: string): Promise<Response> {
  const b = c.corpo;
  // Mudar a abertura na correção exige a senha do gerente, conferida antes da transação.
  const previa = await abrir(c, c.sql, id);
  const senhaConferidaPara: number | null =
    previa.status === "finalizado" && previa.quantidade_correcoes === 0 && typeof b.aberturaCentavos === "number" &&
      b.aberturaCentavos !== previa.abertura_centavos
      ? (await exigirSenhaGerente(c, id, b.senhaGerente), b.aberturaCentavos)
      : null;
  const fechamento = await c.sql.tx(async (s) => {
    const l = await abrir(c, s, id, true);
    const requisicaoId = texto(b.requisicaoId, "Requisição", 8, 64);
    const autor = texto(b.autorDeclarado, "Nome de quem corrige", 2, 60);
    const motivo = texto(b.motivo, "Motivo da correção", 5, 500);
    const observacao = textoLongo(b.observacao, "Observação", 2000);
    const formas = formasDe(l);
    const v = validarValores(b, formas);
    if (l.status !== "finalizado") {
      throw new ErroHttp(409, "NAO_FINALIZADO", "Só é possível corrigir um fechamento finalizado.");
    }
    if (l.quantidade_correcoes >= 1) {
      const [mesma] = await s.q(
        "select 1 as ok from historico_alteracoes where fechamento_id = $1::text and requisicao_id = $2::text",
        [id, requisicaoId],
      );
      if (mesma) return paraDto(l); // reenvio da correção já aceita
      throw new ErroHttp(409, "CORRECAO_JA_UTILIZADA", "Este fechamento já foi corrigido uma vez e está bloqueado para novas edições.");
    }
    if (b.versaoEsperada !== l.versao) {
      throw new ErroHttp(409, "VERSAO_DESATUALIZADA", "O fechamento mudou desde que você abriu a correção. Recarregue a página.");
    }
    if (v.aberturaCentavos !== l.abertura_centavos && v.aberturaCentavos !== senhaConferidaPara) {
      throw new ErroHttp(403, "SENHA_GERENTE_NECESSARIA", "Para mudar a abertura, informe a senha do gerente (4 dígitos).");
    }
    const r = montarResumo(v, formas);
    const conferida = conferidaApos(l, v.aberturaCentavos);
    conferirCalculo(b, v, r, { situacao: conferida ?? "livre", observacao });
    const antes: Snapshot = JSON.parse(l.snapshot_json);
    const depois = montarSnapshot(l, v, r, l.versao + 1, observacao, l.abertura_esperada_centavos);
    if (essencia(antes) === essencia(depois)) {
      throw new ErroHttp(422, "SEM_ALTERACOES", "Nenhum valor foi alterado. A correção única não foi consumida.");
    }
    const autorCadastrado = await exigirUsuarioDaLoja(s, l.loja_id, autor, "Quem está corrigindo", false);
    // O que o funcionário alterou agora deixa de contar como valor definido pelo administrador.
    const mudou = diferencas(antes, depois);
    const doAdm = (antes.alteradoPeloAdm ?? []).filter((k) => !mudou.includes(k));
    if (doAdm.length) depois.alteradoPeloAdm = doAdm;
    // Os lançamentos são gravados antes, em comando próprio: depois da correção o banco bloqueia alterá-los.
    await s.q(`${COM_LANCAMENTOS} select 1 as ok`, [id, jsonLancamentos(v.lancamentos)]);
    const [novo] = await s.q(
      `with historico as (
         insert into historico_alteracoes (auditoria_id, fechamento_id, tipo, versao_anterior, versao_nova,
           snapshot_antes_json, snapshot_depois_json, autor_declarado, motivo, requisicao_id)
         values ($10::text, $1::text, 'correcao', $11::int, $11::int + 1, $12::text, $9::text, $13::text, $14::text, $15::text)
       )
       update fechamentos f set versao = versao + 1, quantidade_correcoes = 1, observacao = $2::text,
         abertura_centavos = $3::int, houve_sangria = $4::boolean, sangria_centavos = $5::int,
         dinheiro_contado_centavos = $6::int, dinheiro_lancar_centavos = $7::int, total_lancar_centavos = $8::int,
         snapshot_json = $9::text, abertura_conferida = $16::text, atualizado_em = now()
       where f.fechamento_id = $1::text and f.status = 'finalizado' and f.quantidade_correcoes = 0 returning f.*`,
      [id, observacao, v.aberturaCentavos, v.houveSangria, r.sangriaCentavos, r.dinheiroContadoCentavos,
        r.dinheiroLancarCentavos, r.totalLancarCentavos, JSON.stringify(depois), novoId(), l.versao, l.snapshot_json,
        autorCadastrado, motivo, requisicaoId, conferida],
    );
    if (!novo) throw new Error("Correção não aplicada: o fechamento mudou durante a transação.");
    return paraDto({ ...l, ...novo }, v.lancamentos);
  });
  return json(200, { fechamento });
}

/**
 * Edição de um fechamento finalizado pelo administrador (a sessão ADM é conferida por quem chama).
 * Não tem limite de quantidade e não consome a correção única do funcionário. Cada edição gera
 * uma nova versão no histórico, e os itens alterados ficam marcados em `alteradoPeloAdm`.
 */
export async function editarComoAdm(c: Ctx, id: string): Promise<Response> {
  const b = c.corpo;
  const fechamento = await c.sql.tx(async (s) => {
    // Libera as travas do banco só nesta transação.
    await s.q("select set_config('cc.edicao_adm', '1', true) as ok");
    const l = await buscar(s, id, true);
    const motivo = texto(b.motivo, "Motivo da edição", 5, 500);
    const observacao = textoLongo(b.observacao, "Observação", 2000);
    const formas = formasDe(l);
    const v = validarValores(b, formas);
    if (l.status !== "finalizado") {
      throw new ErroHttp(409, "NAO_FINALIZADO", "Só é possível editar um fechamento finalizado.");
    }
    if (b.versaoEsperada !== l.versao) {
      throw new ErroHttp(409, "VERSAO_DESATUALIZADA", "O fechamento mudou desde que você abriu a edição. Recarregue a página.");
    }
    const r = montarResumo(v, formas);
    conferirCalculo(b, v, r);
    const antes: Snapshot = JSON.parse(l.snapshot_json);
    // O ADM altera a abertura sem senha do gerente; a marca de divergência acompanha o novo valor.
    const depois = montarSnapshot(l, v, r, l.versao + 1, observacao, l.abertura_esperada_centavos);
    const mudou = diferencas(antes, depois);
    if (!mudou.length) throw new ErroHttp(422, "SEM_ALTERACOES", "Nenhum valor foi alterado.");
    depois.alteradoPeloAdm = [...new Set([...(antes.alteradoPeloAdm ?? []), ...mudou])];
    await s.q(`${COM_LANCAMENTOS} select 1 as ok`, [id, jsonLancamentos(v.lancamentos)]);
    const [novo] = await s.q(
      `with historico as (
         insert into historico_alteracoes (auditoria_id, fechamento_id, tipo, versao_anterior, versao_nova,
           snapshot_antes_json, snapshot_depois_json, autor_declarado, motivo)
         values ($10::text, $1::text, 'edicao_adm', $11::int, $11::int + 1, $12::text, $9::text, 'Administrador', $13::text)
       )
       update fechamentos f set versao = versao + 1, quantidade_edicoes_adm = quantidade_edicoes_adm + 1,
         observacao = $2::text, abertura_centavos = $3::int, houve_sangria = $4::boolean, sangria_centavos = $5::int,
         dinheiro_contado_centavos = $6::int, dinheiro_lancar_centavos = $7::int, total_lancar_centavos = $8::int,
         snapshot_json = $9::text, abertura_conferida = $14::text, atualizado_em = now()
       where f.fechamento_id = $1::text and f.status = 'finalizado' returning f.*`,
      [id, observacao, v.aberturaCentavos, v.houveSangria, r.sangriaCentavos, r.dinheiroContadoCentavos,
        r.dinheiroLancarCentavos, r.totalLancarCentavos, JSON.stringify(depois), novoId(), l.versao, l.snapshot_json, motivo,
        conferidaApos(l, v.aberturaCentavos)],
    );
    if (!novo) throw new Error("Edição não aplicada: o fechamento mudou durante a transação.");
    return paraDto({ ...l, ...novo }, v.lancamentos);
  });
  return json(200, { fechamento });
}
