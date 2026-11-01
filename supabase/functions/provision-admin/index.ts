import { createClient } from 'npm:@supabase/supabase-js@2.112.4';
import { createRegistrationHandler } from './handler.mjs';

Deno.serve(createRegistrationHandler({ createClient, env: Deno.env }));
