// Prints an anon key and a service_role key (HS256 JWTs, like Supabase's legacy API keys).
import crypto from 'node:crypto';
const secret = process.argv[2];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (payload) => {
  const data = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`;
  return `${data}.${crypto.createHmac('sha256', secret).update(data).digest('base64url')}`;
};
const iat = Math.floor(Date.now() / 1000);
console.log(sign({ iss: 'supabase-local', role: 'anon', iat, exp: iat + 10 * 365 * 86400 }));
console.log(sign({ iss: 'supabase-local', role: 'service_role', iat, exp: iat + 10 * 365 * 86400 }));
