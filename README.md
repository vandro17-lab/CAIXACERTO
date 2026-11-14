# Caixa Certo

Fechamento de caixa por **loja + data + turno**. O operador lança os valores por forma de pagamento
(Enter adiciona, o subtotal soma sozinho), confere dinheiro e sangria e recebe a lista de valores para
lançar no sistema oficial. Especificação: seção por seção de `PROJETO_FECHAMENTO_DE_CAIXA.md` (v1.0).

## Como está montado

| Parte | Onde | Tecnologia |
|---|---|---|
| Telas | `src/` | React + TypeScript + Vite (publicar na Vercel) |
| Regras de cálculo | `supabase/functions/api/dominio/` | TypeScript puro, usado pela tela e pelo servidor |
| Backend | `supabase/functions/api/` | Supabase Edge Function `api` (já publicada) |
| Banco | `supabase/migrations/` | Postgres do Supabase, projeto `caixacerto` (já criado) |
| Testes | `testes/` | Vitest (API real sobre Postgres embutido + interface) |

**Decisão de persistência:** a especificação propunha Google Planilhas; foi aprovado usar Supabase/Postgres,
que garante de verdade a unicidade e a correção única sob uso simultâneo.

Fórmula (regra v1, fiel à planilha `P. CAIXA`):
`Dinheiro a lançar = Dinheiro contado − (Abertura − Sangria de troco)`. Resultado negativo **bloqueia** a finalização.

## Rodar no computador

```bash
npm install
npm run dev      # telas em http://localhost:5173 e API local em http://localhost:8787/api
npm test         # testes de aceitação (T01–T22)
npm run build    # versão de produção em dist/
```

A API local usa um Postgres embutido (pasta `.dados-locais`); não precisa de conta em nuvem.

## Publicar

1. **Telas (Vercel):** importar este repositório na Vercel. Não há variáveis para configurar: o endereço da API
   está em `.env.production` (é público). O `vercel.json` já cuida das rotas.
2. **Backend/banco (Supabase):** já publicados no projeto `caixacerto`. Para republicar depois de mudar o código:
   `supabase functions deploy api --no-verify-jwt` e aplicar novas migrações de `supabase/migrations/`.
3. **Restringir origem (recomendado):** depois de saber o endereço da Vercel, criar no Supabase o segredo
   `ORIGENS_PERMITIDAS` da função (ex.: `https://caixacerto.vercel.app`).

## Administrador

Usuário `ADM`, senha inicial `4321` — **provisória**: o sistema obriga a troca no primeiro acesso.
No banco existe apenas o hash bcrypt. Sessão de 8 horas, guardada só na aba; limite de tentativas de login.

## Limitações assumidas (ler antes de usar)

- **O funcionário não faz login.** O nome é apenas declarado; não comprova identidade. Um fechamento é aberto
  pelo aparelho que o criou ou por quem informar o mesmo nome. Para impedir que alguém se passe por outro,
  é preciso PIN individual ou login (evolução futura).
- **Auditoria:** histórico e fechamentos corrigidos são protegidos por travas no próprio banco (gatilhos), mas
  quem tem acesso de dono ao projeto Supabase consegue contorná-las. Restrinja esse acesso e faça backup.
- Sem conexão, as digitações ficam guardadas **só no aparelho** e são reenviadas quando a rede volta;
  a tela nunca mostra "salvo" sem confirmação do servidor.
