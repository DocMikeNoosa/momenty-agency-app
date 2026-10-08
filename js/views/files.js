import * as db from '../db.js';
import { h, icon, emptyState } from '../ui.js';
import { filesGrid, uploadFlow } from '../components.js';

export function renderFiles() {
  const filter = db.kvGet('filesFilter', '');
  const all = db.all('files').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const files = filter === 'img' ? all.filter((f) => f.isImage) : filter === 'doc' ? all.filter((f) => !f.isImage) : all;

  const seg = h('div', { class: 'seg' }, [['', 'Wszystkie'], ['img', 'Zdjęcia'], ['doc', 'Dokumenty']].map(([k, l]) =>
    h('button', { class: `seg-btn ${filter === k ? 'on' : ''}`, onclick: () => db.kvSet('filesFilter', k).then(() => window.dispatchEvent(new Event('rerender'))) }, l)));

  const uploadBar = h('div', { class: 'upload-bar' },
    h('button', { class: 'upload-btn', onclick: () => uploadFlow({ camera: true }) }, icon('camera', 26), h('span', null, 'Zrób zdjęcie')),
    h('button', { class: 'upload-btn', onclick: () => uploadFlow() }, icon('upload', 26), h('span', null, 'Dodaj pliki')));

  // group by client/project for context
  const groups = new Map();
  for (const f of files) {
    const p = db.get('projects', f.projectId);
    const c = db.get('contacts', f.clientId);
    const key = p ? `Projekt: ${p.title}` : c ? c.name : 'Nieprzypisane';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(f);
  }

  return {
    title: 'Pliki',
    node: h('div', { class: 'page' }, uploadBar, seg,
      files.length ? h('div', null, [...groups].map(([k, fs]) => h('section', { class: 'section' },
        h('div', { class: 'section-head' }, h('h3', null, k), h('span', { class: 'muted small' }, fs.length)), filesGrid(fs))))
        : emptyState('Nie ma jeszcze plików. Dodaj zdjęcia z wydarzeń, logotypy, briefy czy umowy.', null, null, 'files'),
      h('p', { class: 'hint-line center' }, 'Zdjęcia i pliki zapisywane są na tym urządzeniu. Duże zdjęcia są automatycznie zmniejszane do 2560 px.')),
  };
}
