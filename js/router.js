// Hash router: #/dzis, #/projekt/<id>, #/kontakty/influencer ...

const listeners = new Set();

export function current() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { name: parts[0] || 'dzis', params: parts.slice(1), query: new URLSearchParams(query), raw };
}

export function navigate(path, { replace = false } = {}) {
  const target = `#/${path}`;
  if (location.hash === target) { listeners.forEach((fn) => fn(current())); return; }
  if (replace) history.replaceState(null, '', target);
  else { history.pushState(null, '', target); depth++; }
  listeners.forEach((fn) => fn(current()));
}

let depth = 0; // in-app navigations we can safely go back through

export function back(fallback = 'dzis') {
  if (depth > 0) { depth--; history.back(); } else navigate(fallback, { replace: true });
}

export function onRoute(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

window.addEventListener('hashchange', () => listeners.forEach((fn) => fn(current())));
