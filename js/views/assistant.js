import * as db from '../db.js';
import * as M from '../model.js';
import { TEMPLATES, generate, aiLetter } from '../letters.js';
import * as ai from '../ai.js';
import { createConversation, TOOL_LABELS, LABEL_PATH } from '../agent.js';
import {
  h, icon, buildForm, toast, emptyState, confirmDialog, relDay, shareOrDownload, clear,
} from '../ui.js';
import { section, blobUrl, saveFile, pickFiles, editTask } from '../components.js';
import * as cloud from '../cloud.js';
import { navigate } from '../router.js';

// ---------- Hub: AI command assistant + tools ----------
let convo = null;
const transcript = [];
let busy = null;
let draft = '';

const SUGGESTIONS = [
  'Co mam dziś do zrobienia?',
  'Przypomnij mi jutro o 10, żeby zadzwonić do Magazynu Styl',
  'Przygotuj follow-up do dziennikarki w sprawie premiery',
  'Zaplanuj spotkanie z klientem w piątek o 14 dla nas obu',
];

function actionView(a) {
  const path = a.col && LABEL_PATH[a.col] ? `${LABEL_PATH[a.col]}/${a.id}` : null;
  const btns = [];
  if (a.email) {
    const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    btns.push(h('a', { class: 'btn btn-primary', href: `mailto:${a.email.to || ''}?${q({ subject: a.email.subject, body: a.email.body })}` }, 'Wyślij'));
    btns.push(h('a', { class: 'btn btn-soft', href: `https://mail.google.com/mail/?view=cm&fs=1&${q({ to: a.email.to || '', su: a.email.subject, body: a.email.body })}`, target: '_blank', rel: 'noopener' }, 'Gmail'));
  }
  if (a.col === 'tasks') {
    const t = db.get('tasks', a.id);
    if (t) btns.push(h('button', { class: 'btn btn-soft', onclick: () => editTask(t) }, 'Otwórz'));
  } else if (path) btns.push(h('button', { class: 'btn btn-soft', onclick: () => navigate(path) }, 'Otwórz'));
  if (a.href) btns.push(h('a', { class: 'btn btn-soft', href: a.href, target: '_blank', rel: 'noopener' }, 'Otwórz'));
  if (a.undo) btns.push(h('button', { class: 'btn btn-ghost', onclick: async () => { await a.undo(); toast('Cofnięto'); } }, 'Cofnij'));
  else if (a.col && a.id && db.get(a.col, a.id) && a.col !== 'docs') {
    btns.push(h('button', { class: 'btn btn-ghost', onclick: async () => { await db.remove(a.col, a.id); toast('Usunięto'); window.dispatchEvent(new Event('rerender')); } }, 'Cofnij'));
  }
  return h('div', { class: 'act' }, icon(a.icon || 'check', 18), h('span', null, a.label), h('span', { class: 'act-btns' }, btns));
}

export async function sendCommand(text) {
  if (!text.trim() || busy) return;
  convo = convo || createConversation();
  transcript.push({ role: 'user', text });
  draft = '';
  busy = 'Myślę…';
  window.dispatchEvent(new Event('rerender'));
  try {
    const r = await convo.send(text, { onStep: (name) => { busy = TOOL_LABELS[name] || 'Pracuję…'; const el = document.querySelector('.thinking span:last-child'); if (el) el.textContent = busy; } });
    transcript.push({ role: 'ai', text: r.text, actions: r.actions });
    const nav = r.actions.find((a) => a.navigate);
    busy = null;
    if (nav) { navigate(nav.navigate); return; }
  } catch (e) {
    transcript.push({ role: 'ai', text: e.message, actions: [] });
  }
  busy = null;
  window.dispatchEvent(new Event('rerender'));
}

function agentPanel() {
  const ta = h('textarea', { placeholder: 'Powiedz lub napisz, co zrobić…', 'aria-label': 'Polecenie dla asystenta', rows: 3, id: 'agent-input', enterkeyhint: 'send',
    oninput: (e) => { draft = e.target.value; },
    onkeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey && matchMedia('(pointer: fine)').matches) { e.preventDefault(); sendCommand(ta.value); } } });
  ta.value = draft;
  let stop = null;
  const mic = ai.canDictate() ? h('button', { class: 'mic', type: 'button', 'aria-label': 'Dyktuj', onclick: () => {
    if (stop) { stop(); return; }
    mic.classList.add('rec');
    const base = ta.value ? `${ta.value} ` : '';
    stop = ai.dictate({ onText: (t) => { ta.value = base + t; draft = ta.value; }, onEnd: () => { mic.classList.remove('rec'); stop = null; } });
  } }, icon('mic', 22)) : h('span', { class: 'small muted' }, '🎙 Dyktuj mikrofonem na klawiaturze');
  const chips = transcript.length ? null : h('div', { class: 'chips' }, SUGGESTIONS.map((t) => h('button', { class: 'chip-btn', onclick: () => sendCommand(t) }, t)));
  const msgs = transcript.map((m) => (m.role === 'user'
    ? h('div', { class: 'msg msg-user' }, m.text)
    : h('div', { class: 'msg msg-ai' }, m.text || 'Gotowe.', m.actions?.length ? h('div', { class: 'actions' }, m.actions.filter((a) => !a.navigate).map(actionView)) : null)));
  return h('div', { class: 'agent' },
    ...msgs,
    busy ? h('div', { class: 'msg msg-ai thinking' }, h('span', { class: 'spinner' }), h('span', null, busy)) : null,
    h('div', { class: 'agent-box', dataset: { keep: '1' } }, ta,
      h('div', { class: 'agent-bar' }, mic,
        transcript.length ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => { transcript.length = 0; convo = null; window.dispatchEvent(new Event('rerender')); } }, 'Nowa rozmowa') : null,
        h('button', { class: 'btn btn-primary', disabled: !!busy, onclick: () => sendCommand(ta.value) }, 'Wykonaj'))),
    chips);
}

export function renderAssistant() {
  const docs = db.all('docs').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const card = (ic, title, text, onclick) => h('button', { class: 'tool-card', onclick },
    h('span', { class: 'tool-ic' }, icon(ic, 24)), h('span', { class: 'tool-title' }, title), h('span', { class: 'tool-text' }, text));

  return {
    title: 'Asystent',
    node: h('div', { class: 'page page-narrow' },
      ai.available() ? agentPanel() : h('div', { class: 'notice notice-ai' }, icon('ai', 22),
        h('div', null,
          h('strong', null, 'Asystent AI'),
          h('div', { class: 'small' }, 'Po połączeniu z serwerem agencji asystent wykona polecenia głosowe i pisane: doda zadania z przypomnieniami w Kalendarzu Google, przygotuje e-maile, utworzy projekty i kontakty, znajdzie osoby na Instagramie.')),
        h('button', { class: 'btn btn-soft btn-sm', onclick: () => navigate('ustawienia') }, 'Połącz')),
      h('div', { class: 'tools' },
        card('doc', 'Napisz pismo', 'Pitch, informacja prasowa, brief, zaproszenie, follow-up, oferta – z AI lub z szablonu.', () => navigate('asystent/pismo')),
        card('instagram', 'Makieta posta', 'Podgląd posta lub relacji na Instagramie dla klienta – gotowy do wysłania.', () => navigate('asystent/makieta'))),
      section(`Dokumenty (${docs.length})`, docs.length ? h('div', { class: 'list' }, docs.slice(0, 30).map((d) => h('button', { class: 'list-row', onclick: () => navigate(`dokument/${d.id}`) },
        h('span', { class: 'row-ic' }, icon(d.kind === 'contract' ? 'file' : d.kind === 'email' ? 'mail' : 'doc', 20)),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, d.title),
          h('div', { class: 'row-meta' }, [db.get('contacts', d.contactId)?.name, relDay(d.updatedAt.slice(0, 10))].filter(Boolean).join(' · '))),
        icon('chevron', 18, 'muted'))))
        : h('p', { class: 'muted pad' }, 'Brak zapisanych dokumentów.'))),
  };
}

// ---------- Letter generator ----------
export function renderLetter(query) {
  const contactPre = query.get('kontakt') || '';
  const projectPre = query.get('projekt') || '';
  const pre = db.get('contacts', contactPre);
  const proj = db.get('projects', projectPre);
  let tplDefault = 'pitch';
  if (pre?.kind === 'influencer') tplDefault = 'brief';
  else if (pre?.kind === 'klient') tplDefault = proj ? 'status' : 'offer';
  else if (proj) tplDefault = 'status';

  const contactsAll = db.all('contacts').sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const fields = [
    { key: 'tpl', label: 'Rodzaj pisma', type: 'select', full: true, options: TEMPLATES.map((t) => [t.id, t.label]) },
    { key: 'contactId', label: 'Odbiorca', type: 'select', options: [['', '— wybierz —'], ...contactsAll.map((c) => [c.id, `${c.name} (${M.kindLabel(c.kind).toLowerCase()})`])] },
    { key: 'clientId', label: 'Marka / klient', type: 'select', options: [['', '— wybierz —'], ...contactsAll.filter((c) => c.kind === 'klient').map((c) => [c.id, c.name])] },
    { key: 'projectId', label: 'Projekt', type: 'select', options: [['', '— brak —'], ...db.all('projects').map((p) => [p.id, p.title])] },
    { key: 'tone', label: 'Ton', type: 'select', options: [['formalny', 'Formalny'], ['swobodny', 'Swobodny']] },
    { key: 'topic', label: 'Temat / nazwa', full: true, placeholder: 'np. Premiera kolekcji jesiennej' },
    { key: 'date', label: 'Data', type: 'date' },
    { key: 'place', label: 'Miejsce', placeholder: 'np. Warszawa, Hala Koszyki' },
    { key: 'details', label: 'Szczegóły / kluczowe informacje', type: 'textarea', rows: 4, placeholder: 'Każda linia może być osobnym punktem.' },
  ];
  const form = buildForm(fields, {
    tpl: tplDefault, contactId: contactPre, projectId: projectPre,
    clientId: pre?.kind === 'klient' ? pre.id : proj?.clientId || '', tone: 'formalny',
  });
  const subject = h('input', { type: 'text', class: 'out-subject', 'aria-label': 'Temat wiadomości' });
  const body = h('textarea', { class: 'out-body', rows: 18, 'aria-label': 'Treść pisma' });
  let edited = false;
  const regenBtn = h('button', { class: 'btn btn-soft btn-sm', hidden: true, onclick: () => { edited = false; regen(); } }, icon('sync', 16), 'Z szablonu');
  const aiBtn = h('button', { class: 'btn btn-primary btn-sm', onclick: async () => {
    if (!ai.available()) { toast('AI działa po połączeniu z serwerem agencji (Ustawienia).'); return; }
    aiBtn.disabled = true; aiBtn.textContent = 'AI pisze…';
    try {
      const r = await aiLetter(form.read());
      subject.value = r.subject; body.value = r.body; edited = true; regenBtn.hidden = false;
      toast('Gotowe – przeczytaj i dopracuj przed wysłaniem');
    } catch (e) { toast(e.message); }
    aiBtn.disabled = false; aiBtn.textContent = 'Napisz z AI';
  } }, 'Napisz z AI');
  body.addEventListener('input', () => { edited = true; regenBtn.hidden = false; });
  subject.addEventListener('input', () => { edited = true; regenBtn.hidden = false; });

  const hintEl = h('p', { class: 'hint-line' });
  function regen() {
    const v = form.read();
    const t = TEMPLATES.find((x) => x.id === v.tpl);
    hintEl.textContent = t?.hint || '';
    if (edited) return;
    const out = generate(v);
    subject.value = out.subject;
    body.value = out.body;
    regenBtn.hidden = true;
  }
  form.inputs.projectId.addEventListener('change', () => {
    const p = db.get('projects', form.inputs.projectId.value);
    if (p?.clientId && !form.inputs.clientId.value) form.inputs.clientId.value = p.clientId;
  });
  Object.values(form.inputs).forEach((el) => { el.addEventListener('input', regen); el.addEventListener('change', regen); });
  regen();

  const recipient = () => db.get('contacts', form.inputs.contactId.value);
  const actions = h('div', { class: 'sheet-actions sticky-actions' },
    h('button', { class: 'btn btn-soft', onclick: async () => {
      try { await navigator.clipboard.writeText(`${subject.value}\n\n${body.value}`); toast('Skopiowano do schowka'); } catch { toast('Nie udało się skopiować'); }
    } }, icon('copy', 18), 'Kopiuj'),
    h('button', { class: 'btn btn-soft', onclick: () => {
      const r = recipient();
      location.href = `mailto:${r?.email || ''}?subject=${encodeURIComponent(subject.value)}&body=${encodeURIComponent(body.value)}`;
    } }, icon('mail', 18), 'E-mail'),
    h('button', { class: 'btn btn-soft', onclick: () => window.open(gmailUrl(recipient()?.email, subject.value, body.value), '_blank', 'noopener') }, 'Gmail'),
    navigator.share ? h('button', { class: 'btn btn-soft', onclick: () => navigator.share({ title: subject.value, text: body.value }).catch(() => {}) }, icon('share', 18), 'Udostępnij') : null,
    h('button', { class: 'btn btn-soft', onclick: () => printLetter(subject.value, body.value) }, icon('print', 18), 'PDF / drukuj'),
    h('button', { class: 'btn btn-primary', onclick: async () => {
      const v = form.read();
      const d = await db.put('docs', {
        title: subject.value || 'Dokument', body: body.value, tpl: v.tpl,
        contactId: v.contactId, clientId: v.clientId, projectId: v.projectId,
      });
      db.logActivity(`zapisał(a) dokument: ${d.title}`, { col: 'docs', id: d.id });
      toast('Dokument zapisany');
      navigate(`dokument/${d.id}`, { replace: true });
    } }, 'Zapisz'));

  return {
    title: 'Napisz pismo',
    back: 'asystent',
    node: h('div', { class: 'page' },
      h('div', { class: 'two-col letter-layout' },
        h('div', { class: 'col' }, h('div', { class: 'card pad-card' }, form.el, hintEl)),
        h('div', { class: 'col' },
          h('div', { class: 'card pad-card letter-out' },
            h('div', { class: 'section-head' }, h('h3', null, 'Gotowy tekst'), h('div', { class: 'row-gap' }, regenBtn, aiBtn)),
            h('label', { class: 'field field-full' }, h('span', { class: 'field-label' }, 'Temat'), subject),
            h('label', { class: 'field field-full' }, h('span', { class: 'field-label' }, 'Treść (możesz edytować)'), body),
            h('p', { class: 'hint-line' }, 'Fragmenty w [nawiasach] uzupełnij przed wysłaniem.')),
          actions))),
  };
}

export function gmailUrl(to, subject, body) {
  const q = new URLSearchParams({ view: 'cm', fs: '1', to: to || '', su: subject || '', body: body || '' });
  return `https://mail.google.com/mail/?${q}`;
}

export function printLetter(title, body) {
  const w = window.open('', '_blank');
  if (!w) { toast('Zezwól na wyskakujące okna, aby wydrukować.'); return; }
  const esc = (s) => s.replace(/[&<>]/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
  w.document.write(`<!doctype html><html lang="pl"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
@page { margin: 22mm 20mm; }
body { font: 11.5pt/1.55 Georgia, 'Times New Roman', serif; color: #1b1716; max-width: 170mm; margin: 0 auto; padding: 12mm 0; }
.head { display:flex; justify-content:space-between; align-items:center; border-bottom: 2px solid #5C0100; padding-bottom: 10px; margin-bottom: 28px; }
.logo { background:#5C0100; padding: 10px 16px; border-radius: 4px; }
.logo img { height: 34px; display:block; }
.meta { font: 9pt/1.4 Helvetica, Arial, sans-serif; color:#6f6763; text-align:right; }
pre { white-space: pre-wrap; font: inherit; margin: 0; }
</style></head><body>
<div class="head"><div class="logo"><img src="${new URL('assets/icons/logo-white.png', location.href)}" alt="Momenty Agency"></div>
<div class="meta">Momenty Agency<br>office@momentyagency.com<br>www.momentyagency.com</div></div>
<pre>${esc(body)}</pre>
<script>window.onload = () => setTimeout(() => window.print(), 300);<\/script>
</body></html>`);
  w.document.close();
}

// ---------- Saved document ----------
export function renderDoc(id) {
  const d = db.get('docs', id);
  if (!d) return { title: 'Dokument', back: 'asystent', node: emptyState('Ten dokument nie istnieje.', 'Wróć', () => navigate('asystent'), 'doc') };
  const title = h('input', { type: 'text', class: 'out-subject', value: d.title, 'aria-label': 'Tytuł' });
  const body = h('textarea', { class: 'out-body', rows: 22, 'aria-label': 'Treść' });
  body.value = d.body;
  const c = db.get('contacts', d.contactId);
  const save = async () => { await db.put('docs', { id: d.id, title: title.value, body: body.value }); toast('Zapisano'); };
  return {
    title: 'Dokument',
    back: 'asystent',
    action: h('button', { class: 'icon-btn', 'aria-label': 'Usuń dokument', onclick: async () => {
      if (await confirmDialog(`Usunąć dokument „${d.title}”?`, { ok: 'Usuń', danger: true })) { await db.remove('docs', d.id); navigate('asystent', { replace: true }); toast('Usunięto'); }
    } }, icon('trash')),
    node: h('div', { class: 'page page-narrow' },
      h('div', { class: 'card pad-card' },
        h('label', { class: 'field field-full' }, h('span', { class: 'field-label' }, 'Tytuł / temat'), title),
        h('label', { class: 'field field-full' }, h('span', { class: 'field-label' }, 'Treść'), body),
        d.kind === 'contract' ? h('p', { class: 'notice small' }, icon('flag', 18), 'Projekt umowy przygotowany automatycznie. Uzupełnij pola [uzupełnij] i sprawdź treść (najlepiej z prawnikiem) przed podpisaniem.') : null,
        h('p', { class: 'hint-line' }, [c ? `Odbiorca: ${c.name} · ` : '', `Ostatnia zmiana: ${M.partnerName(d.updatedBy) || '—'}, ${new Date(d.updatedAt).toLocaleString('pl-PL')}`])),
      h('div', { class: 'sheet-actions sticky-actions' },
        h('button', { class: 'btn btn-soft', onclick: async () => { try { await navigator.clipboard.writeText(`${title.value}\n\n${body.value}`); toast('Skopiowano'); } catch { toast('Nie udało się skopiować'); } } }, icon('copy', 18), 'Kopiuj'),
        h('button', { class: 'btn btn-soft', onclick: () => { location.href = `mailto:${d.to || c?.email || ''}?subject=${encodeURIComponent(title.value)}&body=${encodeURIComponent(body.value)}`; } }, icon('mail', 18), 'E-mail'),
        h('button', { class: 'btn btn-soft', onclick: () => window.open(gmailUrl(d.to || c?.email, title.value, body.value), '_blank', 'noopener') }, 'Gmail'),
        h('button', { class: 'btn btn-soft', onclick: () => printLetter(title.value, body.value) }, icon('print', 18), 'PDF / drukuj'),
        h('button', { class: 'btn btn-primary', onclick: save }, 'Zapisz'))),
  };
}

// ---------- Instagram mock-up ----------
const FORMATS = { square: [1080, 1080, 'Post 1:1'], portrait: [1080, 1350, 'Post 4:5'], story: [1080, 1920, 'Relacja 9:16'] };

export function renderMockup(query) {
  const state = { imageBlob: null, imageId: query.get('plik') || '', format: 'portrait' };
  const clients = db.all('contacts').filter((c) => c.kind === 'klient' || c.kind === 'influencer').sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const form = buildForm([
    { key: 'contactId', label: 'Konto (klient / influencer)', type: 'select', options: [['', 'momentyagency'], ...clients.map((c) => [c.id, c.name])] },
    { key: 'handle', label: 'Nazwa konta', placeholder: 'momentyagency' },
    { key: 'location', label: 'Lokalizacja', placeholder: 'np. Warszawa, Polska' },
    { key: 'likes', label: 'Polubienia', type: 'number', inputmode: 'numeric', default: 1248 },
    { key: 'caption', label: 'Opis posta', type: 'textarea', rows: 5, placeholder: 'Treść opisu, #hashtagi' },
  ], {});
  form.inputs.contactId.addEventListener('change', () => {
    const c = db.get('contacts', form.inputs.contactId.value);
    form.inputs.handle.value = c?.instagram ? M.handle(c.instagram).slice(1) : (c ? c.name.toLowerCase().replace(/[^a-z0-9._]/g, '') : '');
    draw();
  });

  const canvas = h('canvas', { class: 'mock-canvas', width: 1080, height: 1350, 'aria-label': 'Podgląd makiety' });
  const fmtSeg = h('div', { class: 'seg' }, Object.entries(FORMATS).map(([k, [, , label]]) =>
    h('button', { class: `seg-btn ${k === state.format ? 'on' : ''}`, onclick: (e) => {
      state.format = k;
      fmtSeg.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('on'));
      e.currentTarget.classList.add('on');
      draw();
    } }, label)));

  const thumbs = h('div', { class: 'mock-thumbs' });
  async function drawThumbs() {
    clear(thumbs);
    const imgs = db.all('files').filter((f) => f.isImage).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 24);
    thumbs.append(h('button', { class: 'mock-thumb add', 'aria-label': 'Wybierz zdjęcie z urządzenia', onclick: async () => {
      const [f] = await pickFiles({ accept: 'image/*', multiple: false });
      if (!f) return;
      const rec = await saveFile(f, {});
      state.imageId = rec.id;
      await loadSelected();
      drawThumbs();
    } }, icon('plus', 22)));
    for (const f of imgs) {
      const u = await blobUrl(f.thumbId || f.blobId);
      thumbs.append(h('button', { class: `mock-thumb ${state.imageId === f.id ? 'on' : ''}`, 'aria-label': f.caption || f.name, onclick: async () => {
        state.imageId = f.id; await loadSelected(); thumbs.querySelectorAll('.mock-thumb').forEach((b) => b.classList.remove('on'));
        thumbs.querySelector(`[data-id="${f.id}"]`)?.classList.add('on');
      }, dataset: { id: f.id } }, u ? h('img', { src: u, alt: '' }) : null));
    }
  }
  let bitmap = null;
  async function loadSelected() {
    const f = db.get('files', state.imageId);
    bitmap = null;
    if (f) {
      const b = (await db.getBlob(f.blobId)) || (await cloud.downloadBlob(f.blobId));
      if (b) {
        try { bitmap = await createImageBitmap(b); } catch {
          bitmap = await new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = URL.createObjectURL(b); });
        }
      }
    }
    draw();
  }

  async function draw() {
    const v = form.read();
    const [W, H] = FORMATS[state.format];
    await document.fonts.load('600 32px Inter').catch(() => {});
    await document.fonts.load('400 32px Inter').catch(() => {});
    drawMock(canvas, { ...v, handle: v.handle || 'momentyagency', W, H, story: state.format === 'story', bitmap });
  }
  Object.values(form.inputs).forEach((el) => el.addEventListener('input', draw));

  const exportBlob = () => new Promise((r) => canvas.toBlob(r, 'image/png'));
  const fileName = () => `makieta-${(form.read().handle || 'post').replace(/[^a-z0-9]+/gi, '-')}-${state.format}.png`;

  drawThumbs();
  loadSelected();

  return {
    title: 'Makieta posta',
    back: 'asystent',
    node: h('div', { class: 'page' },
      h('div', { class: 'two-col mock-layout' },
        h('div', { class: 'col' },
          h('div', { class: 'card pad-card' },
            h('div', { class: 'field-label' }, 'Zdjęcie'), thumbs,
            h('div', { class: 'field-label', style: { marginTop: '14px' } }, 'Format'), fmtSeg,
            form.el)),
        h('div', { class: 'col' },
          h('div', { class: 'mock-wrap' }, canvas),
          h('div', { class: 'sheet-actions sticky-actions' },
            h('button', { class: 'btn btn-soft', onclick: async () => shareOrDownload(await exportBlob(), fileName(), 'Makieta posta') }, icon('share', 18), 'Wyślij / pobierz'),
            h('button', { class: 'btn btn-primary', onclick: async () => {
              const b = await exportBlob();
              const c = db.get('contacts', form.inputs.contactId.value);
              const rec = await saveFile(new File([b], fileName(), { type: 'image/png' }), { clientId: c?.id || '', caption: `Makieta: ${form.read().handle || 'post'}` });
              db.logActivity(`przygotował(a) makietę posta${c ? ` dla ${c.name}` : ''}`, { col: 'files', id: rec.id });
              toast('Makieta zapisana w Plikach');
            } }, 'Zapisz w plikach'))))),
  };
}

function wrapText(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
    }
    lines.push(line);
  }
  return lines;
}

function cover(ctx, img, x, y, w, hh) {
  const k = Math.max(w / img.width, hh / img.height);
  const sw = w / k, sh = hh / k;
  ctx.drawImage(img, (img.width - sw) / 2, (img.height - sh) / 2, sw, sh, x, y, w, hh);
}

function placeholder(ctx, x, y, w, hh) {
  ctx.fillStyle = '#5C0100';
  ctx.fillRect(x, y, w, hh);
  ctx.fillStyle = 'rgba(250,246,240,.85)';
  ctx.font = '400 44px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Wybierz zdjęcie', x + w / 2, y + hh / 2);
  ctx.textAlign = 'left';
}

function drawMock(canvas, o) {
  const ctx = canvas.getContext('2d');
  if (o.story) {
    canvas.width = o.W; canvas.height = o.H;
    if (o.bitmap) cover(ctx, o.bitmap, 0, 0, o.W, o.H); else placeholder(ctx, 0, 0, o.W, o.H);
    const g = ctx.createLinearGradient(0, 0, 0, 320);
    g.addColorStop(0, 'rgba(0,0,0,.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, o.W, 320);
    ctx.fillStyle = 'rgba(255,255,255,.55)'; roundRect(ctx, 30, 40, o.W - 60, 8, 4); ctx.fill();
    ctx.fillStyle = '#fff'; roundRect(ctx, 30, 40, (o.W - 60) * 0.45, 8, 4); ctx.fill();
    avatarCircle(ctx, 70, 110, 38, o.handle);
    ctx.fillStyle = '#fff'; ctx.font = '600 34px Inter, sans-serif';
    ctx.fillText(o.handle, 124, 122);
    ctx.globalAlpha = 0.8; ctx.font = '400 30px Inter, sans-serif';
    ctx.fillText('2 godz.', 136 + ctx.measureText(o.handle).width + 20, 122); ctx.globalAlpha = 1;
    if (o.caption) {
      ctx.font = '600 52px Inter, sans-serif';
      const lines = wrapText(ctx, o.caption, o.W - 200).slice(0, 6);
      const lh = 66, top = o.H - 300 - lines.length * lh;
      lines.forEach((l, i) => {
        const w = ctx.measureText(l).width;
        ctx.fillStyle = 'rgba(250,246,240,.94)';
        roundRect(ctx, (o.W - w) / 2 - 22, top + i * lh - 50, w + 44, lh, 12); ctx.fill();
        ctx.fillStyle = '#1b1716'; ctx.textAlign = 'center'; ctx.fillText(l, o.W / 2, top + i * lh); ctx.textAlign = 'left';
      });
    }
    ctx.strokeStyle = 'rgba(255,255,255,.8)'; ctx.lineWidth = 3;
    roundRect(ctx, 40, o.H - 150, o.W - 220, 96, 48); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.font = '400 32px Inter, sans-serif';
    ctx.fillText('Wyślij wiadomość', 84, o.H - 92);
    return;
  }
  // feed post
  const head = 130;
  ctx.font = '400 34px Inter, sans-serif';
  const captionLines = o.caption ? wrapText(ctx, `${o.handle} ${o.caption}`, o.W - 64).slice(0, 7) : [];
  const H = head + o.H + 130 + 56 + captionLines.length * 46 + 80;
  canvas.width = o.W; canvas.height = H;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, o.W, H);
  avatarCircle(ctx, 70, head / 2, 40, o.handle);
  ctx.fillStyle = '#111'; ctx.font = '600 34px Inter, sans-serif';
  ctx.fillText(o.handle, 128, o.location ? 58 : 76);
  if (o.location) { ctx.font = '400 28px Inter, sans-serif'; ctx.fillText(o.location, 128, 98); }
  ctx.fillStyle = '#111';
  [0, 1, 2].forEach((i) => { ctx.beginPath(); ctx.arc(o.W - 70 + i * 0 - 24 + i * 24, head / 2, 5, 0, Math.PI * 2); ctx.fill(); });
  if (o.bitmap) cover(ctx, o.bitmap, 0, head, o.W, o.H); else placeholder(ctx, 0, head, o.W, o.H);
  const iy = head + o.H + 34;
  ctx.strokeStyle = '#111'; ctx.lineWidth = 4; ctx.lineJoin = 'round';
  heart(ctx, 40, iy, 58); bubble(ctx, 134, iy, 56); plane(ctx, 226, iy, 56); bookmark(ctx, o.W - 84, iy, 50);
  ctx.fillStyle = '#111'; ctx.font = '600 32px Inter, sans-serif';
  const likes = Number(o.likes) || 0;
  ctx.fillText(`Polubienia: ${likes.toLocaleString('pl-PL')}`, 32, iy + 110);
  let y = iy + 166;
  ctx.font = '400 34px Inter, sans-serif';
  captionLines.forEach((l, i) => {
    if (i === 0 && l.startsWith(o.handle)) {
      ctx.font = '600 34px Inter, sans-serif'; ctx.fillText(o.handle, 32, y);
      const w = ctx.measureText(`${o.handle} `).width;
      ctx.font = '400 34px Inter, sans-serif'; drawRich(ctx, l.slice(o.handle.length + 1), 32 + w, y);
    } else drawRich(ctx, l, 32, y);
    y += 46;
  });
  ctx.fillStyle = '#8e8e8e'; ctx.font = '400 26px Inter, sans-serif';
  ctx.fillText('2 GODZINY TEMU', 32, y + 20);
}

function drawRich(ctx, text, x, y) {
  // hashtags and mentions in Instagram blue
  for (const part of text.split(/(\s+)/)) {
    ctx.fillStyle = /^[#@]/.test(part) ? '#00376b' : '#111';
    ctx.fillText(part, x, y);
    x += ctx.measureText(part).width;
  }
}

function avatarCircle(ctx, cx, cy, r, name) {
  const g = ctx.createLinearGradient(cx - r, cy + r, cx + r, cy - r);
  g.addColorStop(0, '#f9ce34'); g.addColorStop(0.5, '#ee2a7b'); g.addColorStop(1, '#6228d7');
  ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r + 2, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx, cy, r - 2, 0, Math.PI * 2); ctx.fillStyle = '#5C0100'; ctx.fill();
  ctx.fillStyle = '#FAF6F0'; ctx.font = `600 ${Math.round(r * 0.8)}px Inter, sans-serif`; ctx.textAlign = 'center';
  ctx.fillText((name[0] || 'M').toUpperCase(), cx, cy + r * 0.28); ctx.textAlign = 'left';
}

function roundRect(ctx, x, y, w, hh, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + hh, r); ctx.arcTo(x + w, y + hh, x, y + hh, r);
  ctx.arcTo(x, y + hh, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function heart(ctx, x, y, s) {
  const k = s / 24; ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.lineWidth = 4 / k;
  ctx.stroke(new Path2D('M12 21s-7.5-4.6-9.5-9.2C1 8.4 3 5 6.5 5c2 0 3.5 1.2 5.5 3.2C14 6.2 15.5 5 17.5 5 21 5 23 8.4 21.5 11.8 19.5 16.4 12 21 12 21z'));
  ctx.restore();
}
function bubble(ctx, x, y, s) {
  const k = s / 24; ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.lineWidth = 4 / k;
  ctx.stroke(new Path2D('M20.5 15.5A9 9 0 1 0 17 19.6L21.5 21z')); ctx.restore();
}
function plane(ctx, x, y, s) {
  const k = s / 24; ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.lineWidth = 4 / k;
  ctx.stroke(new Path2D('M22 3 9.5 10.5M22 3l-7 18-4-8.5L2.5 8.5z')); ctx.restore();
}
function bookmark(ctx, x, y, s) {
  const k = s / 24; ctx.save(); ctx.translate(x, y); ctx.scale(k, k); ctx.lineWidth = 4 / k;
  ctx.stroke(new Path2D('M19 21l-7-5-7 5V4a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1z')); ctx.restore();
}

