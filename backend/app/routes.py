from flask import Blueprint, request, jsonify, current_app
from datetime import datetime
import os
import csv
import io
from .config import Config
from .services.model_service import model_manager
from .services.history_service import history_manager
from .utils import process_image, image_to_base64
import logging

main_bp = Blueprint('main', __name__)

ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'webp'}

def allowed_file(filename):
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@main_bp.route('/api/health', methods=['GET'])
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

@main_bp.route('/api/models', methods=['GET'])
def get_models():
    """Get available models"""
    return jsonify({
        'current_model': model_manager.current_model_path,
        'available_models': model_manager.available_models,
        'ab_test_enabled': model_manager.ab_test_enabled,
        'confidence_threshold': model_manager.confidence_threshold
    })

@main_bp.route('/api/models/switch', methods=['POST'])
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

@main_bp.route('/api/models/confidence', methods=['POST'])
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

@main_bp.route('/api/models/ab-test', methods=['POST'])
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

@main_bp.route('/api/models/ab-test/disable', methods=['POST'])
def disable_ab_test():
    """Disable A/B testing"""
    model_manager.disable_ab_testing()
    return jsonify({'success': True})

@main_bp.route('/api/detect', methods=['POST'])
def detect_defects():
    """Main detection endpoint"""
    try:
        # Check if image is in request
        if 'image' not in request.files:
            return jsonify({'error': 'No image provided'}), 400
        
        file = request.files['image']
        if file.filename == '':
            return jsonify({'error': 'No image selected'}), 400
            
        if not allowed_file(file.filename):
            current_app.logger.warning(f"Invalid file type attempted: {file.filename}")
            return jsonify({'error': 'File type not allowed. Use PNG, JPG, or WebP.'}), 400
        
        # Get confidence threshold and overlap (IOU)
        confidence_threshold = float(request.form.get('confidence', model_manager.confidence_threshold))
        confidence_threshold = max(0.1, min(0.9, confidence_threshold))
        
        overlap_threshold = float(request.form.get('overlap', 0.45))
        overlap_threshold = max(0.0, min(1.0, overlap_threshold))
        
        # Process image
        image_array = process_image(file)
        
        # Run YOLO inference
        results = model_manager.current_model.predict(
            source=image_array,
            conf=confidence_threshold,
            iou=overlap_threshold,
            save=False,
            verbose=False
        )
        
        # Extract detections
        detections = []
        result = results[0]
        
        if result.boxes is not None and len(result.boxes) > 0:
            boxes = result.boxes.cpu().numpy()
            for box in boxes:
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                confidence = float(box.conf[0])
                class_id = int(box.cls[0])
                class_name = Config.CLASS_NAMES.get(class_id, f"class_{class_id}")
                
                detections.append({
                    'class': class_name,
                    'confidence': confidence,
                    'bbox': [int(x1), int(y1), int(x2), int(y2)]
                })
        
        # Prepare response images
        annotated_image = result.plot()
        annotated_image_base64 = image_to_base64(annotated_image)
        original_image_base64 = image_to_base64(image_array)
        
        response = {
            'success': True,
            'detections': detections,
            'image': original_image_base64,
            'annotated_image': annotated_image_base64,
            'total_detections': len(detections),
            'confidence_used': confidence_threshold,
            'overlap_used': overlap_threshold,
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
        current_app.logger.error(f"Error during detection: {str(e)}", exc_info=True)
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@main_bp.route('/api/history', methods=['GET'])
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

@main_bp.route('/api/history/clear', methods=['POST'])
def clear_history():
    """Clear detection history"""
    try:
        history_manager.clear_history()
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@main_bp.route('/api/model-info', methods=['GET'])
def model_info():
    """Get information about the loaded model"""
    return jsonify({
        'model_path': model_manager.current_model_path,
        'classes': list(Config.CLASS_NAMES.values()),
        'num_classes': len(Config.CLASS_NAMES),
        'confidence_threshold': model_manager.confidence_threshold,
        'model_exists': os.path.exists(model_manager.current_model_path) if model_manager.current_model_path else False,
        'available_models': list(model_manager.available_models.keys()),
        'ab_test_enabled': model_manager.ab_test_enabled
    })

@main_bp.route('/api/detect/ab-test', methods=['POST'])
def detect_ab_test():
    """Run A/B test with both models"""
    try:
        if not model_manager.ab_test_enabled:
            return jsonify({'error': 'A/B testing not enabled'}), 400
        
        if 'image' not in request.files:
            return jsonify({'error': 'No image provided'}), 400
        
        file = request.files['image']
        
        # Get thresholds
        confidence_threshold = float(request.form.get('confidence', model_manager.confidence_threshold))
        confidence_threshold = max(0.1, min(0.9, confidence_threshold))
        
        overlap_threshold = float(request.form.get('overlap', 0.45))
        overlap_threshold = max(0.0, min(1.0, overlap_threshold))
        
        # Process image
        image_array = process_image(file)
        
        # Run both models with NMS settings
        results_a = model_manager.ab_test_model_a.predict(
            source=image_array,
            conf=confidence_threshold,
            iou=overlap_threshold,
            save=False,
            verbose=False
        )
        
        results_b = model_manager.ab_test_model_b.predict(
            source=image_array,
            conf=confidence_threshold,
            iou=overlap_threshold,
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
                    class_name = Config.CLASS_NAMES.get(class_id, f"class_{class_id}")
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
        current_app.logger.error(f"Error during A/B test: {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500

@main_bp.route('/api/history/export', methods=['GET'])
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

