// Testes de aceitação do backend (seção 11 da especificação), rodando a API real
// sobre um Postgres embutido, com o mesmo esquema da produção.
import { beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { abrirBanco } from "../servidor-local/banco.ts";
import { criarApp } from "../supabase/functions/api/app.ts";
import type { Fechamento, Lancamento } from "@dominio/tipos.ts";

let app: (req: Request) => Promise<Response>;
let db: PGlite;

beforeEach(async () => {
  const banco = await abrirBanco();
  db = banco.db;
  app = criarApp(banco.deps);
  // Usuários cadastrados em todas as lojas, para os testes que não tratam do cadastro.
  await db.exec(`
    insert into usuarios (usuario_id, nome) values ('u1', 'Maria Souza'), ('u2', 'João'), ('u3', 'Ana'), ('u4', 'João Lima');
    insert into usuario_lojas (usuario_id, loja_id) select u.usuario_id, l.loja_id from usuarios u cross join lojas l;
  `);
});

type Resposta = { status: number; corpo: any };

async function chamar(metodo: string, caminho: string, corpo?: unknown, cabecalhos: Record<string, string> = {}): Promise<Resposta> {
  const r = await app(
    new Request(`http://teste/functions/v1/api${caminho}`, {
      method: metodo,
      headers: { "content-type": "application/json", ...cabecalhos },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    }),
  );
  return { status: r.status, corpo: await r.json() };
}

const novoToken = () => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
const HOJE = new Date().toISOString().slice(0, 10);
let seq = 0;
const lanc = (formaId: string | null, valorCentavos: number): Lancamento => ({
  id: `lanc-${String(++seq).padStart(6, "0")}`,
  formaId,
  tipo: formaId ? "pagamento" : "dinheiro_contado",
  valorCentavos,
});

const ident = (extra: Record<string, unknown> = {}) => ({
  lojaId: "vila-grill-1",
  dataLocal: HOJE,
  turno: "noite",
  responsavelNome: "Maria Souza",
  observacao: "",
  ...extra,
});

async function criar(extra: Record<string, unknown> = {}) {
  const token = novoToken();
  const r = await chamar("POST", "/fechamentos", { ...ident(extra), token });
  return { ...r, token, id: r.corpo.fechamento?.id as string, t: { "x-fechamento-token": token } };
}

/** Valores do exemplo da especificação: abertura 200, contado 850, sangria 50 → dinheiro a lançar 700. */
const valoresExemplo = () => ({
  aberturaCentavos: 20000,
  houveSangria: true,
  sangriaCentavos: 5000,
  lancamentos: [lanc("credito", 12000), lanc("credito", 3500), lanc("pix", 10000), lanc(null, 50000), lanc(null, 35000)],
});
const CONFIRMACAO_EXEMPLO = { dinheiroLancarCentavos: 70000, totalLancarCentavos: 95500 };

async function finalizado(extra: Record<string, unknown> = {}) {
  const f = await criar(extra);
  const valores = valoresExemplo();
  const s = await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...ident(extra), ...valores, revisao: 1 }, f.t);
  expect(s.status).toBe(200);
  const r = await chamar("POST", `/fechamentos/${f.id}/finalizar`, { revisao: 1, confirmacao: CONFIRMACAO_EXEMPLO }, f.t);
  expect(r.status).toBe(200);
  return { ...f, valores, fechamento: r.corpo.fechamento as Fechamento };
}

const correcao = (valores: ReturnType<typeof valoresExemplo>, extra: Record<string, unknown> = {}) => ({
  requisicaoId: `req-${++seq}-abcdef`,
  versaoEsperada: 1,
  autorDeclarado: "Maria Souza",
  motivo: "Faltou um comprovante de Pix",
  observacao: "",
  ...valores,
  lancamentos: [...valores.lancamentos, lanc("pix", 2500)],
  confirmacao: { dinheiroLancarCentavos: 70000, totalLancarCentavos: 98000 },
  ...extra,
});

async function admin() {
  const e = await chamar("POST", "/admin/sessao", { usuario: "ADM", senha: "4321" });
  const provisoria = { "x-admin-sessao": e.corpo.token as string };
  const t = await chamar("POST", "/admin/trocar-senha", { senhaAtual: "4321", novaSenha: "caixa-certo-2026" }, provisoria);
  expect(t.status).toBe(200);
  return provisoria;
}

const GERENTE = "7391";
/** O ADM cadastra a senha do gerente. Devolve a sessão ADM. */
async function cadastrarGerente() {
  const a = await admin();
  expect((await chamar("PUT", "/admin/senha-gerente", { senha: GERENTE }, a)).status).toBe(200);
  return a;
}

describe("configuração pública", () => {
  it("lista as três lojas e as sete formas de pagamento iniciais", async () => {
    const r = await chamar("GET", "/config");
    expect(r.corpo.lojas.map((l: any) => l.nome).sort()).toEqual(["Araçá Grill", "Vila Grill 1", "Vila Grill 2"]);
    expect(r.corpo.formas.map((f: any) => f.nome)).toEqual(["Crédito", "Débito", "Pix", "Voucher", "Assinadas", "iFood", "99Food"]);
  });
});

describe("identificação e unicidade", () => {
  it("T05/T06 — turno é obrigatório e só aceita Manhã, Tarde ou Noite", async () => {
    expect((await criar({ turno: undefined })).status).toBe(422);
    expect((await criar({ turno: "madrugada" })).status).toBe(422);
    for (const turno of ["manha", "tarde", "noite"]) expect((await criar({ turno })).status).toBe(201);
  });

  it("exige nome do responsável, loja ativa e data válida não futura", async () => {
    expect((await criar({ responsavelNome: " " })).status).toBe(422);
    expect((await criar({ lojaId: "nao-existe" })).status).toBe(422);
    expect((await criar({ dataLocal: "2026-02-30" })).status).toBe(422);
    expect((await criar({ dataLocal: "2999-01-01" })).status).toBe(422);
  });

  it("T07 — impede segundo fechamento para a mesma loja, data e turno, mesmo com outro nome", async () => {
    const a = await criar();
    const b = await criar({ responsavelNome: "João" });
    expect(b.status).toBe(409);
    expect(b.corpo.codigo).toBe("FECHAMENTO_EXISTENTE");
    expect(b.corpo.existente).toMatchObject({ id: a.id, status: "rascunho", lojaNome: "Vila Grill 1" });
  });

  it("T08 — permite outra loja na mesma data e turno", async () => {
    expect((await criar()).status).toBe(201);
    expect((await criar({ lojaId: "araca-grill" })).status).toBe(201);
  });

  it("T18 — duas criações simultâneas geram apenas um registro", async () => {
    const rs = await Promise.all([criar(), criar({ responsavelNome: "João" }), criar({ responsavelNome: "Ana" })]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const { rows } = await db.query("select count(*)::int as n from fechamentos");
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("T21 — reenviar a mesma criação após falha de rede devolve o mesmo registro, sem duplicar", async () => {
    const token = novoToken();
    const a = await chamar("POST", "/fechamentos", { ...ident(), token });
    const b = await chamar("POST", "/fechamentos", { ...ident(), token });
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.corpo.fechamento.id).toBe(a.corpo.fechamento.id);
  });

  it("só abre um fechamento com a chave do aparelho ou com o nome declarado de quem criou", async () => {
    const f = await criar();
    expect((await chamar("GET", `/fechamentos/${f.id}`)).status).toBe(403);
    expect((await chamar("GET", `/fechamentos/${f.id}`, undefined, { "x-fechamento-token": novoToken() })).status).toBe(403);
    const outro = novoToken();
    expect((await chamar("POST", `/fechamentos/${f.id}/acesso`, { nome: "João", token: outro })).status).toBe(403);
    expect((await chamar("POST", `/fechamentos/${f.id}/acesso`, { nome: "  maria SOUZA ", token: outro })).status).toBe(200);
    expect((await chamar("GET", `/fechamentos/${f.id}`, undefined, { "x-fechamento-token": outro })).status).toBe(200);
  });
});

describe("rascunho", () => {
  it("T01 — soma lançamentos individuais e não duplica ao reenviar", async () => {
    const f = await criar();
    const corpo = { ...ident(), ...valoresExemplo(), revisao: 1 };
    await chamar("PUT", `/fechamentos/${f.id}/rascunho`, corpo, f.t);
    const r = await chamar("PUT", `/fechamentos/${f.id}/rascunho`, corpo, f.t);
    const credito = r.corpo.fechamento.lancamentos.filter((l: Lancamento) => l.formaId === "credito");
    expect(credito.map((l: Lancamento) => l.valorCentavos)).toEqual([12000, 3500]);
    expect(r.corpo.fechamento.lancamentos).toHaveLength(5);
  });

  it("ignora salvamento que chega atrasado (revisão antiga)", async () => {
    const f = await criar();
    await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...ident(), ...valoresExemplo(), revisao: 5 }, f.t);
    const r = await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...ident(), ...valoresExemplo(), lancamentos: [], revisao: 4 }, f.t);
    expect(r.corpo.aplicado).toBe(false);
    expect(r.corpo.fechamento.revisao).toBe(5);
    expect(r.corpo.fechamento.lancamentos).toHaveLength(5);
  });

  it("rejeita valores negativos, quebrados, forma inexistente e lançamento repetido", async () => {
    const f = await criar();
    const tentar = (extra: Record<string, unknown>) =>
      chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...ident(), ...valoresExemplo(), revisao: 1, ...extra }, f.t);
    expect((await tentar({ aberturaCentavos: -1 })).status).toBe(422);
    expect((await tentar({ sangriaCentavos: -500 })).status).toBe(422);
    expect((await tentar({ lancamentos: [lanc("credito", -100)] })).status).toBe(422);
    expect((await tentar({ lancamentos: [lanc("credito", 10.5)] })).status).toBe(422);
    expect((await tentar({ lancamentos: [lanc("credito", 0)] })).status).toBe(422);
    expect((await tentar({ lancamentos: [lanc("bitcoin", 100)] })).status).toBe(422);
    const repetido = lanc("pix", 100);
    expect((await tentar({ lancamentos: [repetido, repetido] })).status).toBe(422);
  });

  it("ao mudar loja/data/turno do rascunho, continua respeitando a unicidade", async () => {
    await criar({ turno: "tarde" });
    const f = await criar();
    const r = await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...ident({ turno: "tarde" }), ...valoresExemplo(), revisao: 1 }, f.t);
    expect(r.status).toBe(409);
    const ok = await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...ident({ turno: "manha" }), ...valoresExemplo(), revisao: 1 }, f.t);
    expect(ok.corpo.fechamento.turno).toBe("manha");
  });
});

describe("finalização", () => {
  it("T03/T17 — abertura 200, contado 850, sangria 50 → dinheiro a lançar R$ 700,00; observação persiste", async () => {
    const f = await criar({ observacao: "Faltou troco no início do turno." });
    await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...ident({ observacao: "Faltou troco no início do turno." }), ...valoresExemplo(), revisao: 1 }, f.t);
    const r = await chamar("POST", `/fechamentos/${f.id}/finalizar`, { revisao: 1, confirmacao: CONFIRMACAO_EXEMPLO }, f.t);
    const s = r.corpo.fechamento.snapshot;
    expect(r.corpo.fechamento).toMatchObject({ status: "finalizado", versao: 1, quantidadeCorrecoes: 0 });
    expect(s).toMatchObject({
      dinheiroContadoCentavos: 85000,
      ajusteCentavos: 15000,
      dinheiroLancarCentavos: 70000,
      totalPagamentosCentavos: 25500,
      totalLancarCentavos: 95500,
      observacao: "Faltou troco no início do turno.",
    });
    expect(s.formas.find((x: any) => x.formaId === "credito").subtotalCentavos).toBe(15500);
    expect(s.formas.find((x: any) => x.formaId === "voucher").subtotalCentavos).toBe(0);
  });

  it("T04 — bloqueia finalização com dinheiro a lançar negativo e explica", async () => {
    const f = await criar();
    const valores = { aberturaCentavos: 20000, houveSangria: false, sangriaCentavos: 0, lancamentos: [lanc(null, 15000)] };
    await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...ident(), ...valores, revisao: 1 }, f.t);
    const r = await chamar("POST", `/fechamentos/${f.id}/finalizar`, { revisao: 1, confirmacao: { dinheiroLancarCentavos: -5000, totalLancarCentavos: -5000 } }, f.t);
    expect(r.status).toBe(422);
    expect(r.corpo.codigo).toBe("PENDENCIAS");
    expect(r.corpo.mensagem).toContain("negativo");
    expect((await chamar("GET", `/fechamentos/${f.id}`, undefined, f.t)).corpo.fechamento.status).toBe("rascunho");
  });

  it("exige abertura e resposta sobre a sangria", async () => {
    const f = await criar();
    await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...ident(), aberturaCentavos: null, houveSangria: null, sangriaCentavos: 0, lancamentos: [], revisao: 1 }, f.t);
    const r = await chamar("POST", `/fechamentos/${f.id}/finalizar`, { revisao: 1, confirmacao: { dinheiroLancarCentavos: 0, totalLancarCentavos: 0 } }, f.t);
    expect(r.status).toBe(422);
    expect(r.corpo.pendencias).toHaveLength(2);
  });

  it("T22 — o servidor recalcula e rejeita valor calculado manipulado", async () => {
    const f = await criar();
    await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...ident(), ...valoresExemplo(), revisao: 1 }, f.t);
    const r = await chamar("POST", `/fechamentos/${f.id}/finalizar`, { revisao: 1, confirmacao: { dinheiroLancarCentavos: 10000, totalLancarCentavos: 35500 } }, f.t);
    expect(r.status).toBe(422);
    expect(r.corpo).toMatchObject({ codigo: "CALCULO_DIVERGENTE", dinheiroLancarCentavos: 70000, totalLancarCentavos: 95500 });
  });

  it("T21 — finalizar de novo devolve o estado confirmado; rascunho não aceita mais alterações", async () => {
    const f = await finalizado();
    const de_novo = await chamar("POST", `/fechamentos/${f.id}/finalizar`, { revisao: 1, confirmacao: CONFIRMACAO_EXEMPLO }, f.t);
    expect(de_novo.status).toBe(200);
    expect(de_novo.corpo.fechamento.versao).toBe(1);
    const salvar = await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...ident(), ...valoresExemplo(), revisao: 2 }, f.t);
    expect(salvar.status).toBe(409);
    const { rows } = await db.query("select count(*)::int as n from historico_alteracoes");
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("não finaliza se o servidor não tiver a última revisão do rascunho", async () => {
    const f = await criar();
    await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...ident(), ...valoresExemplo(), revisao: 1 }, f.t);
    const r = await chamar("POST", `/fechamentos/${f.id}/finalizar`, { revisao: 2, confirmacao: CONFIRMACAO_EXEMPLO }, f.t);
    expect(r.corpo.codigo).toBe("RASCUNHO_DESATUALIZADO");
  });
});

describe("correção única", () => {
  it("T09 — a primeira correção salva a versão 2 e o histórico antes/depois", async () => {
    const f = await finalizado();
    const r = await chamar("POST", `/fechamentos/${f.id}/corrigir`, correcao(f.valores), f.t);
    expect(r.status).toBe(200);
    expect(r.corpo.fechamento).toMatchObject({ versao: 2, quantidadeCorrecoes: 1 });
    expect(r.corpo.fechamento.snapshot.totalLancarCentavos).toBe(98000);
    const sessao = await admin();
    const d = await chamar("GET", `/admin/fechamentos/${f.id}`, undefined, sessao);
    expect(d.corpo.historico).toHaveLength(2);
    expect(d.corpo.historico[1]).toMatchObject({
      tipo: "correcao",
      versaoAnterior: 1,
      versaoNova: 2,
      autorDeclarado: "Maria Souza",
      motivo: "Faltou um comprovante de Pix",
    });
    expect(d.corpo.historico[1].antes.totalLancarCentavos).toBe(95500);
    expect(d.corpo.historico[1].depois.totalLancarCentavos).toBe(98000);
  });

  it("T10 — a segunda correção é bloqueada no backend", async () => {
    const f = await finalizado();
    await chamar("POST", `/fechamentos/${f.id}/corrigir`, correcao(f.valores), f.t);
    const r = await chamar("POST", `/fechamentos/${f.id}/corrigir`, correcao(f.valores, { versaoEsperada: 2 }), f.t);
    expect(r.status).toBe(409);
    expect(r.corpo.codigo).toBe("CORRECAO_JA_UTILIZADA");
  });

  it("T19 — de duas correções simultâneas, só uma é aceita", async () => {
    const f = await finalizado();
    const rs = await Promise.all([
      chamar("POST", `/fechamentos/${f.id}/corrigir`, correcao(f.valores), f.t),
      chamar("POST", `/fechamentos/${f.id}/corrigir`, correcao(f.valores, { motivo: "Outra correção ao mesmo tempo" }), f.t),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    const { rows } = await db.query("select count(*)::int as n from historico_alteracoes where tipo = 'correcao'");
    expect(rows).toEqual([{ n: 1 }]);
  });

  it("T11 — cancelar (não enviar) ou enviar sem alterações não consome a correção", async () => {
    const f = await finalizado();
    const igual = await chamar("POST", `/fechamentos/${f.id}/corrigir`, correcao(f.valores, { lancamentos: f.valores.lancamentos, confirmacao: CONFIRMACAO_EXEMPLO }), f.t);
    expect(igual.corpo.codigo).toBe("SEM_ALTERACOES");
    const atual = await chamar("GET", `/fechamentos/${f.id}`, undefined, f.t);
    expect(atual.corpo.fechamento).toMatchObject({ versao: 1, quantidadeCorrecoes: 0 });
  });

  it("reenviar a mesma correção (mesma requisição) não gera erro nem duplica", async () => {
    const f = await finalizado();
    const corpo = correcao(f.valores);
    await chamar("POST", `/fechamentos/${f.id}/corrigir`, corpo, f.t);
    const r = await chamar("POST", `/fechamentos/${f.id}/corrigir`, corpo, f.t);
    expect(r.status).toBe(200);
    expect(r.corpo.fechamento.versao).toBe(2);
  });

  it("exige motivo, recalcula no servidor e não corrige rascunho", async () => {
    const f = await finalizado();
    expect((await chamar("POST", `/fechamentos/${f.id}/corrigir`, correcao(f.valores, { motivo: "" }), f.t)).status).toBe(422);
    const manipulada = correcao(f.valores, { confirmacao: { dinheiroLancarCentavos: 1, totalLancarCentavos: 1 } });
    expect((await chamar("POST", `/fechamentos/${f.id}/corrigir`, manipulada, f.t)).corpo.codigo).toBe("CALCULO_DIVERGENTE");
    await cadastrarGerente();
    const negativa = correcao(f.valores, { aberturaCentavos: 999900, senhaGerente: GERENTE, confirmacao: { dinheiroLancarCentavos: -909900, totalLancarCentavos: -881900 } });
    expect((await chamar("POST", `/fechamentos/${f.id}/corrigir`, negativa, f.t)).corpo.codigo).toBe("PENDENCIAS");
    const g = await criar({ turno: "manha" });
    expect((await chamar("POST", `/fechamentos/${g.id}/corrigir`, correcao(valoresExemplo()), g.t)).corpo.codigo).toBe("NAO_FINALIZADO");
  });

  it("o próprio banco bloqueia edição, exclusão e adulteração do histórico", async () => {
    const f = await finalizado();
    await chamar("POST", `/fechamentos/${f.id}/corrigir`, correcao(f.valores), f.t);
    await expect(db.query("update fechamentos set total_lancar_centavos = 1")).rejects.toThrow(/bloqueado/);
    await expect(db.query("update fechamentos set quantidade_correcoes = 0")).rejects.toThrow();
    await expect(db.query("delete from fechamentos")).rejects.toThrow(/não podem ser excluídos/);
    await expect(db.query("delete from lancamentos")).rejects.toThrow(/bloqueado/);
    await expect(db.query("update historico_alteracoes set motivo = 'x'")).rejects.toThrow(/imutável/);
    await expect(db.query("delete from historico_alteracoes")).rejects.toThrow(/imutável/);
  });
});

describe("administrador", () => {
  it("T12/T13 — consultas e configurações exigem sessão ADM", async () => {
    for (const caminho of ["/admin/fechamentos", "/admin/config", "/admin/fechamentos/qualquer"]) {
      expect((await chamar("GET", caminho)).status).toBe(401);
      expect((await chamar("GET", caminho, undefined, { "x-admin-sessao": novoToken() })).status).toBe(401);
    }
    expect((await chamar("POST", "/admin/lojas", { nome: "Nova" })).status).toBe(401);
  });

  it("T14 — ADM/4321 autentica no backend e é obrigado a trocar a senha inicial", async () => {
    expect((await chamar("POST", "/admin/sessao", { usuario: "ADM", senha: "errada" })).status).toBe(401);
    const e = await chamar("POST", "/admin/sessao", { usuario: "adm", senha: "4321" });
    expect(e.status).toBe(200);
    expect(e.corpo.exigeTrocaSenha).toBe(true);
    const s = { "x-admin-sessao": e.corpo.token };
    const bloqueado = await chamar("GET", "/admin/fechamentos", undefined, s);
    expect([bloqueado.status, bloqueado.corpo.codigo]).toEqual([403, "TROCA_SENHA_OBRIGATORIA"]);
    expect((await chamar("POST", "/admin/trocar-senha", { senhaAtual: "4321", novaSenha: "4321" }, s)).status).toBe(422);
    expect((await chamar("POST", "/admin/trocar-senha", { senhaAtual: "0000", novaSenha: "uma-senha-boa" }, s)).status).toBe(401);
    expect((await chamar("POST", "/admin/trocar-senha", { senhaAtual: "4321", novaSenha: "uma-senha-boa" }, s)).status).toBe(200);
    expect((await chamar("GET", "/admin/fechamentos", undefined, s)).status).toBe(200);
    expect((await chamar("POST", "/admin/sessao", { usuario: "ADM", senha: "4321" })).status).toBe(401);
    const { rows } = await db.query<{ senha_hash: string }>("select senha_hash from admin_credenciais");
    expect(rows[0].senha_hash).toMatch(/^\$2[aby]\$/);
  });

  it("limita tentativas de login e permite encerrar sessões", async () => {
    const s = await admin();
    expect((await chamar("POST", "/admin/sessoes/encerrar", {}, s)).status).toBe(200);
    expect((await chamar("GET", "/admin/config", undefined, s)).status).toBe(401);
    let ultimo = 0;
    for (let i = 0; i < 9; i++) ultimo = (await chamar("POST", "/admin/sessao", { usuario: "ADM", senha: "chute" })).status;
    expect(ultimo).toBe(429);
  });

  it("T15 — nova forma de pagamento aparece nos novos lançamentos e no resumo", async () => {
    const s = await admin();
    const r = await chamar("POST", "/admin/formas-pagamento", { nome: "Rappi" }, s);
    const rappi = r.corpo.formas.find((f: any) => f.nome === "Rappi");
    expect(rappi).toMatchObject({ ativa: true, ordem: 8 });
    expect((await chamar("GET", "/config")).corpo.formas.map((f: any) => f.nome)).toContain("Rappi");
    const f = await criar();
    const valores = { aberturaCentavos: 0, houveSangria: false, sangriaCentavos: 0, lancamentos: [lanc(rappi.formaId, 4000)] };
    await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...ident(), ...valores, revisao: 1 }, f.t);
    const fim = await chamar("POST", `/fechamentos/${f.id}/finalizar`, { revisao: 1, confirmacao: { dinheiroLancarCentavos: 0, totalLancarCentavos: 4000 } }, f.t);
    expect(fim.corpo.fechamento.snapshot.formas.at(-1)).toMatchObject({ nome: "Rappi", subtotalCentavos: 4000 });
  });

  it("T16 — desativar ou renomear uma forma preserva nome e valor nos fechamentos antigos", async () => {
    const f = await finalizado();
    const s = await admin();
    await chamar("PUT", "/admin/formas-pagamento/credito", { nome: "Cartão de crédito", ativa: false }, s);
    expect((await chamar("GET", "/config")).corpo.formas.find((x: any) => x.formaId === "credito")).toMatchObject({ ativa: false, nome: "Cartão de crédito" });
    const d = await chamar("GET", `/admin/fechamentos/${f.id}`, undefined, s);
    expect(d.corpo.fechamento.snapshot.formas.find((x: any) => x.formaId === "credito")).toMatchObject({ nome: "Crédito", subtotalCentavos: 15500 });
  });

  it("lojas: cadastra, renomeia, desativa e impede nome duplicado ativo", async () => {
    const s = await admin();
    expect((await chamar("POST", "/admin/lojas", { nome: "vila grill 1" }, s)).status).toBe(409);
    const r = await chamar("POST", "/admin/lojas", { nome: "Praia Grill" }, s);
    const nova = r.corpo.lojas.find((l: any) => l.nome === "Praia Grill");
    expect((await chamar("PUT", `/admin/lojas/${nova.lojaId}`, { nome: "Araçá Grill" }, s)).status).toBe(409);
    await chamar("PUT", `/admin/lojas/${nova.lojaId}`, { ativa: false }, s);
    expect((await chamar("GET", "/config")).corpo.lojas.map((l: any) => l.nome)).not.toContain("Praia Grill");
    expect((await criar({ lojaId: nova.lojaId })).status).toBe(422);
  });

  it("ordena formas e salva parâmetros de exibição", async () => {
    const s = await admin();
    const r = await chamar("PUT", "/admin/formas-pagamento-ordem", { ids: ["pix", "credito", "debito", "voucher", "assinadas", "ifood", "99food"] }, s);
    expect(r.corpo.formas.map((f: any) => f.formaId).slice(0, 2)).toEqual(["pix", "credito"]);
    const p = await chamar("PUT", "/admin/parametros", { mostrarZerados: false }, s);
    expect(p.corpo.parametros).toEqual({ mostrarZerados: false, imprimirMemoria: true });
  });

  it("consulta com filtros por loja, turno, responsável, status e correção", async () => {
    const a = await finalizado();
    await chamar("POST", `/fechamentos/${a.id}/corrigir`, correcao(a.valores), a.t);
    await finalizado({ lojaId: "araca-grill", responsavelNome: "João Lima" });
    await criar({ turno: "manha", responsavelNome: "Ana" });
    const s = await admin();
    const q = async (filtro: string) => (await chamar("GET", `/admin/fechamentos?${filtro}`, undefined, s)).corpo.itens;
    expect(await q("")).toHaveLength(3);
    expect(await q("loja=araca-grill")).toHaveLength(1);
    expect(await q("turno=manha")).toHaveLength(1);
    expect(await q("responsavel=jo%C3%A3o")).toHaveLength(1);
    expect(await q("status=rascunho")).toHaveLength(1);
    expect(await q("corrigido=sim")).toHaveLength(1);
    expect(await q(`de=${HOJE}&ate=${HOJE}`)).toHaveLength(3);
    expect(await q("de=2999-01-01")).toHaveLength(0);
    const corrigido = (await q("corrigido=sim"))[0];
    expect(corrigido).toMatchObject({ totalLancarCentavos: 98000, dinheiroLancarCentavos: 70000, quantidadeCorrecoes: 1 });
    expect(corrigido.formas.find((x: any) => x.formaId === "pix").subtotalCentavos).toBe(12500);
  });
});

describe("gravação do rascunho em comando único", () => {
  it("troca os lançamentos: remove, altera, reordena e inclui, e a leitura devolve o mesmo que o salvamento", async () => {
    const f = await criar();
    const [a, b, c2] = [lanc("credito", 1000), lanc("pix", 2000), lanc(null, 3000)];
    const base = { ...ident(), aberturaCentavos: 0, houveSangria: false, sangriaCentavos: 0 };
    const s1 = await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...base, lancamentos: [a, b, c2], revisao: 1 }, f.t);
    expect(s1.corpo.aplicado).toBe(true);
    expect(s1.corpo.fechamento.lancamentos).toEqual([a, b, c2]);

    const d = lanc("debito", 4000);
    const nova = [c2, { ...a, valorCentavos: 1500, formaId: "voucher" }, d]; // b sai, a muda, ordem muda, d entra
    const s2 = await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...base, lancamentos: nova, revisao: 2 }, f.t);
    expect(s2.corpo.aplicado).toBe(true);
    expect(s2.corpo.fechamento.revisao).toBe(2);
    const lido = await chamar("GET", `/fechamentos/${f.id}`, undefined, f.t);
    expect(lido.corpo.fechamento.lancamentos).toEqual(nova);
    expect(lido.corpo.fechamento).toEqual(s2.corpo.fechamento);

    // Revisão atrasada não altera nada e devolve o estado atual.
    const s3 = await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...base, lancamentos: [], revisao: 2 }, f.t);
    expect(s3.corpo.aplicado).toBe(false);
    expect(s3.corpo.fechamento).toEqual(s2.corpo.fechamento);

    const s4 = await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...base, lancamentos: [], revisao: 3 }, f.t);
    expect(s4.corpo.fechamento.lancamentos).toEqual([]);
    expect((await db.query("select 1 from lancamentos")).rows).toHaveLength(0);
  });

  it("finalizar e corrigir devolvem exatamente o que a leitura devolve depois", async () => {
    const f = await finalizado();
    const lido1 = await chamar("GET", `/fechamentos/${f.id}`, undefined, f.t);
    expect(lido1.corpo.fechamento).toEqual(f.fechamento);
    const r = await chamar("POST", `/fechamentos/${f.id}/corrigir`, correcao(f.valores), f.t);
    expect(r.status).toBe(200);
    const lido2 = await chamar("GET", `/fechamentos/${f.id}`, undefined, f.t);
    expect(lido2.corpo.fechamento).toEqual(r.corpo.fechamento);
    expect(lido2.corpo.fechamento.lancamentos).toHaveLength(6);
  });
});

describe("usuários cadastrados por loja", () => {
  it("só o ADM cadastra; o usuário precisa de nome e de ao menos uma loja; nomes ativos não se repetem", async () => {
    expect((await chamar("POST", "/admin/usuarios", { nome: "Carla", lojaIds: ["araca-grill"] })).status).toBe(401);
    const a = await admin();
    expect((await chamar("POST", "/admin/usuarios", { nome: "C", lojaIds: ["araca-grill"] }, a)).status).toBe(422);
    expect((await chamar("POST", "/admin/usuarios", { nome: "Carla", lojaIds: [] }, a)).status).toBe(422);
    expect((await chamar("POST", "/admin/usuarios", { nome: "Carla", lojaIds: ["nao-existe"] }, a)).status).toBe(422);
    const r = await chamar("POST", "/admin/usuarios", { nome: "Carla", lojaIds: ["araca-grill"] }, a);
    expect(r.status).toBe(200);
    const carla = r.corpo.usuarios.find((u: any) => u.nome === "Carla");
    expect(carla).toMatchObject({ ativo: true, lojaIds: ["araca-grill"] });
    expect((await chamar("POST", "/admin/usuarios", { nome: "carla", lojaIds: ["araca-grill"] }, a)).status).toBe(409);
  });

  it("o fechamento só é criado por usuário ativo cadastrado para a loja, e guarda o nome do cadastro", async () => {
    const a = await admin();
    const r = await chamar("POST", "/admin/usuarios", { nome: "Carla Dias", lojaIds: ["araca-grill"] }, a);
    const id = r.corpo.usuarios.find((u: any) => u.nome === "Carla Dias").usuarioId;

    expect((await criar({ responsavelNome: "Desconhecido" })).corpo.codigo).toBe("USUARIO_NAO_CADASTRADO");
    expect((await criar({ responsavelNome: "Carla Dias", lojaId: "vila-grill-1" })).corpo.codigo).toBe("USUARIO_NAO_CADASTRADO");
    const ok = await criar({ responsavelNome: "carla dias", lojaId: "araca-grill" });
    expect(ok.status).toBe(201);
    expect(ok.corpo.fechamento.responsavelNome).toBe("Carla Dias");

    // A configuração pública lista só os ativos, com as lojas de cada um.
    const cfg = await chamar("GET", "/config");
    expect(cfg.corpo.usuarios.find((u: any) => u.usuarioId === id)).toMatchObject({ nome: "Carla Dias", lojaIds: ["araca-grill"] });

    // Trocar as lojas e desativar.
    const t = await chamar("PUT", `/admin/usuarios/${id}`, { lojaIds: ["vila-grill-1", "vila-grill-2"] }, a);
    expect(t.corpo.usuarios.find((u: any) => u.usuarioId === id).lojaIds).toEqual(["vila-grill-1", "vila-grill-2"]);
    expect((await criar({ responsavelNome: "Carla Dias", lojaId: "araca-grill", turno: "manha" })).status).toBe(422);
    expect((await criar({ responsavelNome: "Carla Dias", lojaId: "vila-grill-2" })).status).toBe(201);
    await chamar("PUT", `/admin/usuarios/${id}`, { ativo: false }, a);
    expect((await criar({ responsavelNome: "Carla Dias", lojaId: "vila-grill-2", turno: "tarde" })).status).toBe(422);
    expect((await chamar("GET", "/config")).corpo.usuarios.some((u: any) => u.usuarioId === id)).toBe(false);
  });

  it("no rascunho, trocar o responsável ou a loja exige usuário cadastrado; a correção também", async () => {
    const f = await criar();
    const base = { aberturaCentavos: 0, houveSangria: false, sangriaCentavos: 0, lancamentos: [] };
    const ruim = await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...ident({ responsavelNome: "Fulano" }), ...base, revisao: 1 }, f.t);
    expect(ruim.corpo.codigo).toBe("USUARIO_NAO_CADASTRADO");
    const bom = await chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...ident({ responsavelNome: "ana" }), ...base, revisao: 1 }, f.t);
    expect(bom.corpo.fechamento.responsavelNome).toBe("Ana");

    const g = await finalizado({ turno: "manha" });
    const c1 = await chamar("POST", `/fechamentos/${g.id}/corrigir`, correcao(g.valores, { autorDeclarado: "Fulano" }), g.t);
    expect(c1.corpo.codigo).toBe("USUARIO_NAO_CADASTRADO");
    expect((await chamar("POST", `/fechamentos/${g.id}/corrigir`, correcao(g.valores, { autorDeclarado: "João" }), g.t)).status).toBe(200);
  });
});

describe("edição pelo administrador", () => {
  const edicao = (valores: ReturnType<typeof valoresExemplo>, versaoEsperada: number, extra: Record<string, unknown> = {}) => ({
    versaoEsperada,
    motivo: "Comprovante de Pix conferido depois",
    observacao: "",
    ...valores,
    lancamentos: [...valores.lancamentos, lanc("pix", 2500)],
    confirmacao: { dinheiroLancarCentavos: 70000, totalLancarCentavos: 98000 },
    ...extra,
  });

  it("exige sessão ADM, fechamento finalizado, motivo, versão atual e alguma alteração", async () => {
    const f = await finalizado();
    expect((await chamar("POST", `/admin/fechamentos/${f.id}/editar`, edicao(f.valores, 1))).status).toBe(401);
    const a = await admin();
    expect((await chamar("POST", `/admin/fechamentos/${f.id}/editar`, edicao(f.valores, 1, { motivo: "" }), a)).status).toBe(422);
    expect((await chamar("POST", `/admin/fechamentos/${f.id}/editar`, edicao(f.valores, 7), a)).corpo.codigo).toBe("VERSAO_DESATUALIZADA");
    const igual = { ...edicao(f.valores, 1), lancamentos: f.valores.lancamentos, confirmacao: CONFIRMACAO_EXEMPLO };
    expect((await chamar("POST", `/admin/fechamentos/${f.id}/editar`, igual, a)).corpo.codigo).toBe("SEM_ALTERACOES");
    const errado = edicao(f.valores, 1, { confirmacao: { dinheiroLancarCentavos: 1, totalLancarCentavos: 1 } });
    expect((await chamar("POST", `/admin/fechamentos/${f.id}/editar`, errado, a)).corpo.codigo).toBe("CALCULO_DIVERGENTE");
    const r = await criar({ turno: "manha" });
    expect((await chamar("POST", `/admin/fechamentos/${r.id}/editar`, edicao(f.valores, 0), a)).corpo.codigo).toBe("NAO_FINALIZADO");
  });

  it("edita quantas vezes precisar, marca o que mudou, registra no histórico e não consome a correção do funcionário", async () => {
    const f = await finalizado();
    const a = await admin();
    const e1 = await chamar("POST", `/admin/fechamentos/${f.id}/editar`, edicao(f.valores, 1), a);
    expect(e1.status).toBe(200);
    expect(e1.corpo.fechamento).toMatchObject({ versao: 2, quantidadeEdicoesAdm: 1, quantidadeCorrecoes: 0 });
    expect(e1.corpo.fechamento.snapshot.alteradoPeloAdm.sort()).toEqual(["forma:pix", "total"]);
    expect(e1.corpo.fechamento.snapshot.totalLancarCentavos).toBe(98000);

    // Segunda edição: muda a abertura (dinheiro a lançar 700 → 750) e acumula as marcas.
    const v2 = { ...f.valores, lancamentos: e1.corpo.fechamento.lancamentos, aberturaCentavos: 15000 };
    const e2 = await chamar("POST", `/admin/fechamentos/${f.id}/editar`, {
      versaoEsperada: 2, motivo: "Abertura conferida no cofre", observacao: "Conferido pelo ADM", ...v2,
      confirmacao: { dinheiroLancarCentavos: 75000, totalLancarCentavos: 103000 },
    }, a);
    expect(e2.status).toBe(200);
    expect(e2.corpo.fechamento).toMatchObject({ versao: 3, quantidadeEdicoesAdm: 2, observacao: "Conferido pelo ADM" });
    expect(e2.corpo.fechamento.snapshot.alteradoPeloAdm.sort()).toEqual(["abertura", "dinheiroLancar", "forma:pix", "observacao", "total"]);

    // O funcionário ainda tem a correção única; o que ele mexer deixa de ser "do ADM".
    const atual = e2.corpo.fechamento as Fechamento;
    const c1 = await chamar("POST", `/fechamentos/${f.id}/corrigir`, {
      requisicaoId: "req-depois-do-adm", versaoEsperada: 3, autorDeclarado: "Maria Souza", motivo: "Faltou um crédito", observacao: atual.observacao,
      aberturaCentavos: atual.aberturaCentavos, houveSangria: atual.houveSangria, sangriaCentavos: atual.sangriaCentavos,
      lancamentos: [...atual.lancamentos, lanc("credito", 1000)],
      confirmacao: { dinheiroLancarCentavos: 75000, totalLancarCentavos: 104000 },
    }, f.t);
    expect(c1.status).toBe(200);
    expect(c1.corpo.fechamento).toMatchObject({ versao: 4, quantidadeCorrecoes: 1, quantidadeEdicoesAdm: 2 });
    expect(c1.corpo.fechamento.snapshot.alteradoPeloAdm.sort()).toEqual(["abertura", "dinheiroLancar", "forma:pix", "observacao"]);

    // Mesmo bloqueado para o funcionário, o ADM continua podendo editar.
    const fim = c1.corpo.fechamento as Fechamento;
    const e3 = await chamar("POST", `/admin/fechamentos/${f.id}/editar`, {
      versaoEsperada: 4, motivo: "Ajuste final do ADM", observacao: fim.observacao, aberturaCentavos: fim.aberturaCentavos,
      houveSangria: fim.houveSangria, sangriaCentavos: fim.sangriaCentavos, lancamentos: fim.lancamentos.slice(1),
      confirmacao: { dinheiroLancarCentavos: 75000, totalLancarCentavos: 92000 },
    }, a);
    expect(e3.status).toBe(200);
    expect(e3.corpo.fechamento).toMatchObject({ versao: 5, quantidadeEdicoesAdm: 3, quantidadeCorrecoes: 1 });

    const d = await chamar("GET", `/admin/fechamentos/${f.id}`, undefined, a);
    expect(d.corpo.historico.map((h: any) => h.tipo)).toEqual(["finalizacao", "edicao_adm", "edicao_adm", "correcao", "edicao_adm"]);
    expect(d.corpo.historico[1]).toMatchObject({ autorDeclarado: "Administrador", motivo: "Comprovante de Pix conferido depois" });
    expect(d.corpo.fechamento).toEqual(e3.corpo.fechamento);
    const lista = await chamar("GET", "/admin/fechamentos", undefined, a);
    expect(lista.corpo.itens[0].quantidadeEdicoesAdm).toBe(3);
  });

  it("as travas do banco continuam valendo fora da edição do ADM", async () => {
    const f = await finalizado();
    await expect(db.query("update fechamentos set quantidade_edicoes_adm = 1, versao = 2 where fechamento_id = $1", [f.id])).rejects.toThrow();
    await chamar("POST", `/fechamentos/${f.id}/corrigir`, correcao(f.valores), f.t);
    await expect(db.query("delete from lancamentos where fechamento_id = $1", [f.id])).rejects.toThrow(/bloqueado/);
  });
});

describe("abertura do caixa como conferência", () => {
  const DIAS_ATRAS = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
  const abertura = (f: { id: string; t: Record<string, string> }, corpo: Record<string, unknown>) => chamar("POST", `/fechamentos/${f.id}/abertura`, corpo, f.t);
  const salvar = (f: { id: string; t: Record<string, string> }, extra: Record<string, unknown>, valores: Record<string, unknown>, revisao = 1) =>
    chamar("PUT", `/fechamentos/${f.id}/rascunho`, { ...ident(extra), ...valores, revisao }, f.t);
  /** Pix 100 e R$ 900,00 na gaveta, sem sangria. */
  const valoresTarde = (aberturaCentavos: number | null = null) => ({
    aberturaCentavos,
    houveSangria: false,
    sangriaCentavos: 0,
    lancamentos: [lanc("pix", 10000), lanc(null, 90000)],
  });

  /** Manhã finalizada com R$ 850,00 na gaveta; tarde criada, com a abertura confirmada ("Sim") e finalizada. */
  async function tardeConferida() {
    await finalizado({ turno: "manha" });
    const f = await criar({ turno: "tarde" });
    expect((await abertura(f, { confere: true, esperadoCentavos: 85000 })).status).toBe(200);
    const valores = valoresTarde();
    expect((await salvar(f, { turno: "tarde" }, valores)).status).toBe(200);
    const r = await chamar("POST", `/fechamentos/${f.id}/finalizar`, { revisao: 1, confirmacao: { dinheiroLancarCentavos: 5000, totalLancarCentavos: 15000 } }, f.t);
    expect(r.status).toBe(200);
    return { ...f, valores: { ...valores, aberturaCentavos: 85000 }, fechamento: r.corpo.fechamento as Fechamento };
  }

  it("sem fechamento anterior, ou com a gaveta anterior zerada, a abertura é digitada livremente, sem senha", async () => {
    const primeiro = await criar({ turno: "manha" });
    expect(primeiro.corpo.fechamento.abertura).toEqual({ situacao: "livre", esperadoCentavos: null, origem: null, anteriorEmRascunho: false });
    // Manhã finalizada sem dinheiro na gaveta.
    const zerado = { aberturaCentavos: 0, houveSangria: false, sangriaCentavos: 0, lancamentos: [lanc("pix", 10000)] };
    await salvar(primeiro, { turno: "manha" }, zerado);
    expect((await chamar("POST", `/fechamentos/${primeiro.id}/finalizar`, { revisao: 1, confirmacao: { dinheiroLancarCentavos: 0, totalLancarCentavos: 10000 } }, primeiro.t)).status).toBe(200);
    const tarde = await criar({ turno: "tarde" });
    expect(tarde.corpo.fechamento.abertura.situacao).toBe("livre");
    const s = await salvar(tarde, { turno: "tarde" }, valoresTarde(30000));
    expect(s.corpo.fechamento.aberturaCentavos).toBe(30000);
    expect((await abertura(tarde, { confere: true, esperadoCentavos: 0 })).corpo.codigo).toBe("ABERTURA_LIVRE");
    const fim = await chamar("POST", `/fechamentos/${tarde.id}/finalizar`, { revisao: 1, confirmacao: { dinheiroLancarCentavos: 60000, totalLancarCentavos: 70000 } }, tarde.t);
    expect(fim.status).toBe(200);
    expect(fim.corpo.fechamento.abertura.situacao).toBe("livre");
    expect(fim.corpo.fechamento.snapshot.aberturaDivergente).toBeUndefined();
  });

  it("o esperado é o dinheiro da gaveta BRUTO do último finalizado da mesma loja, mesmo de dias atrás", async () => {
    // Três dias atrás, à noite: R$ 850,00 na gaveta (o dinheiro a lançar foi R$ 700,00 — não é esse o valor).
    await finalizado({ dataLocal: DIAS_ATRAS(3), turno: "noite" });
    // Outra loja e um fechamento posterior não interferem.
    await finalizado({ lojaId: "vila-grill-2", dataLocal: DIAS_ATRAS(1), turno: "noite" });
    const f = await criar({ turno: "manha" });
    expect(f.corpo.fechamento.abertura).toEqual({
      situacao: "pendente", esperadoCentavos: 85000, origem: { dataLocal: DIAS_ATRAS(3), turno: "noite" }, anteriorEmRascunho: false,
    });
    expect(f.corpo.fechamento.aberturaCentavos).toBeNull();
    // Um rascunho no meio do caminho não conta como anterior, mas é avisado.
    await criar({ dataLocal: DIAS_ATRAS(1), turno: "tarde" });
    const lido = await chamar("GET", `/fechamentos/${f.id}`, undefined, f.t);
    expect(lido.corpo.fechamento.abertura).toMatchObject({ situacao: "pendente", esperadoCentavos: 85000, anteriorEmRascunho: true });
  });

  it("dentro do dia a ordem é manhã, tarde, noite", async () => {
    await finalizado({ turno: "manha" });
    const tarde = await criar({ turno: "tarde" });
    await abertura(tarde, { confere: true, esperadoCentavos: 85000 });
    await salvar(tarde, { turno: "tarde" }, valoresTarde());
    await chamar("POST", `/fechamentos/${tarde.id}/finalizar`, { revisao: 1, confirmacao: { dinheiroLancarCentavos: 5000, totalLancarCentavos: 15000 } }, tarde.t);
    const noite = await criar({ turno: "noite" });
    expect(noite.corpo.fechamento.abertura).toMatchObject({ esperadoCentavos: 90000, origem: { dataLocal: HOJE, turno: "tarde" } });
  });

  it("Sim: a abertura fica com o valor esperado e a fórmula do dinheiro não muda", async () => {
    const f = await tardeConferida();
    expect(f.fechamento.aberturaCentavos).toBe(85000);
    expect(f.fechamento.abertura).toEqual({ situacao: "sim", esperadoCentavos: 85000, origem: { dataLocal: HOJE, turno: "manha" }, anteriorEmRascunho: false });
    // Dinheiro a lançar = gaveta 900 − (abertura 850 − sangria 0) = 50.
    expect(f.fechamento.snapshot).toMatchObject({ aberturaCentavos: 85000, dinheiroContadoCentavos: 90000, dinheiroLancarCentavos: 5000, totalLancarCentavos: 15000 });
    expect(f.fechamento.snapshot!.aberturaDivergente).toBeUndefined();
  });

  it("a tela não é a fonte da verdade: abertura digitada é ignorada e sem conferência não finaliza", async () => {
    await finalizado({ turno: "manha" });
    const f = await criar({ turno: "tarde" });
    // Tela antiga ou adulterada manda a abertura que quiser: o servidor não aceita.
    const s = await salvar(f, { turno: "tarde" }, valoresTarde(10000));
    expect(s.corpo.fechamento.aberturaCentavos).toBeNull();
    expect(s.corpo.fechamento.abertura.situacao).toBe("pendente");
    const fim = await chamar("POST", `/fechamentos/${f.id}/finalizar`, { revisao: 1, confirmacao: { dinheiroLancarCentavos: 80000, totalLancarCentavos: 90000 } }, f.t);
    expect(fim.corpo.codigo).toBe("PENDENCIAS");
    expect(fim.corpo.mensagem).toContain("Confira a abertura");
    // "Sim" para um valor que não é o do servidor não vale.
    const errado = await abertura(f, { confere: true, esperadoCentavos: 10000 });
    expect(errado.status).toBe(409);
    expect(errado.corpo.codigo).toBe("ABERTURA_MUDOU");
    expect(errado.corpo.fechamento.abertura.esperadoCentavos).toBe(85000);
    expect((await abertura(f, {})).status).toBe(422);
    expect((await abertura(f, { confere: true, esperadoCentavos: 85000 }, )).status).toBe(200);
    // Depois de conferida, o rascunho continua sem conseguir trocar a abertura.
    const depois = await salvar(f, { turno: "tarde" }, valoresTarde(10000), 2);
    expect(depois.corpo.fechamento.aberturaCentavos).toBe(85000);
    // Sem a chave do aparelho ninguém confere a abertura.
    expect((await chamar("POST", `/fechamentos/${f.id}/abertura`, { confere: true, esperadoCentavos: 85000 })).status).toBe(403);
  });

  it("Não: exige a senha do gerente, marca a divergência e torna a observação obrigatória", async () => {
    await finalizado({ turno: "manha" });
    const f = await criar({ turno: "tarde" });
    const nao = (extra: Record<string, unknown> = {}) => abertura(f, { confere: false, esperadoCentavos: 85000, valorCentavos: 80000, ...extra });
    expect((await nao()).corpo.codigo).toBe("SENHA_GERENTE_NECESSARIA");
    expect((await nao({ senhaGerente: GERENTE })).corpo.codigo).toBe("SENHA_GERENTE_NAO_CADASTRADA");
    const a = await cadastrarGerente();
    const errada = await nao({ senhaGerente: "0000" });
    expect(errada.status).toBe(403);
    expect(errada.corpo.codigo).toBe("SENHA_GERENTE_INCORRETA");
    // A senha do ADM não libera a abertura.
    expect((await nao({ senhaGerente: "caixa-certo-2026" })).corpo.codigo).toBe("SENHA_GERENTE_NECESSARIA");
    expect((await chamar("GET", `/fechamentos/${f.id}`, undefined, f.t)).corpo.fechamento.abertura.situacao).toBe("pendente");

    const ok = await nao({ senhaGerente: GERENTE });
    expect(ok.status).toBe(200);
    expect(ok.corpo.fechamento.aberturaCentavos).toBe(80000);
    expect(ok.corpo.fechamento.abertura).toMatchObject({ situacao: "divergente", esperadoCentavos: 85000 });

    // Gaveta 900 − (abertura 800 − 0) = 100. Sem observação não finaliza.
    await salvar(f, { turno: "tarde" }, valoresTarde());
    const confirmacao = { dinheiroLancarCentavos: 10000, totalLancarCentavos: 20000 };
    const semObs = await chamar("POST", `/fechamentos/${f.id}/finalizar`, { revisao: 1, confirmacao }, f.t);
    expect(semObs.corpo.codigo).toBe("PENDENCIAS");
    expect(semObs.corpo.mensagem).toContain("observação");
    await salvar(f, { turno: "tarde", observacao: "Faltavam R$ 50,00 na gaveta; conferido com o gerente." }, valoresTarde(), 2);
    const fim = await chamar("POST", `/fechamentos/${f.id}/finalizar`, { revisao: 2, confirmacao }, f.t);
    expect(fim.status).toBe(200);
    expect(fim.corpo.fechamento.snapshot.aberturaDivergente).toEqual({ esperadoCentavos: 85000, encontradoCentavos: 80000 });
    expect(fim.corpo.fechamento.snapshot.dinheiroLancarCentavos).toBe(10000);

    // O ADM vê a marca nas consultas e no detalhe.
    const lista = await chamar("GET", `/admin/fechamentos?turno=tarde`, undefined, a);
    expect(lista.corpo.itens[0].aberturaDivergente).toEqual({ esperadoCentavos: 85000, encontradoCentavos: 80000 });
    expect((await chamar("GET", `/admin/fechamentos?turno=manha`, undefined, a)).corpo.itens[0].aberturaDivergente).toBeNull();
    const detalhe = await chamar("GET", `/admin/fechamentos/${f.id}`, undefined, a);
    expect(detalhe.corpo.fechamento.abertura.situacao).toBe("divergente");
    expect(detalhe.corpo.historico[0].depois.aberturaDivergente).toEqual({ esperadoCentavos: 85000, encontradoCentavos: 80000 });
  });

  it("com a senha do gerente, valor igual ao esperado conta como Sim; e dá para voltar atrás no rascunho", async () => {
    await finalizado({ turno: "manha" });
    await cadastrarGerente();
    const f = await criar({ turno: "tarde" });
    const igual = await abertura(f, { confere: false, esperadoCentavos: 85000, valorCentavos: 85000, senhaGerente: GERENTE });
    expect(igual.corpo.fechamento.abertura.situacao).toBe("sim");
    const outro = await abertura(f, { confere: false, esperadoCentavos: 85000, valorCentavos: 70000, senhaGerente: GERENTE });
    expect(outro.corpo.fechamento.abertura.situacao).toBe("divergente");
    const volta = await abertura(f, { confere: true, esperadoCentavos: 85000 });
    expect(volta.corpo.fechamento).toMatchObject({ aberturaCentavos: 85000, abertura: { situacao: "sim" } });
  });

  it("limita as tentativas de senha do gerente; senha certa não consome tentativa", async () => {
    await finalizado({ turno: "manha" });
    await cadastrarGerente();
    const f = await criar({ turno: "tarde" });
    const tentar = (senhaGerente: string) => abertura(f, { confere: false, esperadoCentavos: 85000, valorCentavos: 80000, senhaGerente });
    for (let i = 0; i < 3; i++) expect((await tentar(GERENTE)).status).toBe(200);
    for (let i = 0; i < 5; i++) expect((await tentar("1111")).corpo.codigo).toBe("SENHA_GERENTE_INCORRETA");
    const bloqueada = await tentar(GERENTE);
    expect(bloqueada.status).toBe(429);
    expect(bloqueada.corpo.codigo).toBe("MUITAS_TENTATIVAS");
  });

  it("senha do gerente: só o ADM cadastra, 4 dígitos, só o hash no banco, e não abre nada do ADM", async () => {
    expect((await chamar("PUT", "/admin/senha-gerente", { senha: GERENTE })).status).toBe(401);
    const a = await admin();
    expect((await chamar("GET", "/admin/config", undefined, a)).corpo.senhaGerenteCadastrada).toBe(false);
    for (const senha of ["123", "12345", "abcd", "12 4", 1234, undefined]) {
      expect((await chamar("PUT", "/admin/senha-gerente", { senha }, a)).status).toBe(422);
    }
    const r = await chamar("PUT", "/admin/senha-gerente", { senha: GERENTE }, a);
    expect(r.corpo.senhaGerenteCadastrada).toBe(true);
    expect(JSON.stringify(r.corpo)).not.toContain(GERENTE);
    const { rows } = await db.query<{ senha_hash: string }>("select senha_hash from gerente_credencial");
    expect(rows).toHaveLength(1);
    expect(rows[0].senha_hash).toMatch(/^\$2[aby]\$/);
    // Trocar a senha substitui a anterior.
    await chamar("PUT", "/admin/senha-gerente", { senha: "2468" }, a);
    expect((await db.query("select 1 from gerente_credencial")).rows).toHaveLength(1);
    // Não é credencial de administrador e não aparece na configuração pública.
    expect((await chamar("POST", "/admin/sessao", { usuario: "ADM", senha: "2468" })).status).toBe(401);
    expect((await chamar("POST", "/admin/sessao", { usuario: "gerente", senha: "2468" })).status).toBe(401);
    expect((await chamar("GET", "/admin/fechamentos", undefined, { "x-admin-sessao": "2468" })).status).toBe(401);
    expect(JSON.stringify((await chamar("GET", "/config")).corpo)).not.toContain("erente");
  });

  it("mudar loja, data ou turno do rascunho refaz a conferência", async () => {
    await finalizado({ turno: "manha" });
    const f = await criar({ turno: "tarde" });
    await abertura(f, { confere: true, esperadoCentavos: 85000 });
    // Vai para outra loja, sem fechamento anterior: a abertura volta a ser digitada.
    const outraLoja = await salvar(f, { lojaId: "vila-grill-2", turno: "tarde" }, valoresTarde(12300));
    expect(outraLoja.corpo.fechamento).toMatchObject({ aberturaCentavos: 12300, abertura: { situacao: "livre", esperadoCentavos: null } });
    // Volta para a loja original: o valor digitado não vale e a pergunta é feita de novo.
    const volta = await salvar(f, { turno: "tarde" }, valoresTarde(12300), 2);
    expect(volta.corpo.fechamento).toMatchObject({ aberturaCentavos: null, abertura: { situacao: "pendente", esperadoCentavos: 85000 } });
  });

  it("se o anterior for finalizado depois de a abertura ter sido digitada, a conferência passa a ser exigida", async () => {
    const manha = await criar({ turno: "manha" });
    const tarde = await criar({ turno: "tarde" });
    expect(tarde.corpo.fechamento.abertura).toMatchObject({ situacao: "livre", anteriorEmRascunho: true });
    await salvar(tarde, { turno: "tarde" }, valoresTarde(20000));
    await salvar(manha, { turno: "manha" }, valoresExemplo());
    expect((await chamar("POST", `/fechamentos/${manha.id}/finalizar`, { revisao: 1, confirmacao: CONFIRMACAO_EXEMPLO }, manha.t)).status).toBe(200);
    const fim = await chamar("POST", `/fechamentos/${tarde.id}/finalizar`, { revisao: 1, confirmacao: { dinheiroLancarCentavos: 70000, totalLancarCentavos: 80000 } }, tarde.t);
    expect(fim.corpo.codigo).toBe("PENDENCIAS");
    expect(fim.corpo.mensagem).toContain("Confira a abertura");
  });

  it("correção do funcionário: mudar a abertura exige a senha do gerente e marca a divergência", async () => {
    const f = await tardeConferida();
    await cadastrarGerente();
    const corpo = (extra: Record<string, unknown> = {}) => ({
      requisicaoId: `req-${++seq}-abcdef`,
      versaoEsperada: 1,
      autorDeclarado: "Maria Souza",
      motivo: "A abertura estava errada",
      observacao: "",
      ...f.valores,
      aberturaCentavos: 80000,
      confirmacao: { dinheiroLancarCentavos: 10000, totalLancarCentavos: 20000 },
      ...extra,
    });
    const corrigir = (extra: Record<string, unknown> = {}) => chamar("POST", `/fechamentos/${f.id}/corrigir`, corpo(extra), f.t);
    expect((await corrigir()).corpo.codigo).toBe("SENHA_GERENTE_NECESSARIA");
    expect((await corrigir({ senhaGerente: "0000" })).corpo.codigo).toBe("SENHA_GERENTE_INCORRETA");
    const semObs = await corrigir({ senhaGerente: GERENTE });
    expect(semObs.corpo.codigo).toBe("PENDENCIAS");
    expect(semObs.corpo.mensagem).toContain("observação");
    // Nenhuma das tentativas recusadas consumiu a correção única.
    expect((await chamar("GET", `/fechamentos/${f.id}`, undefined, f.t)).corpo.fechamento).toMatchObject({ versao: 1, quantidadeCorrecoes: 0, aberturaCentavos: 85000 });

    const ok = await corrigir({ senhaGerente: GERENTE, observacao: "Na gaveta havia R$ 800,00; conferido com o gerente." });
    expect(ok.status).toBe(200);
    expect(ok.corpo.fechamento).toMatchObject({ versao: 2, quantidadeCorrecoes: 1, aberturaCentavos: 80000, abertura: { situacao: "divergente", esperadoCentavos: 85000 } });
    expect(ok.corpo.fechamento.snapshot.aberturaDivergente).toEqual({ esperadoCentavos: 85000, encontradoCentavos: 80000 });
  });

  it("correção do funcionário que não mexe na abertura continua sem senha e preserva a marca", async () => {
    await finalizado({ turno: "manha" });
    await cadastrarGerente();
    const f = await criar({ turno: "tarde" });
    await abertura(f, { confere: false, esperadoCentavos: 85000, valorCentavos: 80000, senhaGerente: GERENTE });
    const obs = "Faltavam R$ 50,00 na abertura.";
    await salvar(f, { turno: "tarde", observacao: obs }, valoresTarde());
    await chamar("POST", `/fechamentos/${f.id}/finalizar`, { revisao: 1, confirmacao: { dinheiroLancarCentavos: 10000, totalLancarCentavos: 20000 } }, f.t);
    const valores = valoresTarde(80000);
    const r = await chamar("POST", `/fechamentos/${f.id}/corrigir`, {
      requisicaoId: "req-sem-abertura-1", versaoEsperada: 1, autorDeclarado: "Maria Souza", motivo: "Faltou um Pix", observacao: obs,
      ...valores, lancamentos: [...valores.lancamentos, lanc("pix", 2500)],
      confirmacao: { dinheiroLancarCentavos: 10000, totalLancarCentavos: 22500 },
    }, f.t);
    expect(r.status).toBe(200);
    expect(r.corpo.fechamento.snapshot.aberturaDivergente).toEqual({ esperadoCentavos: 85000, encontradoCentavos: 80000 });
  });

  it("edição do ADM: altera a abertura sem senha do gerente, e a marca acompanha o valor", async () => {
    const f = await tardeConferida();
    const a = await admin();
    const editar = (versaoEsperada: number, aberturaCentavos: number, dinheiro: number) =>
      chamar("POST", `/admin/fechamentos/${f.id}/editar`, {
        versaoEsperada, motivo: "Abertura conferida pela gerência", observacao: "", ...f.valores, aberturaCentavos,
        confirmacao: { dinheiroLancarCentavos: dinheiro, totalLancarCentavos: dinheiro + 10000 },
      }, a);
    const diverge = await editar(1, 80000, 10000);
    expect(diverge.status).toBe(200);
    expect(diverge.corpo.fechamento.abertura.situacao).toBe("divergente");
    expect(diverge.corpo.fechamento.snapshot.aberturaDivergente).toEqual({ esperadoCentavos: 85000, encontradoCentavos: 80000 });
    expect(diverge.corpo.fechamento.snapshot.alteradoPeloAdm).toContain("abertura");
    const volta = await editar(2, 85000, 5000);
    expect(volta.status).toBe(200);
    expect(volta.corpo.fechamento.abertura.situacao).toBe("sim");
    expect(volta.corpo.fechamento.snapshot.aberturaDivergente).toBeUndefined();
    // O fechamento seguinte usa a gaveta deste, que não mudou.
    const noite = await criar({ turno: "noite" });
    expect(noite.corpo.fechamento.abertura.esperadoCentavos).toBe(90000);
  });
});
