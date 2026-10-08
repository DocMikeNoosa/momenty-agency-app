import * as db from '../db.js';
import * as M from '../model.js';
import { TEMPLATES, generate, aiLetter } from '../letters.js';
import * as ai from '../ai.js';
import { assistantPanel } from '../assist.js';
import {
  h, icon, buildForm, toast, emptyState, confirmDialog, relDay, shareOrDownload, clear,
} from '../ui.js';
import { section, blobUrl, saveFile, pickFiles } from '../components.js';
import * as cloud from '../cloud.js';
import { navigate } from '../router.js';

// ---------- Pisma i dokumenty (with the assistant on top) ----------
export function renderAssistant() {
  const docs = db.all('docs').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const card = (ic, title, text, onclick) => h('button', { class: 'tool-card', onclick },
    h('span', { class: 'tool-ic' }, icon(ic, 24)), h('span', { class: 'tool-title' }, title), h('span', { class: 'tool-text' }, text));
  return {
    title: 'Pisma i dokumenty',
    back: 'wiecej',
    node: h('div', { class: 'page page-narrow' },
      h('div', { class: 'tools' },
        card('doc', 'Nowe pismo', 'Pitch, informacja prasowa, brief, zaproszenie, follow-up, oferta – AI pisze za Ciebie.', () => navigate('asystent/pismo')),
        card('instagram', 'Makieta posta', 'Podgląd posta lub relacji na Instagramie dla klienta.', () => navigate('asystent/makieta'))),
      // without the server the panel can only add tasks – that belongs to the ✦ button, not to this page
      ai.available() ? section('Albo powiedz asystentowi', assistantPanel().el) : null,
      section(`Zapisane dokumenty (${docs.length})`, docs.length ? h('div', { class: 'list' }, docs.slice(0, 50).map((d) => h('button', { class: 'list-row', onclick: () => navigate(`dokument/${d.id}`) },
        h('span', { class: 'row-ic' }, icon(d.kind === 'contract' ? 'file' : d.kind === 'email' ? 'mail' : 'doc', 20)),
        h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, d.title),
          h('div', { class: 'row-meta' }, [d.kind === 'contract' ? 'Umowa' : null, db.get('contacts', d.contactId)?.name, relDay(d.updatedAt.slice(0, 10))].filter(Boolean).join(' · '))),
        icon('chevron', 18, 'muted'))))
        : h('p', { class: 'muted pad' }, 'Brak zapisanych dokumentów. Poproś asystenta albo stuknij „Nowe pismo”.'))),
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
  // the essentials; everything else is optional and folded away
  const mainForm = buildForm([
    { key: 'tpl', label: 'Rodzaj pisma', type: 'select', full: true, options: TEMPLATES.map((t) => [t.id, t.label]) },
    { key: 'contactId', label: 'Do kogo', type: 'select', full: true, options: [['', '— wybierz —'], ...contactsAll.map((c) => [c.id, `${c.name} (${M.kindLabel(c.kind).toLowerCase()})`])] },
    { key: 'projectId', label: 'Projekt', type: 'select', full: true, options: [['', '— brak —'], ...db.all('projects').map((p) => [p.id, p.title])] },
    { key: 'details', label: 'Co chcesz przekazać? (opcjonalnie)', type: 'textarea', rows: 3, placeholder: 'np. zaproś na premierę 12.10, podkreśl naturalne składniki. AI resztę weźmie z projektu.' },
  ], { tpl: tplDefault, contactId: contactPre, projectId: projectPre });
  const moreForm = buildForm([
    { key: 'clientId', label: 'Marka / klient', type: 'select', options: [['', '— z projektu —'], ...contactsAll.filter((c) => c.kind === 'klient').map((c) => [c.id, c.name])] },
    { key: 'tone', label: 'Ton', type: 'select', options: [['formalny', 'Formalny'], ['swobodny', 'Swobodny']] },
    { key: 'topic', label: 'Temat / nazwa', full: true, placeholder: 'np. Premiera kolekcji jesiennej' },
    { key: 'date', label: 'Data', type: 'date' },
    { key: 'place', label: 'Miejsce', placeholder: 'np. Warszawa, Hala Koszyki' },
  ], { clientId: pre?.kind === 'klient' ? pre.id : proj?.clientId || '', tone: 'formalny' });
  const form = {
    inputs: { ...mainForm.inputs, ...moreForm.inputs },
    read: () => ({ ...moreForm.read(), ...mainForm.read() }),
  };
  const moreFields = h('details', { class: 'more-fields' }, h('summary', null, 'Więcej szczegółów (opcjonalnie)'), moreForm.el);
  const subject = h('input', { type: 'text', class: 'out-subject', 'aria-label': 'Temat wiadomości' });
  const body = h('textarea', { class: 'out-body', rows: 18, 'aria-label': 'Treść pisma' });
  let edited = false;
  const regenBtn = h('button', { class: 'btn btn-soft btn-sm', hidden: true, onclick: () => { edited = false; regen(); } }, icon('sync', 16), 'Z szablonu');
  const aiLabel = [icon('ai', 18), 'Napisz z AI'];
  const aiBtn = h('button', { class: 'btn btn-primary btn-block', onclick: async () => {
    if (!ai.available()) { toast('AI działa po połączeniu z serwerem agencji (Więcej → Ustawienia). Poniżej jest tekst z szablonu.'); return; }
    if (!form.read().contactId && !form.read().projectId) { toast('Wybierz odbiorcę lub projekt – AI weźmie z nich resztę.'); return; }
    aiBtn.disabled = true; clear(aiBtn).append(h('span', { class: 'spinner' }), 'AI pisze…');
    try {
      const r = await aiLetter(form.read());
      subject.value = r.subject; body.value = r.body; edited = true; regenBtn.hidden = false;
      toast('Gotowe – przeczytaj i wyślij');
      body.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { toast(e.message); }
    aiBtn.disabled = false; clear(aiBtn).append(...aiLabel);
  } }, ...aiLabel);
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
    title: 'Nowe pismo',
    back: 'asystent',
    node: h('div', { class: 'page' },
      h('div', { class: 'two-col letter-layout' },
        h('div', { class: 'col' }, h('div', { class: 'card pad-card letter-form' }, mainForm.el, hintEl, moreFields, aiBtn)),
        h('div', { class: 'col' },
          h('div', { class: 'card pad-card letter-out' },
            h('div', { class: 'section-head' }, h('h3', null, 'Gotowy tekst'), regenBtn),
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
  // opened from a project: use its client account and its newest photo
  const proj = db.get('projects', query.get('projekt'));
  const projClient = proj && db.get('contacts', proj.clientId);
  const projImage = proj && db.all('files').filter((f) => f.isImage && f.projectId === proj.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  const state = { imageBlob: null, imageId: query.get('plik') || projImage?.id || '', format: FORMATS[query.get('format')] ? query.get('format') : 'portrait' };
  const clients = db.all('contacts').filter((c) => c.kind === 'klient' || c.kind === 'influencer').sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const form = buildForm([
    { key: 'contactId', label: 'Konto (klient / influencer)', type: 'select', options: [['', 'momentyagency'], ...clients.map((c) => [c.id, c.name])] },
    { key: 'handle', label: 'Nazwa konta', placeholder: 'momentyagency' },
    { key: 'location', label: 'Lokalizacja', placeholder: 'np. Warszawa, Polska' },
    { key: 'likes', label: 'Polubienia', type: 'number', inputmode: 'numeric', default: 1248 },
    { key: 'caption', label: 'Opis posta', type: 'textarea', rows: 5, placeholder: 'Treść opisu, #hashtagi' },
  ], {
    contactId: projClient?.id || '',
    handle: projClient ? (projClient.instagram ? M.handle(projClient.instagram).slice(1) : projClient.name.toLowerCase().replace(/[^a-z0-9._]/g, '')) : '',
    caption: query.get('caption') || '',
  });
  const captionAI = h('button', { class: 'btn btn-soft btn-sm', type: 'button', onclick: async () => {
    if (!ai.available()) { toast('AI działa po połączeniu z serwerem agencji.'); return; }
    captionAI.disabled = true;
    try {
      const c = db.get('contacts', form.inputs.contactId.value);
      const res = await ai.ask({
        system: 'Jesteś copywriterką social media w agencji PR Momenty Agency. Piszesz po polsku angażujące opisy postów na Instagram: mocne pierwsze zdanie, 2–4 krótkie akapity lub zdania, wezwanie do działania, 5–10 trafnych hashtagów. Bez cudzysłowów i komentarzy – zwracasz tylko gotowy opis.',
        messages: [{ role: 'user', content: `Marka: ${c?.name || 'Momenty Agency'}${c?.messages ? `\nPrzekazy marki: ${c.messages}` : ''}${proj ? `\nProjekt: ${proj.title}\nOpis: ${proj.description || ''}\nCel: ${proj.goal || ''}` : ''}\nFormat: ${FORMATS[state.format][2]}\nObecny opis (popraw lub napisz nowy): ${form.inputs.caption.value || '—'}` }],
        max_tokens: 1500, effort: 'low',
      });
      form.inputs.caption.value = ai.textOf(res);
      draw();
    } catch (e) { toast(e.message); }
    captionAI.disabled = false;
  } }, icon('ai', 16), 'Napisz opis z AI');
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
    back: proj ? `projekt/${proj.id}?tab=pliki` : 'wiecej',
    node: h('div', { class: 'page' },
      h('div', { class: 'two-col mock-layout' },
        h('div', { class: 'col' },
          h('div', { class: 'card pad-card' },
            h('div', { class: 'field-label' }, 'Zdjęcie'), thumbs,
            h('div', { class: 'field-label', style: { marginTop: '14px' } }, 'Format'), fmtSeg,
            form.el, captionAI)),
        h('div', { class: 'col' },
          h('div', { class: 'mock-wrap' }, canvas),
          h('div', { class: 'sheet-actions sticky-actions' },
            h('button', { class: 'btn btn-soft', onclick: async () => shareOrDownload(await exportBlob(), fileName(), 'Makieta posta') }, icon('share', 18), 'Wyślij / pobierz'),
            h('button', { class: 'btn btn-primary', onclick: async () => {
              const b = await exportBlob();
              const c = db.get('contacts', form.inputs.contactId.value);
              const rec = await saveFile(new File([b], fileName(), { type: 'image/png' }), { clientId: c?.id || '', projectId: proj?.id || '', caption: `Makieta: ${form.read().handle || 'post'}` });
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

