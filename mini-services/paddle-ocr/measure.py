import cv2, numpy as np

img = cv2.imdecode(np.fromfile("/home/z/my-project/upload/Зубашев ВА ПС_page-0001.jpg", np.uint8), cv2.IMREAD_COLOR)
hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
def stat(name, ys, xs):
    r = hsv[ys[0]:ys[1], xs[0]:xs[1]]
    v, s = r[..., 2].astype(float), r[..., 1].astype(float)
    print(f"{name}: val p5={np.percentile(v,5):.0f} p25={np.percentile(v,25):.0f} med={np.percentile(v,50):.0f} | sat p50={np.percentile(s,50):.0f} p75={np.percentile(s,75):.0f} p95={np.percentile(s,95):.0f}")
stat("строка ГУ МВД (текст)", (350, 640), (175, 245))     # выцветшая строка «Кем выдан»
stat("бумага вокруг неё",    (350, 640), (255, 330))      # бланк правее
stat("лист сканера выше",    (100, 300), (175, 500))      # белый лист над паспортом
stat("строка 18.07.2019",    (480, 610), (285, 315))      # контрастная дата
stat("шапка РОССИЙСКАЯ ФЕД", (140, 650), (125, 160))      # вертикальная шапка
