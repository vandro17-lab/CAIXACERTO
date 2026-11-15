import type { ReactNode } from "react";
import { Link } from "react-router-dom";

/** Frase da marca. */
export const LEMA = "Caixa conferido é Caixa Certo.";

/** A marca do Caixa Certo (a imagem já traz o nome). */
export function Logo({ tamanho = 40 }: { tamanho?: number }) {
  return <img className="logo" src="/marca.png" width={tamanho} height={tamanho} alt="" aria-hidden="true" decoding="async" />;
}

interface Props {
  children: ReactNode;
  /** Linha de contexto ao lado da marca (loja · data · turno). */
  contexto?: ReactNode;
  /** Canto direito do topo (situação do salvamento, sair…). */
  lado?: ReactNode;
  larga?: boolean;
}

export function Moldura({ children, contexto, lado, larga }: Props) {
  return (
    <div className="app">
      <header className="topo">
        <Link to="/" className="marca" aria-label="Caixa Certo — início">
          <Logo />
          <span>Caixa Certo</span>
        </Link>
        {contexto && <div className="topo-contexto">{contexto}</div>}
        {lado && <div className="topo-lado">{lado}</div>}
      </header>
      <main className={`conteudo${larga ? " larga" : ""}`}>{children}</main>
    </div>
  );
}

export function Aviso({ tipo, children }: { tipo: "erro" | "alerta" | "info" | "ok"; children: ReactNode }) {
  return (
    <div className={`aviso aviso-${tipo}`} role={tipo === "erro" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Etiqueta({ cor = "neutra", children }: { cor?: "neutra" | "verde" | "ambar" | "vermelha" | "azul"; children: ReactNode }) {
  return <span className={`etiqueta etiqueta-${cor}`}>{children}</span>;
}

export function Carregando({ texto = "Carregando…" }: { texto?: string }) {
  return (
    <p className="carregando" role="status">
      <span className="girando" aria-hidden="true" /> {texto}
    </p>
  );
}
