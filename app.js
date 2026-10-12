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

  const state = {
    data: null,
    view: null,
    teams: {},
    tab: store.get(TAB_KEY) || 'fixtures',
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

  function todayStr() {
    return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
  }
  function parts(s) { const [y, m, d] = s.split('-').map(Number); return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }; }
  function fmtLong(s) { const p = parts(s); return `${p.m}월 ${p.d}일 ${WD[p.wd]}요일`; }
  function fmtShort(s) { const p = parts(s); return `${p.m}월 ${p.d}일 (${WD[p.wd]})`; }
  function relDay(s) {
    const t = todayStr();
    if (s === t) return '오늘';
    if (s === L.addDays(t, 1)) return '내일';
    if (s === L.addDays(t, -1)) return '어제';
    return '';
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

  // ---------- teams ----------
  function classNo(id) { return Number(id.split('-')[1]); }
  function teamObj(id) { return state.teams[id] || { id }; }
  function rawName(id) { const t = teamObj(id); return (t.name && t.name.trim()) || `2학년 ${classNo(id)}반`; }
  function teamName(id) { return esc(rawName(id)); }
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
    const lg = state.data && state.data.league || {};
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
  function matchTitle(m) {
    return m.stage === 'group' ? `${m.group}조 리그 ${m.no}경기` : stageLabel(m);
  }

  // Teams playing a match: fixed for group games, resolved for knockouts.
  function sidesOf(m) {
    if (m.stage === 'group') return { home: { team: m.home }, away: { team: m.away } };
    return state.view.sides[m.id];
  }
  function slotView(slot, size) {
    if (slot.team) return { id: slot.team, name: teamName(slot.team), crest: crest(slot.team, size), cls: '' };
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

  const ICON = {
    pen: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>',
    trophy: '<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M7 3h10v2h3v3a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 14.9V18h3v3H8v-3h3v-3.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V5h3V3zm0 4H6v1a2 2 0 0 0 1 1.7V7zm10 0v2.7A2 2 0 0 0 18 8V7h-1z"/></svg>',
    chev: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
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
    if (!res.ok) throw new Error(res.status === 401 ? '토큰이 만료됐거나 잘못됐어요.' : `불러오기 실패 (${res.status})`);
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
        catch (e) { status(e.message + ' 관리자 메뉴에서 다시 로그인해 주세요.', true); }
      }
      if (!data) {
        const res = await fetch(`${DATA_PATH}?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`불러오기 실패 (${res.status})`);
        data = await res.json();
      }
      setData(data);
    } catch (e) {
      status(e.message, true);
      if (!state.data) $('#fixtures').innerHTML = `<div class="card"><p class="empty">경기 정보를 불러오지 못했어요.</p></div>`;
    }
  }
  function setData(data) {
    data.lots = data.lots || {};
    data.league = data.league || {};
    state.data = data;
    state.teams = Object.fromEntries(data.teams.map(t => [t.id, t]));
    state.view = L.compute(data);
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
        status('저장했어요. 다른 사람 화면에는 1분쯤 뒤에 반영돼요.');
        return true;
      }
      if (res.status === 409 || res.status === 422) continue; // someone saved in between
      if (res.status === 401 || res.status === 403) throw new Error('저장 권한이 없어요. 토큰 권한(Contents 쓰기)을 확인해 주세요.');
      throw new Error(`저장 실패 (${res.status})`);
    }
    throw new Error('저장이 겹쳤어요. 잠시 뒤 다시 시도해 주세요.');
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

  // ---------- render ----------
  function render() {
    document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === state.tab)));
    ['fixtures', 'table', 'bracket'].forEach(id => { $('#' + id).hidden = id !== state.tab; });
    $('#adminBtn').classList.toggle('on', isAdmin());
    renderLeague();
    renderFixtures();
    renderTable();
    renderBracket();
    const u = state.data.updatedAt;
    $('#foot').innerHTML = (u ? `마지막 업데이트 ${new Date(u).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}<br>` : '') +
      '경기 일정은 학사 일정과 날씨에 따라 바뀔 수 있어요.';
    if (state.tab === 'fixtures' && !state.scrolled) scrollToNext();
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

  function fixtureRow(m) {
    const sides = sidesOf(m);
    const h = slotView(sides.home), a = slotView(sides.away);
    const win = winnerSide(m);
    const scored = L.isScored(m);
    let score = '<span class="vs">vs</span>';
    if (scored) {
      score = `${m.hs} - ${m.as}`;
      if (hasPk(m)) score += `<span class="pk">PK ${m.hp}:${m.ap}</span>`;
    }
    return `<button class="fx" data-act="match" data-id="${m.id}" type="button">
      <div class="fx-meta"><b>${m.stage === 'sf' ? '준결승' : stageLabel(m)}</b>${scored ? '종료' : `${m.no}경기`}</div>
      <div class="fx-team home ${h.cls} ${win === 'away' ? 'lose' : ''}"><span class="nm">${h.name}</span>${h.crest}</div>
      <div class="fx-score">${score}</div>
      <div class="fx-team away ${a.cls} ${win === 'home' ? 'lose' : ''}">${a.crest}<span class="nm">${a.name}</span></div>
      <div class="fx-edit">${isAdmin() ? ICON.pen : ''}</div>
    </button>`;
  }

  function renderFixtures() {
    const ms = state.data.matches.slice().sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.no - b.no);
    const groups = [];
    for (const m of ms) {
      const key = m.date || '';
      let g = groups[groups.length - 1];
      if (!g || g.key !== key) { g = { key, list: [] }; groups.push(g); }
      g.list.push(m);
    }
    let html = '';
    if (isAdmin()) {
      html += `<div class="card admin-bar"><div class="card-head"><span>관리자 모드</span><span class="sub">경기를 누르면 결과와 날짜를 고칠 수 있어요</span></div>
        <div class="admin-actions">
          <button class="btn" data-act="schedule" type="button">일정 편집</button>
          <button class="btn" data-act="teams" type="button">팀 꾸미기</button>
          <button class="btn" data-act="league" type="button">대회 로고</button>
        </div></div>`;
    }
    for (const g of groups) {
      const rel = g.key ? relDay(g.key) : '';
      html += `<div class="card" data-date="${g.key}">
        <div class="card-head"><span>${g.key ? fmtLong(g.key) : '날짜 미정'}</span><span class="sub ${rel === '오늘' ? 'today' : ''}">${rel}</span></div>
        ${g.list.map(fixtureRow).join('')}
      </div>`;
    }
    $('#fixtures').innerHTML = html;
  }

  function scrollToNext() {
    state.scrolled = true;
    const t = todayStr();
    const next = state.data.matches.filter(m => m.date && m.date >= t && !m.done).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (!next) return;
    const first = state.data.matches.filter(m => m.date).sort((a, b) => a.date.localeCompare(b.date))[0];
    if (first && first.date === next.date) return;
    const el = document.querySelector(`.card[data-date="${next.date}"]`);
    if (el) requestAnimationFrame(() => {
      const top = el.getBoundingClientRect().top + scrollY - $('.top').offsetHeight - 12;
      scrollTo(0, top);
    });
  }

  function formHtml(form) {
    const map = { W: '승', D: '무', L: '패' };
    return `<span class="form-row">${form.slice(-3).map(f => `<i class="${f}">${map[f]}</i>`).join('')}</span>`;
  }
  function gdText(n) { return n > 0 ? `+${n}` : String(n); }

  function tieNote(key, n, resolved) {
    const btn = isAdmin() ? `<button class="btn ghost link" data-act="lots" data-key="${key}" type="button">${resolved ? '추첨 수정' : '추첨 결과 입력'}</button>` : '';
    const text = resolved
      ? '승점, 골득실, 다득점이 같아 추첨으로 순위를 정했어요.'
      : `<span class="q">?</span>${n}팀이 승점, 골득실, 다득점까지 같아요. 추첨으로 결정돼요.`;
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
    </ol><p style="margin:10px 0 0">와일드카드는 각 조 2위 중 같은 기준으로 1팀을 뽑아요.</p></div></div>`;
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
      const v = slotView(slot);
      const won = win === side && slot.team;
      return `<div class="br-row ${v.cls} ${win && win !== side ? 'lose' : ''} ${won ? 'won tc' : ''}" ${won ? `style="${tcVars(colorOf(slot.team))}"` : ''}>
        ${v.crest}<span class="nm">${v.name}</span>
        <span class="sc">${scored ? `${pk ? `<small>(${p})</small>` : ''}${s}` : ''}</span></div>`;
    };
    return `<button class="br-match" data-act="match" data-id="${m.id}" type="button">
      ${row(sides.home, m.hs, m.hp, 'home')}${row(sides.away, m.as, m.ap, 'away')}
      <div class="br-date">${m.date ? fmtShort(m.date) : '날짜 미정'}${scored ? '  종료' : ''}</div>
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
    </ol><p style="margin:10px 0 0">조별 리그가 끝나면 순위대로 자동으로 채워져요. 순위가 완전히 같아 추첨이 필요한 자리는 ?로 표시돼요.</p></div></div>`;
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
  }
  function sheetError(text) { const el = $('#sheet .msg'); if (el) el.textContent = text; }
  async function runSave(btn, fn) {
    btn.disabled = true;
    try { await fn(); closeSheet(); }
    catch (e) { sheetError(e.message); status(e.message, true); btn.disabled = false; }
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
    if (L.isScored(m)) score = `<span class="big">${m.hs}<i>-</i>${m.as}</span>${hasPk(m) ? `<span class="pk">PK ${m.hp}:${m.ap}</span>` : '<span class="pk">종료</span>'}`;
    return `<div class="hero match-hero" style="background:${bg || 'none'}">
      <div class="grip"></div>
      <div class="mh-top">${matchTitle(m)}<span>${m.date ? fmtShort(m.date) : '날짜 미정'}</span></div>
      <div class="mh-row">${team(h, 'home')}<div class="mh-score">${score}</div>${team(a, 'away')}</div>
      <div class="mh-stripe" style="background:${stripe}"></div>
    </div>`;
  }

  function openMatch(id) {
    const m = state.data.matches.find(x => x.id === id);
    if (isAdmin()) { openEdit(m); return; }
    let body = '';
    if (m.stage === 'group') {
      const t = state.view.tables.find(x => x.group === m.group);
      body += `<div class="sheet-sec">${m.group}조 순위</div><div class="mini">${miniTable(t, [m.home, m.away])}</div>`;
    } else {
      const label = { SF1: 'A조 1위 vs B조 1위', SF2: 'C조 1위 vs 와일드카드', F: '준결승 1 승자 vs 준결승 2 승자' }[m.id];
      body += `<div class="sheet-sec">대진</div><p class="lead" style="margin-bottom:16px">${label}</p>`;
    }
    body += `<div class="btns"><button class="btn" type="button" data-act="close">닫기</button></div>`;
    openSheet(body, matchHero(m));
  }

  function miniTable(t, highlight) {
    return `<table class="tbl mini-tbl"><thead><tr><th class="l" style="padding-left:12px">#</th><th class="l">팀</th><th class="c">경기</th><th class="gd">골득실</th><th class="pts">승점</th></tr></thead><tbody>
      ${t.rows.map((r, i) => `<tr data-act="team" data-id="${r.team}" class="${highlight.includes(r.team) ? 'hl' : ''}"><td class="pos">${t.played ? r.rank : i + 1}</td><td class="team l"><span>${crest(r.team)}<span class="nm">${teamName(r.team)}</span></span></td><td class="c">${r.p}</td><td class="gd">${gdText(r.gd)}</td><td class="pts">${r.pts}</td></tr>`).join('')}
    </tbody></table>`;
  }

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
    openSheet(`
      <div class="field"><label for="f-date">날짜</label>
        <div class="btns"><input id="f-date" class="input" type="date" value="${m.date || ''}" style="flex:1">
        <button class="btn" type="button" data-act="nextday" style="flex:none">다음 경기일로</button></div>
        ${later ? `<label class="check" style="margin:10px 0 0;border-bottom:0"><input type="checkbox" id="f-cascade" checked><span class="t">뒤 경기 ${later}개도 같은 만큼 미루기</span></label>` : ''}
      </div>
      <div class="field"><span class="lab">점수</span>
        <div class="score-edit">
          <div class="score-side"><div class="tn">${h.crest}<span>${h.name}</span></div>${stepper('hs', m.hs)}</div>
          <div class="colon">:</div>
          <div class="score-side"><div class="tn">${a.crest}<span>${a.name}</span></div>${stepper('as', m.as)}</div>
        </div>
      </div>
      ${ko ? `<div class="field" id="pkField" hidden><span class="lab">승부차기</span>
        <div class="score-edit small"><div>${stepper('hp', m.hp)}</div><div class="colon">:</div><div>${stepper('ap', m.ap)}</div></div></div>` : ''}
      <label class="check"><input type="checkbox" id="f-done" ${m.done ? 'checked' : ''}><span class="t">경기 종료</span><span class="d">체크해야 순위에 반영돼요</span></label>
      <p class="msg"></p>
      <div class="btns">
        ${L.isScored(m) ? '<button class="btn ghost danger" type="button" data-act="clear">결과 지우기</button>' : ''}
        <button class="btn" type="button" data-act="close">취소</button>
        <button class="btn primary" type="button" data-act="save-match" data-id="${m.id}">저장</button>
      </div>`, matchHero(m));
    syncPk();
  }

  function readInt(name) {
    const el = $(`#sheet input[name="${name}"]`);
    if (!el || el.value === '') return null;
    const n = Math.max(0, Math.min(99, parseInt(el.value, 10)));
    return Number.isNaN(n) ? null : n;
  }
  function syncPk() {
    const f = $('#pkField');
    if (!f) return;
    const hs = readInt('hs'), as = readInt('as');
    f.hidden = !(hs !== null && as !== null && hs === as);
  }

  async function saveMatch(btn, clear) {
    const id = $('#sheet [data-act="save-match"]').dataset.id;
    const m0 = state.data.matches.find(x => x.id === id);
    const date = $('#f-date').value || null;
    const cascade = !!($('#f-cascade') && $('#f-cascade').checked);
    let hs = readInt('hs'), as = readInt('as'), hp = readInt('hp'), ap = readInt('ap');
    let done = $('#f-done').checked;
    if (clear) { hs = as = hp = ap = null; done = false; }
    if (done && (hs === null || as === null)) { sheetError('종료로 저장하려면 두 팀 점수를 모두 넣어 주세요.'); return; }
    if (!(hs !== null && hs === as)) { hp = ap = null; }
    await runSave(btn, () => save(d => {
      const m = d.matches.find(x => x.id === id);
      if (date !== m.date) L.reschedule(d, id, date, cascade);
      m.done = done;
      m.hs = done ? hs : null;
      m.as = done ? as : null;
      if (m.stage !== 'group') { m.hp = done ? hp : null; m.ap = done ? ap : null; }
    }, `${matchTitle(m0)} ${clear ? '결과 삭제' : done ? `결과 ${hs}:${as}` : '수정'}`));
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
    }).sort((a, b) => a.no - b.no);
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
    const body = `
      <div class="stats">${stat('경기', row.p)}${stat('전적', `${row.w}승 ${row.d}무 ${row.l}패`, 'sm')}${stat('골득실', gdText(row.gd))}${stat('승점', row.pts)}</div>
      <div class="sheet-sec">경기</div>
      <div class="sheet-list">${ms.map(fixtureRow).join('')}</div>
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
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('이미지를 열 수 없어요.')); };
      img.src = url;
    });
  }
  // Shrinks a picture to fit a square, keeping transparency, so it can live in data.json.
  async function shrinkLogo(file) {
    if (!file.type.startsWith('image/')) throw new Error('이미지 파일만 올릴 수 있어요.');
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
    if (out.length > 140000) throw new Error('이미지가 너무 복잡해요. 더 단순한 로고를 써 주세요.');
    return out;
  }

  // ---------- team editor ----------
  let teamDraft = null;
  function openTeamList() {
    const body = `<h2>팀 꾸미기</h2>
      <p class="lead">팀을 골라 이름, 팀 컬러, 로고를 바꿀 수 있어요. 바꾼 색과 로고는 경기, 순위, 토너먼트 화면 전체에 쓰여요.</p>
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
        <p class="hint">비워 두면 2학년 ${classNo(id)}반으로 표시돼요.</p></div>
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
        <p class="hint">정사각형에 배경이 투명한 PNG가 가장 깔끔해요. 160px로 줄여서 저장돼요.</p></div>
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
      <p class="lead">맨 위 대회 로고와 이름, 브라우저 탭 아이콘이 함께 바뀌어요.</p>
      <div class="league-prev" id="leaguePrev"></div>
      <div class="field"><label for="f-lname">대회 이름</label>
        <input id="f-lname" class="input" maxlength="20" value="${esc(leagueDraft.name)}" placeholder="${DEFAULT_LEAGUE.name}"></div>
      <div class="field"><span class="lab">로고</span>
        <div class="logo-btns">
          <label class="btn file">사진 고르기<input type="file" id="f-llogo" accept="image/*"></label>
          <button class="btn ghost danger" type="button" data-act="llogo-clear" id="llogoClear">기본 로고로</button>
        </div>
        <p class="hint">정사각형 이미지가 좋아요. 160px로 줄여서 저장돼요.</p></div>
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
      <p class="lead">미루기를 누르면 그 경기와 뒤 경기들이 한 경기일(월, 수)씩 뒤로 밀려요. 저장 전까지는 반영되지 않아요.</p>
      <label class="check" style="margin-top:-4px"><input type="checkbox" id="s-cascade" checked><span class="t">날짜를 직접 바꿀 때 뒤 경기도 같이 밀기</span></label>
      <div id="schedList"></div>
      <p class="msg"></p>
      <div class="btns"><button class="btn" type="button" data-act="close">취소</button><button class="btn primary" type="button" data-act="save-schedule">저장</button></div>`);
    renderSchedList();
  }
  function renderSchedList() {
    const ms = draft.matches.slice().sort((a, b) => a.no - b.no);
    $('#schedList').innerHTML = ms.map(m => {
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

  // ---------- lottery ----------
  let lotPick = [];
  function openLots(key) {
    let ids, names;
    if (key === 'WC') {
      const cands = state.view.wildcard.candidates;
      const top = cands[0];
      ids = cands.filter(c => L.cmpStats(c, top) === 0).map(c => c.group);
      names = Object.fromEntries(cands.map(c => [c.group, `${c.group}조 2위${c.ambiguous ? '' : ` (${teamName(c.team)})`}`]));
    } else {
      const t = state.view.tables.find(x => x.group === key);
      ids = t.rows.filter(r => r.statTie).map(r => r.team);
      names = Object.fromEntries(ids.map(id => [id, `${crest(id)}<span class="nm">${teamName(id)}</span>`]));
    }
    lotPick = [];
    const draw = () => {
      $('#lotList').innerHTML = ids.map(id => {
        const k = lotPick.indexOf(id);
        const nm = names[id].includes('<span') ? names[id] : `<span class="nm">${names[id]}</span>`;
        return `<button class="order-item ${k >= 0 ? 'picked' : ''}" type="button" data-act="lotpick" data-id="${id}"><span class="rk">${k >= 0 ? k + 1 : ''}</span>${nm}</button>`;
      }).join('');
      $('#sheet [data-act="save-lots"]').disabled = lotPick.length < ids.length - 1;
    };
    openSheet(`<h2>추첨 결과 입력</h2>
      <p class="lead">${key === 'WC' ? '와일드카드' : `${key}조`} 동률 팀을 추첨 순위대로 눌러 주세요.</p>
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
        <p class="lead">이 기기에서 점수, 일정, 팀을 고칠 수 있어요. ${esc(REPO.owner)}/${esc(REPO.repo)}</p>
        <div class="sheet-list" style="margin-bottom:16px">
          <button class="team-item" type="button" data-act="schedule"><span class="nm">일정 편집</span>${ICON.chev}</button>
          <button class="team-item" type="button" data-act="teams"><span class="nm">팀 꾸미기</span>${ICON.chev}</button>
          <button class="team-item" type="button" data-act="league"><span class="nm">대회 로고</span>${ICON.chev}</button>
        </div>
        <div class="btns"><button class="btn danger" type="button" data-act="logout">로그아웃</button><button class="btn" type="button" data-act="close">닫기</button></div>`);
      return;
    }
    openSheet(`<h2>관리자 로그인</h2>
      <p class="lead">GitHub 토큰으로 로그인하면 이 기기에서 점수와 일정을 고칠 수 있어요. 토큰은 이 브라우저에만 저장돼요.</p>
      <div class="field"><label for="f-token">GitHub 토큰</label>
        <input id="f-token" class="input" type="password" autocomplete="off" placeholder="github_pat_...">
        <p class="hint"><a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">토큰 만들기</a>에서 저장소는 ${esc(REPO.repo || '이 저장소')}만 고르고, Contents 권한을 Read and write로 주세요.</p>
      </div>
      <p class="msg"></p>
      <div class="btns"><button class="btn" type="button" data-act="close">취소</button><button class="btn primary" type="button" data-act="login">로그인</button></div>`);
    setTimeout(() => $('#f-token').focus(), 50);
  }

  async function login(btn) {
    const token = $('#f-token').value.trim();
    if (!token) { sheetError('토큰을 넣어 주세요.'); return; }
    if (!REPO.owner) { sheetError('저장소 주소를 찾지 못했어요. GitHub Pages 주소에서 열어 주세요.'); return; }
    btn.disabled = true;
    state.token = token;
    try {
      const res = await gh(`/repos/${REPO.owner}/${REPO.repo}`);
      if (!res.ok) throw new Error(res.status === 401 ? '토큰이 맞지 않아요.' : '이 토큰으로 저장소를 볼 수 없어요.');
      const j = await res.json();
      if (!j.permissions || !j.permissions.push) throw new Error('이 토큰에는 쓰기 권한이 없어요.');
      store.set(TOKEN_KEY, token);
      closeSheet();
      await load();
      status('관리자 모드로 바뀌었어요.');
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
      if (['hs', 'as'].includes(input.name)) {
        if (readInt('hs') === null) $('#sheet input[name="hs"]').value = 0;
        if (readInt('as') === null) $('#sheet input[name="as"]').value = 0;
        $('#f-done').checked = true;
      }
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
      case 'nextday': { const inp = $('#f-date'); inp.value = L.shiftPlayDays(inp.value || todayStr(), 1); break; }
      case 'save-match': saveMatch(el, false); break;
      case 'clear': saveMatch(el, true); break;
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
        status('로그아웃했어요.');
        break;
      default: break;
    }
  });

  document.addEventListener('input', e => {
    const t = e.target;
    if (t.matches('#sheet input[name="hs"], #sheet input[name="as"]')) {
      if (readInt('hs') !== null && readInt('as') !== null) $('#f-done').checked = true;
      syncPk();
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
