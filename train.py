"""
=========================================================
MAJOR PROJECT – FABRIC DEFECT DETECTION
YOLOv8 PRODUCTION TRAINING PIPELINE

Author  : <Your Name>
GPU     : NVIDIA RTX 3050 (6GB)
Model   : YOLOv8 (Ultralytics)
Purpose : Small fabric defect detection (holes, broken pick)

Run:
python train.py
=========================================================
"""

from ultralytics import YOLO
import torch
import os
import random
import numpy as np


# =========================================================
# 1️⃣ GLOBAL CONFIGURATION
# =========================================================
DATA_YAML = "data.yaml"
PROJECT_DIR = "runs/fabric"
RUN_NAME = "yolov8_major_project"

MODEL_NAME = "yolov8s.pt"   # Will also compare with yolov8n
IMG_SIZE = 768              # Optimal for RTX 3050
BATCH_SIZE = 8
EPOCHS = 160
WORKERS = 4
SEED = 42


# =========================================================
# 2️⃣ REPRODUCIBILITY (FULL)
# =========================================================
def set_seed(seed=42):
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


# =========================================================
# 3️⃣ TRAINING FUNCTION
# =========================================================
def train():
    set_seed(SEED)

    # -----------------------------
    # GPU CHECK
    # -----------------------------
    print("=========================================")
    print("CUDA Available :", torch.cuda.is_available())
    if torch.cuda.is_available():
        print("GPU           :", torch.cuda.get_device_name(0))
    print("=========================================")

    # -----------------------------
    # Resume Logic
    # -----------------------------
    run_path = os.path.join(PROJECT_DIR, RUN_NAME, "weights")
    last_ckpt = os.path.join(run_path, "last.pt")

    if os.path.exists(last_ckpt):
        print("🔄 Resuming training from checkpoint")
        model = YOLO(last_ckpt)
    else:
        print("🚀 Starting fresh training")
        model = YOLO(MODEL_NAME)

    # -----------------------------
    # TRAINING
    # -----------------------------
    model.train(
        data=DATA_YAML,
        epochs=EPOCHS,
        imgsz=IMG_SIZE,
        batch=BATCH_SIZE,
        device=0,
        workers=WORKERS,
        seed=SEED,

        # 🔥 OPTIMIZER & LR
        optimizer="AdamW",
        lr0=0.001,
        lrf=0.01,
        cos_lr=True,
        warmup_epochs=3,
        weight_decay=0.0005,

        # 🧵 FABRIC-SAFE AUGMENTATION
        mosaic=1.0,
        mixup=0.1,
        hsv_h=0.015,
        hsv_s=0.7,
        hsv_v=0.4,
        translate=0.05,
        scale=0.5,
        fliplr=0.5,
        flipud=0.0,
        degrees=0.0,
        shear=0.0,

        # 🎯 FALSE POSITIVE CONTROL
        close_mosaic=15,
        patience=25,

        # ⚡ PERFORMANCE
        amp=True,          # Mixed Precision
        cache=False,
        rect=True,

        # 📊 LOGGING
        project=PROJECT_DIR,
        name=RUN_NAME,
        exist_ok=True,
        verbose=True
    )


# =========================================================
# 4️⃣ ENTRY POINT
# =========================================================
if __name__ == "__main__":
    train()
