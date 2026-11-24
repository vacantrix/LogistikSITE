# Android-сборка модуля водителя

Здесь лежат переносимые скрипты сборки APK для модуля водителя. Сам Android-
проект — `driver/download/azmz-karkas/android` (Kotlin, Compose, Room,
WorkManager, MapLibre, 9 Gradle-модулей). В репозиторий не входят JDK, Android
SDK, Gradle и кэш — только исходники и скрипты.

## Что нужно

| Компонент | Версия | Переменная / путь по умолчанию |
|---|---|---|
| JDK | 17 | `JAVA_HOME` или `%USERPROFILE%\android-build\jdk-17` |
| Android SDK | platform 34, build-tools 34.0.0 | `ANDROID_SDK_ROOT` / `ANDROID_HOME` или `%USERPROFILE%\android-build\sdk` |
| Gradle | 8.9 | `%USERPROFILE%\android-build\gradle-8.9\bin\gradle.bat` или `gradle` в `PATH` |

Можно указать общий корень toolchain переменной `AEMZ_ANDROID_TOOLCHAIN`.

## Сборка

```powershell
# debug-APK (подпись debug, ставится на телефон)
powershell -NoProfile -ExecutionPolicy Bypass -File tools\android-build\build-apk.ps1

# release-APK (нужна настроенная подпись в Gradle)
powershell -NoProfile -ExecutionPolicy Bypass -File tools\android-build\build-apk.ps1 -Configuration release
```

Скрипт пишет `local.properties`, запускает `assembleDebug`/`assembleRelease`,
копирует результат в `driver/download/azmz-driver.apk` и печатает SHA-256.
Лог — `%TEMP%\azmz-build-apk.log`.

## Публикация

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File publish\publish-apk.ps1
```

Копия уходит в `publish/portal/dl/Drivemobile.apk` (публичная ссылка
`/dl/Drivemobile.apk`) и в standalone-бандл платформы, если он собран.

## CI

В корне репозитория есть `.github/workflows/android-apk.yml`: GitHub Actions
собирает debug-APK на `ubuntu-latest` и выкладывает артефакт
`azmz-driver-apk`. Локальный SDK для этого не нужен.

## Текущая версия

`ru.azmz.logistics.driver`, `versionName 0.3.2-pilot`, `versionCode 6`,
`minSdk 26`, `targetSdk 34`. Актуальный APK: 38 119 513 байт,
SHA-256 `F90722580DF6EC1857491B88B94E34FC26861B780A6D6A325722F7C62980C953`.
