import * as db from '../db.js';
import * as M from '../model.js';
import { h, icon, todayStr, addDays, longDay, relDay, plural, timeAgo, emptyState } from '../ui.js';
import { taskRow, editTask, progressBar, section, ownerBadge } from '../components.js';
import { navigate } from '../router.js';

function greeting() {
  const hr = new Date().getHours();
  if (hr < 5) return 'Dobranoc';
  if (hr < 18) return 'Dzień dobry';
  return 'Dobry wieczór';
}

export function renderToday() {
  const today = todayStr();
  const filter = db.kvGet('todayFilter', 'me');
  const tasks = db.all('tasks').filter((t) => M.visibleFor(t, filter));
  const open = tasks.filter((t) => !t.done);
  const overdue = open.filter((t) => t.due && t.due < today).sort(M.sortTasks);
  const todays = tasks.filter((t) => t.due === today && (!t.done || (t.doneAt && t.doneAt.slice(0, 10) === today))).sort(M.sortTasks);
  const weekEnd = addDays(today, 7);
  const upcoming = open.filter((t) => t.due && t.due > today && t.due <= weekEnd).sort(M.sortTasks);
  const undated = open.filter((t) => !t.due).sort(M.sortTasks);
  const meName = M.partnerName(M.me());
  const doneToday = todays.filter((t) => t.done).length;

  const pubs = db.all('tasks').filter((t) => !t.done && t.kind === 'publikacja' && t.due >= today && t.due <= weekEnd).length;
  const summary = [
    plural(todays.length - doneToday, 'zadanie na dziś', 'zadania na dziś', 'zadań na dziś'),
    overdue.length ? plural(overdue.length, 'zaległe', 'zaległe', 'zaległych') : null,
    pubs ? plural(pubs, 'publikacja w tym tygodniu', 'publikacje w tym tygodniu', 'publikacji w tym tygodniu') : null,
  ].filter(Boolean).join(' · ');

  const hero = h('div', { class: 'hero' },
    h('div', { class: 'hero-date' }, longDay(today)),
    h('h1', { class: 'hero-title' }, `${greeting()}, `, h('em', null, meName.split(' ')[0])),
    h('p', { class: 'hero-sub' }, summary),
    todays.length ? h('div', { class: 'hero-progress' }, progressBar(Math.round((doneToday / todays.length) * 100)),
      h('span', null, `${doneToday}/${todays.length} gotowe`)) : null);

  const other = M.otherPartner();
  const seg = h('div', { class: 'seg', role: 'tablist', 'aria-label': 'Czyje zadania' },
    [['me', 'Moje'], [other?.id, other?.name.split(' ')[0] || 'Druga osoba'], ['all', 'Wszystkie']].map(([k, label]) =>
      h('button', { class: `seg-btn ${filter === k ? 'on' : ''}`, role: 'tab', 'aria-selected': filter === k,
        onclick: () => db.kvSet('todayFilter', k).then(() => window.dispatchEvent(new Event('rerender'))) }, label)));

  const list = (items, opts) => h('div', { class: 'list' }, items.map((t) => taskRow(t, opts)));

  const left = h('div', { class: 'col' },
    seg,
    overdue.length ? section(h('span', { class: 'overdue' }, `Zaległe (${overdue.length})`), list(overdue, { showDate: true })) : null,
    section('Dziś', todays.length ? list(todays) : emptyState('Na dziś nic nie zaplanowano.', 'Dodaj zadanie', () => editTask(), 'check'),
      h('button', { class: 'link-btn', onclick: () => editTask() }, icon('plus', 16), 'Dodaj')),
    section('Najbliższe 7 dni', upcoming.length ? groupByDay(upcoming) : h('p', { class: 'muted pad' }, 'Brak zadań w najbliższym tygodniu.')),
    undated.length ? section('Bez terminu', list(undated)) : null,
    h('p', { class: 'hint-line center only-touch' }, 'Wskazówka: przesuń zadanie w prawo – gotowe, w lewo – na jutro.'));

  const right = h('div', { class: 'col' }, projectsStrip(), clientsAttention(), activityFeed(), backupReminder());

  return {
    title: 'Dziś',
    node: h('div', { class: 'page page-today' }, hero, h('div', { class: 'two-col' }, left, right)),
  };
}

function groupByDay(tasks) {
  const groups = new Map();
  for (const t of tasks) { if (!groups.has(t.due)) groups.set(t.due, []); groups.get(t.due).push(t); }
  return h('div', null, [...groups].map(([d, ts]) => h('div', { class: 'day-group' },
    h('div', { class: 'day-label' }, dayLabel(d)),
    h('div', { class: 'list' }, ts.map((t) => taskRow(t))))));
}

function dayLabel(d) {
  const rel = relDay(d);
  const long = longDay(d);
  const cap = long[0].toUpperCase() + long.slice(1);
  return ['Jutro', 'Pojutrze'].includes(rel) ? [rel, h('span', { class: 'muted' }, ` · ${long}`)] : cap;
}

function projectsStrip() {
  const ps = db.all('projects').filter((p) => p.stage !== 'zakonczony')
    .sort((a, b) => (a.due || '9').localeCompare(b.due || '9')).slice(0, 8);
  if (!ps.length) return section('Projekty w toku', emptyState('Brak aktywnych projektów.', 'Nowy projekt', () => import('../components.js').then((m) => m.editProject()), 'projects'));
  return section('Projekty w toku', h('div', { class: 'cards-scroll' }, ps.map((p) => {
    const client = db.get('contacts', p.clientId);
    const pct = M.projectProgress(p);
    const dueSoon = p.due && p.due <= addDays(todayStr(), 3);
    return h('button', { class: 'pcard', onclick: () => navigate(`projekt/${p.id}`) },
      h('div', { class: 'pcard-stage' }, M.stageLabel(p.stage)),
      h('div', { class: 'pcard-title' }, p.title),
      h('div', { class: 'pcard-client' }, client?.name || ' '),
      progressBar(pct),
      h('div', { class: 'pcard-foot' },
        h('span', { class: dueSoon ? 'overdue' : '' }, p.due ? `Termin: ${relDay(p.due).toLowerCase()}` : 'Bez terminu'),
        ownerBadge(p.owner)));
  })), h('button', { class: 'link-btn', onclick: () => navigate('projekty') }, 'Wszystkie', icon('chevron', 16)));
}

function clientsAttention() {
  const today = todayStr();
  const soon = addDays(today, 30);
  const items = db.all('contacts').filter((c) => c.kind === 'klient' &&
    (c.health === 'uwaga' || c.health === 'ryzyko' || (c.contractEnd && c.contractEnd >= today && c.contractEnd <= soon)));
  if (!items.length) return null;
  return section('Klienci – uwaga', h('div', { class: 'list' }, items.map((c) => h('button', { class: 'list-row', onclick: () => navigate(`kontakt/${c.id}`) },
    h('span', { class: `dot dot-${c.health === 'ryzyko' ? 'ryzyko' : 'uwaga'}` }),
    h('div', { class: 'row-main' },
      h('div', { class: 'row-title' }, c.name),
      h('div', { class: 'row-meta' }, [
        c.health === 'ryzyko' ? 'Relacja zagrożona' : c.health === 'uwaga' ? 'Wymaga uwagi' : '',
        c.contractEnd && c.contractEnd <= soon ? `Umowa kończy się ${relDay(c.contractEnd).toLowerCase()}` : '',
      ].filter(Boolean).join(' · '))),
    icon('chevron', 18, 'muted')))));
}

function activityFeed() {
  const items = db.all('activity').sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
  if (!items.length) return null;
  return section('Ostatnia aktywność', h('div', { class: 'feed' }, items.map((a) => h('div', { class: 'feed-item' },
    ownerBadge(a.by),
    h('div', null, h('div', null, h('strong', null, M.partnerName(a.by) || 'Ktoś'), ' ', a.text),
      h('div', { class: 'muted small' }, timeAgo(a.at)))))));
}

function backupReminder() {
  const last = db.kvGet('lastBackup');
  const hasData = db.all('tasks').length + db.all('contacts').length + db.all('projects').length > 0;
  if (!hasData) return null;
  const days = last ? Math.floor((Date.now() - new Date(last)) / 86400000) : null;
  if (days != null && days < 7) return null;
  return h('div', { class: 'notice' }, icon('download', 20),
    h('div', null, h('strong', null, 'Zrób kopię zapasową'),
      h('div', { class: 'small' }, last ? `Ostatnia kopia: ${plural(days, 'dzień', 'dni', 'dni')} temu.` : 'Dane są na razie zapisane tylko na tym urządzeniu.')),
    h('button', { class: 'btn btn-soft btn-sm', onclick: () => navigate('ustawienia/kopia') }, 'Kopia'));
}
