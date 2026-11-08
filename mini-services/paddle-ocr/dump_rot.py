import cv2, numpy as np
img = cv2.imdecode(np.fromfile("/home/z/my-project/upload/Зубашев ВА ПС_page-0001.jpg", np.uint8), cv2.IMREAD_COLOR)
cw = cv2.rotate(img, cv2.ROTATE_90_CLOCKWISE)
ccw = cv2.rotate(img, cv2.ROTATE_90_COUNTERCLOCKWISE)
cv2.imencode(".png", cv2.resize(cw, None, fx=0.45, fy=0.45))[1].tofile("/tmp/rot_cw.png")
cv2.imencode(".png", cv2.resize(ccw, None, fx=0.45, fy=0.45))[1].tofile("/tmp/rot_ccw.png")
print("cw:", cw.shape, "ccw:", ccw.shape)
