import { useCallback, useEffect, useRef, useState } from "react";
import type { Fechamento } from "@dominio/tipos.ts";
import { api, FalhaApi } from "./api.ts";
import type { DadosRascunho } from "./api.ts";
import { guardarRascunhoLocal, lerRascunhoLocal } from "./armazenamento.ts";

/** salvo = confirmado pelo servidor · offline = guardado só neste aparelho, tentando de novo. */
export type Situacao = "salvo" | "pendente" | "salvando" | "offline" | "erro";

export const dadosDe = (f: Fechamento): DadosRascunho => ({
  lojaId: f.lojaId,
  dataLocal: f.dataLocal,
  turno: f.turno,
  responsavelNome: f.responsavelNome,
  observacao: f.observacao,
  aberturaCentavos: f.aberturaCentavos,
  houveSangria: f.houveSangria,
  sangriaCentavos: f.sangriaCentavos,
  lancamentos: f.lancamentos,
});

// A abertura só é comparada quando é digitada livremente: nos outros casos quem manda é o servidor.
const valoresIguais = (servidor: Fechamento, b: DadosRascunho) => {
  const a = dadosDe(servidor);
  const abertura = (d: DadosRascunho) => (servidor.abertura.situacao === "livre" ? d.aberturaCentavos : null);
  return JSON.stringify([abertura(a), a.houveSangria, a.lancamentos]) === JSON.stringify([abertura(b), b.houveSangria, b.lancamentos]);
};

interface Opcoes {
  inicial: Fechamento;
  token: string;
  /** O servidor tem um estado diferente do nosso (finalizado ou alterado em outro aparelho). */
  aoDivergir(servidor: Fechamento | null): void;
  /** Chamado a cada salvamento confirmado, com o estado devolvido pelo servidor. */
  aoSalvar?(servidor: Fechamento): void;
}

/**
 * Rascunho com salvamento automático.
 * Cada alteração ganha um número de revisão, fica guardada no aparelho e é enviada ao servidor,
 * uma requisição por vez. Só mostramos "salvo" depois da confirmação do servidor.
 */
export function useRascunho({ inicial, token, aoDivergir, aoSalvar }: Opcoes) {
  const [inicio] = useState(() => {
    const local = lerRascunhoLocal(inicial.id);
    if (!(local && local.revisao > inicial.revisao)) return { dados: dadosDe(inicial), revisao: inicial.revisao, pendente: false };
    // Abertura conferida (ou aguardando conferência): vale a do servidor, não a guardada no aparelho.
    const dados = inicial.abertura.situacao === "livre" ? local.dados : { ...local.dados, aberturaCentavos: inicial.aberturaCentavos };
    return { dados, revisao: local.revisao, pendente: true };
  });
  const [dados, setDados] = useState<DadosRascunho>(inicio.dados);
  const [situacao, setSituacao] = useState<Situacao>(inicio.pendente ? "pendente" : "salvo");
  const [erro, setErro] = useState<FalhaApi | null>(null);
  const r = useRef({
    dados: inicio.dados,
    revisao: inicio.revisao,
    salva: inicial.revisao,
    envio: null as Promise<boolean> | null,
    timer: 0 as unknown as ReturnType<typeof setTimeout>,
    vivo: true,
  });
  const divergir = useRef(aoDivergir);
  divergir.current = aoDivergir;
  const salvou = useRef(aoSalvar);
  salvou.current = aoSalvar;

  const enviar = useCallback(async (): Promise<boolean> => {
    const e = r.current;
    if (e.envio) await e.envio;
    if (e.salva >= e.revisao) return true;
    if (e.envio) return enviar();
    clearTimeout(e.timer);
    const revisao = e.revisao;
    const enviados = e.dados;
    if (e.vivo) setSituacao("salvando");
    e.envio = (async () => {
      try {
        const resp = await api.salvar(inicial.id, token, enviados, revisao);
        if (!resp.aplicado && !(resp.fechamento.revisao === revisao && valoresIguais(resp.fechamento, enviados))) {
          // Outro aparelho gravou este rascunho: vale o que está no servidor.
          guardarRascunhoLocal(inicial.id, null);
          divergir.current(resp.fechamento);
          return false;
        }
        e.salva = revisao;
        if (e.revisao === revisao) guardarRascunhoLocal(inicial.id, null);
        if (e.vivo && resp.aplicado) salvou.current?.(resp.fechamento);
        if (e.vivo) {
          setErro(null);
          setSituacao(e.revisao === revisao ? "salvo" : "pendente");
        }
        return true;
      } catch (falha) {
        const f = falha instanceof FalhaApi ? falha : new FalhaApi(0, "ERRO", "Falha inesperada ao salvar.");
        if (f.codigo === "JA_FINALIZADO") {
          guardarRascunhoLocal(inicial.id, null);
          divergir.current(null);
        } else if (f.semResposta || f.status === 429) {
          if (e.vivo) setSituacao("offline");
          e.timer = setTimeout(() => void enviar(), 6000);
        } else if (e.vivo) {
          setErro(f);
          setSituacao("erro");
        }
        return false;
      } finally {
        e.envio = null;
      }
    })();
    const ok = await e.envio;
    return ok && e.revisao > e.salva ? enviar() : ok;
  }, [inicial.id, token]);

  const alterar = useCallback(
    (fn: (atual: DadosRascunho) => DadosRascunho) => {
      const e = r.current;
      e.dados = fn(e.dados);
      e.revisao += 1;
      guardarRascunhoLocal(inicial.id, { revisao: e.revisao, dados: e.dados });
      setDados(e.dados);
      setErro(null);
      setSituacao((s) => (s === "salvando" ? s : "pendente"));
      clearTimeout(e.timer);
      e.timer = setTimeout(() => void enviar(), 700);
    },
    [enviar, inicial.id],
  );

  useEffect(() => {
    const e = r.current;
    e.vivo = true;
    if (e.revisao > e.salva) void enviar();
    const aoVoltarRede = () => void enviar();
    window.addEventListener("online", aoVoltarRede);
    return () => {
      e.vivo = false;
      window.removeEventListener("online", aoVoltarRede);
      clearTimeout(e.timer);
      if (e.revisao > e.salva) void enviar();
    };
  }, [enviar]);

  /** Adota a abertura decidida pelo servidor. Não gera novo salvamento: o servidor já tem esse valor. */
  const adotarAbertura = useCallback(
    (aberturaCentavos: number | null) => {
      const e = r.current;
      if (e.dados.aberturaCentavos === aberturaCentavos) return;
      e.dados = { ...e.dados, aberturaCentavos };
      if (e.revisao > e.salva) guardarRascunhoLocal(inicial.id, { revisao: e.revisao, dados: e.dados });
      setDados(e.dados);
    },
    [inicial.id],
  );

  return { dados, situacao, erro, alterar, adotarAbertura, salvarAgora: enviar, revisao: () => r.current.revisao };
}
