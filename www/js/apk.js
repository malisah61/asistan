// HTML/JS oyun ve uygulamalardan Android APK: Asistan hedef repoya bu workflow'u kurar,
// derleme bitince indirme linkini kullanıcıya verir.

export const APK_WORKFLOW_YOLU = '.github/workflows/asistan-apk.yml';
// Asistan'ın kendi (herkese açık) imza anahtarı: aynı uygulamanın yeni sürümü eskisinin üstüne kurulabilsin
const ANAHTAR_URL = 'https://raw.githubusercontent.com/malisah61/asistan/main/keystore/debug.keystore';

/** Dal adından release etiketi: varsayılan dal "son", diğerleri "apk-<dal>". */
export function apkEtiketi(dal, varsayilan) {
  return !dal || dal === varsayilan ? 'son' : 'apk-' + dal.replace(/[^\w.-]+/g, '-').slice(0, 60);
}

/** Paket adı: com.asistan.<repo> (Android yalnızca harf, rakam, alt çizgi kabul eder) */
export function paketAdi(repo) {
  const ad = repo.split('/')[1].toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^(\d)/, '_$1');
  return `com.asistan.${ad || 'uygulama'}`;
}

export function apkWorkflow({ repo, webKlasoru, uygulamaAdi, varsayilanDal }) {
  const kaynak = webKlasoru && webKlasoru !== '.' ? webKlasoru.replace(/\/+$/, '') : '.';
  return `name: APK (Asistan)

# Asistan'ın kurduğu Android derlemesi: ${kaynak === '.' ? 'repo kökü' : kaynak + '/'} Capacitor ile APK yapılır.
# ${varsayilanDal} → "son" sürümü, diğer dallar → "apk-<dal>" ön sürümü (Releases sayfasında).
on:
  push:
    paths-ignore: ['**.md']
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: apk-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  apk:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - uses: actions/setup-java@v4
        with:
          distribution: temurin
          java-version: 21

      - name: Capacitor projesi (repoya dokunmadan ayrı klasörde)
        run: |
          mkdir -p _apk/www
          rsync -a --exclude '.git' --exclude '.github' --exclude '_apk' --exclude 'node_modules' "${kaynak}/" _apk/www/
          test -f _apk/www/index.html || { echo "::error::${kaynak}/index.html yok; web klasörü yanlış"; exit 1; }
          cd _apk
          cat > package.json <<'JSON'
          {"name":"apk","private":true,"dependencies":{"@capacitor/android":"^7.0.0","@capacitor/core":"^7.0.0","@capacitor/cli":"^7.0.0"}}
          JSON
          cat > capacitor.config.json <<'JSON'
          {"appId":"${paketAdi(repo)}","appName":${JSON.stringify(uygulamaAdi)},"webDir":"www"}
          JSON
          npm install --no-audit --no-fund
          npx cap add android
          npx cap sync android

      - name: Sabit imza anahtarı (güncellemeler üstüne kurulsun)
        run: |
          mkdir -p ~/.android
          curl -fsSL ${ANAHTAR_URL} -o ~/.android/debug.keystore

      - name: APK derle
        run: |
          cd _apk/android
          chmod +x gradlew
          ./gradlew assembleDebug --no-daemon -q
          cp app/build/outputs/apk/debug/app-debug.apk "\$GITHUB_WORKSPACE/\${{ github.event.repository.name }}.apk"

      - uses: actions/upload-artifact@v4
        with:
          name: apk
          path: \${{ github.event.repository.name }}.apk

      - name: Releases sayfasına koy
        env:
          GH_TOKEN: \${{ github.token }}
          DAL: \${{ github.ref_name }}
        run: |
          if [ "\$DAL" = "${varsayilanDal}" ]; then ETIKET=son; ON=""; else ETIKET="apk-\$(echo "\$DAL" | sed -E 's/[^A-Za-z0-9._-]+/-/g' | cut -c1-60)"; ON="--prerelease"; fi
          gh release delete "\$ETIKET" --yes --cleanup-tag || true
          # GitHub release API'si ara sıra 5xx veriyor: birkaç kez dene; olmazsa APK yine bu çalışmanın Artifacts bölümünde
          for i in 1 2 3 4; do
            gh release create "\$ETIKET" "\${{ github.event.repository.name }}.apk" --target "\$GITHUB_SHA" \$ON \\
              --title "\${{ github.event.repository.name }} (\$DAL)" \\
              --notes "Commit: \${GITHUB_SHA::7}. Telefondan bu sayfadaki .apk dosyasını indirip kur." && exit 0
            sleep \$((i * 15))
          done
          echo "::warning::Release oluşturulamadı; APK bu çalışmanın Artifacts bölümünde."
`;
}
