---
title: Fabric Defect Backend
emoji: 🧵
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# Fabric Fault Detection — Training

Quick helper files to train a YOLOv8 model on the provided dataset.

Files added:
- `train.py` — simple wrapper that calls Ultralytics `YOLO().train(...)`.
- `validate_dataset.py` — checks images/labels counts and mismatches.
- `requirements.txt` — minimal Python dependencies.

Setup (Windows PowerShell):

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# For GPU support, install the appropriate torch build separately per https://pytorch.org
```

Validate dataset:

```powershell
python validate_dataset.py data.yaml
```

Train:

```powershell
python train.py --data data.yaml --epochs 50 --imgsz 640 --batch 16
```

Notes:
- `data.yaml` in the repo should point to your `train/`, `val/` folders.
- If you have a GPU, install CUDA-enabled `torch` before `ultralytics` for best performance.
