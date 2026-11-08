import cv2
import numpy as np
img = cv2.imdecode(np.fromfile("/home/z/my-project/upload/Зубашев ВА ПС_page-0001_crop_t0.png", np.uint8), cv2.IMREAD_COLOR)
top = img[0:120, :]
big = cv2.resize(top, None, fx=2.2, fy=2.2, interpolation=cv2.INTER_CUBIC)
cv2.imencode(".png", big)[1].tofile("/tmp/top_x2.png")
print("ok", top.shape)
