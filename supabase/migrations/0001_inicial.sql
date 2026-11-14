-- Caixa Certo — esquema inicial.
-- O acesso é feito somente pelo backend (função `api`). RLS fica ligado e sem políticas,
-- de modo que as chaves públicas do Supabase não leem nem gravam nada diretamente.

create table lojas (
  loja_id text primary key,
  nome text not null check (length(btrim(nome)) between 1 and 60),
  ativa boolean not null default true,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create unique index lojas_nome_ativo on lojas (lower(nome)) where ativa;

create table formas_pagamento (
  forma_id text primary key,
  nome text not null check (length(btrim(nome)) between 1 and 40),
  ordem integer not null default 0,
  ativa boolean not null default true,
  criada_em timestamptz not null default now(),
  atualizada_em timestamptz not null default now()
);
create unique index formas_nome_ativo on formas_pagamento (lower(nome)) where ativa;

create table fechamentos (
  fechamento_id text primary key,
  loja_id text not null references lojas (loja_id),
  data_local text not null check (data_local ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  turno text not null check (turno in ('manha', 'tarde', 'noite')),
  responsavel_nome text not null,
  abertura_centavos integer check (abertura_centavos >= 0),
  houve_sangria boolean,
  sangria_centavos integer not null default 0 check (sangria_centavos >= 0),
  dinheiro_contado_centavos integer not null default 0 check (dinheiro_contado_centavos >= 0),
  dinheiro_lancar_centavos integer,
  total_lancar_centavos integer,
  observacao text not null default '',
  status text not null default 'rascunho' check (status in ('rascunho', 'finalizado')),
  versao integer not null default 0,
  quantidade_correcoes integer not null default 0 check (quantidade_correcoes in (0, 1)),
  revisao integer not null default 0,
  regra_calculo text not null default 'v1',
  snapshot_json text,
  criado_em timestamptz not null default now(),
  finalizado_em timestamptz,
  atualizado_em timestamptz not null default now(),
  -- No máximo um fechamento por loja + data + turno.
  constraint fechamentos_loja_data_turno unique (loja_id, data_local, turno),
  constraint fechamentos_finalizado_valido check (
    status = 'rascunho'
    or (dinheiro_lancar_centavos >= 0 and abertura_centavos is not null and snapshot_json is not null and versao >= 1)
  )
);
create index fechamentos_data on fechamentos (data_local);

create table lancamentos (
  fechamento_id text not null references fechamentos (fechamento_id),
  lancamento_id text not null,
  forma_id text references formas_pagamento (forma_id),
  tipo text not null check (tipo in ('pagamento', 'dinheiro_contado')),
  valor_centavos integer not null check (valor_centavos > 0),
  ordem integer not null,
  criado_em timestamptz not null default now(),
  primary key (fechamento_id, lancamento_id),
  check ((tipo = 'pagamento') = (forma_id is not null))
);

-- Chaves de acesso de cada fechamento (guardamos apenas o hash).
create table fechamento_tokens (
  token_hash text primary key,
  fechamento_id text not null references fechamentos (fechamento_id),
  criado_em timestamptz not null default now()
);
create index fechamento_tokens_fechamento on fechamento_tokens (fechamento_id);

create table historico_alteracoes (
  auditoria_id text primary key,
  fechamento_id text not null references fechamentos (fechamento_id),
  tipo text not null check (tipo in ('finalizacao', 'correcao')),
  versao_anterior integer not null,
  versao_nova integer not null,
  snapshot_antes_json text,
  snapshot_depois_json text not null,
  autor_declarado text not null,
  motivo text not null default '',
  requisicao_id text,
  alterado_em timestamptz not null default now(),
  -- Uma finalização e, no máximo, uma correção por fechamento.
  unique (fechamento_id, versao_nova)
);

create table admin_credenciais (
  admin_id text primary key,
  usuario text not null unique,
  senha_hash text not null,
  exige_troca_senha boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create table admin_sessoes (
  sessao_id text primary key,
  admin_id text not null references admin_credenciais (admin_id),
  token_hash text not null unique,
  criada_em timestamptz not null default now(),
  expira_em timestamptz not null,
  revogada_em timestamptz
);

create table parametros (
  chave text primary key,
  valor text not null
);

-- Contadores para limitar tentativas (login, criação, acesso por nome).
create table limites (
  chave text primary key,
  contagem integer not null,
  janela_inicio timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Travas no próprio banco: valem mesmo se alguém contornar a aplicação.
-- ---------------------------------------------------------------------------

create function cc_guardar_fechamento() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Fechamentos não podem ser excluídos.';
  end if;
  if old.status = 'finalizado' then
    if old.quantidade_correcoes >= 1 then
      raise exception 'Fechamento já corrigido uma vez: bloqueado para novas edições.';
    end if;
    if not (new.status = 'finalizado' and new.quantidade_correcoes = 1 and new.versao = old.versao + 1) then
      raise exception 'Um fechamento finalizado só aceita a correção única.';
    end if;
  end if;
  return new;
end $$;

create trigger fechamentos_guarda before update or delete on fechamentos
for each row execute function cc_guardar_fechamento();

create function cc_guardar_lancamento() returns trigger
language plpgsql set search_path = '' as $$
declare
  alvo text;
begin
  if tg_op = 'DELETE' then alvo := old.fechamento_id; else alvo := new.fechamento_id; end if;
  if exists (select 1 from public.fechamentos f where f.fechamento_id = alvo and f.quantidade_correcoes >= 1) then
    raise exception 'Fechamento bloqueado: os lançamentos não podem mais ser alterados.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create trigger lancamentos_guarda before insert or update or delete on lancamentos
for each row execute function cc_guardar_lancamento();

create function cc_historico_imutavel() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'O histórico de alterações é imutável.';
end $$;

create trigger historico_guarda before update or delete on historico_alteracoes
for each row execute function cc_historico_imutavel();

alter table lojas enable row level security;
alter table formas_pagamento enable row level security;
alter table fechamentos enable row level security;
alter table lancamentos enable row level security;
alter table fechamento_tokens enable row level security;
alter table historico_alteracoes enable row level security;
alter table admin_credenciais enable row level security;
alter table admin_sessoes enable row level security;
alter table parametros enable row level security;
alter table limites enable row level security;

-- ---------------------------------------------------------------------------
-- Dados iniciais
-- ---------------------------------------------------------------------------

insert into lojas (loja_id, nome) values
  ('vila-grill-1', 'Vila Grill 1'),
  ('vila-grill-2', 'Vila Grill 2'),
  ('araca-grill', 'Araçá Grill');

insert into formas_pagamento (forma_id, nome, ordem) values
  ('credito', 'Crédito', 1),
  ('debito', 'Débito', 2),
  ('pix', 'Pix', 3),
  ('voucher', 'Voucher', 4),
  ('assinadas', 'Assinadas', 5),
  ('ifood', 'iFood', 6),
  ('99food', '99Food', 7);

insert into parametros (chave, valor) values
  ('mostrar_zerados', 'true'),
  ('imprimir_memoria', 'true');

-- Usuário ADM com a credencial inicial provisória (somente o hash bcrypt).
-- A troca de senha é obrigatória no primeiro acesso.
insert into admin_credenciais (admin_id, usuario, senha_hash, exige_troca_senha) values
  ('adm', 'ADM', '$2a$10$whUOFuPVJIlI7cOJflW/A.5Dslid/whQo1HbBq6Pxf1hiO.QRBp8.', true);
