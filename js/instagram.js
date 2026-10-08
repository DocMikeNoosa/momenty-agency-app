// Instagram helpers. Instagram does not offer a public API for looking up arbitrary people, so the app
// opens the profile directly when the account name is known, and otherwise opens a web search limited to
// instagram.com. Found handles can be saved on the contact.

import * as M from './model.js';

const HANDLE = /^@?([A-Za-z0-9._]{1,30})$/;

export function instagramLookup(query) {
  const q = String(query || '').trim();
  const fromUrl = q.match(/instagram\.com\/([A-Za-z0-9._]{1,30})/i);
  const m = fromUrl || (q.includes(' ') ? null : q.match(HANDLE));
  const handle = m ? `@${m[1].replace(/\/$/, '')}` : null;
  return {
    handle,
    profileUrl: handle ? M.instagramUrl(handle) : null,
    searchUrl: `https://www.google.com/search?q=${encodeURIComponent(`site:instagram.com ${q.replace(/^@/, '')}`)}`,
  };
}
