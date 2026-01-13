from PIL import Image
import numpy as np
import io
import base64

def process_image(image_file):
    """Convert uploaded file to numpy array"""
    image = Image.open(image_file)
    image = image.convert('RGB')
    return np.array(image)

def image_to_base64(image_array):
    """Convert numpy array to base64 string"""
    # Check if input is numpy array or PIL Image
    if isinstance(image_array, np.ndarray):
        image = Image.fromarray(image_array)
    else:
        image = image_array
        
    buffered = io.BytesIO()
    image.save(buffered, format="JPEG")
    img_str = base64.b64encode(buffered.getvalue()).decode()
    return f"data:image/jpeg;base64,{img_str}"
