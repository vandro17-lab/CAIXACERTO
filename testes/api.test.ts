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
    const negativa = correcao(f.valores, { aberturaCentavos: 999900, confirmacao: { dinheiroLancarCentavos: -909900, totalLancarCentavos: -881900 } });
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
