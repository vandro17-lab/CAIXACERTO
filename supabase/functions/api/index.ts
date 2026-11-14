// Entrada da função no Supabase (Deno). Conecta direto ao Postgres do projeto;
// SUPABASE_DB_URL é injetada pela plataforma e nunca chega ao navegador.
import bcrypt from "npm:bcryptjs@2.4.3";
import postgres from "npm:postgres@3.4.5";
import { criarApp } from "./app.ts";
import type { Sql } from "./infra.ts";

// idle_timeout: a conexão fica aberta entre um salvamento e outro, para não pagar a reconexão a cada pausa.
const pg = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 2, idle_timeout: 120, prepare: false });

const embrulhar = (conexao: any, emTransacao: boolean): Sql => {
  const sql: Sql = {
    q: (texto, params = []) => conexao.unsafe(texto, params),
    tx: (fn) => (emTransacao ? fn(sql) : conexao.begin((t: any) => fn(embrulhar(t, true)))),
  };
  return sql;
};

const origens = (Deno.env.get("ORIGENS_PERMITIDAS") ?? "").split(",").map((o) => o.trim()).filter(Boolean);

Deno.serve(
  criarApp({
    sql: embrulhar(pg, false),
    hashSenha: (senha) => bcrypt.hash(senha, 10),
    conferirSenha: (senha, hash) => bcrypt.compare(senha, hash),
    origens,
  }),
);
