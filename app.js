/* Price Action Decision — UI */
(function () {
  'use strict';
  const PA = window.PA;
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const STORE = 'pad.v1';
  const MAX_STORED = 1500;
  const DEF_SPREAD = { XAUUSD: 3, USDJPY: 1.2, GBPJPY: 2.5, EURJPY: 1.8, GBPUSD: 1.2 };

  const state = {
    inst: 'EURUSD',
    candles: [],
    source: 'demo', // demo | csv | manual
    demoKind: 'mixed',
    demoSeed: 6,
    s: { balance: 10000, riskPct: 1, spreadPips: 1, pipValue: null, pipSize: 0.0001, minRR: 1.5, threshold: 6, swingK: 3 },
    view: 100,
    tg: { sr: true, ema: true, swing: false, pat: true, sig: true },
    cut: 0,
    a: null, bt: null, ind: null, hover: -1,
    geo: null,
  };

  /* ------------------------------ helpers ------------------------------ */
  const inst = () => PA.INSTRUMENTS[state.inst];
  const pipSize = () => (state.inst === 'CUSTOM' ? state.s.pipSize || 0.0001 : inst().pipSize);
  const lastPrice = () => (state.candles.length ? state.candles[state.candles.length - 1].c : inst().price);
  const pipValue = () => (state.s.pipValue != null ? state.s.pipValue : PA.pipValueUSD(inst(), lastPrice()));
  const dp = () => (state.candles.length ? PA.inferPrecision(state.candles) : inst().dp);
  const fmt = (x) => (x == null || !isFinite(x) ? '—' : x.toFixed(dp()));
  const pipsOf = (d) => (Math.abs(d) / pipSize()).toFixed(1);
  const money = (x) => (x == null ? '—' : '$' + x.toLocaleString('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
  const shortT = (t) => {
    t = String(t);
    return /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(t) ? t.slice(5, 16).replace('T', ' ') : t.slice(0, 10);
  };
  const engineOpts = () => ({
    spread: state.s.spreadPips * pipSize(),
    minRR: state.s.minRR,
    threshold: state.s.threshold,
    swingK: state.s.swingK,
    dp: dp(),
  });
  const minC = () => PA.DEFAULTS.minCandles;

  function css(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  /* ------------------------------ storage ------------------------------ */
  function save() {
    try {
      const o = { inst: state.inst, source: state.source, demoKind: state.demoKind, demoSeed: state.demoSeed, s: state.s, view: state.view, tg: state.tg };
      if (state.source !== 'demo') o.candles = state.candles.slice(-MAX_STORED);
      localStorage.setItem(STORE, JSON.stringify(o));
    } catch (e) { /* storage bisa diblokir — abaikan */ }
  }
  function load() {
    try {
      const raw = localStorage.getItem(STORE);
      if (!raw) return false;
      const o = JSON.parse(raw);
      if (!PA.INSTRUMENTS[o.inst]) return false;
      Object.assign(state, { inst: o.inst, source: o.source || 'demo', demoKind: o.demoKind || 'mixed', demoSeed: o.demoSeed || 6, view: o.view || 100 });
      Object.assign(state.s, o.s || {});
      Object.assign(state.tg, o.tg || {});
      if (state.source !== 'demo' && Array.isArray(o.candles) && o.candles.length >= 2) state.candles = o.candles;
      else { state.source = 'demo'; }
      return true;
    } catch (e) { return false; }
  }

  /* ------------------------------ data ------------------------------ */
  function setCandles(c, source, resetCut) {
    state.candles = c;
    state.source = source;
    if (resetCut !== false) state.cut = c.length - 1;
    recomputeAll();
    save();
  }
  function genDemo() {
    setCandles(PA.generateDemo(state.demoKind, state.inst, 400, state.demoSeed), 'demo');
  }

  /* ------------------------------ compute ------------------------------ */
  function recomputeCut() {
    const n = state.candles.length;
    if (!n) { state.a = null; return; }
    state.cut = Math.max(0, Math.min(state.cut, n - 1));
    state.a = PA.analyzeAt(state.candles, state.cut, engineOpts(), state.ind);
  }
  function recomputeAll() {
    const n = state.candles.length;
    state.ind = n ? PA.computeIndicators(state.candles, engineOpts()) : null;
    state.bt = n >= minC() + 5 ? PA.backtest(state.candles, engineOpts()) : null;
    recomputeCut();
    renderAll();
  }
  function renderAll() {
    syncCut();
    renderDecision();
    renderPlan();
    renderReasons();
    renderStructure();
    renderBacktest();
    renderDataInfo();
    drawChart();
  }

  /* ------------------------------ cut / replay ------------------------------ */
  function syncCut() {
    const n = state.candles.length;
    const r = $('cut');
    r.min = Math.min(minC() - 1, Math.max(0, n - 1));
    r.max = Math.max(0, n - 1);
    r.value = state.cut;
    r.disabled = n < minC();
    const c = state.candles[state.cut];
    if (!c) { $('cutLabel').textContent = 'Belum ada data.'; return; }
    const later = n - 1 - state.cut;
    $('cutLabel').textContent =
      'Analisis sampai candle #' + (state.cut + 1) + '/' + n + ' · ' + shortT(c.t) + ' · close ' + fmt(c.c) +
      (later > 0 ? ' · ' + later + ' candle setelahnya ditampilkan pudar (untuk belajar/replay)' : ' · candle terbaru');
  }
  function setCut(i) {
    state.cut = Math.max(0, Math.min(state.candles.length - 1, i));
    recomputeCut();
    renderAll();
  }
  function jumpSignal(dir) {
    if (!state.bt) return;
    const sigs = state.bt.signals.map((s) => s.i);
    const t = dir < 0 ? sigs.filter((i) => i < state.cut).pop() : sigs.find((i) => i > state.cut);
    if (t != null) setCut(t);
  }

  /* ------------------------------ panel keputusan ------------------------------ */
  function renderDecision() {
    const el = $('decision');
    const a = state.a;
    if (!a || !a.ok) {
      el.innerHTML = '<h2>Keputusan</h2><p class="hint">' + esc(a ? a.error : 'Belum ada data. Pilih data contoh atau impor CSV.') + '</p>';
      return;
    }
    const d = a.decision;
    const th = state.s.threshold;
    const pos = (v) => Math.max(0, Math.min(100, ((v + 10) / 20) * 100));
    const icon = { BUY: '▲', SELL: '▼', WAIT: '⏸' }[d.action];
    const meta = d.action === 'WAIT'
      ? 'Skor <b>' + (a.score > 0 ? '+' : '') + a.score + '</b> · butuh ±' + th + ' + pemicu'
      : 'Keyakinan <b>' + d.confidence + '</b> · skor <b>' + (a.score > 0 ? '+' : '') + a.score + '</b>';
    el.innerHTML =
      '<div class="badge-row"><span class="badge ' + d.action + '"><span aria-hidden="true">' + icon + '</span> ' + d.action + '</span>' +
      '<div class="badge-meta">' + meta + '<br>' + esc(shortT(a.time)) + ' · harga ' + fmt(a.price) + '</div></div>' +
      '<p class="summary">' + esc(d.summary) + '</p>' +
      '<div class="meter" role="img" aria-label="Skor bias ' + a.score + ' dari -10 sampai +10">' +
      '<span class="mid"></span><span class="tk" style="left:' + pos(-th) + '%"></span><span class="tk" style="left:' + pos(th) + '%"></span>' +
      '<span class="dot" style="left:' + pos(a.score) + '%"></span></div>' +
      '<div class="meter-lab"><span>Bearish</span><span>Netral</span><span>Bullish</span></div>';
  }

  function planText(a, sz) {
    const p = a.plan;
    const i = inst();
    return [
      (p.side === 'BUY' ? 'BUY STOP ' : 'SELL STOP ') + i.name,
      'Entry : ' + fmt(p.entry),
      'SL    : ' + fmt(p.sl) + ' (' + pipsOf(p.entry - p.sl) + ' pip)',
      'TP1   : ' + fmt(p.tp1) + ' (RR ' + p.rr1.toFixed(2) + ')',
      'TP2   : ' + fmt(p.tp2) + ' (RR ' + p.rr2.toFixed(2) + ')',
      sz ? 'Lot   : ' + sz.lots.toFixed(2) + ' (risiko ' + money(sz.realRisk) + ')' : '',
      'Batalkan jika tidak terpicu dalam 3 candle atau SL tersentuh lebih dulu.',
    ].filter(Boolean).join('\n');
  }

  function renderPlan() {
    const el = $('plan');
    const a = state.a;
    if (!a || !a.ok) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    const d = a.decision;
    if (d.action === 'WAIT') {
      el.innerHTML = '<h2>Yang perlu ditunggu</h2><ul class="clean">' +
        d.watch.map((w) => '<li><span class="note">•</span><span>' + esc(w) + '</span></li>').join('') + '</ul>';
      return;
    }
    const p = a.plan;
    const sz = PA.positionSize({
      balance: state.s.balance, riskPct: state.s.riskPct, entry: p.entry, sl: p.sl, spread: p.spread,
      pipSize: pipSize(), pipValue: pipValue(), tp1: p.tp1, tp2: p.tp2,
    });
    const buy = p.side === 'BUY';
    let h = '<h2>Rencana trade — ' + (buy ? 'Buy Stop' : 'Sell Stop') + '</h2><table class="kv">' +
      '<tr><td>Entry</td><td class="en"><b>' + fmt(p.entry) + '</b><span class="sub">pending: aktif jika harga menembus ' + (buy ? 'high' : 'low') + ' pola</span></td></tr>' +
      '<tr><td>Stop loss</td><td class="sl"><b>' + fmt(p.sl) + '</b><span class="sub">' + pipsOf(p.entry - p.sl) + ' pip' + (p.spread ? ' + spread ' + (p.spread / pipSize()).toFixed(1) : '') + '</span></td></tr>' +
      '<tr><td>TP1</td><td class="tp"><b>' + fmt(p.tp1) + '</b><span class="sub">' + pipsOf(p.tp1 - p.entry) + ' pip · RR ' + p.rr1.toFixed(2) + (p.blocker ? ' · sebelum level ' + fmt(p.blocker.price) : '') + '</span></td></tr>' +
      '<tr><td>TP2</td><td class="tp"><b>' + fmt(p.tp2) + '</b><span class="sub">' + pipsOf(p.tp2 - p.entry) + ' pip · RR ' + p.rr2.toFixed(2) + '</span></td></tr>';
    if (sz) {
      h += '<tr><td>Ukuran posisi</td><td><b>' + sz.lots.toFixed(2) + ' lot</b><span class="sub">risiko ' + money(sz.realRisk) + ' dari ' + money(sz.riskAmount) + ' (' + state.s.riskPct + '%)</span></td></tr>' +
        '<tr><td>Potensi profit</td><td>TP1 ' + money(sz.tp1Profit) + '<span class="sub">TP2 ' + money(sz.tp2Profit) + ' (setelah spread)</span></td></tr>';
    }
    h += '</table>';
    if (sz && sz.belowMinLot) h += '<p class="warn" style="margin-top:8px">Risiko ' + state.s.riskPct + '% terlalu kecil untuk 0,01 lot pada SL ini — jangan paksa masuk dengan lot lebih besar dari rencana risiko.</p>';
    h += '<p class="guide">Pasang order pending. Batalkan jika tidak terpicu dalam 3 candle atau SL tersentuh lebih dulu. Saat TP1 tercapai: tutup sebagian (mis. 50%) dan geser SL ke break-even.</p>' +
      '<div class="copy-row"><button class="btn" id="copyPlan">Salin rencana</button><span class="msg" id="copyMsg" role="status"></span></div>';
    el.innerHTML = h;
    $('copyPlan').onclick = () => {
      const txt = planText(a, sz);
      const done = () => { $('copyMsg').textContent = 'Tersalin.'; $('copyMsg').className = 'msg ok'; };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, () => { $('copyMsg').textContent = 'Gagal menyalin.'; });
      else { $('copyMsg').textContent = 'Clipboard tidak tersedia di browser ini.'; }
    };
  }

  function renderReasons() {
    const el = $('reasons');
    const a = state.a;
    if (!a || !a.ok) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    const d = a.decision;
    const cls = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
    let h = '<h2>Alasan keputusan</h2>';
    if (d.reasons.length) h += '<ul class="clean">' + d.reasons.map((r) => '<li><span>' + esc(r) + '</span></li>').join('') + '</ul>';
    h += '<h3>Rincian skor</h3><ul class="clean">' +
      a.breakdown.map((b) => '<li><span class="pts ' + cls(b.pts) + '">' + (b.pts > 0 ? '+' : '') + b.pts + '</span><span class="lab">' + esc(b.label) + '</span><span class="note">' + esc(b.note) + '</span></li>').join('') +
      '<li><span class="pts ' + cls(a.score) + '">' + (a.score > 0 ? '+' : '') + a.score + '</span><span class="lab"><b>Total</b></span><span class="note">BUY ≥ +' + state.s.threshold + ' · SELL ≤ −' + state.s.threshold + ' · wajib ada pola pemicu & RR ≥ ' + state.s.minRR + '</span></li></ul>';
    if (d.warnings.length) h += '<h3>Perhatian</h3><ul class="clean warns">' + d.warnings.map((w) => '<li>⚠ ' + esc(w) + '</li>').join('') + '</ul>';
    el.innerHTML = h;
  }

  function renderStructure() {
    const el = $('structure');
    const a = state.a;
    if (!a || !a.ok) { el.innerHTML = ''; el.hidden = true; return; }
    el.hidden = false;
    const st = a.structure;
    const tag = st.trend === 'up' ? 'bull' : st.trend === 'down' ? 'bear' : '';
    let h = '<h2>Struktur, level & pola</h2><table class="kv">' +
      '<tr><td>Struktur</td><td><span class="tag ' + tag + '">' + esc(st.label) + '</span></td></tr>' +
      (st.bos ? '<tr><td>Break</td><td><span class="tag ' + (st.bos.dir === 'bull' ? 'bull' : 'bear') + '">' + st.bos.kind + ' ' + (st.bos.dir === 'bull' ? 'naik' : 'turun') + ' @ ' + fmt(st.bos.level) + '</span></td></tr>' : '') +
      '<tr><td>ATR(14)</td><td>' + pipsOf(a.atr) + ' pip<span class="sub">' + fmt(a.atr) + ' harga</span></td></tr>' +
      '<tr><td>EMA 20</td><td>' + fmt(a.ema) + '<span class="sub">harga ' + (a.price > a.ema ? 'di atas' : 'di bawah') + ' EMA</span></td></tr>' +
      '<tr><td>Swing terakhir</td><td>H ' + (st.lastHigh ? fmt(st.lastHigh.price) : '—') + ' · L ' + (st.lastLow ? fmt(st.lastLow.price) : '—') + '</td></tr></table>';

    const above = a.levels.filter((l) => l.price > a.price).slice(0, 3).reverse();
    const below = a.levels.filter((l) => l.price <= a.price).slice(-3).reverse();
    const row = (l, k) => '<li><span class="tag ' + (k === 'R' ? 'bear' : 'bull') + '">' + k + '</span><span class="lab" style="min-width:70px">' + fmt(l.price) + '</span><span class="note">' + l.touches + '× sentuh (' + l.strength + ') · ' + pipsOf(l.price - a.price) + ' pip</span></li>';
    h += '<h3>Level terdekat</h3><ul class="clean">' +
      (above.map((l) => row(l, 'R')).join('') || '<li><span class="note">Tidak ada resistance di atas harga</span></li>') +
      (below.map((l) => row(l, 'S')).join('') || '<li><span class="note">Tidak ada support di bawah harga</span></li>') + '</ul>';

    const recent = [];
    for (let k = a.i; k >= Math.max(0, a.i - 2); k--) {
      PA.detectPatterns(state.candles, k, state.ind.atr[k]).forEach((p) => recent.push(Object.assign({ ago: a.i - k }, p)));
    }
    h += '<h3>Pola candle (3 terakhir)</h3>' + (recent.length
      ? '<ul class="clean">' + recent.map((p) => '<li><span class="tag ' + (p.bias === 'bull' ? 'bull' : p.bias === 'bear' ? 'bear' : '') + '">' + (p.ago ? p.ago + ' candle lalu' : 'candle ini') + '</span><span><b>' + esc(p.name) + '</b> <span class="note">· ' + esc(p.desc) + '</span></span></li>').join('') + '</ul>'
      : '<p class="note">Tidak ada pola yang terdeteksi.</p>');
    el.innerHTML = h;
  }

  /* ------------------------------ backtest ------------------------------ */
  function renderBacktest() {
    const el = $('bt');
    const bt = state.bt;
    if (!bt) { el.innerHTML = '<p class="hint">Butuh minimal ' + (minC() + 5) + ' candle.</p>'; return; }
    const s = bt.stats;
    const cl = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
    let h = '';
    if (state.source === 'demo') h += '<div class="callout">Data contoh sintetis dibuat dengan tren acak — hasil di bawah hanya demonstrasi cara kerja, <b>bukan bukti</b> aturan ini menguntungkan. Impor data broker Anda untuk evaluasi nyata.</div>';
    if (!s.trades) {
      h += '<p class="hint">Tidak ada sinyal BUY/SELL yang terpicu pada data ini (aturan sengaja selektif). Coba selektivitas "Longgar" atau data yang lebih panjang.</p>';
    } else {
      h += '<div class="stats">' +
        '<div class="stat"><span>Jumlah trade</span><b>' + s.trades + '</b></div>' +
        '<div class="stat"><span>Win rate</span><b>' + (s.winRate * 100).toFixed(0) + '%</b></div>' +
        '<div class="stat"><span>Rata-rata R</span><b class="' + cl(s.avgR) + '">' + (s.avgR > 0 ? '+' : '') + s.avgR.toFixed(2) + '</b></div>' +
        '<div class="stat"><span>Total R</span><b class="' + cl(s.totalR) + '">' + (s.totalR > 0 ? '+' : '') + s.totalR.toFixed(1) + '</b></div>' +
        '<div class="stat"><span>Profit factor</span><b>' + (isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞') + '</b></div>' +
        '<div class="stat"><span>Max drawdown</span><b class="neg">−' + s.maxDD.toFixed(1) + ' R</b></div></div>' +
        '<canvas id="eq" role="img" aria-label="Kurva ekuitas dalam satuan R"></canvas>';
      const rows = bt.trades.slice(-10).reverse().map((t) => {
        const c = state.candles[t.fillIdx];
        return '<tr><td>' + esc(shortT(c.t)) + '</td><td>' + t.side + '</td><td>' + fmt(t.entry) + '</td><td>' + fmt(t.exit) + '</td><td>' + t.outcome + '</td><td class="' + (t.R > 0 ? 'tp' : 'sl') + '">' + (t.R > 0 ? '+' : '') + t.R.toFixed(2) + ' R</td></tr>';
      }).join('');
      h += '<div class="tbl-wrap"><table class="tr"><thead><tr><th>Entri</th><th>Sisi</th><th>Harga masuk</th><th>Harga keluar</th><th>Hasil</th><th>R</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }
    h += '<p class="assume">Asumsi: analisis hanya memakai candle yang sudah close (tanpa look-ahead); order stop terpicu dalam 3 candle; keluar penuh di TP1 atau SL; bila SL dan TP tersentuh di candle yang sama dihitung kena SL; maks 30 candle; spread ' + state.s.spreadPips + ' pip ikut dihitung; tanpa swap/komisi/slippage. R = kelipatan risiko awal. ' + (bt.startAt > minC() ? 'Hanya ' + MAX_STORED + ' candle terakhir yang diuji.' : '') + '</p>';
    el.innerHTML = h;
    if (s.trades) drawEquity(s.equity);
  }

  function drawEquity(eq, id) {
    const cv = $(id || 'eq');
    if (!cv) return;
    const W = cv.clientWidth, H = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mn = Math.min(0, ...eq), mx = Math.max(0, ...eq), pad = 14;
    const x = (i) => pad + (i / Math.max(1, eq.length - 1)) * (W - pad * 2);
    const y = (v) => pad + ((mx - v) / Math.max(1e-9, mx - mn)) * (H - pad * 2);
    g.strokeStyle = css('--line'); g.lineWidth = 1; g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(pad, y(0)); g.lineTo(W - pad, y(0)); g.stroke(); g.setLineDash([]);
    const last = eq[eq.length - 1];
    g.strokeStyle = last >= 0 ? css('--bull') : css('--bear'); g.lineWidth = 2;
    g.beginPath();
    eq.forEach((v, i) => (i ? g.lineTo(x(i), y(v)) : g.moveTo(x(i), y(v))));
    g.stroke();
    g.fillStyle = css('--muted'); g.font = '11px system-ui';
    g.fillText('Ekuitas (R) · akhir ' + (last > 0 ? '+' : '') + last.toFixed(1), pad, 11);
  }

  function renderDataInfo() {
    const n = state.candles.length;
    const src = { demo: 'data contoh sintetis', csv: 'data impor', manual: 'input manual' }[state.source];
    const first = state.candles[0], last = state.candles[n - 1];
    $('dataInfo').textContent = n ? n + ' candle · ' + src + ' · ' + shortT(first.t) + ' → ' + shortT(last.t) : 'Belum ada data.';
    $('pipAuto').textContent = PA.pipValueUSD(inst(), lastPrice()).toFixed(2) + ' USD per pip per lot (' + inst().name + ')';
    $('pipValue').placeholder = 'otomatis';
  }

  /* ------------------------------ chart ------------------------------ */
  function niceStep(range, target) {
    const raw = range / target;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
  }

  function drawChart() {
    const cv = $('chart');
    const rect = cv.getBoundingClientRect();
    const W = Math.max(280, Math.floor(rect.width)), H = Math.max(200, Math.floor(rect.height));
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const C = state.candles, n = C.length;
    const col = { bull: css('--bull'), bear: css('--bear'), ink: css('--ink'), muted: css('--muted'), grid: css('--grid'), line: css('--line'), accent: css('--accent'), wait: css('--wait'), card: css('--card') };
    if (!n) {
      g.fillStyle = col.muted; g.font = '14px system-ui'; g.textAlign = 'center';
      g.fillText('Belum ada data', W / 2, H / 2); g.textAlign = 'left';
      return;
    }
    const a = state.a && state.a.ok ? state.a : null;
    const V = Math.min(state.view, n);
    const end = state.cut === n - 1 ? n : Math.min(n, state.cut + 1 + Math.round(V * 0.25));
    const start = Math.max(0, end - V);
    const extra = Math.max(3, Math.round(V * 0.07));
    const padL = 6, padR = 88, padT = 22, padB = 22;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const step = plotW / (end - start + extra);
    const xOf = (k) => padL + (k - start + 0.5) * step;
    const plan = a && a.decision.action !== 'WAIT' ? a.plan : null;

    let hi = -Infinity, lo = Infinity;
    for (let k = start; k < end; k++) { hi = Math.max(hi, C[k].h); lo = Math.min(lo, C[k].l); }
    if (plan) { [plan.entry, plan.sl, plan.tp1].forEach((v) => { hi = Math.max(hi, v); lo = Math.min(lo, v); }); }
    const padPx = (hi - lo) * 0.06 || 1;
    hi += padPx; lo -= padPx;
    const yOf = (p) => padT + ((hi - p) / (hi - lo)) * plotH;
    state.geo = { start, end, step, padL, padR, W, H, padT, padB };

    // grid + sumbu harga
    const ts = niceStep(hi - lo, 6);
    g.font = '11px system-ui'; g.textBaseline = 'middle';
    for (let v = Math.ceil(lo / ts) * ts; v <= hi; v += ts) {
      const y = yOf(v);
      g.strokeStyle = col.grid; g.lineWidth = 1;
      g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
      g.fillStyle = col.muted; g.fillText(v.toFixed(dp()), W - padR + 6, y);
    }
    // sumbu waktu
    g.textBaseline = 'alphabetic'; g.fillStyle = col.muted;
    const every = Math.max(1, Math.round(90 / step));
    for (let k = start; k < end; k += every) g.fillText(shortT(C[k].t), Math.max(padL, xOf(k) - 18), H - 6);

    // zona rencana
    if (plan) {
      const x0 = xOf(state.cut);
      g.globalAlpha = 0.1;
      g.fillStyle = col.bear; g.fillRect(x0, Math.min(yOf(plan.entry), yOf(plan.sl)), W - padR - x0, Math.abs(yOf(plan.entry) - yOf(plan.sl)));
      g.fillStyle = col.bull; g.fillRect(x0, Math.min(yOf(plan.entry), yOf(plan.tp1)), W - padR - x0, Math.abs(yOf(plan.entry) - yOf(plan.tp1)));
      g.globalAlpha = 1;
    }

    // S/R
    if (state.tg.sr && a) {
      g.font = '10.5px system-ui';
      a.levels.forEach((l) => {
        if (l.price < lo || l.price > hi) return;
        const y = yOf(l.price);
        const c = l.kind === 'support' ? col.bull : col.bear;
        g.strokeStyle = c; g.globalAlpha = l.touches >= 3 ? 0.75 : l.touches === 2 ? 0.5 : 0.3;
        g.lineWidth = l.touches >= 3 ? 1.6 : 1; g.setLineDash([6, 4]);
        g.beginPath(); g.moveTo(padL, y); g.lineTo(W - padR, y); g.stroke();
        g.setLineDash([]); g.globalAlpha = 1;
        g.fillStyle = c; g.textBaseline = 'bottom';
        g.fillText((l.kind === 'support' ? 'S ' : 'R ') + l.price.toFixed(dp()) + ' ×' + l.touches, padL + 4, y - 2);
      });
      g.textBaseline = 'alphabetic';
    }

    // EMA
    if (state.tg.ema && state.ind) {
      g.strokeStyle = col.accent; g.globalAlpha = 0.8; g.lineWidth = 1.4; g.beginPath();
      for (let k = start; k < end; k++) { const x = xOf(k), y = yOf(state.ind.ema[k]); k === start ? g.moveTo(x, y) : g.lineTo(x, y); }
      g.stroke(); g.globalAlpha = 1;
    }

    // candle
    const bw = Math.max(1, Math.min(step * 0.7, 14));
    for (let k = start; k < end; k++) {
      const c = C[k], x = xOf(k), up = c.c >= c.o;
      g.globalAlpha = k > state.cut ? 0.32 : 1;
      g.strokeStyle = g.fillStyle = up ? col.bull : col.bear;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, yOf(c.h)); g.lineTo(x, yOf(c.l)); g.stroke();
      const y1 = yOf(Math.max(c.o, c.c)), y2 = yOf(Math.min(c.o, c.c));
      g.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
    }
    g.globalAlpha = 1;

    // sorot candle analisis
    const xc = xOf(state.cut);
    if (state.cut >= start && state.cut < end) {
      g.globalAlpha = 0.09; g.fillStyle = col.accent; g.fillRect(xc - step / 2, padT, step, plotH); g.globalAlpha = 1;
    }

    // swing
    if (state.tg.swing && a) {
      a.swings.forEach((s) => {
        if (s.i < start || s.i >= end) return;
        const x = xOf(s.i), y = yOf(s.price);
        g.fillStyle = col.muted; g.beginPath();
        if (s.type === 'H') { g.moveTo(x, y - 4); g.lineTo(x - 3.5, y - 10); g.lineTo(x + 3.5, y - 10); }
        else { g.moveTo(x, y + 4); g.lineTo(x - 3.5, y + 10); g.lineTo(x + 3.5, y + 10); }
        g.fill();
      });
    }

    // label pola: hanya yang bermakna (kualitas 3, atau terbentuk di dekat level S/R)
    if (state.tg.pat && state.ind && a) {
      const abbr = { pinbar: 'PB', engulfing: 'EN', ibbreak: 'IB', star: 'ST' };
      g.font = 'bold 9.5px system-ui'; g.textAlign = 'center';
      for (let k = Math.max(start, 1); k < Math.min(end, state.cut + 1); k++) {
        const atrK = state.ind.atr[k];
        const ps = PA.detectPatterns(C, k, atrK).filter((p) => {
          if (!abbr[p.key] || p.bias === 'neutral') return false;
          if (p.quality >= 3) return true;
          const ref = p.bias === 'bull' ? C[k].l : C[k].h;
          return a.levels.some((l) => Math.abs(ref - l.price) <= 0.75 * atrK);
        });
        if (!ps.length) continue;
        const p = ps.sort((x, y) => y.quality - x.quality)[0], x = xOf(k);
        if (p.bias === 'bear') { g.fillStyle = col.bear; g.fillText(abbr[p.key], x, yOf(C[k].h) - 6); }
        else { g.fillStyle = col.bull; g.fillText(abbr[p.key], x, yOf(C[k].l) + 14); }
      }
      g.textAlign = 'left';
    }

    // sinyal historis
    if (state.tg.sig && state.bt) {
      state.bt.signals.forEach((s) => {
        if (s.i < start || s.i >= end || s.i > state.cut) return;
        const x = xOf(s.i), c = C[s.i];
        g.fillStyle = s.side === 'BUY' ? col.bull : col.bear; g.strokeStyle = col.card; g.lineWidth = 1.5;
        g.beginPath();
        if (s.side === 'BUY') { const y = yOf(c.l) + 18; g.moveTo(x, y - 9); g.lineTo(x - 6, y + 3); g.lineTo(x + 6, y + 3); }
        else { const y = yOf(c.h) - 18; g.moveTo(x, y + 9); g.lineTo(x - 6, y - 3); g.lineTo(x + 6, y - 3); }
        g.closePath(); g.stroke(); g.fill();
      });
    }

    // garis rencana
    if (plan) {
      const tags = [['ENTRY', plan.entry, col.accent], ['SL', plan.sl, col.bear], ['TP1', plan.tp1, col.bull], ['TP2', plan.tp2, col.bull]];
      tags.forEach(([name, price, c]) => {
        if (price < lo || price > hi) return;
        const y = yOf(price);
        g.strokeStyle = c; g.lineWidth = 1.4; g.setLineDash(name === 'ENTRY' ? [] : [5, 3]);
        g.beginPath(); g.moveTo(xc, y); g.lineTo(W - padR, y); g.stroke(); g.setLineDash([]);
        g.fillStyle = c; g.fillRect(W - padR + 1, y - 8, padR - 3, 16);
        g.fillStyle = col.card; g.font = 'bold 10.5px system-ui'; g.textBaseline = 'middle';
        g.fillText(name + ' ' + price.toFixed(dp()), W - padR + 4, y); g.textBaseline = 'alphabetic';
      });
    }

    // crosshair + tooltip
    let info = null;
    let hk = -1;
    if (state.hover >= start && state.hover < end) {
      const k = state.hover, c = C[k], x = xOf(k);
      g.strokeStyle = col.muted; g.globalAlpha = 0.5; g.setLineDash([3, 3]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, padT); g.lineTo(x, padT + plotH); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      info = c;
      hk = k;
    }
    const c0 = info || (state.cut < n ? C[state.cut] : null);
    if (c0) {
      const narrow = W < 520;
      g.font = (narrow ? '10px' : '11.5px') + ' ui-monospace, Menlo, monospace'; g.fillStyle = col.ink;
      const chg = (c0.c - c0.o) / pipSize();
      const d = dp();
      const txt = narrow
        ? shortT(c0.t) + ' O' + c0.o.toFixed(d) + ' H' + c0.h.toFixed(d) + ' L' + c0.l.toFixed(d) + ' C' + c0.c.toFixed(d)
        : (info ? '#' + (hk + 1) + ' ' : '') + shortT(c0.t) + '  O ' + c0.o.toFixed(d) + '  H ' + c0.h.toFixed(d) + '  L ' + c0.l.toFixed(d) + '  C ' + c0.c.toFixed(d) + '  (' + (chg >= 0 ? '+' : '') + chg.toFixed(1) + ' pip)';
      g.fillText(txt, padL + 2, 13);
    }
  }

  function candleAt(ev) {
    const geo = state.geo;
    if (!geo) return -1;
    const r = $('chart').getBoundingClientRect();
    const x = ev.clientX - r.left;
    const k = geo.start + Math.floor((x - geo.padL) / geo.step);
    return k >= geo.start && k < geo.end ? k : -1;
  }

  /* ------------------------------ UI wiring ------------------------------ */
  function fillInst() {
    $('inst').innerHTML = Object.keys(PA.INSTRUMENTS).map((k) => '<option value="' + k + '">' + esc(PA.INSTRUMENTS[k].name) + '</option>').join('');
    $('inst').value = state.inst;
  }
  function syncInputs() {
    const s = state.s;
    $('balance').value = s.balance; $('riskPct').value = s.riskPct; $('spread').value = s.spreadPips;
    $('pipValue').value = s.pipValue == null ? '' : s.pipValue; $('minRR').value = s.minRR;
    $('threshold').value = String(s.threshold); $('swingK').value = String(s.swingK); $('pipSize').value = s.pipSize;
    $('customWrap').hidden = state.inst !== 'CUSTOM';
    document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('on', Number(b.dataset.view) === state.view));
    $('tgSR').checked = state.tg.sr; $('tgEma').checked = state.tg.ema; $('tgSwing').checked = state.tg.swing; $('tgPat').checked = state.tg.pat; $('tgSig').checked = state.tg.sig;
  }

  function readSettings() {
    const num = (id, d) => { const v = parseFloat($(id).value); return isFinite(v) && v >= 0 ? v : d; };
    const s = state.s;
    s.balance = Math.max(1, num('balance', s.balance));
    s.riskPct = Math.min(10, Math.max(0.05, num('riskPct', s.riskPct)));
    s.spreadPips = num('spread', s.spreadPips);
    const pv = parseFloat($('pipValue').value);
    s.pipValue = isFinite(pv) && pv > 0 ? pv : null;
    s.minRR = Math.min(5, Math.max(1, num('minRR', s.minRR)));
    s.threshold = Number($('threshold').value);
    s.swingK = Number($('swingK').value);
    const ps = parseFloat($('pipSize').value);
    if (isFinite(ps) && ps > 0) s.pipSize = ps;
  }

  let debounce;
  function onSettings() {
    clearTimeout(debounce);
    debounce = setTimeout(() => { readSettings(); save(); recomputeAll(); }, 250);
  }

  function showMsg(id, text, kind) {
    const el = $(id);
    el.textContent = text;
    el.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function wire() {
    $('inst').onchange = () => {
      state.inst = $('inst').value;
      state.s.pipValue = null;
      state.s.spreadPips = DEF_SPREAD[state.inst] != null ? DEF_SPREAD[state.inst] : 1;
      state.s.pipSize = PA.INSTRUMENTS[state.inst].pipSize;
      syncInputs();
      if (state.source === 'demo') genDemo(); else { recomputeAll(); save(); }
    };

    ['balance', 'riskPct', 'spread', 'pipValue', 'minRR', 'pipSize'].forEach((id) => $(id).addEventListener('input', onSettings));
    ['threshold', 'swingK'].forEach((id) => $(id).addEventListener('change', onSettings));

    document.querySelectorAll('#viewSeg button').forEach((b) => {
      b.onclick = () => { state.view = Number(b.dataset.view); syncInputs(); save(); drawChart(); };
    });
    [['tgSR', 'sr'], ['tgEma', 'ema'], ['tgSwing', 'swing'], ['tgPat', 'pat'], ['tgSig', 'sig']].forEach(([id, k]) => {
      $(id).onchange = () => { state.tg[k] = $(id).checked; save(); drawChart(); };
    });

    $('cut').oninput = () => setCut(Number($('cut').value));
    $('cutPrev').onclick = () => setCut(Math.max(minC() - 1, state.cut - 1));
    $('cutNext').onclick = () => setCut(state.cut + 1);
    $('sigPrev').onclick = () => jumpSignal(-1);
    $('sigNext').onclick = () => jumpSignal(1);

    const cv = $('chart');
    let raf = 0;
    cv.addEventListener('pointermove', (ev) => {
      const k = candleAt(ev);
      if (k === state.hover) return;
      state.hover = k;
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; drawChart(); });
    });
    cv.addEventListener('pointerleave', () => { state.hover = -1; drawChart(); });
    cv.addEventListener('click', (ev) => {
      const k = candleAt(ev);
      if (k >= minC() - 1) setCut(k);
    });
    window.addEventListener('resize', () => { drawChart(); if (state.bt && state.bt.stats.trades) drawEquity(state.bt.stats.equity); if (mtf.sum && mtf.sum.overall.n) drawEquity(mtf.sum.overall.equity, 'eqM'); });
    document.addEventListener('keydown', (ev) => {
      if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.type !== 'range') return;
      if (ev.key === 'ArrowLeft') { ev.preventDefault(); $('cutPrev').click(); }
      if (ev.key === 'ArrowRight') { ev.preventDefault(); $('cutNext').click(); }
    });

    // tab
    document.querySelectorAll('#tabs button').forEach((b) => {
      b.onclick = () => {
        document.querySelectorAll('#tabs button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', x === b); });
        ['demo', 'import', 'manual'].forEach((t) => { $('tab-' + t).hidden = t !== b.dataset.tab; });
      };
    });
    document.querySelectorAll('[data-demo]').forEach((b) => {
      b.onclick = () => { state.demoKind = b.dataset.demo; genDemo(); };
    });
    $('demoReroll').onclick = () => { state.demoSeed = (state.demoSeed % 9999) + 1; genDemo(); };

    // CSV
    const runCsv = () => {
      try {
        const r = PA.parseCSV($('csv').value);
        if (r.candles.length < minC()) throw new Error('Hanya ' + r.candles.length + ' candle terbaca; butuh minimal ' + minC() + '.');
        setCandles(r.candles, 'csv');
        showMsg('csvMsg', r.candles.length + ' candle dimuat.' + (r.warnings.length ? ' ' + r.warnings.join(' ') : ''), 'ok');
      } catch (e) { showMsg('csvMsg', e.message, 'err'); }
    };
    $('csvGo').onclick = runCsv;
    $('csvFile').onchange = (ev) => {
      const f = ev.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => { $('csv').value = String(rd.result); runCsv(); };
      rd.onerror = () => showMsg('csvMsg', 'Gagal membaca file.', 'err');
      rd.readAsText(f);
    };

    // multi-timeframe
    $('mtfF30').onchange = () => onMtfFile('m30', $('mtfF30'));
    $('mtfF4h').onchange = () => onMtfFile('h4', $('mtfF4h'));
    $('mtfF1d').onchange = () => onMtfFile('d1', $('mtfF1d'));
    $('mtfRun').onclick = () => runMtf('file');
    $('mtfDemo').onclick = () => runMtf('demo');
    $('mtfCancel').onclick = () => { mtf.cancel = true; };

    // manual
    $('mAdd').onclick = () => {
      const o = parseFloat($('mO').value), h = parseFloat($('mH').value), l = parseFloat($('mL').value), c = parseFloat($('mC').value);
      if (![o, h, l, c].every(isFinite)) return showMsg('mMsg', 'Isi Open, High, Low, dan Close dengan angka.', 'err');
      if (h < Math.max(o, c) || l > Math.min(o, c) || h < l) return showMsg('mMsg', 'Tidak konsisten: High harus ≥ Open/Close dan Low ≤ Open/Close.', 'err');
      const base = state.source === 'demo' ? [] : state.candles.slice();
      if (state.source === 'demo' && state.candles.length) {
        if (!confirm('Data contoh akan diganti dengan data input manual Anda (mulai dari candle ini). Lanjutkan?')) return;
      }
      base.push({ t: $('mT').value.trim() || String(base.length + 1), o, h, l, c });
      const wasLast = state.cut >= state.candles.length - 1 || state.source === 'demo';
      state.candles = base; state.source = 'manual';
      state.cut = wasLast ? base.length - 1 : state.cut;
      recomputeAll(); save();
      ['mO', 'mH', 'mL', 'mC', 'mT'].forEach((id) => { $(id).value = ''; });
      showMsg('mMsg', 'Candle ditambahkan (' + base.length + ' total).' + (base.length < minC() ? ' Butuh ' + (minC() - base.length) + ' lagi untuk analisis — atau tempel riwayat lewat Impor CSV.' : ''), 'ok');
    };
    $('mUndo').onclick = () => {
      if (state.source === 'demo' || !state.candles.length) return showMsg('mMsg', 'Tidak ada candle manual untuk dihapus.', 'err');
      state.candles = state.candles.slice(0, -1);
      state.cut = state.candles.length - 1;
      recomputeAll(); save();
      showMsg('mMsg', 'Candle terakhir dihapus.', 'ok');
    };
  }

  /* ------------------------------ multi-timeframe ------------------------------ */
  const longT = (t) => String(t).slice(0, 16);
  const mtf = { raw: { m30: null, h4: null, d1: null }, ctx: null, bt: null, sum: null, live: null, source: null, running: false, cancel: false };

  function mtfMsg(text, kind) {
    const el = $('mtfMsg');
    el.textContent = text;
    el.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const rd = new FileReader();
      rd.onload = () => resolve(String(rd.result));
      rd.onerror = () => reject(new Error('Gagal membaca file ' + file.name));
      rd.readAsText(file);
    });
  }

  async function onMtfFile(key, input) {
    const f = input.files[0];
    mtf.raw[key] = null;
    $('mtfRun').disabled = !mtf.raw.m30;
    if (!f) { if (key === 'm30') $('mtfRun').disabled = true; return; }
    try {
      mtfMsg('Membaca ' + f.name + '…');
      await new Promise((r) => setTimeout(r, 20));
      const r = PA.parseCSV(await readFileText(f));
      mtf.raw[key] = r.candles;
      const label = { m30: '30m', h4: '4H', d1: '1D' }[key];
      mtfMsg(label + ': ' + r.candles.length.toLocaleString('id-ID') + ' candle · ' + longT(r.candles[0].t) + ' → ' + longT(r.candles[r.candles.length - 1].t) + (r.warnings.length ? ' · ' + r.warnings.join(' ') : ''), 'ok');
    } catch (e) {
      input.value = '';
      mtfMsg(e.message, 'err');
    }
    $('mtfRun').disabled = !mtf.raw.m30 || mtf.running;
  }

  const pct = (x, d) => (x * 100).toFixed(d == null ? 1 : d) + '%';
  const sgn = (x, d) => (x > 0 ? '+' : '') + x.toFixed(d == null ? 2 : d);

  async function runMtf(source) {
    if (mtf.running) return;
    mtf.running = true; mtf.cancel = false;
    $('mtfRun').disabled = true; $('mtfCancel').hidden = false; $('mtfProg').hidden = false; $('mtfProg').value = 0;
    $('mtfOut').innerHTML = '';
    try {
      let src;
      if (source === 'demo') {
        mtfMsg('Membuat data sintetis…');
        await new Promise((r) => setTimeout(r, 20));
        src = { m30: PA.generateDemo('mixed', state.inst, 40000, state.demoSeed, { stepMin: 30 }) };
      } else {
        src = { m30: mtf.raw.m30, h4: mtf.raw.h4, d1: mtf.raw.d1 };
      }
      const spreadPrice = state.s.spreadPips * pipSize();
      const opts = {
        spread: spreadPrice, minRR: state.s.minRR, mtfThreshold: Number($('mtfTh').value),
        dp: PA.inferPrecision(src.m30), anchorMs: (Number($('mtfAnchor').value) || 0) * 3600000,
      };
      mtfMsg('Menyiapkan 3 timeframe…');
      await new Promise((r) => setTimeout(r, 20));
      const ctx = PA.prepareMTF({ m30: src.m30.map((c) => Object.assign({}, c)), h4: src.h4, d1: src.d1 }, opts);

      // Validasi sinkronisasi bila 4H/1D diunggah sendiri: bila tidak sinkron, hasil bisa memuat look-ahead
      for (const [k, arr, ms, lab] of [['h4', ctx.H, 4 * 3600000, '4H'], ['d1', ctx.D, 24 * 3600000, '1D']]) {
        if (!src[k]) continue;
        const al = PA.checkAlignment(ctx.M, arr, ms);
        if (al < 0.8) throw new Error('File ' + lab + ' tidak sinkron dengan file 30m (hanya ' + pct(al, 0) + ' candle yang cocok) — kemungkinan beda zona waktu atau beda broker. Hasil akan tidak valid. Kosongkan file ' + lab + ' agar diturunkan otomatis dari 30m.');
      }

      const fromTs = $('mtfFrom').value ? PA.toEpoch($('mtfFrom').value) : null;
      mtfMsg('Menjalankan backtest…');
      const bt = await PA.backtestMTF(ctx, { fromTs, onProgress: (p) => { $('mtfProg').value = p; }, cancel: () => mtf.cancel });
      if (bt.cancelled) { mtfMsg('Dibatalkan.'); return; }
      mtf.ctx = ctx; mtf.bt = bt; mtf.source = source;
      mtf.sum = PA.summarizeMTF(bt.trades, { minScore: opts.mtfThreshold });
      mtf.live = PA.analyzeMTFAt(ctx, ctx.M.length - 1, false);
      mtfMsg('Selesai: ' + ctx.M.length.toLocaleString('id-ID') + ' candle 30m, ' + bt.trades.length + ' trade.', 'ok');
      renderMtf();
    } catch (e) {
      mtfMsg(e.message, 'err');
    } finally {
      mtf.running = false;
      $('mtfRun').disabled = !mtf.raw.m30; $('mtfCancel').hidden = true; $('mtfProg').hidden = true;
    }
  }

  function levelNear(levels, price, dir) {
    const f = levels.filter((l) => (dir > 0 ? l.price <= price : l.price > price));
    return dir > 0 ? f.sort((a, b) => b.price - a.price)[0] : f.sort((a, b) => a.price - b.price)[0];
  }

  function renderMtf() {
    const el = $('mtfOut');
    const { ctx, sum, live } = mtf;
    if (!ctx || !sum) { el.innerHTML = ''; return; }
    const dpM = PA.inferPrecision(ctx.M);
    const fm = (x) => (x == null || !isFinite(x) ? '—' : x.toFixed(dpM));
    let h = '';
    if (mtf.source === 'demo') h += '<div class="callout">Data sintetis acak — angka di bawah hanya untuk mencoba tampilan, <b>bukan</b> probabilitas pasar nyata. Unggah file 30m dari broker Anda.</div>';

    /* ---- keputusan top-down hidup ---- */
    if (live && live.ok) {
      const d = live.decision;
      const icon = { BUY: '▲', SELL: '▼', WAIT: '⏸' }[d.action];
      const col = (title, layer) => {
        const st = layer.structure;
        const tag = st.trend === 'up' ? 'bull' : st.trend === 'down' ? 'bear' : '';
        const sup = levelNear(layer.levels, live.price, 1), res = levelNear(layer.levels, live.price, -1);
        return '<div class="mtf-col"><h4>' + title + '<span class="tag ' + tag + '">' + esc(st.label) + '</span></h4>' +
          '<span class="note">candle close terakhir: ' + esc(longT(layer.time)) + '</span>' +
          '<span class="note">EMA 20 ' + fm(layer.ema) + ' · harga ' + (live.price > layer.ema ? 'di atas' : 'di bawah') + '</span>' +
          '<span class="note">R: ' + (res ? fm(res.price) + ' (' + res.touches + '×)' : '—') + ' · S: ' + (sup ? fm(sup.price) + ' (' + sup.touches + '×)' : '—') + '</span></div>';
      };
      const pats = live.layers.m30.patterns.filter((p) => p.bias !== 'neutral' || p.key === 'insidebar');
      h += '<h3>Keputusan sekarang · ' + esc(longT(live.time)) + ' · harga ' + fm(live.price) + '</h3>' +
        '<div class="mtf-cols">' + col('1D (bias)', live.layers.d1) + col('4H (setup)', live.layers.h4) +
        '<div class="mtf-col"><h4>30m (pemicu)</h4><span class="note">' + (pats.length ? pats.map((p) => esc(p.name)).join(', ') : 'Tidak ada pola pada candle terakhir') + '</span><span class="note">ATR(30m) ' + pipsOf(live.atr) + ' pip</span></div></div>';
      h += '<div class="mtf-live"><div><div class="badge-row"><span class="badge ' + d.action + '"><span aria-hidden="true">' + icon + '</span> ' + d.action + '</span>' +
        '<div class="badge-meta">Skor <b>' + sgn(live.score, 0) + '</b>' + (d.action !== 'WAIT' ? ' · keyakinan <b>' + d.confidence + '</b>' : '') + '</div></div>' +
        '<p class="summary">' + esc(d.summary) + '</p>';
      if (d.action !== 'WAIT') {
        const pr = PA.probabilityForScore(sum, live.score);
        const o = sum.overall;
        h += '<div class="prob"><b>Peluang menang historis</b> untuk skor ' + Math.abs(live.score) + ': ' +
          (pr ? '<b>' + pct(pr.winRate, 0) + '</b> (CI 95% ' + pct(pr.lo, 0) + '–' + pct(pr.hi, 0) + ', n=' + pr.n + (pr.reliable ? '' : ' — sampel kecil') + ')' : 'belum ada data pada skor ini') +
          '<br>Keseluruhan: <b>' + pct(o.winRate, 0) + '</b> dari ' + o.n + ' trade · titik impas <b>' + (o.breakEven != null ? pct(o.breakEven, 0) : '—') + '</b> · ekspektasi <b>' + sgn(o.avgR) + ' R</b>/trade.</div>';
      } else if (d.watch.length) {
        h += '<ul class="clean">' + d.watch.map((w) => '<li><span class="note">•</span><span>' + esc(w) + '</span></li>').join('') + '</ul>';
      }
      h += '</div><div>';
      if (live.plan) {
        const p = live.plan;
        const pv = state.s.pipValue != null ? state.s.pipValue : PA.pipValueUSD(inst(), live.price);
        const sz = PA.positionSize({ balance: state.s.balance, riskPct: state.s.riskPct, entry: p.entry, sl: p.sl, spread: p.spread, pipSize: pipSize(), pipValue: pv, tp1: p.tp1, tp2: p.tp2 });
        h += '<table class="kv"><tr><td>Entry (' + (p.side === 'BUY' ? 'Buy' : 'Sell') + ' Stop)</td><td class="en"><b>' + fm(p.entry) + '</b></td></tr>' +
          '<tr><td>Stop loss</td><td class="sl"><b>' + fm(p.sl) + '</b><span class="sub">' + pipsOf(p.entry - p.sl) + ' pip</span></td></tr>' +
          '<tr><td>TP1</td><td class="tp"><b>' + fm(p.tp1) + '</b><span class="sub">' + pipsOf(p.tp1 - p.entry) + ' pip · RR ' + p.rr1.toFixed(2) + '</span></td></tr>' +
          '<tr><td>TP2</td><td class="tp"><b>' + fm(p.tp2) + '</b><span class="sub">' + pipsOf(p.tp2 - p.entry) + ' pip · RR ' + p.rr2.toFixed(2) + '</span></td></tr>' +
          (sz ? '<tr><td>Ukuran posisi</td><td><b>' + sz.lots.toFixed(2) + ' lot</b><span class="sub">risiko ' + money(sz.realRisk) + ' (' + state.s.riskPct + '%)</span></td></tr>' : '') + '</table>';
        if (d.warnings.length) h += '<ul class="clean warns">' + d.warnings.map((w) => '<li>⚠ ' + esc(w) + '</li>').join('') + '</ul>';
      }
      h += '<ul class="clean" style="margin-top:8px">' + live.breakdown.map((b) => '<li><span class="pts ' + (b.pts > 0 ? 'pos' : b.pts < 0 ? 'neg' : '') + '">' + sgn(b.pts, 0) + '</span><span class="lab">' + esc(b.label) + '</span><span class="note">' + esc(b.note) + '</span></li>').join('') + '</ul></div></div>';
    } else if (live) {
      h += '<p class="hint">' + esc(live.error) + '</p>';
    }

    /* ---- statistik ---- */
    const o = sum.overall;
    h += '<h3>Probabilitas & win rate historis (' + esc(longT(ctx.M[mtf.bt.startAt].t)) + ' → ' + esc(longT(ctx.M[ctx.M.length - 1].t)) + ')</h3>';
    if (!o.n) {
      h += '<p class="hint">Tidak ada trade yang terpicu pada rentang ini. Coba selektivitas "Longgar" atau perpanjang rentang data.</p>';
    } else {
      const cl = (v) => (v > 0 ? 'pos' : v < 0 ? 'neg' : '');
      h += '<div class="stats">' +
        '<div class="stat"><span>Jumlah trade</span><b>' + o.n + '</b></div>' +
        '<div class="stat"><span>Win rate</span><b>' + pct(o.winRate) + '</b><span>CI 95% ' + pct(o.ciLo, 0) + '–' + pct(o.ciHi, 0) + '</span></div>' +
        '<div class="stat"><span>Win rate impas</span><b>' + (o.breakEven != null ? pct(o.breakEven) : '—') + '</b><span>menang ' + o.avgWin.toFixed(2) + 'R / kalah ' + o.avgLoss.toFixed(2) + 'R</span></div>' +
        '<div class="stat"><span>Ekspektasi / trade</span><b class="' + cl(o.avgR) + '">' + sgn(o.avgR) + ' R</b></div>' +
        '<div class="stat"><span>Total R</span><b class="' + cl(o.totalR) + '">' + sgn(o.totalR, 1) + '</b></div>' +
        '<div class="stat"><span>Profit factor</span><b>' + (isFinite(o.profitFactor) ? o.profitFactor.toFixed(2) : '∞') + '</b></div>' +
        '<div class="stat"><span>Max drawdown</span><b class="neg">−' + o.maxDD.toFixed(1) + ' R</b></div></div>' +
        '<div class="verdict">' + esc(sum.verdict) + '</div>' +
        '<canvas id="eqM" role="img" aria-label="Kurva ekuitas multi-timeframe dalam satuan R"></canvas>';

      const tbl = (title, rows, first) => '<div class="tbl-title">' + title + '</div><div class="tbl-wrap"><table class="tr"><thead><tr><th>' + first + '</th><th>Trade</th><th>Win rate</th><th>CI 95%</th><th>Rata-rata R</th><th>Total R</th><th>PF</th></tr></thead><tbody>' +
        rows.map((r) => '<tr><td>' + esc(r.label) + '</td>' + (r.g.n
          ? '<td>' + r.g.n + '</td><td>' + pct(r.g.winRate, 0) + '</td><td>' + pct(r.g.ciLo, 0) + '–' + pct(r.g.ciHi, 0) + '</td><td class="' + (r.g.avgR > 0 ? 'tp' : 'sl') + '">' + sgn(r.g.avgR) + '</td><td>' + sgn(r.g.totalR, 1) + '</td><td>' + (isFinite(r.g.profitFactor) ? r.g.profitFactor.toFixed(2) : '∞') + '</td>'
          : '<td colspan="6">—</td>') + '</tr>').join('') + '</tbody></table></div>';
      h += tbl('Per skor konfluensi — peluang menang historis', sum.byScore.map((g) => ({ label: 'Skor ' + g.key + (g.key >= sum.scoreCap ? '+' : ''), g })), 'Skor');
      h += tbl('Per tahun (stabilitas)', sum.byYear.map((g) => ({ label: String(g.key), g })), 'Tahun');
      h += tbl('Per arah', sum.bySide.map((g) => ({ label: g.key, g })), 'Arah');
      if (sum.split) h += tbl('Uji di luar sampel (pemisah ' + esc(PA.fmtEpoch(sum.split.splitTs)) + ')', [{ label: 'In-sample (awal)', g: sum.split.inSample }, { label: 'Out-of-sample (akhir)', g: sum.split.outSample }], 'Periode');
    }
    h += '<p class="assume">Aturan: analisis top-down hanya memakai candle 4H/1D yang <b>sudah close</b> saat candle 30m ditutup (tanpa look-ahead; diuji otomatis). Entri Buy/Sell Stop di atas/bawah pola 30m (terpicu dalam 3 candle), SL di sisi lain pola, TP1 di level 4H/1D terdekat dengan RR ≥ ' + state.s.minRR + ', keluar penuh di TP1/SL (SL didahulukan bila satu candle menyentuh keduanya), maks 96 candle (2 hari). Spread ' + state.s.spreadPips + ' pip dihitung; swap, komisi, dan slippage tidak. R = kelipatan risiko awal. <b>Probabilitas adalah frekuensi historis pada data ini, bukan jaminan masa depan</b>; parameter yang dioptimalkan pada data yang sama akan menggelembungkan hasil — nilai konsistensinya di tabel per tahun dan out-of-sample. Data MTF tidak disimpan di browser (terlalu besar); unggah ulang saat dibuka kembali.</p>';
    el.innerHTML = h;
    if (o.n) drawEquity(o.equity, 'eqM');
  }

  /* ------------------------------ uji maju ------------------------------ */
  function renderForward() {
    const el = $('fwdOut');
    if (!el) return;
    if (!window.fetch || location.protocol === 'file:') {
      el.innerHTML = '<p class="hint">Catatan uji maju tampil saat aplikasi dibuka lewat GitHub Pages. Bisa juga dilihat di <code>forward/README.md</code> pada repositori.</p>';
      return;
    }
    fetch('forward/xauusd-pinbar-h4.json', { cache: 'no-store' })
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((d) => {
        const p = (x) => (x == null ? '—' : (x * 100).toFixed(1) + '%');
        const r = (x) => (x == null ? '—' : (x >= 0 ? '+' : '') + x.toFixed(3));
        const row = (lab, s) => '<tr><td>' + lab + '</td><td>' + (s.n || 0) + '</td><td>' + (s.n ? p(s.winRate) + ' (' + p(s.winLo) + '–' + p(s.winHi) + ')' : '—') + '</td><td>' + (s.n ? r(s.avgR) : '—') + '</td><td>' + (s.n ? r(s.totalR) : '—') + '</td><td>' + (s.n ? p(s.breakEven) : '—') + '</td></tr>';
        let h = '<div class="verdict">' + esc(d.verdict) + '</div>' +
          '<p class="hint">Diperbarui ' + esc(d.updated) + ' · candle H4 terakhir ' + esc(d.lastBar) + ' · uji maju sejak ' + esc(d.forward_from.replace('T', ' ').replace(':00Z', ' UTC')) + '</p>' +
          '<div class="tbl-wrap"><table class="tr"><thead><tr><th></th><th>Trade</th><th>Win rate (CI 95%)</th><th>Rata-rata R</th><th>Total R</th><th>Win rate impas</th></tr></thead><tbody>' +
          row('<b>Uji maju</b>', d.forwardSummary) + row('Referensi latih 2020–2023', d.reference.train) + row('Referensi uji 2024–Nov 2026', d.reference.test) + '</tbody></table></div>';
        if (d.pending) h += '<p class="prob">Sinyal menunggu entri: <b>' + d.pending.side + '</b> · sinyal ' + esc(d.pending.signalTime) + ' · SL ' + d.pending.sl.toFixed(2) + '</p>';
        d.open.forEach((t) => { h += '<p class="prob">Posisi terbuka: <b>' + t.side + '</b> @ ' + t.entry.toFixed(2) + ' · SL ' + t.sl.toFixed(2) + ' · TP ' + t.tp.toFixed(2) + ' · sementara ' + r(t.unrealizedR) + ' R</p>'; });
        const last = d.forward.slice(-10).reverse();
        if (last.length) {
          h += '<div class="tbl-wrap"><table class="tr"><thead><tr><th>Sinyal</th><th>Arah</th><th>Entri</th><th>Status</th><th>Hasil</th><th>R</th></tr></thead><tbody>' +
            last.map((t) => '<tr><td>' + esc(t.signalTime) + '</td><td>' + t.side + '</td><td>' + t.entry.toFixed(2) + '</td><td>' + t.status + '</td><td>' + (t.outcome || '—') + '</td><td class="' + ((t.R != null ? t.R : t.unrealizedR) > 0 ? 'tp' : 'sl') + '">' + (t.R != null ? r(t.R) : '(' + r(t.unrealizedR) + ')') + '</td></tr>').join('') + '</tbody></table></div>';
        }
        el.innerHTML = h;
      })
      .catch(() => {
        el.innerHTML = '<p class="hint">Catatan uji maju belum tersedia di sini. Buka aplikasi lewat GitHub Pages, atau lihat <code>forward/README.md</code> di repositori.</p>';
      });
  }

  /* ------------------------------ init ------------------------------ */
  function init() {
    fillInst();
    load();
    $('inst').value = state.inst;
    syncInputs();
    wire();
    if (state.source === 'demo') state.candles = PA.generateDemo(state.demoKind, state.inst, 400, state.demoSeed);
    state.cut = state.candles.length - 1;
    recomputeAll();
    renderForward();
  }
  init();
})();
