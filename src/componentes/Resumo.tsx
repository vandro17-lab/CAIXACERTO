import { formatarReais } from "@dominio/dinheiro.ts";
import type { Resumo } from "@dominio/tipos.ts";

/** Os valores para lançar no sistema oficial. "Dinheiro" é sempre o valor calculado. */
export function ListaLancar({ r, mostrarZerados }: { r: Resumo; mostrarZerados: boolean }) {
  const formas = r.formas.filter((f) => mostrarZerados || f.subtotalCentavos !== 0);
  return (
    <div className="cupom">
      <h3 className="cupom-titulo">Valores para lançar no sistema</h3>
      <dl className="cupom-linhas">
        {formas.map((f) => (
          <div className={`cupom-linha${f.subtotalCentavos === 0 ? " zerada" : ""}`} key={f.formaId}>
            <dt>{f.nome}</dt>
            <dd>{formatarReais(f.subtotalCentavos)}</dd>
          </div>
        ))}
        <div className="cupom-linha cupom-dinheiro">
          <dt>
            Dinheiro <small>calculado</small>
          </dt>
          <dd>{formatarReais(r.dinheiroLancarCentavos)}</dd>
        </div>
        <div className="cupom-linha cupom-total">
          <dt>Total a lançar</dt>
          <dd>{formatarReais(r.totalLancarCentavos)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** A fórmula do dinheiro, legível: contado − abertura + sangria = a lançar. */
export function FormulaDinheiro({ r, titulo = "Memória do cálculo" }: { r: Resumo; titulo?: string }) {
  const negativo = r.dinheiroLancarCentavos < 0;
  return (
    <div className="memoria">
      <h3>{titulo}</h3>
      <dl className="memoria-linhas">
        <div><dt><span className="sinal" /> Dinheiro contado</dt><dd>{formatarReais(r.dinheiroContadoCentavos)}</dd></div>
        <div><dt><span className="sinal">−</span> Abertura</dt><dd>{formatarReais(r.aberturaCentavos)}</dd></div>
        <div><dt><span className="sinal">+</span> Sangria de troco</dt><dd>{formatarReais(r.sangriaCentavos)}</dd></div>
        <div className={`memoria-resultado${negativo ? " negativo" : ""}`}>
          <dt><span className="sinal">=</span> Dinheiro a lançar</dt>
          <dd>{formatarReais(r.dinheiroLancarCentavos)}</dd>
        </div>
      </dl>
      <p className="memoria-nota">Abertura, sangria e dinheiro contado servem só para este cálculo: não são somados de novo ao total.</p>
    </div>
  );
}
