import os

class Config:
    # Base paths
    APP_DIR = os.path.dirname(os.path.abspath(__file__))
    BACKEND_DIR = os.path.dirname(APP_DIR)
    PROJECT_ROOT = os.path.dirname(BACKEND_DIR)

    # Model Configuration
    # In HF Spaces, we'll put models in the root or a 'models' folder
    MODEL_REPO = os.environ.get('HF_MODEL_REPO', 'JerryJR1705/fabricModel')
    MODEL_PATH = os.environ.get('MODEL_PATH', os.path.join(PROJECT_ROOT, 'runs', 'fabric', 'yolov8_major_project', 'weights', 'best.pt'))
    
    # Fallback paths
    BASE_MODEL_PATH = os.environ.get('BASE_MODEL_PATH', os.path.join(PROJECT_ROOT, 'yolov8s.pt'))
    if not os.path.exists(BASE_MODEL_PATH):
        # Try relative to backend dir
        BASE_MODEL_PATH = os.path.join(BACKEND_DIR, 'yolov8s.pt')
    if not os.path.exists(BASE_MODEL_PATH):
        # Try root inside container
        BASE_MODEL_PATH = '/app/yolov8s.pt'
    
    # Data Storage
    UPLOAD_FOLDER = os.path.join(BACKEND_DIR, 'uploads')
    RESULTS_FOLDER = os.path.join(BACKEND_DIR, 'results')
    HISTORY_FILE = os.path.join(BACKEND_DIR, 'detection_history.json')
    
    # Defaults
    DEFAULT_CONFIDENCE = 0.25
    
    # Class mapping
    CLASS_NAMES = {
        0: 'fabric_broken_pick',
        1: 'fabric_hole', 
        2: 'fabric_missing_pick',
        3: 'fabric_perfect',
        4: 'fabric_thick_weft'
    }

    @staticmethod
    def init_app(app):
        # Create necessary directories
        os.makedirs(Config.UPLOAD_FOLDER, exist_ok=True)
        os.makedirs(Config.RESULTS_FOLDER, exist_ok=True)
