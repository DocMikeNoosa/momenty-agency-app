import * as db from '../db.js';
import * as M from '../model.js';
import { h, icon, emptyState, confirmDialog, toast, fullDate, fmtNumber, stars, relDay, clear } from '../ui.js';
import {
  contactRow, editContact, avatar, contactActions, section, taskRow, editTask, filesGrid, uploadFlow, progressBar,
} from '../components.js';
import { navigate } from '../router.js';
import { instagramLookup } from '../instagram.js';
import { openAssist, suggestionsFor } from '../assist.js';
import { openSheet, buildForm } from '../ui.js';

/** Look someone up on Instagram; optionally save the handle on a contact. */
export function instagramSheet(contact = null) {
  const input = h('input', { type: 'search', placeholder: 'Imię i nazwisko, marka lub @nazwa', 'aria-label': 'Kogo szukasz na Instagramie', value: contact?.name || '' });
  const out = h('div', { class: 'col' });
  const draw = () => {
    const r = instagramLookup(input.value);
    clear(out);
    if (!input.value.trim()) return;
    if (r.handle) out.append(h('a', { class: 'btn btn-primary btn-block', href: r.profileUrl, target: '_blank', rel: 'noopener' }, icon('instagram', 18), `Otwórz profil ${r.handle}`));
    out.append(h('a', { class: `btn ${r.handle ? 'btn-soft' : 'btn-primary'} btn-block`, href: r.searchUrl, target: '_blank', rel: 'noopener' }, icon('search', 18), 'Szukaj na Instagramie (przez Google)'));
    if (contact && r.handle) {
      out.append(h('button', { class: 'btn btn-ghost btn-block', onclick: async () => {
        await db.put('contacts', { id: contact.id, instagram: r.handle }); s.close(); toast(`Zapisano ${r.handle}`);
      } }, `Zapisz ${r.handle} w kontakcie`));
    }
  };
  input.addEventListener('input', draw);
  const s = openSheet({
    title: 'Instagram',
    body: [input, out,
      h('p', { class: 'hint-line' }, contact ? 'Gdy znajdziesz profil, skopiuj nazwę konta (np. @ola.beauty), wpisz ją powyżej i zapisz w kontakcie.' : 'Wpisz @nazwę konta, aby od razu otworzyć profil.')],
  });
  draw();
}

let search = '';

export function renderContacts(kindParam) {
  const kind = M.CONTACT_KINDS.some((k) => k[0] === kindParam) ? kindParam : db.kvGet('contactKind', 'klient');
  if (kind !== db.kvGet('contactKind')) db.kvSet('contactKind', kind);
  const q = search.trim().toLowerCase();
  let items = db.all('contacts').filter((c) => c.kind === kind);
  if (q) items = items.filter((c) => Object.values(c).filter((v) => typeof v === 'string').join(' ').toLowerCase().includes(q));
  items.sort((a, b) => a.name.localeCompare(b.name, 'pl'));

  const tabs = h('div', { class: 'seg seg-scroll', role: 'tablist' }, M.CONTACT_KINDS.map(([k, label]) => {
    const n = db.all('contacts').filter((c) => c.kind === k).length;
    return h('button', { class: `seg-btn ${k === kind ? 'on' : ''}`, role: 'tab', 'aria-selected': k === kind,
      onclick: () => navigate(`kontakty/${k}`, { replace: true }) }, label, n ? h('span', { class: 'count' }, n) : null);
  }));

  const searchBox = h('label', { class: 'search' }, icon('search', 18),
    h('input', { type: 'search', id: 'contact-search', placeholder: 'Szukaj po nazwie, mieście, tematyce…', value: search, 'aria-label': 'Szukaj kontaktów',
      oninput: (e) => { search = e.target.value; window.dispatchEvent(new CustomEvent('rerender', { detail: { keepFocus: 'contact-search' } })); } }));

  // Group alphabetically for longer lists
  let list;
  if (!items.length) {
    list = emptyState(q ? 'Brak wyników.' : `Nie dodano jeszcze kontaktów w kategorii „${M.CONTACT_KINDS.find((k) => k[0] === kind)[1]}”.`,
      q ? null : 'Dodaj kontakt', () => editContact(null, kind), M.kindIcon(kind));
  } else if (items.length > 12 && !q) {
    const groups = new Map();
    for (const c of items) { const L = (c.name[0] || '#').toUpperCase(); if (!groups.has(L)) groups.set(L, []); groups.get(L).push(c); }
    list = h('div', null, [...groups].map(([L, cs]) => h('div', null, h('div', { class: 'letter' }, L), h('div', { class: 'list' }, cs.map(contactRow)))));
  } else {
    list = h('div', { class: 'list' }, items.map(contactRow));
  }

  return {
    title: 'Kontakty',
    action: h('div', { class: 'head-actions' },
      h('button', { class: 'icon-btn', 'aria-label': 'Szukaj na Instagramie', title: 'Szukaj na Instagramie', onclick: () => instagramSheet() }, icon('instagram')),
      h('button', { class: 'btn btn-primary btn-sm', onclick: () => editContact(null, kind) }, icon('plus', 16), 'Nowy')),
    node: h('div', { class: 'page' }, tabs, h('div', { class: 'toolbar' }, searchBox), list),
  };
}

export function renderContact(id) {
  const c = db.get('contacts', id);
  if (!c) return { title: 'Kontakt', back: 'kontakty', node: emptyState('Ten kontakt nie istnieje lub został usunięty.', 'Wróć do kontaktów', () => navigate('kontakty'), 'contacts') };

  const tasks = db.all('tasks').filter((t) => t.contactId === c.id).sort(M.sortTasks);
  const files = db.all('files').filter((f) => f.clientId === c.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const docs = db.all('docs').filter((d) => d.contactId === c.id);
  const projects = c.kind === 'klient' ? db.all('projects').filter((p) => p.clientId === c.id)
    : c.kind === 'influencer' ? db.all('projects').filter((p) => (p.influencerIds || []).includes(c.id)) : [];

  const fields = M.contactFields(c.kind).filter((f) => !['name', 'notes', 'messages', 'email', 'phone', 'instagram', 'website', 'tiktok'].includes(f.key));
  const facts = h('dl', { class: 'facts' }, fields.map((f) => {
    let v = c[f.key];
    if (v == null || v === '' || v === 0) return null;
    if (f.type === 'select') v = (typeof f.options === 'function' ? f.options() : f.options).find(([k]) => String(k) === String(v))?.[1] || v;
    if (f.type === 'date') v = fullDate(v);
    if (f.key === 'followers') v = fmtNumber(v);
    if (f.key === 'engagement') v = `${String(v).replace('.', ',')}%`;
    if (f.type === 'rating') v = stars(v);
    return [h('dt', null, f.label), h('dd', null, v)];
  }),
  c.email ? [h('dt', null, 'E-mail'), h('dd', null, h('a', { href: `mailto:${c.email}` }, c.email))] : null,
  c.phone ? [h('dt', null, 'Telefon'), h('dd', null, h('a', { href: `tel:${c.phone.replace(/[^\d+]/g, '')}` }, c.phone))] : null,
  c.instagram ? [h('dt', null, 'Instagram'), h('dd', null, h('a', { href: M.instagramUrl(c.instagram), target: '_blank', rel: 'noopener' }, M.handle(c.instagram)))] : null,
  c.tiktok ? [h('dt', null, 'TikTok'), h('dd', null, h('a', { href: M.tiktokUrl(c.tiktok), target: '_blank', rel: 'noopener' }, M.handle(c.tiktok)))] : null,
  c.website ? [h('dt', null, 'WWW'), h('dd', null, h('a', { href: M.webUrl(c.website), target: '_blank', rel: 'noopener' }, c.website.replace(/^https?:\/\//, '')))] : null);

  const linkKey = c.kind === 'klient' ? 'clientId' : null;
  const head = h('div', { class: 'detail-head contact-head' },
    avatar(c.name, { kind: c.kind, size: 72 }),
    h('div', { class: 'detail-kicker' }, M.kindLabel(c.kind)),
    h('h1', { class: 'detail-title' }, c.name),
    M.contactSubtitle(c) ? h('div', { class: 'muted' }, M.contactSubtitle(c)) : null,
    contactActions(c),
    h('div', { class: 'ai-strip ai-strip-center' }, h('span', { class: 'ai-strip-label' }, icon('ai', 15), 'Asystent'),
      suggestionsFor({ kind: 'contact', id: c.id }).map(([ic, label, prompt]) => h('button', { class: 'ai-chip', onclick: () => openAssist({ prompt }) }, icon(ic, 16), label))),
    !c.instagram ? h('button', { class: 'link-btn', onclick: () => instagramSheet(c) }, icon('instagram', 16), 'Znajdź na Instagramie') : null);

  return {
    title: c.name,
    back: `kontakty/${c.kind}`,
    action: h('div', { class: 'head-actions' },
      h('button', { class: 'icon-btn', 'aria-label': 'Edytuj kontakt', onclick: () => editContact(c) }, icon('edit')),
      h('button', { class: 'icon-btn', 'aria-label': 'Usuń kontakt', onclick: async () => {
        if (await confirmDialog(`Usunąć kontakt „${c.name}”?`, { ok: 'Usuń', danger: true })) {
          await db.remove('contacts', c.id);
          navigate(`kontakty/${c.kind}`, { replace: true });
          toast('Kontakt usunięty');
        }
      } }, icon('trash'))),
    node: h('div', { class: 'page page-detail' }, head,
      h('div', { class: 'two-col' },
        h('div', { class: 'col' },
          c.kind === 'klient' || c.kind === 'influencer' ? section(c.kind === 'klient' ? `Projekty (${projects.length})` : `Współprace (${projects.length})`,
            projects.length ? h('div', { class: 'list' }, projects.map((p) => h('button', { class: 'list-row', onclick: () => navigate(`projekt/${p.id}`) },
              h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, p.title),
                h('div', { class: 'row-meta' }, M.stageLabel(p.stage), p.due ? ` · ${relDay(p.due)}` : '')),
              h('div', { class: 'mini-progress' }, progressBar(M.projectProgress(p))))))
              : h('p', { class: 'muted pad' }, c.kind === 'klient' ? 'Brak projektów.' : 'Brak współprac.'),
            c.kind === 'klient' ? h('button', { class: 'link-btn', onclick: async () => (await import('../components.js')).editProject(null, { clientId: c.id }) }, icon('plus', 16), 'Nowy projekt') : null) : null,
          section('Zadania i follow-upy', tasks.length ? h('div', { class: 'list' }, tasks.map((t) => taskRow(t, { showDate: true })))
            : h('p', { class: 'muted pad' }, 'Brak zadań.'),
          h('div', { class: 'row-gap' },
            h('button', { class: 'link-btn', onclick: () => editTask(null, { contactId: c.id, kind: 'followup', title: `Follow-up: ${c.name}` }) }, icon('mail', 16), 'Follow-up'),
            h('button', { class: 'link-btn', onclick: () => editTask(null, { contactId: c.id }) }, icon('plus', 16), 'Zadanie'))),
          c.messages ? section('Kluczowe przekazy marki', h('div', { class: 'prose quote' }, c.messages)) : null,
          c.notes ? section('Notatki', h('div', { class: 'prose' }, c.notes)) : null),
        h('div', { class: 'col' },
          section('Informacje', facts),
          section('Pliki i zdjęcia', files.length ? filesGrid(files) : h('p', { class: 'muted pad' }, 'Brak plików.'),
            h('div', { class: 'row-gap' },
              h('button', { class: 'link-btn', onclick: () => uploadFlow({ camera: true, links: { clientId: c.id } }) }, icon('camera', 16), 'Zdjęcie'),
              h('button', { class: 'link-btn', onclick: () => uploadFlow({ links: { clientId: c.id } }) }, icon('upload', 16), 'Plik'))),
          section('Dokumenty', docs.length ? h('div', { class: 'list' }, docs.map((d) => h('button', { class: 'list-row', onclick: () => navigate(`dokument/${d.id}`) },
            h('span', { class: 'row-ic' }, icon('doc', 20)), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, d.title)))))
            : h('p', { class: 'muted pad' }, 'Brak dokumentów.'),
          h('button', { class: 'link-btn', onclick: () => navigate(`asystent/pismo?kontakt=${c.id}`) }, icon('ai', 16), 'Napisz pismo')),
          h('p', { class: 'hint-line' }, `Dodane ${new Date(c.createdAt).toLocaleDateString('pl-PL')} przez ${M.partnerName(c.createdBy) || '—'}`)))),
    linkKey,
  };
}
