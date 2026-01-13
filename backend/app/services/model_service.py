import os
from ultralytics import YOLO
from ..config import Config
import glob
from pathlib import Path
import logging

logger = logging.getLogger(__name__)

class ModelManager:
    def __init__(self):
        self.current_model = None
        self.current_model_path = None
        self.available_models = {}
        self.confidence_threshold = Config.DEFAULT_CONFIDENCE
        self.ab_test_enabled = False
        self.ab_test_model_a = None
        self.ab_test_model_b = None
        
        # Initialize
        self.load_available_models()
        self.initialize_primary_model()
    
    def initialize_primary_model(self):
        """Try to load the best model, fallback to standard"""
        # Try configured model first
        if os.path.exists(Config.MODEL_PATH):
            self.load_model(Config.MODEL_PATH)
        # Fallback to base model
        elif os.path.exists(Config.BASE_MODEL_PATH):
            self.load_model(Config.BASE_MODEL_PATH)
        else:
            # If nothing exists, let ultralytics download yolov8s.pt
            self.load_model('yolov8s.pt')
            
    def load_available_models(self):
        """Dynamic scan for available YOLO models (.pt files)"""
        self.available_models = {}
        found_paths = set()

        # 1. Hardcoded critical models (to ensure specific names)
        core_models = {
            'best_custom': Config.MODEL_PATH,
            'yolov8s': Config.BASE_MODEL_PATH,
        }
        
        for name, path in core_models.items():
            if os.path.exists(path) and path not in found_paths:
                self.available_models[name] = {
                    'path': path,
                    'name': name,
                    'exists': True,
                    'source': 'Core',
                    'size': round(os.path.getsize(path) / (1024**2), 2)
                }
                found_paths.add(path)

        # 2. Dynamic Scan in 'runs' folder (Training results)
        runs_dir = os.path.join(Config.PROJECT_ROOT, 'runs')
        if os.path.exists(runs_dir):
            # Find all 'best.pt' or 'last.pt' in runs folder
            for model_path in glob.glob(os.path.join(runs_dir, '**', '*.pt'), recursive=True):
                if model_path in found_paths: continue
                
                # Generate a readable name from path
                # e.g., runs/fabric/yolo_project/weights/best.pt -> "fabric/yolo_project (best)"
                try:
                    rel_path = os.path.relpath(model_path, runs_dir)
                    parts = Path(rel_path).parts
                    if len(parts) >= 3:
                        # parts commonly: [project_name, run_name, 'weights', 'best.pt']
                        name_str = f"{parts[0]}/{parts[1]} ({parts[-1].replace('.pt', '')})"
                    else:
                        name_str = rel_path
                    
                    self.available_models[name_str] = {
                        'path': model_path,
                        'name': name_str,
                        'exists': True,
                        'source': 'Training Run',
                        'size': round(os.path.getsize(model_path) / (1024**2), 2)
                    }
                    found_paths.add(model_path)
                    found_paths.add(model_path)
                except Exception as e:
                    logger.warning(f"Skipping model {model_path}: {e}")

        # 3. Dynamic Scan in Root (Downloaded models)
        for model_path in glob.glob(os.path.join(Config.PROJECT_ROOT, '*.pt')):
            if model_path in found_paths: continue
            
            name = os.path.basename(model_path).replace('.pt', '')
            self.available_models[name] = {
                'path': model_path,
                'name': name,
                'exists': True,
                'source': 'Root',
                'size': round(os.path.getsize(model_path) / (1024**2), 2)
            }
            found_paths.add(model_path)
    
    def load_model(self, model_path):
        """Load YOLO model from path"""
        try:
            logger.info(f"Loading model from: {model_path}")
            self.current_model = YOLO(model_path)
            self.current_model_path = model_path
            return True
        except Exception as e:
            logger.error(f"Error loading model: {e}")
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
            logger.error(f"Error setting up A/B testing: {e}")
            return False
    
    def disable_ab_testing(self):
        """Disable A/B testing"""
        self.ab_test_enabled = False
        self.ab_test_model_a = None
        self.ab_test_model_b = None

# Create singleton instance
model_manager = ModelManager()
