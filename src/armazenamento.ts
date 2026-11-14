// O que fica guardado neste aparelho: as chaves de acesso dos fechamentos abertos aqui
// e as alterações ainda não confirmadas pelo servidor. Nada disso é sincronizado sozinho.
import type { Fechamento, StatusFechamento, Turno } from "@dominio/tipos.ts";
import type { DadosRascunho } from "./api.ts";

export interface Conhecido {
  id: string;
  token: string;
  lojaNome: string;
  dataLocal: string;
  turno: Turno;
  responsavelNome: string;
  status: StatusFechamento;
  corrigido: boolean;
  vistoEm: string;
}

const ler = <T,>(area: Storage | undefined, chave: string, padrao: T): T => {
  try {
    const bruto = area?.getItem(chave);
    return bruto ? (JSON.parse(bruto) as T) : padrao;
  } catch {
    return padrao;
  }
};
const gravar = (area: Storage | undefined, chave: string, valor: unknown): void => {
  try {
    if (valor === null) area?.removeItem(chave);
    else area?.setItem(chave, JSON.stringify(valor));
  } catch { /* armazenamento indisponível: seguimos só com o servidor */ }
};
const local = () => (typeof localStorage === "undefined" ? undefined : localStorage);
const sessao = () => (typeof sessionStorage === "undefined" ? undefined : sessionStorage);

export const novoToken = (): string => [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
export const novoId = (): string => crypto.randomUUID();

export function conhecidos(): Conhecido[] {
  return Object.values(ler<Record<string, Conhecido>>(local(), "cc.fechamentos", {})).sort((x, y) => y.vistoEm.localeCompare(x.vistoEm));
}
export const tokenDe = (id: string): string | null => ler<Record<string, Conhecido>>(local(), "cc.fechamentos", {})[id]?.token ?? null;

/** Registra (ou atualiza) um fechamento aberto neste aparelho; mantém os 30 mais recentes. */
export function lembrar(f: Fechamento, token: string): void {
  const todos = ler<Record<string, Conhecido>>(local(), "cc.fechamentos", {});
  todos[f.id] = {
    id: f.id,
    token,
    lojaNome: f.lojaNome,
    dataLocal: f.dataLocal,
    turno: f.turno,
    responsavelNome: f.responsavelNome,
    status: f.status,
    corrigido: f.quantidadeCorrecoes > 0,
    vistoEm: new Date().toISOString(),
  };
  const recentes = Object.values(todos).sort((x, y) => y.vistoEm.localeCompare(x.vistoEm)).slice(0, 30);
  gravar(local(), "cc.fechamentos", Object.fromEntries(recentes.map((c) => [c.id, c])));
}

export interface RascunhoLocal {
  revisao: number;
  dados: DadosRascunho;
}
export const lerRascunhoLocal = (id: string) => ler<RascunhoLocal | null>(local(), `cc.rascunho.${id}`, null);
export const guardarRascunhoLocal = (id: string, r: RascunhoLocal | null) => gravar(local(), `cc.rascunho.${id}`, r);

export const ultimoNome = () => ler<string>(local(), "cc.nome", "");
export const guardarNome = (nome: string) => gravar(local(), "cc.nome", nome);

// A sessão ADM vive só enquanto a aba estiver aberta.
export const lerSessaoAdm = () => ler<string | null>(sessao(), "cc.adm", null);
export const guardarSessaoAdm = (token: string | null) => gravar(sessao(), "cc.adm", token);
