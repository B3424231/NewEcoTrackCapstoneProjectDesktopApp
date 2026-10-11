from pathlib import Path
s=Path('supabase_controller_details_migration.sql').read_text(encoding='utf-8')
a=s.index('CREATE OR REPLACE FUNCTION public.ecotrack_finish_controller_registration');b=s.index('END $$;',a)+len('END $$;')
fn=s[a:b]
fn=fn.replace(" INSERT INTO public.aircons(asset_tag,brand,"," INSERT INTO public.aircons(asset_tag,name,brand,")
fn=fn.replace("VALUES(tag,saved_brand,","VALUES(tag,coalesce(nullif(btrim(p_setup->>'aircon_name'),''),tag),saved_brand,")
fn=fn.replace(" UPDATE public.aircons SET brand="," UPDATE public.aircons SET name=coalesce(nullif(btrim(p_setup->>'aircon_name'),''),ac.name,ac.asset_tag),brand=")
fn=fn.replace(" PERFORM public.ecotrack_validate_controller_assignment(p_device_id,p_setup);",""" IF p_setup ? 'aircon_name' AND p_setup->'aircon_name'<>'null'::jsonb AND
   (jsonb_typeof(p_setup->'aircon_name')<>'string' OR length(btrim(p_setup->>'aircon_name')) NOT BETWEEN 1 AND 100 OR p_setup->>'aircon_name' ~ '[<>[:cntrl:]]') THEN RAISE EXCEPTION 'Enter a valid air conditioner name (1..100 characters)'; END IF;
 PERFORM public.ecotrack_validate_controller_assignment(p_device_id,p_setup);""",1)
sql="""-- Apply after supabase_controller_details_migration.sql. Display name does not change IDs or assignments.
BEGIN;
ALTER TABLE public.aircons ADD COLUMN IF NOT EXISTS name text;
CREATE OR REPLACE FUNCTION public.ecotrack_validate_aircon_display_name()
RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.name IS NOT NULL AND (length(btrim(NEW.name)) NOT BETWEEN 1 AND 100 OR NEW.name ~ '[<>[:cntrl:]]') THEN RAISE EXCEPTION 'Enter a valid air conditioner name'; END IF;
 IF TG_OP='UPDATE' AND NEW.name IS DISTINCT FROM OLD.name AND auth.uid() IS NOT NULL AND NOT public.ecotrack_is_admin() THEN
  RAISE EXCEPTION 'Administrator required to rename an AC' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ecotrack_aircon_name_validate ON public.aircons;
CREATE TRIGGER ecotrack_aircon_name_validate BEFORE INSERT OR UPDATE ON public.aircons FOR EACH ROW EXECUTE FUNCTION public.ecotrack_validate_aircon_display_name();
"""
sql+=fn+"""
REVOKE ALL ON FUNCTION public.ecotrack_finish_controller_registration(text,text,jsonb),public.ecotrack_validate_aircon_display_name() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.ecotrack_finish_controller_registration(text,text,jsonb) TO authenticated;
-- User-requested data correction for this registered controller only. This is data, not a UI default.
UPDATE public.aircons a SET name='Matrix' WHERE (a.name IS NULL OR a.name=a.asset_tag)
 AND EXISTS(SELECT 1 FROM public.ecotrack_device_state s JOIN public.nodes n ON n.id=s.node_id
 WHERE s.device_id='esp32s3-9cd20604a7ac' AND (a.controller_node_id=n.id OR a.node_id IN(n.id,n.name,s.device_id)));
NOTIFY pgrst,'reload schema';
COMMIT;
"""
Path('supabase_aircon_names_migration.sql').write_text(sql,encoding='utf-8')
print('Additive AC names migration generated.')
