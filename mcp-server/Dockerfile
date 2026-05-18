FROM public.ecr.aws/docker/library/python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

RUN useradd -m -u 1000 agentcore
USER agentcore

EXPOSE 8000

CMD ["python", "-m", "server"]
