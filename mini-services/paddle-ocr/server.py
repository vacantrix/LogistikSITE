"""Локальный OCR-сервис АЭМЗ Логистика: PaddleOCR на нашем сервере, фото никуда не уходят.

Слушает только 127.0.0.1 (по умолчанию порт 3031). Принимает JPG, PNG, WebP и PDF (распознаётся первая
страница — так присылают доверенности). Два формата запроса на POST /ocr:
  — платформы (src/lib/ocr-service.ts):   { type, dataUri, intake? } → { ok, ocr: {...} }
  — OCR-шлюза (mini-services/ocr-service): { image, docType, fields? } → { quality, fields, ... }
GET /health — статус для экрана «Цепочка распознавания».

Запуск:  python server.py            (переменные: PADDLE_OCR_PORT, OCR_SERVICE_TOKEN)
Платформа напрямую:  OCR_SERVICE_URL=http://127.0.0.1:3031
Через шлюз на bun:   PADDLE_OCR_URL=http://127.0.0.1:3031/ocr (значение по умолчанию)
"""
import base64
import json
import os
import re
import tempfile
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
import pypdfium2 as pdfium

import engine

VERSION = "1.1.0"
HOST = "127.0.0.1"
PORT = int(os.environ.get("PADDLE_OCR_PORT", "3031"))
TOKEN = os.environ.get("OCR_SERVICE_TOKEN", "")
MAX_BODY = 16_000_000          # ~12 МБ изображения в base64
MAX_SIDE = 3000                # крупнее — уменьшаем: точность та же, время меньше
PDF_DPI = 200                  # страницу PDF рисуем в 200 dpi — как обычный скан
STARTED = time.time()
LOCK = threading.Lock()        # PaddleOCR не потокобезопасен — распознаём по одному
STATE = {"processed": 0, "ready": False, "last_engine": None}
ENGINE_NAME = "PaddleOCR (локально)"
DATA_URI_RE = re.compile(r"^data:(image/(?:jpeg|jpg|png|webp)|application/pdf);base64,(.+)$", re.S | re.I)


def pdf_first_page(raw):
    """Первая страница PDF → изображение BGR (или None, если файл не PDF или повреждён)."""
    if not raw.startswith(b"%PDF-"):
        return None
    try:
        doc = pdfium.PdfDocument(raw)
        try:
            if len(doc) == 0:
                return None
            page = doc[0]
            # страница нестандартного размера не должна превратиться в гигантскую картинку
            scale = min(PDF_DPI / 72, MAX_SIDE / max(1.0, *page.get_size()))
            pil = page.render(scale=scale).to_pil().convert("RGB")
        finally:
            doc.close()
    except pdfium.PdfiumError:
        return None
    return cv2.cvtColor(np.asarray(pil), cv2.COLOR_RGB2BGR)


def decode_image(data_uri):
    """dataUri → путь к временному JPG (или None). Чужие форматы (SVG и пр.) не принимаются."""
    m = DATA_URI_RE.match(data_uri or "")
    if not m:
        return None
    try:
        raw = base64.b64decode(m.group(2), validate=False)
    except ValueError:
        return None
    if m.group(1).lower() == "application/pdf":
        img = pdf_first_page(raw)
    else:
        img = cv2.imdecode(np.frombuffer(raw, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        return None
    h, w = img.shape[:2]
    if max(h, w) > MAX_SIDE:
        k = MAX_SIDE / max(h, w)
        img = cv2.resize(img, (int(w * k), int(h * k)), interpolation=cv2.INTER_AREA)
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 95])
    if not ok:
        return None
    fd, path = tempfile.mkstemp(suffix=".jpg", prefix="aemz-ocr-")
    with os.fdopen(fd, "wb") as fh:
        fh.write(buf.tobytes())
    return path


def warmup():
    """Модели НЕ держим в памяти диспетчера (Task 83, стенд 4 ГБ): каждый запрос
    обслуживает короткоживущий процесс (см. analyze_subprocess) — он грузит одну
    модель, распознаёт ОДИН документ и возвращает память системе. Диспетчер лёгкий,
    OOM-killer не страшен; цена — ~10–20 с на загрузку модели в каждом запросе
    (на сервере с запасом RAM можно вернуть тёплые модели)."""
    STATE["ready"] = True
    print("[paddle-ocr] диспетчер готов: модели — по запросу, в отдельном процессе", flush=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "aemz-paddle-ocr/" + VERSION

    def log_message(self, fmt, *args):  # без содержимого запросов в логах — там персональные данные
        print(f"[paddle-ocr] {self.command} {self.path.split('?')[0]} → {args[1] if len(args) > 1 else ''}", flush=True)

    def send_json(self, data, status=200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def authorized(self):
        return not TOKEN or self.headers.get("X-OCR-Token") == TOKEN

    def do_GET(self):
        if not self.authorized():
            return self.send_json({"ok": False, "error": "forbidden"}, 403)
        if self.path.split("?")[0] != "/health":
            return self.send_json({"ok": False, "error": "not found"}, 404)
        self.send_json({
            "ok": True,
            "service": "aemz-paddle-ocr",
            "description": "Локальное распознавание документов (PaddleOCR) — фото не покидают сервер",
            "version": VERSION,
            "ready": STATE["ready"],
            "engines": {"paddle": {"configured": True, "engine": ENGINE_NAME}},
            "supported": sorted(engine.SUPPORTED),
            "activeEngine": STATE["last_engine"],
            "processed": STATE["processed"],
            "uptimeSec": int(time.time() - STARTED),
            "time": datetime.now(timezone.utc).isoformat(),
        })

    def do_POST(self):
        if not self.authorized():
            return self.send_json({"ok": False, "error": "forbidden"}, 403)
        if self.path.split("?")[0] != "/ocr":
            return self.send_json({"ok": False, "error": "not found"}, 404)
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            return self.send_json({"ok": False, "error": "пустой или слишком большой запрос"}, 413)
        try:
            body = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            return self.send_json({"ok": False, "error": "некорректный JSON"}, 400)

        platform = "dataUri" in body
        doc = body.get("type") if platform else body.get("docType")
        data_uri = body.get("dataUri") if platform else body.get("image")
        if doc not in engine.SUPPORTED:
            # заявка — свободная форма, шаблона нет: платформа отправит на ручную сверку
            return self.send_json({"ok": False, "error": f"вид документа {doc} не поддерживается"}, 422)

        path = decode_image(data_uri)
        if not path:
            return self.send_json({"ok": False, "error": "нужно изображение JPG, PNG, WebP или PDF"}, 400)
        # Task 83 — две нейросети по кнопкам платформы: "fast" (лёгкая, «Автозаполнение»),
        # "accurate" (точная, «Проверить»); без mode — прежний автопободор режима
        mode = body.get("mode")
        if mode not in ("fast", "accurate"):
            mode = None
        t0 = time.time()
        try:
            with LOCK:
                # Task 83: все запросы — в короткоживущем процессе: одна модель на документ,
                # память возвращается системе (на стенде 4 ГБ иначе OOM-killer).
                res = engine.analyze_subprocess(path, mode)
            STATE["ready"] = True
        except Exception as e:  # noqa: BLE001
            print(f"[paddle-ocr] ошибка распознавания: {type(e).__name__}: {e}", flush=True)
            return self.send_json({"ok": False, "error": "ошибка распознавания"}, 500)
        finally:
            try:
                os.unlink(path)
            except OSError:
                pass
        STATE["processed"] += 1
        STATE["last_engine"] = ENGINE_NAME
        print(f"[paddle-ocr] {doc}: распознан {res['docType']}, качество {res['quality']}, {time.time() - t0:.1f} с", flush=True)

        ocr = {
            "engine": ENGINE_NAME,
            "quality": res["quality"],
            "fields": res["fields"],
            "confidences": res["confidences"],
            "detectedType": res["docType"],
            "confirmations": res["confirmations"],
            "engineMode": res.get("engineMode") or mode or "fast",
            **({"side": res["side"]} if res.get("side") else {}),
        }
        if platform:
            return self.send_json({"ok": True, "ocr": ocr})
        return self.send_json({**ocr, "docType": res["docType"]})


def main():
    threading.Thread(target=warmup, daemon=True).start()
    srv = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[paddle-ocr] слушает http://{HOST}:{PORT}", flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
