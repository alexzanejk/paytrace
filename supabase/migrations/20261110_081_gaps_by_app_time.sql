-- 081: use the bKash app's exact times (owner 2026-11-10, after the Vivo's first automatic app read: "check now").
--
-- What the first read showed: 75 rows with exact times, and two balance gaps on the Vivo's bKash that stayed open even
-- though every entry behind them was now in the list:
--   * 8 Nov 13:20, Tk -12,370.03: eight Cash Ins between 12:31 and 13:16 (Tk 12,420, commission Tk 46.60) with no SMS.
--     The old search tries at most 6 entries, so it could never add up eight.
--   * 9 Nov 21:51, Tk -421.82: one Cash In of Tk 425 at 21:21 with no SMS (commission Tk 1.59), PLUS the Tk 1.59 that the
--     revealing message itself (a Tk 425 Cash In at 21:52) earned, which its SMS does not print.
-- And a held receipt (DK827L84PM, Tk 1,161, 8 Nov) that the statement does list, as "Agent Cash Out", while its SMS reads
-- "You have received": statement_confirm_held compared the exact kinds, so it said "no Tk 1,161 coming in" on every pull.
--
-- 1. balance_gap_explain_by_time: when the app's list has rows on both sides of a gap, the gap is explained by EVERY entry
--    in between that has no SMS (an entry has an SMS when a stored message of the same kind family and amount is within
--    3 minutes of it), each with its own commission, plus the revealing message's own commission when its SMS does not
--    print one. All of them, not a chosen few, so a coincidence cannot explain a gap. Minute boundaries are fuzzy by one
--    minute between the SMS and the app, so the nine windows around (prev_at, at) are tried and the closest fit wins.
--    balance_gap_explain runs it first; what it cannot explain still goes to the old count-based search.
-- 2. statement_confirm_held compares kind FAMILIES (ledger_match_kind), as the ledger and the day check already do since 069.
--
-- No DROP or DELETE.

create or replace function public.balance_gap_explain_by_time(p_device uuid, p_provider text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  g record; rev record; done jsonb := '[]'::jsonb; own numeric; a int; b int;
  s numeric; slack numeric; err numeric; best_err numeric; best_ids uuid[]; best_kinds text[]; ids uuid[]; kinds text[];
  pkind text; w_from timestamptz; w_to timestamptz;
begin
  for g in select * from public.balance_gaps
            where device_id = p_device and provider = p_provider and explained_by is null and prev_at is not null
              and at > now() - interval '14 days' order by at
  loop
    -- The app must have listed entries on both sides of the gap, or its list does not cover it.
    continue when not exists (select 1 from public.statement_lines l where l.device_id = p_device and l.provider = p_provider
                                 and l.at is not null and l.at <= g.prev_at - interval '1 minute')
               or not exists (select 1 from public.statement_lines l where l.device_id = p_device and l.provider = p_provider
                                 and l.at is not null and l.at >= g.at + interval '1 minute');
    select * into rev from public.payments where id = g.payment_id;
    -- What the revealing message's own entry earned when its SMS prints no commission (a bKash Cash In's).
    own := null;
    if rev.id is not null and coalesce(rev.commission, 0) = 0 then
      select l.commission into own from public.statement_lines l
       where l.device_id = p_device and l.provider = p_provider and l.at is not null
         and abs(abs(l.amount) - abs(rev.amount)) < 0.005
         and public.ledger_match_kind(public.ledger_kind(l.type, l.amount > 0))
             = public.ledger_match_kind(public.payment_ledger_kind(rev.txn_type, rev.review_reason))
         and abs(extract(epoch from l.at - coalesce(rev.occurred_at, rev.received_at))) <= 180
       order by abs(extract(epoch from l.at - coalesce(rev.occurred_at, rev.received_at))) limit 1;
    end if;
    own := coalesce(own, 0);
    best_err := null; best_ids := null; best_kinds := null;
    for a in -1 .. 1 loop
      for b in -1 .. 1 loop
        w_from := g.prev_at + a * interval '1 minute';
        w_to := g.at + b * interval '1 minute';
        select coalesce(array_agg(l.id order by l.at), '{}'::uuid[]),
               coalesce(array_agg(public.ledger_kind(l.type, l.amount > 0) order by l.at), '{}'::text[]),
               coalesce(sum(l.amount + coalesce(l.commission, 0)), 0),
               coalesce(sum(case when l.commission is null
                                  and (l.amount > 0 or public.ledger_kind(l.type, false) = 'cash_in_sent')
                                 then 0.006 * abs(l.amount) + 0.5 else 0 end), 0)
          into ids, kinds, s, slack
          from public.statement_lines l
         where l.device_id = p_device and l.provider = p_provider and l.at is not null
           and l.at >= w_from and l.at <= w_to
           and (g.sim_slot is null or l.sim_slot is null or l.sim_slot = g.sim_slot)
           and public.ledger_kind(l.type, l.amount > 0) <> 'commission_in'
           and not exists (select 1 from public.payments p
                            where p.device_id = p_device and p.provider = p_provider
                              and coalesce(p.review_reason, '') <> 'not_ours'
                              and abs(abs(p.amount) - abs(l.amount)) < 0.005
                              and public.ledger_match_kind(public.payment_ledger_kind(p.txn_type, p.review_reason))
                                  = public.ledger_match_kind(public.ledger_kind(l.type, l.amount > 0))
                              and abs(extract(epoch from coalesce(p.occurred_at, p.received_at) - l.at)) <= 180)
           and not exists (select 1 from public.balance_gaps o where o.id <> g.id and o.explained_by is not null
                            and (o.statement_line_id = l.id or l.id = any(coalesce(o.statement_line_ids, '{}'::uuid[]))));
        continue when cardinality(ids) = 0 and own = 0;
        continue when cardinality(ids) > 40;
        -- Lines with a stated commission and a stated own commission are exact; the gap's own tolerance covers a bKash
        -- receipt that prints none.
        err := abs(g.amount - s - own);
        if err <= g.tolerance + 0.01 + slack and (best_err is null or err < best_err) then
          best_err := err; best_ids := ids; best_kinds := kinds;
        end if;
      end loop;
    end loop;
    continue when best_ids is null;
    pkind := case when cardinality(best_ids) = 0 then 'commission_in'
                  when (select count(distinct k) from unnest(best_kinds) k) = 1 then best_kinds[1] else 'several' end;
    update public.balance_gaps set explained_by = 'statement', explained_kind = pkind, explained_at = now(),
           statement_line_id = best_ids[1], statement_line_ids = best_ids
     where id = g.id;
    insert into public.events (kind, provider, detail, payment_id) values ('balance_gap_explained', p_provider,
      jsonb_build_object('device_id', p_device, 'gap_id', g.id, 'amount', g.amount, 'kind', pkind,
                         'lines', cardinality(best_ids), 'own_commission', own, 'off_by', best_err, 'by', 'app_time'), g.payment_id);
    done := done || jsonb_build_object('gap_id', g.id, 'amount', g.amount, 'kind', pkind,
                                       'day', (g.at at time zone 'Asia/Dhaka')::date, 'lines', cardinality(best_ids));
  end loop;
  return done;
end $$;

revoke all on function public.balance_gap_explain_by_time(uuid, text) from public, anon, authenticated;
grant execute on function public.balance_gap_explain_by_time(uuid, text) to service_role;

-- balance_gap_explain runs the exact-time pass first; its own loop then only sees what is still open.
do $m$
declare src text; out text;
begin
  src := pg_get_functiondef('public.balance_gap_explain(uuid,text)'::regprocedure);
  if position('balance_gap_explain_by_time' in src) = 0 then
    out := replace(src, E'begin\n  for g in select * from public.balance_gaps',
                        E'begin\n  done := public.balance_gap_explain_by_time(p_device, p_provider);\n  for g in select * from public.balance_gaps');
    if out = src then raise exception 'balance_gap_explain: anchor not found'; end if;
    execute out;
  end if;

  src := pg_get_functiondef('public.statement_confirm_held(uuid,text)'::regprocedure);
  out := replace(src, 'and public.ledger_kind(l.type, true) = kind',
                      'and public.ledger_match_kind(public.ledger_kind(l.type, true)) = public.ledger_match_kind(kind)');
  out := replace(out, 'and public.payment_ledger_kind(x.txn_type, x.review_reason) = kind',
                      'and public.ledger_match_kind(public.payment_ledger_kind(x.txn_type, x.review_reason)) = public.ledger_match_kind(kind)');
  if out = src and position('ledger_match_kind' in src) = 0 then raise exception 'statement_confirm_held: anchors not found'; end if;
  execute out;
end $m$;
