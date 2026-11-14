// Valores monetários sempre em centavos inteiros; reais só na interface.

/** Limite por valor individual: R$ 1.000.000,00. */
export const MAX_CENTAVOS = 100_000_000;

export type ResultadoDinheiro = { ok: true; centavos: number } | { ok: false; erro: string };

/**
 * Interpreta um texto digitado em reais.
 * Aceita `12`, `12,50`, `12.50`, `1.234,56` e `1,234.56`.
 * Rejeita o que é ambíguo (`1.234`, `1,234`), negativo ou não numérico.
 */
export function interpretarReais(texto: string): ResultadoDinheiro {
  const t = texto.trim().replace(/^R\$/i, "").replace(/\s+/g, "");
  if (t === "") return { ok: false, erro: "Digite um valor." };
  if (t.startsWith("-")) return { ok: false, erro: "Valores negativos não são aceitos." };
  if (!/^[\d.,]+$/.test(t)) return { ok: false, erro: "Use apenas números, com vírgula para os centavos." };

  let inteiro: string;
  let decimal = "";
  let m: RegExpExecArray | null;
  if (/^\d+$/.test(t)) {
    inteiro = t;
  } else if ((m = /^(\d+)[.,](\d{1,2})$/.exec(t))) {
    inteiro = m[1];
    decimal = m[2];
  } else if ((m = /^(\d{1,3}(?:\.\d{3})+),(\d{1,2})$/.exec(t))) {
    inteiro = m[1].replace(/\./g, "");
    decimal = m[2];
  } else if ((m = /^(\d{1,3}(?:,\d{3})+)\.(\d{1,2})$/.exec(t))) {
    inteiro = m[1].replace(/,/g, "");
    decimal = m[2];
  } else {
    return { ok: false, erro: "Valor ambíguo. Digite no formato 1234,56." };
  }

  if (inteiro.replace(/^0+/, "").length > 9) return { ok: false, erro: "Valor acima do limite permitido." };
  const centavos = Number(inteiro) * 100 + Number(decimal.padEnd(2, "0"));
  if (!Number.isSafeInteger(centavos)) return { ok: false, erro: "Valor inválido." };
  if (centavos > MAX_CENTAVOS) return { ok: false, erro: "Valor acima do limite permitido." };
  return { ok: true, centavos };
}

/** `123456` → `1.234,56` */
export function formatarNumero(centavos: number): string {
  const abs = Math.abs(Math.trunc(centavos));
  const reais = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const cent = String(abs % 100).padStart(2, "0");
  return `${centavos < 0 ? "-" : ""}${reais},${cent}`;
}

/** `123456` → `R$ 1.234,56` */
export function formatarReais(centavos: number): string {
  return centavos < 0 ? `-R$ ${formatarNumero(-centavos)}` : `R$ ${formatarNumero(centavos)}`;
}
