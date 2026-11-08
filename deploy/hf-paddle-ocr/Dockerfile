# АЭМЗ Логистика — наш PaddleOCR как Hugging Face Space (Docker).
# Бесплатный тариф Space: 2 vCPU / 16 ГБ RAM — против 4 ГБ на своём стенде.
# Модели детекции и чтения скачиваются при сборке и запекаются в образ:
# первый запрос после деплоя уже тёплый.
FROM python:3.11-slim

# libgl1/libglib2.0 — opencv-contrib; libgomp1 — paddlepaddle
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 libgomp1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY engine.py lexicon.py server.py ./

# 16 ГБ RAM: экономный режим не включится сам (порог 6 ГБ в engine.py) —
# модель живёт в процессе сервера, документ читается за секунды.
# OCR_UPSCALE_BELOW=1600 — мелкие строки на сканах увеличиваются чаще: точность выше,
# памяти хватает (на стенде 4 ГБ было 1100).
ENV PADDLE_OCR_HOST=0.0.0.0 \
    PADDLE_OCR_PORT=7860 \
    PADDLE_PDX_CACHE_HOME=/app/.models \
    OCR_UPSCALE_BELOW=1600

# Прогрев при сборке: тянет PP-OCRv5_server_det + eslav_PP-OCRv5_mobile_rec из HF Hub
RUN python -c "import engine; engine.helper_ocr()"

# HF Spaces выполняет контейнер от uid 1000
RUN useradd -m -u 1000 app && chown -R app:app /app
USER app

EXPOSE 7860
CMD ["python", "server.py"]
