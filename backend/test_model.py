from ultralytics import YOLO
import os
import cv2
from pathlib import Path

# Class names
CLASS_NAMES = {
    0: 'fabric_broken_pick',
    1: 'fabric_hole', 
    2: 'fabric_missing_pick',
    3: 'fabric_perfect',
    4: 'fabric_thick_weft'
}

def read_yolo_label(label_path):
    """Read YOLO format label file and return list of (class_id, bbox) tuples"""
    labels = []
    if os.path.exists(label_path):
        with open(label_path, 'r') as f:
            for line in f:
                parts = line.strip().split()
                if len(parts) >= 5:
                    class_id = int(parts[0])
                    labels.append(class_id)
    return labels

def get_label_path(img_file, label_dir):
    """Convert image filename to label filename"""
    base_name = os.path.splitext(img_file)[0]
    return os.path.join(label_dir, base_name + '.txt')

# Load model
model_path = os.path.join('..', 'runs', 'fabric', 'yolov8_major_project', 'weights', 'best.pt')
print(f"Loading model from: {os.path.abspath(model_path)}")
model = YOLO(model_path)
print("✓ Model loaded successfully\n")

# Get test images
test_img_dir = os.path.join('..', 'test', 'images')
test_label_dir = os.path.join('..', 'test', 'labels')
images = sorted([f for f in os.listdir(test_img_dir) if f.endswith(('.jpg', '.png', '.jpeg'))])
print(f"✓ Found {len(images)} test images\n")

# Test metrics
total_images = len(images)
images_with_detections = 0
total_detections = 0
detections_by_class = {k: 0 for k in CLASS_NAMES.keys()}

# Accuracy tracking
correct_predictions = 0
incorrect_predictions = 0
no_ground_truth = 0
prediction_details = []

print(f"{'='*80}")
print(f"RUNNING MODEL ON ALL TEST IMAGES WITH GROUND TRUTH COMPARISON")
print(f"{'='*80}\n")

# Test on ALL images
for idx, img_file in enumerate(images, 1):
    test_image = os.path.join(test_img_dir, img_file)
    label_path = get_label_path(img_file, test_label_dir)
    
    # Read ground truth
    ground_truth_classes = read_yolo_label(label_path)
    
    # Run prediction
    results = model.predict(test_image, conf=0.25, save=False, verbose=False)
    
    # Extract predictions
    predicted_classes = []
    if len(results[0].boxes) > 0:
        boxes = results[0].boxes.cpu().numpy()
        for box in boxes:
            class_id = int(box.cls[0])
            confidence = float(box.conf[0])
            predicted_classes.append((class_id, confidence))
            detections_by_class[class_id] += 1
    
    num_detections = len(predicted_classes)
    total_detections += num_detections
    
    if num_detections > 0:
        images_with_detections += 1
    
    # Compare with ground truth
    status = "❓ NO LABEL"
    is_correct = False
    
    if ground_truth_classes:
        # Get most confident prediction
        if predicted_classes:
            predicted_class = predicted_classes[0][0]  # Most confident
            predicted_conf = predicted_classes[0][1]
            
            # Check if prediction matches any ground truth
            if predicted_class in ground_truth_classes:
                status = "✓ CORRECT"
                is_correct = True
                correct_predictions += 1
            else:
                status = "✗ INCORRECT"
                incorrect_predictions += 1
        else:
            status = "✗ MISSED (No detection)"
            incorrect_predictions += 1
    else:
        no_ground_truth += 1
    
    # Store details
    prediction_details.append({
        'file': img_file,
        'ground_truth': ground_truth_classes,
        'predictions': predicted_classes,
        'status': status,
        'is_correct': is_correct
    })
    
    # Print progress
    print(f"[{idx}/{total_images}] {img_file}")
    print(f"   Ground Truth: {[CLASS_NAMES[c] for c in ground_truth_classes] if ground_truth_classes else 'No label'}")
    print(f"   Predictions:  {num_detections}")
    
    if predicted_classes:
        for class_id, conf in predicted_classes:
            class_name = CLASS_NAMES.get(class_id, f"class_{class_id}")
            print(f"      └─ {class_name}: {conf:.2%}")
    
    print(f"   Status: {status}\n")

# Detailed Summary
print(f"\n{'='*80}")
print(f"DETAILED TEST RESULTS")
print(f"{'='*80}\n")

# Show incorrect predictions
print("❌ INCORRECT PREDICTIONS:")
print("-" * 80)
incorrect_count = 0
for detail in prediction_details:
    if not detail['is_correct'] and detail['ground_truth']:
        incorrect_count += 1
        print(f"{incorrect_count}. {detail['file']}")
        print(f"   Expected: {[CLASS_NAMES[c] for c in detail['ground_truth']]}")
        if detail['predictions']:
            print(f"   Got:      {[CLASS_NAMES[c] + f' ({conf:.1%})' for c, conf in detail['predictions']]}")
        else:
            print(f"   Got:      No detections")
        print()

if incorrect_count == 0:
    print("   None! All predictions are correct!\n")

# Overall Summary
print(f"\n{'='*80}")
print(f"OVERALL SUMMARY")
print(f"{'='*80}")
print(f"Total Images Tested:        {total_images}")
print(f"Images with Labels:         {total_images - no_ground_truth}")
print(f"Images without Labels:      {no_ground_truth}")
print(f"\nPrediction Accuracy:")
print(f"  ✓ Correct:                {correct_predictions}")
print(f"  ✗ Incorrect:              {incorrect_predictions}")
print(f"  ❓ No Ground Truth:        {no_ground_truth}")

if (correct_predictions + incorrect_predictions) > 0:
    accuracy = (correct_predictions / (correct_predictions + incorrect_predictions)) * 100
    print(f"\n  📊 Accuracy: {accuracy:.2f}%")

print(f"\nDetection Statistics:")
print(f"  Images with Detections:   {images_with_detections}")
print(f"  Total Detections:         {total_detections}")
print(f"  Avg Detections/Image:     {total_detections/total_images:.2f}")

print(f"\nDetections by Class:")
for class_id, count in sorted(detections_by_class.items(), key=lambda x: x[1], reverse=True):
    if count > 0:
        class_name = CLASS_NAMES[class_id]
        percentage = (count / total_detections * 100) if total_detections > 0 else 0
        print(f"  {class_name:25} {count:4} ({percentage:.1f}%)")

print(f"{'='*80}")
print("✓ Testing complete!")


