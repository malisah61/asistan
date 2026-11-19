// Kaliteyi artıran yardımcılar: sözdizimi kontrolü, diff, repo haritası, kontrol workflow şablonu

// ---------- Commit öncesi telefonda sözdizimi kontrolü ----------
export function sozdizimKontrol(yol, icerik) {
  const uzanti = yol.split('.').pop().toLowerCase();
  try {
    if (uzanti === 'json') {
      JSON.parse(icerik);
    } else if (['js', 'mjs', 'cjs'].includes(uzanti)) {
      // new Function import/export kabul etmez; o satırları etkisiz hale getirip gövdeyi denetle
      const govde = icerik
        .replace(/^\s*import\s+(?:[\w$*{}\s,]+?\s+from\s+)?['"][^'"\n]+['"]\s*;?/gm, '')
        .replace(/^\s*import\s*\([^)]*\)/gm, 'null')
        .replace(/^\s*export\s+default\s+/gm, 'const __varsayilan = ')
        .replace(/^\s*export\s*\{[^}]*\}\s*(from\s*['"][^'"]+['"])?;?/gm, '')
        .replace(/^\s*export\s+(?=(async\s+)?(function|class|const|let|var)\b)/gm, '');
      // top-level await için async sarmala
      new Function(`return (async () => {\n${govde}\n});`);
    }
    return null;
  } catch (e) {
    return `${yol}: ${e.message}`;
  }
}

// ---------- Basit satır diff'i (gözden geçirme ve onay için) ----------
export function diffUret(eski, yeni, cevre = 3) {
  const a = (eski || '').split('\n');
  const b = (yeni || '').split('\n');
  let bas = 0;
  while (bas < a.length && bas < b.length && a[bas] === b[bas]) bas++;
  let sa = a.length - 1, sb = b.length - 1;
  while (sa >= bas && sb >= bas && a[sa] === b[sb]) { sa--; sb--; }
  if (bas > sa && bas > sb) return '(değişiklik yok)';
  const satirlar = [`@@ satır ${bas + 1} @@`];
  for (let i = Math.max(0, bas - cevre); i < bas; i++) satirlar.push('  ' + a[i]);
  for (let i = bas; i <= sa; i++) satirlar.push('- ' + a[i]);
  for (let i = bas; i <= sb; i++) satirlar.push('+ ' + b[i]);
  for (let i = sa + 1; i < Math.min(a.length, sa + 1 + cevre); i++) satirlar.push('  ' + a[i]);
  const metin = satirlar.join('\n');
  return metin.length > 12000 ? metin.slice(0, 12000) + '\n…(diff kesildi)' : metin;
}

// ---------- Repo haritası: dosyalar + içlerindeki tanımlar ----------
const KOD = /\.(js|mjs|ts|tsx|jsx|cs|gd|py|java|kt|go|rs|c|cpp|h|hpp|swift|dart|lua)$/i;
const ATLA = /(^|\/)(node_modules|dist|build|vendor|\.godot|\.import|android|ios|bin|obj|addons|lib)\//;
const TANIM = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/,
  /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*=>/,
  /^\s*(?:static\s+)?func\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/, // GDScript
  /^\s*class_name\s+(\w+)/, // GDScript
  /^\s*signal\s+(\w+)/, // GDScript
  /^\s*(?:public|private|protected|internal)[\w\s<>,\[\]?]*?\s(?:class|struct|interface|enum)\s+(\w+)/, // C#
  /^\s*(?:public|private|protected|internal)\s+(?:static\s+|override\s+|virtual\s+|async\s+|partial\s+)*[\w<>,\[\]?.]+\s+(\w+)\s*\(([^)]*)\)/, // C# metot
  /^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/, // Python
  /^\s*class\s+(\w+)\s*[(:]/, // Python
];

const haritaOnbellek = new Map(); // repo@sha -> metin

export async function repoHaritasi(gh, repo, dal, { maksDosya = 45, durum = () => {} } = {}) {
  const sha = await gh.dalSonCommit(repo, dal).catch(() => dal || 'varsayilan');
  const anahtar = `${repo}@${sha}`;
  if (haritaOnbellek.has(anahtar)) return haritaOnbellek.get(anahtar);

  const tum = await gh.agac(repo, sha);
  const kodlar = tum.filter((y) => KOD.test(y) && !ATLA.test(y));
  // Kök dizine yakın ve kısa yollar genelde daha önemli
  const secilen = [...kodlar].sort((x, y) => x.split('/').length - y.split('/').length).slice(0, maksDosya);

  const tanimlar = {};
  let i = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (i < secilen.length) {
      const yol = secilen[i++];
      durum(`Repo haritası çıkarılıyor… (${i}/${secilen.length})`);
      try {
        const { icerik } = await gh.dosyaOku(repo, yol, sha);
        if (!icerik || icerik.length > 200_000) continue;
        const bulunan = [];
        icerik.split('\n').forEach((satir, n) => {
          for (const re of TANIM) {
            const m = satir.match(re);
            if (m && !/^(if|for|while|switch|catch|return|new)$/.test(m[1])) {
              bulunan.push(`${n + 1}: ${m[1]}${m[2] !== undefined ? `(${m[2].trim().slice(0, 60)})` : ''}`);
              break;
            }
          }
        });
        tanimlar[yol] = bulunan.slice(0, 40);
      } catch { /* okunamayan dosya haritayı bozmasın */ }
    }
  }));

  const satirlar = [`# ${repo} haritası (${tum.length} dosya)`];
  const digerleri = tum.filter((y) => !tanimlar[y] && !ATLA.test(y));
  for (const yol of secilen) {
    satirlar.push(yol);
    for (const t of tanimlar[yol] || []) satirlar.push('    ' + t);
  }
  if (digerleri.length) {
    satirlar.push('', '## Diğer dosyalar');
    satirlar.push(...digerleri.slice(0, 150));
    if (digerleri.length > 150) satirlar.push(`…ve ${digerleri.length - 150} dosya daha`);
  }
  if (kodlar.length > secilen.length) satirlar.push(`(${kodlar.length - secilen.length} kod dosyasının tanımları çıkarılmadı; gerekirse oku)`);
  const metin = satirlar.join('\n').slice(0, 20000);
  haritaOnbellek.set(anahtar, metin);
  return metin;
}

// ---------- Her repoya eklenebilen evrensel kontrol workflow'u ----------
export const KONTROL_YML = `name: kontrol

# Asistan'ın geri bildirim döngüsü: her asistan/** dalı push'unda ve PR'da hızlı kontroller.
on:
  push:
    branches: ['asistan/**']
  pull_request:
  workflow_dispatch:

jobs:
  kontrol:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: JavaScript sözdizimi
        run: |
          files=$(git ls-files '*.js' '*.mjs' '*.cjs' | grep -v -E '(^|/)(node_modules|dist|build|vendor|lib)/|\\.min\\.js$' || true)
          fail=0
          for f in $files; do node --check "$f" || { echo "::error file=$f::JS sözdizimi hatası"; fail=1; }; done
          exit $fail

      - name: JSON geçerliliği
        run: |
          fail=0
          for f in $(git ls-files '*.json' | grep -v node_modules || true); do
            python3 -m json.tool "$f" > /dev/null || { echo "::error file=$f::Geçersiz JSON"; fail=1; }
          done
          exit $fail

      - name: Python sözdizimi
        run: |
          files=$(git ls-files '*.py' || true)
          [ -z "$files" ] || python3 -m py_compile $files

      - name: GDScript sözdizimi
        run: |
          files=$(git ls-files '*.gd' | grep -v -E '(^|/)addons/' || true)
          [ -z "$files" ] && exit 0
          pip install --quiet "gdtoolkit==4.*"
          fail=0
          for f in $files; do gdparse "$f" > /dev/null || { echo "::error file=$f::GDScript sözdizimi hatası"; fail=1; }; done
          exit $fail

      - uses: actions/setup-dotnet@v4
        if: hashFiles('**/*.csproj') != ''
        with:
          dotnet-version: 8.0.x

      - name: C# derleme
        run: |
          proj=$(git ls-files '*.csproj' | head -1)
          [ -z "$proj" ] && exit 0
          dotnet build "$proj" -nologo -v q

      - name: npm testleri
        run: |
          [ -f package.json ] && grep -q '"test"' package.json || exit 0
          npm install --no-audit --no-fund
          npm test
`;
