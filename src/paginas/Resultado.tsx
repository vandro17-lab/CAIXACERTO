import { useState } from "react";
import { Link } from "react-router-dom";
import { formatarData, NOME_TURNO } from "@dominio/tipos.ts";
import type { Fechamento } from "@dominio/tipos.ts";
import type { Config } from "../api.ts";
import { Etiqueta, Moldura } from "../componentes/Moldura.tsx";
import { FormulaDinheiro, ListaLancar } from "../componentes/Resumo.tsx";
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

  return (
    <Moldura contexto={<>{s.lojaNome} · {formatarData(s.dataLocal)} · {NOME_TURNO[s.turno]}</>}>
      <div className="resultado-topo">
        <h1>Fechamento finalizado</h1>
        <div className="etiquetas">
          {corrigido ? <Etiqueta cor="ambar">Corrigido uma vez — bloqueado</Etiqueta> : <Etiqueta cor="verde">Versão {f.versao}</Etiqueta>}
        </div>
      </div>
      <p className="subtitulo">
        {s.lojaNome} · {formatarData(s.dataLocal)} · {NOME_TURNO[s.turno]} · Responsável: {s.responsavelNome}
        <br />
        {corrigido ? `Corrigido em ${dataHora(f.atualizadoEm)}` : `Finalizado em ${dataHora(f.finalizadoEm ?? f.atualizadoEm)}`} · confirmado pelo servidor
      </p>

      <div className="grade-resumo">
        <ListaLancar r={s} mostrarZerados={config.parametros.mostrarZerados} />
        <div className={config.parametros.imprimirMemoria ? "" : "nao-imprimir"}>
          <FormulaDinheiro r={s} />
        </div>
      </div>

      {s.observacao && (
        <div className="observacao">
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
        <button type="button" className="botao botao-contorno" onClick={() => window.print()}>Imprimir</button>
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
