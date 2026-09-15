#!/usr/bin/env bash
# Build a signed simulator app and start the matching local demo API.
set -euo pipefail
waysignal_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ "$(uname -s)" != Darwin ]]; then echo 'Run this script on your Mac with Xcode installed.'; exit 1; fi
export DEVELOPER_DIR="/Applications/Xcode.app/Contents/Developer"
if [[ ! -d "$DEVELOPER_DIR" ]]; then export DEVELOPER_DIR="$(xcode-select -p)"; fi
if [[ ! -x "$DEVELOPER_DIR/usr/bin/xcodebuild" ]]; then echo 'Open Xcode and finish installation first.'; exit 1; fi
mkdir -p "$waysignal_root/build"
waysignal_python="$waysignal_root/backend/.venv/bin/python"
if [[ ! -x "$waysignal_python" ]]; then
  python3 -m venv "$waysignal_root/backend/.venv"
fi
if ! "$waysignal_python" -c 'import uvicorn, fastapi, mcp' >/dev/null 2>&1; then
  "$waysignal_python" -m pip install -r "$waysignal_root/backend/requirements.txt"
fi
# Restart only a uvicorn server whose working directory is this project's backend.
# An unrelated listener is never terminated.
"$waysignal_python" - "$waysignal_root" <<'PY'
import os, signal, subprocess, sys, time
from pathlib import Path
root = Path(sys.argv[1]).resolve()
result = subprocess.run(['lsof','-nP','-iTCP:8000','-sTCP:LISTEN','-t'],capture_output=True,text=True)
pids = sorted(set(result.stdout.split()))
verified = []
for pid in pids:
    command = subprocess.run(['ps','-p',pid,'-o','command='],capture_output=True,text=True).stdout
    cwd = subprocess.run(['lsof','-a','-p',pid,'-d','cwd','-Fn'],capture_output=True,text=True).stdout
    directories = [line[1:] for line in cwd.splitlines() if line.startswith('n')]
    if 'uvicorn' not in command or 'app.main:app' not in command or str(root / 'backend') not in directories:
        sys.exit('Port 8000 belongs to another process. Close that server before running this script again.')
    verified.append(int(pid))
for pid in verified:
    os.kill(pid, signal.SIGTERM)
for _ in range(50):
    current = subprocess.run(['lsof','-nP','-iTCP:8000','-sTCP:LISTEN','-t'],capture_output=True,text=True).stdout.strip()
    if not current: break
    time.sleep(.2)
else: sys.exit('The old server has not stopped yet. Wait and run this script again.')
PY
if [[ ! -f "$waysignal_root/backend/.env" ]]; then
  "$waysignal_python" - "$waysignal_root" <<'PY'
import os, secrets, sys
from pathlib import Path
path=Path(sys.argv[1])/'backend/.env'
fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
with os.fdopen(fd,'w') as f:
    f.write('APP_NAME=WaySignal API\nENVIRONMENT=development\nJWT_SECRET='+secrets.token_urlsafe(48)+'\nACCESS_TOKEN_MINUTES=120\n')
PY
fi
# start_new_session keeps the local API alive after this build terminal finishes.
"$waysignal_python" - "$waysignal_root" <<'PY'
import os, subprocess, sys, time, urllib.request, json
from pathlib import Path
root=Path(sys.argv[1]); env=os.environ.copy()
env.update(WAYSIGNAL_DEMO_MODE='true',ENVIRONMENT='development',DATABASE_URL='sqlite:///./waysignal-demo.db',
           FRONTEND_DIST=str(root/'frontend/dist'),MCP_INTERNAL_URL='http://127.0.0.1:8000/mcp/')
log=root/'build/WaySignal-backend.log'
with log.open('ab') as stream:
    process=subprocess.Popen([str(root/'backend/.venv/bin/python'),'-m','uvicorn','app.main:app','--host','127.0.0.1','--port','8000'],
        cwd=root/'backend',env=env,stdout=stream,stderr=subprocess.STDOUT,stdin=subprocess.DEVNULL,start_new_session=True)
(root/'build/WaySignal-backend.pid').write_text(str(process.pid))
for _ in range(40):
    if process.poll() is not None: sys.exit(f'Backend did not start. Open {log} for the error.')
    try:
        with urllib.request.urlopen('http://127.0.0.1:8000/api/v1/mobile/scenario',timeout=1) as response:
            if json.load(response).get('enabled'): print('Demo backend is ready.');break
    except Exception: pass
    time.sleep(.5)
else: sys.exit(f'Backend is still starting. Check {log}.')
PY
waysignal_device="$(xcrun simctl list devices available -j | "$waysignal_python" -c 'import json,sys; d=[v for rows in json.load(sys.stdin)["devices"].values() for v in rows if v.get("isAvailable") and v["name"].startswith("iPhone")]; d.sort(key=lambda x:(x["name"]!="iPhone 18 Pro",x["state"]!="Booted")); print(d[0]["udid"] if d else "")')"
if [[ -z "$waysignal_device" ]]; then echo 'Install an iOS simulator runtime in Xcode Settings, then rerun this script.'; exit 1; fi
echo 'Building WaySignal. This may take a few minutes. Full output is in build/WaySignal-build.log.'
if ! xcodebuild -project "$waysignal_root/ios/WaySignal.xcodeproj" -scheme WaySignal -configuration Debug \
  -destination "platform=iOS Simulator,id=$waysignal_device" -derivedDataPath "$waysignal_root/build" \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- ENTITLEMENTS_REQUIRED=YES build > "$waysignal_root/build/WaySignal-build.log" 2>&1; then
  "$waysignal_python" - "$waysignal_root/build/WaySignal-build.log" <<'PY'
import sys
lines=open(sys.argv[1]).readlines(); errors=[line for line in lines if 'error:' in line]
print(''.join(errors[:20] or lines[-25:]))
print('Build stopped. Share the errors above, or upload '+sys.argv[1])
PY
  exit 1
fi
waysignal_state="$(xcrun simctl list devices available -j | "$waysignal_python" -c 'import json,sys; key=sys.argv[1]; print(next(v["state"] for rows in json.load(sys.stdin)["devices"].values() for v in rows if v["udid"]==key))' "$waysignal_device")"
if [[ "$waysignal_state" != Booted ]]; then xcrun simctl boot "$waysignal_device"; fi
xcrun simctl bootstatus "$waysignal_device" -b
open -b com.apple.dt.Devices 2>/dev/null || open "$DEVELOPER_DIR/Applications/Simulator.app"
xcrun simctl install "$waysignal_device" "$waysignal_root/build/Build/Products/Debug-iphonesimulator/WaySignal.app"
# An update may request fresh prompts for this app only; never grant permissions automatically.
if [[ "${1:-}" == "--reset-voice-permissions" ]]; then
  xcrun simctl terminate "$waysignal_device" org.waysignal.ios >/dev/null 2>&1 || true
  waysignal_privacy_help="$(xcrun simctl help privacy 2>&1 || true)"
  for waysignal_service in microphone speech-recognition; do
    if [[ "$waysignal_privacy_help" == *"$waysignal_service"* ]]; then
      if xcrun simctl privacy "$waysignal_device" reset "$waysignal_service" org.waysignal.ios; then
        echo "WaySignal will ask for $waysignal_service access again. Choose Allow."
      else
        echo "Open Nav AI → Voice setup to enable $waysignal_service access."
      fi
    fi
  done
fi
xcrun simctl launch --terminate-running-process "$waysignal_device" org.waysignal.ios
echo 'WaySignal is open. Sign out in Account to switch between Citizen and Responder.'
