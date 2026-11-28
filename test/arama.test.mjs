// Arama ayrıştırıcıları: DuckDuckGo html/lite düzenleri, yönlendirme linki çözme, reklam/tekrar eleme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ddgAyristir } from '../www/js/tools.js';

test('ddgAyristir: html düzeni, uddg yönlendirmesi çözülür, reklam ve tekrar elenir', () => {
  const html = `
    <div class="result results_links">
      <h2 class="result__title">
        <a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FCandy_Crush_Saga&amp;rut=abc">Candy Crush <b>Saga</b></a>
      </h2>
      <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FCandy_Crush_Saga">Match-three puzzle game</a>
    </div>
    <div class="result results_links">
      <a class="result__a" href="https://example.com/oyun">Oyun tasarımı</a>
    </div>
    <div class="result results_links">
      <a class="result__a" href="https://example.com/oyun">Oyun tasarımı (tekrar)</a>
    </div>
    <div class="result results_links">
      <a class="result__a" href="https://duckduckgo.com/y.js?ad=1">Reklam</a>
    </div>`;
  const s = ddgAyristir(html);
  assert.deepEqual(s.map((x) => x.url), ['https://en.wikipedia.org/wiki/Candy_Crush_Saga', 'https://example.com/oyun']);
  assert.equal(s[0].baslik, 'Candy Crush Saga');
  assert.equal(s[0].ozet, 'Match-three puzzle game');
});

test('ddgAyristir: lite düzeni (result-link) ayrıştırılır', () => {
  const html = `
    <a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FMatch-three_video_game" class='result-link'>Match-three video game</a>
    <td class='result-snippet'>Tür oyunu</td>
    <a rel="nofollow" href="https://gamedeveloper.com/x" class='result-link'>Level design</a>`;
  const s = ddgAyristir(html);
  assert.deepEqual(s.map((x) => x.url), ['https://en.wikipedia.org/wiki/Match-three_video_game', 'https://gamedeveloper.com/x']);
  assert.equal(s[0].baslik, 'Match-three video game');
});

test('ddgAyristir: sonuç yoksa boş dizi (CAPTCHA/consent sayfası)', () => {
  assert.deepEqual(ddgAyristir('<html><body>Unfortunately, bots use DuckDuckGo too.</body></html>'), []);
});
