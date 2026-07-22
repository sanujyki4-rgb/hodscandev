# Hoodscan API — Roadmap Kelengkapan Explorer

> Status: **rencana** (belum diimplementasikan). Dokumen ini memetakan celah API
> agar Hoodscan setara block explorer besar yang transparan, dengan urutan
> prioritas, ruang lingkup, dan **prinsip agar API tetap terbaca oleh klien lain**.

---

## 0. Prinsip Desain — "tetap bisa terbaca di API lain"

Semua endpoint baru WAJIB mengikuti konvensi yang sudah ada supaya konsisten dan
mudah dikonsumsi oleh frontend maupun integrator pihak ketiga:

- **Bentuk respons konsisten**: list selalu `{ items|data, total, limit, offset }`
  (ikuti pola `parsePagination` + `EXPLORER_LIST_CAP` yang sudah dipakai).
- **BigInt aman**: selalu lewat `serializeBigInt` (angka besar sebagai string).
- **Address selalu lowercase**, validasi via `isValidAddress`, tx hash divalidasi.
- **Caching seragam**: `cacheMiddleware(ttl)` — TTL pendek untuk data "hidup",
  panjang untuk data immutable (block/tx lama).
- **Error seragam**: `{ error: string }` + status code yang tepat (400/404/429).
- **Dokumentasi mesin-terbaca (OpenAPI)**: setiap endpoint baru didaftarkan di
  satu spesifikasi OpenAPI (lihat Fase 5) supaya bisa dibaca tool lain, di-import
  ke Postman, dan menghasilkan SDK.

---

## Fase 1 — Prioritas Tinggi (nilai transparansi langsung)

### 1.1 🔍 Pencarian global — `GET /search?q=`
- **Tujuan**: satu kotak pencarian mendeteksi jenis input dan mengembalikannya.
- **Deteksi**:
  - `0x` + 64 hex → tx hash (cek `Transaction`, fallback block hash).
  - `0x` + 40 hex → address (sertakan `isContract`/`isToken`/label).
  - angka murni → block number.
  - selain itu → cocokkan nama/simbol token (`Token`, ILIKE, batasi N hasil).
- **Respons**: `{ results: [{ type, value, label?, meta? }] }` (bisa banyak tipe).
- **Ruang lingkup**: 1 route + 1 controller baru. Tanpa migrasi DB.
- **Catatan**: gunakan index yang ada; batasi hasil token (mis. 5) demi kecepatan.

### 1.2 💰 Saldo native + ringkasan address — `GET /address/:address`
- **Tujuan**: halaman address menampilkan **Balance** (gas token) + ringkasan.
- **Isi respons**: `address`, `label`, `isContract`, `isToken`, `nativeBalance`
  (dari `eth_getBalance` via `rpcClient`, di-cache singkat), `nonce` (opsional,
  `eth_getTransactionCount`), `txCount` (dari DB), `hasNftActivity`.
- **Ruang lingkup**: 1 route baru `GET /address/:address` + controller;
  pisahkan "header" dari endpoint `transactions` agar bisa dipakai ulang.
  Update tipe di `apps/web` + tampilkan di halaman address.
- **Catatan**: baca RPC best-effort + cache (mis. 10–15s) agar tidak membebani node.

### 1.3 📊 Portfolio token per-address — `GET /address/:address/token-holdings`
- **Tujuan**: daftar ERC-20 yang saat ini dipegang address + saldo.
- **Sumber data**: tabel `TokenBalance` (sudah ada) — `where ownerAddress = addr
  AND balance > 0`, urut `balance desc`, join metadata token + `logoUrl`.
- **Respons**: list `{ tokenAddress, name, symbol, decimals, balance (formatted),
  rawBalance, logoUrl }` + `total`, `limit`, `offset`.
- **Ruang lingkup**: 1 route + 1 controller. Tanpa migrasi DB. Pakai fallback
  decimals ke DB (konsisten dengan perbaikan holders sebelumnya).

---

## Fase 2 — Prioritas Menengah

### 2.1 ↩️ Penarikan L2→L1 (withdrawals) — `GET /transactions/l2-to-l1`
- **Tujuan**: lengkapi arah sebaliknya dari `l1-to-l2` yang sudah ada.
- **Pendekatan**: identifikasi event withdrawal khas Arbitrum (mis.
  `L2ToL1Tx`/`L2ToL1Transaction` dari ArbSys `0x64`) dari tabel `Log`, tampilkan
  status (initiated → confirmed → claimable → executed) bila tersedia.
- **Ruang lingkup**: butuh riset event indexer + kemungkinan kolom status.
  Bisa bertahap: mulai daftar event dulu, status klaim menyusul.
- **Catatan**: verifikasi topic/ABI event via `@arbitrum/sdk` sebelum implementasi.

### 2.2 🖼️ Kedalaman NFT
- `GET /tokens/:address` sudah untuk ERC-20; tambah jalur NFT:
  - `GET /nft/:address` — ringkasan koleksi (nama, simbol, totalSupply, holders).
  - `GET /nft/:address/tokens` — daftar tokenId (inventory koleksi).
  - `GET /nft/:address/:tokenId` — detail instance (pemilik, metadata/tokenURI,
    riwayat transfer).
  - `GET /address/:address/nft-holdings` — NFT yang dipegang sebuah address.
- **Ruang lingkup**: beberapa route + controller; sebagian metadata butuh
  `tokenURI` (RPC/HTTP, best-effort + cache). Pertimbangkan tabel/kolom baru
  untuk kepemilikan NFT jika belum ada.

---

## Fase 3 — Prioritas Rendah–Menengah

### 3.1 ⛽ Gas tracker — `GET /gas`
- **Isi**: `baseFee`/`gasPrice` terkini (`eth_gasPrice`/`eth_feeHistory`),
  opsional level slow/normal/fast + estimasi biaya transfer.
- **Ruang lingkup**: 1 route + 1 controller, cache singkat (mis. 5–10s).

---

## Fase 4 — Ekspor Data (transparansi)

### 4.1 📄 Ekspor CSV
- `GET /address/:address/transactions.csv` (dan varian token-transfers) —
  streaming CSV memakai query yang sama dengan endpoint JSON.
- **Ruang lingkup**: reuse controller yang ada; tambahkan formatter CSV +
  header `Content-Type: text/csv`.

---

## Fase 5 — Dokumentasi API Publik (kunci "terbaca di API lain")

### 5.1 Spesifikasi OpenAPI
- Buat `apps/api/openapi.yaml` (atau generate) yang mendeskripsikan SEMUA
  endpoint (lama + baru), skema respons, parameter, dan contoh.
- Sajikan di `GET /openapi.json` + halaman dokumentasi (mis. Swagger UI) di
  `GET /docs`.
- **Manfaat**: bisa di-import ke Postman, di-generate jadi SDK, dan dibaca
  otomatis oleh integrator lain — inilah yang membuat API "tetap terbaca".
- **Konsistensi**: setiap PR endpoint baru harus memperbarui spec ini.

---

## Ringkasan Urutan Eksekusi

| Urutan | Item | Fase | Migrasi DB? | Perkiraan ruang lingkup |
|--------|------|------|-------------|--------------------------|
| 1 | Saldo native + ringkasan address | 1.2 | Tidak | Kecil |
| 2 | Portfolio token per-address | 1.3 | Tidak | Kecil |
| 3 | Pencarian global `/search` | 1.1 | Tidak | Kecil–sedang |
| 4 | OpenAPI + `/docs` | 5.1 | Tidak | Sedang |
| 5 | Ekspor CSV | 4.1 | Tidak | Kecil |
| 6 | Gas tracker | 3.1 | Tidak | Kecil |
| 7 | Withdrawals L2→L1 | 2.1 | Mungkin | Sedang–besar |
| 8 | Kedalaman NFT | 2.2 | Mungkin | Besar |

> Rekomendasi: kerjakan #1–#3 lebih dulu (dampak besar, data sebagian sudah ada,
> tanpa migrasi), lalu #4 agar semua endpoint langsung terdokumentasi & terbaca
> klien lain. #7 dan #8 dijadwalkan setelah riset event/skema.
