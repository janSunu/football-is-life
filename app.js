(function () {
  'use strict';
  const L = window.League;

  // Where data.json lives. On GitHub Pages this is read from the address,
  // so the fallback only matters when the page is opened somewhere else.
  const FALLBACK = { owner: '', repo: '' };
  const BRANCH = 'main';
  const DATA_PATH = 'data.json';
  const TOKEN_KEY = 'lunchleague.token';
  const TAB_KEY = 'lunchleague.tab';
  const DEFAULT_LEAGUE = { name: '경신 런치리그', sub: '2학년', season: '2026년 2학기' };
  const TABS = ['fixtures', 'table', 'bracket', 'stats'];
  const ROUNDS = [
    { key: 'MW1', title: 'Matchweek 1', ids: ['M1', 'M2', 'M3'] },
    { key: 'MW2', title: 'Matchweek 2', ids: ['M4', 'M5', 'M6'] },
    { key: 'MW3', title: 'Matchweek 3', ids: ['M7', 'M8', 'M9'] },
    { key: 'SF', title: '준결승', ids: ['SF1', 'SF2'] },
    { key: 'F', title: '결승', ids: ['F'] },
  ];
  const PEN_ROUNDS = 5;

  function detectRepo() {
    const host = location.hostname;
    if (host.endsWith('.github.io')) {
      const owner = host.split('.')[0];
      const first = location.pathname.split('/').filter(Boolean)[0];
      return { owner, repo: first && !first.includes('.') ? first : `${owner}.github.io` };
    }
    return FALLBACK;
  }
  const REPO = detectRepo();

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* storage off */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* storage off */ } },
  };

  const savedTab = store.get(TAB_KEY);
  const state = {
    data: null,
    view: null,
    teams: {},
    tab: TABS.includes(savedTab) ? savedTab : 'fixtures',
    round: null,
    token: store.get(TOKEN_KEY),
    scrolled: false,
  };

  // ---------- small helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const WD = ['일', '월', '화', '수', '목', '금', '토'];
  const DEFAULT_COLOR = {
    1: '#c0392b', 2: '#2b6cb0', 3: '#d97706', 4: '#0f766e', 5: '#7c3aed',
    6: '#be185d', 7: '#4d7c0f', 8: '#475569', 9: '#b45309',
  };
  const SWATCHES = [
    '#c0392b', '#e4572e', '#d97706', '#eab308', '#4d7c0f', '#16a34a', '#0f766e', '#0891b2',
    '#2b6cb0', '#1e3a8a', '#7c3aed', '#be185d', '#475569', '#111111', '#f4f4f4', '#8b5e34',
  ];

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const validColor = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  const validLogo = s => typeof s === 'string' && /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/.test(s);
  const range = n => Array.from({ length: n }, (_, i) => i);

  function todayStr() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  }
  function parts(s) { const [y, m, d] = s.split('-').map(Number); return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; }
  function fmtLong(s) { const p = parts(s); return `${p.m}월 ${p.d}일 ${WD[p.wd]}요일`; }
  function fmtShort(s) { const p = parts(s); return `${p.m}월 ${p.d}일 (${WD[p.wd]})`; }
  function fmtDot(s) { const p = parts(s); return `${p.m}.${String(p.d).padStart(2, '0')} (${WD[p.wd]})`; }
  function dayDiff(s) { return Math.round((Date.parse(s) - Date.parse(todayStr())) / 86400000); }
  function relDay(s) {
    const n = dayDiff(s);
    return n === 0 ? '오늘' : n === 1 ? '내일' : n === -1 ? '어제' : '';
  }

  // ---------- colors ----------
  function rgb(hex) { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
  function lum(hex) {
    return rgb(hex).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
      .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  }
  function mix(hex, other, t) {
    const a = rgb(hex), b = rgb(other);
    return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }
  function rgba(hex, a) { return `rgba(${rgb(hex).join(',')},${a})`; }
  // Text color on top of the team color, plus versions of the color that stay
  // visible as lines on a dark page (too dark) and a light page (too light).
  function tones(hex) {
    const l = lum(hex);
    return {
      c: hex,
      on: l > 0.36 ? '#141414' : '#ffffff',
      dk: l < 0.06 ? mix(hex, '#ffffff', 0.5) : hex,
      lt: l > 0.7 ? mix(hex, '#000000', 0.4) : hex,
    };
  }
  function pageDark() {
    const t = document.documentElement.dataset.theme;
    if (t) return t === 'dark';
    return matchMedia('(prefers-color-scheme: dark)').matches;
  }
  // Strength of a team tint so very light colors do not glare on a dark page
  // and very dark ones do not muddy a light page.
  function tint(hex) {
    const l = lum(hex);
    if (pageDark()) return l > 0.5 ? 0.22 : 0.55;
    return l < 0.08 ? 0.28 : 0.45;
  }
  function lineColor(hex) { const t = tones(hex); return pageDark() ? t.dk : t.lt; }
  function tcVars(hex) {
    const t = tones(hex);
    return `--tc:${t.c};--tc-on:${t.on};--tc-dk:${t.dk};--tc-lt:${t.lt}`;
  }
  // A version of the team color deep enough to carry white text.
  function deep(hex) {
    const l = lum(hex);
    if (l > 0.5) return mix(hex, '#000000', 0.55);
    if (l > 0.25) return mix(hex, '#000000', 0.3);
    if (l < 0.02) return mix(hex, '#ffffff', 0.1);
    return hex;
  }

  // ---------- teams ----------
  function classNo(id) { return Number(id.split('-')[1]); }
  function teamObj(id) { return state.teams[id] || { id }; }
  function rawName(id) { const t = teamObj(id); return (t.name && t.name.trim()) || `2학년 ${classNo(id)}반`; }
  function teamName(id) { return esc(rawName(id)); }
  // Compact name for tight rows: the custom name, or just the class.
  function teamShort(id) { const t = teamObj(id); return esc((t.name && t.name.trim()) || `${classNo(id)}반`); }
  function colorOf(id) { const c = teamObj(id).color; return validColor(c) ? c : DEFAULT_COLOR[classNo(id)] || '#666666'; }
  function logoOf(id) { const l = teamObj(id).logo; return validLogo(l) ? l : null; }

  function crestFor(t, size = '') {
    if (t.logo) return `<span class="crest logo ${size}"><img src="${t.logo}" alt=""></span>`;
    return `<span class="crest tc ${size}" style="${tcVars(t.color)}">${t.no}</span>`;
  }
  function teamLook(id) { return { no: classNo(id), color: colorOf(id), logo: logoOf(id), name: teamName(id) }; }
  function crest(id, size) { return crestFor(teamLook(id), size); }
  function phCrest(text, size = '') { return `<span class="crest ph ${size}">${text}</span>`; }

  function leagueInfo() {
    const lg = (state.data && state.data.league) || {};
    return {
      name: (lg.name && lg.name.trim()) || DEFAULT_LEAGUE.name,
      logo: validLogo(lg.logo) ? lg.logo : null,
    };
  }

  function stageLabel(m) {
    if (m.stage === 'group') return `${m.group}조`;
    if (m.stage === 'sf') return m.id === 'SF1' ? '준결승 1' : '준결승 2';
    return '결승';
  }
  function roundOf(m) { return ROUNDS.find(r => r.ids.includes(m.id)); }
  function matchTitle(m) {
    return m.stage === 'group' ? `${roundOf(m).title}  ${m.group}조` : stageLabel(m);
  }
  function commitTitle(m) { return m.stage === 'group' ? `${m.group}조 ${m.no}경기` : stageLabel(m); }

  // Teams playing a match: fixed for group games, resolved for knockouts.
  function sidesOf(m) {
    if (m.stage === 'group') return { home: { team: m.home }, away: { team: m.away } };
    return state.view.sides[m.id];
  }
  function slotView(slot, size, short) {
    if (slot.team) return { id: slot.team, name: short ? teamShort(slot.team) : teamName(slot.team), crest: crest(slot.team, size), cls: '' };
    if (slot.unknown) return { name: '?', crest: phCrest('?', size), cls: 'ph' };
    return { name: slot.label, crest: phCrest('', size), cls: 'ph' };
  }
  function winnerSide(m) {
    if (!L.isScored(m)) return null;
    if (m.hs !== m.as) return m.hs > m.as ? 'home' : 'away';
    if (Number.isInteger(m.hp) && Number.isInteger(m.ap) && m.hp !== m.ap) return m.hp > m.ap ? 'home' : 'away';
    return null;
  }
  function hasPk(m) { return L.isScored(m) && m.stage !== 'group' && m.hs === m.as && Number.isInteger(m.hp) && Number.isInteger(m.ap); }
  const isAdmin = () => !!state.token;
  const byNo = (a, b) => a.no - b.no;
  const byDate = (a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.no - b.no;

  const ICON = {
    pen: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>',
    trophy: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3V3zm0 4H6v1a2 2 0 0 0 1 1.7V7zm10 0v2.7A2 2 0 0 0 18 8V7h-1z"/></svg>',
    chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    left: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
    right: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
    ball: '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M12 7.2l4.2 3-1.6 4.9H9.4L7.8 10.2z" fill="var(--card)"/></svg>',
    check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    cross: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  // ---------- data ----------
  async function gh(path, opts = {}) {
    return fetch(`https://api.github.com${path}`, {
      ...opts,
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        Authorization: `Bearer ${state.token}`,
        ...(opts.headers || {}),
      },
    });
  }
  function b64decode(s) {
    const bin = atob(s.replace(/\n/g, ''));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }
  function b64encode(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  async function readRemote() {
    const res = await gh(`/repos/${REPO.owner}/${REPO.repo}/contents/${DATA_PATH}?ref=${BRANCH}&t=${Date.now()}`);
    if (!res.ok) throw new Error(res.status === 401 ? '토큰이 만료됐거나 잘못됨.' : `불러오기 실패 (${res.status})`);
    const j = await res.json();
    let text;
    if (j.content) text = b64decode(j.content);
    else {
      // Files over 1 MB come back without content; fetch the raw blob instead.
      const raw = await gh(`/repos/${REPO.owner}/${REPO.repo}/contents/${DATA_PATH}?ref=${BRANCH}`, { headers: { Accept: 'application/vnd.github.raw+json' } });
      text = await raw.text();
    }
    return { data: JSON.parse(text), sha: j.sha };
  }
  function serialize(d) {
    // One team or match per line keeps the commit diffs readable.
    const line = t => '    ' + JSON.stringify(t).replace(/,"/g, ', "').replace(/":/g, '": ').replace(/^\{/, '{ ').replace(/\}$/, ' }');
    return '{\n' +
      `  "updatedAt": ${JSON.stringify(d.updatedAt)},\n` +
      `  "league": ${JSON.stringify(d.league || {})},\n` +
      '  "teams": [\n' + d.teams.map(line).join(',\n') + '\n  ],\n' +
      '  "matches": [\n' + d.matches.map(line).join(',\n') + '\n  ],\n' +
      `  "lots": ${JSON.stringify(d.lots || {})}\n}\n`;
  }

  async function load() {
    try {
      let data;
      if (isAdmin() && REPO.owner) {
        try { data = (await readRemote()).data; }
        catch (e) { status(e.message + ' 관리자 메뉴에서 다시 로그인 필요.', true); }
      }
      if (!data) {
        const res = await fetch(`${DATA_PATH}?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`불러오기 실패 (${res.status})`);
        data = await res.json();
      }
      setData(data);
    } catch (e) {
      status(e.message, true);
      if (!state.data) $('#fixtures').innerHTML = '<div class="card"><p class="empty">경기 정보를 불러오지 못함.</p></div>';
    }
  }
  function setData(data) {
    data.lots = data.lots || {};
    data.league = data.league || {};
    state.data = data;
    state.teams = Object.fromEntries(data.teams.map(t => [t.id, t]));
    state.view = L.compute(data);
    if (state.round === null) state.round = defaultRound();
    render();
  }

  // Applies a change to the latest copy on GitHub and commits it.
  async function save(mutate, message) {
    status('저장 중...');
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data, sha } = await readRemote();
      data.lots = data.lots || {};
      data.league = data.league || {};
      mutate(data);
      data.updatedAt = new Date().toISOString();
      const res = await gh(`/repos/${REPO.owner}/${REPO.repo}/contents/${DATA_PATH}`, {
        method: 'PUT',
        body: JSON.stringify({ message, content: b64encode(serialize(data)), sha, branch: BRANCH }),
      });
      if (res.ok) {
        setData(data);
        status('저장함. 다른 사람 화면에는 1분쯤 뒤에 반영됨.');
        return true;
      }
      if (res.status === 409 || res.status === 422) continue; // someone saved in between
      if (res.status === 401 || res.status === 403) throw new Error('저장 권한이 없음. 토큰의 Contents 쓰기 권한 확인 필요.');
      throw new Error(`저장 실패 (${res.status})`);
    }
    throw new Error('저장이 겹침. 잠시 뒤 다시 시도 바람.');
  }

  let statusTimer;
  function status(text, err) {
    const el = $('#statusbar');
    el.textContent = text;
    el.classList.toggle('err', !!err);
    el.hidden = false;
    clearTimeout(statusTimer);
    if (!/중\.\.\.$/.test(text)) statusTimer = setTimeout(() => { el.hidden = true; }, err ? 7000 : 4000);
  }

  // ---------- goals and shootouts ----------
  function goalsOf(m) { return Array.isArray(m.goals) ? m.goals.filter(g => g && (g.s === 'h' || g.s === 'a') && g.n) : []; }
  function pensOf(m) {
    const p = m.pens;
    if (!p || !Array.isArray(p.h) || !Array.isArray(p.a)) return null;
    return p;
  }
  const kicksMade = arr => arr.filter(v => v === 1).length;

  // Every scorer with their team, from finished matches. Own goals are not credited.
  function scorerTable() {
    const map = new Map();
    for (const m of state.data.matches) {
      if (!L.isScored(m)) continue;
      const sides = sidesOf(m);
      for (const g of goalsOf(m)) {
        if (g.og) continue;
        const team = (g.s === 'h' ? sides.home : sides.away).team;
        if (!team) continue;
        const name = g.n.trim();
        const key = `${team}|${name}`;
        if (!map.has(key)) map.set(key, { name, team, goals: 0, matches: new Set() });
        const r = map.get(key);
        r.goals++;
        r.matches.add(m.id);
      }
    }
    const list = [...map.values()].sort((a, b) => b.goals - a.goals || a.name.localeCompare(b.name, 'ko'));
    list.forEach((r, i) => { r.rank = i && list[i - 1].goals === r.goals ? list[i - 1].rank : i + 1; });
    return list;
  }
  function namesFor(team) {
    const names = new Set();
    for (const m of state.data.matches) {
      const sides = sidesOf(m);
      for (const g of goalsOf(m)) {
        if (g.og) continue;
        if ((g.s === 'h' ? sides.home : sides.away).team === team) names.add(g.n.trim());
      }
    }
    return [...names].sort((a, b) => a.localeCompare(b, 'ko'));
  }

  // ---------- render ----------
  function render() {
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
    TABS.forEach(id => { $('#' + id).hidden = id !== state.tab; });
    $('#adminBtn').classList.toggle('on', isAdmin());
    renderLeague();
    renderFixtures();
    renderTable();
    renderBracket();
    renderStats();
    const u = state.data.updatedAt;
    $('#foot').innerHTML = (u ? `마지막 업데이트 ${new Date(u).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}<br>` : '') +
      '경기 일정은 학사 일정과 날씨에 따라 바뀔 수 있음.';
  }

  function renderLeague() {
    const lg = leagueInfo();
    const img = $('.league-crest');
    const src = lg.logo || 'icon.svg';
    if (img.getAttribute('src') !== src) img.setAttribute('src', src);
    img.classList.toggle('custom', !!lg.logo);
    $('.league-text h1').textContent = lg.name;
    document.title = `${lg.name} ${DEFAULT_LEAGUE.sub}`;
    const icon = $('link[rel="icon"]');
    if (icon.getAttribute('href') !== src) {
      icon.setAttribute('href', src);
      icon.setAttribute('type', lg.logo ? lg.logo.slice(5, lg.logo.indexOf(';')) : 'image/svg+xml');
    }
  }

  function defaultRound() {
    const i = ROUNDS.findIndex(r => r.ids.some(id => !state.data.matches.find(m => m.id === id).done));
    return i < 0 ? ROUNDS.length - 1 : i;
  }

  function scoreBox(m) {
    if (!L.isScored(m)) return '<span class="vs">vs</span>';
    const win = winnerSide(m);
    return `<span class="sb"><b class="${win === 'away' ? 'dim' : ''}">${m.hs}</b><i></i><b class="${win === 'home' ? 'dim' : ''}">${m.as}</b></span>` +
      (hasPk(m) ? `<span class="pk">승부차기 ${m.hp}:${m.ap}</span>` : '');
  }

  function fixtureRow(m) {
    const sides = sidesOf(m);
    const h = slotView(sides.home, '', true), a = slotView(sides.away, '', true);
    const win = winnerSide(m);
    const rel = m.date ? relDay(m.date) : '';
    const date = m.date ? (rel === '오늘' ? '<b class="today">오늘</b>' : `<b>${fmtDot(m.date)}</b>`) : '<b>날짜 미정</b>';
    return `<button class="fx" data-act="match" data-id="${m.id}" type="button">
      <div class="fx-meta">${date}<span>${m.stage === 'group' ? `${m.group}조` : stageLabel(m)}</span></div>
      <div class="fx-team home ${h.cls} ${win === 'away' ? 'lose' : ''}"><span class="nm">${h.name}</span>${h.crest}</div>
      <div class="fx-score">${scoreBox(m)}</div>
      <div class="fx-team away ${a.cls} ${win === 'home' ? 'lose' : ''}">${a.crest}<span class="nm">${a.name}</span></div>
      <div class="fx-edit">${isAdmin() ? ICON.pen : ''}</div>
    </button>`;
  }

  // The match people are most likely looking for right now.
  function featured() {
    const t = todayStr();
    const ms = state.data.matches;
    const todayDone = ms.filter(m => m.date === t && L.isScored(m)).sort(byNo).pop();
    if (todayDone) return { m: todayDone, label: '오늘 결과' };
    const next = ms.filter(m => !m.done && (!m.date || m.date >= t)).sort(byDate)[0];
    if (next) return { m: next, label: '다음 경기' };
    const last = ms.filter(m => L.isScored(m)).sort(byDate).pop();
    if (last) return { m: last, label: m => (m.id === 'F' ? '결승 결과' : '최근 결과') };
    return null;
  }

  function featureCard() {
    const f = featured();
    if (!f) return '';
    const m = f.m;
    const label = typeof f.label === 'function' ? f.label(m) : f.label;
    const sides = sidesOf(m);
    const h = slotView(sides.home, 'xl'), a = slotView(sides.away, 'xl');
    const hc = sides.home.team ? deep(colorOf(sides.home.team)) : '#2f2f2f';
    const ac = sides.away.team ? deep(colorOf(sides.away.team)) : '#2f2f2f';
    let center;
    if (L.isScored(m)) {
      const sub = hasPk(m) ? `승부차기 ${m.hp}:${m.ap}` : '종료';
      center = `<div class="ft-score">${m.hs}<i></i>${m.as}</div><div class="ft-sub">${sub}</div>`;
    } else if (m.date) {
      const n = dayDiff(m.date);
      const big = n === 0 ? '오늘' : n === 1 ? '내일' : n > 0 ? `D-${n}` : fmtDot(m.date);
      center = `<div class="ft-when">${big}</div><div class="ft-sub">${fmtShort(m.date)} 점심시간</div>`;
    } else {
      center = '<div class="ft-when">미정</div><div class="ft-sub">날짜 미정</div>';
    }
    const goals = L.isScored(m) ? goalLines(m, sides, true) : '';
    return `<button class="feature" data-act="match" data-id="${m.id}" type="button"
      style="--fh:${hc};--fa:${ac};--fh2:${mix(hc, '#000000', 0.35)};--fa2:${mix(ac, '#000000', 0.35)}">
      <div class="ft-top"><b>${label}</b><span>${matchTitle(m)}</span></div>
      <div class="ft-row">
        <div class="ft-team">${h.crest}<span class="nm">${h.name}</span></div>
        <div class="ft-mid">${center}</div>
        <div class="ft-team">${a.crest}<span class="nm">${a.name}</span></div>
      </div>
      ${goals}
    </button>`;
  }

  function renderFixtures() {
    const r = ROUNDS[state.round];
    const ms = r.ids.map(id => state.data.matches.find(m => m.id === id)).sort(byDate);
    const dates = ms.map(m => m.date).filter(Boolean).sort();
    const span = !dates.length ? '날짜 미정' : dates[0] === dates[dates.length - 1] ? fmtLong(dates[0]) : `${fmtShort(dates[0])} ~ ${fmtShort(dates[dates.length - 1])}`;
    const done = ms.filter(m => L.isScored(m)).length;
    let html = featureCard();
    if (isAdmin()) {
      html += `<div class="card admin-bar"><div class="card-head"><span>관리자 모드</span><span class="sub">경기를 누르면 결과와 날짜 수정</span></div>
        <div class="admin-actions">
          <button class="btn" data-act="schedule" type="button">일정 편집</button>
          <button class="btn" data-act="teams" type="button">팀 꾸미기</button>
          <button class="btn" data-act="league" type="button">대회 로고</button>
        </div></div>`;
    }
    html += `<div class="card round">
      <div class="round-head">
        <button class="icon-btn" type="button" data-act="round" data-d="-1" aria-label="이전 라운드" ${state.round === 0 ? 'disabled' : ''}>${ICON.left}</button>
        <div class="rh-mid"><div class="rh-title">${r.title}</div><div class="rh-sub">${span}</div></div>
        <button class="icon-btn" type="button" data-act="round" data-d="1" aria-label="다음 라운드" ${state.round === ROUNDS.length - 1 ? 'disabled' : ''}>${ICON.right}</button>
      </div>
      <div class="round-steps">${ROUNDS.map((x, i) => `<button type="button" data-act="round-go" data-i="${i}" class="${i === state.round ? 'on' : ''}" aria-label="${x.title}"><i></i><span>${x.key.startsWith('MW') ? x.key.replace('MW', 'MW ') : x.title}</span></button>`).join('')}</div>
      ${ms.map(fixtureRow).join('')}
      <div class="round-foot">${done}/${ms.length} 경기 종료</div>
    </div>`;
    $('#fixtures').innerHTML = html;
  }

  function formHtml(form) {
    const map = { W: '승', D: '무', L: '패' };
    return `<span class="form-row">${form.slice(-3).map(f => `<i class="${f}">${map[f]}</i>`).join('')}</span>`;
  }
  function gdText(n) { return n > 0 ? `+${n}` : String(n); }

  function tieNote(key, n, resolved) {
    const btn = isAdmin() ? `<button class="btn ghost link" data-act="lots" data-key="${key}" type="button">${resolved ? '추첨 수정' : '추첨 결과 입력'}</button>` : '';
    const text = resolved
      ? '승점, 골득실, 다득점이 같아 추첨으로 순위를 정함.'
      : `<span class="q">?</span>${n}팀이 승점, 골득실, 다득점까지 같음. 추첨으로 결정.`;
    return `<div class="tie-note"><span>${text}</span>${btn}</div>`;
  }

  function renderTable() {
    let html = '';
    for (const t of state.view.tables) {
      const rows = t.rows.map((r, i) => `
        <tr class="${i === 0 ? 'q1' : i === 1 ? 'q2' : ''}" data-act="team" data-id="${r.team}">
          <td class="pos">${t.played ? r.rank : i + 1}</td>
          <td class="team l"><span>${crest(r.team)}<span class="nm">${teamName(r.team)}</span></span></td>
          <td class="c">${r.p}</td><td class="c">${r.w}</td><td class="c">${r.d}</td><td class="c">${r.l}</td>
          <td class="gs">${r.gf}-${r.ga}</td>
          <td class="gd">${gdText(r.gd)}</td>
          <td class="pts">${r.pts}</td>
          <td class="form">${formHtml(r.form)}</td>
        </tr>`).join('');
      const tied = t.rows.filter(r => r.statTie);
      const resolved = tied.length > 0 && !t.rows.some(r => r.tied);
      html += `<div class="card">
        <div class="card-head"><span>${t.group}조</span><span class="sub">${t.played}/${t.total} 경기</span></div>
        <table class="tbl">
          <thead><tr><th class="l" style="padding-left:16px">#</th><th class="l">팀</th><th class="c">경기</th><th class="c">승</th><th class="c">무</th><th class="c">패</th><th class="gs">득/실</th><th class="gd">골득실</th><th class="pts">승점</th><th class="form">최근</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        ${t.done && tied.length ? tieNote(t.group, tied.length, resolved) : ''}
      </div>`;
    }
    html += `<div class="card"><div class="legend">
      <span><i style="background:var(--qual-1)"></i>준결승 진출</span>
      <span><i style="background:var(--qual-2)"></i>와일드카드 경쟁</span>
    </div></div>`;

    // Wildcard race among the second-placed teams.
    const wc = state.view.wildcard;
    const cands = (wc.candidates || []).slice();
    if (!wc.unknown && !wc.team) cands.sort((a, b) => L.cmpStats(a, b));
    const allDone = state.view.tables.every(t => t.done);
    html += `<div class="section-title">와일드카드</div><div class="card">
      <div class="card-head"><span>각 조 2위</span><span class="sub">${allDone ? '조별 리그 종료' : '진행 중'}</span></div>
      <table class="tbl"><thead><tr><th class="l" style="padding-left:16px">#</th><th class="l">팀</th><th class="c">조</th><th class="c">경기</th><th class="gd">골득실</th><th class="c">득점</th><th class="pts">승점</th></tr></thead><tbody>
      ${cands.map((c, i) => {
        const gDone = state.view.tables.find(t => t.group === c.group).done;
        const unknown = c.ambiguous && gDone;
        const nm = unknown ? `${phCrest('?')}<span class="nm">?</span>` : `${crest(c.team)}<span class="nm">${teamName(c.team)}</span>`;
        const isWc = wc.team && c.team === wc.team;
        return `<tr class="${allDone && i === 0 && (isWc || wc.unknown) ? 'q2' : ''}" ${unknown ? '' : `data-act="team" data-id="${c.team}"`}><td class="pos">${i + 1}</td><td class="team l"><span>${nm}</span></td><td class="c">${c.group}</td><td class="c">${c.p}</td><td class="gd">${gdText(c.gd)}</td><td class="c">${c.gf}</td><td class="pts">${c.pts}</td></tr>`;
      }).join('')}
      </tbody></table>
      ${wcTieNote(wc, allDone)}
    </div>`;

    html += `<div class="section-title">순위 결정 기준</div><div class="card"><div class="rules"><ol>
      <li>승점 (승리 3점, 무승부 1점, 패배 0점)</li>
      <li>골득실</li>
      <li>다득점</li>
      <li>모두 같으면 추첨</li>
    </ol><p style="margin:10px 0 0">와일드카드는 각 조 2위 중 같은 기준으로 1팀을 뽑음.</p></div></div>`;
    $('#table').innerHTML = html;
  }

  function wcTieNote(wc, allDone) {
    if (!allDone) return '';
    const cands = wc.candidates || [];
    const top = cands[0];
    if (!top) return '';
    const tiedTop = cands.filter(c => L.cmpStats(c, top) === 0);
    if (tiedTop.length < 2) return '';
    const resolved = Array.isArray(state.data.lots.WC) && (!!wc.team || wc.tieKey !== 'WC');
    return tieNote('WC', tiedTop.length, resolved);
  }

  function brMatch(m, sides) {
    const win = winnerSide(m);
    const scored = L.isScored(m);
    const pk = hasPk(m);
    const row = (slot, s, p, side) => {
      const v = slotView(slot, '', true);
      const won = win === side && slot.team;
      return `<div class="br-row ${v.cls} ${win && win !== side ? 'lose' : ''} ${won ? 'won tc' : ''}" ${won ? `style="${tcVars(colorOf(slot.team))}"` : ''}>
        ${v.crest}<span class="nm">${v.name}</span>
        <span class="sc">${scored ? `${pk ? `<small>(${p})</small>` : ''}${s}` : ''}</span></div>`;
    };
    return `<button class="br-match" data-act="match" data-id="${m.id}" type="button">
      ${row(sides.home, m.hs, m.hp, 'home')}${row(sides.away, m.as, m.ap, 'away')}
      <div class="br-date">${m.date ? fmtShort(m.date) : '날짜 미정'}${scored ? '<span>종료</span>' : ''}</div>
    </button>`;
  }

  function renderBracket() {
    const byId = Object.fromEntries(state.data.matches.map(m => [m.id, m]));
    const s = state.view.sides;
    const champ = state.view.champion;
    const finalDone = L.isScored(byId.F);
    // Each leg of the connector takes the color of the team that came through it.
    const leg = (team, d) => `<path class="${team ? 'won tc' : ''}" ${team ? `style="${tcVars(colorOf(team))}"` : ''} vector-effect="non-scaling-stroke" d="${d}"/>`;
    const champHtml = champ
      ? `<div class="champ won tc" style="${tcVars(colorOf(champ))}">
          <div class="trophy">${ICON.trophy}</div>
          <div class="cv"><div class="k">우승</div><div class="v">${teamName(champ)}</div></div>
          ${crest(champ, 'lg inv')}
        </div>`
      : `<div class="champ"><div class="trophy">${ICON.trophy}</div><div class="cv"><div class="k">우승</div><div class="v">${finalDone ? '?' : '결승 전'}</div></div></div>`;
    $('#bracket').innerHTML = `<div class="card">
      <div class="card-head"><span>토너먼트</span><span class="sub">준결승 2경기, 결승 1경기</span></div>
      <div class="bracket">
        <div class="br-label">준결승</div><div></div><div class="br-label">결승</div>
        <div class="br-col">${brMatch(byId.SF1, s.SF1)}${brMatch(byId.SF2, s.SF2)}</div>
        <div class="br-link"><svg viewBox="0 0 100 100" preserveAspectRatio="none">
          ${leg(s.SF1.winner, 'M0 25H50V50')}${leg(s.SF2.winner, 'M0 75H50V50')}${leg(champ, 'M50 50H100')}
        </svg></div>
        <div class="br-col">${brMatch(byId.F, s.F)}</div>
      </div>
      ${champHtml}
    </div>
    <div class="section-title">대진</div>
    <div class="card"><div class="rules"><ol>
      <li>준결승 1: A조 1위 vs B조 1위</li>
      <li>준결승 2: C조 1위 vs 와일드카드</li>
      <li>결승: 준결승 1 승자 vs 준결승 2 승자</li>
    </ol><p style="margin:10px 0 0">조별 리그가 끝나면 순위대로 자동으로 채워짐. 순위가 완전히 같아 추첨이 필요한 자리는 ?로 표시됨.</p></div></div>`;
  }

  // ---------- stats tab ----------
  function teamTotals() {
    const rows = Object.fromEntries(state.data.teams.map(t => [t.id, { team: t.id, p: 0, gf: 0, ga: 0 }]));
    for (const m of state.data.matches) {
      if (!L.isScored(m)) continue;
      const s = sidesOf(m);
      if (!s.home.team || !s.away.team) continue;
      const h = rows[s.home.team], a = rows[s.away.team];
      h.p++; a.p++;
      h.gf += m.hs; h.ga += m.as; a.gf += m.as; a.ga += m.hs;
    }
    const list = Object.values(rows).sort((x, y) => y.gf - x.gf || x.ga - y.ga || classNo(x.team) - classNo(y.team));
    list.forEach((r, i) => { const p = list[i - 1]; r.rank = p && p.gf === r.gf && p.ga === r.ga ? p.rank : i + 1; });
    return list;
  }

  function renderStats() {
    const sc = scorerTable();
    let html = '';
    if (sc.length) {
      const top = sc[0];
      const shared = sc.filter(r => r.goals === top.goals).length;
      const c = deep(colorOf(top.team));
      html += `<button class="leader" type="button" data-act="team" data-id="${top.team}" style="--lc:${c};--lc2:${mix(c, '#000000', 0.35)}">
        <div class="ld-text">
          <div class="ld-k">득점 1위${shared > 1 ? ` (공동 ${shared}명)` : ''}</div>
          <div class="ld-name">${esc(top.name)}</div>
          <div class="ld-team">${crest(top.team)}<span>${teamName(top.team)}</span></div>
        </div>
        <div class="ld-num"><b>${top.goals}</b><span>골</span></div>
      </button>`;
    }
    html += `<div class="card">
      <div class="card-head"><span>득점 순위</span><span class="sub">자책골 제외</span></div>
      ${sc.length ? `<table class="tbl scorers"><thead><tr><th class="l" style="padding-left:16px">#</th><th class="l">선수</th><th class="c">경기</th><th class="pts">골</th></tr></thead><tbody>
        ${sc.map(r => `<tr data-act="team" data-id="${r.team}"><td class="pos">${r.rank}</td>
          <td class="team l"><span>${crest(r.team)}<span class="pl"><b>${esc(r.name)}</b><small>${teamName(r.team)}</small></span></span></td>
          <td class="c">${r.matches.size}</td><td class="pts">${r.goals}</td></tr>`).join('')}
      </tbody></table>` : '<p class="empty">아직 기록된 득점자 없음.<br>경기 결과에 득점자를 넣으면 여기에 쌓임.</p>'}
    </div>`;
    const tt = teamTotals();
    html += `<div class="section-title">팀 득점</div><div class="card">
      <table class="tbl"><thead><tr><th class="l" style="padding-left:16px">#</th><th class="l">팀</th><th class="c">경기</th><th class="c">득점</th><th class="c">실점</th></tr></thead><tbody>
      ${tt.map(r => `<tr data-act="team" data-id="${r.team}"><td class="pos">${r.rank}</td><td class="team l"><span>${crest(r.team)}<span class="nm">${teamName(r.team)}</span></span></td><td class="c">${r.p}</td><td class="c strong">${r.gf}</td><td class="c">${r.ga}</td></tr>`).join('')}
      </tbody></table>
      <p class="tbl-note">토너먼트 경기 포함, 승부차기 제외.</p>
    </div>`;
    $('#stats').innerHTML = html;
  }

  // ---------- sheets ----------
  function openSheet(body, hero) {
    const sh = $('#sheet');
    sh.innerHTML = (hero || '<div class="grip-wrap"><div class="grip"></div></div>') + `<div class="sheet-body">${body}</div>`;
    sh.hidden = false;
    sh.scrollTop = 0;
    $('#backdrop').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeSheet() {
    $('#sheet').hidden = true;
    $('#backdrop').hidden = true;
    document.body.style.overflow = '';
    editDraft = null;
  }
  function sheetError(text) { const el = $('#sheet .msg'); if (el) el.textContent = text; }
  async function runSave(btn, fn) {
    btn.disabled = true;
    try { await fn(); closeSheet(); }
    catch (e) { sheetError(e.message); status(e.message, true); btn.disabled = false; }
  }

  // Scorers listed under each side, grouped by player.
  function goalLines(m, sides, compact) {
    const goals = goalsOf(m);
    if (!goals.length) return '';
    const side = s => {
      const byName = new Map();
      goals.filter(g => g.s === s).forEach(g => {
        const k = `${g.n.trim()}|${g.og ? 1 : 0}`;
        if (!byName.has(k)) byName.set(k, { n: g.n.trim(), og: !!g.og, mins: [] });
        if (Number.isInteger(g.m)) byName.get(k).mins.push(g.m);
      });
      return [...byName.values()].map(x => {
        const mins = x.mins.sort((a, b) => a - b).map(v => `${v}'`).join(', ');
        const count = !mins && goals.filter(g => g.s === s && g.n.trim() === x.n && !!g.og === x.og).length;
        return `<li><span>${esc(x.n)}</span>${x.og ? '<em>자책골</em>' : ''}${mins ? `<small>${mins}</small>` : count > 1 ? `<small>${count}골</small>` : ''}</li>`;
      }).join('');
    };
    return `<div class="goals${compact ? ' compact' : ''}"><ul class="g-h">${side('h')}</ul><div class="g-ball">${ICON.ball}</div><ul class="g-a">${side('a')}</ul></div>`;
  }

  function kickDot(v, cls = '') {
    if (v === 1) return `<i class="k ok ${cls}">${ICON.check}</i>`;
    if (v === 0) return `<i class="k miss ${cls}">${ICON.cross}</i>`;
    return `<i class="k none ${cls}"></i>`;
  }

  function shootoutView(m, sides) {
    if (!hasPk(m)) return '';
    const p = pensOf(m);
    const h = slotView(sides.home), a = slotView(sides.away);
    const win = winnerSide(m);
    if (!p) {
      return `<div class="shoot"><div class="sh-head"><span>승부차기</span><b>${m.hp}<i>:</i>${m.ap}</b></div></div>`;
    }
    const n = Math.max(p.h.length, p.a.length, 1);
    const row = (arr, v, side) => `<div class="sh-row ${win === side ? 'win' : ''}">${v.crest}<div class="sh-kicks" style="--n:${n}">${range(n).map(i => kickDot(arr[i])).join('')}</div><b class="sh-n">${kicksMade(arr)}</b></div>`;
    return `<div class="shoot">
      <div class="sh-head"><span>승부차기</span><b>${m.hp}<i>:</i>${m.ap}</b></div>
      ${row(p.h, h, 'home')}${row(p.a, a, 'away')}
    </div>`;
  }

  // Match header tinted with both teams' colors.
  function matchHero(m) {
    const sides = sidesOf(m);
    const h = slotView(sides.home, 'xl'), a = slotView(sides.away, 'xl');
    const hc = sides.home.team ? colorOf(sides.home.team) : null;
    const ac = sides.away.team ? colorOf(sides.away.team) : null;
    const win = winnerSide(m);
    const bg = [
      hc ? `linear-gradient(90deg, ${rgba(hc, tint(hc))} 0%, ${rgba(hc, tint(hc) * 0.3)} 36%, ${rgba(hc, 0)} 50%)` : '',
      ac ? `linear-gradient(270deg, ${rgba(ac, tint(ac))} 0%, ${rgba(ac, tint(ac) * 0.3)} 36%, ${rgba(ac, 0)} 50%)` : '',
    ].filter(Boolean).join(',');
    const stripe = `linear-gradient(90deg, ${hc ? lineColor(hc) : 'var(--line)'} 0 50%, ${ac ? lineColor(ac) : 'var(--line)'} 50% 100%)`;
    const team = (v, side) => `<${v.id ? `button data-act="team" data-id="${v.id}" type="button"` : 'div'} class="mh-team ${win && win !== side ? 'lose' : ''}">${v.crest}<span class="nm">${v.name}</span></${v.id ? 'button' : 'div'}>`;
    let score = '<span class="vs">vs</span>';
    if (L.isScored(m)) score = `<span class="big">${m.hs}<i>-</i>${m.as}</span><span class="pk">${hasPk(m) ? `승부차기 ${m.hp}:${m.ap}` : '종료'}</span>`;
    else if (m.date) score = `<span class="vs">vs</span><span class="pk">${relDay(m.date) || fmtDot(m.date)}</span>`;
    return `<div class="hero match-hero" style="background:${bg || 'none'}">
      <div class="grip"></div>
      <div class="mh-top">${matchTitle(m)}<span>${m.date ? fmtShort(m.date) : '날짜 미정'}</span></div>
      <div class="mh-row">${team(h, 'home')}<div class="mh-score">${score}</div>${team(a, 'away')}</div>
      ${L.isScored(m) ? goalLines(m, sides) : ''}
      <div class="mh-stripe" style="background:${stripe}"></div>
    </div>`;
  }

  function openMatch(id) {
    const m = state.data.matches.find(x => x.id === id);
    if (isAdmin()) { openEdit(m); return; }
    const sides = sidesOf(m);
    let body = shootoutView(m, sides);
    if (m.stage === 'group') {
      const t = state.view.tables.find(x => x.group === m.group);
      body += `<div class="sheet-sec">${m.group}조 순위</div><div class="mini">${miniTable(t, [m.home, m.away])}</div>`;
    } else {
      const label = { SF1: 'A조 1위 vs B조 1위', SF2: 'C조 1위 vs 와일드카드', F: '준결승 1 승자 vs 준결승 2 승자' }[m.id];
      body += `<div class="sheet-sec">대진</div><p class="lead" style="margin-bottom:16px">${label}</p>`;
    }
    body += '<div class="btns"><button class="btn" type="button" data-act="close">닫기</button></div>';
    openSheet(body, matchHero(m));
  }

  function miniTable(t, highlight) {
    return `<table class="tbl mini-tbl"><thead><tr><th class="l" style="padding-left:12px">#</th><th class="l">팀</th><th class="c">경기</th><th class="gd">골득실</th><th class="pts">승점</th></tr></thead><tbody>
      ${t.rows.map((r, i) => `<tr data-act="team" data-id="${r.team}" class="${highlight.includes(r.team) ? 'hl' : ''}"><td class="pos">${t.played ? r.rank : i + 1}</td><td class="team l"><span>${crest(r.team)}<span class="nm">${teamName(r.team)}</span></span></td><td class="c">${r.p}</td><td class="gd">${gdText(r.gd)}</td><td class="pts">${r.pts}</td></tr>`).join('')}
    </tbody></table>`;
  }

  // ---------- match editor ----------
  let editDraft = null;

  function stepper(name, value) {
    return `<div class="stepper"><button type="button" data-step="-1" data-for="${name}" aria-label="빼기">−</button>
      <input name="${name}" type="number" inputmode="numeric" min="0" max="99" value="${value ?? ''}" placeholder="0">
      <button type="button" data-step="1" data-for="${name}" aria-label="더하기">+</button></div>`;
  }

  function openEdit(m) {
    const sides = sidesOf(m);
    const h = slotView(sides.home), a = slotView(sides.away);
    const ko = m.stage !== 'group';
    const later = state.data.matches.filter(x => x.no > m.no && !x.done).length;
    const p = pensOf(m);
    editDraft = {
      id: m.id,
      sides,
      goals: goalsOf(m).map(g => ({ ...g })),
      pens: p ? { h: p.h.slice(), a: p.a.slice() } : { h: [], a: [] },
      pensTouched: false,
      legacyPk: !p && Number.isInteger(m.hp) ? `${m.hp}:${m.ap}` : null,
    };
    editDraft.rounds = Math.max(PEN_ROUNDS, editDraft.pens.h.length, editDraft.pens.a.length);
    const dl = (s, team) => team ? `<datalist id="dl-${s}">${namesFor(team).map(n => `<option value="${esc(n)}">`).join('')}</datalist>` : '';
    openSheet(`
      <div class="field"><span class="lab">점수</span>
        <div class="score-edit">
          <div class="score-side"><div class="tn">${h.crest}<span>${h.name}</span></div>${stepper('hs', m.hs)}</div>
          <div class="colon">:</div>
          <div class="score-side"><div class="tn">${a.crest}<span>${a.name}</span></div>${stepper('as', m.as)}</div>
        </div>
      </div>
      ${ko ? `<div class="field" id="pkField" hidden><div class="shoot-edit" id="shootEdit"></div></div>` : ''}
      <div class="field">
        <div class="lab-row"><span class="lab">득점자</span><span class="opt">선택 사항</span></div>
        <div id="goalList" class="goal-list"></div>
        <div class="add-goal">
          <button class="btn" type="button" data-act="add-goal" data-s="h">${h.crest}<span>${h.name} 득점</span></button>
          <button class="btn" type="button" data-act="add-goal" data-s="a">${a.crest}<span>${a.name} 득점</span></button>
        </div>
        <p class="hint" id="goalHint"></p>
        ${dl('h', sides.home.team)}${dl('a', sides.away.team)}
      </div>
      <div class="field"><label for="f-date">날짜</label>
        <div class="btns"><input id="f-date" class="input" type="date" value="${m.date || ''}" style="flex:1">
        <button class="btn" type="button" data-act="nextday" style="flex:none">다음 경기일로</button></div>
        ${later ? `<label class="check" style="margin:10px 0 0;border-bottom:0"><input type="checkbox" id="f-cascade" checked><span class="t">뒤 경기 ${later}개도 같은 만큼 미루기</span></label>` : ''}
      </div>
      <label class="check"><input type="checkbox" id="f-done" ${m.done ? 'checked' : ''}><span class="t">경기 종료</span><span class="d">체크해야 순위에 반영됨</span></label>
      <p class="msg"></p>
      <div class="btns">
        ${L.isScored(m) ? '<button class="btn ghost danger" type="button" data-act="clear">결과 지우기</button>' : ''}
        <button class="btn" type="button" data-act="close">취소</button>
        <button class="btn primary" type="button" data-act="save-match" data-id="${m.id}">저장</button>
      </div>`, matchHero(m));
    renderGoalList();
    renderShootEdit();
    syncPk();
  }

  function sideTeam(s) { const slot = s === 'h' ? editDraft.sides.home : editDraft.sides.away; return slot.team; }
  function sideCrest(s) { const t = sideTeam(s); return t ? crest(t) : phCrest(''); }

  function renderGoalList() {
    const el = $('#goalList');
    if (!el) return;
    el.innerHTML = editDraft.goals.map((g, i) => `
      <div class="goal-row" data-i="${i}">
        ${sideCrest(g.s)}
        <input class="input g-name" data-i="${i}" list="dl-${g.s}" maxlength="10" placeholder="이름" value="${esc(g.n || '')}" autocomplete="off">
        <input class="input g-min" data-i="${i}" type="number" inputmode="numeric" min="0" max="99" placeholder="분" value="${Number.isInteger(g.m) ? g.m : ''}">
        <button type="button" class="og ${g.og ? 'on' : ''}" data-act="goal-og" data-i="${i}" aria-pressed="${!!g.og}">자책</button>
        <button type="button" class="x" data-act="goal-del" data-i="${i}" aria-label="삭제">${ICON.cross}</button>
      </div>`).join('');
    syncGoalHint();
  }
  function syncGoalHint() {
    const el = $('#goalHint');
    if (!el || !editDraft) return;
    const hs = readInt('hs'), as = readInt('as');
    const nh = editDraft.goals.filter(g => g.s === 'h').length;
    const na = editDraft.goals.filter(g => g.s === 'a').length;
    const off = (hs !== null && nh > hs) || (as !== null && na > as);
    el.textContent = off ? '득점자 수가 점수보다 많음. 점수 확인 필요.' : '이름만 넣어도 됨. 분과 자책골은 필요할 때만.';
    el.classList.toggle('warn', off);
  }

  function renderShootEdit() {
    const el = $('#shootEdit');
    if (!el) return;
    const d = editDraft;
    const cell = (s, i) => {
      const v = d.pens[s][i];
      const cls = v === 1 ? 'ok' : v === 0 ? 'miss' : 'none';
      const inner = v === 1 ? ICON.check : v === 0 ? ICON.cross : `<span>${i + 1}</span>`;
      return `<button type="button" class="k ${cls}" data-act="kick" data-s="${s}" data-k="${i}" aria-label="${i + 1}번째 키커">${inner}</button>`;
    };
    const row = s => `<div class="se-row">${sideCrest(s)}<div class="se-kicks" style="--n:${d.rounds}">${range(d.rounds).map(i => cell(s, i)).join('')}</div><b class="se-n">${kicksMade(d.pens[s])}</b></div>`;
    const hp = kicksMade(d.pens.h), ap = kicksMade(d.pens.a);
    const any = d.pens.h.some(v => v != null) || d.pens.a.some(v => v != null);
    el.innerHTML = `
      <div class="se-head"><span>승부차기</span><b>${any || !d.legacyPk ? `${hp}<i>:</i>${ap}` : d.legacyPk.replace(':', '<i>:</i>')}</b></div>
      ${row('h')}${row('a')}
      <div class="se-foot">
        <span class="hint">칸을 누를 때마다 성공, 실패, 빈칸 순으로 바뀜</span>
        <span class="se-btns"><button type="button" class="btn ghost link" data-act="pen-round">+ 서든데스</button>${any ? '<button type="button" class="btn ghost danger" data-act="pen-reset">초기화</button>' : ''}</span>
      </div>`;
  }

  function readInt(name) {
    const el = $(`#sheet input[name="${name}"]`);
    if (!el || el.value === '') return null;
    const n = Math.max(0, Math.min(99, parseInt(el.value, 10)));
    return Number.isNaN(n) ? null : n;
  }
  function syncPk() {
    const f = $('#pkField');
    syncGoalHint();
    if (!f) return;
    const hs = readInt('hs'), as = readInt('as');
    f.hidden = !(hs !== null && as !== null && hs === as);
  }

  async function saveMatch(btn, clear) {
    const id = editDraft.id;
    const m0 = state.data.matches.find(x => x.id === id);
    const date = $('#f-date').value || null;
    const cascade = !!($('#f-cascade') && $('#f-cascade').checked);
    let hs = readInt('hs'), as = readInt('as');
    let done = $('#f-done').checked;
    if (clear) { hs = as = null; done = false; }
    if (done && (hs === null || as === null)) { sheetError('종료로 저장하려면 두 팀 점수가 모두 있어야 함.'); return; }
    const tie = done && hs === as;
    const goals = clear ? [] : editDraft.goals
      .map(g => ({ s: g.s, n: (g.n || '').trim().slice(0, 10), ...(Number.isInteger(g.m) ? { m: g.m } : {}), ...(g.og ? { og: true } : {}) }))
      .filter(g => g.n);
    const trim = arr => { const a = arr.map(v => (v === 1 || v === 0 ? v : null)); while (a.length && a[a.length - 1] === null) a.pop(); return a; };
    const pens = { h: trim(editDraft.pens.h), a: trim(editDraft.pens.a) };
    const hasKicks = pens.h.length || pens.a.length;
    const touched = editDraft.pensTouched;
    await runSave(btn, () => save(d => {
      const m = d.matches.find(x => x.id === id);
      if (date !== m.date) L.reschedule(d, id, date, cascade);
      m.done = done;
      m.hs = done ? hs : null;
      m.as = done ? as : null;
      if (goals.length) m.goals = goals; else delete m.goals;
      if (m.stage !== 'group') {
        if (!tie) { m.hp = null; m.ap = null; delete m.pens; }
        else if (touched) {
          if (hasKicks) { m.pens = pens; m.hp = kicksMade(pens.h); m.ap = kicksMade(pens.a); }
          else { delete m.pens; m.hp = null; m.ap = null; }
        }
      }
    }, `${commitTitle(m0)} ${clear ? '결과 삭제' : done ? `결과 ${hs}:${as}` : '수정'}`));
  }

  // ---------- team page ----------
  function teamPosition(id) {
    const t = teamObj(id);
    const table = state.view.tables.find(x => x.group === t.group);
    const i = table.rows.findIndex(r => r.team === id);
    return { table, row: table.rows[i], pos: table.played ? table.rows[i].rank : i + 1 };
  }
  function teamMatches(id) {
    return state.data.matches.filter(m => {
      if (m.stage === 'group') return m.home === id || m.away === id;
      const s = state.view.sides[m.id];
      return s.home.team === id || s.away.team === id;
    }).sort(byNo);
  }
  function teamHero(look, sub) {
    const big = look.logo
      ? `<span class="th-logo"><img src="${look.logo}" alt=""></span>`
      : `<span class="crest xxl inv">${look.no}</span>`;
    return `<div class="hero team-hero tc" style="${tcVars(look.color)}">
      <div class="grip"></div>
      <div class="th-row">${big}<div class="th-text"><div class="th-name">${look.name}</div><div class="th-sub">${sub}</div></div></div>
    </div>`;
  }
  function openTeam(id) {
    const { row, pos, table } = teamPosition(id);
    const t = teamObj(id);
    const posText = table.done && row.tied ? `${t.group}조 ?위` : `${t.group}조 ${pos}위`;
    const sub = t.name && t.name.trim() ? `2학년 ${classNo(id)}반<span class="sep"></span>${posText}` : posText;
    const stat = (k, v, cls = '') => `<div class="st ${cls}"><div class="v">${v}</div><div class="k">${k}</div></div>`;
    const ms = teamMatches(id);
    const scorers = scorerTable().filter(r => r.team === id);
    const body = `
      <div class="stats">${stat('경기', row.p)}${stat('전적', `${row.w}승 ${row.d}무 ${row.l}패`, 'sm')}${stat('골득실', gdText(row.gd))}${stat('승점', row.pts)}</div>
      <div class="sheet-sec">경기</div>
      <div class="sheet-list">${ms.map(fixtureRow).join('')}</div>
      ${scorers.length ? `<div class="sheet-sec">득점</div><div class="sheet-list">${scorers.map(r => `<div class="team-item static"><span class="nm">${esc(r.name)}</span><b class="goals-n">${r.goals}골</b></div>`).join('')}</div>` : ''}
      <div class="btns">
        ${isAdmin() ? `<button class="btn" type="button" data-act="team-edit" data-id="${id}">팀 꾸미기</button>` : ''}
        <button class="btn" type="button" data-act="close">닫기</button>
      </div>`;
    openSheet(body, teamHero(teamLook(id), sub));
  }

  // ---------- image upload ----------
  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 열 수 없음.')); };
      img.src = url;
    });
  }
  // Shrinks a picture to fit a square, keeping transparency, so it can live in data.json.
  async function shrinkLogo(file) {
    if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 올릴 수 있음.');
    const img = await loadImage(file);
    const encode = (size, type, q) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = size;
      const ctx = cv.getContext('2d');
      const w = img.naturalWidth || size, h = img.naturalHeight || size;
      const k = Math.min(size / w, size / h);
      const dw = w * k, dh = h * k;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, (size - dw) / 2, (size - dh) / 2, dw, dh);
      return cv.toDataURL(type, q);
    };
    let out = encode(160, 'image/webp', 0.86);
    if (!out.startsWith('data:image/webp')) out = encode(160, 'image/png');
    if (out.length > 90000) out = encode(112, out.startsWith('data:image/webp') ? 'image/webp' : 'image/png', 0.8);
    if (out.length > 140000) throw new Error('이미지가 너무 복잡함. 더 단순한 로고 권장.');
    return out;
  }

  // ---------- team editor ----------
  let teamDraft = null;
  function openTeamList() {
    const body = `<h2>팀 꾸미기</h2>
      <p class="lead">팀을 골라 이름, 팀 컬러, 로고를 바꿀 수 있음. 바꾼 색과 로고는 경기, 순위, 토너먼트 화면 전체에 쓰임.</p>
      ${L.GROUPS.map(g => `<div class="sheet-sec">${g}조</div><div class="sheet-list">
        ${state.data.teams.filter(t => t.group === g).map(t => `<button class="team-item" type="button" data-act="team-edit" data-id="${t.id}">
          ${crest(t.id)}<span class="nm">${teamName(t.id)}</span><span class="sw" style="background:${colorOf(t.id)}"></span>${ICON.chev}</button>`).join('')}
      </div>`).join('')}
      <div class="btns" style="margin-top:16px"><button class="btn" type="button" data-act="close">닫기</button></div>`;
    openSheet(body);
  }
  function draftLook() {
    return {
      no: classNo(teamDraft.id),
      color: teamDraft.color,
      logo: teamDraft.logo,
      name: esc((teamDraft.name || '').trim() || `2학년 ${classNo(teamDraft.id)}반`),
    };
  }
  function openTeamEdit(id) {
    const t = teamObj(id);
    teamDraft = { id, name: t.name || '', color: colorOf(id), logo: logoOf(id) };
    const body = `
      <div class="field"><label for="f-name">팀 이름</label>
        <input id="f-name" class="input" maxlength="12" value="${esc(teamDraft.name)}" placeholder="2학년 ${classNo(id)}반">
        <p class="hint">비워 두면 2학년 ${classNo(id)}반으로 표시됨.</p></div>
      <div class="field"><span class="lab">팀 컬러</span>
        <div class="swatches">${SWATCHES.map(c => `<button type="button" class="swatch" data-act="swatch" data-c="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}
          <label class="swatch custom" aria-label="직접 고르기"><input type="color" id="f-color" value="${teamDraft.color}"><span>+</span></label>
        </div></div>
      <div class="field"><span class="lab">로고</span>
        <div class="logo-edit">
          <span class="logo-prev" id="logoPrev"></span>
          <div class="logo-btns">
            <label class="btn file">사진 고르기<input type="file" id="f-logo" accept="image/*"></label>
            <button class="btn ghost danger" type="button" data-act="logo-clear" id="logoClear">로고 지우기</button>
          </div>
        </div>
        <p class="hint">정사각형에 배경이 투명한 PNG가 가장 깔끔함. 160px로 줄여서 저장됨.</p></div>
      <p class="msg"></p>
      <div class="btns">
        <button class="btn" type="button" data-act="close">취소</button>
        <button class="btn primary" type="button" data-act="save-team">저장</button>
      </div>`;
    openSheet(body, teamHero(draftLook(), '미리보기'));
    syncTeamDraft();
  }
  function syncTeamDraft() {
    const hero = $('#sheet .team-hero');
    if (!hero) return;
    hero.outerHTML = teamHero(draftLook(), '미리보기');
    document.querySelectorAll('#sheet .swatch[data-c]').forEach(s => s.classList.toggle('on', s.dataset.c.toLowerCase() === teamDraft.color.toLowerCase()));
    const custom = $('#sheet .swatch.custom');
    const isPreset = SWATCHES.some(c => c.toLowerCase() === teamDraft.color.toLowerCase());
    custom.classList.toggle('on', !isPreset);
    custom.style.background = isPreset ? '' : teamDraft.color;
    $('#f-color').value = teamDraft.color;
    $('#logoPrev').innerHTML = teamDraft.logo ? `<img src="${teamDraft.logo}" alt="">` : '<span>없음</span>';
    $('#logoClear').hidden = !teamDraft.logo;
  }
  async function saveTeam(btn) {
    const { id, color, logo } = teamDraft;
    const name = (teamDraft.name || '').trim().slice(0, 12);
    const label = name || `2학년 ${classNo(id)}반`;
    await runSave(btn, () => save(d => {
      const t = d.teams.find(x => x.id === id);
      if (name && name !== `2학년 ${classNo(id)}반`) t.name = name; else delete t.name;
      if (color.toLowerCase() !== DEFAULT_COLOR[classNo(id)]) t.color = color.toLowerCase(); else delete t.color;
      if (logo) t.logo = logo; else delete t.logo;
    }, `팀 수정 (${label})`));
  }

  // ---------- league editor ----------
  let leagueDraft = null;
  function openLeague() {
    const lg = leagueInfo();
    leagueDraft = { name: (state.data.league.name || ''), logo: lg.logo };
    openSheet(`<h2>대회 로고</h2>
      <p class="lead">맨 위 대회 로고와 이름, 브라우저 탭 아이콘이 함께 바뀜.</p>
      <div class="league-prev" id="leaguePrev"></div>
      <div class="field"><label for="f-lname">대회 이름</label>
        <input id="f-lname" class="input" maxlength="20" value="${esc(leagueDraft.name)}" placeholder="${DEFAULT_LEAGUE.name}"></div>
      <div class="field"><span class="lab">로고</span>
        <div class="logo-btns">
          <label class="btn file">사진 고르기<input type="file" id="f-llogo" accept="image/*"></label>
          <button class="btn ghost danger" type="button" data-act="llogo-clear" id="llogoClear">기본 로고로</button>
        </div>
        <p class="hint">정사각형 이미지 권장. 160px로 줄여서 저장됨.</p></div>
      <p class="msg"></p>
      <div class="btns"><button class="btn" type="button" data-act="close">취소</button><button class="btn primary" type="button" data-act="save-league">저장</button></div>`);
    syncLeagueDraft();
  }
  function syncLeagueDraft() {
    const name = esc((leagueDraft.name || '').trim() || DEFAULT_LEAGUE.name);
    $('#leaguePrev').innerHTML = `<img class="league-crest ${leagueDraft.logo ? 'custom' : ''}" src="${leagueDraft.logo || 'icon.svg'}" alt="" width="48" height="48">
      <div><div class="lp-name">${name}</div><div class="lp-sub">${DEFAULT_LEAGUE.sub}<span class="sep"></span>${DEFAULT_LEAGUE.season}</div></div>`;
    $('#llogoClear').hidden = !leagueDraft.logo;
  }
  async function saveLeague(btn) {
    const name = (leagueDraft.name || '').trim().slice(0, 20);
    const logo = leagueDraft.logo;
    await runSave(btn, () => save(d => {
      d.league = d.league || {};
      if (name && name !== DEFAULT_LEAGUE.name) d.league.name = name; else delete d.league.name;
      if (logo) d.league.logo = logo; else delete d.league.logo;
    }, '대회 로고 변경'));
  }

  // ---------- schedule editor ----------
  let draft = null;
  function openSchedule() {
    draft = JSON.parse(JSON.stringify(state.data));
    openSheet(`<h2>일정 편집</h2>
      <p class="lead">미루기를 누르면 그 경기와 뒤 경기들이 한 경기일(월, 수)씩 뒤로 밀림. 저장 전까지는 반영되지 않음.</p>
      <label class="check" style="margin-top:-4px"><input type="checkbox" id="s-cascade" checked><span class="t">날짜를 직접 바꿀 때 뒤 경기도 같이 밀기</span></label>
      <div id="schedList"></div>
      <p class="msg"></p>
      <div class="btns"><button class="btn" type="button" data-act="close">취소</button><button class="btn primary" type="button" data-act="save-schedule">저장</button></div>`);
    renderSchedList();
  }
  function renderSchedList() {
    const ms = draft.matches.slice().sort(byNo);
    let html = '';
    for (const r of ROUNDS) {
      html += `<div class="sched-round">${r.title}</div>`;
      html += ms.filter(m => r.ids.includes(m.id)).map(m => {
        const sides = sidesOf(m);
        const label = sides.home.team && sides.away.team ? `${teamName(sides.home.team)} vs ${teamName(sides.away.team)}` : '대진 미정';
        const orig = state.data.matches.find(x => x.id === m.id).date;
        const changed = orig !== m.date;
        return `<div class="sched-row">
          <div style="min-width:0"><div class="sr-t">${m.no}. ${stageLabel(m)}${m.done ? '<span class="sr-done">종료</span>' : ''}</div><div class="sr-s">${label}</div></div>
          <input class="input${changed ? ' changed' : ''}" type="date" data-sdate="${m.id}" value="${m.date || ''}" ${m.done ? 'disabled' : ''}>
          <button class="btn" type="button" data-act="push" data-id="${m.id}" ${m.done || !m.date ? 'disabled' : ''}>미루기</button>
        </div>`;
      }).join('');
    }
    $('#schedList').innerHTML = html;
  }

  // ---------- lottery ----------
  let lotPick = [];
  function openLots(key) {
    let ids, names;
    if (key === 'WC') {
      const cands = state.view.wildcard.candidates;
      const top = cands[0];
      ids = cands.filter(c => L.cmpStats(c, top) === 0).map(c => c.group);
      names = Object.fromEntries(cands.map(c => [c.group, `<span class="nm">${c.group}조 2위${c.ambiguous ? '' : ` (${teamName(c.team)})`}</span>`]));
    } else {
      const t = state.view.tables.find(x => x.group === key);
      ids = t.rows.filter(r => r.statTie).map(r => r.team);
      names = Object.fromEntries(ids.map(id => [id, `${crest(id)}<span class="nm">${teamName(id)}</span>`]));
    }
    lotPick = [];
    const draw = () => {
      $('#lotList').innerHTML = ids.map(id => {
        const k = lotPick.indexOf(id);
        return `<button class="order-item ${k >= 0 ? 'picked' : ''}" type="button" data-act="lotpick" data-id="${id}"><span class="rk">${k >= 0 ? k + 1 : ''}</span>${names[id]}</button>`;
      }).join('');
      $('#sheet [data-act="save-lots"]').disabled = lotPick.length < ids.length - 1;
    };
    openSheet(`<h2>추첨 결과 입력</h2>
      <p class="lead">${key === 'WC' ? '와일드카드' : `${key}조`} 동률 팀을 추첨 순위대로 차례로 선택.</p>
      <div class="order-list" id="lotList"></div>
      <p class="msg"></p>
      <div class="btns">
        ${state.data.lots[key] ? '<button class="btn ghost danger" type="button" data-act="clear-lots">추첨 지우기</button>' : ''}
        <button class="btn" type="button" data-act="close">취소</button>
        <button class="btn primary" type="button" data-act="save-lots">저장</button>
      </div>`);
    openLots.ctx = { key, ids, draw };
    draw();
  }

  // ---------- admin ----------
  function openAdmin() {
    if (isAdmin()) {
      openSheet(`<h2>관리자 모드</h2>
        <p class="lead">이 기기에서 점수, 일정, 팀을 고칠 수 있음. ${esc(REPO.owner)}/${esc(REPO.repo)}</p>
        <div class="sheet-list" style="margin-bottom:16px">
          <button class="team-item" type="button" data-act="schedule"><span class="nm">일정 편집</span>${ICON.chev}</button>
          <button class="team-item" type="button" data-act="teams"><span class="nm">팀 꾸미기</span>${ICON.chev}</button>
          <button class="team-item" type="button" data-act="league"><span class="nm">대회 로고</span>${ICON.chev}</button>
        </div>
        <div class="btns"><button class="btn danger" type="button" data-act="logout">로그아웃</button><button class="btn" type="button" data-act="close">닫기</button></div>`);
      return;
    }
    openSheet(`<h2>관리자 로그인</h2>
      <p class="lead">GitHub 토큰으로 로그인하면 이 기기에서 점수와 일정을 고칠 수 있음. 토큰은 이 브라우저에만 저장됨.</p>
      <div class="field"><label for="f-token">GitHub 토큰</label>
        <input id="f-token" class="input" type="password" autocomplete="off" placeholder="github_pat_...">
        <p class="hint"><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">토큰 만들기</a>에서 저장소는 ${esc(REPO.repo || '이 저장소')}만 고르고, Contents 권한은 Read and write로 설정.</p>
      </div>
      <p class="msg"></p>
      <div class="btns"><button class="btn" type="button" data-act="close">취소</button><button class="btn primary" type="button" data-act="login">로그인</button></div>`);
    setTimeout(() => $('#f-token').focus(), 50);
  }

  async function login(btn) {
    const token = $('#f-token').value.trim();
    if (!token) { sheetError('토큰 입력 필요.'); return; }
    if (!REPO.owner) { sheetError('저장소 주소를 찾지 못함. GitHub Pages 주소에서 열어야 함.'); return; }
    btn.disabled = true;
    state.token = token;
    try {
      const res = await gh(`/repos/${REPO.owner}/${REPO.repo}`);
      if (!res.ok) throw new Error(res.status === 401 ? '토큰이 맞지 않음.' : '이 토큰으로 저장소를 볼 수 없음.');
      const j = await res.json();
      if (!j.permissions || !j.permissions.push) throw new Error('이 토큰에는 쓰기 권한이 없음.');
      store.set(TOKEN_KEY, token);
      closeSheet();
      await load();
      status('관리자 모드로 바뀜.');
    } catch (e) {
      state.token = null;
      sheetError(e.message);
      btn.disabled = false;
    }
  }

  // ---------- events ----------
  document.addEventListener('click', async e => {
    const tab = e.target.closest('.tabs button');
    if (tab) {
      state.tab = tab.dataset.tab;
      store.set(TAB_KEY, state.tab);
      render();
      scrollTo(0, 0);
      return;
    }
    if (e.target.closest('#adminBtn')) { openAdmin(); return; }
    if (e.target.id === 'backdrop') { closeSheet(); return; }

    const step = e.target.closest('[data-step]');
    if (step) {
      const input = $(`#sheet input[name="${step.dataset.for}"]`);
      input.value = Math.max(0, Math.min(99, (parseInt(input.value, 10) || 0) + Number(step.dataset.step)));
      if (readInt('hs') === null) $('#sheet input[name="hs"]').value = 0;
      if (readInt('as') === null) $('#sheet input[name="as"]').value = 0;
      $('#f-done').checked = true;
      syncPk();
      return;
    }

    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const id = el.dataset.id;
    switch (act) {
      case 'close': closeSheet(); break;
      case 'match': openMatch(id); break;
      case 'team': openTeam(id); break;
      case 'teams': openTeamList(); break;
      case 'team-edit': if (isAdmin()) openTeamEdit(id); break;
      case 'league': openLeague(); break;
      case 'schedule': openSchedule(); break;
      case 'round': state.round = Math.max(0, Math.min(ROUNDS.length - 1, state.round + Number(el.dataset.d))); renderFixtures(); break;
      case 'round-go': state.round = Number(el.dataset.i); renderFixtures(); break;
      case 'nextday': { const inp = $('#f-date'); inp.value = L.shiftPlayDays(inp.value || todayStr(), 1); break; }
      case 'save-match': saveMatch(el, false); break;
      case 'clear': saveMatch(el, true); break;
      case 'add-goal': {
        const s = el.dataset.s;
        editDraft.goals.push({ s, n: '' });
        // Keep the score in step with the scorers entered.
        const key = s === 'h' ? 'hs' : 'as';
        const count = editDraft.goals.filter(g => g.s === s).length;
        const input = $(`#sheet input[name="${key}"]`);
        if ((readInt(key) || 0) < count) {
          input.value = count;
          const other = $(`#sheet input[name="${key === 'hs' ? 'as' : 'hs'}"]`);
          if (other.value === '') other.value = 0;
          $('#f-done').checked = true;
        }
        renderGoalList();
        syncPk();
        const rows = document.querySelectorAll('#goalList .g-name');
        if (rows.length) rows[rows.length - 1].focus();
        break;
      }
      case 'goal-del': editDraft.goals.splice(Number(el.dataset.i), 1); renderGoalList(); break;
      case 'goal-og': {
        const g = editDraft.goals[Number(el.dataset.i)];
        g.og = !g.og;
        el.classList.toggle('on', g.og);
        el.setAttribute('aria-pressed', String(g.og));
        break;
      }
      case 'kick': {
        const arr = editDraft.pens[el.dataset.s];
        const k = Number(el.dataset.k);
        const v = arr[k];
        arr[k] = v === 1 ? 0 : v === 0 ? null : 1;
        editDraft.pensTouched = true;
        renderShootEdit();
        break;
      }
      case 'pen-round': editDraft.rounds++; renderShootEdit(); break;
      case 'pen-reset':
        editDraft.pens = { h: [], a: [] };
        editDraft.rounds = PEN_ROUNDS;
        editDraft.pensTouched = true;
        editDraft.legacyPk = null;
        renderShootEdit();
        break;
      case 'swatch': teamDraft.color = el.dataset.c; syncTeamDraft(); break;
      case 'logo-clear': teamDraft.logo = null; syncTeamDraft(); break;
      case 'save-team': saveTeam(el); break;
      case 'llogo-clear': leagueDraft.logo = null; syncLeagueDraft(); break;
      case 'save-league': saveLeague(el); break;
      case 'push': {
        const m = draft.matches.find(x => x.id === id);
        L.reschedule(draft, m.id, L.shiftPlayDays(m.date, 1), true);
        renderSchedList();
        break;
      }
      case 'save-schedule': {
        const dates = Object.fromEntries(draft.matches.map(m => [m.id, m.date]));
        const changed = state.data.matches.filter(m => m.date !== dates[m.id]).length;
        if (!changed) { closeSheet(); break; }
        runSave(el, () => save(d => { d.matches.forEach(m => { if (!m.done && m.id in dates) m.date = dates[m.id]; }); }, `일정 변경 (${changed}경기)`));
        break;
      }
      case 'lots': openLots(el.dataset.key); break;
      case 'lotpick': {
        const k = lotPick.indexOf(id);
        if (k >= 0) lotPick.splice(k); else lotPick.push(id);
        const { ids, draw } = openLots.ctx;
        if (lotPick.length === ids.length - 1) lotPick.push(ids.find(x => !lotPick.includes(x)));
        draw();
        break;
      }
      case 'save-lots': {
        const { key } = openLots.ctx;
        const order = lotPick.slice();
        runSave(el, () => save(d => { d.lots[key] = order; }, `${key === 'WC' ? '와일드카드' : key + '조'} 추첨 결과`));
        break;
      }
      case 'clear-lots': {
        const { key } = openLots.ctx;
        runSave(el, () => save(d => { delete d.lots[key]; }, `${key === 'WC' ? '와일드카드' : key + '조'} 추첨 삭제`));
        break;
      }
      case 'login': login(el); break;
      case 'logout':
        store.del(TOKEN_KEY);
        state.token = null;
        closeSheet();
        render();
        status('로그아웃함.');
        break;
      default: break;
    }
  });

  document.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('#sheet input[name="hs"], #sheet input[name="as"]')) {
      if (readInt('hs') !== null && readInt('as') !== null) $('#f-done').checked = true;
      syncPk();
    } else if (t.classList.contains('g-name') && editDraft) {
      editDraft.goals[Number(t.dataset.i)].n = t.value;
    } else if (t.classList.contains('g-min') && editDraft) {
      const v = parseInt(t.value, 10);
      editDraft.goals[Number(t.dataset.i)].m = Number.isNaN(v) ? undefined : Math.max(0, Math.min(99, v));
    } else if (t.id === 'f-name' && teamDraft) {
      teamDraft.name = t.value;
      const hero = $('#sheet .th-name');
      if (hero) hero.innerHTML = draftLook().name;
    } else if (t.id === 'f-color' && teamDraft) {
      teamDraft.color = t.value;
      syncTeamDraft();
    } else if (t.id === 'f-lname' && leagueDraft) {
      leagueDraft.name = t.value;
      syncLeagueDraft();
    }
  });
  document.addEventListener('change', async e => {
    const t = e.target;
    if (t.id === 'f-logo' || t.id === 'f-llogo') {
      const file = t.files && t.files[0];
      t.value = '';
      if (!file) return;
      try {
        const url = await shrinkLogo(file);
        if (t.id === 'f-logo') { teamDraft.logo = url; syncTeamDraft(); }
        else { leagueDraft.logo = url; syncLeagueDraft(); }
        sheetError('');
      } catch (err) { sheetError(err.message); }
      return;
    }
    const id = t.dataset && t.dataset.sdate;
    if (!id || !draft) return;
    L.reschedule(draft, id, t.value || null, $('#s-cascade').checked);
    renderSchedList();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#sheet').hidden) closeSheet(); });

  // Keep viewers current without a manual refresh.
  setInterval(() => {
    if (document.visibilityState === 'visible' && $('#sheet').hidden) load();
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && $('#sheet').hidden && state.data) load();
  });

  load();
})();
