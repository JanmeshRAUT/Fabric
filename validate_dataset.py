"""Validate dataset structure and basic label correctness for YOLO format.
Usage: python validate_dataset.py data.yaml
"""
import sys
import os
import yaml


def load_yaml(path):
    with open(path, 'r', encoding='utf-8') as f:
        return yaml.safe_load(f)


def list_files(folder, exts):
    files = []
    for root, _, filenames in os.walk(folder):
        for fn in filenames:
            if any(fn.lower().endswith(e) for e in exts):
                files.append(os.path.join(root, fn))
    return files


def main():
    if len(sys.argv) < 2:
        print('Usage: python validate_dataset.py data.yaml')
        sys.exit(1)
    cfg = load_yaml(sys.argv[1])
    for split in ('train', 'val', 'test'):
        path = cfg.get(split)
        if not path:
            continue
        images_dir = os.path.join(path, 'images') if not os.path.isdir(path) else path
        labels_dir = os.path.join(path, 'labels') if not os.path.isdir(path) else path
        if os.path.isdir(os.path.join(path, 'images')):
            images_dir = os.path.join(path, 'images')
        if os.path.isdir(os.path.join(path, 'labels')):
            labels_dir = os.path.join(path, 'labels')

        imgs = list_files(images_dir, ['.jpg', '.jpeg', '.png']) if os.path.isdir(images_dir) else []
        lbls = list_files(labels_dir, ['.txt']) if os.path.isdir(labels_dir) else []
        print(f"{split}: images={len(imgs)}, labels={len(lbls)}")

        # quick basename check
        img_bases = {os.path.splitext(os.path.basename(p))[0] for p in imgs}
        lbl_bases = {os.path.splitext(os.path.basename(p))[0] for p in lbls}
        only_imgs = sorted(list(img_bases - lbl_bases))[:5]
        only_lbls = sorted(list(lbl_bases - img_bases))[:5]
        if only_imgs:
            print('  Images without labels (examples):', only_imgs)
        if only_lbls:
            print('  Labels without images (examples):', only_lbls)


if __name__ == '__main__':
    main()
