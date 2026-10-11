from pathlib import Path
import sys
root=Path(__file__).resolve().parent.parent
files=[
    'supabase_ir_realtime_migration.sql',
    'supabase_controller_registration_migration.sql',
    'supabase_controller_details_migration.sql',
    'supabase_aircon_names_migration.sql',
    'supabase_ac_capabilities_migration.sql',
]
header="""-- EcoTrack reviewed delivery: live IR, registration, saved deployment dates,
-- independent custom AC/controller names and protocol/model capabilities.
-- Run as the project owner in Supabase SQL Editor.
-- Prerequisite: the existing EcoTrack schema and cloud hardware migration are installed.
-- Does not recreate devices, rotate credentials or remove valid commands.
-- Existing command-retention triggers and scheduled cleanup remain installed.
-- Each section is transactional; rerunning the complete file is supported.
DO $$ BEGIN
 IF to_regclass('public.ecotrack_device_state') IS NULL
    OR to_regclass('public.aircons') IS NULL
    OR to_regprocedure('public.ecotrack_is_admin()') IS NULL THEN
  RAISE EXCEPTION 'Install the existing EcoTrack schema and supabase_cloud_hardware_migration.sql first';
 END IF;
END $$;

"""
content=header+'\n'.join('-- Section: '+file+'\n'+(root/file).read_text(encoding='utf-8').rstrip()+'\n' for file in files)
target=root/'reports/multi-brand-capabilities/APPLY_SUPABASE.sql'
if '--check' in sys.argv:
    if not target.exists() or target.read_text(encoding='utf-8')!=content:raise SystemExit('Supabase delivery bundle drift')
else:
    target.parent.mkdir(parents=True,exist_ok=True)
    target.write_text(content,encoding='utf-8')
print('Supabase delivery bundle: '+str(len(files))+' additive sections.')
