# Asistan

Telefonda çalışan bir kodlama asistanı. GitHub repolarını okuyup yazabiliyor, dal ve PR açabiliyor, Actions build'lerini kontrol edebiliyor. Her işten sonra kendine ders çıkarıyor.

- **Beyin:** Gemini, OpenRouter ve Groq'un ücretsiz modelleri. Birinin limiti dolunca otomatik olarak sıradakine geçiyor.
- **Stil:** `AGENTS.md`. Asistan her görevde bunu okuyor, değiştirmek için yeni APK gerekmiyor.
- **Hafıza:** `hafiza/dersler.md`. Asistan buraya kendi derslerini yazıyor. Uygulamadaki 📚 düğmesinden görüp düzenleyebilirsin.

## Kurulum (telefondan)

### 1. APK'yı indir
Repo → **Releases** → **Asistan (son sürüm)** → `Asistan.apk`. İndirip kur ("bilinmeyen kaynaklara izin ver" diye sorabilir).
Kodda her değişiklik olduğunda GitHub Actions yeni APK'yı aynı yere koyar. Yeni sürüm eskisinin üstüne kurulur, ayarların kaybolmaz.

### 2. GitHub token
github.com → Settings → Developer settings → **Personal access tokens → Fine-grained tokens** → Generate new token
- Repository access: **All repositories**
- Permissions: **Contents: Read and write**, **Pull requests: Read and write**, **Actions: Read and write**, **Workflows: Read and write**, **Metadata: Read**

### 3. Model anahtarları (hepsi ücretsiz)
| Sağlayıcı | Nereden | Not |
|---|---|---|
| Gemini | aistudio.google.com/apikey | **Billing açma**, açarsan ücretli olur |
| OpenRouter | openrouter.ai/keys | Yalnızca `:free` ile biten modeller ücretsiz |
| Groq | console.groq.com/keys | Çok hızlı |

Uygulamada ⚙ Ayarlar'a anahtarları gir. **Modelleri getir** düğmesi güncel model listesini çeker. ▲▼ ile sağlayıcıların sırasını değiştirebilirsin.

### 4. Kullan
Üstten bir repo seç ve isteğini yaz: *"zombi-savunma reposunda dalga sayısını ekranda göster"*.
"Yazmadan önce onay iste" açıksa asistan her commit'ten önce sana sorar.

## Geliştirme
- Kod `www/` altında: `llm.js` (modeller), `github.js` (GitHub API), `tools.js` (araçlar), `agent.js` (ajan döngüsü ve hafıza), `app.js` (arayüz).
- `main` dalına her push'ta `.github/workflows/apk.yml` APK'yı derler. `hafiza/`, `AGENTS.md` ve `README.md` değişiklikleri build başlatmaz.
- `keystore/debug.keystore` güncellemelerin eskisinin üstüne kurulabilmesi için sabit tutuluyor. Repoyu public yaparsan bu anahtarı değiştir.
