// Bağlayıcılar (MCP), web araması ayrıştırma, Godot referans özeti ve alt ajan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpIstemci, baglayicilariYukle, aracAdi } from '../www/js/mcp.js';
import { bingAyristir, googleAyristir, godotXmlOzet } from '../www/js/tools.js';

const json = (j, h = {}) => new Response(JSON.stringify(j), { status: 200, headers: { 'content-type': 'application/json', ...h } });

test('MCP istemcisi: oturum başlığı, JSON ve SSE cevapları, hata sonucu', async () => {
  const gelen = [];
  globalThis.fetch = async (url, o) => {
    const b = JSON.parse(o.body);
    gelen.push({ method: b.method, oturum: o.headers['Mcp-Session-Id'], surum: o.headers['MCP-Protocol-Version'], auth: o.headers.CONTEXT7_API_KEY });
    if (b.method === 'initialize') return json({ jsonrpc: '2.0', id: b.id, result: { protocolVersion: '2025-03-26' } }, { 'mcp-session-id': 's1' });
    if (!b.id) return new Response(null, { status: 202 });
    if (b.method === 'tools/list') {
      return new Response(`data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: b.id, result: { tools: [{ name: 'query-docs', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] } })}\n\n`,
        { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }
    return json({ jsonrpc: '2.0', id: b.id, result: { isError: true, content: [{ type: 'text', text: 'kütüphane yok' }] } });
  };
  const { araclar, notlar } = await baglayicilariYukle(
    [{ ad: 'context7', url: 'https://x/mcp', anahtarOrtam: 'CONTEXT7_ANAHTAR', anahtarBaslik: 'CONTEXT7_API_KEY' }, { ad: 'kapali', url: 'https://y', acik: false }],
    { ortam: { CONTEXT7_ANAHTAR: 'gizli' } },
  );
  assert.deepEqual(notlar, ['context7: 1 araç']);
  assert.equal(araclar[0].tanim.function.name, 'mcp_context7_query-docs');
  assert.equal(araclar[0].okuma, true);
  assert.equal(await araclar[0].calistir({ q: 1 }), 'HATA: kütüphane yok');
  assert.deepEqual(gelen.map((g) => g.method), ['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
  assert.equal(gelen[0].oturum, undefined);
  assert.ok(gelen.slice(1).every((g) => g.oturum === 's1' && g.surum === '2025-03-26' && g.auth === 'gizli'));
});

test('MCP: bağlanamayan sunucu görevi bozmaz, not düşer', async () => {
  globalThis.fetch = async () => new Response('kapalı', { status: 503 });
  const { araclar, notlar } = await baglayicilariYukle([{ ad: 'deepwiki', url: 'https://z/mcp' }]);
  assert.equal(araclar.length, 0);
  assert.match(notlar[0], /deepwiki: bağlanamadı \(.*503/);
  await assert.rejects(new McpIstemci({ ad: 'a', url: 'https://z' }).baslat(), /503/);
  assert.equal(aracAdi('ç ok', 'a.b'), 'mcp___ok_a_b');
});

test('Bing sonuçları ayrıştırılır, yönlendirme linki çözülür', () => {
  const u = Buffer.from('https://docs.godotengine.org/en/4.3/').toString('base64url');
  const html = `<li class="b_algo" data-id><div class="b_tpcn"><a class="tilk" href="https://www.bing.com/ck/a?x">site</a></div>` +
    `<h2><a target="_blank" href="https://www.bing.com/ck/a?!&amp;&amp;p=1&amp;u=a1${u}&amp;ntb=1">Godot <strong>Docs</strong></a></h2>` +
    `<div class="b_caption"><p class="b_lineclamp2">Official &amp; free</p></div></li>` +
    `<li class="b_algo"><h2><a href="https://example.com/a">Düz</a></h2></li>`;
  assert.deepEqual(bingAyristir(html), [
    { baslik: 'Godot Docs', url: 'https://docs.godotengine.org/en/4.3/', ozet: 'Official & free' },
    { baslik: 'Düz', url: 'https://example.com/a', ozet: '' },
  ]);
});

test('Google sonuçları ayrıştırılır: /url?q= ve h3 kalıbı, reklam ve tekrar elenir', () => {
  const html = `<div class="g"><a href="/url?q=https://tr.wikipedia.org/wiki/Candy_Crush_Saga&amp;sa=U&amp;ved=x">` +
    `<h3>Candy Crush Saga - Vikipedi</h3></a></div>` +
    `<div class="g"><a href="https://www.king.com/games/candy-crush/"><h3>Candy Crush - King</h3></a></div>` +
    `<div class="g"><a href="https://www.king.com/games/candy-crush/"><h3>Candy Crush - King (tekrar)</h3></a></div>` +
    `<div class="g"><a href="https://www.google.com/url?q=https://ads.example.com"><h3>Reklam</h3></a></div>` +
    `<div class="g"><a href="https://example.com/duz">Başlıksız bağlantı</a></div>`;
  assert.deepEqual(googleAyristir(html), [
    { baslik: 'Candy Crush Saga - Vikipedi', url: 'https://tr.wikipedia.org/wiki/Candy_Crush_Saga', ozet: '' },
    { baslik: 'Candy Crush - King', url: 'https://www.king.com/games/candy-crush/', ozet: '' },
  ]);
});

test('Godot XML referansı imzalarla özetlenir', () => {
  const xml = `<class name="CharacterBody2D" inherits="PhysicsBody2D">
  <brief_description>A 2D physics body specialized for characters moved by script.</brief_description>
  <methods><method name="move_and_slide"><return type="bool" /><description>Moves the body based on [member velocity]. More text.</description></method>
  <method name="get_floor_normal" qualifiers="const"><return type="Vector2" /><param index="0" name="x" type="int" default="0" /><description>Returns normal.</description></method></methods>
  <members><member name="velocity" type="Vector2" setter="set_velocity" default="Vector2(0, 0)">Current velocity vector.</member></members>
  <signals></signals><constants><constant name="MOTION_MODE_GROUNDED" value="0" enum="MotionMode"></constant></constants></class>`;
  const o = godotXmlOzet(xml, 'CharacterBody2D', '4.3');
  assert.match(o, /miras: PhysicsBody2D/);
  assert.match(o, /- bool move_and_slide\(\) — Moves the body based on velocity\./);
  assert.match(o, /- Vector2 get_floor_normal\(x: int = 0\) const/);
  assert.match(o, /- Vector2 velocity = Vector2\(0, 0\)/);
  assert.match(o, /MotionMode\.MOTION_MODE_GROUNDED/);
  assert.match(o, /class_characterbody2d\.html/);
});

test('alt ajan ayrı bağlamda yalnızca okuma araçlarıyla çalışır, ana bağlama özet döner', async () => {
  const istekler = [];
  const cagri = (ad, arg) => ({ id: ad, type: 'function', function: { name: ad, arguments: JSON.stringify(arg) } });
  const senaryo = [
    [cagri('alt_ajan', { gorev: 'velocity nasıl kullanılır bul' })], // ana
    [cagri('mcp_context7_query-docs', { q: 'velocity' })], // alt
    'velocity Vector2; move_and_slide() ile kullanılır.', // alt özet
    'Rapor: hazır.', // ana
  ];
  let i = 0;
  globalThis.fetch = async (url, o) => {
    const b = JSON.parse(o.body);
    istekler.push(b);
    const s = senaryo[i++] ?? 'bitti';
    const message = typeof s === 'string' ? { content: s } : { content: null, tool_calls: s };
    return json({ choices: [{ message }] });
  };
  const { gorevCalistir } = await import('../www/js/agent.js');
  const cagrilanlar = [];
  const sonuc = await gorevCalistir({
    ayar: { anahtar: { evren: 'k' }, model: { evren: 'deepseek-v4.1-flash' }, sira: ['evren'], roller: {}, planla: false, gozdenGecir: false },
    gh: { dosyaOku: async () => { throw Object.assign(new Error('yok'), { status: 404 }); } },
    hafiza: { repo: 'h', stil: async () => '', secilmisDersler: async () => ({ genel: '', repo: '', toplam: 0 }) },
    aktifRepo: 'malisah61/oyun', gecmis: [], istek: 'araştır',
    ekAraclar: [{
      tanim: { type: 'function', function: { name: 'mcp_context7_query-docs', description: 'd', parameters: { type: 'object', properties: {} } } },
      okuma: true, calistir: async (a) => { cagrilanlar.push(a); return 'velocity: Vector2'; },
    }],
    ui: { durum: () => {}, plan: () => {}, durdurulduMu: () => false, arac: () => {}, onayla: async () => true },
  });
  assert.equal(sonuc.cevap, 'Rapor: hazır.');
  assert.deepEqual(cagrilanlar, [{ q: 'velocity' }]);
  const alt = istekler[1];
  assert.match(alt.messages[0].content, /alt ajan/);
  const altAraclar = alt.tools.map((t) => t.function.name);
  assert.ok(altAraclar.includes('mcp_context7_query-docs') && altAraclar.includes('web_ara'));
  assert.ok(!altAraclar.includes('alt_ajan') && !altAraclar.includes('dosya_yaz') && !altAraclar.includes('dali_birlestir'), 'alt ajan yazamaz / alt ajan açamaz');
  const anaSon = istekler[3].messages;
  assert.equal(anaSon.at(-1).content, 'velocity Vector2; move_and_slide() ile kullanılır.');
  assert.ok(!anaSon.some((m) => m.content === 'velocity: Vector2'), 'alt ajanın ham araç çıktısı ana bağlama girmemeli');
});
