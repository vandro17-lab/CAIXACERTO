import type { ReactNode } from "react";
import { Link } from "react-router-dom";

export function Logo({ tamanho = 28 }: { tamanho?: number }) {
  return (
    <svg className="logo" viewBox="0 0 32 32" width={tamanho} height={tamanho} aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--verde)" />
      <path d="M9 16.5l4.6 4.6L23.2 11" fill="none" stroke="var(--sobre-verde)" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
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
