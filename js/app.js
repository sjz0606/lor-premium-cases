import { DICT, NEWS, STORIES } from './i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const DESK = matchMedia('(min-width: 980px)');
const ABROAD = new Set(['kz', 'tj', 'kg', 'ru']);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l13-7.5z"/></svg>';

// ---------- language ----------
const urlLang = new URLSearchParams(location.search).get('lang');
let lang = (urlLang === 'uz' || urlLang === 'ru') ? urlLang : (localStorage.getItem('v4lang') || 'ru');
if (lang !== 'uz') lang = 'ru';
const t = (k, ...a) => { const v = (DICT[lang] && DICT[lang][k]) ?? DICT.ru[k] ?? k; return typeof v === 'function' ? v(...a) : v; };
const tx = o => (o ? (o[lang] ?? o.ru) : '');

// ---------- state ----------
let DATA = null, CASES = [], filtered = [], videoList = [];
const state = { f: 'all', q: '' };
let shown = 0; const PAGE = DESK.matches ? 20 : 12;
let reel = null, fb = null;
let caseRef = null;

const FILTERS = [
  { id: 'all', k: 'chip.all', test: () => true },
  { id: 'ear', area: 'ear' }, { id: 'nose', area: 'nose' }, { id: 'kids', test: c => c.area === 'kids' || c.flags.includes('child') },
  { id: 'throat', area: 'throat' }, { id: 'skull', area: 'skull' },
  { id: 'revision', k: 'chip.revision', test: c => c.flags.includes('revision') },
  { id: 'abroad', k: 'chip.abroad', test: c => c.origin && ABROAD.has(c.origin.key) },
];
FILTERS.forEach(f => { if (f.area && !f.test) f.test = c => c.area === f.area; });
function filterTest(id) {
  if (id.startsWith('tag:')) { const tg = id.slice(4); return c => c.tag === tg; }
  if (id.startsWith('or:')) { const o = id.slice(3); return c => c.origin && c.origin.key === o; }
  return (FILTERS.find(f => f.id === id) || FILTERS[0]).test;
}
function filterLabel(id) {
  if (id.startsWith('tag:')) return tx(DATA.tags[id.slice(4)]);
  if (id.startsWith('or:')) return tx(DATA.origins[id.slice(3)]);
  const f = FILTERS.find(x => x.id === id); if (!f) return '';
  return f.k ? t(f.k) : tx(DATA.areas[f.area === undefined ? 'kids' : f.area]);
}
const norm = s => s.toLowerCase().replace(/ё/g, 'е').replace(/[ʻʼ‘’'`]/g, '');
function searchText(c) {
  if (!c._s) {
    const parts = [c.id, c.code];
    for (const L of ['ru', 'uz']) {
      parts.push(c.title[L], c.proc[L], c.origin ? c.origin[L] : '', DATA.areas[c.area][L]);
      Object.values(c.steps).forEach(s => parts.push(s[L]));
    }
    c._s = norm(parts.join(' '));
  }
  return c._s;
}
function apply() {
  const test = filterTest(state.f);
  const words = norm(state.q.trim()).split(/\s+/).filter(Boolean);
  filtered = CASES.filter(c => test(c) && words.every(w => searchText(c).includes(w)));
  videoList = filtered.filter(c => c.video);
  shown = 0;
  renderChips(); renderCounts(); renderGrid(true); updateReel(); renderMapState();
}

// ---------- chips ----------
function chipCount(id) { const tst = filterTest(id); return CASES.filter(tst).length; }
function renderChips() {
  const base = FILTERS.map(f => f.id);
  const ids = base.includes(state.f) ? base : [...base, state.f];
  const html = ids.map(id => `<button type="button" class="chip" data-f="${esc(id)}" aria-pressed="${id === state.f}">${esc(filterLabel(id))} <span class="n">${chipCount(id)}</span></button>`).join('');
  ['#chips', '#chips-m', '#chips-lib'].forEach(s => { $(s).innerHTML = html; });
}
document.addEventListener('click', e => {
  const b = e.target.closest('.chip[data-f]');
  if (!b) return;
  const host = b.parentElement;
  state.f = b.dataset.f === state.f && state.f !== 'all' ? 'all' : b.dataset.f;
  apply();
  const sel = host && $(`.chip[data-f="${CSS.escape(state.f)}"]`, host);
  if (sel && host.scrollWidth > host.clientWidth) host.scrollTo({ left: sel.offsetLeft - host.clientWidth / 2 + sel.offsetWidth / 2, behavior: RM.matches ? 'auto' : 'smooth' });
});
function renderCounts() {
  const full = state.f === 'all' && !state.q.trim();
  const v = filtered.filter(c => c.video).length;
  $('#count').textContent = full ? t('count.lib', CASES.length, v) : t('count.found', filtered.length) + ` · ▶ ${v}`;
  $('#count-lib').textContent = full ? t('count.lib', CASES.length, v) : t('count.found', filtered.length);
  $('#m-count').textContent = `${filtered.length}`;
}

// ---------- search ----------
const q = $('#q');
let qTimer = 0;
q.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { state.q = q.value; apply(); }, 140); });
document.addEventListener('keydown', e => {
  if (e.key === '/' && !/input|textarea/i.test(document.activeElement.tagName)) { e.preventDefault(); q.focus(); }
  if (!$('#viewer').hidden) {
    if (e.key === 'Escape') closeViewer();
    if (e.key === 'ArrowRight') stepViewer(1);
    if (e.key === 'ArrowLeft') stepViewer(-1);
    return;
  }
  if (!$('#lb').hidden && e.key === 'Escape') closeLb();
  const r = $('#stage').getBoundingClientRect();
  if (r.bottom > 80 && r.top < innerHeight * 0.5 && !/input|textarea/i.test(document.activeElement.tagName)) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown' && !DESK.matches) { reelStep(1); }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' && !DESK.matches) { reelStep(-1); }
  }
});

// ---------- case helpers ----------
const originTxt = c => c.origin ? tx(c.origin) : '';
function tagsHtml(c, light) {
  const out = [`<span class="tag">${esc(tx(DATA.areas[c.area]))}</span>`];
  if (c.origin) out.push(`<span class="tag g">${esc(originTxt(c))}</span>`);
  c.flags.forEach(f => out.push(`<span class="tag g">${esc(t('flag.' + f))}</span>`));
  if (c.age) out.push(`<span class="tag g">${esc(t('v.age', c.age))}</span>`);
  return out.join('');
}
const dateFmt = d => { const [y, m, dd] = d.split('-'); return `${dd}.${m}.${y}`; };

// ---------- hero reel ----------
let reelIndex = 0;
function currentReelCase() { return videoList[reelIndex]; }
function renderNow() {
  const c = currentReelCase();
  const now = $('#now'), mi = $('#m-info');
  if (!c) { now.innerHTML = ''; mi.innerHTML = ''; return; }
  now.innerHTML = `
    <div class="cid"><span>${esc(c.id)}</span><span class="pos">${reelIndex + 1} / ${videoList.length}</span></div>
    <h2>${esc(tx(c.title))}</h2>
    <p class="proc">${esc(tx(c.proc))}</p>
    <div class="tags">${tagsHtml(c)}</div>
    <div class="acts"><button type="button" class="btn btn-ghost" data-open="${c.id}">${esc(t('hero.open'))}</button><a class="btn btn-teal" href="#book" data-book="${c.id}">${esc(t('cta.book'))}</a></div>`;
  mi.innerHTML = `
    <div class="cid"><span>${esc(c.id)}</span><span>${reelIndex + 1}/${videoList.length}</span>${c.origin ? `<span>${esc(originTxt(c))}</span>` : ''}</div>
    <h2>${esc(tx(c.title))}</h2>
    <p class="proc">${esc(tx(c.proc))}</p>
    <div class="acts"><button type="button" class="btn btn-ghost" data-open="${c.id}">${esc(t('hero.open'))}</button><a class="btn btn-teal" href="#book" data-book="${c.id}">${esc(t('cta.book'))}</a></div>`;
  $('#dots').innerHTML = videoList.length > 1 ? videoList.map((_, i) => `<i class="${i === reelIndex ? 'on' : ''}"></i>`).slice(Math.max(0, reelIndex - 6), reelIndex + 7).join('') : '';
}
function onReelChange(i) { reelIndex = i; renderNow(); }
function updateReel() {
  $('#stage-empty').hidden = videoList.length > 0;
  $('#stage-gl').classList.toggle('off', !videoList.length);
  const items = videoList.map(c => ({ poster: c.poster, video: c.video }));
  reelIndex = 0;
  if (reel) reel.setItems(items, 0);
  else if (fb) fb.setItems(items);
  renderNow();
}
function reelStep(d) {
  if (reel) d > 0 ? reel.next() : reel.prev();
  else if (fb) fb.go(reelIndex + d);
}
$('#prev').addEventListener('click', () => reelStep(-1));
$('#next').addEventListener('click', () => reelStep(1));

// Fallback: native scroll-snap track with real <video>
function createFallback(host) {
  host.hidden = false;
  let items = [];
  const io = new IntersectionObserver(ens => {
    ens.forEach(en => {
      const i = +en.target.dataset.i;
      const v = en.target.querySelector('video');
      if (en.isIntersecting && en.intersectionRatio > 0.6) {
        onReelChange(i);
        if (v && !RM.matches) { v.preload = 'metadata'; v.play().catch(() => {}); }
      } else if (v) v.pause();
    });
  }, { root: host, threshold: [0, 0.6, 1] });
  return {
    setItems(list) {
      items = list; io.disconnect(); host.scrollTo(0, 0);
      host.innerHTML = list.map((it, i) => `<div class="fb-item" data-i="${i}"><div class="fb-media">
        <video muted playsinline loop preload="none" poster="${esc(it.poster)}" src="${esc(it.video)}"></video>
        ${RM.matches ? `<button class="fb-play" type="button" aria-label="${lang === 'uz' ? 'Videoni ijro etish' : 'Воспроизвести видео'}">${ICON_PLAY}</button>` : ''}</div></div>`).join('');
      $$('.fb-item', host).forEach(el => io.observe(el));
    },
    go(i) { i = Math.max(0, Math.min(items.length - 1, i)); const el = host.children[i]; el && el.scrollIntoView({ block: 'nearest', inline: 'center', behavior: RM.matches ? 'auto' : 'smooth' }); },
  };
}
$('#stage-fb').addEventListener('click', e => {
  const p = e.target.closest('.fb-play');
  if (p) { const v = p.parentElement.querySelector('video'); v.controls = true; v.play().catch(() => {}); p.remove(); return; }
  const it = e.target.closest('.fb-item');
  if (it && +it.dataset.i === reelIndex && !e.target.closest('video[controls]')) openViewer(videoList[reelIndex].id);
});

async function initReel() {
  const host = $('#stage-gl');
  const lowPower = (navigator.hardwareConcurrency || 4) <= 2 || (navigator.connection && navigator.connection.saveData);
  if (RM.matches || lowPower) { fb = createFallback($('#stage-fb')); host.classList.add('off'); return; }
  try {
    const { createReel } = await import('./reel.js');
    reel = createReel(host, { axis: DESK.matches ? 'x' : 'y', onChange: onReelChange, onOpen: i => openViewer(videoList[i].id) });
    DESK.addEventListener('change', () => reel.setAxis(DESK.matches ? 'x' : 'y'));
  } catch (err) {
    console.info('WebGL reel unavailable, using fallback');
    host.classList.add('off');
    fb = createFallback($('#stage-fb'));
  }
}

// ---------- library grid ----------
const grid = $('#grid');
function cardHtml(c) {
  return `<button type="button" class="cc" data-open="${c.id}">
    <span class="th"><img src="${esc(c.thumb)}" alt="" loading="lazy" decoding="async" width="480" height="480">${c.video ? `<span class="vb">${ICON_PLAY}${esc(t('lib.video'))}</span>` : ''}</span>
    <span class="bd"><span class="cid">${esc(c.id)} · ${dateFmt(c.date)}</span><h3>${esc(tx(c.title))}</h3><span class="proc">${esc(tx(c.proc))}</span>${c.origin ? `<span class="og">${esc(originTxt(c))}</span>` : ''}</span></button>`;
}
function renderGrid(reset) {
  if (reset) { grid.innerHTML = ''; shown = 0; }
  if (!filtered.length) {
    grid.innerHTML = `<div class="empty"><p>${esc(t('lib.empty'))}</p><button type="button" class="btn btn-ghost" id="reset">${esc(t('lib.reset'))}</button></div>`;
    $('#more').hidden = true; return;
  }
  const next = filtered.slice(shown, shown + PAGE);
  grid.insertAdjacentHTML('beforeend', next.map(cardHtml).join(''));
  shown += next.length;
  $('#more').hidden = shown >= filtered.length;
  depthDirty = true;
}
$('#more').addEventListener('click', () => renderGrid(false));
document.addEventListener('click', e => {
  if (e.target.id === 'reset') { state.f = 'all'; state.q = ''; q.value = ''; apply(); }
});

// depth-sorted grid on scroll + pointer tilt
let depthDirty = true, tiltEl = null, tiltX = 0, tiltY = 0;
function depthPass() {
  if (RM.matches) return;
  const vh = innerHeight;
  for (const el of grid.children) {
    if (!el.classList.contains('cc')) continue;
    const r = el.getBoundingClientRect();
    if (r.bottom < -100 || r.top > vh + 100) continue;
    const d = ((r.top + r.height / 2) - vh * 0.5) / (vh * 0.5); // -1..1
    const dc = Math.max(-1.3, Math.min(1.3, d));
    const z = -Math.abs(dc) * 70;
    let rx = dc * -9, ry = 0, extra = 0;
    if (el === tiltEl) { rx += tiltY * -10; ry = tiltX * 12; extra = 24; }
    el.style.transform = `translateZ(${(z + extra).toFixed(1)}px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg)`;
    el.style.opacity = (1 - Math.max(0, Math.abs(dc) - 0.8) * 0.5).toFixed(3);
  }
}
let ticking = false;
function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(() => { ticking = false; depthPass(); parallaxPass(); }); } }
addEventListener('scroll', onScroll, { passive: true });
addEventListener('resize', onScroll);
grid.addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  const el = e.target.closest('.cc'); tiltEl = el;
  if (el) { const r = el.getBoundingClientRect(); tiltX = (e.clientX - r.left) / r.width - 0.5; tiltY = (e.clientY - r.top) / r.height - 0.5; }
  onScroll();
});
grid.addEventListener('pointerleave', () => { tiltEl = null; onScroll(); });

// ---------- map ----------
function renderMap() {
  const byArea = {}; const byTag = {}; const byOr = {};
  CASES.forEach(c => { byArea[c.area] = (byArea[c.area] || 0) + 1; byTag[c.tag] = (byTag[c.tag] || 0) + 1; if (c.origin) byOr[c.origin.key] = (byOr[c.origin.key] || 0) + 1; });
  const max = Math.max(...Object.values(byArea));
  const areaOrder = ['ear', 'nose', 'kids', 'throat', 'skull'];
  $('#areas').innerHTML = areaOrder.filter(a => byArea[a]).map(a => {
    const id = a === 'kids' ? 'kids' : a; const n = byArea[a];
    return `<button type="button" class="brow big" data-mf="${id}" aria-pressed="false"><span class="lbl">${esc(tx(DATA.areas[a]))}</span><span class="track"><span class="fill" style="--v:${(n / max).toFixed(3)}"></span></span><span class="num">${n}</span></button>`;
  }).join('');
  const tags = Object.entries(byTag).sort((a, b) => b[1] - a[1]);
  const tmax = tags[0][1];
  $('#tags').innerHTML = tags.map(([k, n]) => `<button type="button" class="brow" data-mf="tag:${k}" aria-pressed="false"><span class="lbl">${esc(tx(DATA.tags[k]))}</span><span class="track"><span class="fill" style="--v:${(n / tmax).toFixed(3)}"></span></span><span class="num">${n}</span></button>`).join('');
  const ors = Object.entries(byOr).sort((a, b) => b[1] - a[1]);
  const omax = ors.length ? ors[0][1] : 1;
  $('#origins').innerHTML = ors.map(([k, n]) => `<button type="button" class="brow o" data-mf="or:${k}" aria-pressed="false"><span class="lbl">${esc(tx(DATA.origins[k]))}${ABROAD.has(k) ? '' : ` <small style="color:var(--ink3)">· ${lang === 'uz' ? 'Oʻzbekiston' : 'Узбекистан'}</small>`}</span><span class="track"><span class="fill" style="--v:${(n / omax).toFixed(3)}"></span></span><span class="num">${n}</span></button>`).join('');
  renderMapState();
}
function renderMapState() { $$('.brow[data-mf]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mf === state.f))); }
document.addEventListener('click', e => {
  const b = e.target.closest('.brow[data-mf]'); if (!b) return;
  state.f = b.dataset.mf; apply();
  $('#library').scrollIntoView({ behavior: RM.matches ? 'auto' : 'smooth' });
});
const mapIO = new IntersectionObserver(([en]) => { if (en.isIntersecting) { $('#map').classList.add('in'); mapIO.disconnect(); } }, { threshold: 0.2 });
mapIO.observe($('#map'));

// ---------- news ----------
function renderNews() {
  $('#news-track').innerHTML = NEWS.map(n => `<a class="nc" href="https://www.instagram.com/p/${n.code}/" target="_blank" rel="noopener">
    <span class="ni"><img src="${esc(n.img)}" alt="" loading="lazy"></span>
    <span class="nb"><time>${esc(tx(n.date))}</time><b>${esc(tx(n.place))}</b><p>${esc(tx(n.text))}</p></span></a>`).join('');
}

// ---------- stories masonry with depth ----------
let mcols = [];
function renderStories() {
  const n = innerWidth >= 1200 ? 4 : innerWidth >= 700 ? 3 : 2;
  if (mcols.length === n) return;
  const m = $('#masonry'); m.innerHTML = '';
  mcols = Array.from({ length: n }, (_, i) => { const d = document.createElement('div'); d.className = 'mcol'; d.dataset.s = [0.06, -0.05, 0.1, -0.02][i]; m.appendChild(d); return d; });
  STORIES.forEach((id, i) => {
    const src = `media/hl/reviews_${String(id).padStart(2, '0')}.jpg`;
    mcols[i % n].insertAdjacentHTML('beforeend', `<button type="button" class="mi" data-lb="${src}" aria-label="${lang === 'uz' ? 'Kattalashtirish' : 'Увеличить'}"><img src="${src}" alt="" loading="lazy" decoding="async" width="900" height="1600"></button>`);
  });
  parallaxPass();
}
function parallaxPass() {
  if (RM.matches || !mcols.length) return;
  const r = $('#masonry').getBoundingClientRect();
  if (r.bottom < 0 || r.top > innerHeight) return;
  const p = (innerHeight - r.top) / (innerHeight + r.height) - 0.5;
  mcols.forEach((c, i) => { const s = +c.dataset.s; c.style.transform = `translate3d(0,${(p * s * Math.min(r.height, 2400) * 0.5).toFixed(1)}px,0)`; });
}
addEventListener('resize', () => { renderStories(); });

// ---------- lightbox ----------
let lbReturn = null;
document.addEventListener('click', e => {
  const b = e.target.closest('[data-lb]'); if (!b) return;
  lbReturn = b; $('#lb-img').src = b.dataset.lb; $('#lb').hidden = false; document.body.classList.add('lock'); $('#lb-x').focus();
});
function closeLb() { $('#lb').hidden = true; $('#lb-img').removeAttribute('src'); if ($('#viewer').hidden) document.body.classList.remove('lock'); lbReturn && lbReturn.focus(); }
$('#lb').addEventListener('click', e => { if (e.target.id !== 'lb-img') closeLb(); });

// ---------- viewer ----------
let vCase = null, vReturn = null, vList = [];
const STEP_KEYS = ['complaint', 'diagnosis', 'done', 'note'];
function related(c) {
  const same = CASES.filter(x => x !== c && x.tag === c.tag);
  const area = CASES.filter(x => x !== c && x.tag !== c.tag && x.area === c.area);
  return [...same.filter(x => x.video), ...same.filter(x => !x.video), ...area].slice(0, 4);
}
function openViewer(id, push = true) {
  const c = CASES.find(x => x.id === id); if (!c) return;
  const v = $('#viewer');
  if (v.hidden) { vReturn = document.activeElement; vList = filtered.includes(c) ? filtered : CASES; }
  vCase = c;
  reel && reel.pause();
  $$('#stage-fb video').forEach(x => x.pause());
  const media = $('#v-media');
  const vidHtml = c.video
    ? `<img class="bgblur" src="${esc(c.poster)}" alt=""><video class="wipe" src="${esc(c.video)}" poster="${esc(c.poster)}" muted playsinline loop ${RM.matches ? 'controls' : 'autoplay'} preload="metadata"></video>`
    : `<img class="bgblur" src="${esc(c.poster)}" alt=""><img class="wipe" src="${esc(c.poster)}" alt="${esc(tx(c.title))}">`;
  media.innerHTML = vidHtml + `<div class="v-nav"><button type="button" data-vstep="-1" aria-label="${esc(t('hero.prev'))}"><svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"/></svg></button><button type="button" data-vstep="1" aria-label="${esc(t('hero.next'))}"><svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"/></svg></button></div>`;
  const vid = $('video', media); if (vid && !RM.matches) vid.play().catch(() => {});
  const steps = STEP_KEYS.map((k, i) => {
    const s = c.steps[k];
    return `<li style="--i:${i}" class="${s ? '' : 'miss'}"><span class="k">${String(i + 1).padStart(2, '0')} · ${esc(t('v.' + k))}</span><p>${s ? esc(tx(s)) : esc(t('v.nostep'))}</p></li>`;
  }).join('');
  const rel = related(c);
  $('#v-body').innerHTML = `
    <div class="cid">${esc(c.id)} <span>${esc(t('v.case'))} · ${dateFmt(c.date)}</span></div>
    <h2 id="v-title">${esc(tx(c.title))}</h2>
    <p class="proc">${esc(tx(c.proc))}</p>
    <div class="tags">${tagsHtml(c)}</div>
    <ol class="tl">${steps}</ol>
    <p class="indiv">${esc(t('v.indiv'))}</p>
    <div class="v-cta"><a class="btn btn-teal" href="#book" data-book="${c.id}">${esc(t('v.cta'))}</a><a class="btn btn-ghost" href="tel:+998946511163">${esc(t('cta.call'))}</a></div>
    <a class="v-src" href="${esc(c.ig)}" target="_blank" rel="noopener">${esc(t('v.source'))}</a>
    <p class="fine" style="margin-top:0">${esc(t('st.consent'))} ${esc(t('foot.disc'))}</p>
    ${rel.length ? `<div class="v-rel"><h3>${esc(t('v.related'))}</h3><div class="rel">${rel.map(r => `<button type="button" data-open="${r.id}"><img src="${esc(r.thumb)}" alt="" loading="lazy"><span><b>${esc(r.id)}</b>${esc(tx(r.title))}</span></button>`).join('')}</div></div>` : ''}`;
  if (v.hidden) { v.hidden = false; document.body.classList.add('lock'); $('.v-close', v).focus(); }
  $('#sheet').scrollTop = 0; $('#v-body').scrollTop = 0;
  if (push) history.replaceState(null, '', `#case=${c.id}`);
}
function stepViewer(d) {
  if (!vCase) return;
  const list = vList.length ? vList : CASES;
  const i = list.indexOf(vCase);
  const n = list[(i + d + list.length) % list.length];
  openViewer(n.id);
}
function closeViewer() {
  const v = $('#viewer'); if (v.hidden) return;
  $$('video', v).forEach(x => x.pause());
  $('#v-media').innerHTML = '';
  v.hidden = true; document.body.classList.remove('lock'); vCase = null;
  history.replaceState(null, '', location.pathname + location.search);
  reel && reel.resume();
  vReturn && vReturn.focus && vReturn.focus();
}
$('#viewer').addEventListener('click', e => {
  if (e.target.closest('[data-close]')) return closeViewer();
  const s = e.target.closest('[data-vstep]'); if (s) return stepViewer(+s.dataset.vstep);
});
// focus trap
$('#viewer').addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  const f = $$('#viewer button, #viewer a, #viewer video[controls]').filter(x => x.offsetParent !== null);
  if (!f.length) return;
  if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
  else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
});
// touch swipe in viewer media (mobile)
(() => { let sx = 0, sy = 0; const m = $('#v-media');
  m.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  m.addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy; if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) stepViewer(dx < 0 ? 1 : -1); }, { passive: true });
})();

document.addEventListener('click', e => {
  const o = e.target.closest('[data-open]'); if (o) { e.preventDefault(); openViewer(o.dataset.open); return; }
  const b = e.target.closest('[data-book]');
  if (b) { setCaseRef(b.dataset.book); if (!$('#viewer').hidden) { closeViewer(); } }
});

// ---------- booking composer ----------
const form = $('#composer');
function setCaseRef(id) {
  const c = CASES.find(x => x.id === id); if (!c) return;
  caseRef = c;
  const map = { ear: 'ear', nose: 'nose', throat: 'throat', kids: 'child', skull: 'nose' };
  const r = form.querySelector(`input[name=area][value="${c.flags.includes('child') ? 'child' : map[c.area]}"]`); if (r) r.checked = true;
  renderCaseRef(); buildMsg();
}
function renderCaseRef() {
  $('#case-ref').hidden = !caseRef;
  if (caseRef) { $('#case-ref-id').textContent = caseRef.id; $('#case-ref-t').textContent = `${tx(caseRef.title)} — ${tx(caseRef.proc)}`; }
}
$('#case-ref-x').addEventListener('click', () => { caseRef = null; renderCaseRef(); buildMsg(); });
function buildMsg() {
  const fd = new FormData(form);
  const areaV = fd.get('area'); const cV = fd.get('contact');
  const lines = [t('msg.hello'), ''];
  const add = (k, v) => { if (v && String(v).trim()) lines.push(`${t(k)}: ${String(v).trim()}`); };
  add('msg.name', fd.get('name')); add('msg.phone', fd.get('phone')); add('msg.city', fd.get('city'));
  add('msg.area', areaV ? t('f.' + areaV) : '');
  if (caseRef) add('msg.case', `${caseRef.id} (${tx(caseRef.title)})`);
  add('msg.desc', fd.get('desc'));
  add('msg.contact', cV ? t('f.c.' + cV) : '');
  $('#msg').textContent = lines.join('\n');
  return lines.join('\n');
}
form.addEventListener('input', buildMsg);
form.addEventListener('submit', e => e.preventDefault());
async function copyMsg() {
  const text = buildMsg();
  try { await navigator.clipboard.writeText(text); }
  catch (_) { const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (__) {} ta.remove(); }
  const toast = $('#toast'); toast.textContent = t('book.copied'); clearTimeout(copyMsg.tm); copyMsg.tm = setTimeout(() => { toast.textContent = ''; }, 2600);
}
$('#copy').addEventListener('click', copyMsg);
$('#ig').addEventListener('click', () => { copyMsg(); });

// ---------- i18n apply ----------
function applyLang() {
  document.documentElement.lang = lang;
  document.title = t('meta.title');
  $$('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
  $$('[data-i18n-ph]').forEach(el => { el.placeholder = t(el.dataset.i18nPh); });
  $$('[data-i18n-aria]').forEach(el => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  $$('.lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
  if (!DATA) return;
  renderChips(); renderCounts(); renderNow(); renderGrid(true); renderMap(); renderNews(); buildMsg(); renderCaseRef();
  mcols = []; renderStories();
  if (vCase) openViewer(vCase.id, false);
}
$$('.lang button').forEach(b => b.addEventListener('click', () => {
  lang = b.dataset.lang; localStorage.setItem('v4lang', lang);
  const u = new URL(location.href); if (u.searchParams.has('lang')) { u.searchParams.set('lang', lang); history.replaceState(null, '', u); }
  applyLang();
}));

// ---------- boot ----------
applyLang();
(async () => {
  const res = await fetch('data/cases.json');
  DATA = await res.json();
  CASES = DATA.cases;
  filtered = CASES;
  applyLang();
  await initReel();
  apply();
  depthPass();
  const m = location.hash.match(/^#case=(LP-\d{3})$/); if (m) openViewer(m[1], false);
})();
