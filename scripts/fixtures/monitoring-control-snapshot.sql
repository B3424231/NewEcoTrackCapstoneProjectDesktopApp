CREATE OR REPLACE FUNCTION public.ecotrack_snapshot_aircon_control()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare matches text[]; ac public.aircons%rowtype; observed_at timestamptz;
begin
  -- Preserve the historical snapshot/IR fields supplied by ingestion or the earlier analytics guard.
  if new.control_snapshot is not null and new.control_snapshot<>'null'::jsonb then return new; end if;
  -- Bind by an exact ID/name relationship, never room or fuzzy name matching.
  select array_agg(distinct a.id) into matches from public.aircons a
    left join public.nodes n on n.id=a.node_id or n.id=a.controller_node_id
    where a.node_id=new.node_id or a.controller_node_id=new.node_id or n.name=new.node_id;
  new.aircon_id=null; new.control_snapshot=null;
  if cardinality(matches) is distinct from 1 then return new; end if;
  select * into ac from public.aircons where id=matches[1];
  observed_at=coalesce(new.created::timestamptz,clock_timestamp());
  new.aircon_id=ac.id;
  new.control_snapshot=jsonb_strip_nulls(jsonb_build_object(
    'desired_state',case when ac.commanded_at<=observed_at then ac.desired_state end,
    'command_id',case when ac.commanded_at<=observed_at then ac.command_id end,
    'command_status',case when ac.commanded_at<=observed_at then case when ac.command_status_at<=observed_at then ac.command_status else 'queued' end end,
    'commanded_at',case when ac.commanded_at<=observed_at then ac.commanded_at end,
    'reported_state',case when ac.reported_at<=observed_at then ac.reported_state end,
    'reported_at',case when ac.reported_at<=observed_at then ac.reported_at end));
  return new;
end $function$
