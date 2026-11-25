const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const q = encodeURIComponent('godot 4 CharacterBody2D move_and_slide');
const adaylar = {
  ddgHtmlPost: ['https://html.duckduckgo.com/html/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body: 'q=' + q }],
  ddgHtmlGet: ['https://html.duckduckgo.com/html/?q=' + q, { headers: { 'User-Agent': UA } }],
  ddgLite: ['https://lite.duckduckgo.com/lite/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA }, body: 'q=' + q }],
  mojeek: ['https://www.mojeek.com/search?q=' + q, { headers: { 'User-Agent': UA } }],
  bing: ['https://www.bing.com/search?q=' + q + '&setlang=en', { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } }],
  jinaS: ['https://s.jina.ai/?q=' + q, { headers: { Accept: 'application/json' } }],
  searx: ['https://searx.be/search?format=json&q=' + q, { headers: { 'User-Agent': UA } }],
  wiby: ['https://wiby.me/json/?q=' + q, {}],
  marginalia: ['https://api.marginalia.nu/public/search/' + q + '?count=5', {}],
  stract: ['https://stract.com/beta/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'godot 4 CharacterBody2D move_and_slide' }) }],
};
for (const [ad, [u, o]] of Object.entries(adaylar)) {
  try {
    const r = await fetch(u, { ...o, signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    console.log(`${ad}: ${r.status} ${t.length}b godot=${(t.match(/godot/gi) || []).length} result__a=${t.includes('result__a')} result-link=${t.includes('result-link')} ${t.slice(0, 150).replace(/\s+/g, ' ')}`);
    if (ad === 'mojeek' || ad === 'bing' || ad === 'ddgLite') console.log('   ÖRNEK: ' + (t.match(/<a [^>]*(class="(ob|title|result-link)"|<h2)[^>]*>[\s\S]{0,300}/) || [''])[0].replace(/\s+/g, ' ').slice(0, 400));
  } catch (e) { console.log(`${ad}: HATA ${e.message}`); }
}
