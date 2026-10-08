// Runs the real Edge Function handlers locally on one port, routed like /functions/v1/<name>/...
import { handler as ai } from '../../supabase/functions/ai/handler.ts';
import { handler as google } from '../../supabase/functions/google/handler.ts';
import { handler as canva } from '../../supabase/functions/canva/handler.ts';

const routes: Record<string, (r: Request) => Promise<Response>> = { ai, google, canva };
const port = Number(Deno.env.get('FUNCTIONS_PORT') || 54330);

Deno.serve({ port, hostname: '127.0.0.1' }, (req) => {
  const name = new URL(req.url).pathname.split('/')[3];
  const h = routes[name];
  return h ? h(req) : new Response('not found', { status: 404 });
});
