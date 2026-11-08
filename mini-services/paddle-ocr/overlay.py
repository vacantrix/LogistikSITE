import cv2, numpy as np
img = cv2.imdecode(np.fromfile("/home/z/my-project/upload/Зубашев ВА ПС_page-0001_crop_t0.png", np.uint8), cv2.IMREAD_COLOR)
zone = img[104:560, :]
vis = zone.copy()
for (cx, cy, r), col in (((551, 244, 165), (0, 0, 255)),):
    cv2.circle(vis, (int(cx), int(cy)), int(r), col, 3)
    cv2.drawMarker(vis, (int(cx), int(cy)), col, cv2.MARKER_CROSS, 30, 3)
big = cv2.resize(vis, None, fx=1.6, fy=1.6)
cv2.imencode(".png", big)[1].tofile("/tmp/zone_overlay.png")
print("ok")
