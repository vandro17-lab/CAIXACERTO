import { formatarReais } from "@dominio/dinheiro.ts";
import type { Resumo } from "@dominio/tipos.ts";

/** Classe que pinta de outra cor um valor definido por edição do administrador. */
const doAdm = (adm: string[] | undefined, chave: string) => (adm?.includes(chave) ? " valor-adm" : "");

/** Legenda da cor usada nos valores alterados pelo administrador. */
export function LegendaAdm({ adm }: { adm?: string[] }) {
  if (!adm?.length) return null;
  return <p className="legenda-adm"><span className="valor-adm">■</span> Nesta cor: valores alterados pelo administrador.</p>;
}

interface PropsLista {
  r: Resumo;
  mostrarZerados: boolean;
  /** Itens alterados pelo administrador (`Snapshot.alteradoPeloAdm`). */
  adm?: string[];
}

/** Os valores para lançar no sistema oficial. "Dinheiro" é sempre o valor calculado. */
export function ListaLancar({ r, mostrarZerados, adm }: PropsLista) {
  const formas = r.formas.filter((f) => mostrarZerados || f.subtotalCentavos !== 0 || adm?.includes(`forma:${f.formaId}`));
  return (
    <div className="cupom">
      <h3 className="cupom-titulo">Valores para lançar no sistema</h3>
      <dl className="cupom-linhas">
        {formas.map((f) => (
          <div className={`cupom-linha${f.subtotalCentavos === 0 ? " zerada" : ""}${doAdm(adm, `forma:${f.formaId}`)}`} key={f.formaId}>
            <dt>{f.nome}</dt>
            <dd>{formatarReais(f.subtotalCentavos)}</dd>
          </div>
        ))}
        <div className={`cupom-linha cupom-dinheiro${doAdm(adm, "dinheiroLancar")}`}>
          <dt>
            Dinheiro <small>calculado</small>
          </dt>
          <dd>{formatarReais(r.dinheiroLancarCentavos)}</dd>
        </div>
        <div className={`cupom-linha cupom-total${doAdm(adm, "total")}`}>
          <dt>Total a lançar</dt>
          <dd>{formatarReais(r.totalLancarCentavos)}</dd>
        </div>
      </dl>
    </div>
  );
}

/** A fórmula do dinheiro, legível: contado − abertura + sangria = a lançar. */
export function FormulaDinheiro({ r, titulo = "Memória do cálculo", adm }: { r: Resumo; titulo?: string; adm?: string[] }) {
  const negativo = r.dinheiroLancarCentavos < 0;
  return (
    <div className="memoria">
      <h3>{titulo}</h3>
      <dl className="memoria-linhas">
        <div className={doAdm(adm, "dinheiroContado")}><dt><span className="sinal" /> Dinheiro da gaveta</dt><dd>{formatarReais(r.dinheiroContadoCentavos)}</dd></div>
        <div className={doAdm(adm, "abertura")}><dt><span className="sinal">−</span> Abertura</dt><dd>{formatarReais(r.aberturaCentavos)}</dd></div>
        <div className={doAdm(adm, "sangria")}><dt><span className="sinal">+</span> Sangria de troco</dt><dd>{formatarReais(r.sangriaCentavos)}</dd></div>
        <div className={`memoria-resultado${negativo ? " negativo" : ""}${doAdm(adm, "dinheiroLancar")}`}>
          <dt><span className="sinal">=</span> Dinheiro a lançar</dt>
          <dd>{formatarReais(r.dinheiroLancarCentavos)}</dd>
        </div>
      </dl>
      <p className="memoria-nota">Abertura, sangria e dinheiro da gaveta servem só para este cálculo: não são somados de novo ao total.</p>
    </div>
  );
}
