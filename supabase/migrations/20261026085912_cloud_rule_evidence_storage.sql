-- Measurement-driven cloud rules: no desktop process or synthetic runtime.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';

CREATE TABLE IF NOT EXISTS ecotrack_private.rule_evidence (
 rule_id text NOT NULL REFERENCES public.rules(id) ON DELETE CASCADE,
 node_id text NOT NULL REFERENCES public.nodes(id) ON DELETE CASCADE,
 signature jsonb NOT NULL, observed_at timestamptz NOT NULL,
 started_at timestamptz, interval_seconds numeric, last_alert_at timestamptz,
 PRIMARY KEY(rule_id,node_id)
);
ALTER TABLE ecotrack_private.rule_evidence ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS rule_evidence_node_idx ON ecotrack_private.rule_evidence(node_id);
REVOKE ALL ON ecotrack_private.rule_evidence FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION ecotrack_private.rule_schedule_allows(r public.rules, at_time timestamptz)
RETURNS boolean LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE day_text text:=to_char(at_time AT TIME ZONE 'Asia/Singapore','YYYY-MM-DD');
 clock_text text:=to_char(at_time AT TIME ZONE 'Asia/Singapore','HH24:MI');
 start_clock text:=nullif(r.start_time,''); end_clock text:=nullif(r.end_time,'');
BEGIN
 IF at_time IS NULL THEN RETURN false; END IF;
 IF nullif(r.start_date,'') IS NOT NULL AND (r.start_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR day_text<r.start_date) THEN RETURN false; END IF;
 IF nullif(r.end_date,'') IS NOT NULL AND (r.end_date !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR day_text>r.end_date) THEN RETURN false; END IF;
 IF (start_clock IS NOT NULL AND start_clock !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
 OR (end_clock IS NOT NULL AND end_clock !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') THEN RETURN false; END IF;
 IF start_clock>end_clock THEN RETURN clock_text>=start_clock OR clock_text<=end_clock; END IF;
 RETURN (start_clock IS NULL OR clock_text>=start_clock) AND (end_clock IS NULL OR clock_text<=end_clock);
END $$;
REVOKE ALL ON FUNCTION ecotrack_private.rule_schedule_allows(public.rules,timestamptz) FROM PUBLIC,anon,authenticated;

COMMIT;
