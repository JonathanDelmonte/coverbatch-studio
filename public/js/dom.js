// Elements are built with properties and text nodes, never by concatenating
// file names into HTML: names come from the user's ZIPs and folders.
export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key === 'style') for (const [k, v] of Object.entries(value)) el.style.setProperty(k, v);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'text') el.textContent = value;
    else if (value === true) el.setAttribute(key, '');
    else if (key in el && !key.includes('-') && key !== 'list' && key !== 'form') el[key] = value;
    else el.setAttribute(key, value);
  }
  append(el, children);
  return el;
}

// replaceChildren() would print "false" and "null" from conditional children.
export const put = (el, ...children) => { el.replaceChildren(); return append(el, children); };

export function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const PATHS = {
  back: 'M14.5 5.5 8 12l6.5 6.5',
  next: 'M9.5 5.5 16 12l-6.5 6.5',
  close: 'M6.5 6.5l11 11m0-11-11 11',
  download: 'M12 4.5v10.5m-4.5-4.5L12 15l4.5-4.5M5 19.5h14',
  upload: 'M12 15V4.5M7.5 9 12 4.5 16.5 9M5 19.5h14',
  folder: 'M3.5 7.25c0-.97.78-1.75 1.75-1.75h3.9l1.9 2h7.7c.97 0 1.75.78 1.75 1.75v7.5c0 .97-.78 1.75-1.75 1.75H5.25c-.97 0-1.75-.78-1.75-1.75z',
  alert: 'M12 4.5 3 19.5h18zM12 10.5v4M12 17.25v.25',
  refresh: 'M18.6 8.5A7.5 7.5 0 1 0 19.5 13M19.5 4v4.5H15',
  trash: 'M5 7h14M9.5 7V5h5v2M7 7l1 12.5h8L17 7',
  undo: 'M9 7.5 4.5 12 9 16.5M5 12h9.5a5 5 0 0 1 0 10H12',
  help: 'M12 20.5a8.5 8.5 0 1 0 0-17 8.5 8.5 0 0 0 0 17zM9.7 9.6a2.4 2.4 0 1 1 3.3 2.2c-.6.3-1 .8-1 1.4v.5M12 16.6v.1',
};
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}

// A modal dialog makes the rest of the page inert, toasts included, so each open
// dialog hosts its own toast region; dialogs re-render with fill() to keep it.
export function fill(dialog, ...nodes) {
  for (const child of [...dialog.children]) if (!child.classList.contains('toasts')) child.remove();
  dialog.prepend(...nodes.flat(Infinity).filter(Boolean));
}

// A primary action wears the sticker: blue slanted block + label.
export function stampButton(label, iconName, props = {}) {
  return h(props.href ? 'a' : 'button', { class: 'btn btn-stamp', type: props.href ? null : 'button', ...props }, h('span', { class: 'btn-block' }, icon(iconName)), label);
}

export function seg(options, value, onChange, label) {
  const group = h('div', { class: 'seg', role: 'group', 'aria-label': label });
  for (const [key, text] of options) {
    group.append(h('button', { type: 'button', 'aria-pressed': String(key === value), onclick: () => { if (key !== value) onChange(key); } }, text));
  }
  return group;
}
