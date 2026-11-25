// Tanı: bağlayıcılar, internet araması ve Godot referansı gerçekten çalışıyor mu? (baglanti.yml çalıştırır)
// Çıktıda kullanıcı içeriği yok; yalnızca sabit deneme sorguları.
import { VARSAYILAN_BAGLAYICILAR, baglayicilariYukle } from '../www/js/mcp.js';
import { calistir } from '../www/js/tools.js';

const sonuclar = [];
const dene = async (ad, fn, kontrol) => {
  const t = Date.now();
  try {
    const s = String(await fn());
    const ok = kontrol(s);
    sonuclar.push(ok);
    console.log(`${ok ? '✅' : '❌'} ${ad} (${Date.now() - t} ms)\n   ${s.slice(0, 300).replace(/\n/g, '\n   ')}`);
  } catch (e) {
    sonuclar.push(false);
    console.log(`❌ ${ad}: ${e.message}`);
  }
};

const ctx = { gorev: {} };
await dene('godot_sinif CharacterBody2D', () => calistir('godot_sinif', { sinif: 'CharacterBody2D' }, ctx), (s) => s.includes('move_and_slide'));
await dene('web_ara', () => calistir('web_ara', { sorgu: 'godot 4 CharacterBody2D move_and_slide' }, ctx), (s) => /^1\. /.test(s));
await dene('web_oku', () => calistir('web_oku', { url: 'https://docs.godotengine.org/en/4.3/tutorials/physics/using_character_body_2d.html' }, ctx), (s) => /CharacterBody2D/i.test(s));

const { araclar, notlar } = await baglayicilariYukle(VARSAYILAN_BAGLAYICILAR, { ortam: process.env });
console.log('Bağlayıcılar: ' + notlar.join(' · '));
console.log('Araçlar: ' + araclar.map((a) => a.tanim.function.name).join(', '));
for (const b of VARSAYILAN_BAGLAYICILAR) sonuclar.push(araclar.some((a) => a.tanim.function.name.startsWith(`mcp_${b.ad}_`)));
const c7 = araclar.find((a) => /resolve/.test(a.tanim.function.name));
if (c7) await dene('context7 resolve-library-id', () => c7.calistir({ libraryName: 'godot', query: 'CharacterBody2D movement' }), (s) => !s.startsWith('HATA') && /godot/i.test(s));
const dw = araclar.find((a) => /read_wiki_structure/.test(a.tanim.function.name));
if (dw) await dene('deepwiki read_wiki_structure', () => dw.calistir({ repoName: 'godotengine/godot' }), (s) => !s.startsWith('HATA'));

const basarili = sonuclar.filter(Boolean).length;
console.log(`\n${basarili}/${sonuclar.length} başarılı`);
process.exit(basarili === sonuclar.length ? 0 : 1);
