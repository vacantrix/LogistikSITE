import cv2, numpy as np
from pathlib import Path
p = Path("/home/z/my-project/upload/Зубашев ВА ПС_page-0001_crop_t0.png")
img = cv2.imdecode(np.fromfile(str(p), np.uint8), cv2.IMREAD_COLOR)
zone = img[104:560, :]
big = cv2.resize(zone, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
cv2.imencode(".png", big)[1].tofile("/tmp/zone_x2.png")
print("zone:", zone.shape)
