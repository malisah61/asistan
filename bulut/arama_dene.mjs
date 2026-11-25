const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const r = await fetch('https://www.bing.com/search?q=' + encodeURIComponent('godot 4 CharacterBody2D move_and_slide') + '&setlang=en', { headers: { 'User-Agent': UA, 'Accept-Language': 'en' } });
const t = await r.text();
const i = t.indexOf('class="b_algo"');
console.log('ALGO_SAYI', (t.match(/class="b_algo"/g) || []).length);
console.log('ORNEK1', t.slice(i, i + 2500).replace(/\s+/g, ' '));
const j = t.indexOf('class="b_algo"', i + 10);
console.log('ORNEK2', t.slice(j, j + 1500).replace(/\s+/g, ' '));
