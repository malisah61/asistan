// Testler için sahte GitHub + EVREN. Durum bir JSON dosyasında tutulur ki alt süreçler (bulut/calistir.mjs) de paylaşsın.
// Kullanım: SAHTE_DURUM=/tmp/x.json node --import ./test/yardimci/sahte.mjs bulut/calistir.mjs
import fs from 'node:fs';

const DOSYA = process.env.SAHTE_DURUM;
const yukle = () => JSON.parse(fs.readFileSync(DOSYA, 'utf8'));
const kaydet = (s) => fs.writeFileSync(DOSYA, JSON.stringify(s));
const yanit = (st, j) => (st === 204 ? new Response(null, { status: 204 }) : new Response(typeof j === 'string' ? j : JSON.stringify(j), { status: st, headers: { 'content-type': 'application/json' } }));
let sha = 0;

export function sahteDurum(ek = {}) {
  return { repos: { 'malisah61/asistan': {}, 'malisah61/oyun': {} }, log: [], dispatch: [], terms: false, ...ek };
}

if (DOSYA) {
  globalThis.fetch = async (url, o = {}) => {
    url = String(url);
    const m = o.method || 'GET';
    const b = o.body ? JSON.parse(o.body) : null;
    const s = yukle();
    s.log.push(`${m} ${url.replace(/^https:\/\/[^/]+/, '')}`.slice(0, 140));
    try {
      if (url.includes('evren-llmapi')) {
        if (url.endsWith('/terms/accept')) { s.terms = true; return yanit(200, {}); }
        if (!s.terms) return yanit(403, { error: { code: 'terms_not_accepted', message: 'Şartları kabul et' } });
        if (url.endsWith('/models')) return yanit(200, { data: [{ id: 'deepseek-v4.1-flash' }, { id: 'glm-5.3' }] });
        const sys = b.messages[0].content;
        if (sys.includes('Kıdemli')) return yanit(200, { choices: [{ message: { content: '{"basit":true}' } }] });
        if (sys.includes('değerlendiriyorsun')) return yanit(200, { choices: [{ message: { content: '{"ders":null}' } }] });
        if (!b.messages.some((x) => x.role === 'tool')) {
          return yanit(200, { choices: [{ message: { content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'repolari_listele', arguments: '{}' } }] } }] });
        }
        return yanit(200, { choices: [{ message: { content: 'İş tamam.' } }] });
      }
      const p = new URL(url).pathname;
      let r;
      if (p === '/user') return yanit(200, { login: 'malisah61' });
      if (p.startsWith('/user/repos') && m === 'GET') return yanit(200, []);
      if (p === '/user/repos' && m === 'POST') { s.repos['malisah61/' + b.name] = {}; return yanit(201, {}); }
      if ((r = p.match(/^\/repos\/([^/]+\/[^/]+)$/))) return s.repos[r[1]] ? yanit(200, { private: true, default_branch: 'main' }) : yanit(404, 'yok');
      if ((r = p.match(/^\/repos\/([^/]+\/[^/]+)\/contents\/(.+)$/))) {
        const repo = s.repos[r[1]];
        const yol = decodeURI(r[2]);
        if (!repo) return yanit(404, 'repo yok');
        if (m === 'GET') return repo[yol] ? yanit(200, { sha: repo[yol].sha, content: Buffer.from(repo[yol].c).toString('base64') }) : yanit(404, 'yok');
        if (m === 'PUT') {
          if (repo[yol] && b.sha !== repo[yol].sha) return yanit(409, 'sha');
          repo[yol] = { c: Buffer.from(b.content, 'base64').toString(), sha: 'x' + (++sha) + Date.now() };
          return yanit(200, { commit: { sha: 'c' + sha, html_url: 'https://commit' } });
        }
        if (m === 'DELETE') { delete repo[yol]; return yanit(200, {}); }
      }
      if (p.includes('/dispatches')) { s.dispatch.push(b); return yanit(204); }
      if (p.includes('/actions/workflows/') && p.endsWith('/runs')) return yanit(200, { workflow_runs: [{ created_at: new Date().toISOString() }] });
      return yanit(404, 'sahte: ' + p);
    } finally {
      kaydet(s);
    }
  };
}
