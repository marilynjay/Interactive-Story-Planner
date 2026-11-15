/* Story Planner — plan branching, interactive stories as a navigable map.
 *
 * Data model:
 *   story = { title, startId, scenes: { [id]: { id, title, text, notes, choices: [{ id, label, to }] } } }
 * A "scene" is one passage of the story; each "choice" leads to another scene.
 * The map shows the current scene, the scenes that lead into it, and a few
 * steps ahead. Clicking any scene moves there; Back/Forward work like a browser.
 */
(() => {
  'use strict';

  const STORAGE_KEY = 'storyPlanner.v1';
  const NODE_W = 200;
  const NODE_H = 66;
  const COL_GAP = 130;   // horizontal room between columns (for choice labels)
  const ROW_GAP = 22;
  const COL = NODE_W + COL_GAP;
  const ROW = NODE_H + ROW_GAP;
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XHTML_NS = 'http://www.w3.org/1999/xhtml';

  // ---------- State ----------
  let story;
  let currentId;
  let backStack = [];
  let fwdStack = [];
  let depth = 2;
  let positions = new Map();          // id -> {x, y} (top-left of node) in map coordinates
  const cam = { x: 0, y: 0, k: 1 };
  let camAnim = null;

  // ---------- Elements ----------
  const $ = (id) => document.getElementById(id);
  const svg = $('map');
  const camera = $('camera');
  const editor = $('editor');

  // ---------- Helpers ----------
  const uid = () => 's' + Math.random().toString(36).slice(2, 9);
  const scene = (id) => story.scenes[id];
  const titleOf = (id) => (scene(id)?.title || 'Untitled scene');
  const truncate = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

  function el(tag, attrs = {}, children = []) {
    const isSvg = ['svg', 'g', 'path', 'rect', 'text', 'foreignObject', 'title'].includes(tag);
    const node = isSvg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'text') node.textContent = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of [].concat(children)) if (c) node.append(c);
    return node;
  }

  function incomingTo(id) {
    const from = [];
    for (const s of Object.values(story.scenes)) {
      if (s.choices.some((c) => c.to === id)) from.push(s.id);
    }
    return from;
  }

  function reachableFromStart() {
    const seen = new Set();
    const queue = [story.startId];
    while (queue.length) {
      const id = queue.shift();
      if (!scene(id) || seen.has(id)) continue;
      seen.add(id);
      for (const c of scene(id).choices) queue.push(c.to);
    }
    return seen;
  }

  // ---------- Persistence ----------
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ story, currentId }));
    } catch { /* storage unavailable: keep working in memory */ }
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!isValidStory(data.story)) return false;
      story = data.story;
      currentId = scene(data.currentId) ? data.currentId : story.startId;
      return true;
    } catch {
      return false;
    }
  }

  function isValidStory(s) {
    return s && typeof s === 'object' && s.scenes && typeof s.scenes === 'object' && s.scenes[s.startId];
  }

  function normalizeStory(s) {
    for (const [id, sc] of Object.entries(s.scenes)) {
      sc.id = id;
      sc.title = sc.title ?? '';
      sc.text = sc.text ?? '';
      sc.notes = sc.notes ?? '';
      sc.choices = Array.isArray(sc.choices) ? sc.choices.filter((c) => s.scenes[c.to]) : [];
      for (const c of sc.choices) { c.id = c.id || uid(); c.label = c.label ?? ''; }
    }
    s.title = s.title || 'Untitled story';
    return s;
  }

  // ---------- Sample story ----------
  function sampleStory() {
    const S = (title, text, choices = []) => ({ title, text, notes: '', choices: choices.map(([label, to]) => ({ id: uid(), label, to })) });
    const scenes = {
      start: S('A Storm Arrives', 'You are the keeper of a lonely lighthouse. Thunder rolls in from the sea, and the lamp has gone dark.', [
        ['Light the lamp', 'lamp'], ['Go down to the shore', 'shore'], ['Hide in the cellar', 'cellar']]),
      lamp: S('The Lamp Room', 'You climb the spiral stairs. Through the rain-streaked glass you can just make out lights on the water.', [
        ['Signal the ship', 'signal'], ['Look through the telescope', 'telescope']]),
      shore: S('The Rocky Shore', 'Waves crash against the rocks. A figure is dragging herself out of the surf, and debris is washing up nearby.', [
        ['Help the stranger', 'stranger'], ['Search the wreckage', 'wreckage'], ['Go back inside', 'start']]),
      cellar: S('The Cellar', 'Damp and dark. Your grandfather\'s old sea trunk sits in the corner, its lock rusted.', [
        ['Open the old trunk', 'trunk'], ['Wait out the storm', 'morning']]),
      signal: S('A Ship Turns', 'The ship sees your light and swings away from the rocks.', [
        ['Keep signaling', 'rescue'], ['Go meet them at the shore', 'shore']]),
      telescope: S('Something in the Water', 'Not a ship — a lifeboat, capsized, and someone clinging to it.', [
        ['Run to the shore', 'shore'], ['Ring the warning bell', 'signal']]),
      stranger: S('The Stranger\'s Story', 'She says she was looking for this lighthouse. She knows your grandfather\'s name.', [
        ['Believe her', 'map'], ['Send her away', 'morning']]),
      wreckage: S('Wreckage', 'Among the splintered planks, a sealed iron box bearing the same crest as your grandfather\'s trunk.', [
        ['Pry open the box', 'trunk'], ['Leave it to the sea', 'morning']]),
      trunk: S('Grandfather\'s Trunk', 'Inside: a waterlogged logbook, and a key that doesn\'t fit any lock you know.', [
        ['Read the logbook', 'map']]),
      map: S('The Hidden Map', 'The pages describe a cove that only appears at the lowest tide of the year. That tide is tonight.', [
        ['Follow it before dawn', 'treasure'], ['Burn the map', 'morning']]),
      rescue: S('Rescue at Sea', 'ENDING — The crew is safe. The village remembers your name for generations.'),
      morning: S('A Calm Morning', 'ENDING — The storm passes. Whatever the night held, the sea keeps its secrets.'),
      treasure: S('What the Sea Kept', 'ENDING — In the cove, you find what your grandfather spent his life guarding.'),
    };
    for (const [id, sc] of Object.entries(scenes)) sc.id = id;
    return { title: 'The Lighthouse Keeper', startId: 'start', scenes };
  }

  function blankStory() {
    const id = uid();
    return {
      title: 'Untitled story',
      startId: id,
      scenes: { [id]: { id, title: 'Beginning', text: '', notes: '', choices: [] } },
    };
  }

  // ---------- Layout ----------
  // Builds a small tree around the current scene: scenes that lead in (left),
  // the current scene, and up to `depth` steps of choices ahead (right).
  function computeLayout() {
    const level = new Map([[currentId, 0]]);
    const treeKids = new Map();
    const treeParent = new Map();
    const order = [currentId];
    let frontier = [currentId];
    for (let d = 1; d <= depth; d++) {
      const next = [];
      for (const id of frontier) {
        const kids = [];
        for (const c of scene(id).choices) {
          if (!level.has(c.to)) {
            level.set(c.to, d);
            treeParent.set(c.to, id);
            kids.push(c.to);
            next.push(c.to);
            order.push(c.to);
          }
        }
        treeKids.set(id, kids);
      }
      frontier = next;
    }

    // Vertical placement: leaves stack top to bottom, parents center on their kids.
    const ys = new Map();
    let slot = 0;
    const place = (id) => {
      const kids = treeKids.get(id) || [];
      if (!kids.length) { ys.set(id, slot++ * ROW); return; }
      kids.forEach(place);
      ys.set(id, (ys.get(kids[0]) + ys.get(kids[kids.length - 1])) / 2);
    };
    place(currentId);
    const shift = ys.get(currentId);

    const pos = new Map();
    for (const id of order) {
      pos.set(id, { x: level.get(id) * COL, y: ys.get(id) - shift, level: level.get(id) });
    }

    // Scenes leading into the current one, placed in a column on the left.
    const parents = incomingTo(currentId).filter((id) => !pos.has(id));
    parents.forEach((id, i) => {
      pos.set(id, { x: -COL, y: (i - (parents.length - 1) / 2) * ROW, level: -1 });
    });

    return { pos, parents, treeParent };
  }

  // ---------- Map rendering ----------
  function renderMap() {
    const { pos, parents, treeParent } = computeLayout();
    positions = pos;
    camera.replaceChildren();

    const edgeLayer = el('g');
    const labelLayer = el('g');
    const nodeLayer = el('g');
    camera.append(edgeLayer, nodeLayer, labelLayer);

    // Column headers
    const levels = new Set([...pos.values()].map((p) => p.level));
    const minY = Math.min(...[...pos.values()].map((p) => p.y));
    const headers = { '-1': 'Comes from', 0: 'You are here', 1: '1 step ahead', 2: '2 steps ahead', 3: '3 steps ahead' };
    for (const lv of levels) {
      edgeLayer.append(el('text', { class: 'col-label', x: lv * COL + 4, y: minY - 18, text: headers[lv] }));
    }

    // Edges. To keep the map readable, only these connections are drawn:
    //  - the branching tree itself, plus anything into or out of the current scene
    //  - "merges" one column to the right
    // Other links (loops between far-off scenes) are counted in the node's "+N" badge.
    const notDrawn = new Map();
    for (const [id, p] of pos) {
      let hidden = 0;
      for (const c of scene(id).choices) {
        const q = pos.get(c.to);
        const touchesCurrent = id === currentId || c.to === currentId;
        const show = q && (p.level === -1
          ? c.to === currentId
          : treeParent.get(c.to) === id || touchesCurrent || q.level === p.level + 1);
        if (show) drawEdge(edgeLayer, labelLayer, id, p, c, q, treeParent.get(c.to) === id);
        else hidden++;
      }
      notDrawn.set(id, hidden);
    }

    // Nodes
    for (const [id, p] of pos) nodeLayer.append(drawNode(id, p, notDrawn.get(id)));
  }

  function drawEdge(edgeLayer, labelLayer, fromId, p, choice, q, isTree) {
    const forward = q.level > p.level;
    const fromCurrent = fromId === currentId;
    const toCurrentFromParent = p.level === -1;
    let d, lx, ly;

    if (forward) {
      const x1 = p.x + NODE_W, y1 = p.y + NODE_H / 2;
      const x2 = q.x, y2 = q.y + NODE_H / 2;
      const dx = Math.max(40, (x2 - x1) / 2);
      d = `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2 - 4},${y2}`;
      // Label sits near the source end so labels from one scene line up neatly.
      const t = q.level - p.level > 1 ? 0.5 : 0.42;
      [lx, ly] = bezierPoint([x1, y1], [x1 + dx, y1], [x2 - dx, y2], [x2, y2], t);
    } else {
      // Loops back to an earlier (or same-column) scene: arc over the top.
      const x1 = p.x + NODE_W / 2, y1 = p.y;
      const x2 = q.x + NODE_W / 2 + (x1 === q.x + NODE_W / 2 ? 30 : 0), y2 = q.y;
      const lift = 60 + Math.abs(x1 - x2) * 0.12 + Math.abs(y1 - y2) * 0.2;
      const top = Math.min(y1, y2) - lift;
      d = `M${x1},${y1} C${x1},${top} ${x2},${top} ${x2},${y2 - 4}`;
      [lx, ly] = bezierPoint([x1, y1], [x1, top], [x2, top], [x2, y2], 0.5);
    }

    const cls = ['edge', forward ? '' : 'loop', forward && !isTree && !fromCurrent ? 'cross' : '', fromCurrent ? 'hot' : '', toCurrentFromParent ? 'incoming' : ''].join(' ');
    edgeLayer.append(el('path', { d, class: cls, 'marker-end': forward ? 'url(#arrow)' : 'url(#arrow-loop)' }));

    if (toCurrentFromParent) return; // keep the left side uncluttered
    const label = (choice.label || '(unnamed choice)') + (forward ? '' : ' ↺');
    const text = truncate(label, fromCurrent ? 24 : 18);
    const w = text.length * 6.3 + 14;
    labelLayer.append(el('g', {
      class: 'edge-label' + (forward ? '' : ' loop'),
      transform: `translate(${lx - w / 2},${ly - 10})`,
      onclick: (e) => { if (!wasDrag()) { e.stopPropagation(); navigate(choice.to); } },
    }, [
      el('title', {}, [document.createTextNode(`${label} → ${titleOf(choice.to)}`)]),
      el('rect', { width: w, height: 20, rx: 10 }),
      el('text', { x: w / 2, y: 14, 'text-anchor': 'middle', text }),
    ]));
  }

  function bezierPoint(a, b, c, d, t) {
    const mt = 1 - t;
    const f = (i) => mt ** 3 * a[i] + 3 * mt ** 2 * t * b[i] + 3 * mt * t ** 2 * c[i] + t ** 3 * d[i];
    return [f(0), f(1)];
  }

  function drawNode(id, p, hidden) {
    const s = scene(id);
    const isStart = id === story.startId;
    const isEnding = s.choices.length === 0;
    const classes = ['node', id === currentId ? 'current' : '', p.level === -1 ? 'parent' : ''].join(' ');

    const card = document.createElementNS(XHTML_NS, 'div');
    card.className = 'card';
    if (isStart || isEnding) {
      const tag = document.createElementNS(XHTML_NS, 'div');
      tag.className = 'tag ' + (isStart ? 'start' : 'ending');
      tag.textContent = isStart ? 'Start' : 'Ending';
      card.append(tag);
    }
    const t = document.createElementNS(XHTML_NS, 'div');
    t.className = 't';
    t.textContent = s.title || 'Untitled scene';
    card.append(t);
    if (!isEnding) {
      const sub = document.createElementNS(XHTML_NS, 'div');
      sub.className = 's';
      sub.textContent = `${s.choices.length} choice${s.choices.length === 1 ? '' : 's'}`;
      card.append(sub);
    }

    const fo = el('foreignObject', { width: NODE_W, height: NODE_H });
    fo.append(card);

    const g = el('g', {
      class: classes,
      transform: `translate(${p.x},${p.y})`,
      tabindex: 0,
      role: 'button',
      'aria-label': `Go to scene: ${s.title || 'Untitled scene'}`,
      onclick: () => { if (!wasDrag()) navigate(id); },
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(id); } },
    }, [el('title', {}, [document.createTextNode(s.text ? truncate(s.text, 200) : s.title)]), fo]);

    // "+N more" badge: choices that lead beyond what's on screen.
    if (hidden > 0) {
      const label = `+${hidden} ›`;
      const w = label.length * 7 + 12;
      g.append(el('g', { class: 'more-badge', transform: `translate(${NODE_W - w / 2},${-9})` }, [
        el('title', {}, [document.createTextNode(`${hidden} more connection${hidden === 1 ? '' : 's'} not shown — click to go here and see them`)]),
        el('rect', { width: w, height: 18, rx: 9 }),
        el('text', { x: w / 2, y: 13, 'text-anchor': 'middle', text: label }),
      ]));
    }
    return g;
  }

  // ---------- Camera (pan / zoom) ----------
  function applyCamera() {
    camera.setAttribute('transform', `translate(${cam.x},${cam.y}) scale(${cam.k})`);
  }

  function targetCamera() {
    const rect = svg.getBoundingClientRect();
    const all = [...positions.values()];
    const minX = Math.min(...all.map((p) => p.x)), maxX = Math.max(...all.map((p) => p.x)) + NODE_W;
    const minY = Math.min(...all.map((p) => p.y)) - 40, maxY = Math.max(...all.map((p) => p.y)) + NODE_H;
    const pad = 40;
    const k = Math.max(0.45, Math.min(1, (rect.width - pad * 2) / (maxX - minX), (rect.height - pad * 2) / (maxY - minY)));
    let x = rect.width / 2 - k * (minX + maxX) / 2;
    let y = rect.height / 2 - k * (minY + maxY) / 2;
    // Never let the current scene end up off screen.
    const cur = positions.get(currentId);
    const cx = x + k * cur.x, cy = y + k * cur.y;
    if (cx < pad) x += pad - cx;
    if (cx + k * NODE_W > rect.width - pad) x -= cx + k * NODE_W - (rect.width - pad);
    if (cy < pad) y += pad - cy;
    if (cy + k * NODE_H > rect.height - pad) y -= cy + k * NODE_H - (rect.height - pad);
    return { x, y, k };
  }

  function animateCamera(to, ms = 380) {
    cancelAnimationFrame(camAnim);
    const from = { ...cam };
    const t0 = performance.now();
    const ease = (t) => 1 - (1 - t) ** 3;
    const step = (now) => {
      const t = Math.min(1, (now - t0) / ms);
      const e = ease(t);
      cam.x = from.x + (to.x - from.x) * e;
      cam.y = from.y + (to.y - from.y) * e;
      cam.k = from.k + (to.k - from.k) * e;
      applyCamera();
      if (t < 1) camAnim = requestAnimationFrame(step);
    };
    camAnim = requestAnimationFrame(step);
  }

  function recenter(animate = true) {
    const t = targetCamera();
    if (animate) animateCamera(t); else { Object.assign(cam, t); applyCamera(); }
  }

  // Dragging / zooming. One finger (or mouse) pans; two fingers pinch-zoom.
  const pointers = new Map();   // pointerId -> {x, y}
  let drag = null;
  let pinch = null;
  let lastDragMoved = false;
  const wasDrag = () => lastDragMoved;

  function zoomAt(mx, my, k) {
    k = Math.max(0.25, Math.min(2.5, k));
    cam.x = mx - (mx - cam.x) * (k / cam.k);
    cam.y = my - (my - cam.y) * (k / cam.k);
    cam.k = k;
  }

  function startPinch() {
    const [a, b] = [...pointers.values()];
    pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, k: cam.k, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, cx: cam.x, cy: cam.y };
  }

  svg.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelAnimationFrame(camAnim);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      drag = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y, moved: false, id: e.pointerId };
      lastDragMoved = false;
    } else if (pointers.size === 2) {
      for (const id of pointers.keys()) { try { svg.setPointerCapture(id); } catch { /* pointer already gone */ } }
      if (drag) drag.moved = true;  // a pinch is never a tap
      startPinch();
    }
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const rect = svg.getBoundingClientRect();
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      // Restore the camera from pinch start, move with the fingers' midpoint, then zoom around it.
      cam.k = pinch.k;
      cam.x = pinch.cx + (mx - pinch.mx);
      cam.y = pinch.cy + (my - pinch.my);
      zoomAt(mx - rect.left, my - rect.top, pinch.k * Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist);
      applyCamera();
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
    if (!drag.moved && Math.hypot(dx, dy) > 6) {
      drag.moved = true;
      try { svg.setPointerCapture(drag.id); } catch { /* pointer already gone */ }
      svg.classList.add('dragging');
    }
    if (drag.moved) {
      cam.x = drag.cx + dx;
      cam.y = drag.cy + dy;
      applyCamera();
    }
  });
  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) {
      pinch = null;
      // Keep panning smoothly with the finger that's still down.
      const rest = [...pointers.entries()][0];
      if (rest) drag = { sx: rest[1].x, sy: rest[1].y, cx: cam.x, cy: cam.y, moved: true, id: rest[0] };
    }
    if (pointers.size === 0 && drag) {
      lastDragMoved = drag.moved;
      svg.classList.remove('dragging');
      drag = null;
    }
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    cancelAnimationFrame(camAnim);
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    zoomAt(mx, my, cam.k * Math.exp(-e.deltaY * 0.0015));
    applyCamera();
  }, { passive: false });

  // ---------- Navigation ----------
  function navigate(id, { fromHistory = null } = {}) {
    if (!scene(id)) return;
    if (id === currentId) { recenter(); return; }

    // Remember where the destination is on screen, so the map can glide from there.
    const old = positions.get(id);
    const screenX = old ? cam.x + cam.k * old.x : null;
    const screenY = old ? cam.y + cam.k * old.y : null;

    if (fromHistory === 'back') fwdStack.push(currentId);
    else if (fromHistory === 'forward') backStack.push(currentId);
    else { backStack.push(currentId); fwdStack = []; }
    currentId = id;
    save();

    renderMap();
    renderChrome();
    renderEditor();

    const target = targetCamera();
    if (old) {
      const now = positions.get(id);
      cam.k = target.k;
      cam.x = screenX - cam.k * now.x;
      cam.y = screenY - cam.k * now.y;
      applyCamera();
    }
    animateCamera(target);
  }

  function goBack() {
    // Skip over scenes that were deleted since we visited them.
    while (backStack.length && !scene(backStack[backStack.length - 1])) backStack.pop();
    if (backStack.length) navigate(backStack.pop(), { fromHistory: 'back' });
  }
  function goForward() {
    while (fwdStack.length && !scene(fwdStack[fwdStack.length - 1])) fwdStack.pop();
    if (fwdStack.length) navigate(fwdStack.pop(), { fromHistory: 'forward' });
  }

  // ---------- Top bar, trail, jump list ----------
  function renderChrome() {
    $('backBtn').disabled = !backStack.some((id) => scene(id));
    $('fwdBtn').disabled = !fwdStack.some((id) => scene(id));
    $('startBtn').disabled = currentId === story.startId;
    if (document.activeElement !== $('storyTitle')) $('storyTitle').value = story.title;
    document.title = `${story.title} — Story Planner`;

    // Jump-to list
    const reachable = reachableFromStart();
    const sel = $('jumpSelect');
    sel.replaceChildren(el('option', { value: '', text: `Jump to a scene… (${Object.keys(story.scenes).length})` }));
    const sorted = Object.values(story.scenes).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    for (const s of sorted) {
      const flags = [s.id === story.startId ? 'start' : '', s.choices.length === 0 ? 'ending' : '', reachable.has(s.id) ? '' : 'unreachable'].filter(Boolean);
      sel.append(el('option', { value: s.id, text: (s.title || 'Untitled scene') + (flags.length ? `  (${flags.join(', ')})` : '') }));
    }
    sel.value = '';

    // Breadcrumb trail of recent history
    const trail = $('trail');
    trail.replaceChildren();
    const recent = backStack.filter((id) => scene(id)).slice(-6);
    if (backStack.length > recent.length) trail.append(el('span', { text: '…' }));
    recent.forEach((id, i) => {
      const stepsBack = recent.length - i;
      trail.append(el('button', {
        text: truncate(titleOf(id), 28),
        title: `Go back ${stepsBack} step${stepsBack === 1 ? '' : 's'}`,
        onclick: () => { for (let n = 0; n < stepsBack; n++) goBackSilently(); finishJump(); },
      }));
      trail.append(el('span', { text: '›' }));
    });
    trail.append(el('span', { class: 'here', text: truncate(titleOf(currentId), 40) }));
  }

  // Used by the breadcrumb trail to step back several times with one animation.
  let pendingJumpFrom = null;
  function goBackSilently() {
    while (backStack.length && !scene(backStack[backStack.length - 1])) backStack.pop();
    if (!backStack.length) return;
    if (pendingJumpFrom === null) pendingJumpFrom = currentId;
    fwdStack.push(currentId);
    currentId = backStack.pop();
  }
  function finishJump() {
    if (pendingJumpFrom === null) return;
    const dest = currentId;
    currentId = pendingJumpFrom;
    pendingJumpFrom = null;
    // Re-route through navigate() for the animation, without double-pushing history.
    const savedBack = backStack.slice(), savedFwd = fwdStack.slice();
    navigate(dest);
    backStack = savedBack;
    fwdStack = savedFwd;
    renderChrome();
  }

  // ---------- Editor panel ----------
  function renderEditor() {
    const s = scene(currentId);
    editor.replaceChildren();

    editor.append(el('h2', { text: currentId === story.startId ? 'Start scene' : (s.choices.length ? 'Scene' : 'Ending scene') }));

    const titleInput = el('input', { type: 'text', value: s.title, placeholder: 'Scene title', 'aria-label': 'Scene title' });
    titleInput.addEventListener('input', () => { s.title = titleInput.value; changed(); });
    editor.append(el('div', { class: 'field' }, [titleInput]));

    const text = el('textarea', { placeholder: 'What happens in this scene?', 'aria-label': 'Scene text' });
    text.value = s.text;
    text.addEventListener('input', () => { s.text = text.value; changed(); });
    editor.append(el('div', { class: 'field' }, [el('label', { text: 'Story text' }), text]));

    const notes = el('textarea', { class: 'notes', placeholder: 'Private notes, ideas, things to fix…', 'aria-label': 'Notes' });
    notes.value = s.notes || '';
    notes.addEventListener('input', () => { s.notes = notes.value; changed(false); });
    editor.append(el('div', { class: 'field' }, [el('label', { text: 'Notes' }), notes]));

    // Choices
    editor.append(el('h2', { text: `Choices (${s.choices.length})` }));
    if (!s.choices.length) editor.append(el('p', { class: 'muted', text: 'No choices yet — this scene is an ending. Add a choice to keep the story going.' }));

    const sortedScenes = Object.values(story.scenes).sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    s.choices.forEach((c, i) => {
      const label = el('input', { type: 'text', value: c.label, placeholder: 'What the reader chooses', 'aria-label': 'Choice text', style: 'font-size:14px;font-weight:500' });
      label.addEventListener('input', () => { c.label = label.value; changed(); });

      const target = el('select', { 'aria-label': 'Leads to' });
      for (const o of sortedScenes) {
        if (o.id === currentId) continue;
        target.append(el('option', { value: o.id, text: '→ ' + (o.title || 'Untitled scene') }));
      }
      if (c.to === currentId) target.prepend(el('option', { value: currentId, text: '→ (this scene)' }));
      target.value = c.to;
      target.addEventListener('change', () => { c.to = target.value; changed(); });

      const up = el('button', { text: '↑', title: 'Move up', disabled: i === 0, onclick: () => { moveChoice(s, i, -1); } });
      const go = el('button', { class: 'go primary', text: 'Go →', title: 'Go to this scene', onclick: () => navigate(c.to) });
      const del = el('button', { class: 'danger', text: '✕', title: 'Remove this choice', onclick: () => {
        s.choices.splice(i, 1); changed(); renderEditor();
      } });

      editor.append(el('div', { class: 'choice' }, [
        el('div', { class: 'row' }, [label, up, del]),
        el('div', { class: 'row' }, [target, go]),
      ]));
    });

    const others = Object.keys(story.scenes).filter((id) => id !== currentId);
    editor.append(el('div', { class: 'choice-actions' }, [
      el('button', { class: 'primary', text: '+ Choice → new scene', onclick: () => addChoice(true) }),
      el('button', { text: '+ Link to existing scene', disabled: !others.length, onclick: () => addChoice(false) }),
    ]));

    // Where this scene is reached from
    const from = incomingTo(currentId);
    editor.append(el('h2', { text: 'Reached from' }));
    if (!from.length) {
      editor.append(el('p', { class: 'muted', text: currentId === story.startId ? 'This is where the story begins.' : 'Nothing leads here yet — readers can\'t reach this scene.' }));
    } else {
      editor.append(el('div', { class: 'from-list' }, from.map((id) =>
        el('button', { class: 'chip', text: '← ' + truncate(titleOf(id), 30), onclick: () => navigate(id) }))));
    }

    // Scene actions
    editor.append(el('div', { class: 'scene-actions' }, [
      el('button', { text: 'Set as start', disabled: currentId === story.startId, onclick: () => { story.startId = currentId; changed(); renderEditor(); } }),
      el('button', { class: 'danger', text: 'Delete scene', disabled: currentId === story.startId, title: currentId === story.startId ? 'The start scene can\'t be deleted' : '', onclick: deleteScene }),
    ]));
  }

  function moveChoice(s, i, dir) {
    const j = i + dir;
    if (j < 0 || j >= s.choices.length) return;
    [s.choices[i], s.choices[j]] = [s.choices[j], s.choices[i]];
    changed();
    renderEditor();
  }

  function addChoice(newScene) {
    const s = scene(currentId);
    let to;
    if (newScene) {
      to = uid();
      story.scenes[to] = { id: to, title: 'New scene', text: '', notes: '', choices: [] };
    } else {
      to = Object.keys(story.scenes).find((id) => id !== currentId && !s.choices.some((c) => c.to === id))
        || Object.keys(story.scenes).find((id) => id !== currentId);
    }
    s.choices.push({ id: uid(), label: '', to });
    changed();
    renderEditor();
    const inputs = editor.querySelectorAll('.choice input');
    inputs[inputs.length - 1]?.focus();
  }

  function deleteScene() {
    const id = currentId;
    const s = scene(id);
    const n = incomingTo(id).length;
    const msg = `Delete "${s.title || 'Untitled scene'}"?` + (n ? `\n\n${n} choice${n === 1 ? '' : 's'} leading here will also be removed.` : '');
    if (!confirm(msg)) return;
    for (const other of Object.values(story.scenes)) other.choices = other.choices.filter((c) => c.to !== id);
    delete story.scenes[id];
    backStack = backStack.filter((x) => x !== id);
    fwdStack = fwdStack.filter((x) => x !== id);
    const dest = backStack.length ? backStack.pop() : story.startId;
    currentId = dest;
    save();
    renderAll();
  }

  // Called after any edit. Re-draws the map and top bar but not the editor (so typing isn't interrupted).
  function changed(redraw = true) {
    save();
    if (redraw) { renderMap(); renderChrome(); }
  }

  function renderAll() {
    renderMap();
    renderChrome();
    renderEditor();
    recenter(false);
  }

  // ---------- Top bar wiring ----------
  $('backBtn').onclick = goBack;
  $('fwdBtn').onclick = goForward;
  $('startBtn').onclick = () => navigate(story.startId);
  $('recenterBtn').onclick = () => recenter();
  $('jumpSelect').onchange = (e) => { if (e.target.value) navigate(e.target.value); };
  $('depthSelect').onchange = (e) => { depth = Number(e.target.value); renderMap(); recenter(); };
  $('storyTitle').oninput = (e) => { story.title = e.target.value; save(); document.title = `${story.title} — Story Planner`; };

  $('newBtn').onclick = () => {
    if (!confirm('Start a new, empty story? Your current story will be replaced — export it first if you want to keep it.')) return;
    story = blankStory();
    currentId = story.startId;
    backStack = []; fwdStack = [];
    save();
    renderAll();
  };

  $('exportBtn').onclick = () => {
    const blob = new Blob([JSON.stringify(story, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: (story.title || 'story').replace(/[^\w\- ]+/g, '').trim() + '.json' });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  $('importBtn').onclick = () => $('importFile').click();
  $('importFile').onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!isValidStory(data)) throw new Error('missing scenes or start scene');
      story = normalizeStory(data);
      currentId = story.startId;
      backStack = []; fwdStack = [];
      save();
      renderAll();
    } catch (err) {
      alert('Couldn\'t import that file: ' + err.message);
    }
  };

  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); goBack(); }
    if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); goForward(); }
  });

  window.addEventListener('resize', () => recenter(false));

  // ---------- Boot ----------
  if (!load()) {
    story = sampleStory();
    currentId = story.startId;
  }
  story = normalizeStory(story);
  renderAll();
})();
