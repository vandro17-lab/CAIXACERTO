export const TURNOS = ["manha", "tarde", "noite"] as const;
export type Turno = (typeof TURNOS)[number];
export const NOME_TURNO: Record<Turno, string> = { manha: "Manhã", tarde: "Tarde", noite: "Noite" };

export type TipoLancamento = "pagamento" | "dinheiro_contado";

export interface Lancamento {
  /** Identificador gerado no dispositivo; reenvios do mesmo lançamento não duplicam. */
  id: string;
  /** Forma de pagamento; `null` quando o lançamento é de dinheiro contado. */
  formaId: string | null;
  tipo: TipoLancamento;
  valorCentavos: number;
}

export interface Loja {
  lojaId: string;
  nome: string;
  ativa: boolean;
}

export interface Forma {
  formaId: string;
  nome: string;
  ordem: number;
  ativa: boolean;
}

export interface Parametros {
  /** Mostrar no resumo final as formas de pagamento com R$ 0,00. */
  mostrarZerados: boolean;
  /** Incluir a memória do cálculo na impressão. */
  imprimirMemoria: boolean;
}

/** Valores editáveis de um fechamento (rascunho ou correção). */
export interface Valores {
  aberturaCentavos: number | null;
  /** `null` enquanto o operador não responde se houve sangria de troco. */
  houveSangria: boolean | null;
  sangriaCentavos: number;
  lancamentos: Lancamento[];
}

export interface ResumoForma {
  formaId: string;
  nome: string;
  subtotalCentavos: number;
  lancamentos: number[];
}

/** Resultado do cálculo, na regra v1 (fiel à planilha P. CAIXA). */
export interface Resumo {
  formas: ResumoForma[];
  dinheiroContado: number[];
  dinheiroContadoCentavos: number;
  aberturaCentavos: number;
  sangriaCentavos: number;
  /** Abertura − Sangria de troco (célula O14). */
  ajusteCentavos: number;
  /** Dinheiro contado − Ajuste (célula I16, "VALOR DO CAIXA"). */
  dinheiroLancarCentavos: number;
  totalPagamentosCentavos: number;
  /** Formas de pagamento + Dinheiro a lançar. */
  totalLancarCentavos: number;
}

/** Retrato imutável de uma versão finalizada. */
export interface Snapshot extends Resumo {
  versao: number;
  regra: "v1";
  lojaId: string;
  lojaNome: string;
  dataLocal: string;
  turno: Turno;
  responsavelNome: string;
  observacao: string;
  houveSangria: boolean;
  registradoEm: string;
}

export type StatusFechamento = "rascunho" | "finalizado";

export interface Fechamento extends Valores {
  id: string;
  lojaId: string;
  lojaNome: string;
  dataLocal: string;
  turno: Turno;
  responsavelNome: string;
  observacao: string;
  status: StatusFechamento;
  versao: number;
  quantidadeCorrecoes: number;
  /** Contador de salvamentos do rascunho; o servidor ignora revisões antigas. */
  revisao: number;
  criadoEm: string;
  finalizadoEm: string | null;
  atualizadoEm: string;
  snapshot: Snapshot | null;
}

export interface Alteracao {
  auditoriaId: string;
  tipo: "finalizacao" | "correcao";
  versaoAnterior: number;
  versaoNova: number;
  autorDeclarado: string;
  motivo: string;
  alteradoEm: string;
  antes: Snapshot | null;
  depois: Snapshot;
}

export interface ItemConsulta {
  id: string;
  lojaId: string;
  lojaNome: string;
  dataLocal: string;
  turno: Turno;
  responsavelNome: string;
  status: StatusFechamento;
  versao: number;
  quantidadeCorrecoes: number;
  criadoEm: string;
  finalizadoEm: string | null;
  formas: { formaId: string; nome: string; subtotalCentavos: number }[];
  dinheiroLancarCentavos: number | null;
  totalLancarCentavos: number | null;
}

/** Corpo de erro devolvido pela API. */
export interface ErroApi {
  codigo: string;
  mensagem: string;
  [extra: string]: unknown;
}

export function ehTurno(v: unknown): v is Turno {
  return typeof v === "string" && (TURNOS as readonly string[]).includes(v);
}

/** `2026-11-14` → `14/11/2026` */
export function formatarData(dataLocal: string): string {
  const [a, m, d] = dataLocal.split("-");
  return `${d}/${m}/${a}`;
}

/** Compara nomes ignorando maiúsculas, acentos e espaços repetidos. */
export function normalizarNome(nome: string): string {
  return nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
