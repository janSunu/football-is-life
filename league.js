// Standings, tie handling and bracket resolution.
// Works in the browser (window.League) and in Node (module.exports) for tests.
(function (root) {
  const GROUPS = ['A', 'B', 'C'];

  function emptyRow(team) {
    return { team: team.id, group: team.group, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, pts: 0, form: [] };
  }

  function isScored(m) {
    return m.done && Number.isInteger(m.hs) && Number.isInteger(m.as);
  }

  // Ranking criteria from the rules: points, goal difference, goals scored.
  function cmpStats(a, b) {
    return (b.pts - a.pts) || (b.gd - a.gd) || (b.gf - a.gf);
  }

  // Lottery order entered by the admin when every criterion is equal.
  function lotIndex(lots, key, id) {
    const order = lots && lots[key];
    if (!Array.isArray(order)) return -1;
    return order.indexOf(id);
  }

  function cmpWithLots(lots, key, idOf) {
    return (a, b) => {
      const c = cmpStats(a, b);
      if (c) return c;
      const ia = lotIndex(lots, key, idOf(a));
      const ib = lotIndex(lots, key, idOf(b));
      if (ia >= 0 && ib >= 0) return ia - ib;
      return 0;
    };
  }

  function groupTable(data, g) {
    const teams = data.teams.filter(t => t.group === g);
    const rows = Object.fromEntries(teams.map(t => [t.id, emptyRow(t)]));
    const matches = data.matches.filter(m => m.stage === 'group' && m.group === g).sort((a, b) => a.no - b.no);
    for (const m of matches) {
      if (!isScored(m)) continue;
      const h = rows[m.home], a = rows[m.away];
      h.p++; a.p++;
      h.gf += m.hs; h.ga += m.as; a.gf += m.as; a.ga += m.hs;
      // A shootout win counts as a win (3 points), a shootout loss as a loss.
      // Goal difference and goals scored use the regulation score only.
      const pk = m.hs === m.as && Number.isInteger(m.hp) && Number.isInteger(m.ap) && m.hp !== m.ap;
      const homeWon = m.hs > m.as || (pk && m.hp > m.ap);
      const awayWon = m.as > m.hs || (pk && m.ap > m.hp);
      if (homeWon) { h.w++; a.l++; h.pts += 3; h.form.push('W'); a.form.push('L'); }
      else if (awayWon) { a.w++; h.l++; a.pts += 3; h.form.push('L'); a.form.push('W'); }
      else { h.d++; a.d++; h.pts++; a.pts++; h.form.push('D'); a.form.push('D'); }
    }
    const list = Object.values(rows);
    list.forEach(r => { r.gd = r.gf - r.ga; });

    const cmp = cmpWithLots(data.lots, g, r => r.team);
    // Stable base order by seed so the empty table reads A1, A2, A3.
    const seedOrder = teams.map(t => t.id);
    list.sort((a, b) => cmp(a, b) || seedOrder.indexOf(a.team) - seedOrder.indexOf(b.team));

    // Shared rank for rows that cannot be separated; "tied" marks them.
    list.forEach((r, i) => {
      const prev = list[i - 1], next = list[i + 1];
      r.tiedPrev = !!prev && cmp(prev, r) === 0;
      r.tiedNext = !!next && cmp(r, next) === 0;
      r.tied = r.tiedPrev || r.tiedNext;
      r.rank = r.tiedPrev ? prev.rank : i + 1;
      // Tied only on the three stats, before any lottery was applied.
      r.statTie = (!!prev && cmpStats(prev, r) === 0) || (!!next && cmpStats(r, next) === 0);
    });

    const done = matches.length > 0 && matches.every(isScored);
    const played = matches.filter(isScored).length;
    return { group: g, rows: list, done, played, total: matches.length };
  }

  // A slot is { team } when decided, { unknown: true } on an unresolved tie,
  // or { pending: true, label } while the group is still being played.
  function groupSlot(table, pos) {
    const label = `${table.group}조 ${pos}위`;
    if (!table.done) return { pending: true, label };
    const r = table.rows[pos - 1];
    if (r.tied) return { unknown: true, label, tieKey: table.group };
    return { team: r.team, label };
  }

  function wildcard(tables, lots) {
    const label = '와일드카드';
    if (!tables.every(t => t.done)) return { pending: true, label, candidates: candidatesOf(tables) };
    const cands = candidatesOf(tables);
    const cmp = cmpWithLots(lots, 'WC', c => c.group);
    const sorted = cands.slice().sort((a, b) => cmp(a, b) || GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));
    const top = sorted[0];
    const tiedTop = sorted.length > 1 && cmp(top, sorted[1]) === 0;
    if (tiedTop) return { unknown: true, label, tieKey: 'WC', candidates: sorted };
    // The second place itself may be an unresolved tie inside its group. The
    // tied teams share identical stats, so the wildcard group is known even
    // when the team is not.
    if (top.ambiguous) return { unknown: true, label, tieKey: top.group, candidates: sorted };
    return { team: top.team, label, candidates: sorted };
  }

  function candidatesOf(tables) {
    return tables.map(t => {
      const r = t.rows[1];
      return { ...r, group: t.group, ambiguous: r.tied };
    });
  }

  function winnerOf(m, home, away) {
    if (!home.team || !away.team || !isScored(m)) return null;
    if (m.hs > m.as) return home.team;
    if (m.as > m.hs) return away.team;
    if (Number.isInteger(m.hp) && Number.isInteger(m.ap) && m.hp !== m.ap) {
      return m.hp > m.ap ? home.team : away.team;
    }
    return null;
  }

  function koSlot(m, home, away, label) {
    if (!isScored(m)) return { pending: true, label };
    const w = winnerOf(m, home, away);
    return w ? { team: w, label } : { unknown: true, label };
  }

  function compute(data) {
    const tables = GROUPS.map(g => groupTable(data, g));
    const byId = Object.fromEntries(data.matches.map(m => [m.id, m]));
    const t = Object.fromEntries(tables.map(x => [x.group, x]));
    const wc = wildcard(tables, data.lots);

    const sf1 = { home: groupSlot(t.A, 1), away: groupSlot(t.B, 1) };
    const sf2 = { home: groupSlot(t.C, 1), away: wc };
    sf1.winner = winnerOf(byId.SF1, sf1.home, sf1.away);
    sf2.winner = winnerOf(byId.SF2, sf2.home, sf2.away);
    const fin = {
      home: koSlot(byId.SF1, sf1.home, sf1.away, '준결승 1 승자'),
      away: koSlot(byId.SF2, sf2.home, sf2.away, '준결승 2 승자'),
    };
    fin.winner = winnerOf(byId.F, fin.home, fin.away);

    // Teams on each knockout match, keyed by match id, for the fixture list.
    const sides = { SF1: sf1, SF2: sf2, F: fin };
    return { tables, wildcard: wc, sides, champion: fin.winner };
  }

  // ---- Schedule helpers. Dates are "YYYY-MM-DD" strings, play days are weekdays (0 = Sun).
  const PLAY_DAYS = [1, 3]; // 2학년: 월, 수

  function toDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
  function toStr(dt) { return dt.toISOString().slice(0, 10); }
  function addDays(s, n) { const dt = toDate(s); dt.setUTCDate(dt.getUTCDate() + n); return toStr(dt); }
  function isPlayDay(s, days = PLAY_DAYS) { return days.includes(toDate(s).getUTCDay()); }

  // Move a date by n play days. A date that is not itself a play day moves to
  // the nth play day after (or before) it.
  function shiftPlayDays(s, n, days = PLAY_DAYS) {
    let cur = s;
    const step = n >= 0 ? 1 : -1;
    for (let k = 0; k < Math.abs(n); k++) {
      do { cur = addDays(cur, step); } while (!isPlayDay(cur, days));
    }
    return cur;
  }

  // Signed number of play days between two dates.
  // Forward counts play days in (a, b], backward counts play days in [b, a).
  function playDaysBetween(a, b, days = PLAY_DAYS) {
    if (a === b) return 0;
    const [lo, hi, sign] = a < b ? [a, b, 1] : [b, a, -1];
    let n = 0;
    for (let cur = lo; cur <= hi; cur = addDays(cur, 1)) {
      const inRange = sign > 0 ? cur > lo : cur < hi;
      if (inRange && isPlayDay(cur, days)) n++;
    }
    return sign * n;
  }

  // Set a match's date. With cascade, every later unfinished match moves by
  // the same number of play days so the order and spacing stay intact.
  function reschedule(data, matchId, newDate, cascade) {
    const m = data.matches.find(x => x.id === matchId);
    if (!m) return [];
    const old = m.date;
    m.date = newDate || null;
    const moved = [m.id];
    if (!cascade || !old || !newDate) return moved;
    const n = playDaysBetween(old, newDate);
    if (n === 0) return moved;
    for (const x of data.matches) {
      if (x.no > m.no && !x.done && x.date) { x.date = shiftPlayDays(x.date, n); moved.push(x.id); }
    }
    return moved;
  }

  const api = {
    compute, groupTable, isScored, cmpStats, GROUPS,
    PLAY_DAYS, shiftPlayDays, playDaysBetween, reschedule, isPlayDay, addDays,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.League = api;
})(typeof window !== 'undefined' ? window : globalThis);
