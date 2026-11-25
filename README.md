# Asistan

Telefondan ve webden kullanılan bir kodlama asistanı. GitHub repolarını okuyup yazabiliyor, dal ve PR açabiliyor, Actions build'lerini kontrol edebiliyor. Her işten sonra kendine ders çıkarıyor.

- **Bulutta çalışır:** Görevler GitHub Actions'ta (`gorev.yml` → `bulut/calistir.mjs`) çalışır. Uygulamayı ya da sekmeyi kapatsan da iş sürer; açınca kaldığı yerden görürsün.
- **Sohbetler:** ☰ menüsünde. Her sohbet ayrı kayıt, kendi reposu var. Telefon ve web aynı sohbetleri görür.
- **Gece görevleri:** 🌙 menüsünde. Her gün seçtiğin saatte (Türkiye saati) bulutta çalışır, sonucu "🌙" sohbeti olarak bırakır.
- **Web:** https://malisah61.github.io/asistan/ (`pages.yml`, `www/` klasörü).
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
- **Gizli hafıza:** Sohbetler, dersler, gece görevleri ve ayarlar **gizli** `asistan-hafiza` reposunda durur (bu repo herkese açık). Dersleri 📚 düğmesinden görüp düzenleyebilirsin.

## Kurulum (telefondan)

### 1. APK'yı indir
Repo → **Releases** → **Asistan (son sürüm)** → `Asistan.apk`. İndirip kur ("bilinmeyen kaynaklara izin ver" diye sorabilir).
Kodda her değişiklik olduğunda GitHub Actions yeni APK'yı aynı yere koyar. Yeni sürüm eskisinin üstüne kurulur, ayarların kaybolmaz.

### 2. GitHub token
github.com → Settings → Developer settings → **Personal access tokens → Fine-grained tokens** → Generate new token
- Repository access: **All repositories**
- Permissions: **Contents: Read and write**, **Pull requests: Read and write**, **Actions: Read and write**, **Workflows: Read and write**, **Metadata: Read**

### 3. Bulut kurulumu (bir kez)
1. **Gizli hafıza reposu:** Uygulama `asistan-hafiza` reposunu kendisi açmayı dener. Açamazsa github.com/new → ad `asistan-hafiza`, **Private**, "Add a README" işaretli.
2. **Secrets:** bu repo → Settings → Secrets and variables → Actions → New repository secret:
   - `EVREN_ANAHTAR` → EVREN API anahtarın
   - `ASISTAN_GH_TOKEN` → 2. adımdaki GitHub token'ın aynısı
3. Uygulamada ⚙ Ayarlar → **Kontrol et**: hepsi ✅ olmalı.

İlk görevde EVREN kullanım şartlarını onaylaman istenir (tek seferlik).

### 4. Kullan
Üstten bir repo seç ve isteğini yaz: *"zombi-savunma reposunda dalga sayısını ekranda göster"*.
"Yazmadan önce onay iste" açıksa asistan her commit'ten önce sana sorar (30 dk cevap gelmezse reddedilmiş sayılır). Gece görevlerinde onay sorulmaz.
■ düğmesi çalışan görevi durdurur.

## Geliştirme
- Arayüz `www/` altında: `app.js` (arayüz), `depo.js` (oturum/gece görevi dosyaları), `llm.js` (EVREN), `github.js` (GitHub API), `tools.js` (araçlar), `agent.js` (ajan döngüsü ve hafıza).
- Bulut çalıştırıcısı `bulut/calistir.mjs`: aynı `www/js` modüllerini Node'da çalıştırır. Repo açık olduğu için Actions logları da açık; çalıştırıcı loga sohbet ya da kod içeriği yazmaz.
- `main`'e push: `apk.yml` APK'yı, `pages.yml` web sürümünü yayınlar. `hafiza/`, `AGENTS.md`, `README.md` ve `bulut/` değişiklikleri APK build'i başlatmaz.
- `keystore/debug.keystore` güncellemelerin eskisinin üstüne kurulabilmesi için sabit tutuluyor. Repo açık olduğu için bu anahtar da açık: APK'yı yalnızca bu reponun Releases sayfasından indir.
