// Servidor de desenvolvimento: a mesma API da produção em http://localhost:8787/api,
// com os dados guardados na pasta .dados-locais (apague a pasta para recomeçar).
import { createServer } from "node:http";
import { criarApp } from "../supabase/functions/api/app.ts";
import { abrirBanco } from "./banco.ts";

const porta = Number(process.env.PORT ?? 8787);
const memoria = process.argv.includes("--memoria");
const { deps } = await abrirBanco(memoria ? undefined : ".dados-locais");
const app = criarApp(deps);

createServer(async (req, res) => {
  const partes: Buffer[] = [];
  for await (const p of req) partes.push(p as Buffer);
  const temCorpo = req.method !== "GET" && req.method !== "HEAD";
  const resposta = await app(
    new Request(`http://localhost:${porta}${req.url}`, {
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: temCorpo ? Buffer.concat(partes) : undefined,
    }),
  );
  res.writeHead(resposta.status, Object.fromEntries(resposta.headers));
  res.end(Buffer.from(await resposta.arrayBuffer()));
}).listen(porta, () => {
  console.log(`API local do Caixa Certo em http://localhost:${porta}/api ${memoria ? "(dados em memória)" : "(dados em .dados-locais)"}`);
  console.log("Administrador inicial: usuário ADM, senha 4321 (troca obrigatória no primeiro acesso).");
});
