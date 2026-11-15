// Serviço mínimo do aplicativo instalável. Não guarda nada em cache de propósito:
// o Caixa Certo só considera um dado salvo com a confirmação do servidor, e cada
// abertura deve carregar a versão mais nova das telas.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (evento) => evento.waitUntil(self.clients.claim()));
