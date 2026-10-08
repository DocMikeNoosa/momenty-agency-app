import * as db from '../db.js';
import * as M from '../model.js';
import { h, icon, relDay, fullDate, emptyState, confirmDialog, toast, todayStr } from '../ui.js';
import {
  progressBar, ownerBadge, editProject, editTask, taskRow, section, filesGrid, uploadFlow, avatar, contactRow,
} from '../components.js';
import { navigate } from '../router.js';

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

// ---------- Project detail ----------
export function renderProject(id) {
  const p = db.get('projects', id);
  if (!p) return { title: 'Projekt', back: 'projekty', node: emptyState('Ten projekt nie istnieje lub został usunięty.', 'Wróć do projektów', () => navigate('projekty'), 'projects') };
  const client = db.get('contacts', p.clientId);
  const tasks = db.all('tasks').filter((t) => t.projectId === p.id).sort(M.sortTasks);
  const files = db.all('files').filter((f) => f.projectId === p.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const docs = db.all('docs').filter((d) => d.projectId === p.id);
  const infl = (p.influencerIds || []).map((i) => db.get('contacts', i)).filter(Boolean);
  const pct = M.projectProgress(p);
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

  const facts = h('dl', { class: 'facts' },
    fact('Klient', client ? h('a', { href: `#/kontakt/${client.id}` }, client.name) : '—'),
    fact('Prowadzi', M.ownerLabel(p.owner) || '—'),
    fact('Rodzaj', M.PROJECT_TYPES.find((t) => t[0] === p.type)?.[1] || '—'),
    fact('Start', p.start ? fullDate(p.start) : '—'),
    fact('Termin', p.due ? `${fullDate(p.due)} (${relDay(p.due).toLowerCase()})` : '—'),
    p.budget ? fact('Budżet', p.budget) : null,
    p.goal ? fact('Cel / KPI', p.goal) : null);

  const header = h('div', { class: 'detail-head' },
    h('div', { class: 'detail-kicker' }, client ? client.name : 'Projekt'),
    h('h1', { class: 'detail-title' }, p.title),
    h('div', { class: 'detail-progress' }, progressBar(pct), h('span', null, `${pct}%`)),
    stepper);

  const addInfl = () => pickInfluencer(p);

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
    node: h('div', { class: 'page page-detail' },
      header,
      h('div', { class: 'two-col' },
        h('div', { class: 'col' },
          section(`Zadania (${tasks.filter((t) => !t.done).length} otwartych)`,
            tasks.length ? h('div', { class: 'list' }, tasks.map((t) => taskRow(t, { showDate: true, showProject: false })))
              : h('p', { class: 'muted pad' }, 'Brak zadań w tym projekcie.'),
            h('button', { class: 'link-btn', onclick: () => editTask(null, { projectId: p.id, contactId: p.clientId || '' }) }, icon('plus', 16), 'Dodaj')),
          p.description ? section('Opis i brief', h('div', { class: 'prose' }, p.description)) : null,
          section('Pliki i zdjęcia', files.length ? filesGrid(files) : h('p', { class: 'muted pad' }, 'Brak plików.'),
            h('div', { class: 'row-gap' },
              h('button', { class: 'link-btn', onclick: () => uploadFlow({ camera: true, links: { projectId: p.id, clientId: p.clientId || '' } }) }, icon('camera', 16), 'Zdjęcie'),
              h('button', { class: 'link-btn', onclick: () => uploadFlow({ links: { projectId: p.id, clientId: p.clientId || '' } }) }, icon('upload', 16), 'Plik')))),
        h('div', { class: 'col' },
          section('Szczegóły', facts),
          section(`Influencerzy (${infl.length})`,
            infl.length ? h('div', { class: 'list' }, infl.map((c) => h('div', { class: 'list-row-wrap' }, contactRow(c),
              h('button', { class: 'icon-btn', 'aria-label': `Odłącz ${c.name}`, onclick: async () => {
                await db.put('projects', { id: p.id, influencerIds: (p.influencerIds || []).filter((x) => x !== c.id) });
              } }, icon('close', 18)))))
              : h('p', { class: 'muted pad' }, 'Nie przypisano influencerów.'),
            h('button', { class: 'link-btn', onclick: addInfl }, icon('plus', 16), 'Przypisz')),
          section('Dokumenty', docs.length ? h('div', { class: 'list' }, docs.map((d) => h('button', { class: 'list-row', onclick: () => navigate(`dokument/${d.id}`) },
            h('span', { class: 'row-ic' }, icon('doc', 20)), h('div', { class: 'row-main' }, h('div', { class: 'row-title' }, d.title), h('div', { class: 'row-meta' }, relDay(d.updatedAt.slice(0, 10)))))))
            : h('p', { class: 'muted pad' }, 'Brak dokumentów.'),
          h('button', { class: 'link-btn', onclick: () => navigate(`asystent/pismo?projekt=${p.id}`) }, icon('ai', 16), 'Napisz pismo')))),
    ),
  };
}

function fact(k, v) { return [h('dt', null, k), h('dd', null, v)]; }

async function pickInfluencer(p) {
  const { openSheet } = await import('../ui.js');
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
