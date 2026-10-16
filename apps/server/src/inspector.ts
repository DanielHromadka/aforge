// Injected into every HTML page of the running app by the preview proxy. It talks to aForge through
// postMessage only: in "select" mode a click picks an element (Lovable-style annotations) instead of
// reaching the app.
export const INSPECTOR_JS = `(() => {
  if (window.__aforge) return;
  window.__aforge = true;
  let selecting = false;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #007aff;background:rgba(0,122,255,.12);border-radius:4px;display:none;transition:all .06s';
  const tag = document.createElement('div');
  tag.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;background:#007aff;color:#fff;font:11px -apple-system,system-ui,sans-serif;padding:2px 6px;border-radius:4px;display:none';
  const mount = () => { document.documentElement.append(box, tag); };
  if (document.body) mount(); else addEventListener('DOMContentLoaded', mount);

  const selectorOf = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 6 && el !== document.body) {
      const testId = el.getAttribute('data-testid');
      if (testId) { parts.unshift('[data-testid="' + testId + '"]'); break; }
      let part = el.tagName.toLowerCase();
      const parent = el.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === el.tagName);
        if (same.length > 1) part += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
      }
      parts.unshift(part);
      el = parent;
    }
    return parts.join(' > ');
  };
  const show = (el, label) => {
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    Object.assign(tag.style, { display: 'block', left: r.left + 'px', top: Math.max(0, r.top - 20) + 'px' });
    tag.textContent = label;
  };
  const hide = () => { box.style.display = 'none'; tag.style.display = 'none'; };
  const post = (msg) => parent.postMessage(Object.assign({ source: 'aforge-inspector' }, msg), '*');

  addEventListener('mouseover', (e) => { if (selecting && e.target instanceof Element) show(e.target, e.target.tagName.toLowerCase()); }, true);
  addEventListener('click', (e) => {
    if (!selecting || !(e.target instanceof Element)) return;
    e.preventDefault(); e.stopPropagation();
    const el = e.target;
    post({ type: 'pick', selector: selectorOf(el), text: (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '').trim().slice(0, 200), tag: el.tagName.toLowerCase(), route: location.pathname + location.search });
  }, true);
  addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.target !== 'aforge-inspector') return;
    if (d.type === 'mode') { selecting = !!d.select; document.documentElement.style.cursor = selecting ? 'crosshair' : ''; if (!selecting) hide(); }
    if (d.type === 'highlight') { const el = document.querySelector(d.selector); if (el) { el.scrollIntoView({ block: 'center' }); show(el, d.label || 'anotace'); setTimeout(hide, 2500); } }
  });
  const route = () => post({ type: 'route', route: location.pathname + location.search, title: document.title });
  for (const k of ['pushState', 'replaceState']) { const orig = history[k]; history[k] = function () { const r = orig.apply(this, arguments); route(); return r; }; }
  addEventListener('popstate', route);
  addEventListener('load', route);
})();`
