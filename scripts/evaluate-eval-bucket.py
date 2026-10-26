#!/usr/bin/env python3
"""Evaluasi OCR batch ycwc-001 dari bucket privat eval-fotos → agregat Precision/Recall/F1.

ALUR LENGKAP (satu perintah):
  python scripts/evaluate-eval-bucket.py --all --base-url http://localhost:3000

  --ingest   baca eval/labels.csv + eval/private/, enkripsi AES-256-GCM, upload ke
             bucket privat eval-fotos, lalu insert/update eval_labels.
  --publish  setelah evaluasi, insert 1 baris eval_runs + eval_predictions ke Supabase
             supaya halaman /transparansi menampilkan metrik.

Tanpa flag mode, script hanya mengevaluasi label yang SUDAH ada di tabel eval_labels
(perilaku lama, untuk kompatibilitas).

KEBIJAKAN PRIVASI (UU PDP):
- Foto dibaca via service_role dan didekripsi in-memory (AES-256-GCM, EVAL_MASTER_KEY).
- NIK TIDAK PERNAH ditulis ke log/file/DB — hanya versi ter-mask saat logging.
- Output publik: eval/results.json (agregat saja). Output privat:
  eval/results-private.json (gitignored, hapus saat purge).
- Foto asli hanya di bucket privat eval-fotos. Jangan commit eval/private/.

PRASYARAT:
  pip install requests supabase cryptography

KUNCI:
- Script memuat .env.local lalu .env otomatis (bisa dioverride --env-file).
- Jangan menaruh EVAL_MASTER_KEY / service role key di command line; nilainya
  tersimpan di shell history. Cukup isi .env.local.

CONTOH:
  python scripts/evaluate-eval-bucket.py --ingest
  python scripts/evaluate-eval-bucket.py --publish --base-url http://localhost:3000
  python scripts/evaluate-eval-bucket.py --all --base-url http://localhost:3000
  python scripts/evaluate-eval-bucket.py --ingest --dry-run
"""
import argparse
import base64
import csv
import hashlib
import hmac
import json
import math
import os
import re
import statistics
import sys
import time
from collections import Counter
from pathlib import Path

try:
    import requests
except ImportError:
    print("butuh: pip install requests supabase cryptography", file=sys.stderr)
    sys.exit(2)

BUCKET = "eval-fotos"
JENIS_LABELS = [
    "KTP",
    "KK",
    "AKTA",
    "AKTA_KEMATIAN",
    "AKTA_PERKAWINAN",
    "SURAT_PINDAH",
    "KIA",
    "LAINNYA",
]
STATUS_LABELS = ["BERHASIL", "BURAM", "TIDAK_VALID"]
MIME_BY_EXT = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".pdf": "application/pdf",
}
EXT_BY_MIME = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "application/pdf": "pdf",
}
DEFAULT_PRIVATE_DIR = "eval/private"
DEFAULT_LABELS_CSV = "eval/labels.csv"
DEFAULT_BATCH = "ycwc-001"
DEFAULT_BASE_URL = "http://localhost:3000"


def is_demo_batch(batch_id: str) -> bool:
    return str(batch_id or "").strip().lower().startswith("demo-")


def fail(message: str, code: int = 1) -> None:
    print(message, file=sys.stderr)
    raise SystemExit(code)


def _parse_env_line(line: str):
    line = line.strip()
    if not line or line.startswith("#"):
        return None
    if line.startswith("export "):
        line = line[7:].lstrip()
    if "=" not in line:
        return None
    key, value = line.split("=", 1)
    key = key.strip()
    value = value.strip()
    if not key:
        return None
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    elif " #" in value:
        value = value.split(" #", 1)[0].rstrip()
    return key, value


def load_env_files(explicit_paths):
    """Muat KEY=VALUE tanpa menimpa environment yang sudah ada (dotenv override=false)."""
    candidates = [Path(p) for p in explicit_paths] + [Path(".env.local"), Path(".env")]
    seen = set()
    loaded = {}
    for path in candidates:
        try:
            key_path = str(path.resolve())
        except Exception:
            key_path = str(path)
        if key_path in seen:
            continue
        seen.add(key_path)
        if not path.is_file():
            continue
        try:
            for raw in path.read_text(encoding="utf-8").splitlines():
                parsed = _parse_env_line(raw)
                if not parsed:
                    continue
                key, value = parsed
                loaded.setdefault(key, value)
                # Anggap variabel kosong sebagai belum diisi supaya nilai file dipakai.
                if not os.environ.get(key):
                    os.environ[key] = value
        except Exception as exc:
            print(f"peringatan: gagal membaca {path}: {exc}", file=sys.stderr)
    return loaded


def master_key_bytes() -> bytes:
    raw = os.environ.get("EVAL_MASTER_KEY", "").strip().lower()
    if raw.startswith("0x"):
        raw = raw[2:]
    if not re.fullmatch(r"[0-9a-f]{64}", raw):
        fail("EVAL_MASTER_KEY harus hex 64 karakter (32 byte). Isi di .env.local.")
    return bytes.fromhex(raw)


def clean_supabase_url(raw: str) -> str:
    # Samakan dengan api/_lib/store.ts + server.ts: buang suffix /rest/v1 agar
    # create_client tidak menghasilkan /rest/v1/rest/v1 (PGRST125).
    return re.sub(r"/rest/v1/?$", "", str(raw or "").strip(), flags=re.I).rstrip("/")


def get_supabase():
    try:
        from supabase import create_client
    except ImportError:
        fail("butuh: pip install supabase cryptography")
    url = clean_supabase_url(os.environ.get("SUPABASE_URL", ""))
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "").strip()
        or os.environ.get("SUPABASE_KEY", "").strip()
    )
    if not url or not key:
        fail("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (atau SUPABASE_KEY) kosong. Isi di .env.local.")
    try:
        return create_client(url, key)
    except Exception as exc:
        fail(f"gagal terhubung ke Supabase: {str(exc)[:200]}")


def require_cryptography():
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM  # noqa: F401
    except ImportError:
        fail("butuh paket 'cryptography': pip install cryptography")


def sanitize_id(value: str) -> str:
    return re.sub(r"[^A-Z0-9-]", "", str(value or "").upper())[:32]


def eval_path_for(batch_id: str, file_id: str, mime: str) -> str:
    ext = EXT_BY_MIME.get(str(mime or "").lower())
    if not ext:
        ext = "png" if "png" in str(mime or "").lower() else "jpg"
    safe_batch = re.sub(r"[^A-Za-z0-9-]", "", str(batch_id or ""))[:32] or DEFAULT_BATCH
    safe_file = re.sub(r"[^A-Za-z0-9-]", "", str(file_id or ""))[:32] or "unknown"
    return f"eval/{safe_batch}/{safe_file}.{ext}.enc"


def eval_file_key(master: bytes, batch_id: str, file_id: str) -> bytes:
    # HARUS sama dengan api/_lib/eval-foto.ts: HMAC(master, "eval:{batch}:{file}").
    msg = f"eval:{batch_id}:{file_id}".encode("utf-8")
    return hmac.new(master, msg, hashlib.sha256).digest()


def encrypt_photo(plain: bytes, master: bytes, batch_id: str, file_id: str):
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    key = eval_file_key(master, batch_id, file_id)
    iv = os.urandom(12)
    payload = AESGCM(key).encrypt(iv, plain, None)
    return payload, iv.hex()


def decrypt_photo(payload: bytes, master: bytes, batch_id: str, file_id: str, iv_hex: str) -> bytes:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCM

    try:
        iv = bytes.fromhex(str(iv_hex or ""))
    except ValueError:
        raise ValueError("iv_hex tidak valid")
    if len(iv) != 12:
        raise ValueError("iv_hex harus 12 byte")
    key = eval_file_key(master, batch_id, file_id)
    return AESGCM(key).decrypt(iv, payload, None)


def prf(y_true, y_pred, labels):
    out = {}
    for label in labels:
        tp = sum(1 for t, p in zip(y_true, y_pred) if t == label and p == label)
        fp = sum(1 for t, p in zip(y_true, y_pred) if t != label and p == label)
        fn = sum(1 for t, p in zip(y_true, y_pred) if t == label and p != label)
        precision = tp / (tp + fp) if (tp + fp) else 0.0
        recall = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
        out[label] = {
            "precision": round(precision, 3),
            "recall": round(recall, 3),
            "f1": round(f1, 3),
            "support": sum(1 for t in y_true if t == label),
        }
    # Macro hanya atas kelas yang benar-benar ada di ground truth. Kelas tanpa
    # support tidak boleh menurunkan skor secara artifisial.
    active = [label for label in labels if out[label]["support"] > 0]
    macro_precision = sum(out[label]["precision"] for label in active) / len(active) if active else 0.0
    macro_recall = sum(out[label]["recall"] for label in active) / len(active) if active else 0.0
    macro_f1 = sum(out[label]["f1"] for label in active) / len(active) if active else 0.0
    return out, {
        "precision": round(macro_precision, 3),
        "recall": round(macro_recall, 3),
        "f1": round(macro_f1, 3),
        "n_classes": len(active),
    }


def _pick(mapping, *names):
    for name in names:
        if name in mapping:
            return mapping[name]
    return None


def _photo_for_id(private_dir: Path, file_id: str):
    for ext in MIME_BY_EXT:
        candidate = private_dir / f"{file_id}{ext}"
        if candidate.is_file():
            return candidate
        candidate_upper = private_dir / f"{file_id}{ext.upper()}"
        if candidate_upper.is_file():
            return candidate_upper
    return None


def _clean_optional(raw, key, maxlen):
    if not key:
        return None
    value = str(raw.get(key, "") or "").strip()[:maxlen]
    return value or None


def read_labels_csv(labels_path: Path, private_dir: Path):
    if not labels_path.is_file():
        fail(f"label CSV tidak ditemukan: {labels_path}")
    if not private_dir.is_dir():
        fail(f"folder foto tidak ditemukan: {private_dir}")

    with labels_path.open("r", encoding="utf-8-sig", newline="") as handle:
        # Baris komentar (#) tidak boleh dianggap data.
        lines = [line for line in handle if not line.lstrip().startswith("#")]
    reader = csv.DictReader(lines)
    if not reader.fieldnames:
        fail(f"CSV tidak punya header: {labels_path}")
    header = {(name or "").strip().lower(): name for name in reader.fieldnames if name}
    filename_key = _pick(header, "filename", "file", "file_name")
    file_id_key = _pick(header, "file_id", "id")
    jenis_key = _pick(header, "jenis_true", "jenis")
    status_key = _pick(header, "status_true", "status")
    lighting_key = _pick(header, "lighting")
    device_key = _pick(header, "device")
    relawan_key = _pick(header, "relawan_id", "relawan")
    consent_key = _pick(header, "consent_ref", "consent")

    if not filename_key and not file_id_key:
        fail("CSV wajib punya kolom filename (atau file_id).")
    if not jenis_key or not status_key:
        fail("CSV wajib punya kolom jenis_true dan status_true.")

    rows = []
    seen_ids = set()
    for line_no, raw in enumerate(reader, start=2):
        if not raw or not any((str(v).strip() if v is not None else "") for v in raw.values()):
            continue
        filename = str(raw.get(filename_key, "") or "").strip() if filename_key else ""
        file_id_raw = str(raw.get(file_id_key, "") or "").strip() if file_id_key else ""
        if not filename and not file_id_raw:
            fail(f"baris {line_no}: filename/file_id kosong")
        if filename:
            filename = Path(filename.replace("\\", "/")).name
        file_id = sanitize_id(file_id_raw or Path(filename).stem)
        if len(file_id) < 3:
            fail(f"baris {line_no}: file_id '{file_id}' kurang dari 3 karakter")
        if file_id in seen_ids:
            fail(f"baris {line_no}: file_id duplikat: {file_id}")
        seen_ids.add(file_id)

        photo = private_dir / filename if filename else _photo_for_id(private_dir, file_id)
        if photo is None or not photo.is_file():
            fail(f"baris {line_no}: foto tidak ditemukan untuk {file_id} ({filename or 'cari otomatis'}) di {private_dir}")
        mime = MIME_BY_EXT.get(photo.suffix.lower())
        if not mime:
            fail(f"baris {line_no}: ekstensi foto tidak didukung: {photo.name}")

        jenis = str(raw.get(jenis_key, "") or "").strip().upper()
        status = str(raw.get(status_key, "") or "").strip().upper()
        if jenis not in JENIS_LABELS:
            fail(f"baris {line_no}: jenis_true '{jenis}' tidak valid. Pilihan: {', '.join(JENIS_LABELS)}")
        if status not in STATUS_LABELS:
            fail(f"baris {line_no}: status_true '{status}' tidak valid. Pilihan: {', '.join(STATUS_LABELS)}")

        rows.append(
            {
                "file_id": file_id,
                "filename": photo.name,
                "path": photo,
                "mime": mime,
                "jenis_true": jenis,
                "status_true": status,
                "lighting": _clean_optional(raw, lighting_key, 32),
                "device": _clean_optional(raw, device_key, 32),
                "relawan_id": _clean_optional(raw, relawan_key, 16),
                "consent_ref": _clean_optional(raw, consent_key, 32),
            }
        )
    if not rows:
        fail(f"tidak ada baris data di {labels_path} (hanya header/komentar?)")
    return rows


def _upload(sb, path: str, payload: bytes, upsert: bool):
    options = {"content-type": "application/octet-stream"}
    if upsert:
        options["upsert"] = "true"
    return sb.storage.from_(BUCKET).upload(path, payload, options)


def _remove_object(sb, path: str):
    if not path:
        return
    try:
        sb.storage.from_(BUCKET).remove([path])
    except Exception:
        pass


def ingest_rows(sb, master: bytes, batch_id: str, rows, force: bool, dry_run: bool):
    existing_rows = []
    if sb is not None:
        try:
            existing_rows = (
                sb.table("eval_labels")
                .select("file_id,storage_path,jenis_true,status_true")
                .eq("batch_id", batch_id)
                .execute()
                .data
                or []
            )
        except Exception as exc:
            fail(f"gagal membaca eval_labels: {str(exc)[:300]}")
    existing = {row["file_id"]: row for row in existing_rows if row.get("file_id")}

    inserted = 0
    updated = 0
    skipped = 0
    failed = 0
    for index, row in enumerate(rows, start=1):
        file_id = row["file_id"]
        old = existing.get(file_id)
        if old and not force:
            skipped += 1
            print(f"[{index}/{len(rows)}] {file_id}: sudah ada, dilewati (pakai --force untuk enkripsi ulang)")
            continue

        try:
            plain = row["path"].read_bytes()
        except Exception as exc:
            failed += 1
            print(f"[{index}/{len(rows)}] {file_id}: GAGAL baca foto: {exc}")
            continue
        if not plain:
            failed += 1
            print(f"[{index}/{len(rows)}] {file_id}: GAGAL, file kosong")
            continue

        file_hash = hashlib.sha256(plain).hexdigest()
        try:
            payload, iv_hex = encrypt_photo(plain, master, batch_id, file_id)
        except Exception as exc:
            failed += 1
            print(f"[{index}/{len(rows)}] {file_id}: GAGAL enkripsi: {exc}")
            continue
        finally:
            try:
                plain = b""
            except Exception:
                pass

        path = eval_path_for(batch_id, file_id, row["mime"])
        # --force memakai path berversi supaya ciphertext lama tidak tertimpa
        # sebelum baris eval_labels berhasil diperbarui.
        if old and force:
            path = path.replace(".enc", f".{int(time.time() * 1000)}.enc")

        if dry_run:
            print(
                f"[{index}/{len(rows)}] {file_id}: DRY-RUN ok "
                f"({len(payload)} byte, {row['jenis_true']}/{row['status_true']}, {path})"
            )
            inserted += 1
            continue

        uploaded = False
        try:
            _upload(sb, path, payload, upsert=False)
            uploaded = True
        except Exception as exc:
            msg = str(exc)
            # Kalau object yatim dari percobaan sebelumnya, pakai path berversi.
            if re.search(r"exist|duplicate|already", msg, re.I):
                path = path.replace(".enc", f".{int(time.time() * 1000)}.enc")
                try:
                    _upload(sb, path, payload, upsert=False)
                    uploaded = True
                except Exception as exc2:
                    failed += 1
                    print(f"[{index}/{len(rows)}] {file_id}: GAGAL upload: {str(exc2)[:200]}")
                    continue
            else:
                failed += 1
                print(f"[{index}/{len(rows)}] {file_id}: GAGAL upload: {msg[:200]}")
                continue

        label_row = {
            "file_id": file_id,
            "batch_id": batch_id,
            "storage_path": path,
            "file_hash": file_hash,
            "jenis_true": row["jenis_true"],
            "status_true": row["status_true"],
            "lighting": row["lighting"],
            "device": row["device"],
            "relawan_id": row["relawan_id"],
            "consent_ref": row["consent_ref"],
            "iv_hex": iv_hex,
        }
        try:
            if old:
                update_row = {k: v for k, v in label_row.items() if k not in ("file_id", "batch_id")}
                sb.table("eval_labels").update(update_row).eq("batch_id", batch_id).eq("file_id", file_id).execute()
                updated += 1
                if old.get("storage_path") and old["storage_path"] != path:
                    _remove_object(sb, old["storage_path"])
            else:
                sb.table("eval_labels").insert([label_row]).execute()
                inserted += 1
        except Exception as exc:
            failed += 1
            # Baris lama (kalau ada) masih menunjuk object lama; hapus object baru
            # supaya tidak ada ciphertext yatim.
            if uploaded:
                _remove_object(sb, path)
            print(f"[{index}/{len(rows)}] {file_id}: GAGAL catat label: {str(exc)[:300]}")
            if "check constraint" in str(exc).lower() or "jenis_true" in str(exc).lower():
                print("  -> jalankan migrasi supabase/migrations/20261026_eval_jenis_7.sql dulu.", file=sys.stderr)
            continue
        print(f"[{index}/{len(rows)}] {file_id}: ok ({row['jenis_true']}/{row['status_true']})")

    print(
        f"\ningest selesai: baru={inserted} update={updated} dilewati={skipped} gagal={failed} "
        f"batch={batch_id}"
        + (" (dry-run, tidak ada yang ditulis)" if dry_run else "")
    )
    return 0 if failed == 0 else 1


def evaluate(sb, master: bytes, batch_id: str, base_url: str, limit: int, min_publish_labels: int = 0):
    require_cryptography()
    try:
        labels = (
            sb.table("eval_labels")
            .select("file_id,storage_path,file_hash,jenis_true,status_true,lighting,iv_hex")
            .eq("batch_id", batch_id)
            .order("file_id")
            .limit(limit)
            .execute()
            .data
            or []
        )
    except Exception as exc:
        fail(f"gagal membaca eval_labels: {str(exc)[:300]}")
    if not labels:
        fail(
            f"tidak ada label batch {batch_id}. Isi eval/labels.csv + eval/private/ lalu jalankan:\n"
            f"  python scripts/evaluate-eval-bucket.py --ingest"
        )
    print(f"label: {len(labels)} file batch {batch_id}")
    if min_publish_labels and len(labels) < min_publish_labels:
        fail(
            f"batch baru {len(labels)}/{min_publish_labels} label; evaluasi dibatalkan sebelum OCR "
            "agar tidak membuang waktu/kuota. Lengkapi dataset dulu, atau pakai --min-labels N "
            "untuk uji kecil."
        )
    if len(labels) < 100:
        print(
            f"PERINGATAN: batch baru {len(labels)}/100 label. Ini belum memenuhi klaim 100 foto; "
            "jangan publish sebagai run final.",
            file=sys.stderr,
        )

    results = []
    failed_rows = []
    latencies = []
    for index, row in enumerate(labels, start=1):
        file_id = row.get("file_id")
        storage_path = row.get("storage_path")
        if not storage_path:
            failed_rows.append(
                {
                    "file_id": file_id,
                    "jenis_true": row.get("jenis_true"),
                    "status_true": row.get("status_true"),
                    "jenis_pred": None,
                    "status_pred": None,
                    "skor": None,
                    "latency_ms": None,
                    "source": "error:storage_path kosong (sudah purge?)",
                }
            )
            print(f"[{index}/{len(labels)}] {file_id}: GAGAL, storage_path kosong")
            continue

        started = time.time()
        try:
            raw_payload = sb.storage.from_(BUCKET).download(storage_path)
            plain = decrypt_photo(
                raw_payload,
                master,
                batch_id,
                file_id,
                row.get("iv_hex", ""),
            )
        except Exception as exc:
            failed_rows.append(
                {
                    "file_id": file_id,
                    "jenis_true": row.get("jenis_true"),
                    "status_true": row.get("status_true"),
                    "jenis_pred": None,
                    "status_pred": None,
                    "skor": None,
                    "latency_ms": int((time.time() - started) * 1000),
                    "source": f"error:dekripsi/download: {str(exc)[:80]}",
                }
            )
            print(f"[{index}/{len(labels)}] {file_id}: GAGAL dekripsi/download: {str(exc)[:160]}")
            continue

        expected_hash = str(row.get("file_hash") or "")
        actual_hash = hashlib.sha256(plain).hexdigest()
        if expected_hash and actual_hash != expected_hash:
            failed_rows.append(
                {
                    "file_id": file_id,
                    "jenis_true": row.get("jenis_true"),
                    "status_true": row.get("status_true"),
                    "jenis_pred": None,
                    "status_pred": None,
                    "skor": None,
                    "latency_ms": int((time.time() - started) * 1000),
                    "source": "error:hash file tidak cocok",
                }
            )
            print(f"[{index}/{len(labels)}] {file_id}: GAGAL, hash file tidak cocok")
            continue

        b64 = base64.b64encode(plain).decode("ascii")
        try:
            plain = b""
        except Exception:
            pass

        started = time.time()
        response = None
        last_error = ""
        for attempt in range(2):
            try:
                response = requests.post(
                    f"{base_url.rstrip('/')}/api/ocr",
                    json={"imageBase64": b64},
                    timeout=180,
                )
                if response.status_code == 429:
                    retry_after = 0
                    try:
                        retry_after = int((response.json() or {}).get("retryAfter") or 0)
                    except Exception:
                        retry_after = 0
                    if attempt == 0:
                        wait = min(max(retry_after, 1), 120)
                        print(f"  rate limit 429; tunggu {wait}s lalu coba sekali lagi...")
                        time.sleep(wait)
                        continue
                if response.status_code >= 500 and attempt == 0:
                    time.sleep(2)
                    continue
                break
            except requests.RequestException as exc:
                last_error = str(exc)
                if attempt == 0:
                    time.sleep(2)
                    continue
        latency_ms = int((time.time() - started) * 1000)

        if response is None:
            failed_rows.append(
                {
                    "file_id": file_id,
                    "jenis_true": row.get("jenis_true"),
                    "status_true": row.get("status_true"),
                    "jenis_pred": None,
                    "status_pred": None,
                    "skor": None,
                    "latency_ms": latency_ms,
                    "source": f"error:request: {last_error[:80]}",
                }
            )
            print(f"[{index}/{len(labels)}] {file_id}: GAGAL request: {last_error[:160]}")
            continue

        try:
            body = response.json()
        except Exception:
            body = {}
        if response.status_code != 200:
            failed_rows.append(
                {
                    "file_id": file_id,
                    "jenis_true": row.get("jenis_true"),
                    "status_true": row.get("status_true"),
                    "jenis_pred": None,
                    "status_pred": None,
                    "skor": None,
                    "latency_ms": latency_ms,
                    "source": f"error:HTTP {response.status_code}",
                }
            )
            print(f"[{index}/{len(labels)}] {file_id}: GAGAL HTTP {response.status_code}: {str(body)[:160]}")
            continue

        data = body.get("data") if isinstance(body, dict) and isinstance(body.get("data"), dict) else body
        if not isinstance(data, dict) or not data.get("jenis_dokumen"):
            failed_rows.append(
                {
                    "file_id": file_id,
                    "jenis_true": row.get("jenis_true"),
                    "status_true": row.get("status_true"),
                    "jenis_pred": None,
                    "status_pred": None,
                    "skor": None,
                    "latency_ms": latency_ms,
                    "source": "error:respons OCR tidak valid",
                }
            )
            print(f"[{index}/{len(labels)}] {file_id}: GAGAL, respons OCR tidak valid")
            continue

        jenis_pred = str(data.get("jenis_dokumen") or "LAINNYA").upper()
        status_pred = str(data.get("status_verifikasi") or "TIDAK_VALID").upper()
        try:
            skor = int(data.get("skor_kejelasan") or 0)
        except Exception:
            skor = 0
        source = (
            response.headers.get("X-Ocr-Source")
            or (body.get("source") if isinstance(body, dict) else None)
            or data.get("source")
            or "ai"
        )
        source = str(source)
        # NIK hanya untuk log ter-mask; tidak disimpan ke results/DB.
        nik_masked = mask_nik(str(data.get("nik") or ""))
        latencies.append(latency_ms)
        results.append(
            {
                "file_id": file_id,
                "jenis_true": row.get("jenis_true"),
                "status_true": row.get("status_true"),
                "jenis_pred": jenis_pred,
                "status_pred": status_pred,
                "skor": skor,
                "latency_ms": latency_ms,
                "source": source,
                "lighting": row.get("lighting"),
            }
        )
        print(
            f"[{index}/{len(labels)}] {file_id}: true={row.get('jenis_true')}/{row.get('status_true')} "
            f"pred={jenis_pred}/{status_pred} skor={skor} {latency_ms}ms src={source} nik={nik_masked}"
        )

    if not results:
        print("\ntidak ada hasil OCR yang valid; results.json tidak ditimpa.", file=sys.stderr)
        for failed in failed_rows:
            print(f"  - {failed['file_id']}: {failed['source']}", file=sys.stderr)
        return None, None, None, failed_rows

    yj_true = [r["jenis_true"] for r in results]
    yj_pred = [r["jenis_pred"] for r in results]
    per_jenis, macro = prf(yj_true, yj_pred, JENIS_LABELS)

    ys_true = [r["status_true"] for r in results]
    ys_pred = [r["status_pred"] for r in results]
    per_status, macro_status = prf(ys_true, ys_pred, STATUS_LABELS)
    f1_lainnya = per_jenis.get("LAINNYA", {}).get("f1", 0)
    per_buram, _ = prf(
        ["BURAM" if s == "BURAM" else "BUKAN-BURAM" for s in ys_true],
        ["BURAM" if s == "BURAM" else "BUKAN-BURAM" for s in ys_pred],
        ["BURAM", "BUKAN-BURAM"],
    )
    f1_buram = per_buram.get("BURAM", {}).get("f1", 0)

    latency_sorted = sorted(latencies) if latencies else [0]
    p50 = statistics.median(latency_sorted)
    p95_index = max(0, min(len(latency_sorted) - 1, math.ceil(len(latency_sorted) * 0.95) - 1))
    p95 = latency_sorted[p95_index]
    cache_hits = sum(1 for r in results if r["source"].lower() == "cache")
    cache_hit_rate = round(cache_hits / len(results), 3) if results else 0

    confusion = {label: Counter() for label in JENIS_LABELS}
    for true_label, pred_label in zip(yj_true, yj_pred):
        if true_label in confusion:
            confusion[true_label][pred_label] += 1

    if is_demo_batch(batch_id):
        public_notes = (
            "DEMO sintetis: gambar buatan, bukan foto warga; bukan klaim akurasi ycwc-001. "
            f"Macro F1 atas {macro['n_classes']} kelas yang ada di ground truth."
        )
    else:
        public_notes = (
            "Agregat saja (UU PDP). Foto asli di bucket privat eval-fotos. "
            f"Macro F1 atas {macro['n_classes']} kelas yang ada di ground truth."
        )

    public = {
        "batch_id": batch_id,
        "n": len(results),
        "n_labels": len(labels),
        "n_failed": len(failed_rows),
        "precision": macro["precision"],
        "recall": macro["recall"],
        "f1": macro["f1"],
        "macro_classes": macro["n_classes"],
        "f1_lainnya": f1_lainnya,
        "f1_buram": f1_buram,
        "per_jenis": per_jenis,
        "per_status": per_status,
        "confusion_jenis": {key: dict(value) for key, value in confusion.items()},
        "latency_p50": int(p50),
        "latency_p95": int(p95),
        "cache_hit_rate": cache_hit_rate,
        "notes": public_notes,
    }
    os.makedirs("eval", exist_ok=True)
    with open("eval/results.json", "w", encoding="utf-8") as handle:
        json.dump(public, handle, ensure_ascii=False, indent=2)
    with open("eval/results-private.json", "w", encoding="utf-8") as handle:
        json.dump({"public": public, "per_file": results, "failed": failed_rows}, handle, ensure_ascii=False, indent=2)

    print(
        f"\nOK n={len(results)}/{len(labels)} F1={macro['f1']} F1_LAINNYA={f1_lainnya} "
        f"F1_BURAM={f1_buram} p50={int(p50)}ms p95={int(p95)}ms cache={cache_hit_rate:.1%}"
    )
    if failed_rows:
        print(f"PERINGATAN: {len(failed_rows)} file gagal dan tidak masuk metrik.", file=sys.stderr)
    print("publik: eval/results.json | privat (gitignored): eval/results-private.json")
    return public, results, failed_rows, None


def publish_run(sb, batch_id: str, public: dict, results, failed_rows, allow_partial: bool):
    if failed_rows and not allow_partial:
        fail(
            f"{len(failed_rows)} file gagal; publikasi dibatalkan agar metrik tidak setengah jadi.\n"
            "Perbaiki file bermasalah lalu ulangi, atau pakai --allow-partial bila memang ingin "
            "mempublikasikan sebagian (akan tercatat di notes)."
        )
    source_note = (
        "DEMO sintetis: gambar buatan, bukan foto warga; bukan klaim akurasi ycwc-001."
        if is_demo_batch(batch_id)
        else "foto asli di bucket privat eval-fotos."
    )
    notes = (
        "Agregat 7 jenis + LAINNYA (UU PDP). "
        f"dievaluasi={public['n']}/{public['n_labels']}; gagal={public['n_failed']}; "
        f"cache={public['cache_hit_rate']:.3f}; {source_note}"
    )
    run_row = {
        "batch_id": batch_id,
        "n": public["n"],
        "precision": public["precision"],
        "recall": public["recall"],
        "f1": public["f1"],
        "f1_lainnya": public["f1_lainnya"],
        "f1_buram": public["f1_buram"],
        "latency_p50": public["latency_p50"],
        "latency_p95": public["latency_p95"],
        "cache_hit_rate": public["cache_hit_rate"],
        "notes": notes,
    }
    try:
        inserted = sb.table("eval_runs").insert([run_row]).execute()
        run_id = (inserted.data or [{}])[0].get("id")
    except Exception as exc:
        fail(f"gagal insert eval_runs: {str(exc)[:400]}")
    if not run_id:
        fail("eval_runs tidak mengembalikan id run; publikasi dibatalkan.")

    predictions = []
    for row in results:
        predictions.append(
            {
                "batch_id": batch_id,
                "run_id": run_id,
                "file_id": row["file_id"],
                "jenis_true": row["jenis_true"],
                "status_true": row["status_true"],
                "jenis_pred": row["jenis_pred"],
                "status_pred": row["status_pred"],
                "skor": row["skor"],
                "latency_ms": row["latency_ms"],
                "source": row["source"],
            }
        )
    for row in failed_rows:
        predictions.append(
            {
                "batch_id": batch_id,
                "run_id": run_id,
                "file_id": row["file_id"],
                "jenis_true": row["jenis_true"],
                "status_true": row["status_true"],
                "jenis_pred": None,
                "status_pred": None,
                "skor": None,
                "latency_ms": row["latency_ms"],
                "source": row["source"],
            }
        )

    try:
        for start in range(0, len(predictions), 50):
            sb.table("eval_predictions").insert(predictions[start : start + 50]).execute()
    except Exception as exc:
        try:
            sb.table("eval_runs").delete().eq("id", run_id).execute()
        except Exception:
            pass
        fail(f"gagal insert eval_predictions (run {run_id} dihapus): {str(exc)[:400]}")

    print(f"publish: eval_runs id={run_id}, eval_predictions={len(predictions)} baris")
    return run_id


def mask_nik(raw: str) -> str:
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if len(digits) >= 12:
        return f"{digits[:6]}******{digits[-4:]}"
    if digits:
        return f"{digits[:3]}***{digits[-2:]}"
    return "-"


def main():
    parser = argparse.ArgumentParser(
        description="Ingest + evaluasi + publish metrik OCR batch eval (AIPEX VeriBot).",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Contoh:\n"
            "  python scripts/evaluate-eval-bucket.py --ingest\n"
            "  python scripts/evaluate-eval-bucket.py --publish --base-url http://localhost:3000\n"
            "  python scripts/evaluate-eval-bucket.py --all --base-url http://localhost:3000\n"
            "  python scripts/evaluate-eval-bucket.py --ingest --dry-run\n"
        ),
    )
    parser.add_argument("--batch", default=None, help="batch id (default: EVAL_BATCH_ID / ycwc-001)")
    parser.add_argument("--base-url", default=None, help="base URL server OCR (default: http://localhost:3000)")
    parser.add_argument("--limit", type=int, default=100, help="maksimal label yang dievaluasi (default 100)")
    parser.add_argument("--min-labels", type=int, default=100, help="minimum label agar boleh publish (default 100)")
    parser.add_argument("--env-file", action="append", default=[], help="file env tambahan (boleh diulang)")
    parser.add_argument("--ingest", action="store_true", help="upload foto lokal + insert eval_labels")
    parser.add_argument("--all", action="store_true", help="ingest + evaluasi + publish dalam satu perintah")
    parser.add_argument("--publish", action="store_true", help="insert eval_runs + eval_predictions setelah evaluasi")
    parser.add_argument("--force", action="store_true", help="enkripsi ulang file yang sudah ada (mis. setelah rotasi kunci)")
    parser.add_argument("--allow-partial", action="store_true", help="izinkan publish walau ada file gagal")
    parser.add_argument("--dry-run", action="store_true", help="validasi + enkripsi ingest tanpa upload/DB")
    parser.add_argument("--labels-csv", default=DEFAULT_LABELS_CSV, help="path labels.csv")
    parser.add_argument("--private-dir", default=DEFAULT_PRIVATE_DIR, help="folder foto asli")
    args = parser.parse_args()

    loaded_env = load_env_files(args.env_file)
    batch_id = str(args.batch or os.environ.get("EVAL_BATCH_ID") or DEFAULT_BATCH).strip() or DEFAULT_BATCH
    base_url = str(args.base_url or os.environ.get("EVAL_BASE_URL") or DEFAULT_BASE_URL).strip() or DEFAULT_BASE_URL
    if args.limit <= 0:
        fail("--limit harus > 0")
    if args.min_labels < 0:
        fail("--min-labels tidak boleh negatif")

    do_ingest = bool(args.ingest or args.all)
    do_publish = bool(args.publish or args.all)
    ingest_only = do_ingest and not do_publish

    if args.dry_run and not ingest_only:
        fail("--dry-run hanya berlaku untuk --ingest (tanpa --publish/--all).")

    file_master = loaded_env.get("EVAL_MASTER_KEY")
    if file_master and os.environ.get("EVAL_MASTER_KEY") != file_master:
        print(
            "PERINGATAN: EVAL_MASTER_KEY dari environment berbeda dari file .env. "
            "Server memakai .env.local saat upload; samakan dulu agar tidak gagal dekripsi.",
            file=sys.stderr,
        )

    master = master_key_bytes()
    require_cryptography()

    sb = None if (args.dry_run and ingest_only) else get_supabase()

    if do_ingest:
        labels_path = Path(args.labels_csv)
        private_dir = Path(args.private_dir)
        rows = read_labels_csv(labels_path, private_dir)
        print(f"ingest: {len(rows)} label dari {labels_path} | foto: {private_dir}")
        ingest_rc = ingest_rows(sb, master, batch_id, rows, args.force, args.dry_run)
        if ingest_only:
            raise SystemExit(ingest_rc)
        if ingest_rc != 0:
            fail("ingest gagal; evaluasi dibatalkan. Perbaiki file lalu ulangi.")

    public, results, failed_rows, _ = evaluate(
        sb,
        master,
        batch_id,
        base_url,
        args.limit,
        args.min_labels if (do_publish and not args.allow_partial) else 0,
    )
    if public is None:
        raise SystemExit(1)

    if do_publish:
        # Defense in depth: evaluate() sudah menolak lebih awal bila di bawah ambang.
        if public["n_labels"] < args.min_labels and not args.allow_partial:
            fail(
                f"batch baru {public['n_labels']}/{args.min_labels} label; publikasi dibatalkan. "
                "Lengkapi dulu dataset, atau pakai --allow-partial / --min-labels N untuk uji."
            )
        publish_run(sb, batch_id, public, results, failed_rows, args.allow_partial)


if __name__ == "__main__":
    main()
