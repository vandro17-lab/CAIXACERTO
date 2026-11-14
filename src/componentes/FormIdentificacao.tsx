import { useId } from "react";
import { NOME_TURNO, TURNOS } from "@dominio/tipos.ts";
import type { Loja, Usuario } from "@dominio/tipos.ts";
import type { Identificacao } from "../api.ts";

/** Data de hoje no fuso do aparelho, como AAAA-MM-DD. */
export function hojeLocal(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** O que falta para a identificação estar completa (vazio = tudo certo). */
export function faltasIdentificacao(v: Identificacao): Partial<Record<keyof Identificacao, string>> {
  const f: Partial<Record<keyof Identificacao, string>> = {};
  if (v.responsavelNome.trim().length < 2) f.responsavelNome = "Escolha seu nome.";
  if (!v.lojaId) f.lojaId = "Escolha a loja.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v.dataLocal)) f.dataLocal = "Informe a data.";
  else if (v.dataLocal > hojeLocal()) f.dataLocal = "A data não pode ser futura.";
  if (!v.turno) f.turno = "Escolha o turno.";
  return f;
}

interface Props {
  valor: Identificacao;
  aoMudar(v: Identificacao): void;
  lojas: Loja[];
  /** Usuários ativos cadastrados pelo ADM; o nome é escolhido entre os da loja. */
  usuarios: Usuario[];
  /** Mostra as mensagens de campo obrigatório. */
  mostrarFaltas: boolean;
}

/** Nomes que podem responder por um fechamento da loja, em ordem alfabética. */
export function usuariosDaLoja(usuarios: Usuario[], lojaId: string): string[] {
  return usuarios.filter((u) => u.ativo && u.lojaIds.includes(lojaId)).map((u) => u.nome).sort((a, b) => a.localeCompare(b));
}

export function FormIdentificacao({ valor, aoMudar, lojas, usuarios, mostrarFaltas }: Props) {
  const id = useId();
  const faltas = mostrarFaltas ? faltasIdentificacao(valor) : {};
  const mudar = (parte: Partial<Identificacao>) => aoMudar({ ...valor, ...parte });
  const nomes = usuariosDaLoja(usuarios, valor.lojaId);
  const igual = (n: string) => n.toLowerCase() === valor.responsavelNome.trim().toLowerCase();
  // Um nome já gravado no rascunho continua aparecendo, mesmo que o cadastro tenha mudado depois.
  const opcoes = valor.responsavelNome.trim() && !nomes.some(igual) ? [...nomes, valor.responsavelNome] : nomes;
  /** Ao trocar de loja, o nome só é mantido se também estiver cadastrado na nova loja. */
  const escolherLoja = (lojaId: string) => {
    const daNova = usuariosDaLoja(usuarios, lojaId);
    mudar({ lojaId, responsavelNome: daNova.find(igual) ?? (daNova.length === 1 ? daNova[0] : "") });
  };

  return (
    <div className="formulario">
      <fieldset className="campo">
        <legend className="campo-rotulo">Loja</legend>
        <div className="opcoes">
          {lojas.map((l) => (
            <label key={l.lojaId} className="opcao">
              <input type="radio" name={`${id}-loja`} checked={valor.lojaId === l.lojaId} onChange={() => escolherLoja(l.lojaId)} />
              <span>{l.nome}</span>
            </label>
          ))}
        </div>
        {faltas.lojaId && <p className="campo-erro" role="alert">{faltas.lojaId}</p>}
      </fieldset>

      <div className="campo">
        <label className="campo-rotulo" htmlFor={`${id}-nome`}>Seu nome</label>
        <select
          id={`${id}-nome`}
          className={`entrada${faltas.responsavelNome ? " com-erro" : ""}`}
          value={opcoes.find(igual) ?? ""}
          disabled={!valor.lojaId || opcoes.length === 0}
          onChange={(e) => mudar({ responsavelNome: e.target.value })}
        >
          <option value="">{valor.lojaId ? "Escolha seu nome…" : "Escolha a loja primeiro"}</option>
          {opcoes.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        {valor.lojaId && nomes.length === 0 && (
          <p className="campo-erro" role="alert">Nenhum usuário cadastrado para esta loja. Peça ao administrador para cadastrar você.</p>
        )}
        {faltas.responsavelNome && nomes.length > 0 && <p className="campo-erro" role="alert">{faltas.responsavelNome}</p>}
      </div>

      <div className="dupla">
        <div className="campo">
          <label className="campo-rotulo" htmlFor={`${id}-data`}>Data</label>
          <input
            id={`${id}-data`}
            className={`entrada${faltas.dataLocal ? " com-erro" : ""}`}
            type="date"
            max={hojeLocal()}
            value={valor.dataLocal}
            onChange={(e) => mudar({ dataLocal: e.target.value })}
          />
          {faltas.dataLocal && <p className="campo-erro" role="alert">{faltas.dataLocal}</p>}
        </div>
        <fieldset className="campo">
          <legend className="campo-rotulo">Turno</legend>
          <div className="opcoes opcoes-juntas">
            {TURNOS.map((t) => (
              <label key={t} className="opcao">
                <input type="radio" name={`${id}-turno`} checked={valor.turno === t} onChange={() => mudar({ turno: t })} />
                <span>{NOME_TURNO[t]}</span>
              </label>
            ))}
          </div>
          {faltas.turno && <p className="campo-erro" role="alert">{faltas.turno}</p>}
        </fieldset>
      </div>

      <div className="campo">
        <label className="campo-rotulo" htmlFor={`${id}-obs`}>
          Observação <span className="opcional">opcional</span>
        </label>
        <textarea
          id={`${id}-obs`}
          className="entrada"
          rows={3}
          maxLength={2000}
          value={valor.observacao}
          onChange={(e) => mudar({ observacao: e.target.value })}
        />
      </div>
    </div>
  );
}
