import { useState } from "react";
import { formatarReais } from "@dominio/dinheiro.ts";
import type { Forma, Lancamento } from "@dominio/tipos.ts";
import { novoId } from "../armazenamento.ts";
import { ColunaLancamentos } from "./ColunaLancamentos.tsx";

const DINHEIRO = "__dinheiro";

interface Props {
  /** Formas de pagamento exibidas como colunas. */
  formas: Forma[];
  /** Mostra também a coluna "Dinheiro da gaveta" (usado na correção). */
  comDinheiro?: boolean;
  lancamentos: Lancamento[];
  aoMudar(fn: (atuais: Lancamento[]) => Lancamento[]): void;
  autoFocus?: boolean;
}

/** As colunas lado a lado, uma por forma de pagamento. No celular, uma coluna por vez, escolhida nas abas. */
export function PainelColunas({ formas, comDinheiro, lancamentos, aoMudar, autoFocus }: Props) {
  const colunas = [
    ...formas.map((f) => ({ chave: f.formaId, titulo: f.nome, formaId: f.formaId as string | null })),
    ...(comDinheiro ? [{ chave: DINHEIRO, titulo: "Dinheiro da gaveta", formaId: null }] : []),
  ];
  const [ativa, setAtiva] = useState(colunas[0]?.chave ?? "");
  const itensDe = (formaId: string | null) =>
    lancamentos.filter((l) => (formaId === null ? l.tipo === "dinheiro_contado" : l.formaId === formaId));

  // Alt + ← / → troca de coluna sem tirar a mão do teclado.
  function atalhos(e: React.KeyboardEvent<HTMLDivElement>) {
    if (!e.altKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    const entradas = [...e.currentTarget.querySelectorAll<HTMLInputElement>("[data-entrada]")];
    const atual = entradas.findIndex((x) => x.closest(".coluna")?.contains(document.activeElement));
    const alvo = Math.min(entradas.length - 1, Math.max(0, (atual < 0 ? 0 : atual) + (e.key === "ArrowRight" ? 1 : -1)));
    e.preventDefault();
    setAtiva(colunas[alvo].chave);
    requestAnimationFrame(() => entradas[alvo]?.focus());
  }

  return (
    <div className="painel" onKeyDown={atalhos}>
      <div className="abas" role="tablist" aria-label="Formas de pagamento">
        {colunas.map((c) => {
          const subtotal = itensDe(c.formaId).reduce((s, l) => s + l.valorCentavos, 0);
          return (
            <button key={c.chave} type="button" role="tab" aria-selected={ativa === c.chave} className="aba" onClick={() => setAtiva(c.chave)}>
              <span>{c.titulo}</span>
              <small className={subtotal ? "" : "zerado"}>{formatarReais(subtotal)}</small>
            </button>
          );
        })}
      </div>
      <div className="colunas">
        {colunas.map((c, i) => (
          <ColunaLancamentos
            key={c.chave}
            titulo={c.titulo}
            dinheiro={c.formaId === null}
            className={ativa === c.chave ? "" : "fora-da-aba"}
            autoFocus={autoFocus && i === 0}
            itens={itensDe(c.formaId)}
            aoAdicionar={(valorCentavos) =>
              aoMudar((ls) => [...ls, { id: novoId(), formaId: c.formaId, tipo: c.formaId === null ? "dinheiro_contado" : "pagamento", valorCentavos }])
            }
            aoEditar={(id, valorCentavos) => aoMudar((ls) => ls.map((l) => (l.id === id ? { ...l, valorCentavos } : l)))}
            aoRemover={(id) => aoMudar((ls) => ls.filter((l) => l.id !== id))}
          />
        ))}
      </div>
    </div>
  );
}
