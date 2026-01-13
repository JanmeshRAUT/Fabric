from fastapi import FastAPI, UploadFile, File, Form, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import uvicorn
import logging
import os
import io
import json
import base64
from datetime import datetime
import numpy as np
from PIL import Image
from contextlib import asynccontextmanager
from typing import List, Optional

from .config import Config
from .services.model_service import model_manager
from .services.history_service import history_manager
from .utils import process_image, image_to_base64

# Configure Logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s %(levelname)s: %(message)s',
    handlers=[
        logging.FileHandler(os.path.join(Config.BACKEND_DIR, 'logs', 'fabric_defect.log')),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("FabricDefectApp")

# Lifecycle Events
@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Fabric Defect Detection System Starting (FastAPI)...")
    Config.init_app(None) # Ensure directories exist
    yield
    # Shutdown
    logger.info("Shutting down...")

app = FastAPI(
    title="Fabric Defect Detection API",
    version="2.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific frontend origin
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}

def validate_image_file(filename: str):
    if '.' not in filename:
        return False
    ext = filename.rsplit('.', 1)[1].lower()
    return ext in ALLOWED_EXTENSIONS

# Models
@app.get("/api/health")
async def health_check():
    return {
        'status': 'healthy',
        'backend': 'fastapi',
        'model_loaded': model_manager.current_model is not None,
        'model_path': model_manager.current_model_path,
        'confidence_threshold': model_manager.confidence_threshold,
        'ab_test_enabled': model_manager.ab_test_enabled,
        'timestamp': datetime.now().isoformat()
    }

@app.get("/api/models")
async def get_models():
    return {
        'current_model': model_manager.current_model_path,
        'available_models': model_manager.available_models,
        'ab_test_enabled': model_manager.ab_test_enabled,
        'confidence_threshold': model_manager.confidence_threshold
    }

@app.post("/api/models/switch")
async def switch_model(data: dict):
    try:
        model_name = data.get('model_name')
        if model_name not in model_manager.available_models:
            raise HTTPException(status_code=400, detail="Model not found")
        
        model_path = model_manager.available_models[model_name]['path']
        if model_manager.load_model(model_path):
            return {'success': True, 'model': model_name, 'path': model_path}
        else:
            raise HTTPException(status_code=500, detail="Failed to load model")
    except Exception as e:
        logger.error(f"Error switching model: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/detect")
async def detect_defects(
    image: UploadFile = File(...),
    confidence: float = Form(None),
    overlap: float = Form(0.45)
):
    try:
        if not validate_image_file(image.filename):
            logger.warning(f"Invalid file type attempted: {image.filename}")
            raise HTTPException(status_code=400, detail="Invalid file type. Use PNG, JPG, or WebP.")
        
        # Read image
        contents = await image.read()
        pil_image = Image.open(io.BytesIO(contents)).convert('RGB')
        image_array = np.array(pil_image)
        
        # Settings
        conf_thresh = float(confidence) if confidence is not None else model_manager.confidence_threshold
        conf_thresh = max(0.1, min(0.9, conf_thresh))
        
        iou_thresh = max(0.0, min(1.0, float(overlap)))

        # Inference
        results = model_manager.current_model.predict(
            source=image_array,
            conf=conf_thresh,
            iou=iou_thresh,
            save=False,
            verbose=False
        )

        # Process Results
        detections = []
        result = results[0]
        
        if result.boxes is not None and len(result.boxes) > 0:
            boxes = result.boxes.cpu().numpy()
            for box in boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                conf = float(box.conf[0])
                cls_id = int(box.cls[0])
                cls_name = Config.CLASS_NAMES.get(cls_id, f"class_{cls_id}")
                
                detections.append({
                    'class': cls_name,
                    'confidence': conf,
                    'bbox': [int(x1), int(y1), int(x2), int(y2)]
                })
        
        # Images
        annotated_img = result.plot()
        annotated_b64 = image_to_base64(annotated_img)
        original_b64 = image_to_base64(image_array)
        
        response_data = {
            'success': True,
            'detections': detections,
            'image': original_b64,
            'annotated_image': annotated_b64,
            'total_detections': len(detections),
            'confidence_used': conf_thresh,
            'overlap_used': iou_thresh,
            'model_used': model_manager.current_model_path,
            'image_size': {'width': image_array.shape[1], 'height': image_array.shape[0]},
            'timestamp': datetime.now().isoformat()
        }
        
        # Save History
        history_record = {
            'timestamp': response_data['timestamp'],
            'detections': response_data['total_detections'],
            'model': model_manager.current_model_path,
            'confidence': conf_thresh,
            'image_size': response_data['image_size'],
            'detection_classes': list(set([d['class'] for d in detections]))
        }
        history_manager.add_record(history_record)
        
        return response_data

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.error(f"Detection error: {e}", exc_info=True)
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})

@app.get("/api/history")
async def get_history(limit: int = 100):
    return {
        'success': True,
        'history': history_manager.get_history(limit),
        'count': len(history_manager.get_history(limit))
    }

@app.post("/api/history/clear")
async def clear_history():
    history_manager.clear_history()
    return {'success': True}

# --- WebSocket for Live Feed ---
@app.websocket("/ws/detect")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket connected for live detection")
    
    try:
        while True:
            # Receive data (expecting blob/bytes or json config)
            # We expect a JSON string with metadata + base64 image, or just raw bytes?
            # Easier: Client sends JSON: { "image": "base64...", "confidence": 0.25, "overlap": 0.45 }
            data = await websocket.receive_text()
            payload = json.loads(data)
            
            image_data = payload.get("image") # base64 string
            if not image_data:
                continue
                
            # Decode image
            # Remove header if present "data:image/jpeg;base64,"
            if "base64," in image_data:
                image_data = image_data.split("base64,")[1]
            
            image_bytes = base64.b64decode(image_data)
            pil_image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
            image_array = np.array(pil_image)
            
            conf_thresh = float(payload.get("confidence", model_manager.confidence_threshold))
            iou_thresh = float(payload.get("overlap", 0.45))
            
            # Inference
            results = model_manager.current_model.predict(
                source=image_array,
                conf=conf_thresh,
                iou=iou_thresh,
                save=False,
                verbose=False
            )
            
            # Build Result
            result = results[0]
            detections = []
            if result.boxes is not None:
                for box in result.boxes:
                    cls_id = int(box.cls[0])
                    detections.append({
                        'class': Config.CLASS_NAMES.get(cls_id, f"class_{cls_id}"),
                        'confidence': float(box.conf[0]),
                        'bbox': box.xyxy[0].tolist()
                    })
            
            annotated_b64 = image_to_base64(result.plot())
            
            # Send back results
            await websocket.send_json({
                "success": True,
                "annotated_image": annotated_b64,
                "detections": detections,
                "total_detections": len(detections),
                "timestamp": datetime.now().isoformat()
            })
            
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
    except Exception as e:
        logger.error(f"WebSocket error: {e}", exc_info=True)
        # Try to send error if possible, or just close
        try:
            await websocket.send_json({"error": str(e)})
        except:
            pass
