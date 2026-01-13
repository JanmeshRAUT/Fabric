"""
=========================================================
FABRIC DEFECT DETECTION - FLASK BACKEND API
Integrates YOLO model with React frontend

Endpoints:
- POST /api/detect - Upload image and get detections
- GET /api/health - Health check
- GET /api/models - Get available models
- POST /api/models/switch - Switch active model
- GET /api/history - Get detection history
- POST /api/history/save - Save result to history
- GET /api/history/export - Export history as JSON/CSV
=========================================================
"""

from flask import Flask, request, jsonify, send_file
from flask_cors import CORS
from ultralytics import YOLO
import os
import cv2
import numpy as np
from PIL import Image
import io
import base64
import json
import csv
from datetime import datetime
from pathlib import Path

app = Flask(__name__)
CORS(app)  # Enable CORS for React frontend

# =========================================================
# CONFIGURATION
# =========================================================
# Get the absolute path to the backend directory
BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BACKEND_DIR)

# Use the best trained model from runs folder
MODEL_PATH = os.path.join(PROJECT_ROOT, 'runs', 'fabric', 'yolov8_major_project', 'weights', 'best.pt')

# Fallback to pre-trained if custom model doesn't exist
if not os.path.exists(MODEL_PATH):
    MODEL_PATH = os.path.join(PROJECT_ROOT, 'yolov8s.pt')
    if not os.path.exists(MODEL_PATH):
        MODEL_PATH = 'yolov8s.pt'  # Will download if not exists

UPLOAD_FOLDER = os.path.join(BACKEND_DIR, 'uploads')
RESULTS_FOLDER = os.path.join(BACKEND_DIR, 'results')
HISTORY_FILE = os.path.join(BACKEND_DIR, 'detection_history.json')
CONFIDENCE_THRESHOLD = 0.25

# Class names from data.yaml - matches the trained model
CLASS_NAMES = {
    0: 'fabric_broken_pick',
    1: 'fabric_hole', 
    2: 'fabric_missing_pick',
    3: 'fabric_perfect',
    4: 'fabric_thick_weft'
}

# Create necessary folders
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(RESULTS_FOLDER, exist_ok=True)

# =========================================================
# GLOBAL STATE FOR MODEL MANAGEMENT
# =========================================================
class ModelManager:
    def __init__(self):
        self.current_model = None
        self.current_model_path = MODEL_PATH
        self.available_models = {}
        self.confidence_threshold = CONFIDENCE_THRESHOLD
        self.ab_test_enabled = False
        self.ab_test_model_a = None
        self.ab_test_model_b = None
        self.load_available_models()
        self.load_model(MODEL_PATH)
    
    def load_available_models(self):
        """Scan for available models"""
        self.available_models = {}
        
        # Add default models
        default_models = {
            'best': os.path.join(PROJECT_ROOT, 'runs', 'fabric', 'yolov8_major_project', 'weights', 'best.pt'),
            'yolov8s': os.path.join(PROJECT_ROOT, 'yolov8s.pt'),
            'yolov8n': os.path.join(PROJECT_ROOT, 'yolov11n.pt'),
        }
        
        for name, path in default_models.items():
            if os.path.exists(path):
                self.available_models[name] = {
                    'path': path,
                    'name': name,
                    'exists': True,
                    'size': os.path.getsize(path) / (1024**2)  # MB
                }
    
    def load_model(self, model_path):
        """Load YOLO model from path"""
        try:
            self.current_model = YOLO(model_path)
            self.current_model_path = model_path
            return True
        except Exception as e:
            print(f"Error loading model: {e}")
            return False
    
    def set_confidence_threshold(self, threshold):
        """Set confidence threshold"""
        self.confidence_threshold = max(0.1, min(0.9, threshold))
    
    def enable_ab_testing(self, model_a_path, model_b_path):
        """Enable A/B testing with two models"""
        try:
            self.ab_test_model_a = YOLO(model_a_path)
            self.ab_test_model_b = YOLO(model_b_path)
            self.ab_test_enabled = True
            return True
        except Exception as e:
            print(f"Error setting up A/B testing: {e}")
            return False
    
    def disable_ab_testing(self):
        """Disable A/B testing"""
        self.ab_test_enabled = False
        self.ab_test_model_a = None
        self.ab_test_model_b = None

model_manager = ModelManager()

# =========================================================
# HISTORY MANAGEMENT
# =========================================================
class HistoryManager:
    def __init__(self, history_file):
        self.history_file = history_file
        self.history = self.load_history()
    
    def load_history(self):
        """Load history from JSON file"""
        if os.path.exists(self.history_file):
            try:
                with open(self.history_file, 'r') as f:
                    return json.load(f)
            except:
                return []
        return []
    
    def save_history(self):
        """Save history to JSON file"""
        try:
            with open(self.history_file, 'w') as f:
                json.dump(self.history, f, indent=2)
            return True
        except:
            return False
    
    def add_record(self, record):
        """Add detection result to history"""
        self.history.append(record)
        self.save_history()
    
    def get_history(self, limit=100):
        """Get recent history records"""
        return self.history[-limit:]
    
    def clear_history(self):
        """Clear all history"""
        self.history = []
        self.save_history()

history_manager = HistoryManager(HISTORY_FILE)

# =========================================================
# LOAD YOLO MODEL
# =========================================================
print(f"Loading YOLO model from: {MODEL_PATH}")
print(f"Model loaded successfully!")

# =========================================================
# HELPER FUNCTIONS
# =========================================================
def process_image(image_file):
    """Convert uploaded file to numpy array"""
    image = Image.open(image_file)
    image = image.convert('RGB')
    return np.array(image)

def image_to_base64(image_array):
    """Convert numpy array to base64 string"""
    image = Image.fromarray(image_array)
    buffered = io.BytesIO()
    image.save(buffered, format="JPEG")
    img_str = base64.b64encode(buffered.getvalue()).decode()
    return f"data:image/jpeg;base64,{img_str}"

# =========================================================
# API ENDPOINTS
# =========================================================
@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'model_loaded': model_manager.current_model is not None,
        'model_path': model_manager.current_model_path,
        'confidence_threshold': model_manager.confidence_threshold,
        'ab_test_enabled': model_manager.ab_test_enabled,
        'timestamp': datetime.now().isoformat()
    })

@app.route('/api/models', methods=['GET'])
def get_models():
    """Get available models"""
    return jsonify({
        'current_model': model_manager.current_model_path,
        'available_models': model_manager.available_models,
        'ab_test_enabled': model_manager.ab_test_enabled,
        'confidence_threshold': model_manager.confidence_threshold
    })

@app.route('/api/models/switch', methods=['POST'])
def switch_model():
    """Switch to different model"""
    try:
        data = request.get_json()
        model_name = data.get('model_name')
        
        if model_name not in model_manager.available_models:
            return jsonify({'error': 'Model not found'}), 400
        
        model_path = model_manager.available_models[model_name]['path']
        if model_manager.load_model(model_path):
            return jsonify({
                'success': True,
                'model': model_name,
                'path': model_path
            })
        else:
            return jsonify({'error': 'Failed to load model'}), 500
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/models/confidence', methods=['POST'])
def set_confidence():
    """Set confidence threshold"""
    try:
        data = request.get_json()
        threshold = float(data.get('threshold', 0.25))
        model_manager.set_confidence_threshold(threshold)
        
        return jsonify({
            'success': True,
            'threshold': model_manager.confidence_threshold
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/models/ab-test', methods=['POST'])
def setup_ab_test():
    """Setup A/B testing with two models"""
    try:
        data = request.get_json()
        model_a = data.get('model_a')
        model_b = data.get('model_b')
        
        if model_a not in model_manager.available_models or model_b not in model_manager.available_models:
            return jsonify({'error': 'One or both models not found'}), 400
        
        model_a_path = model_manager.available_models[model_a]['path']
        model_b_path = model_manager.available_models[model_b]['path']
        
        if model_manager.enable_ab_testing(model_a_path, model_b_path):
            return jsonify({
                'success': True,
                'model_a': model_a,
                'model_b': model_b
            })
        else:
            return jsonify({'error': 'Failed to setup A/B testing'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/models/ab-test/disable', methods=['POST'])
def disable_ab_test():
    """Disable A/B testing"""
    model_manager.disable_ab_testing()
    return jsonify({'success': True})

@app.route('/api/detect', methods=['POST'])
def detect_defects():
    """
    Main detection endpoint
    Accepts: multipart/form-data with 'image' file and optional 'confidence' value
    Returns: JSON with detections and annotated image
    """
    try:
        # Check if image is in request
        if 'image' not in request.files:
            return jsonify({'error': 'No image provided'}), 400
        
        file = request.files['image']
        
        if file.filename == '':
            return jsonify({'error': 'No image selected'}), 400
        
        # Get confidence threshold from request or use global
        confidence_threshold = float(request.form.get('confidence', model_manager.confidence_threshold))
        confidence_threshold = max(0.1, min(0.9, confidence_threshold))
        
        # Process the image
        image_array = process_image(file)
        
        # Run YOLO inference with custom confidence threshold
        results = model_manager.current_model.predict(
            source=image_array,
            conf=confidence_threshold,
            save=False,
            verbose=False
        )
        
        # Extract detections
        detections = []
        result = results[0]
        
        if result.boxes is not None and len(result.boxes) > 0:
            boxes = result.boxes.cpu().numpy()
            
            for box in boxes:
                # Get box coordinates
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                confidence = float(box.conf[0])
                class_id = int(box.cls[0])
                class_name = CLASS_NAMES.get(class_id, f"class_{class_id}")
                
                detections.append({
                    'class': class_name,
                    'confidence': confidence,
                    'bbox': [int(x1), int(y1), int(x2), int(y2)]
                })
        
        # Get annotated image
        annotated_image = result.plot()
        annotated_image_base64 = image_to_base64(annotated_image)
        
        # Get original image as base64
        original_image_base64 = image_to_base64(image_array)
        
        # Prepare response
        response = {
            'success': True,
            'detections': detections,
            'image': original_image_base64,
            'annotated_image': annotated_image_base64,
            'total_detections': len(detections),
            'confidence_used': confidence_threshold,
            'model_used': model_manager.current_model_path,
            'image_size': {
                'width': image_array.shape[1],
                'height': image_array.shape[0]
            },
            'timestamp': datetime.now().isoformat()
        }
        
        # Save to history
        history_record = {
            'timestamp': response['timestamp'],
            'detections': response['total_detections'],
            'model': model_manager.current_model_path,
            'confidence': confidence_threshold,
            'image_size': response['image_size'],
            'detection_classes': list(set([d['class'] for d in detections]))
        }
        history_manager.add_record(history_record)
        
        return jsonify(response)
    
    except Exception as e:
        print(f"Error during detection: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/detect/ab-test', methods=['POST'])
def detect_ab_test():
    """Run A/B test with both models"""
    try:
        if not model_manager.ab_test_enabled:
            return jsonify({'error': 'A/B testing not enabled'}), 400
        
        if 'image' not in request.files:
            return jsonify({'error': 'No image provided'}), 400
        
        file = request.files['image']
        confidence_threshold = float(request.form.get('confidence', model_manager.confidence_threshold))
        confidence_threshold = max(0.1, min(0.9, confidence_threshold))
        
        # Process image
        image_array = process_image(file)
        
        # Run both models
        results_a = model_manager.ab_test_model_a.predict(
            source=image_array,
            conf=confidence_threshold,
            save=False,
            verbose=False
        )
        
        results_b = model_manager.ab_test_model_b.predict(
            source=image_array,
            conf=confidence_threshold,
            save=False,
            verbose=False
        )
        
        def extract_detections(result):
            detections = []
            if result.boxes is not None and len(result.boxes) > 0:
                boxes = result.boxes.cpu().numpy()
                for box in boxes:
                    x1, y1, x2, y2 = box.xyxy[0].tolist()
                    confidence = float(box.conf[0])
                    class_id = int(box.cls[0])
                    class_name = CLASS_NAMES.get(class_id, f"class_{class_id}")
                    detections.append({
                        'class': class_name,
                        'confidence': confidence,
                        'bbox': [int(x1), int(y1), int(x2), int(y2)]
                    })
            return detections
        
        detections_a = extract_detections(results_a[0])
        detections_b = extract_detections(results_b[0])
        
        return jsonify({
            'success': True,
            'ab_test': True,
            'model_a': {
                'detections': detections_a,
                'total': len(detections_a),
                'annotated_image': image_to_base64(results_a[0].plot())
            },
            'model_b': {
                'detections': detections_b,
                'total': len(detections_b),
                'annotated_image': image_to_base64(results_b[0].plot())
            },
            'timestamp': datetime.now().isoformat()
        })
    
    except Exception as e:
        print(f"Error during A/B test: {str(e)}")
        return jsonify({'error': str(e)}), 500

@app.route('/api/history', methods=['GET'])
def get_history():
    """Get detection history"""
    try:
        limit = request.args.get('limit', 100, type=int)
        history = history_manager.get_history(limit)
        return jsonify({
            'success': True,
            'history': history,
            'count': len(history)
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/history/clear', methods=['POST'])
def clear_history():
    """Clear detection history"""
    try:
        history_manager.clear_history()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/history/export', methods=['GET'])
def export_history():
    """Export history as JSON or CSV"""
    try:
        export_format = request.args.get('format', 'json').lower()
        history = history_manager.history
        
        if export_format == 'csv':
            # Create CSV
            output = io.StringIO()
            if history:
                writer = csv.DictWriter(output, fieldnames=history[0].keys())
                writer.writeheader()
                writer.writerows(history)
            
            output.seek(0)
            return jsonify({
                'success': True,
                'format': 'csv',
                'data': output.getvalue()
            })
        else:
            # JSON format
            return jsonify({
                'success': True,
                'format': 'json',
                'data': history
            })
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/model-info', methods=['GET'])
def model_info():
    """Get information about the loaded model"""
    return jsonify({
        'model_path': model_manager.current_model_path,
        'classes': list(CLASS_NAMES.values()),
        'num_classes': len(CLASS_NAMES),
        'confidence_threshold': model_manager.confidence_threshold,
        'model_exists': os.path.exists(model_manager.current_model_path),
        'available_models': list(model_manager.available_models.keys()),
        'ab_test_enabled': model_manager.ab_test_enabled
    })

# =========================================================
# RUN SERVER
# =========================================================
if __name__ == '__main__':
    print("\n" + "="*60)
    print("🚀 FABRIC DEFECT DETECTION API SERVER")
    print("="*60)
    print(f"📊 Model: {model_manager.current_model_path}")
    print(f"🎯 Classes: {', '.join(CLASS_NAMES.values())}")
    print(f"🌐 Server running on: http://localhost:5000")
    print(f"📡 API Endpoint: http://localhost:5000/api/detect")
    print("="*60 + "\n")
    
    app.run(debug=True, host='0.0.0.0', port=5000)
