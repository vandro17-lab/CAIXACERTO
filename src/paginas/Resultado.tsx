import { useState } from "react";
import { Link } from "react-router-dom";
import { formatarData, NOME_TURNO } from "@dominio/tipos.ts";
import type { Fechamento } from "@dominio/tipos.ts";
import type { Config } from "../api.ts";
import { Etiqueta, Moldura } from "../componentes/Moldura.tsx";
import { Cupom80 } from "../componentes/Cupom80.tsx";
import { FormulaDinheiro, LegendaAdm, ListaLancar, textoDivergencia } from "../componentes/Resumo.tsx";
import { textoResumo } from "../resumoTexto.ts";

export const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    // Navegadores antigos ou sem permissão: usa uma área de texto temporária.
    const area = document.createElement("textarea");
    area.value = texto;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

/** Resultado final: a lista de valores para lançar manualmente no sistema oficial. */
export function Resultado({ f, config }: { f: Fechamento; config: Config }) {
  const s = f.snapshot!;
  const [copiado, setCopiado] = useState<boolean | null>(null);
  const corrigido = f.quantidadeCorrecoes > 0;
  const editadoAdm = f.quantidadeEdicoesAdm > 0;
  const situacao = `${f.versao > 1 ? "Alterado" : "Finalizado"} em ${dataHora(f.versao > 1 ? f.atualizadoEm : f.finalizadoEm ?? f.atualizadoEm)}`;

  return (
    <Moldura contexto={<>{s.lojaNome} · {formatarData(s.dataLocal)} · {NOME_TURNO[s.turno]}</>}>
      <div className="resultado-topo">
        <h1>Fechamento finalizado</h1>
        <div className="etiquetas">
          {corrigido ? <Etiqueta cor="ambar">Corrigido uma vez — bloqueado</Etiqueta> : <Etiqueta cor="verde">Versão {f.versao}</Etiqueta>}
          {editadoAdm && <Etiqueta cor="azul">Editado pelo administrador</Etiqueta>}
          {s.aberturaDivergente && <Etiqueta cor="vermelha">Abertura com divergência</Etiqueta>}
        </div>
      </div>
      <p className="subtitulo">
        {s.lojaNome} · {formatarData(s.dataLocal)} · {NOME_TURNO[s.turno]} · Responsável: {s.responsavelNome}
        <br />
        {situacao} · confirmado pelo servidor
      </p>
      <Cupom80
        dados={{
          lojaNome: s.lojaNome, dataLocal: s.dataLocal, turno: s.turno, responsavelNome: s.responsavelNome, situacao: `${situacao} (versão ${f.versao})`,
          avisos: [...(corrigido ? ["Corrigido uma vez pelo funcionário"] : []), ...(editadoAdm ? ["Editado pelo administrador"] : []),
            ...(s.aberturaDivergente ? [textoDivergencia(s.aberturaDivergente)] : [])],
          observacao: s.observacao,
        }}
        r={s}
        adm={s.alteradoPeloAdm}
        mostrarZerados={config.parametros.mostrarZerados}
        comMemoria={config.parametros.imprimirMemoria}
      />

      <div className="grade-resumo">
        <ListaLancar r={s} mostrarZerados={config.parametros.mostrarZerados} adm={s.alteradoPeloAdm} />
        <div>
          <FormulaDinheiro r={s} adm={s.alteradoPeloAdm} divergencia={s.aberturaDivergente} />
        </div>
      </div>
      <LegendaAdm adm={s.alteradoPeloAdm} />

      {s.observacao && (
        <div className={`observacao${s.alteradoPeloAdm?.includes("observacao") ? " valor-adm" : ""}`}>
          <h3>Observação</h3>
          <p>{s.observacao}</p>
        </div>
      )}

      <div className="acoes acoes-resultado nao-imprimir">
        <button
          type="button"
          className="botao botao-primario"
          onClick={async () => {
            setCopiado(await copiar(textoResumo(s, config.parametros.mostrarZerados)));
            setTimeout(() => setCopiado(null), 4000);
          }}
        >
          {copiado ? "Resumo copiado" : "Copiar resumo"}
        </button>
        <button type="button" className="botao botao-contorno" onClick={() => window.print()}>Imprimir cupom (80 mm)</button>
        {!corrigido && <Link to={`/f/${f.id}/corrigir`} className="botao botao-contorno">Corrigir fechamento</Link>}
        <Link to="/" className="botao botao-contorno">Voltar ao início</Link>
      </div>
      <p className="nota nao-imprimir" role="status">
        {copiado === false
          ? "Não foi possível copiar automaticamente. Selecione os valores e copie manualmente."
          : corrigido
            ? "Este fechamento já usou a única correção e não pode mais ser alterado."
            : "Ainda é possível fazer uma única correção neste fechamento."}{" "}
        {corrigido && <Link to={`/admin/consultas/${f.id}`}>Histórico de alterações (ADM)</Link>}
      </p>
    </Moldura>
  );
}
