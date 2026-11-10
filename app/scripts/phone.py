#!/usr/bin/env python3
"""Small, deliberately restricted Pixel 7 ADB helper."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
import zipfile

class PhoneError(Exception):
    pass

def run(args, timeout=15):
    try:
        p = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise PhoneError(f'ADB failed or timed out: {type(exc).__name__}') from exc
    if p.returncode:
        raise PhoneError('ADB command failed: ' + p.stderr.decode(errors='replace')[:300].strip())
    return p.stdout

def bounds(value):
    nums = re.findall(r'\d+', value or '')
    if len(nums) != 4:
        raise PhoneError('invalid or missing bounds')
    x1, y1, x2, y2 = map(int, nums)
    if x2 <= x1 or y2 <= y1:
        raise PhoneError('empty bounds')
    return x1, y1, x2, y2

class Phone:
    def __init__(self, serial):
        candidate = Path(os.environ.get('ANDROID_HOME', str(Path.home() / 'Library/Android/sdk'))) / 'platform-tools/adb'
        self.adb = str(candidate) if os.access(candidate, os.X_OK) else shutil.which('adb')
        if not self.adb:
            raise PhoneError('adb not found in ANDROID_HOME or PATH')
        lines = run([self.adb, 'devices']).decode().splitlines()[1:]
        devices = [line.split()[:2] for line in lines if len(line.split()) >= 2]
        serial = serial or os.environ.get('PUCK_ADB_SERIAL') or os.environ.get('ANDROID_SERIAL')
        if serial:
            matches = [d for d in devices if d[0] == serial]
            if len(matches) != 1 or matches[0][1] != 'device':
                raise PhoneError('selected device is missing or unauthorized')
        else:
            if any(d[1] != 'device' for d in devices):
                raise PhoneError('unauthorized or offline device present; select an authorized phone explicitly')
            physical = [d for d in devices if not d[0].startswith('emulator-')]
            if len(physical) != 1:
                raise PhoneError('expected exactly one authorized physical device; use --serial')
            serial = physical[0][0]
        if serial.startswith('emulator-'):
            raise PhoneError('emulators are not supported')
        self.serial = serial
        model = self.shell('getprop', 'ro.product.model').decode().strip()
        characteristics = self.shell('getprop', 'ro.kernel.qemu').decode().strip()
        if model != 'Pixel 7' or characteristics == '1':
            raise PhoneError('selected device is not a physical Pixel 7')

    def call(self, *args, timeout=15):
        return run([self.adb, '-s', self.serial, *args], timeout)

    def shell(self, *args):
        return self.call('shell', *args)

    def gesture(self, points):
        if not 2 <= len(points) <= 100 or any(not (0 <= x <= 99999 and 0 <= y <= 99999) for x, y in points):
            raise PhoneError('gesture requires 2-100 nonnegative pixel points')
        sdk = Path(os.environ.get('ANDROID_HOME', str(Path.home() / 'Library/Android/sdk')))
        def latest(folder, name):
            candidates = [p for p in folder.glob('*/' + name) if p.is_file()]
            def version(p):
                return tuple(int(x) for x in re.findall(r'\d+', p.parent.name))
            if not candidates: raise PhoneError(f'Android SDK {name} not found under {folder}')
            return max(candidates, key=version)
        android_jar = latest(sdk / 'platforms', 'android.jar')
        d8 = latest(sdk / 'build-tools', 'd8')
        javac = shutil.which('javac')
        if not javac or not os.access(d8, os.X_OK): raise PhoneError('JDK 17 javac and executable Android SDK d8 are required')
        source = Path(__file__).with_name('PhoneGesture.java')
        digest = hashlib.sha256(source.read_bytes() + android_jar.read_bytes() + d8.read_bytes()).hexdigest()
        cache = Path(__file__).resolve().parent.parent / '.shots/tools' / digest
        jar = cache / 'puck-phone-gesture.jar'
        if not jar.is_file():
            cache.mkdir(parents=True, exist_ok=True)
            try:
                subprocess.run([javac, '-source', '8', '-target', '8', '-classpath', str(android_jar), '-d', str(cache), str(source)], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
                subprocess.run([str(d8), '--lib', str(android_jar), '--output', str(cache), str(cache / 'PhoneGesture.class')], check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
                with zipfile.ZipFile(jar, 'w') as archive: archive.write(cache / 'classes.dex', 'classes.dex')
            except (OSError, subprocess.SubprocessError) as exc:
                jar.unlink(missing_ok=True)
                raise PhoneError('gesture helper compilation failed; check JDK 17 and Android SDK') from exc
        self.call('push', str(jar), '/data/local/tmp/puck-phone-gesture.jar', timeout=30)
        payload = str(len(points)) + '\n' + ''.join(f'{x} {y}\n' for x, y in points)
        try:
            result = subprocess.run([self.adb, '-s', self.serial, 'shell', 'CLASSPATH=/data/local/tmp/puck-phone-gesture.jar app_process /system/bin PhoneGesture'], input=payload.encode(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=180)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise PhoneError('gesture helper failed or timed out') from exc
        if result.returncode or result.stdout.strip() != b'success':
            raise PhoneError('gesture helper failed')

    def locked(self):
        data = self.shell('dumpsys', 'window').decode(errors='replace')
        m = re.search(r'isKeyguardShowing=(true|false)', data)
        if not m:
            raise PhoneError('cannot determine keyguard state')
        return m.group(1) == 'true'

    def nodes(self):
        self.shell('uiautomator', 'dump', '/sdcard/window.xml')
        data = self.call('exec-out', 'cat', '/sdcard/window.xml')
        try:
            root = ET.fromstring(data)
        except ET.ParseError as exc:
            raise PhoneError('invalid accessibility XML') from exc
        result = []
        for node in root.iter('node'):
            a = node.attrib
            secret = a.get('password') == 'true'
            item = {'text': '' if secret else a.get('text', ''), 'description': '' if secret else a.get('content-desc', ''), 'resource_id': a.get('resource-id', ''), 'bounds': a.get('bounds', ''), 'clickable': a.get('clickable') == 'true', 'class': a.get('class', '')}
            if any((item['text'], item['description'], item['resource_id'], item['clickable'], 'LockPatternView' in item['class'])):
                result.append(item)
        return result

    def pattern_challenge(self):
        nodes = self.nodes()
        return any(n['resource_id'] == 'com.android.systemui:id/bouncer_pattern_root' for n in nodes) or any(n['text'] == 'Draw pattern' for n in nodes)

    def navigate_to_pattern(self):
        """Expose the credential bouncer without entering any credential."""
        if not self.locked():
            raise PhoneError('device is already unlocked')
        self.shell('input', 'keyevent', 'KEYCODE_WAKEUP')
        time.sleep(0.5)
        if self.pattern_challenge(): return 'already visible'

        # Start at the lower-left edge, away from the fingerprint sensor, and
        # finish above the lockscreen notification card.
        size = self.shell('wm', 'size').decode(errors='replace')
        match = re.search(r'Physical size: (\d+)x(\d+)', size)
        if not match:
            raise PhoneError('cannot determine physical display size')
        width, height = map(int, match.groups())
        x = width // 4
        self.shell('input', 'touchscreen', 'swipe', str(x), str(height - 120), str(x), str(height * 3 // 8), '450')
        time.sleep(0.5)
        if self.pattern_challenge(): return 'bottom-left swipe'

        self.shell('input', 'keyevent', 'KEYCODE_MENU')
        time.sleep(0.5)
        if self.pattern_challenge(): return 'MENU key'

        # Use the system confirmation activity only when Android resolves it.
        resolved = self.shell('cmd', 'package', 'resolve-activity', '--brief', '-a', 'android.app.action.CONFIRM_DEVICE_CREDENTIAL').decode(errors='replace').strip()
        if '/' in resolved and 'No activity found' not in resolved:
            self.shell('am', 'start', '-a', 'android.app.action.CONFIRM_DEVICE_CREDENTIAL')
            time.sleep(1)
            if self.pattern_challenge(): return 'credential confirmation activity'

        raise PhoneError('pattern challenge not exposed after wake, bottom-left swipe, MENU key, and supported confirmation activity')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial')
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('status', 'wake', 'lock', 'home', 'ui', 'challenge'):
        sub.add_parser(name)
    shot = sub.add_parser('screenshot'); shot.add_argument('path', nargs='?', default=str(Path(__file__).resolve().parent.parent / '.shots/phone.png'))
    sub.add_parser('unlock')
    gesture = sub.add_parser('gesture'); gesture.add_argument('points', nargs='+', help='nonsecret x,y screen points')
    for name in ('find', 'tap'):
        p = sub.add_parser(name)
        group = p.add_mutually_exclusive_group(required=True)
        group.add_argument('--text'); group.add_argument('--description'); group.add_argument('--resource-id')
        if name == 'find': p.add_argument('--timeout', type=float, default=0)
    a = parser.parse_args()
    phone = Phone(a.serial)
    if a.command == 'status':
        print(json.dumps({'serial': phone.serial, 'locked': phone.locked()}))
    elif a.command in ('wake', 'home'):
        phone.shell('input', 'keyevent', 'KEYCODE_WAKEUP' if a.command == 'wake' else 'KEYCODE_HOME')
    elif a.command == 'lock':
        if not phone.locked():
            phone.shell('input', 'keyevent', 'KEYCODE_SLEEP')
        time.sleep(1)
        if not phone.locked(): raise PhoneError('keyguard did not lock')
    elif a.command == 'screenshot':
        data = phone.call('exec-out', 'screencap', '-p')
        if not data.startswith(b'\x89PNG\r\n\x1a\n'): raise PhoneError('screenshot is not a PNG')
        path = Path(a.path).expanduser(); path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data); print(path)
    elif a.command == 'ui':
        print(json.dumps(phone.nodes(), ensure_ascii=False))
    elif a.command == 'challenge':
        print(json.dumps({'serial': phone.serial, 'challenge': 'pattern', 'navigation': phone.navigate_to_pattern()}))
    elif a.command in ('find', 'tap'):
        timeout = getattr(a, 'timeout', 0)
        if not 0 <= timeout <= 60: raise PhoneError('timeout must be between 0 and 60 seconds')
        key = 'text' if a.text is not None else 'description' if a.description is not None else 'resource_id'
        value = getattr(a, key)
        deadline = time.monotonic() + timeout
        while True:
            matches = [n for n in phone.nodes() if n[key] == value]
            if matches or time.monotonic() >= deadline: break
            time.sleep(min(0.5, max(0, deadline - time.monotonic())))
        if not matches: raise PhoneError('no matching node')
        if a.command == 'find': print(json.dumps(matches, ensure_ascii=False))
        else:
            if len(matches) != 1: raise PhoneError('tap requires exactly one matching node')
            x1,y1,x2,y2 = bounds(matches[0]['bounds'])
            phone.shell('input', 'tap', str((x1+x2)//2), str((y1+y2)//2))
    elif a.command == 'gesture':
        if any(not re.fullmatch(r'[0-9]{1,5},[0-9]{1,5}', p) for p in a.points): raise PhoneError('points must be x,y pixel pairs')
        phone.gesture([tuple(map(int, p.split(','))) for p in a.points])
        print('gesture complete')
    elif a.command == 'unlock':
        if not phone.locked(): print('already unlocked'); return
        phone.navigate_to_pattern()
        grids = [n for n in phone.nodes() if n['resource_id'] == 'com.android.systemui:id/bouncer_pattern_root']
        if len(grids) != 1: raise PhoneError('pattern grid unavailable')
        grid = grids[0]['bounds']
        x1,y1,x2,y2 = bounds(grid)
        path = Path.home() / '.config/puck/phone-unlock'
        if not path.is_file(): raise PhoneError('phone-unlock file is missing')
        if path.stat().st_mode & 0o077: raise PhoneError('phone-unlock file must have mode 0600')
        secret = path.read_text().strip()
        if not re.fullmatch(r'[1-9]{4,9}', secret) or len(set(secret)) != len(secret):
            raise PhoneError('pattern must contain 4-9 distinct digits from 1 to 9')
        points = [(x1 + (2*((int(c)-1)%3)+1)*(x2-x1)//6, y1 + (2*((int(c)-1)//3)+1)*(y2-y1)//6) for c in secret]
        phone.gesture(points); time.sleep(2)
        if phone.locked(): raise PhoneError('unlock failed; no retry attempted')
        print('unlocked')

if __name__ == '__main__':
    try: main()
    except (PhoneError, OSError) as exc:
        print(f'phone: {exc}', file=sys.stderr); sys.exit(1)
