import { useRef, useState } from "react";
import { formatarNumero, formatarReais, interpretarReais } from "@dominio/dinheiro.ts";
import type { Lancamento } from "@dominio/tipos.ts";

interface Props {
  titulo: string;
  itens: Lancamento[];
  aoAdicionar(centavos: number): void;
  aoEditar(id: string, centavos: number): void;
  aoRemover(id: string): void;
  /** Coluna de dinheiro físico: recebe um realce próprio. */
  dinheiro?: boolean;
  autoFocus?: boolean;
  className?: string;
}

/**
 * Uma coluna da planilha: lançamentos individuais, uma linha vazia no fim e subtotal automático.
 * Enter com valor válido adiciona UM lançamento e mantém o foco; Enter vazio não faz nada.
 */
export function ColunaLancamentos({ titulo, itens, aoAdicionar, aoEditar, aoRemover, dinheiro, autoFocus, className = "" }: Props) {
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const [erroEdicao, setErroEdicao] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  const lista = useRef<HTMLOListElement>(null);
  const subtotal = itens.reduce((s, l) => s + l.valorCentavos, 0);

  function adicionar() {
    if (texto.trim() === "") {
      setErro(null);
      return;
    }
    const r = interpretarReais(texto);
    if (!r.ok) return setErro(r.erro);
    if (r.centavos === 0) return setErro("O valor precisa ser maior que zero.");
    aoAdicionar(r.centavos);
    setTexto("");
    setErro(null);
    entrada.current?.focus();
    requestAnimationFrame(() => entrada.current?.scrollIntoView?.({ block: "nearest" }));
  }

  function confirmarEdicao(id: string, bruto: string, aoSair: boolean) {
    const r = bruto.trim() === "" ? null : interpretarReais(bruto);
    if (r?.ok && r.centavos > 0) aoEditar(id, r.centavos);
    else if (r && !aoSair) return setErroEdicao(true);
    setEditando(null);
    setErroEdicao(false);
    if (!aoSair) entrada.current?.focus();
  }

  const linhas = () => [...(lista.current?.querySelectorAll<HTMLElement>(".linha-valor") ?? [])];
  function navegar(e: React.KeyboardEvent<HTMLElement>, id: string) {
    const todas = linhas();
    const i = todas.indexOf(e.currentTarget);
    if (e.key === "ArrowUp") todas[i - 1]?.focus();
    else if (e.key === "ArrowDown") (todas[i + 1] ?? entrada.current)?.focus();
    else if (e.key === "Delete" || e.key === "Backspace") {
      aoRemover(id);
      entrada.current?.focus();
    } else return;
    e.preventDefault();
  }

  return (
    <section className={`coluna${dinheiro ? " coluna-dinheiro" : ""} ${className}`} aria-label={titulo}>
      <header className="coluna-topo">
        <h3>{titulo}</h3>
        <p className="coluna-subtotal" aria-live="polite">
          <span className="so-leitor">Subtotal de {titulo}: </span>
          {formatarReais(subtotal)}
        </p>
      </header>
      <ol className="linhas" ref={lista}>
        {itens.map((l, i) => (
          <li className="linha" key={l.id}>
            <span className="linha-n" aria-hidden="true">{i + 1}</span>
            {editando === l.id ? (
              <input
                className={`linha-edicao${erroEdicao ? " com-erro" : ""}`}
                defaultValue={formatarNumero(l.valorCentavos)}
                inputMode="decimal"
                autoFocus
                aria-label={`Novo valor do lançamento ${i + 1} de ${titulo}`}
                onFocus={(e) => e.target.select()}
                onBlur={(e) => confirmarEdicao(l.id, e.target.value, true)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.repeat) {
                    e.preventDefault();
                    confirmarEdicao(l.id, e.currentTarget.value, false);
                  } else if (e.key === "Escape") {
                    setEditando(null);
                    setErroEdicao(false);
                    entrada.current?.focus();
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="linha-valor"
                tabIndex={-1}
                title="Clique para corrigir"
                aria-label={`Lançamento ${i + 1} de ${titulo}: ${formatarReais(l.valorCentavos)}. Corrigir`}
                onClick={() => setEditando(l.id)}
                onKeyDown={(e) => navegar(e, l.id)}
              >
                {formatarNumero(l.valorCentavos)}
              </button>
            )}
            <button
              type="button"
              className="linha-remover"
              tabIndex={-1}
              aria-label={`Remover lançamento ${i + 1} de ${titulo}: ${formatarReais(l.valorCentavos)}`}
              onClick={() => {
                aoRemover(l.id);
                entrada.current?.focus();
              }}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3.5 3.5l9 9m0-9l-9 9" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            </button>
          </li>
        ))}
        <li className="linha linha-nova">
          <span className="linha-n" aria-hidden="true">{itens.length + 1}</span>
          <input
            ref={entrada}
            className={`linha-entrada${erro ? " com-erro" : ""}`}
            data-entrada=""
            type="text"
            inputMode="decimal"
            autoComplete="off"
            enterKeyHint="enter"
            placeholder="0,00"
            autoFocus={autoFocus}
            value={texto}
            aria-label={`Novo lançamento em ${titulo}. Digite o valor e pressione Enter`}
            aria-invalid={!!erro}
            onChange={(e) => {
              setTexto(e.target.value);
              setErro(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (!e.repeat) adicionar();
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                linhas().at(-1)?.focus();
              }
            }}
          />
          <button type="button" className="linha-adicionar" tabIndex={-1} aria-label={`Adicionar a ${titulo}`} onClick={adicionar}>
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </li>
      </ol>
      {erro && <p className="campo-erro coluna-erro" role="alert">{erro}</p>}
      <p className="coluna-rodape">{itens.length === 0 ? "Sem lançamentos" : itens.length === 1 ? "1 lançamento" : `${itens.length} lançamentos`}</p>
    </section>
  );
}
