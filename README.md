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
`Dinheiro a lançar = Dinheiro da gaveta − (Abertura − Sangria de troco)`. Resultado negativo **bloqueia** a finalização.

## Abertura do caixa como conferência

- O valor de abertura vem do **último fechamento finalizado da mesma loja** antes deste (data, depois manhã, tarde,
  noite; mesmo que seja de dias atrás): é o total bruto de "Dinheiro da gaveta" dele. A fórmula não muda.
- Na etapa de abertura o funcionário vê "Confira se há R$ X na gaveta" e responde **Sim** ou **Não**.
  - **Sim:** a abertura fica com esse valor.
  - **Não:** o gerente confere junto e digita a **senha do gerente**; aí o funcionário informa o valor encontrado.
    O fechamento fica marcado como **abertura com divergência** (esperado e encontrado) e a observação é obrigatória.
    A marca aparece na conferência, no cupom, no resumo copiado, nas Consultas (e no CSV) e no detalhe do ADM.
- Sem fechamento anterior finalizado, ou com a gaveta dele zerada, a abertura é digitada livremente, sem senha.
- Quem decide o valor esperado e confere a senha é o **servidor** (`POST /fechamentos/:id/abertura`); a abertura
  enviada no salvamento do rascunho é ignorada quando existe valor esperado. Mudar loja, data ou turno do rascunho
  refaz a conferência.
- **Correção única do funcionário:** mudar a abertura exige a senha do gerente. **Edição do ADM:** livre; a marca
  de divergência acompanha o valor (some se a abertura voltar ao esperado).
- **Senha do gerente:** uma só para todas as lojas, 4 dígitos, cadastrada pelo ADM em Configurações. No banco existe
  apenas o hash bcrypt. Serve só para liberar a abertura; não dá acesso a Consultas nem a Configurações.
  Limite de erros: 5 por fechamento e 15 por aparelho a cada 15 minutos, e 60 por hora no total.

## Rodar no computador

```bash
npm install
npm run dev      # telas em http://localhost:5173 e API local em http://localhost:8787/api
npm test         # testes de aceitação
npm run build    # versão de produção em dist/
```

A API local usa um Postgres embutido (pasta `.dados-locais`); não precisa de conta em nuvem.
Depois de uma migração nova, apague a pasta `.dados-locais` para o banco local ser recriado.

## Publicar

1. **Telas (Vercel):** importar este repositório na Vercel. Não há variáveis para configurar: o endereço da API
   está em `.env.production` (é público). O `vercel.json` já cuida das rotas.
2. **Backend/banco (Supabase):** já publicados no projeto `caixacerto`. Para republicar depois de mudar o código:
   `supabase functions deploy api --no-verify-jwt` e aplicar novas migrações de `supabase/migrations/`
   (enviar sempre TODOS os arquivos de `supabase/functions/api`, inclusive a pasta `dominio`).
   Depois de republicar, rodar `node ferramentas/conferir-rotas.mjs`: confere que todas as rotas respondem.
3. **Origem restrita (feito):** o segredo `ORIGENS_PERMITIDAS` da função vale `https://caixa-certooo.vercel.app`.
   A API só libera o navegador vindo desse endereço. O valor é comparado exatamente: **sem barra no final**.
   Para mais de um endereço, separar por vírgula. Sem o segredo, a API aceita qualquer origem.

## Usuários, edição do ADM e impressão

- **Usuários:** o ADM cadastra os funcionários em Configurações → Usuários e marca as lojas de cada um.
  Só um usuário ativo cadastrado para a loja consegue abrir ou corrigir um fechamento (o nome é escolhido numa lista).
- **Edição do ADM:** em Consultas → abrir um fechamento finalizado → "Editar valores". Pode ser feita quantas vezes
  for preciso, exige motivo, fica no histórico e não consome a correção única do funcionário. Os valores alterados
  pelo ADM aparecem em azul nas telas e com `*` no cupom.
- **Impressão (80 mm):** o botão "Imprimir cupom (80 mm)" gera o fechamento inteiro (valores, cálculo, lançamentos e
  observação) na largura de bobina de 80 mm (Epson TM-T20), começando no topo do papel. Na janela de impressão:
  escolher a Epson, papel de rolo 80 mm, margens "Nenhuma" e escala 100%. Para cortar logo após o texto, ligar
  a economia de papel nas preferências do driver da Epson.

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
