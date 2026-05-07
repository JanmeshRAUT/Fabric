# Use Python 3.10
FROM python:3.10-slim

# Install system dependencies for OpenCV and YOLO
RUN apt-get update && apt-get install -y \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the backend code
COPY . .

# Create logs and result directories
RUN mkdir -p logs results uploads

# Set environment variables
ENV PORT=7860
ENV PYTHONUNBUFFERED=1

# Expose the port HF Spaces expects
EXPOSE 7860

# Run the application
# We use uvicorn directly to ensure it binds to the correct port
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "7860"]
