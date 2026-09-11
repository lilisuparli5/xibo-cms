# Map Monitoring CCTV — integrasi awal

Basis: `lilisuparli5/xibo-cms`, `develop`, commit `2fc26af1673153fef5d00d62d2d51d6729238984`.

## Fitur yang tersedia

- Displays → Map → **CCTV cameras** membuka daftar dan marker kamera biru.
- Pencarian kamera, pindah ke lokasi kamera, tambah/edit/hapus konfigurasi.
- Setiap kamera dikaitkan ke sebuah display agar mengikuti izin view/edit Xibo.
- Kamera memiliki koordinat sendiri; perubahan GPS display tidak menggeser kamera.
- Panel video HLS dibuka ketika kamera dipilih, dengan mute, controls, reconnect, dan status pemutaran.
- Native HLS digunakan bila browser mendukungnya; browser lain memakai `hls.js` yang dimuat secara lazy.
- Menutup video/panel, mengganti kamera, atau berpindah folder membersihkan player dan membatalkan request playback.
- Metadata kamera dan display diperbarui setiap 30 detik selama tampilan terkait aktif. Ini bukan pemeriksaan kesehatan kamera di server.
- Refresh halaman menginvalidasi query display, displayMap, dan cameraMap.
- Nilai koordinat nol dipertahankan dalam form display dan respons peta.

## Batas tahap ini

Belum ada CMS, MySQL, atau kamera untuk pengujian langsung. Kode belum membuktikan kompatibilitas perangkat tertentu.

- Tidak ada RTSP proxy/transcoder, ONVIF, PTZ, NVR, perekaman, atau alarm background.
- Status Playing/Buffering/Unavailable hanya menggambarkan pemutaran pada browser saat itu. Marker biru bukan status kamera online.
- Kamera yang tidak sedang ditonton belum memiliki hasil health check.
- Endpoint playback memeriksa sesi dan izin Xibo, lalu memberikan URL HLS yang dikonfigurasi. Endpoint ini **belum menerbitkan signed URL** atau mengamankan akses ke media server secara otomatis.
- Terapkan autentikasi/otorisasi media pada gateway. URL playback akan terlihat oleh pengguna yang diizinkan menonton. Jangan memasukkan password kamera atau rahasia jangka panjang ke URL; URL konfigurasi dapat masuk backup database dan log SQL diagnostik.
- Kredensial RTSP tetap pada gateway/server, tidak disimpan dalam model kamera ini.
- Hanya HTTPS HLS yang diterima, tanpa user/password dalam URL. Manifest, segmen, key, codec, CORS, dan sertifikat harus kompatibel dengan browser.
- Tidak ada stream demo publik yang dihubungkan otomatis.
- Kamera mengikuti folder display, tetapi filter tabel display lain tidak memfilter kamera. Daftar kamera mempunyai pencarian sendiri.
- Semua kamera yang diizinkan dalam folder diambil sekaligus. Untuk deployment besar, tambahkan pagination/bounds kamera dan clustering sebelum memperluas skala.
- Izin edit ditolak backend per-display. Tombol edit mengikuti izin fitur umum; pengguna masih bisa melihat tombol untuk display yang tidak boleh diedit dan akan menerima pesan penolakan saat menyimpan.
- Display tanpa koordinat masih menggunakan fallback lokasi bawaan Xibo. Kamera baru wajib mempunyai koordinat valid.

## Pemasangan setelah CMS tersedia

1. Siapkan checkout Xibo pada commit basis atau branch PR integrasi ini. Bila menggunakan patch, jalankan `git apply --check map-monitoring.patch`, lalu `git apply map-monitoring.patch` pada checkout yang sesuai.
2. Siapkan Xibo mengikuti panduan repository, termasuk PHP 8.4+, database MySQL, dependency Composer, dan `web/settings.php`.
3. Setelah backup database dan sebelum mengaktifkan antarmuka baru, jalankan dari root CMS:

   ```sh
   vendor/bin/phinx status -c phinx.php
   vendor/bin/phinx migrate -c phinx.php
   ```

   Migrasi `20260909120000` membuat tabel `monitoringcamera`. Menghapus display akan menghapus konfigurasi kamera terkait melalui foreign key CASCADE.

4. Bangun frontend:

   ```sh
   cd frontend
   npm ci
   npm run build
   ```

   Output ada pada `frontend/dist`. Dockerfile repository menyalinnya ke `/var/www/cms/web/app`; untuk pemasangan manual, salin isi `frontend/dist` ke `web/app`, termasuk `.vite/manifest.json`. Gunakan proses build Xibo yang sama untuk asset legacy.

5. Sediakan stream HLS HTTPS yang dapat dijangkau browser pengguna. Kamera yang hanya RTSP memerlukan gateway: kamera → RTSP → gateway → HTTPS HLS → browser. Gateway belum termasuk paket ini.
6. Login ke CMS, pastikan setidaknya satu display terdaftar dan dapat diedit. Buka Displays → Map → CCTV cameras → Add camera. Isi nama, display, koordinat dan URL HLS.
7. Klik kamera pada daftar atau marker untuk membuka video. Pada edit, URL kosong mempertahankan URL lama. Menghapus kamera memerlukan konfirmasi dan hanya menghapus konfigurasi, bukan rekaman/perangkat.

Jangan menganggap patch sebagai installer CMS. Migrasi harus selesai sebelum endpoint kamera digunakan. Rollback kode dapat dilakukan dengan mengembalikan commit; tabel kamera dapat dibiarkan sementara untuk mempertahankan konfigurasi. Rollback migrasi menghapus data kamera, sehingga memerlukan backup terlebih dahulu.

## API internal JSON

Semua path berikut relatif terhadap root instalasi CMS, misalnya `/cms/json/...` untuk instalasi pada subfolder.

| Metode/path | Fungsi |
| --- | --- |
| GET `/json/monitoringcamera/map?folderId=...` | FeatureCollection tanpa URL playback |
| GET `/json/monitoringcamera/{id}/playback` | URL playback; sesi dan izin view display diperiksa, no-store |
| POST `/json/monitoringcamera` | Tambah kamera |
| PUT `/json/monitoringcamera/{id}` | Edit kamera, termasuk pengecekan izin display lama dan baru |
| DELETE `/json/monitoringcamera/{id}` | Hapus konfigurasi kamera |

POST/PUT menerima form-urlencoded: `displayId`, `name`, `latitude`, `longitude`, `playbackUrl`.
Mutation memerlukan `X-Requested-With: XMLHttpRequest`, fitur `displays.modify`, serta izin view/edit display. Read memerlukan `displays.view`. Route hanya terdaftar pada JSON frontend, tidak ditambahkan ke API OAuth publik.

## File utama

- `lib/Controller/MonitoringCamera.php`: otorisasi, validasi, CRUD, GeoJSON, playback.
- `lib/Dependencies/Controllers.php`: registrasi dependency controller.
- `lib/routes-react.php`: endpoint JSON internal.
- `db/migrations/20260909120000_add_monitoring_cameras.php`: schema dan foreign key.
- `frontend/src/services/monitoringCameraApi.ts`: adapter API.
- `frontend/src/pages/Displays/Displays/components/CameraLayer.tsx`: marker, daftar, form dan panel.
- `frontend/src/pages/Displays/Displays/components/CameraPlayer.tsx`: lifecycle HLS.
- `DisplayMap.tsx`, `Displays.tsx`, `EditDisplayModal.tsx`, `lib/Controller/Display.php`: integrasi dan perbaikan refresh/koordinat.

## Validasi

Lulus pada salinan lokal:

- `npm run build`: produksi Vite, termasuk kompilasi TypeScript dan konversi locale.
- `tsc -b`: pemeriksaan tipe.
- ESLint pada file frontend yang diperiksa.
- 13 tes Vitest: lifecycle HLS, respons terlambat, native playback, reconnect, seleksi kamera, tambah dengan latitude nol, izin tombol, konfirmasi hapus, dan regresi mode peta Displays.
- 20 pemeriksaan controller terisolasi dengan SQLite: GeoJSON, koordinat nol, URL tidak bocor ke peta, izin view/edit, transfer ke display terlarang, URL tidak valid, penolakan form tanpa header, dan hapus.
- Pemeriksaan sintaks PHP pada file backend yang berubah.

Jalankan ulang tes khusus:

```sh
cd frontend
npx vitest run src/pages/Displays/Displays/components/CameraLayer.test.tsx src/pages/Displays/Displays/components/CameraPlayer.test.tsx src/pages/Displays/Displays/__tests__/page/map.test.tsx
cd ..
php -d extension=pdo_sqlite -d extension=mbstring tests/isolated/monitoring-camera-smoke.php
```

Smoke test memakai HTTP/auth doubles dan SQLite, bukan Slim/MySQL produksi. Validasi migrasi MySQL, foreign key, sesi CMS sesungguhnya, reverse proxy/subfolder, CORS gateway, codec kamera, dan browser di perangkat target masih wajib sebelum produksi.
