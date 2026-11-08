// Fuori Campo: digest cinema da feed RSS delle testate + canali YouTube (trailer ufficiali, John Campea, Grace Randolph).
// Uso: node digest.mjs  -> scrive fuori-campo.html (pagina completa, con miniature) e artifact.html (per Claude Artifact, senza immagini remote)
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(await readFile(join(DIR, 'config.json'), 'utf8'));
const NOW = Date.now();
const H = 3600e3;
const UA = 'Mozilla/5.0 (FuoriCampo RSS digest)';
const ARCHIVE = join(DIR, 'archivio.json');

// ---------- fetch ----------
async function get(url, retry = true) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 25000);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' }, signal: ctl.signal });
    if ((r.status === 429 || r.status >= 500) && retry) {
      clearTimeout(t);
      await new Promise(res => setTimeout(res, 5000));
      return get(url, false);
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

// ---------- parsing ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', eacute: 'é', egrave: 'è', agrave: 'à', ograve: 'ò', ugrave: 'ù', igrave: 'ì', laquo: '«', raquo: '»' };
function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    return ENT[e.toLowerCase()] ?? m;
  });
}
const cdata = s => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? cdata(m[1]).trim() : '';
}
const text = html => decode(decode(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

function parseFeed(xml) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map(b => {
    let link = tag(b, 'link');
    if (!link) { const m = b.match(/<link[^>]*href="([^"]+)"/i); link = m ? m[1] : ''; }
    const cats = [...b.matchAll(/<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi)].map(m => text(cdata(m[1])))
      .concat([...b.matchAll(/<category[^>]*term="([^"]+)"/gi)].map(m => decode(m[1])));
    const date = tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'published') || tag(b, 'updated');
    const rawDesc = tag(b, 'description') || tag(b, 'media:description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content');
    return { title: text(tag(b, 'title')), link: decode(link.trim()), cats, ts: Date.parse(date) || 0, rawDesc, vid: tag(b, 'yt:videoId') };
  });
}

function excerpt(raw, title, max = 230) {
  let s = text(raw)
    .replace(/The post .* appeared first on .*$/i, '')
    .replace(/L['’]articolo .* proviene da .*$/i, '')
    .replace(/(Continue reading|Read more|Leggi tutto|Continua a leggere).*$/i, '').replace(/\[…\]|\[\.\.\.\]/g, '…').trim();
  if (!s || s === title) return '';
  if (s.length > max) s = s.slice(0, max).replace(/\s+\S*$/, '') + '…';
  return s;
}

// ---------- classificazione ----------
const RE = {
  trailer: /\b(trailers?|teasers?|first look|sneak peek|tráiler)\b/i,
  review: /(\b(review|recensione)\s*[:|–—-]|^recensione\b|\breview\s*$|\breview\s*\()/i,
  rumor: /\b(rumou?rs?|rumou?red|reportedly|in talks|in early talks|in negotiations|eyed|eyeing|circling|front-?runner|shortlist|being considered|in contention|sources say|insiders say|scoop|could (return|star|join|play|be)|might (return|star|join)|is said to|said to be|in the running|top choice|may (return|star|join|be back|appear)|could be (back|returning)|report says|reports? suggests?|according to (a|new) reports?|unconfirmed|leaks?|leaked|spotted on set|indiscrezion\w*|rumors?|rumours?|in trattative|sarebbe in|potrebbe (tornare|interpretare|essere)|secondo (fonti|quanto riport)\w*)\b/i,
  uscite: /(\bnew (on|to) (netflix|max|hbo max|hulu|prime video|disney\+|apple tv\+?|peacock|paramount\+)|what['’]s (new|coming|leaving) (on|to)|streaming this week|new (movies|releases|shows) (to stream|this week|streaming)|movies (coming|out) this (week|weekend)|this weekend['’]?s? (movies|releases)|\buscite\b|in sala (dal|questa settimana|da giovedì)|al cinema (questa|da giovedì|nel weekend)|film in uscita|novità (su|di) (netflix|prime video|disney\+|sky|now|apple tv)|cosa vedere (su|in streaming|al cinema)|da vedere (al cinema|in streaming|questo weekend)|top 10)/i,
  approfondimenti: /\b(interview|intervista|in conversation|conversation with|essay|ranked|ranking|classifica|every .* ranked|oral history|deep dive|explained|spiegato|speciale|retrospective|anniversary|best (movies|films) of|i migliori film|migliori film|why .* matters|analysis|analisi)\b/i,
};
const isRumor = t => RE.rumor.test(t) || /\((report|rumou?r)\)/i.test(t);
function classify(it, feed) {
  const all = it.title + ' | ' + it.cats.join(' | ');
  if (feed.kind) return feed.kind;
  if (/\/(reviews?|recensioni?)\//i.test(it.link) || RE.review.test(it.title) || /^(reviews?|recensioni?)$/im.test(it.cats.join('\n'))) return 'recensioni';
  if (RE.uscite.test(it.title)) return 'uscite';
  if (RE.trailer.test(it.title)) return 'trailer-stampa';
  if (isRumor(it.title) || /\b(rumou?rs?|indiscrezioni)\b/i.test(it.cats.join(' '))) return 'rumor';
  if (RE.approfondimenti.test(all)) return 'approfondimenti';
  return 'notizie';
}
const isTrailerVideo = (title, link) => RE.trailer.test(title) && !/\/shorts\//.test(link) && !/#shorts|reaction|breakdown|recap|easter eggs|explained|behind the scenes|dietro le quinte|podcast|featurette/i.test(title);
const STREAM_RE = /\b(only on|streaming|stream it|su netflix|on netflix|prime video|disney\+|hbo max|apple tv|peacock|hulu|sky|now tv|in streaming|paramount\+)\b/i;
const CINEMA_RE = /\b(only in (theaters|theatres|cinemas)|in (theaters|theatres|cinemas)|al cinema|nelle sale|in sala|solo al cinema|dal \d+ \w+ al cinema|tickets)\b/i;
const blockRe = cfg.blockWords?.length ? new RegExp(cfg.blockWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i') : null;

// ---------- raccolta ----------
const status = [];
const fresh = []; // voci scaricate a questo giro
const pageUrl = (url, n) => n === 1 ? url : url + (url.includes('?') ? '&' : '?') + 'paged=' + n;
// UULF… = playlist dei soli video lunghi del canale (niente Shorts); se manca si ripiega sul feed completo
const ytUrl = id => `https://www.youtube.com/feeds/videos.xml?playlist_id=UULF${id.slice(2)}`;
const ytAll = id => `https://www.youtube.com/feeds/videos.xml?channel_id=${id}`;
const getYT = id => get(ytUrl(id)).catch(() => get(ytAll(id)));

async function collectFeed(feed) {
  let n = 0, total = 0, okPages = 0, lastErr = '';
  for (let p = 1; p <= (feed.pages || 1); p++) {
    try {
      const parsed = parseFeed(await get(pageUrl(feed.url, p)));
      okPages++; total += parsed.length;
      for (const it of parsed) {
        if (!it.title || !it.link) continue;
        if (blockRe && blockRe.test(it.title)) continue;
        // fonti da "solo rumor": entrano solo le voci con formule da indiscrezione, il resto è contenuto da fan
        if (feed.onlyRumor && !isRumor(it.title)) continue;
        fresh.push({ src: feed.name, lang: feed.lang, section: feed.onlyRumor ? 'rumor' : classify(it, feed), title: it.title, link: it.link, ts: it.ts || NOW, ex: excerpt(it.rawDesc, it.title) });
        n++;
      }
      if (!parsed.length) break;
    } catch (e) { lastErr = String(e.message || e); break; }
  }
  status.push(okPages ? { name: feed.name, ok: true, n, total } : { name: feed.name, ok: false, err: lastErr });
}
async function collectYT(ch, mode) {
  try {
    const parsed = parseFeed(await getYT(ch.id));
    let n = 0;
    for (const it of parsed) {
      if (!it.vid) continue;
      const vlink = `https://www.youtube.com/watch?v=${it.vid}`;
      if (mode === 'rumor') {
        if (/\/shorts\//.test(it.link)) continue;
        fresh.push({ src: ch.name, lang: ch.lang, section: 'rumor', video: true, vid: it.vid, title: it.title, link: vlink, ts: it.ts || NOW, ex: excerpt(it.rawDesc, it.title, 200) });
      } else {
        if (!isTrailerVideo(it.title, it.link)) continue;
        const desc = text(it.rawDesc);
        let where = ch.where;
        if (where === 'cinema' && STREAM_RE.test(desc) && !CINEMA_RE.test(desc)) where = 'streaming';
        else if (where === 'streaming' && CINEMA_RE.test(desc) && !STREAM_RE.test(desc)) where = 'cinema';
        fresh.push({ src: ch.name, lang: ch.lang, section: 'trailer', where, vid: it.vid, title: it.title, link: vlink, ts: it.ts || NOW, ex: excerpt(it.rawDesc, it.title, 160) });
      }
      n++;
    }
    status.push({ name: ch.name + ' (YouTube)', ok: true, n, total: parsed.length });
  } catch (e) { status.push({ name: ch.name + ' (YouTube)', ok: false, err: String(e.message || e) }); }
}

await Promise.all([
  ...cfg.feeds.map(collectFeed),
  ...cfg.youtubeRumor.map(c => collectYT(c, 'rumor')),
  ...cfg.youtubeTrailers.map(c => collectYT(c, 'trailer')),
]);

// ---------- archivio: i feed mostrano solo le ultime 10-20 voci, quindi si conserva quanto visto nei giri precedenti ----------
let archive = [];
try { archive = JSON.parse(await readFile(ARCHIVE, 'utf8')).items || []; } catch {}
// i trailer restano in archivio più a lungo (trailerArchivio) per riempire le schede delle piattaforme con poche novità
const winFor = s => (s === 'trailer' || s === 'trailer-arch' ?cfg.windows.trailerArchivio ?? cfg.windows.trailer : cfg.windows[s] ?? cfg.windows[s.replace('-stampa', '')] ?? 48) * H;
const byLink = new Map();
for (const it of archive) byLink.set(it.link, it);
for (const it of fresh) {
  const prev = byLink.get(it.link);
  byLink.set(it.link, { ...it, seen: prev?.seen || NOW, ts: prev && it.ts === NOW ? prev.ts : it.ts });
}
// ---------- ripiego per le piattaforme con meno di minTrailerPiattaforma trailer: ricerca "trailer" nel canale YouTube ----------
// il feed RSS espone solo gli ultimi 15 video; la ricerca ne dà ~30 con data relativa ("3w ago"), quindi approssimata
const MIN_T = cfg.minTrailerPiattaforma ?? 10;
const platOfCh = new Map(cfg.youtubeTrailers.filter(c => c.platform).map(c => [c.name, c.platform]));
const haveT = {};
for (const it of byLink.values()) if (/^trailer(-arch)?$/.test(it.section) && NOW - it.ts < winFor('trailer') && platOfCh.has(it.src)) haveT[platOfCh.get(it.src)] = (haveT[platOfCh.get(it.src)] || 0) + 1;
const REL = { s: 1 / 3600, m: 1 / 60, min: 1 / 60, h: 1, d: 24, w: 168, mo: 720, y: 8760 };
function relTs(txt) {
  const m = (txt || '').match(/(\d+)\s*(mo|min|[smhdwy])\w*\s+ago/i);
  return m ? NOW - Number(m[1]) * REL[m[2].toLowerCase()] * H : 0;
}
async function ytSearch(id) {
  const r = await fetch(`https://www.youtube.com/channel/${id}/search?query=trailer`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'en-US,en;q=0.9', Cookie: 'CONSENT=YES+1; SOCS=CAI' }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const m = (await r.text()).match(/var ytInitialData = (\{[\s\S]*?\});<\/script>/);
  if (!m) throw new Error('pagina senza dati');
  const out = [];
  (function walk(o) { if (!o || typeof o !== 'object') return; if (o.videoRenderer) { const v = o.videoRenderer; out.push({ vid: v.videoId, title: v.title?.runs?.[0]?.text || '', when: v.publishedTimeText?.simpleText || '' }); } for (const k in o) walk(o[k]); })(JSON.parse(m[1]));
  return out;
}
await Promise.all(cfg.youtubeTrailers.filter(c => c.platform && (haveT[c.platform] || 0) < MIN_T).map(async ch => {
  try {
    for (const v of await ytSearch(ch.id)) {
      const link = `https://www.youtube.com/watch?v=${v.vid}`;
      const ts = relTs(v.when);
      if (byLink.has(link) || !ts || NOW - ts > winFor('trailer') || !isTrailerVideo(v.title, '')) continue;
      byLink.set(link, { src: ch.name, lang: ch.lang, section: 'trailer-arch', where: ch.where, vid: v.vid, title: v.title, link, ts, ex: '', approx: true, seen: NOW });
    }
  } catch (e) { status.push({ name: ch.name + ' (ricerca YouTube)', ok: false, err: String(e.message || e) }); }
}));


// ---------- archivio ----------
// Le voci su festival/premi e sui casting seguiti (config: festival, tracker) restano in archivio più a lungo
// (windows.focus, 30 giorni), ma compaiono solo nelle loro sezioni: nelle altre valgono le finestre normali.
const FOCUS_RE = (cfg.festival || []).map(x => new RegExp(x.match, 'i'));
const isArticle = it => it.section !== 'trailer' && it.section !== 'trailer-arch';
const isFocus = it => isArticle(it) && FOCUS_RE.some(r => r.test(it.title));
const inWindow = it => NOW - it.ts < winFor(it.section);
const kept = [...byLink.values()].filter(it => it.ts <= NOW + H && (inWindow(it) || (isFocus(it) && NOW - it.ts < (cfg.windows.focus ?? 720) * H)));
// ---------- al cinema: film in sala in Italia secondo MYmovies (solo titolo, regia, genere, uscita, sale, distribuzione e link) ----------
// Se MYmovies non risponde si riusa l'ultimo elenco scaricato, conservato nell'archivio.
const MM_URL = 'https://www.mymovies.it/cinema/';
function parseMyMovies(html) {
  const txt = x => x ? decode(x).replace(/\s+/g, ' ').trim() : '';
  const films = new Map();
  for (const b of html.split('class="schedine-titolo"').slice(1)) {
    const c = b.slice(0, 6000);
    const t = c.match(/<a href="(https:\/\/www\.mymovies\.it\/film\/\d{4}\/[a-z0-9-]+\/)" title="([^"]+)"/);
    if (!t) continue;
    const d = c.match(/\?data=(\d{2})\/(\d{2})\/(\d{4})/);
    films.set(t[1], {
      title: txt(t[2]), link: t[1],
      genre: txt((c.match(/<a title="Film [^"]*" href="https:\/\/www\.mymovies\.it\/film\/[a-z-]+\/">([^<]+)<\/a>/) || [])[1]),
      regia: txt((c.match(/Un film di <a [^>]*>([^<]+)<\/a>/) || [])[1]),
      uscita: d ? `${d[3]}-${d[2]}-${d[1]}` : '',
      sale: +((c.match(/in <a [^>]*>\s*(\d+)\s+sal[ae]<\/a>/) || [])[1] || 0),
      distr: txt((c.match(/Distribuzione <a [^>]*>([^<]+)<\/a>/) || [])[1]),
    });
  }
  return [...films.values()];
}
let alCinema = null, alCinemaStale = false;
try { alCinema = JSON.parse(await readFile(ARCHIVE, 'utf8')).alCinema || null; } catch {}
try {
  const r = await fetch(MM_URL, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36', 'Accept-Language': 'it-IT,it;q=0.9' }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const films = parseMyMovies(await r.text());
  if (films.length < 5) throw new Error(`pagina cambiata? solo ${films.length} film trovati`);
  alCinema = { at: NOW, films };
  status.push({ name: 'MYmovies', ok: true, n: films.length });
} catch (e) {
  alCinemaStale = !!alCinema;
  status.push({ name: 'MYmovies', ok: false, err: String(e.message || e) + (alCinema ? ' (uso l\'elenco precedente)' : '') });
}
await writeFile(ARCHIVE, JSON.stringify({ at: NOW, items: kept, alCinema }));

// ---------- deduplica ----------
const STOP = new Set('the a an of to in for on and with at by from is are as its it s il lo la i gli le l un una uno di da del della dei delle degli e ed per con su nel nella al alla ai che new rumor rumour rumors rumours exclusive esclusiva report'.split(' '));
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[’'"“”‘«»]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const words = s => norm(s).split(' ').filter(w => w && !STOP.has(w));
const cleanTrailerTitle = t => t.replace(/\s*[|│]\s*(Netflix|Prime Video|Disney\+|HBO Max|Max|Apple TV\+?|Peacock( Original)?|Hulu|Paramount\+|Sky|Searchlight Pictures)(\s+Italia)?\s*$/i, '').trim();
// titolo del film citato tra virgolette ('Cliff Booth', “Dune”), oppure il testo prima di "trailer"
function filmKey(t) {
  const q = t.match(/(?:^|[\s(:])[‘'"“«]([^‘’'"“”«»]{2,80}?)[’'"”»](?=$|[\s,:;.!?)])/);
  if (q) return norm(q[1]);
  const m = t.match(/^(.+?)\s*[:|–—-]?\s*(?:(?:new|official|final|first|full|second|teaser|nuovo|il|primo)\s+)*(?:trailer|teaser)/i);
  return m ? norm(m[1]) : '';
}
const overlap = (a, b) => { let n = 0; for (const w of a) if (b.has(w)) n++; return n / Math.max(1, Math.min(a.size, b.size)); };
// articoli: stesso URL o titolo uguale, oppure stesse prime due parole e ≥60% di parole in comune entro 72 ore;
// gli articoli-trailer della stampa si raggruppano per film. In pagina resta la voce più recente, le altre fonti vanno in "anche su".
function dedupeArticles(list) {
  const out = [];
  for (const it of [...list].sort((a, b) => a.ts - b.ts)) {
    const n = norm(it.title), w = new Set(words(it.title)), first2 = [...w].slice(0, 2).join(' ');
    const fk = it.section === 'trailer-stampa' ? filmKey(it.title) : '';
    const dup = out.find(o => o.n === n
      || (fk && sameFilmKeys(o.fks, [fk]) && it.ts - o.last < 96 * H)
      || (w.size >= 4 && o.first2 === first2 && overlap(o.w, w) >= 0.6 && it.ts - o.last < 72 * H));
    if (dup) { dup.last = Math.max(dup.last, it.ts); if (fk) dup.fks.add(fk); dup.members.push(it); continue; }
    out.push({ ...it, n, w, first2, fk, fks: new Set(fk ? [fk] : []), first: it.ts, last: it.ts, also: [], members: [it] });
  }
  // secondo passaggio, indipendente dall'ordine: unisce i gruppi dello stesso film (es. JoBlo cita solo "Cliff Booth")
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) for (let j = i + 1; j < out.length && !merged; j++) {
      const a = out[i], b = out[j];
      if (!a.fks.size || !b.fks.size || !sameFilmKeys(a.fks, b.fks) || Math.max(a.first, b.first) - Math.min(a.last, b.last) > 96 * H) continue;
      for (const k of b.fks) a.fks.add(k);
      a.last = Math.max(a.last, b.last); a.first = Math.min(a.first, b.first);
      a.members.push(...b.members);
      out.splice(j, 1); merged = true;
    }
  }
  // in pagina va l'articolo più recente del gruppo; gli altri diventano "anche su"
  return out.map(g => {
    if (g.members.length < 2) return g;
    const top = g.members.reduce((x, y) => (y.ts > x.ts ? y : x));
    const also = [];
    for (const m of g.members) if (m !== top && m.src !== top.src && !also.some(x => x.src === m.src)) also.push({ src: m.src, link: m.link });
    return { ...g, ...top, also };
  });
}
// stesso film: chiavi identiche, oppure (se lunghe almeno 5 caratteri) una contenuta nell'altra ('Cliff Booth' ⊂ 'The Further Mis-Adventures of Cliff Booth')
function sameFilmKeys(as, bs) {
  for (const a of as) for (const b of bs) {
    if (a.length >= 3 && a === b) return true;
    if (Math.min(a.length, b.length) >= 5 && (` ${a} `.includes(` ${b} `) || ` ${b} `.includes(` ${a} `))) return true;
  }
  return false;
}
// trailer: stesso videoId o stesso titolo ripulito (Netflix carica a volte più copie dello stesso trailer); resta il più recente
function dedupeTrailers(list) {
  const seen = new Set();
  return [...list].sort((a, b) => b.ts - a.ts).filter(it => {
    const k = norm(cleanTrailerTitle(it.title));
    if (seen.has(it.vid) || seen.has(k)) return false;
    seen.add(it.vid); seen.add(k); return true;
  }).map(it => ({ ...it, also: [] }));
}
const arts = dedupeArticles(kept.filter(isArticle));
const allTrailers = dedupeTrailers(kept.filter(it => !isArticle(it)));
const items = [...allTrailers, ...arts.filter(inWindow)].sort((a, b) => b.ts - a.ts);
const pick = (s, max) => items.filter(i => i.section === s).slice(0, max ?? 999);

// ---------- formati ----------
const h = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDay = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', day: 'numeric', month: 'short' });
const fmtCal = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'short', day: 'numeric', month: 'short' });
const fmtLong = new Intl.DateTimeFormat('it-IT', { timeZone: 'Europe/Rome', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const isNew = it => it.ts && NOW - it.ts < cfg.newHours * H;
const slug = s => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const LANG = { it: 'IT', en: 'EN', fr: 'FR' };
const M = cfg.maxPerSection;
const LIM = 8; // voci visibili per lista prima di "Mostra tutto"

// ---------- trailer ----------
const trailers = allTrailers.filter(t => t.section === 'trailer' && NOW - t.ts < cfg.windows.trailer * H); // "della settimana": solo date esatte dai feed
const tCinema = trailers.filter(t => t.where === 'cinema');
const tStream = trailers.filter(t => t.where === 'streaming');
const tPress = pick('trailer-stampa', 40);

// ---------- festival e premi: le voci di notizie/approfondimenti finiscono qui (non più nelle sezioni d'origine) ----------
const FEST = (cfg.festival || []).map(f => ({ ...f, re: new RegExp(f.match, 'i') }));
for (const a of arts) a.fest = FEST.find(f => f.re.test(a.title))?.id || '';
const festMoves = new Set(['notizie', 'approfondimenti']);
const festData = FEST.map(f => ({ ...f, list: arts.filter(a => a.fest === f.id).sort((x, y) => y.ts - x.ts).slice(0, 40) }));
const festCount = festData.reduce((n, f) => n + f.list.length, 0);
const notFest = s => items.filter(i => i.section === s && !(festMoves.has(s) && i.fest));

const rumor = pick('rumor', M.rumor);
const rumorVideo = rumor.filter(r => r.video);
const rumorText = rumor.filter(r => !r.video);

// ---------- piattaforme: canale/feed dedicato, altrimenti parole chiave (titolo; per i trailer anche la descrizione) ----------
const PLATFORMS = (cfg.platforms || []).map(p => ({ ...p, re: new RegExp(p.match, 'i') }));
const fixedPlat = new Map([...cfg.youtubeTrailers, ...cfg.feeds].filter(x => x.platform).map(x => [x.name, x.platform]));
function platformOf(it) {
  if (fixedPlat.has(it.src)) return fixedPlat.get(it.src);
  const txt = isArticle(it) ? it.title : it.title + ' ' + (it.ex || '');
  return PLATFORMS.find(p => p.re.test(txt))?.id || '';
}
for (const it of [...items, ...arts]) it.plat = platformOf(it);
const platNewsSections = new Set(['uscite', 'notizie', 'rumor', 'recensioni', 'approfondimenti', 'trailer-stampa']);
const platData = PLATFORMS.map(p => ({
  ...p,
  trailers: trailers.filter(t => t.plat === p.id),
  allNews: items.filter(i => i.plat === p.id && platNewsSections.has(i.section)),
})).map(p => ({
  ...p,
  news: p.allNews.slice(0, 40),
  // regola del minimo: se le novità della settimana sono meno di minTrailerPiattaforma, si aggiungono i trailer precedenti più recenti
  older: allTrailers.filter(t => t.plat === p.id && !p.trailers.includes(t)).slice(0, Math.max(0, (cfg.minTrailerPiattaforma ?? 10) - p.trailers.length)),
})).filter(p => p.trailers.length || p.older.length || p.news.length);
const platCount = platData.reduce((n, p) => n + p.trailers.length + p.older.length, 0);

// ---------- date da segnare: date di uscita italiane lette da titolo e descrizione dei trailer italiani ----------
const MESI = { gennaio: 0, febbraio: 1, marzo: 2, aprile: 3, maggio: 4, giugno: 5, luglio: 6, agosto: 7, settembre: 8, ottobre: 9, novembre: 10, dicembre: 11 };
const DATE_RE = /\b(?:dal(?:l['’])?\s*|il\s+)?(\d{1,2})(?:°|º)?\s+(gennaio|febbraio|marzo|aprile|maggio|giugno|luglio|agosto|settembre|ottobre|novembre|dicembre)(?:\s+(20\d\d))?/i;
const dayStart = t => { const d = new Date(t); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const TODAY = dayStart(NOW + 3600e3); // ora italiana, approssimata
function releaseDate(it) {
  const m = (it.title + ' ' + (it.ex || '')).match(DATE_RE);
  if (!m) return 0;
  const d = +m[1], mo = MESI[m[2].toLowerCase()];
  if (d < 1 || d > 31) return 0;
  let y = m[3] ? +m[3] : new Date(it.ts).getUTCFullYear();
  let t = Date.UTC(y, mo, d);
  if (!m[3] && t < dayStart(it.ts) - 60 * 864e5) t = Date.UTC(y + 1, mo, d); // "dal 5 gennaio" in un trailer di novembre = anno dopo
  return t;
}
function filmName(t) {
  let s = cleanTrailerTitle(t).split(/\s+[|│]\s+|\s+[-–—]\s+/)[0];
  s = s.replace(/\s*[-–—:]?\s*(?:(?:nuovo|official|ufficiale|final[e]?|teaser|primo|secondo|\d)\s*)*(?:trailer|teaser)\b.*$/i, '').trim();
  return s || cleanTrailerTitle(t);
}
const calSeen = new Map();
for (const it of allTrailers.filter(t => t.lang === 'it')) {
  const when = releaseDate(it);
  if (!when || when < TODAY || when > TODAY + 200 * 864e5) continue;
  const film = filmName(it.title), k = norm(film);
  const prev = calSeen.get(k);
  if (!prev || it.ts > prev.it.ts) calSeen.set(k, { film, when, it, where: it.where });
}
const calendar = [...calSeen.values()].sort((a, b) => a.when - b.when);
const calCinema = calendar.filter(c => c.where === 'cinema');
const calStream = calendar.filter(c => c.where === 'streaming');
const countdown = when => { const d = Math.round((when - TODAY) / 864e5); return d <= 0 ? 'oggi' : d === 1 ? 'domani' : `tra ${d} giorni`; };

const cinemaFilms = (alCinema?.films || []).slice().sort((a, b) => b.sale - a.sale);
const SECTIONS = [
  { id: 'trailer', title: 'Trailer della settimana', sub: 'Trailer e teaser ufficiali degli ultimi 7 giorni, dai canali di studi, distributori italiani e piattaforme', count: trailers.length },
  { id: 'alcinema', title: 'Al cinema', sub: 'I film in sala in Italia questa settimana secondo MYmovies, dal più programmato', count: cinemaFilms.length },
  { id: 'date', title: 'Date da segnare', sub: 'Uscite italiane annunciate nei trailer dei distributori e delle piattaforme, in ordine di data', count: calendar.length },
  { id: 'piattaforme', title: 'Piattaforme', sub: 'Una scheda per servizio: trailer delle novità e notizie, uscite e rumor. Nelle schede: ▶ trailer · notizie. Il numero accanto al titolo conta i trailer', count: platCount },
  { id: 'uscite', title: 'In sala e in streaming', sub: 'Guide alle uscite della settimana: cinema e piattaforme', list: pick('uscite', M.uscite) },
  { id: 'rumor', title: 'Rumor', sub: 'Indiscrezioni, trattative, casting non confermati. Video di John Campea e Grace Randolph, scoop di World of Reel e The InSneider', count: rumor.length },
  { id: 'casting', title: 'Tracker', sub: `Aggiornamenti organizzati per categoria, ultimi ${Math.round((cfg.windows.focus ?? 720) / 24)} giorni`, count: TRACK.reduce((n, t) => n + t.n, 0) },
  { id: 'notizie', title: 'Notizie', sub: 'Casting, produzioni, box office, industria · ultime 48 ore', list: notFest('notizie').slice(0, M.notizie) },
  { id: 'festival', title: 'Festival e premi', sub: `Torino Film Festival, Oscar, AFM · ultimi ${Math.round((cfg.windows.focus ?? 720) / 24)} giorni`, count: festCount },
  { id: 'recensioni', title: 'Recensioni', sub: 'Critica dai trade e dalle riviste · ultimi 7 giorni', list: pick('recensioni', M.recensioni) },
  { id: 'approfondimenti', title: 'Approfondimenti', sub: 'Interviste, classifiche, analisi', list: notFest('approfondimenti').slice(0, M.approfondimenti) },
];

// ---------- markup delle voci ----------
// data-src: fonte (+ fonti con la stessa notizia), data-it: voce italiana, data-u: link (per contare le voci una volta sola)
const srcAttr = it => [it.src, ...(it.also || []).map(a => a.src)].map(slug).join(' ');
const attrs = (it, cls) => `class="${cls}" data-src="${h(srcAttr(it))}"${it.lang === 'it' ? ' data-it' : ''}${isNew(it) ? ' data-new' : ''} data-t="${h(cleanTrailerTitle(it.title))}" data-u="${h(it.link)}"`;
const alsoHtml = it => it.also?.length ? `<span class="also">anche su ${it.also.slice(0, 4).map(a => `<a href="${h(a.link)}" target="_blank" rel="noopener">${h(a.src)}</a>`).join(', ')}${it.also.length > 4 ? ` e altre ${it.also.length - 4}` : ''}</span>` : '';
function row(it) {
  return `<li ${attrs(it, 'it')}>
  <div class="meta"><span class="src">${h(it.src)}</span><span class="lang">${LANG[it.lang] || ''}</span>${it.video ? '<span class="lang">VIDEO</span>' : ''}<time>${h(fmt.format(it.ts))}</time>${isNew(it) ? '<span class="pill">nuovo</span>' : ''}</div>
  <div class="body"><a class="t" href="${h(it.link)}" target="_blank" rel="noopener" title="${h(it.title)}">${h(it.title)}</a>${alsoHtml(it)}</div>
</li>`;
}
function card(it, images) {
  const thumb = images
    ? `<img src="https://i.ytimg.com/vi/${h(it.vid)}/hqdefault.jpg" alt="" loading="lazy" width="480" height="360">`
    : `<span class="ph" aria-hidden="true">▶</span>`;
  const t = cleanTrailerTitle(it.title);
  return `<li ${attrs(it, 'card')}>
  <a href="${h(it.link)}" target="_blank" rel="noopener"><span class="thumb">${thumb}${isNew(it) ? '<span class="pill solid">nuovo</span>' : ''}</span>
  <span class="ct" title="${h(t)}">${h(t)}</span></a>
  <span class="cm"><b>${h(it.src)}</b> · ${LANG[it.lang]} · ${it.approx ? `<span title="data approssimativa">≈ ${h(fmtDay.format(it.ts))}</span>` : h(fmt.format(it.ts))}</span>
</li>`;
}
const vrow = (it, images) => `<li ${attrs(it, 'vr')}>
  <a href="${h(it.link)}" target="_blank" rel="noopener"><span class="thumb">${images ? `<img src="https://i.ytimg.com/vi/${h(it.vid)}/mqdefault.jpg" alt="" loading="lazy" width="320" height="180">` : '<span class="ph" aria-hidden="true">▶</span>'}</span>
  <span><span class="vt" title="${h(it.title)}">${h(it.title)}</span><span class="cm"><b>${h(it.src)}</b> · ${h(fmt.format(it.ts))}${isNew(it) ? ' · <em>nuovo</em>' : ''}</span></span></a>
</li>`;
const calRow = c => `<li ${attrs({ ...c.it, title: c.film }, 'cal')} data-when="${c.when}">
  <span class="cd"><b>${h(fmtCal.format(c.when))}</b><span class="cdn" data-when="${c.when}">${countdown(c.when)}</span></span>
  <span class="body"><a class="t" href="${h(c.it.link)}" target="_blank" rel="noopener" title="${h(c.film)}">${h(c.film)}</a><span class="cm">${h(c.it.src)} · trailer</span></span>
</li>`;
// film in sala: titolo con link a MYmovies, sale e data d'uscita; "nuova uscita" se uscito negli ultimi 7 giorni
function filmRow(f) {
  const ts = f.uscita ? Date.parse(f.uscita + 'T12:00:00Z') : 0;
  const fresh = ts && NOW - ts < 7 * 864e5 && ts <= NOW + 864e5;
  return `<li class="it film" data-src="mymovies" data-it data-t="${h(f.title)}" data-u="${h(f.link)}">
  <div class="meta"><span class="src">${f.sale} sale</span>${ts ? `<time>in sala dal ${h(fmtDay.format(ts))}</time>` : ''}${fresh ? '<span class="pill">nuova uscita</span>' : ''}</div>
  <div class="body"><a class="t" href="${h(f.link)}" target="_blank" rel="noopener" title="${h(f.title)}">${h(f.title)}</a><span class="cm">${[f.regia && 'di ' + f.regia, f.genre, f.distr].filter(Boolean).map(h).join(' · ')}</span></div>
</li>`;
}
const more = '<button type="button" class="more" hidden>Mostra tutto</button>';
const list = (arr, lim = LIM) => arr.length ? `<ul class="list lim" data-lim="${lim}">${arr.map(row).join('')}</ul>${more}` : '<p class="empty">Niente di nuovo in questa finestra.</p>';
const grid = (arr, images) => arr.length ? `<ul class="cards lim" data-lim="${LIM}">${arr.map(t => card(t, images)).join('')}</ul>${more}` : '<p class="empty">Nessun trailer in questa finestra.</p>';
const tabs = (group, label, entries) => `<div class="tabs scroll" role="tablist" aria-label="${h(label)}" data-group="${group}">
${entries.map((e, i) => `  <button type="button" role="tab" data-tab="${e.id}" aria-selected="${i ? 'false' : 'true'}">${h(e.name)} <span class="n"${e.title ? ` title="${h(e.title)}"` : ''}>${e.n}</span></button>`).join('\n')}
</div>`;

function section(s, images) {
  let inner, count = s.count ?? s.list?.length ?? 0;
  if (s.id === 'trailer') {
    inner = `${tabs('trailer', 'Dove esce', [{ id: 't-cinema', name: 'Al cinema', n: tCinema.length }, { id: 't-stream', name: 'In streaming', n: tStream.length }, { id: 't-press', name: 'Dalla stampa', n: tPress.length }])}
<div id="t-cinema" class="tp">${grid(tCinema, images)}</div>
<div id="t-stream" class="tp" hidden>${grid(tStream, images)}</div>
<div id="t-press" class="tp" hidden>${list(tPress)}</div>`;
  } else if (s.id === 'alcinema') {
    inner = cinemaFilms.length ? `${alCinemaStale ? `<p class="note">MYmovies non ha risposto a questo giro: elenco del ${h(fmt.format(alCinema.at))}.</p>` : ''}<ul class="list films lim" data-lim="${LIM}">${cinemaFilms.map(filmRow).join('')}</ul>${more}
<p class="note">Fonte: <a href="${MM_URL}" target="_blank" rel="noopener">MYmovies, Film al cinema</a> · numero di sale del giorno · aggiornato ${h(fmt.format(alCinema.at))}.</p>`
      : '<p class="empty">Elenco dei film in sala non disponibile a questo giro.</p>';
  } else if (s.id === 'date') {
    const col = (title, arr) => `<div><h3>${title} <span class="n">${arr.length}</span></h3>${arr.length ? `<ul class="calendar lim" data-lim="${LIM}">${arr.map(calRow).join('')}</ul>${more}` : '<p class="empty">Nessuna data annunciata.</p>'}</div>`;
    inner = `<div class="cols">${col('Al cinema', calCinema)}${col('In streaming', calStream)}</div>
<p class="note">Date ricavate da titolo e descrizione dei trailer italiani ufficiali; se un'uscita viene spostata vale l'ultimo trailer pubblicato.</p>`;
  } else if (s.id === 'piattaforme') {
    inner = platData.length ? `${tabs('plat', 'Piattaforma', platData.map(p => ({ id: 'p-' + p.id, name: p.name, n: `▶ ${p.trailers.length + p.older.length} · ${p.allNews.length}`, title: `${p.trailers.length + p.older.length} trailer · ${p.allNews.length} notizie` })))}
${platData.map((p, i) => `<div id="p-${p.id}" class="tp"${i ? ' hidden' : ''}>
  <h3 class="sub">Trailer delle novità <span class="n">${p.trailers.length}${p.older.length ? ` + ${p.older.length} precedenti` : ''}</span></h3>
  ${p.trailers.length ? grid(p.trailers, images) : '<p class="empty">Nessun trailer negli ultimi 7 giorni.</p>'}
  ${p.older.length ? `<p class="older">Precedenti, per arrivare ad almeno ${cfg.minTrailerPiattaforma ?? 10}</p>${grid(p.older, images)}` : ''}
  <h3 class="sub">Notizie, uscite e rumor <span class="n">${p.news.length < p.allNews.length ? `${p.news.length} più recenti di ${p.allNews.length}` : p.news.length}</span></h3>
  ${list(p.news)}
</div>`).join('\n')}` : '<p class="empty">Niente sulle piattaforme in questa finestra.</p>';
  } else if (s.id === 'rumor') {
    inner = `<div class="cols rumor-cols">
  <div><h3>Video <span class="n">${rumorVideo.length}</span></h3>${rumorVideo.length ? `<ul class="vlist lim" data-lim="6">${rumorVideo.slice(0, 30).map(v => vrow(v, images)).join('')}</ul>${more}` : '<p class="empty">Nessun video questa settimana.</p>'}</div>
  <div><h3>Scoop e indiscrezioni <span class="n">${rumorText.length}</span></h3>${list(rumorText)}</div>
</div>
<p class="note">I rumor sono per definizione non confermati: la voce è riportata così come la presenta la fonte.</p>`;
  } else if (s.id === 'festival') {
    inner = festCount ? `${tabs('fest', 'Festival', festData.map(f => ({ id: 'f-' + f.id, name: f.name, n: f.list.length })))}
${festData.map((f, i) => `<div id="f-${f.id}" class="tp"${i ? ' hidden' : ''}>${list(f.list)}</div>`).join('\n')}` : '<p class="empty">Nessuna voce su festival e premi in questo periodo.</p>';
  } else inner = list(s.list);
  return `<section id="${s.id}" class="sec"${s.keep ? ' data-keep' : ''}>
<header class="sh"><h2>${h(s.title)}</h2><span class="count">${count}</span><p>${h(s.sub)}</p></header>
${inner}
</section>`;
}

const shown = [...trailers, ...tPress, ...rumor, ...SECTIONS.filter(s => s.list).flatMap(s => s.list), ...festData.flatMap(f => f.list)];
const sources = [...new Set([...shown.filter(i => isArticle(i)).flatMap(i => [i.src, ...(i.also || []).map(a => a.src)]), ...(cinemaFilms.length ? ['MYmovies'] : [])])].sort((a, b) => a.localeCompare(b));
const newCount = new Set(shown.filter(isNew).map(i => i.link)).size;
const ok = status.filter(s => s.ok), failed = status.filter(s => !s.ok);

function page(images) {
  return `<title>Fuori Campo</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Source+Sans+3:wght@400;600;700&family=JetBrains+Mono:wght@400;500&display=swap">
<style>
/* Fuori Campo — impaginato da locandina: testata a caratteri da insegna, trailer a griglia, liste con colonna meta */
:root{
  --paper:#F2EEE6; --ink:#151311; --muted:#625C55; --rule:#D8D1C5; --accent:#B3141F; --hot:#B3141F; --chip:#E8E2D7; --card:#E6E0D4; --ok:#2E7D4F; --warn:#A86A00;
  --display:"Anton","Impact","Arial Narrow",sans-serif;
  --body:"Source Sans 3","Segoe UI",system-ui,sans-serif;
  --mono:"JetBrains Mono",ui-monospace,Consolas,monospace;
}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--paper:#100F0E;--ink:#ECE7DF;--muted:#A19A90;--rule:#2B2825;--accent:#FF5A4F;--hot:#FF5A4F;--chip:#1C1A18;--card:#1E1C19;--ok:#6CC992;--warn:#E8B04B;color-scheme:dark}}
:root[data-theme="dark"]{--paper:#100F0E;--ink:#ECE7DF;--muted:#A19A90;--rule:#2B2825;--accent:#FF5A4F;--hot:#FF5A4F;--chip:#1C1A18;--card:#1E1C19;--ok:#6CC992;--warn:#E8B04B;color-scheme:dark}
*{box-sizing:border-box}
html,body{overflow-x:clip}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.5 var(--body)}
.wrap{max-width:1120px;margin:0 auto;padding-block:28px 64px;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
a{color:inherit}
a:focus-visible,button:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
img{max-width:100%;display:block}
[hidden],.cut{display:none!important}
.mast{display:grid;gap:10px;border-bottom:4px solid var(--ink);padding-bottom:18px}
.mast h1{font:400 clamp(64px,13vw,150px)/.86 var(--display);letter-spacing:.005em;margin:0;text-transform:uppercase}
.mast h1 span{color:var(--accent)}
.mast .tag{font:500 12px/1.4 var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.08em;margin:0}
.mast .tag a{color:var(--accent)}
.stats{display:flex;flex-wrap:wrap;gap:6px 18px;font:400 13px/1.4 var(--mono);color:var(--muted);margin:0}
.stats b{color:var(--ink);font-weight:500}
/* indice fisso: resta in cima durante lo scorrimento, scorre in orizzontale se non ci sta */
nav.toc{position:sticky;top:0;z-index:30;display:flex;flex-wrap:nowrap;gap:8px;align-items:center;margin:18px -16px 6px;padding:10px 16px;overflow-x:auto;scrollbar-width:none;background:var(--paper);border-bottom:1px solid var(--rule);box-shadow:0 6px 12px -10px rgba(0,0,0,.35)}
nav.toc::-webkit-scrollbar{display:none}
nav.toc a{flex:none;white-space:nowrap;font:600 14px/1 var(--body);text-decoration:none;padding:8px 12px;border:1px solid var(--rule);border-radius:999px;background:var(--chip)}
nav.toc a:hover{border-color:var(--ink)}
nav.toc a[aria-current="true"]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
nav.toc a.top{font-family:var(--mono);font-weight:500;background:transparent}
.sec,.mast{scroll-margin-top:64px}
.filters{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:10px 0 0;font:400 12px/1 var(--mono);color:var(--muted)}
.filters>*{flex:none}
.filters button{font:500 12px/1 var(--mono);color:var(--ink);background:transparent;border:1px solid var(--rule);border-radius:4px;padding:6px 8px;cursor:pointer;white-space:nowrap}
/* filtro "mostra solo": le testate selezionate sono piene; con nessuna selezionata si vede tutto */
.filters button:hover{border-color:var(--ink)}
.filters button[aria-pressed="true"]{background:var(--ink);border-color:var(--ink);color:var(--paper)}
.filters button.only[aria-pressed="true"]{background:var(--hot);border-color:var(--hot);color:var(--paper)}
.filters button.reset{border-style:dashed;color:var(--accent)}
.filters .sep{width:1px;height:20px;background:var(--rule)}
.fnote{margin:14px 0 0;font:400 13px/1.4 var(--mono);color:var(--muted)}
.sec{margin-top:48px}
.sh{display:grid;grid-template-columns:auto auto 1fr;align-items:baseline;gap:4px 12px;border-bottom:1px solid var(--ink);padding-bottom:8px}
.sh h2{font:400 42px/1 var(--display);text-transform:uppercase;margin:0;text-wrap:balance}
.sh .count{font:500 14px/1 var(--mono);color:var(--accent)}
.sh p{grid-column:1/-1;margin:0;color:var(--muted);font-size:14px}
ul{list-style:none;margin:0;padding:0}
.list .it{display:grid;grid-template-columns:180px minmax(0,1fr);gap:4px 20px;padding:14px 0;border-bottom:1px solid var(--rule)}
.meta{display:flex;flex-wrap:wrap;gap:4px 8px;align-content:start;align-items:center;font:400 12px/1.4 var(--mono);color:var(--muted)}
.meta .src{color:var(--ink);font-weight:500;width:100%}
.lang{border:1px solid var(--rule);border-radius:3px;padding:0 4px;font-size:10px;letter-spacing:.06em}
.pill{font:500 10px/1.6 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--hot);border:1px solid currentColor;border-radius:3px;padding:0 5px}
.pill.solid{position:absolute;top:8px;left:8px;background:var(--hot);color:#fff;border-color:var(--hot)}
.body{min-width:0}
/* titoli lunghi: due righe al massimo, titolo intero nel tooltip */
.t,.ct,.vt{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;overflow-wrap:anywhere}
.t{font-weight:700;font-size:17px;line-height:1.35;text-decoration:none}
.t:hover,.ct:hover,.vt:hover{text-decoration:underline;text-decoration-color:var(--accent);text-underline-offset:3px}
.also{display:block;margin-top:4px;font:400 12px/1.5 var(--mono);color:var(--muted)}
.also a{color:var(--accent)}
.tabs{display:flex;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;gap:6px;margin:16px 0 14px;padding-bottom:2px}
.tabs::-webkit-scrollbar{display:none}
.tabs button{flex:none;white-space:nowrap;font:600 15px/1 var(--body);color:var(--ink);background:var(--chip);border:1px solid var(--rule);border-radius:999px;padding:9px 14px;cursor:pointer}
.tabs button[aria-selected="true"]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.tabs .n{font:500 12px/1 var(--mono);color:var(--accent);margin-left:4px}
.tabs button[aria-selected="true"] .n{color:inherit;opacity:.75}
h3.sub{font:400 22px/1 var(--display);text-transform:uppercase;letter-spacing:.02em;margin:22px 0 12px;display:flex;gap:8px;align-items:baseline}
.tp>h3.sub:first-child{margin-top:6px}
.older{font:500 12px/1 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:26px 0 12px;padding-top:14px;border-top:1px dashed var(--rule)}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:22px 18px}
.card,.vr{position:relative;min-width:0}
.films .it{grid-template-columns:150px minmax(0,1fr)}
.films .meta .src{font-size:14px}
.card a{text-decoration:none;display:grid;gap:8px}
.thumb{position:relative;display:block;aspect-ratio:16/9;overflow:hidden;border-radius:6px;background:var(--card)}
.thumb img{width:100%;height:100%;object-fit:cover}
.ph{position:absolute;inset:0;display:grid;place-items:center;font-size:30px;color:var(--accent);background:linear-gradient(135deg,var(--card),var(--chip))}
.ct{font-weight:700;font-size:16px;line-height:1.3}
.cm{display:block;font:400 12px/1.5 var(--mono);color:var(--muted);margin-top:4px}
.cm b{color:var(--ink);font-weight:500}
.cm em{color:var(--hot);font-style:normal;text-transform:uppercase;font-size:10px;letter-spacing:.08em}
.more{display:block;margin:14px 0 0;font:600 14px/1 var(--body);color:var(--ink);background:transparent;border:1px dashed var(--ink);border-radius:999px;padding:9px 16px;cursor:pointer}
.more:hover{background:var(--chip)}
.cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:32px;margin-top:6px}
.cols h3{font:400 24px/1 var(--display);text-transform:uppercase;letter-spacing:.02em;margin:16px 0 8px;display:flex;gap:8px;align-items:baseline}
.cols .list .it{grid-template-columns:130px minmax(0,1fr)}
.rumor-cols{grid-template-columns:minmax(0,5fr) minmax(0,7fr)}
.track .st-ok h3{color:var(--ok)}
.track .st-rumor h3{color:var(--warn)}
.track .st-ok{border-top:3px solid var(--ok)}
.track .st-rumor{border-top:3px solid var(--warn)}
.n{font:500 12px/1 var(--mono);color:var(--accent)}
.vr{border-bottom:1px solid var(--rule);padding:10px 0}
.vr a{display:grid;grid-template-columns:132px minmax(0,1fr);gap:12px;text-decoration:none;align-items:start}
.vt{font-weight:600;font-size:15px;line-height:1.3}
.cal{display:grid;grid-template-columns:118px minmax(0,1fr);gap:4px 14px;align-items:start;padding:12px 0;border-bottom:1px solid var(--rule)}
.cd{display:grid;gap:2px;font:400 12px/1.3 var(--mono);color:var(--muted)}
.cd b{font:500 14px/1.2 var(--mono);color:var(--ink);text-transform:capitalize}
.cdn{color:var(--accent)}
.cal .t{font-size:16px}
.note,.empty{color:var(--muted);font-size:14px}
footer{margin-top:56px;padding-top:14px;border-top:4px solid var(--ink);font:400 12px/1.6 var(--mono);color:var(--muted);overflow-wrap:anywhere}
footer .ko{color:var(--hot)}
@media (max-width:760px){
  .list .it,.cols .list .it{grid-template-columns:minmax(0,1fr)}
  .meta .src{width:auto}
  .cols,.rumor-cols{grid-template-columns:minmax(0,1fr);gap:0}
  .cards{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:18px 12px}
  .ct{font-size:15px}
  .sh h2{font-size:34px}
  /* barra dei filtri: una sola riga che scorre in orizzontale */
  .filters{flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none;margin-inline:-16px;padding:2px 16px 6px}
  .filters::-webkit-scrollbar{display:none}
  .cal{grid-template-columns:92px minmax(0,1fr)}
}
@media (prefers-reduced-motion:no-preference){html{scroll-behavior:smooth}}
</style>
<div class="wrap">
<header class="mast" id="top">
  <p class="tag">Digest cinema personale · aggiornato ogni ora${images ? '' : ` · <a href="${h(cfg.siteUrl)}" target="_blank" rel="noopener">versione sempre aggiornata, con anteprime</a>`}</p>
  <h1>Fuori <span>Campo</span></h1>
  <p class="stats"><span>Aggiornato <b>${h(fmtLong.format(NOW))}</b></span><span><b>${trailers.length}</b> trailer</span><span><b>${rumor.length}</b> rumor</span><span><b>${newCount}</b> novità nelle ultime ${cfg.newHours} ore</span><span><b>${ok.length}</b>/${status.length} fonti raggiunte</span></p>
</header>
<nav class="toc" aria-label="Indice delle sezioni">${SECTIONS.map(s => `<a href="#${s.id}">${h(s.title)}</a>`).join('')}<a class="top" href="#top" aria-label="Torna su">↑ su</a></nav>
<div class="filters" role="group" aria-label="Filtri"><span>Mostra solo:</span><button type="button" id="f-onlynew" class="only" aria-pressed="false">solo nuovi</button><button type="button" id="f-onlyit" class="only" aria-pressed="false" title="Solo distributori, piattaforme e testate italiane">solo Italia</button><button type="button" id="f-all" class="reset" hidden>tutte le fonti</button><span class="sep" aria-hidden="true"></span>${sources.map(s => `<button type="button" data-src="${slug(s)}" aria-pressed="false">${h(s)}</button>`).join('')}</div>
<p class="fnote" id="fnote" hidden></p>
${SECTIONS.map(s => section(s, images)).join('\n')}
<footer>
  <p>Fonti raggiunte: ${ok.filter(s => !s.name.endsWith('(YouTube)')).map(s => `${h(s.name)} (${s.n})`).join(' · ')}</p>
  <p>Canali YouTube: ${ok.filter(s => s.name.endsWith('(YouTube)')).map(s => `${h(s.name.replace(' (YouTube)', ''))} (${s.n})`).join(' · ')}</p>
  ${failed.length ? `<p class="ko">Non raggiunte a questo giro: ${failed.map(s => `${h(s.name)} – ${h(s.err)}`).join(' · ')}</p>` : ''}
  <p>Per ogni voce: titolo, fonte, data e link all'originale. Finestre: notizie ${cfg.windows.notizie} ore, trailer/rumor/recensioni 7 giorni, festival e casting ${Math.round((cfg.windows.focus ?? 720) / 24)} giorni. Fonti e canali modificabili in config.json.</p>
</footer>
</div>
<script>
(function(){
  // localStorage può essere bloccato dal browser: ogni lettura e scrittura passa da qui
  var storageOk=true;
  function load(k,def){try{var v=localStorage.getItem(k);return v?JSON.parse(v):def}catch(e){storageOk=false;return def}}
  function store(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){storageOk=false}}

  // ---- filtri: fonti scelte (vuoto = tutte), solo nuovi, solo Italia ----
  var KEY='fuoricampo-filters', ITEMS='.it,.vr,.card,.cal', st=load(KEY,{});
  var sel=st.sel||{}, onlyNew=!!st.onlyNew, onlyIt=!!st.onlyIt, tabs=st.tabs||{};
  var btns=document.querySelectorAll('.filters button[data-src]'), nb=document.getElementById('f-onlynew'), ib=document.getElementById('f-onlyit'), all=document.getElementById('f-all'), note=document.getElementById('fnote'), groups=document.querySelectorAll('.tabs[data-group]');
  for(var k in sel)if(!document.querySelector('.filters button[data-src="'+k+'"]'))delete sel[k]; // testata non più presente
  btns.forEach(function(b){if(sel[b.dataset.src])sel[b.dataset.src]=b.textContent});
  var vis=function(li){return !li.hidden};
  function limit(){
    document.querySelectorAll('.lim').forEach(function(ul){
      var n=+ul.dataset.lim||8, open=ul.classList.contains('open'), shown=[].filter.call(ul.children,vis);
      shown.forEach(function(li,i){li.classList.toggle('cut',!open&&i>=n)});
      var b=ul.nextElementSibling;
      if(b&&b.classList.contains('more')){b.hidden=shown.length<=n;b.textContent=open?'Mostra meno':'Mostra tutto ('+shown.length+')'}
    });
  }
  function apply(){
    var picked=Object.keys(sel), filtering=picked.length>0||onlyNew||onlyIt;
    btns.forEach(function(b){b.setAttribute('aria-pressed',sel[b.dataset.src]?'true':'false')});
    nb.setAttribute('aria-pressed',onlyNew?'true':'false');
    ib.setAttribute('aria-pressed',onlyIt?'true':'false');
    all.hidden=!picked.length;
    document.querySelectorAll(ITEMS).forEach(function(li){
      var srcs=(li.dataset.src||'').split(' ');
      li.hidden=!!((picked.length&&!srcs.some(function(x){return sel[x]}))||(onlyNew&&!li.hasAttribute('data-new'))||(onlyIt&&!li.hasAttribute('data-it')));
    });
    document.querySelectorAll('section.sec').forEach(function(sec){
      var show=!filtering||[].some.call(sec.querySelectorAll(ITEMS),vis);
      sec.hidden=!show;
      var a=document.querySelector('nav.toc a[href="#'+sec.id+'"]'); if(a)a.hidden=!show;
    });
    groups.forEach(function(g){
      var bs=g.querySelectorAll('button[data-tab]'), cur=tabs[g.dataset.group];
      if(!g.querySelector('button[data-tab="'+cur+'"]'))cur=bs[0].dataset.tab; // scheda salvata non più presente
      // con un filtro attivo, se la scheda aperta è rimasta vuota si mostra la prima che ha voci (senza cambiare quella ricordata)
      var has=function(id){return [].some.call(document.getElementById(id).querySelectorAll(ITEMS),vis)};
      if(filtering&&!has(cur)){var alt=[].filter.call(bs,function(b){return has(b.dataset.tab)})[0];if(alt)cur=alt.dataset.tab}
      bs.forEach(function(b){var on=b.dataset.tab===cur;b.setAttribute('aria-selected',on?'true':'false');document.getElementById(b.dataset.tab).hidden=!on});
    });
    limit();
    note.hidden=!filtering;
    if(filtering){
      var seen={}; // la stessa voce può comparire in più sezioni: si conta una volta
      document.querySelectorAll(ITEMS).forEach(function(li){if(!li.hidden)seen[li.dataset.u]=1});
      var what=(picked.length?picked.map(function(k){return sel[k]}).join(', '):'tutte le fonti')+(onlyNew?' · solo nuovi':'')+(onlyIt?' · solo Italia':'');
      note.textContent='Mostro '+what+': '+Object.keys(seen).length+' voci.'+(picked.length?' Tocca di nuovo una testata per toglierla, o «tutte le fonti».':'');
    }
    store(KEY,{sel:sel,onlyNew:onlyNew,onlyIt:onlyIt,tabs:tabs});
  }
  btns.forEach(function(b){b.addEventListener('click',function(){if(sel[b.dataset.src])delete sel[b.dataset.src];else sel[b.dataset.src]=b.textContent;apply()})});
  nb.addEventListener('click',function(){onlyNew=!onlyNew;apply()});
  ib.addEventListener('click',function(){onlyIt=!onlyIt;apply()});
  all.addEventListener('click',function(){sel={};apply()});
  groups.forEach(function(g){g.querySelectorAll('button[data-tab]').forEach(function(b){b.addEventListener('click',function(){tabs[g.dataset.group]=b.dataset.tab;apply()})})});
  document.querySelectorAll('.more').forEach(function(b){b.addEventListener('click',function(){var ul=b.previousElementSibling;ul.classList.toggle('open');limit();if(!ul.classList.contains('open'))ul.scrollIntoView({block:'nearest'})})});

  // ---- countdown "Date da segnare": ricalcolato sul giorno di chi guarda ----
  var today=new Date();today=Date.UTC(today.getFullYear(),today.getMonth(),today.getDate());
  document.querySelectorAll('.cdn').forEach(function(el){
    var d=Math.round((+el.dataset.when-today)/864e5);
    el.textContent=d<0?'già uscito':d===0?'oggi':d===1?'domani':'tra '+d+' giorni';
  });

  apply();

  // ---- indice fisso: evidenzia la sezione in vista e la tiene visibile nella barra ----
  var toc=document.querySelector('nav.toc'), links={};
  toc.querySelectorAll('a[href^="#"]:not(.top)').forEach(function(a){links[a.getAttribute('href').slice(1)]=a});
  function mark(id){
    for(var k in links)links[k].removeAttribute('aria-current');
    var a=links[id]; if(!a)return;
    a.setAttribute('aria-current','true');
    var l=a.offsetLeft-toc.offsetLeft, r=l+a.offsetWidth;
    if(l<toc.scrollLeft||r>toc.scrollLeft+toc.clientWidth)toc.scrollTo({left:Math.max(0,l-24)});
  }
  function onScroll(){
    var y=toc.getBoundingClientRect().bottom+24, cur='';
    document.querySelectorAll('section.sec').forEach(function(sec){if(!sec.hidden&&sec.getBoundingClientRect().top<=y)cur=sec.id});
    mark(cur);
  }
  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('hashchange',onScroll);
  onScroll();
})();
</script>
`;
}

const head = '<!doctype html>\n<html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n';
await writeFile(join(DIR, 'fuori-campo.html'), head + page(true).replace('</style>', '</style></head><body>') + '</body></html>\n');
await writeFile(join(DIR, 'artifact.html'), head + page(false).replace('</style>', '</style></head><body>') + '</body></html>\n');
const count = s => items.filter(i => i.section === s).length;
console.log(JSON.stringify({ archivio: kept.length, trailer: { cinema: tCinema.length, streaming: tStream.length, stampa: tPress.length }, date: { cinema: calCinema.length, streaming: calStream.length }, rumor: { video: rumorVideo.length, testo: rumorText.length }, tracker: TRACK.map(t => `${t.name}: ${t.ok.length} ok / ${t.rumor.length} rumor / ${t.altro.length} altro`), festival: festData.map(f => `${f.name}: ${f.list.length}`), alCinema: cinemaFilms.length + (alCinemaStale ? ' (elenco precedente)' : ''), uscite: count('uscite'), notizie: count('notizie'), recensioni: count('recensioni'), approfondimenti: count('approfondimenti'), ko: failed }, null, 1));
