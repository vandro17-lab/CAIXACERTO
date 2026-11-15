// Confere a API publicada depois de republicar a função: chama todas as rotas sem credenciais.
// Nenhuma pode responder erro interno (500) nem "rota inexistente". Uso: node ferramentas/conferir-rotas.mjs
const API = process.argv[2] ?? "https://nmhufcovdhtryjmcqstj.supabase.co/functions/v1/api";
const X = "00000000-0000-0000-0000-000000000000";
const rotas = [["GET","/config"],["POST","/fechamentos"],["GET",`/fechamentos/${X}`],["POST",`/fechamentos/${X}/acesso`],["PUT",`/fechamentos/${X}/rascunho`],["POST",`/fechamentos/${X}/finalizar`],["POST",`/fechamentos/${X}/corrigir`],
["POST","/admin/sessao"],["GET","/admin/sessao"],["DELETE","/admin/sessao"],["POST","/admin/sessoes/encerrar"],["POST","/admin/trocar-senha"],["GET","/admin/fechamentos"],["GET",`/admin/fechamentos/${X}`],["POST",`/admin/fechamentos/${X}/editar`],["GET","/admin/config"],["POST","/admin/usuarios"],["PUT","/admin/usuarios/u_x"],["POST","/admin/lojas"],["PUT","/admin/lojas/x"],["POST","/admin/formas-pagamento"],["PUT","/admin/formas-pagamento/x"],["PUT","/admin/formas-pagamento-ordem"],["PUT","/admin/parametros"]];
let ruim = 0;
for (const [m, p] of rotas) {
  const r = await fetch(API + p, { method: m, headers: { "content-type": "application/json" }, body: m === "GET" || m === "DELETE" ? undefined : "{}" });
  const j = await r.json().catch(() => ({}));
  if (r.status >= 500 || j.codigo === "ROTA_INEXISTENTE") ruim++;
  console.log(String(r.status), m.padEnd(6), p.replace(X, ":id"), j.codigo ?? "");
}
if (ruim) process.exitCode = 1;
console.log(ruim ? `${ruim} ROTA(S) COM PROBLEMA` : `TODAS AS ${rotas.length} ROTAS RESPONDEM`);
