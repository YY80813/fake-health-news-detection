FROM python:3.10-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.py .

# Hugging Face Spaces (Docker SDK) expects the container to listen on 7860
# by default - matches app_port: 7860 in README.md's Space card metadata.
EXPOSE 7860

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "7860"]
