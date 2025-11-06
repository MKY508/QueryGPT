FROM python:3.10-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=5000

WORKDIR /app

# Install system dependencies required by scientific/python packages
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        git \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt ./

RUN pip install --upgrade pip \
    && pip install -r requirements.txt

COPY . /app

# Ensure default configuration files exist for first-run experience
RUN if [ -f .env.example ] && [ ! -f .env ]; then cp .env.example .env; fi \
    && if [ -f config/models.example.json ] && [ ! -f config/models.json ]; then cp config/models.example.json config/models.json; fi \
    && if [ -f config/config.example.json ] && [ ! -f config/config.json ]; then cp config/config.example.json config/config.json; fi

EXPOSE 5000

CMD ["python", "backend/app.py"]

