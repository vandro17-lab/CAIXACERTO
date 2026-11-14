// Peças comuns do backend. Só usa APIs padrão da Web, para rodar igual no
// Deno (Supabase Edge Functions) e no Node (servidor local e testes).

export type Linha = Record<string, any>;

/** Porta de acesso ao Postgres. `tx` executa tudo ou nada. */
export interface Sql {
  q<T = Linha>(texto: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (s: Sql) => Promise<T>): Promise<T>;
}

export interface Deps {
  sql: Sql;
  hashSenha(senha: string): Promise<string>;
  conferirSenha(senha: string, hash: string): Promise<boolean>;
  /** Origens aceitas no CORS; vazio = qualquer origem. */
  origens?: string[];
}

export class ErroHttp extends Error {
  constructor(
    public status: number,
    public codigo: string,
    mensagem: string,
    public extra: Record<string, unknown> = {},
  ) {
    super(mensagem);
  }
}

export interface Ctx {
  req: Request;
  sql: Sql;
  deps: Deps;
  ip: string;
  corpo: Linha;
  url: URL;
}

export function json(status: number, corpo: unknown): Response {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function sha256(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function novoToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const novoId = (): string => crypto.randomUUID();

export const iso = (v: unknown): string | null => (v == null ? null : new Date(v as string).toISOString());

// ---- validação de entrada -------------------------------------------------

const invalido = (campo: string, detalhe: string) =>
  new ErroHttp(422, "DADOS_INVALIDOS", `${campo}: ${detalhe}`, { campo });

export function texto(v: unknown, campo: string, min: number, max: number): string {
  if (typeof v !== "string") throw invalido(campo, "preenchimento obrigatório.");
  const t = v.replace(/\s+/g, " ").trim();
  if (t.length < min) throw invalido(campo, min <= 1 ? "preenchimento obrigatório." : `mínimo de ${min} caracteres.`);
  if (t.length > max) throw invalido(campo, `máximo de ${max} caracteres.`);
  return t;
}

/** Texto longo: preserva quebras de linha. */
export function textoLongo(v: unknown, campo: string, max: number): string {
  if (v == null) return "";
  if (typeof v !== "string") throw invalido(campo, "deve ser texto.");
  const t = v.trim();
  if (t.length > max) throw invalido(campo, `máximo de ${max} caracteres.`);
  return t;
}

export function inteiro(v: unknown, campo: string, min: number, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v)) throw invalido(campo, "deve ser um número inteiro de centavos.");
  if (v < min) throw invalido(campo, min === 0 ? "não pode ser negativo." : "valor abaixo do mínimo.");
  if (v > max) throw invalido(campo, "valor acima do limite permitido.");
  return v;
}

/**
 * Conta uma tentativa na janela e bloqueia ao passar do limite.
 * Mitiga abuso das rotas sem login; não substitui identificação real.
 */
export async function limitar(sql: Sql, chave: string, maximo: number, janelaSegundos: number): Promise<void> {
  const [r] = await sql.q<{ contagem: number }>(
    `insert into limites as l (chave, contagem, janela_inicio) values ($1::text, 1, now())
     on conflict (chave) do update set
       contagem = case when l.janela_inicio < now() - ($2::int * interval '1 second') then 1 else l.contagem + 1 end,
       janela_inicio = case when l.janela_inicio < now() - ($2::int * interval '1 second') then now() else l.janela_inicio end
     returning contagem`,
    [chave, janelaSegundos],
  );
  if (r.contagem > maximo) {
    throw new ErroHttp(429, "MUITAS_TENTATIVAS", "Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.");
  }
}
