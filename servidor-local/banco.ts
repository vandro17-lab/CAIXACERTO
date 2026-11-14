// Postgres embutido (PGlite) para desenvolvimento e testes: mesmo SQL da produção,
// sem precisar de conta em nuvem.
import { PGlite } from "@electric-sql/pglite";
import bcrypt from "bcryptjs";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Deps, Sql } from "../supabase/functions/api/infra.ts";

const PASTA_MIGRACOES = fileURLToPath(new URL("../supabase/migrations/", import.meta.url));

interface Executor {
  query(texto: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

const embrulhar = (db: PGlite, executor: Executor, emTransacao: boolean): Sql => {
  const sql: Sql = {
    q: async (texto, params = []) => (await executor.query(texto, params)).rows as never[],
    tx: (fn) => (emTransacao ? fn(sql) : db.transaction((t) => fn(embrulhar(db, t, true)))),
  };
  return sql;
};

/** Abre o banco (em memória, ou em `pasta` para persistir) e aplica as migrações se estiver vazio. */
export async function abrirBanco(pasta?: string): Promise<{ db: PGlite; deps: Deps }> {
  const db = new PGlite(pasta);
  const { rows } = await db.query("select 1 from pg_tables where schemaname = 'public' and tablename = 'fechamentos'");
  if (!rows.length) {
    for (const arquivo of readdirSync(PASTA_MIGRACOES).sort()) {
      await db.exec(readFileSync(PASTA_MIGRACOES + arquivo, "utf8"));
    }
  }
  return {
    db,
    deps: {
      sql: embrulhar(db, db, false),
      // Custo baixo só aqui, para os testes ficarem rápidos; produção usa custo 10.
      hashSenha: (senha) => bcrypt.hash(senha, 4),
      conferirSenha: (senha, hash) => bcrypt.compare(senha, hash),
    },
  };
}
