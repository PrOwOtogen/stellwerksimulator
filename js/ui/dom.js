/* ===================================================================
 * dom.js – kleine Helfer für die Oberfläche
 * ================================================================= */
import { hhmm, parseTime } from '../sim.js';

export const $ = sel => document.querySelector(sel);
export const $$ = sel => [...document.querySelectorAll(sel)];
export const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const clampInt = (v, a, b) => Math.max(a, Math.min(b, parseInt(v, 10) || a));

/** Element erzeugen: h('button', { class: 'x', onclick }, 'Text', kind) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

/* ---------------- Meldungseinblendung ---------------- */
export function toast(text, kind = '') {
  const box = $('#toasts');
  if (!box) return;
  const t = h('div', { class: 'toast ' + kind }, text);
  box.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2800);
  while (box.children.length > 4) box.firstChild.remove();
}

/* ---------------- Dialog ---------------- */
let modalApply = null;
export function openModal(title, build, opts = {}) {
  const m = $('#modal');
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  body.innerHTML = '';
  m.querySelector('.modal-box').className = 'modal-box' + (opts.wide ? ' wide' : '') + (opts.cls ? ' ' + opts.cls : '');
  modalApply = build(body) || null;
  const ok = $('#modal-ok'), cancel = $('#modal-cancel');
  ok.textContent = opts.okLabel || 'OK';
  cancel.textContent = opts.cancelLabel || 'Abbrechen';
  ok.style.display = opts.noOk ? 'none' : '';
  cancel.style.display = opts.noCancel ? 'none' : '';
  m.classList.remove('hidden');
  ok.onclick = () => { if (modalApply && modalApply() === false) return; closeModal(); };
  cancel.onclick = () => { closeModal(); opts.onCancel?.(); };
  setTimeout(() => body.querySelector('input,select,button')?.focus?.(), 30);
}
export function closeModal() { $('#modal').classList.add('hidden'); modalApply = null; }
export const modalOpen = () => !$('#modal').classList.contains('hidden');

/* ---------------- Kontextmenü ---------------- */
export function showCtx(x, y, items) {
  const m = $('#ctxmenu');
  m.innerHTML = '';
  for (const it of items) {
    if (it.title) { m.append(h('div', { class: 'title' }, it.title), h('div', { class: 'sep' })); continue; }
    if (it.sep) { m.append(h('div', { class: 'sep' })); continue; }
    m.append(h('button', { class: it.danger ? 'danger' : '', onclick: () => { hideCtx(); it.fn(); } }, it.label));
  }
  m.classList.remove('hidden');
  m.style.left = Math.min(x, window.innerWidth - 240) + 'px';
  m.style.top = Math.min(y, window.innerHeight - m.offsetHeight - 10) + 'px';
}
export const hideCtx = () => $('#ctxmenu')?.classList.add('hidden');

/* ---------------- Sonstiges ---------------- */
export function downloadText(text, filename, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['﻿' + text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function inputTime(value, apply, width = '5em') {
  const i = h('input', { type: 'text', value, style: { width } });
  i.onchange = () => { const t = parseTime(i.value); if (t !== null) apply(t); else i.value = value; };
  return i;
}

export const fmtTime = hhmm;
