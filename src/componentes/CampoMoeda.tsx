import { useId, useState } from "react";
import { formatarNumero, interpretarReais } from "@dominio/dinheiro.ts";

interface Props {
  rotulo: string;
  /** Valor inicial em centavos; `null` = vazio. Para trocar por fora, remonte com `key`. */
  valor: number | null;
  /** Recebe os centavos a cada digitação válida, ou `null` se vazio/inválido. */
  aoMudar(centavos: number | null): void;
  ajuda?: string;
  grande?: boolean;
  autoFocus?: boolean;
  aoEnter?(): void;
}

/** Campo de valor em reais: teclado numérico no celular, aceita 12 · 12,50 · 12.50. */
export function CampoMoeda({ rotulo, valor, aoMudar, ajuda, grande, autoFocus, aoEnter }: Props) {
  const id = useId();
  const [texto, setTexto] = useState(valor === null ? "" : formatarNumero(valor));
  const [tocado, setTocado] = useState(false);
  const lido = texto.trim() === "" ? null : interpretarReais(texto);
  const erro = tocado && lido && !lido.ok ? lido.erro : null;

  return (
    <div className="campo">
      <label className="campo-rotulo" htmlFor={id}>{rotulo}</label>
      <div className={`moeda${grande ? " moeda-grande" : ""}${erro ? " com-erro" : ""}`}>
        <span className="moeda-prefixo" aria-hidden="true">R$</span>
        <input
          id={id}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="next"
          placeholder="0,00"
          autoFocus={autoFocus}
          value={texto}
          aria-invalid={!!erro}
          aria-describedby={`${id}-msg`}
          onChange={(e) => {
            setTexto(e.target.value);
            const r = e.target.value.trim() === "" ? null : interpretarReais(e.target.value);
            aoMudar(r?.ok ? r.centavos : null);
          }}
          onBlur={() => {
            setTocado(true);
            if (lido?.ok) setTexto(formatarNumero(lido.centavos));
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.repeat) return;
            e.preventDefault();
            setTocado(true);
            if (lido?.ok) aoEnter?.();
          }}
        />
      </div>
      <div id={`${id}-msg`}>
        {erro ? <p className="campo-erro" role="alert">{erro}</p> : ajuda ? <p className="campo-ajuda">{ajuda}</p> : null}
      </div>
    </div>
  );
}
