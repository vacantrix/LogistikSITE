#!/bin/bash
set -e
SDK=/home/z/android-sdk
mkdir -p $SDK/cmdline-tools
cd /tmp
echo "[1/4] downloading cmdline-tools..."
curl -sS -o clt.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip
unzip -q -o clt.zip -d $SDK/cmdline-tools
mv $SDK/cmdline-tools/cmdline-tools $SDK/cmdline-tools/latest 2>/dev/null || true
export ANDROID_HOME=$SDK
echo "[2/4] licenses..."
yes | $SDK/cmdline-tools/latest/bin/sdkmanager --licenses > /tmp/sdk-licenses.log 2>&1 || true
echo "[3/4] installing platform+build-tools..."
$SDK/cmdline-tools/latest/bin/sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools" > /tmp/sdk-install.log 2>&1
echo "[4/4] done"
ls $SDK/platforms $SDK/build-tools
