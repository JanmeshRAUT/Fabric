# Fabric Defect Detection - Backend API

Flask-based REST API for fabric defect detection using YOLO.

## Setup

1. Install dependencies:
```bash
pip install -r requirements.txt
```

2. Run the server:
```bash
python app.py
```

The API will start on `http://localhost:5000`

## API Endpoints

### POST /api/detect
Upload an image and get fabric defect detections.

**Request:**
- Method: POST
- Content-Type: multipart/form-data
- Body: image file with key 'image'

**Response:**
```json
{
  "success": true,
  "detections": [
    {
      "class": "fabric_hole",
      "confidence": 0.95,
      "bbox": [100, 100, 200, 200]
    }
  ],
  "image": "data:image/jpeg;base64,...",
  "annotated_image": "data:image/jpeg;base64,...",
  "total_detections": 1
}
```

### GET /api/health
Health check endpoint.

### GET /api/model-info
Get information about the loaded YOLO model.

## Model

The API uses the trained model from:
- Primary: `../runs/fabric/yolov8_major_project/weights/best.pt`
- Fallback: `../yolov8s.pt`

## Fabric Defect Classes

1. fabric_broken_pick
2. fabric_hole
3. fabric_missing_pick
4. fabric_perfect
5. fabric_thick_weft
