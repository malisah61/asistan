# Asistan

Telefonda çalışan bir kodlama asistanı. GitHub repolarını okuyup yazabiliyor, dal ve PR açabiliyor, Actions build'lerini kontrol edebiliyor. Her işten sonra kendine ders çıkarıyor.

- **Beyin:** **EVREN** (SSB'nin yapay zeka platformu; `deepseek-v4.1-flash`, hata verirse yedeği `glm-5.3`).
- **Stil:** `AGENTS.md`. Asistan her görevde bunu okuyor, değiştirmek için yeni APK gerekmiyor.
- **Gücü artıran düzen:**
  1. *Geri bildirim döngüsü:* her commit'ten sonra Actions'ı bekler (`kontrol.yml` yoksa kendisi ekler), hata varsa logu okuyup en fazla 3 kez düzeltir.
  2. *Planlayıcı / uygulayıcı:* güçlü model plan çıkarır ve takılınca danışılır, hızlı model uygular.
  3. *Gözden geçirme:* her commit'i önce başka bir model inceler.
  4. *Akıllı bağlam:* repo haritası (dosyalar ve fonksiyonlar), satır aralığıyla okuma, uzun görevlerde eski adımları sıkıştırma.
  5. *Plan listesi:* yapılacaklar ekranın üstünde görünür, model tek maddeye odaklanır.
  6. *Sağlam araç kullanımı:* bozuk JSON onarımı, metne yazılmış araç çağrılarını yakalama, commit öncesi JS/JSON sözdizimi kontrolü, tekrar eden hatayı algılama.
  7. *Akıllı dersler:* etiketli dersler; her görevde yalnızca ilgili olanlar seçilir; repoya özel dersler `hafiza/repolar/` altında tutulur.
  8. *Claude'a devretme:* çözemediği iş `claude` etiketli issue olur, gece çalışan Claude görevi çözüp PR açar.
- **Hafıza:** `hafiza/dersler.md`. Asistan buraya kendi derslerini yazıyor. Uygulamadaki 📚 düğmesinden görüp düzenleyebilirsin.

## Kurulum (telefondan)

### 1. APK'yı indir
Repo → **Releases** → **Asistan (son sürüm)** → `Asistan.apk`. İndirip kur ("bilinmeyen kaynaklara izin ver" diye sorabilir).
Kodda her değişiklik olduğunda GitHub Actions yeni APK'yı aynı yere koyar. Yeni sürüm eskisinin üstüne kurulur, ayarların kaybolmaz.

### 2. GitHub token
github.com → Settings → Developer settings → **Personal access tokens → Fine-grained tokens** → Generate new token
- Repository access: **All repositories**
- Permissions: **Contents: Read and write**, **Pull requests: Read and write**, **Actions: Read and write**, **Workflows: Read and write**, **Metadata: Read**

### 3. Model anahtarı
| Sağlayıcı | Nereden | Not |
|---|---|---|
| EVREN | SSB'den aldığın anahtar | Ücretsiz dönem 1 Aralık 2026'da bitiyor. İlk istekte kullanım şartlarını onaylaman istenir (tek seferlik) |

Uygulamada ⚙ Ayarlar'a EVREN anahtarını gir. **Modelleri getir** düğmesi güncel model listesini çeker.

### 4. Kullan
Üstten bir repo seç ve isteğini yaz: *"zombi-savunma reposunda dalga sayısını ekranda göster"*.
"Yazmadan önce onay iste" açıksa asistan her commit'ten önce sana sorar.

## Geliştirme
- Kod `www/` altında: `llm.js` (modeller), `github.js` (GitHub API), `tools.js` (araçlar), `agent.js` (ajan döngüsü ve hafıza), `app.js` (arayüz).
- `main` dalına her push'ta `.github/workflows/apk.yml` APK'yı derler. `hafiza/`, `AGENTS.md` ve `README.md` değişiklikleri build başlatmaz.
- `keystore/debug.keystore` güncellemelerin eskisinin üstüne kurulabilmesi için sabit tutuluyor. Repoyu public yaparsan bu anahtarı değiştir.
