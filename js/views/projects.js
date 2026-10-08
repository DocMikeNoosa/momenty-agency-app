import * as db from '../db.js';
import * as M from '../model.js';
import { h, icon, relDay, fullDate, emptyState, confirmDialog, toast, todayStr, clear, openSheet, buildForm } from '../ui.js';
import {
  progressBar, ownerBadge, editProject, editTask, taskRow, section, filesGrid, uploadFlow, avatar, contactRow, saveFile,
} from '../components.js';
import { navigate } from '../router.js';
import * as cloud from '../cloud.js';
import * as ai from '../ai.js';
import { pricingOf, totals, pln, newItem, UNITS, suggestPrice, printQuote } from '../pricing.js';
import { CONTRACT_OPTIONS, aiContract, templateContract } from '../contracts.js';
import { agencyProfile } from '../agency.js';

let search = '';

export function renderProjects() {
  const show = db.kvGet('projFilter', 'aktywne');
  const q = search.trim().toLowerCase();
  let ps = db.all('projects').filter((p) => (show === 'aktywne' ? p.stage !== 'zakonczony' : p.stage === 'zakonczony'));
  if (q) {
    ps = ps.filter((p) => [p.title, db.get('contacts', p.clientId)?.name, p.description].join(' ').toLowerCase().includes(q));
  }
  ps.sort((a, b) => (a.due || '9').localeCompare(b.due || '9'));

  const searchBox = h('label', { class: 'search' }, icon('search', 18),
    h('input', { type: 'search', placeholder: 'Szukaj projektu lub klienta', value: search, 'aria-label': 'Szukaj projektów',
      oninput: (e) => { search = e.target.value; window.dispatchEvent(new CustomEvent('rerender', { detail: { keepFocus: 'proj-search' } })); },
      id: 'proj-search' }));

  const seg = h('div', { class: 'seg' }, [['aktywne', 'W toku'], ['zakonczone', 'Zakończone']].map(([k, l]) =>
    h('button', { class: `seg-btn ${show === k ? 'on' : ''}`, onclick: () => db.kvSet('projFilter', k).then(() => window.dispatchEvent(new Event('rerender'))) }, l)));

  let content;
  if (!ps.length) {
    content = emptyState(q ? 'Brak wyników.' : show === 'aktywne' ? 'Nie ma jeszcze projektów w toku.' : 'Brak zakończonych projektów.',
      show === 'aktywne' && !q ? 'Nowy projekt' : null, () => editProject(), 'projects');
  } else {
    content = h('div', null,
      h('div', { class: 'cards only-narrow' }, ps.map(projectCard)),
      show === 'aktywne' ? kanban(ps) : h('div', { class: 'cards only-wide' }, ps.map(projectCard)));
  }

  return {
    title: 'Projekty',
    action: h('button', { class: 'btn btn-primary btn-sm', onclick: () => editProject() }, icon('plus', 16), 'Nowy'),
    node: h('div', { class: 'page' }, h('div', { class: 'toolbar' }, searchBox, seg), content),
  };
}

function projectCard(p) {
  const client = db.get('contacts', p.clientId);
  const pct = M.projectProgress(p);
  const open = db.all('tasks').filter((t) => t.projectId === p.id && !t.done).length;
  const late = p.due && p.due < todayStr() && p.stage !== 'zakonczony';
  return h('button', { class: 'card pcard-full', draggable: 'true', dataset: { id: p.id },
    ondragstart: (e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; },
    onclick: () => navigate(`projekt/${p.id}`) },
  h('div', { class: 'card-top' }, h('span', { class: `stage-pill stage-${p.stage}` }, M.stageLabel(p.stage)), ownerBadge(p.owner)),
  h('div', { class: 'card-title' }, p.title),
  h('div', { class: 'card-sub' }, client ? client.name : 'Bez klienta', p.type ? ` · ${M.PROJECT_TYPES.find((t) => t[0] === p.type)?.[1] || ''}` : ''),
  progressBar(pct),
  h('div', { class: 'card-foot' },
    h('span', { class: late ? 'overdue' : '' }, icon('calendar', 14), p.due ? relDay(p.due) : 'Bez terminu'),
    h('span', null, `${pct}% · ${open} otw.`)));
}

function kanban(ps) {
  const cols = M.STAGES.filter(([k]) => k !== 'zakonczony');
  return h('div', { class: 'kanban only-wide' }, cols.map(([k, label]) => {
    const items = ps.filter((p) => (p.stage || 'plan') === k);
    const col = h('div', { class: 'kcol', dataset: { stage: k },
      ondragover: (e) => { e.preventDefault(); col.classList.add('drop'); },
      ondragleave: () => col.classList.remove('drop'),
      ondrop: async (e) => {
        e.preventDefault(); col.classList.remove('drop');
        const id = e.dataTransfer.getData('text/plain');
        const p = db.get('projects', id);
        if (p && p.stage !== k) {
          await db.put('projects', { id, stage: k });
          db.logActivity(`przeniósł(a) „${p.title}” do etapu: ${label}`, { col: 'projects', id });
        }
      } },
    h('div', { class: 'kcol-head' }, label, h('span', { class: 'count' }, items.length)),
    items.map(projectCard),
    !items.length ? h('div', { class: 'kcol-empty' }, 'Przeciągnij tutaj') : null);
    return col;
  }), h('p', { class: 'hint-line kanban-hint' }, 'Przeciągnij kartę, aby zmienić etap projektu.'));
}

// ---------- Project detail (tabs: overview · tasks · pricing · files · documents) ----------
const TABS = [['przeglad', 'Przegląd'], ['zadania', 'Zadania'], ['wycena', 'Wycena'], ['pliki', 'Pliki'], ['dokumenty', 'Dokumenty']];

export function renderProject(id, query) {
  const p = db.get('projects', id);
  if (!p) return { title: 'Projekt', back: 'projekty', node: emptyState('Ten projekt nie istnieje lub został usunięty.', 'Wróć do projektów', () => navigate('projekty'), 'projects') };
  const tab = TABS.some(([k]) => k === query?.get('tab')) ? query.get('tab') : 'przeglad';
  const client = db.get('contacts', p.clientId);
  const tasks = db.all('tasks').filter((t) => t.projectId === p.id).sort(M.sortTasks);
  const files = db.all('files').filter((f) => f.projectId === p.id);
  const docs = db.all('docs').filter((d) => d.projectId === p.id);
  const pct = M.projectProgress(p);
  const counts = { zadania: tasks.filter((t) => !t.done).length, pliki: files.length + (p.canva || []).length, dokumenty: docs.length };

  const header = h('div', { class: 'detail-head proj-head' },
    h('div', { class: 'detail-kicker' }, client ? client.name : 'Projekt', ' · ', M.stageLabel(p.stage)),
    h('h1', { class: 'detail-title' }, p.title),
    h('div', { class: 'detail-progress' }, progressBar(pct), h('span', null, `${pct}%`)));

  const tabsEl = h('div', { class: 'tabs', role: 'tablist' }, TABS.map(([k, label]) => h('button', {
    class: `tab ${k === tab ? 'on' : ''}`, role: 'tab', 'aria-selected': k === tab,
    onclick: () => navigate(`projekt/${p.id}?tab=${k}`, { replace: true }),
  }, label, counts[k] ? h('span', { class: 'count' }, counts[k]) : null)));

  let body;
  if (tab === 'zadania') body = tasksTab(p, tasks);
  else if (tab === 'wycena') body = pricingTab(p);
  else if (tab === 'pliki') body = filesTab(p, files);
  else if (tab === 'dokumenty') body = docsTab(p, docs);
  else body = overviewTab(p, client, tasks);

  return {
    title: p.title,
    back: 'projekty',
    action: h('div', { class: 'head-actions' },
      h('button', { class: 'icon-btn', 'aria-label': 'Edytuj projekt', onclick: () => editProject(p) }, icon('edit')),
      h('button', { class: 'icon-btn', 'aria-label': 'Usuń projekt', onclick: async () => {
        if (await confirmDialog(`Usunąć projekt „${p.title}”? Zadania projektu zostaną odłączone, ale nie usunięte.`, { ok: 'Usuń', danger: true })) {
          for (const t of tasks) await db.put('tasks', { id: t.id, projectId: '' }, { silent: true });
          await db.remove('projects', p.id);
          navigate('projekty', { replace: true });
          toast('Projekt usunięty');
        }
      } }, icon('trash'))),
    node: h('div', { class: 'page page-detail page-project' }, header, tabsEl, h('div', { class: 'tab-body' }, body)),
  };
}

function overviewTab(p, client, tasks) {
  const si = M.stageIndex(p.stage);
  const stepper = h('div', { class: 'stepper', role: 'list' }, M.STAGES.map(([k, label], i) => h('button', {
    class: `step ${i < si ? 'past' : ''} ${i === si ? 'now' : ''}`, role: 'listitem', 'aria-current': i === si ? 'step' : null,
    onclick: async () => {
      if (k === p.stage) return;
      await db.put('projects', { id: p.id, stage: k });
      db.logActivity(`zmienił(a) etap „${p.title}” na: ${label}`, { col: 'projects', id: p.id });
      toast(`Etap: ${label}`);
    },
  }, h('span', { class: 'step-dot' }, i < si ? icon('check', 12) : null), h('span', { class: 'step-label' }, label))));
  const next = tasks.filter((t) => !t.done).slice(0, 3);
  const pr = pricingOf(p);
  const tot = totals(pr);
  const infl = (p.influencerIds || []).map((i) => db.get('contacts', i)).filter(Boolean);
  return h('div', { class: 'two-col' },
    h('div', { class: 'col' },
      section('Etap', stepper),
      section('Najbliższe zadania', next.length ? h('div', { class: 'list' }, next.map((t) => taskRow(t, { showDate: true, showProject: false })))
        : h('p', { class: 'muted pad' }, 'Brak otwartych zadań.'),
      h('button', { class: 'link-btn', onclick: () => navigate(`projekt/${p.id}?tab=zadania`, { replace: true }) }, 'Wszystkie zadania', icon('chevron', 16))),
      p.description ? section('Opis i brief', h('div', { class: 'prose' }, p.description)) : null),
    h('div', { class: 'col' },
      section('Szczegóły', h('dl', { class: 'facts' },
        fact('Klient', client ? h('a', { href: `#/kontakt/${client.id}` }, client.name) : '—'),
        fact('Prowadzi', M.ownerLabel(p.owner) || '—'),
        fact('Rodzaj', M.PROJECT_TYPES.find((t) => t[0] === p.type)?.[1] || '—'),
        fact('Termin', p.due ? `${fullDate(p.due)} (${relDay(p.due).toLowerCase()})` : '—'),
        fact('Wycena', pr.items.length ? h('a', { href: `#/projekt/${p.id}?tab=wycena` }, `${pln(tot.net)} netto`) : (p.budget || '—')),
        p.goal ? fact('Cel / KPI', p.goal) : null)),
      section(`Influencerzy (${infl.length})`,
        infl.length ? h('div', { class: 'list' }, infl.map((c) => h('div', { class: 'list-row-wrap' }, contactRow(c),
          h('button', { class: 'icon-btn', 'aria-label': `Odłącz ${c.name}`, onclick: async () => {
            await db.put('projects', { id: p.id, influencerIds: (p.influencerIds || []).filter((x) => x !== c.id) });
          } }, icon('close', 18)))))
          : h('p', { class: 'muted pad' }, 'Nie przypisano influencerów.'),
        h('button', { class: 'link-btn', onclick: () => pickInfluencer(p) }, icon('plus', 16), 'Przypisz'))));
}

function tasksTab(p, tasks) {
  return h('div', { class: 'col narrow-col' },
    h('div', { class: 'row-gap' },
      h('button', { class: 'btn btn-primary btn-sm', onclick: () => editTask(null, { projectId: p.id, contactId: p.clientId || '' }) }, icon('plus', 16), 'Nowe zadanie')),
    tasks.length ? h('div', { class: 'list' }, tasks.map((t) => taskRow(t, { showDate: true, showProject: false })))
      : emptyState('Brak zadań w tym projekcie.', null, null, 'check'));
}

// ---------- pricing ----------
function pricingTab(p) {
  const pr = pricingOf(p);
  const wrap = h('div', { class: 'pricing', dataset: { keep: '1' } });
  const totalsEl = h('div', { class: 'price-totals' });
  let saveTimer = null;
  const save = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => db.put('projects', { id: p.id, pricing: pr }), 500); };
  const drawTotals = () => {
    const t = totals(pr);
    clear(totalsEl).append(
      tot('Suma pozycji', pln(t.sub)),
      pr.discount ? tot(`Rabat ${pr.discount}%`, `−${pln(t.discount)}`) : null,
      tot('Razem netto', pln(t.net), 'strong'),
      tot(`VAT ${pr.vat}%`, pln(t.vat)),
      tot('Razem brutto', pln(t.gross), 'grand'));
  };
  const tot = (k, v, cls = '') => h('div', { class: `tot-row ${cls}` }, h('span', null, k), h('span', null, v));
  const list = h('div', { class: 'price-items' });
  const drawItems = () => {
    clear(list);
    if (!pr.items.length) list.append(h('p', { class: 'muted pad' }, 'Brak pozycji. Dodaj je ręcznie albo poproś AI o propozycję.'));
    pr.items.forEach((it) => {
      const lineTotal = h('span', { class: 'line-total' }, pln(it.qty * it.price));
      const upd = (k, v) => { it[k] = v; lineTotal.textContent = pln((Number(it.qty) || 0) * (Number(it.price) || 0)); drawTotals(); save(); };
      list.append(h('div', { class: 'price-item' },
        h('div', { class: 'pi-top' },
          h('input', { class: 'pi-name', type: 'text', value: it.name, placeholder: 'Nazwa pozycji', 'aria-label': 'Nazwa pozycji', oninput: (e) => upd('name', e.target.value) }),
          h('button', { class: 'icon-btn', 'aria-label': 'Usuń pozycję', onclick: () => { pr.items = pr.items.filter((x) => x !== it); drawItems(); drawTotals(); save(); } }, icon('trash', 18))),
        h('div', { class: 'pi-row' },
          h('input', { class: 'pi-qty', type: 'number', inputmode: 'decimal', step: 'any', value: it.qty, 'aria-label': 'Ilość', oninput: (e) => upd('qty', Number(e.target.value.replace(',', '.')) || 0) }),
          h('select', { class: 'pi-unit', 'aria-label': 'Jednostka', onchange: (e) => upd('unit', e.target.value) }, [...new Set([...UNITS, it.unit])].map((u) => h('option', { value: u, selected: u === it.unit }, u))),
          h('span', { class: 'pi-x' }, '×'),
          h('input', { class: 'pi-price', type: 'number', inputmode: 'decimal', step: 'any', value: it.price, 'aria-label': 'Cena netto (zł)', oninput: (e) => upd('price', Number(e.target.value.replace(',', '.')) || 0) }),
          h('span', { class: 'pi-cur' }, 'zł'),
          lineTotal),
        it.note ? h('div', { class: 'pi-note' }, it.note) : null));
    });
  };
  drawItems();
  drawTotals();
  const settings = h('div', { class: 'pi-settings' },
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Rabat (%)'),
      h('input', { type: 'number', inputmode: 'decimal', value: pr.discount || 0, oninput: (e) => { pr.discount = Number(e.target.value) || 0; drawTotals(); save(); } })),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'VAT (%)'),
      h('input', { type: 'number', inputmode: 'decimal', value: pr.vat, oninput: (e) => { pr.vat = Number(e.target.value) || 0; drawTotals(); save(); } })),
    h('label', { class: 'field field-full' }, h('span', { class: 'field-label' }, 'Uwagi do oferty'),
      h('textarea', { rows: 2, oninput: (e) => { pr.notes = e.target.value; save(); } }, pr.notes || '')));
  const aiBox = h('div');
  wrap.append(
    h('div', { class: 'row-gap' },
      h('button', { class: 'btn btn-soft btn-sm', onclick: () => { pr.items.push(newItem()); drawItems(); drawTotals(); save(); list.lastElementChild?.querySelector('input')?.focus(); } }, icon('plus', 16), 'Pozycja'),
      h('button', { class: 'btn btn-soft btn-sm', onclick: () => suggest() }, icon('ai', 16), 'Zaproponuj cenę (AI)'),
      h('button', { class: 'btn btn-soft btn-sm', disabled: !pr.items.length, onclick: () => { if (!printQuote({ ...p, pricing: pr })) toast('Zezwól na wyskakujące okna, aby wydrukować.'); } }, icon('print', 16), 'Oferta PDF')),
    aiBox,
    h('div', { class: 'card pad-card' }, list),
    h('div', { class: 'two-col pricing-bottom' }, h('div', { class: 'card pad-card' }, settings), h('div', { class: 'card pad-card' }, totalsEl)));

  async function suggest() {
    if (!ai.available()) { toast('AI działa po połączeniu z serwerem agencji (Ustawienia).'); return; }
    clear(aiBox).append(h('div', { class: 'notice' }, h('span', { class: 'spinner' }), 'AI przygotowuje propozycję wyceny…'));
    try {
      const r = await suggestPrice(p);
      const net = r.items.reduce((s, i) => s + i.qty * i.unit_price, 0);
      clear(aiBox).append(h('div', { class: 'card pad-card ai-proposal' },
        h('div', { class: 'section-head' }, h('h3', null, 'Propozycja AI'), h('strong', null, `${pln(net)} netto`)),
        h('p', null, r.summary),
        h('p', { class: 'small muted' }, `Zakres rynkowy: ${pln(r.range_low)} – ${pln(r.range_high)} netto`),
        h('ul', { class: 'ai-items' }, r.items.map((i) => h('li', null, `${i.name} – ${i.qty} ${i.unit} × ${pln(i.unit_price)}`, i.note ? h('div', { class: 'small muted' }, i.note) : null))),
        r.assumptions?.length ? h('details', null, h('summary', null, 'Założenia'), h('ul', null, r.assumptions.map((a) => h('li', { class: 'small' }, a)))) : null,
        h('p', { class: 'hint-line' }, 'To szacunek AI – sprawdź i dopasuj ceny przed wysłaniem oferty.'),
        h('div', { class: 'row-gap' },
          h('button', { class: 'btn btn-primary btn-sm', onclick: () => {
            pr.items = r.items.map((i) => newItem({ name: i.name, qty: i.qty, unit: i.unit, price: Math.round(i.unit_price), note: i.note }));
            if (r.assumptions?.length && !pr.notes) pr.notes = `Założenia: ${r.assumptions.join('; ')}`;
            drawItems(); drawTotals(); save(); clear(aiBox); toast('Wstawiono propozycję – możesz ją edytować');
          } }, 'Zastosuj (zastąp pozycje)'),
          h('button', { class: 'btn btn-ghost btn-sm', onclick: () => clear(aiBox) }, 'Odrzuć'))));
    } catch (e) { clear(aiBox).append(h('div', { class: 'notice' }, icon('ai', 20), e.message)); }
  }
  return wrap;
}

// ---------- files & Canva ----------
function filesTab(p, files) {
  const links = { projectId: p.id, clientId: p.clientId || '' };
  const canvaOn = !!cloud.connections().canva?.connected;
  const canvaItems = p.canva || [];
  return h('div', { class: 'col' },
    h('div', { class: 'upload-bar upload-bar-4' },
      h('button', { class: 'upload-btn', onclick: () => uploadFlow({ camera: true, links }) }, icon('camera', 24), h('span', null, 'Zdjęcie')),
      h('button', { class: 'upload-btn', onclick: () => uploadFlow({ links }) }, icon('upload', 24), h('span', null, 'Plik')),
      h('button', { class: 'upload-btn', onclick: () => canvaImport(p) }, canvaMark(), h('span', null, 'Z Canvy')),
      h('button', { class: 'upload-btn', onclick: () => canvaCreate(p) }, icon('plus', 24), h('span', null, 'Nowy w Canvie'))),
    canvaItems.length ? section('Projekty w Canvie', h('div', { class: 'list' }, canvaItems.map((d) => h('div', { class: 'list-row canva-row' },
      h('span', { class: 'row-ic canva-ic' }, canvaMark(22)),
      h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, d.title || 'Projekt Canva'), h('div', { class: 'row-meta' }, d.id ? 'połączony z Canvą' : 'link')),
      h('div', { class: 'canva-row-btns' },
        h('a', { class: 'btn btn-soft btn-sm', href: d.edit_url || d.url, target: '_blank', rel: 'noopener' }, 'Edytuj w Canvie'),
        canvaOn && d.id ? h('button', { class: 'btn btn-ghost btn-sm', onclick: () => importDesign(p, d) }, icon('download', 16), 'Importuj') : null,
        h('button', { class: 'icon-btn', 'aria-label': 'Usuń link', onclick: async () => { await db.put('projects', { id: p.id, canva: canvaItems.filter((x) => x !== d) }); } }, icon('close', 18))))))) : null,
    section('Pliki i zdjęcia', files.length ? filesGrid(files.sort((a, b) => b.createdAt.localeCompare(a.createdAt))) : emptyState('Brak plików. Dodaj zdjęcia, briefy, umowy lub projekty z Canvy.', null, null, 'files')));
}

function canvaMark(size = 24) {
  return h('span', { class: 'canva-mark', style: { width: `${size}px`, height: `${size}px`, fontSize: `${Math.round(size * 0.55)}px` }, 'aria-hidden': 'true' }, 'C');
}

async function addCanvaLink(p, entry) {
  const cur = db.get('projects', p.id)?.canva || [];
  if (cur.some((x) => (entry.id && x.id === entry.id) || (entry.url && x.url === entry.url))) return;
  await db.put('projects', { id: p.id, canva: [...cur, { ...entry, added: new Date().toISOString() }] });
}

async function importDesign(p, d, format = 'png') {
  toast('Importowanie z Canvy…', { timeout: 2500 });
  try {
    const r = await cloud.fn('canva', 'export', { design_id: d.id, format });
    const bin = Uint8Array.from(atob(r.data), (c) => c.charCodeAt(0));
    const name = `${(d.title || 'canva').replace(/[^\w\-ąćęłńóśźżĄĆĘŁŃÓŚŹŻ ]+/g, '').trim() || 'canva'}.${r.ext}`;
    const existing = db.all('files').find((f) => f.canvaId === d.id && f.projectId === p.id && f.mime === r.mime);
    const rec = await saveFile(new File([bin], name, { type: r.mime }), {
      projectId: p.id, clientId: p.clientId || '', caption: d.title || 'Canva', canvaId: d.id, canvaUrl: d.edit_url || d.view_url || '',
    });
    if (existing) await db.remove('files', existing.id);
    await addCanvaLink(p, { id: d.id, title: d.title, edit_url: d.edit_url, view_url: d.view_url });
    toast(existing ? 'Zaktualizowano z Canvy' : `Zaimportowano${r.pages > 1 ? ` (strona 1 z ${r.pages})` : ''}`);
    return rec;
  } catch (e) { toast(e.message); return null; }
}

function canvaImport(p) {
  const canvaOn = !!cloud.connections().canva?.connected;
  if (!canvaOn) {
    const url = h('input', { type: 'url', placeholder: 'https://www.canva.com/design/…', 'aria-label': 'Link do projektu Canva' });
    const s = openSheet({
      title: 'Canva',
      body: [
        h('p', null, 'Dołącz projekt z Canvy do tego projektu:'),
        h('ol', { class: 'steps' },
          h('li', null, 'W Canvie: Udostępnij → Kopiuj link – i wklej go poniżej (otworzysz go jednym stuknięciem do edycji).'),
          h('li', null, 'Aby mieć grafikę w aplikacji: w Canvie Udostępnij → Pobierz (PNG/PDF) → Zachowaj w Plikach, a potem tutaj „Plik”.')),
        h('label', { class: 'field field-full' }, h('span', { class: 'field-label' }, 'Link do projektu Canva'), url),
        cloud.isLinked() ? h('p', { class: 'hint-line' }, 'Możesz też połączyć konto Canva (Ustawienia → Integracje), aby przeglądać i importować projekty bezpośrednio.') : null,
      ],
      footer: [
        cloud.isLinked() ? h('button', { class: 'btn btn-ghost', onclick: async () => { s.close(); (await import('./team.js')).connectProviderSheet('canva'); } }, 'Połącz Canvę') : h('a', { class: 'btn btn-ghost', href: 'https://www.canva.com/', target: '_blank', rel: 'noopener' }, 'Otwórz Canvę'),
        h('button', { class: 'btn btn-primary', onclick: async () => {
          const v = url.value.trim();
          if (!/^https:\/\/(www\.)?canva\.(com|link)\//i.test(v)) { toast('Wklej link z canva.com'); return; }
          await addCanvaLink(p, { url: v, title: 'Projekt Canva' });
          s.close(); toast('Dodano link do Canvy');
        } }, 'Dodaj link'),
      ],
    });
    return;
  }
  const grid = h('div', { class: 'canva-grid' });
  const q = h('input', { type: 'search', placeholder: 'Szukaj w Canvie', 'aria-label': 'Szukaj projektów w Canvie' });
  let cont = null;
  const more = h('button', { class: 'btn btn-ghost btn-sm', hidden: true, onclick: () => load(false) }, 'Więcej');
  async function load(reset = true) {
    if (reset) { clear(grid).append(h('p', { class: 'muted pad' }, 'Wczytywanie…')); cont = null; }
    try {
      const r = await cloud.fn('canva', 'designs', { query: q.value.trim() || undefined, continuation: reset ? undefined : cont });
      if (reset) clear(grid);
      if (!r.items.length && reset) grid.append(h('p', { class: 'muted pad' }, 'Brak projektów.'));
      for (const d of r.items) {
        grid.append(h('div', { class: 'canva-card' },
          d.thumbnail ? h('img', { src: d.thumbnail, alt: '', loading: 'lazy' }) : h('div', { class: 'canva-noimg' }, canvaMark(28)),
          h('div', { class: 'canva-title' }, d.title),
          h('div', { class: 'canva-actions' },
            h('button', { class: 'btn btn-primary btn-sm', onclick: async () => { s.close(); await importDesign(p, d, 'png'); } }, 'PNG'),
            h('button', { class: 'btn btn-soft btn-sm', onclick: async () => { s.close(); await importDesign(p, d, 'pdf'); } }, 'PDF'),
            h('button', { class: 'btn btn-ghost btn-sm', onclick: async () => { await addCanvaLink(p, d); toast('Dołączono link'); } }, 'Link'))));
      }
      cont = r.continuation; more.hidden = !cont;
    } catch (e) { clear(grid).append(h('p', { class: 'muted pad' }, e.message)); }
  }
  let t = null;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => load(true), 400); });
  const s = openSheet({ title: 'Projekty z Canvy', wide: true, body: [q, grid, more] });
  load(true);
}

const CANVA_FORMATS = [
  ['Post Instagram 4:5', 1080, 1350], ['Post Instagram 1:1', 1080, 1080], ['Relacja / Reels 9:16', 1080, 1920],
  ['Prezentacja 16:9', 1920, 1080], ['Dokument A4', 2480, 3508],
];

function canvaCreate(p) {
  if (!cloud.connections().canva?.connected) {
    const s = openSheet({
      title: 'Nowy projekt w Canvie',
      body: [
        h('p', null, 'Otwórz Canvę (aplikację lub stronę), utwórz projekt, a potem wklej jego link w „Z Canvy”, żeby był pod ręką w tym projekcie.'),
        h('a', { class: 'btn btn-primary btn-block', href: 'https://www.canva.com/', target: '_blank', rel: 'noopener', onclick: () => s.close() }, 'Otwórz Canvę'),
      ],
    });
    return;
  }
  const out = h('div');
  const s = openSheet({
    title: 'Nowy projekt w Canvie',
    body: [h('div', { class: 'list' }, CANVA_FORMATS.map(([label, w, hh]) => h('button', { class: 'list-row', onclick: async (e) => {
      e.currentTarget.disabled = true;
      try {
        const d = await cloud.fn('canva', 'create', { title: `${p.title} – ${label}`, width: w, height: hh });
        await addCanvaLink(p, d);
        clear(out).append(h('a', { class: 'btn btn-primary btn-block', href: d.edit_url, target: '_blank', rel: 'noopener', onclick: () => s.close() }, 'Otwórz w Canvie i edytuj'),
          h('p', { class: 'hint-line' }, 'Po zakończeniu edycji wróć tutaj i stuknij „Importuj” przy projekcie, aby pobrać aktualną wersję.'));
      } catch (err) { toast(err.message); e.currentTarget.disabled = false; }
    } }, h('span', { class: 'row-ic' }, icon('image', 20)), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, label), h('div', { class: 'row-meta' }, `${w} × ${hh} px`))))), out],
  });
}

// ---------- documents & contracts ----------
function docsTab(p, docs) {
  return h('div', { class: 'col narrow-col' },
    h('div', { class: 'row-gap' },
      h('button', { class: 'btn btn-primary btn-sm', onclick: () => navigate(`asystent/pismo?projekt=${p.id}`) }, icon('doc', 16), 'Napisz pismo'),
      h('button', { class: 'btn btn-soft btn-sm', onclick: () => contractSheet(p) }, icon('file', 16), 'Umowa')),
    docs.length ? h('div', { class: 'list' }, docs.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map((d) => h('button', { class: 'list-row', onclick: () => navigate(`dokument/${d.id}`) },
      h('span', { class: 'row-ic' }, icon(d.kind === 'contract' ? 'file' : d.kind === 'email' ? 'mail' : 'doc', 20)),
      h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, d.title), h('div', { class: 'row-meta' }, `${d.kind === 'contract' ? 'Umowa · ' : ''}${relDay(d.updatedAt.slice(0, 10))}`)),
      icon('chevron', 18, 'muted'))))
      : emptyState('Brak dokumentów. Napisz pismo albo wygeneruj umowę dla tego projektu.', null, null, 'doc'));
}

function contractSheet(p) {
  const form = buildForm(CONTRACT_OPTIONS, { type: p.type === 'strategia' ? 'uslugi' : 'uslugi', rights: 'przeniesienie', confidential: 'tak', penalties: 'nie', payDays: agencyProfile().paymentDays || 14 });
  const client = db.get('contacts', p.clientId);
  const missing = [
    !agencyProfile().nip ? 'dane agencji (Ustawienia → Dane agencji)' : null,
    !client ? 'klient projektu' : (!client.nip || !client.address) ? 'NIP i adres klienta (edytuj klienta)' : null,
    !(p.pricing?.items?.length) ? 'wycena (zakładka Wycena)' : null,
  ].filter(Boolean);
  const status = h('div');
  const s = openSheet({
    title: 'Umowa do projektu',
    body: [
      missing.length ? h('div', { class: 'notice small' }, icon('flag', 18), h('div', null, 'Brakujące dane zostaną oznaczone jako [uzupełnij]: ', missing.join(', '), '.')) : null,
      form.el, status,
      h('p', { class: 'hint-line' }, 'Projekt umowy – przed podpisaniem sprawdźcie go (najlepiej z prawnikiem).'),
    ],
    footer: [
      h('button', { class: 'btn btn-ghost', onclick: () => make(false) }, 'Z szablonu'),
      h('button', { class: 'btn btn-primary', onclick: () => make(true) }, icon('ai', 16), 'Napisz z AI'),
    ],
  });
  async function make(useAI) {
    const opts = form.read();
    let body;
    if (useAI) {
      if (!ai.available()) { toast('AI działa po połączeniu z serwerem agencji – użyj szablonu.'); return; }
      clear(status).append(h('div', { class: 'notice' }, h('span', { class: 'spinner' }), 'AI pisze umowę… (to może potrwać do minuty)'));
      try { body = await aiContract(p, opts); } catch (e) { clear(status).append(h('div', { class: 'notice' }, e.message)); return; }
    } else body = templateContract(p, opts);
    const d = await db.put('docs', { title: `Umowa – ${p.title}`, body, kind: 'contract', projectId: p.id, contactId: p.clientId || '' });
    db.logActivity(`przygotował(a) umowę: ${p.title}`, { col: 'docs', id: d.id });
    s.close();
    navigate(`dokument/${d.id}`);
  }
}

function fact(k, v) { return [h('dt', null, k), h('dd', null, v)]; }

async function pickInfluencer(p) {
  const all = db.all('contacts').filter((c) => c.kind === 'influencer' && !(p.influencerIds || []).includes(c.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'pl'));
  const s = openSheet({
    title: 'Przypisz influencera',
    body: all.length ? h('div', { class: 'list' }, all.map((c) => h('button', { class: 'list-row', onclick: async () => {
      await db.put('projects', { id: p.id, influencerIds: [...(p.influencerIds || []), c.id] });
      s.close(); toast(`Przypisano: ${c.name}`);
    } }, avatar(c.name, { kind: 'influencer' }), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, c.name), h('div', { class: 'row-meta' }, M.contactSubtitle(c))))))
      : emptyState('Brak influencerów do przypisania.', 'Dodaj influencera', async () => { s.close(); (await import('../components.js')).editContact(null, 'influencer'); }, 'contacts'),
  });
}
