// Tiny DOM helpers shared by the page and the plan tools.
// Everything is built with createElement + textContent; nothing is ever inserted as HTML.

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

export const srOnly = (text) => el('span', { class: 'sr-only', text });

const SVG_NS = 'http://www.w3.org/2000/svg';
function icon(d, size) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}
export const chevron = () => icon('M6 3 L11 8 L6 13', 18);
export const arrowIcon = () => icon('M4 12 L12 4 M6 4 L12 4 L12 10', 14);

/** An https-only link that opens in a new tab and announces it. `onClick` runs before navigation. */
export function externalLink(text, url, onClick) {
  if (!/^https:\/\//i.test(String(url))) return el('span', { text });
  // The arrow (an authored SVG, hidden from screen readers) stays on the line with the last word.
  const words = String(text);
  const cut = words.lastIndexOf(' ') + 1;
  return el('a', { href: url, target: '_blank', rel: 'noopener noreferrer', onclick: onClick || null },
    words.slice(0, cut), el('span', { class: 'ext-tail' }, words.slice(cut), arrowIcon()), srOnly(' (opens in a new tab)'));
}

export const num = new Intl.NumberFormat('en-US');
export const usd = (n) => `$${num.format(Math.round(n))}`;
export const usd10 = (n) => `$${num.format(Math.abs(Math.round(n / 10) * 10))}`;
