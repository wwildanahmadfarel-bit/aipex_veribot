#!/usr/bin/env python3
"""Evaluasi OCR batch ycwc-001 dari bucket privat eval-fotos → agregat Precision/Recall/F1.

KEBIJAKAN PRIVASI (UU PDP):
- Baca foto via service_role, dekripsi in-memory (AES-256-GCM, EVAL_MASTER_KEY).
- NIK TIDAK PERNAH ditulis ke log/file/DB — mask sebelum catat (maskNik ala store.ts).
- Output publik: eval/results.json (agregat saja). Output privat: eval/results-private.json (gitignored, hapus saat purge).
- Prasyarat env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (atau SUPABASE_KEY), EVAL_MASTER_KEY (hex 64).
- Evaluasi memanggil pipeline OCR yang SAMA dengan warga (POST /api/ocr ke base URL) agar angka jujur.

Pakai:
  pip install supabase requests
  python scripts/evaluate-eval-bucket.py --batch ycwc-001 --base-url http://localhost:3000
"""
import argparse
import base64
import csv
import hashlib
import hmac
import json
import os
import statistics
import sys
import time
from collections import Counter, defaultdict

try:
    import requests
except ImportError:
    print("butuh: pip install requests supabase", file=sys.stderr)
    sys.exit(2)

BATCH_DEFAULT = os.environ.get("EVAL_BATCH_ID", "ycwc-001")
BASE_DEFAULT = os.environ.get("EVAL_BASE_URL", "http://localhost:3000")


def mask_nik(raw: str) -> str:
    s = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if len(s) >= 12:
        return f"{s[:6]}******{s[-4:]}"
    if s:
        return f"{s[:3]}***{s[-2:]}"
    return "-"


def prf(y_true, y_pred, labels):
    out = {}
    for lb in labels:
        tp = sum(1 for t, p in zip(y_true, y_pred) if t == lb and p == lb)
        fp = sum(1 for t, p in zip(y_true, y_pred) if t != lb and p == lb)
        fn = sum(1 for t, p in zip(y_true, y_pred) if t == lb and p != lb)
        prec = tp / (tp + fp) if (tp + fp) else 0.0
        rec = tp / (tp + fn) if (tp + fn) else 0.0
        f1 = 2 * prec * rec / (prec + rec) if (prec + rec) else 0.0
        out[lb] = {"precision": round(prec, 3), "recall": round(rec, 3), "f1": round(f1, 3), "support": sum(1 for t in y_true if t == lb)}
    # macro
    mp = sum(v["precision"] for v in out.values()) / len(out) if out else 0
    mr = sum(v["recall"] for v in out.values()) / len(out) if out else 0
    mf = sum(v["f1"] for v in out.values()) / len(out) if out else 0
    return out, {"precision": round(mp, 3), "recall": round(mr, 3), "f1": round(mf, 3)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", default=BATCH_DEFAULT)
    ap.add_argument("--base-url", default=BASE_DEFAULT)
    ap.add_argument("--limit", type=int, default=100)
    args = ap.parse_args()

    # Lazy import supabase agar --help tetap jalan tanpa dep.
    from supabase import create_client

    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "") or os.environ.get("SUPABASE_KEY", "")
    master = os.environ.get("EVAL_MASTER_KEY", "").strip().lower().replace("0x", "")
    if not url or not key:
        print("SUPABASE_URL / SERVICE_ROLE_KEY kosong", file=sys.stderr)
        sys.exit(2)
    if len(master) != 64:
        print("EVAL_MASTER_KEY harus hex 64 char", file=sys.stderr)
        sys.exit(2)
    master_b = bytes.fromhex(master)

    sb = create_client(url, key)
    labels = sb.table("eval_labels").select("file_id,storage_path,file_hash,jenis_true,status_true,lighting,iv_hex").eq("batch_id", args.batch).limit(args.limit).execute().data or []
    if not labels:
        print(f"tidak ada label batch {args.batch}", file=sys.stderr)
        sys.exit(1)
    print(f"label: {len(labels)} file batch {args.batch}")

    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        use_crypto = True
    except ImportError:
        use_crypto = False
        print("peringatan: paket 'cryptography' tidak ada — dekripsi dilewati, gunakan endpoint run server-side sebagai gantinya", file=sys.stderr)

    results = []
    lat = []
    for row in labels:
        fid = row["file_id"]
        path = row.get("storage_path")
        iv_hex = row.get("iv_hex", "")
        if not path:
            print(f"- {fid}: storage_path null (sudah purge), dilewati")
            continue
        # 1. download .enc + dekripsi
        dl = sb.storage.from_("eval-fotos").download(path)
        payload = dl if isinstance(dl, (bytes, bytearray)) else bytes(dl)
        if use_crypto:
            fkey = hmac.new(master_b, f"eval:{args.batch}:{fid}".encode(), hashlib.sha256).digest()
            iv = bytes.fromhex(iv_hex)
            enc, tag = payload[:-16], payload[-16:]
            plain = AESGCM(fkey).decrypt(iv, enc + tag, None)
        else:
            print(f"- {fid}: lewati (tanpa cryptography)")
            continue
        # 2. panggil OCR yang sama dengan warga
        b64 = base64.b64encode(plain).decode()
        plain = b""  # minimalkan sisa RAM
        t0 = time.time()
        r = requests.post(f"{args.base_url.rstrip('/')}/api/ocr", json={"imageBase64": b64}, timeout=90)
        dt = int((time.time() - t0) * 1000)
        lat.append(dt)
        try:
            j = r.json()
        except Exception:
            j = {}
        d = (j.get("data") or j) if isinstance(j, dict) else {}
        jenis_pred = str(d.get("jenis_dokumen") or "LAINNYA").upper()
        status_pred = str(d.get("status_verifikasi") or "TIDAK_VALID").upper()
        skor = int(d.get("skor_kejelasan") or 0)
        src = str(j.get("source") or d.get("source") or "ai")
        nik_masked = mask_nik(str(d.get("nik") or ""))
        print(f"- {fid}: true={row['jenis_true']}/{row['status_true']} pred={jenis_pred}/{status_pred} skor={skor} {dt}ms src={src} nik={nik_masked}")
        results.append({
            "file_id": fid,
            "jenis_true": row["jenis_true"], "status_true": row["status_true"],
            "jenis_pred": jenis_pred, "status_pred": status_pred,
            "skor": skor, "latency_ms": dt, "source": src,
            "lighting": row.get("lighting"),
        })

    yj_t = [r["jenis_true"] for r in results]
    yj_p = [r["jenis_pred"] for r in results]
    per_jenis, macro = prf(yj_t, yj_p, ["KTP", "KK", "AKTA", "LAINNYA"])
    # F1 khusus LAINNYA + BURAM (status)
    ys_t = [r["status_true"] for r in results]
    ys_p = [r["status_pred"] for r in results]
    _, macro_s = prf(ys_t, ys_p, sorted(set(ys_t + ys_p)) or ["BERHASIL"])
    f1_lainnya = per_jenis.get("LAINNYA", {}).get("f1", 0)
    buram_f1 = 0
    # F1 BURAM dihitung dari status BURAM vs selainnya
    yb_t = ["BURAM" if s == "BURAM" else "BUKAN-BURAM" for s in ys_t]
    yb_p = ["BURAM" if s == "BURAM" else "BUKAN-BURAM" for s in ys_p]
    _, macro_b = prf(yb_t, yb_p, ["BURAM", "BUKAN-BURAM"])
    buram_f1 = dict(zip(["BURAM", "BUKAN-BURAM"], [0, 0]))  # placeholder agar struktur jelas
    # ambil f1 BURAM dari perhitungan biner
    per_b, _ = prf(yb_t, yb_p, ["BURAM", "BUKAN-BURAM"])
    f1_buram = per_b.get("BURAM", {}).get("f1", 0)

    lat_sorted = sorted(lat) if lat else [0]
    p50 = statistics.median(lat_sorted)
    p95 = lat_sorted[max(0, int(len(lat_sorted) * 0.95) - 1)]

    # confusion matrix jenis
    cm = {t: Counter() for t in ["KTP", "KK", "AKTA", "LAINNYA"]}
    for t, p in zip(yj_t, yj_p):
        if t in cm:
            cm[t][p] += 1

    public = {
        "batch_id": args.batch, "n": len(results),
        "precision": macro["precision"], "recall": macro["recall"], "f1": macro["f1"],
        "f1_lainnya": f1_lainnya, "f1_buram": f1_buram,
        "per_jenis": per_jenis,
        "confusion_jenis": {k: dict(v) for k, v in cm.items()},
        "latency_p50": int(p50), "latency_p95": int(p95),
        "notes": "Agregat saja (UU PDP). Foto asli di bucket privat eval-fotos.",
    }
    os.makedirs("eval", exist_ok=True)
    with open("eval/results.json", "w", encoding="utf-8") as f:
        json.dump(public, f, ensure_ascii=False, indent=2)
    with open("eval/results-private.json", "w", encoding="utf-8") as f:
        json.dump({"public": public, "per_file": results}, f, ensure_ascii=False, indent=2)
    print(f"\nOK n={len(results)} F1={macro['f1']} F1_LAINNYA={f1_lainnya} F1_BURAM={f1_buram} p50={int(p50)}ms p95={int(p95)}ms")
    print("publik: eval/results.json | privat (gitignored): eval/results-private.json")


if __name__ == "__main__":
    main()
