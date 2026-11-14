-- Caixa Certo — usuários cadastrados por loja e edição de fechamentos pelo administrador.

-- Funcionários cadastrados pelo ADM. Só quem está aqui (e ativo) pode abrir ou corrigir um fechamento.
create table usuarios (
  usuario_id text primary key,
  nome text not null check (length(btrim(nome)) between 2 and 60),
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create unique index usuarios_nome_ativo on usuarios (lower(nome)) where ativo;

-- Em quais lojas cada usuário trabalha.
create table usuario_lojas (
  usuario_id text not null references usuarios (usuario_id),
  loja_id text not null references lojas (loja_id),
  primary key (usuario_id, loja_id)
);
create index usuario_lojas_loja on usuario_lojas (loja_id);

alter table usuarios enable row level security;
alter table usuario_lojas enable row level security;

-- Edições feitas pelo administrador: sem limite de quantidade, sempre com registro no histórico.
alter table fechamentos add column quantidade_edicoes_adm integer not null default 0 check (quantidade_edicoes_adm >= 0);

alter table historico_alteracoes drop constraint historico_alteracoes_tipo_check;
alter table historico_alteracoes add constraint historico_alteracoes_tipo_check
  check (tipo in ('finalizacao', 'correcao', 'edicao_adm'));

-- As travas continuam valendo para o funcionário. A edição do ADM é liberada apenas dentro da
-- transação em que a API (depois de conferir a sessão ADM) marca `cc.edicao_adm`.
create or replace function cc_guardar_fechamento() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Fechamentos não podem ser excluídos.';
  end if;
  if old.status = 'finalizado' then
    if coalesce(current_setting('cc.edicao_adm', true), '') = '1' then
      if not (new.status = 'finalizado' and new.versao = old.versao + 1
              and new.quantidade_edicoes_adm = old.quantidade_edicoes_adm + 1
              and new.quantidade_correcoes = old.quantidade_correcoes) then
        raise exception 'Edição do administrador inválida.';
      end if;
      return new;
    end if;
    if new.quantidade_edicoes_adm <> old.quantidade_edicoes_adm then
      raise exception 'Somente o administrador registra edições do administrador.';
    end if;
    if old.quantidade_correcoes >= 1 then
      raise exception 'Fechamento já corrigido uma vez: bloqueado para novas edições.';
    end if;
    if not (new.status = 'finalizado' and new.quantidade_correcoes = 1 and new.versao = old.versao + 1) then
      raise exception 'Um fechamento finalizado só aceita a correção única.';
    end if;
  end if;
  return new;
end $$;

create or replace function cc_guardar_lancamento() returns trigger
language plpgsql set search_path = '' as $$
declare
  alvo text;
begin
  if tg_op = 'DELETE' then alvo := old.fechamento_id; else alvo := new.fechamento_id; end if;
  if coalesce(current_setting('cc.edicao_adm', true), '') <> '1'
     and exists (select 1 from public.fechamentos f where f.fechamento_id = alvo and f.quantidade_correcoes >= 1) then
    raise exception 'Fechamento bloqueado: os lançamentos não podem mais ser alterados.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
