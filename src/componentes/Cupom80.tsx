import { useEffect } from "react";
import { createPortal } from "react-dom";
import { formatarNumero, formatarReais } from "@dominio/dinheiro.ts";
import { formatarData, NOME_TURNO } from "@dominio/tipos.ts";
import type { Resumo, Turno } from "@dominio/tipos.ts";

export interface DadosCupom {
  lojaNome: string;
  dataLocal: string;
  turno: Turno;
  responsavelNome: string;
  /** Ex.: "Finalizado em 14/11/2026 18:02". */
  situacao: string;
  /** Linhas extras de situação (corrigido, editado pelo ADM, rascunho…). */
  avisos: string[];
  observacao: string;
}

interface Props {
  dados: DadosCupom;
  r: Resumo;
  /** Itens alterados pelo administrador: saem com * no papel (a impressora térmica não tem cor). */
  adm?: string[];
  mostrarZerados: boolean;
  comMemoria: boolean;
}

/**
 * O fechamento inteiro em formato de cupom para impressora térmica de 80 mm (Epson TM-T20 e similares).
 * Fica fora da tela e é a única coisa que vai para o papel, começando no topo da página.
 * O tamanho do papel fica por conta da impressora: pedir um tamanho sob medida fazia a Epson
 * empurrar o texto para o fim da página, gastando bobina em branco.
 */
export function Cupom80({ dados, r, adm, mostrarZerados, comMemoria }: Props) {
  useEffect(() => {
    const raiz = document.documentElement;
    const estilo = document.createElement("style");
    estilo.textContent = "@page { margin: 0; }";
    document.head.appendChild(estilo);
    raiz.classList.add("imprime-cupom");
    return () => {
      raiz.classList.remove("imprime-cupom");
      estilo.remove();
    };
  }, []);

  const marca = (chave: string) => (adm?.includes(chave) ? "*" : "");
  const formas = r.formas.filter((f) => mostrarZerados || f.subtotalCentavos !== 0 || f.lancamentos.length > 0);
  const comLancamentos = r.formas.filter((f) => f.lancamentos.length > 0);
  const linha = (nome: string, valor: string, classe = "") => (
    <div className={`c80-linha ${classe}`}><span>{nome}</span><span>{valor}</span></div>
  );

  return createPortal(
    <div className="cupom80" aria-hidden="true">
      <p className="c80-centro c80-forte c80-grande">CAIXA CERTO</p>
      <p className="c80-centro c80-forte">FECHAMENTO DE CAIXA</p>
      <hr />
      <p className="c80-forte">{dados.lojaNome}</p>
      <p>{formatarData(dados.dataLocal)} · Turno: {NOME_TURNO[dados.turno]}</p>
      <p>Responsável: {dados.responsavelNome}</p>
      <p>{dados.situacao}</p>
      {dados.avisos.map((a) => <p key={a} className="c80-forte">{a}</p>)}
      <hr />

      <p className="c80-forte">VALORES PARA LANÇAR</p>
      {formas.map((f) => <div key={f.formaId}>{linha(f.nome + marca(`forma:${f.formaId}`), formatarReais(f.subtotalCentavos))}</div>)}
      {linha("Dinheiro (calculado)" + marca("dinheiroLancar"), formatarReais(r.dinheiroLancarCentavos))}
      <hr />
      {linha("TOTAL A LANÇAR" + marca("total"), formatarReais(r.totalLancarCentavos), "c80-forte c80-grande")}
      <hr />

      {comMemoria && (
        <>
          <p className="c80-forte">CÁLCULO DO DINHEIRO</p>
          {linha("Dinheiro da gaveta" + marca("dinheiroContado"), formatarReais(r.dinheiroContadoCentavos))}
          {linha("(−) Abertura" + marca("abertura"), formatarReais(r.aberturaCentavos))}
          {linha("(+) Sangria de troco" + marca("sangria"), formatarReais(r.sangriaCentavos))}
          {linha("(=) Dinheiro a lançar" + marca("dinheiroLancar"), formatarReais(r.dinheiroLancarCentavos), "c80-forte")}
          <hr />
        </>
      )}

      <p className="c80-forte">LANÇAMENTOS</p>
      {comLancamentos.length === 0 && r.dinheiroContado.length === 0 && <p>Nenhum lançamento.</p>}
      {comLancamentos.map((f) => (
        <div key={f.formaId} className="c80-grupo">
          {linha(`${f.nome}${marca(`forma:${f.formaId}`)} (${f.lancamentos.length})`, formatarReais(f.subtotalCentavos), "c80-forte")}
          <p className="c80-valores">{f.lancamentos.map(formatarNumero).join("  ")}</p>
        </div>
      ))}
      {r.dinheiroContado.length > 0 && (
        <div className="c80-grupo">
          {linha(`Dinheiro da gaveta${marca("dinheiroContado")} (${r.dinheiroContado.length})`, formatarReais(r.dinheiroContadoCentavos), "c80-forte")}
          <p className="c80-valores">{r.dinheiroContado.map(formatarNumero).join("  ")}</p>
        </div>
      )}
      <hr />

      {dados.observacao && (
        <>
          <p className="c80-forte">OBSERVAÇÃO{marca("observacao")}</p>
          <p className="c80-observacao">{dados.observacao}</p>
          <hr />
        </>
      )}
      {adm && adm.length > 0 && <p>* valor alterado pelo administrador</p>}

      <p className="c80-assinatura">Responsável</p>
      <p className="c80-assinatura">Conferido por</p>
      <p className="c80-centro c80-pequeno">Caixa conferido é Caixa Certo.</p>
      <p className="c80-centro c80-pequeno">
        Impresso em {new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
      </p>
    </div>,
    document.body,
  );
}
