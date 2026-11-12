"""Build immutable standalone gateway archives; publishing is a separate step."""

import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def main():
    metadata = json.loads((ROOT / 'desktop/package.json').read_text('utf8'))
    version, build = metadata['version'], metadata['releaseBuild']
    label = f'{version}-build{build}'
    output = ROOT / '.local' / f'gateway-release-{label}'
    output.mkdir(exist_ok=True)
    go = ROOT / '.tools/go/bin/go.exe'
    compiler = subprocess.check_output([str(go), 'version'], text=True).strip()
    if 'go1.27.3 ' not in compiler:
        raise RuntimeError('This release requires the audited Go 1.27.3 toolchain')
    readme = (
        f'CXPalm gateway {label}\n\n'
        'Run on your own computer alongside the official Codex desktop.\n'
        'Create your private configuration following deploy/README.md in the\n'
        'source repository. No configuration, credentials or runtime data are\n'
        'included. Start with: cxpalm serve --config /absolute/private/config.json\n'
        'Keep the listener on loopback and use your own HTTPS reverse proxy.\n'
        'macOS binaries are unsigned; cross-builds are not macOS acceptance.\n'
    ).encode()
    results = []
    for system, arch in [('windows', 'amd64'), ('darwin', 'amd64'), ('darwin', 'arm64')]:
        suffix = '.zip' if system == 'windows' else '.tar.gz'
        name = f'CXPalm-Gateway-{label}-{system}-{arch}{suffix}'
        target = output / name
        if target.exists():
            raise RuntimeError(f'Immutable archive exists: {name}')
        binary_name = 'cxpalm.exe' if system == 'windows' else 'cxpalm'
        binary = output / f'{system}-{arch}' / binary_name
        binary.parent.mkdir(exist_ok=True)
        env = dict(os.environ, GOOS=system, GOARCH=arch, CGO_ENABLED='0',
                   GOPATH=str(ROOT / '.tools/gopath'), GOCACHE=str(ROOT / '.tools/gocache'))
        subprocess.run([str(go), 'build', '-trimpath', '-buildvcs=false', '-o', str(binary), './cmd/cxpalm'],
                       cwd=ROOT, env=env, check=True)
        build_info = subprocess.check_output([str(go), 'version', '-m', str(binary)], text=True)
        if ': go1.27.3' not in build_info:
            raise RuntimeError('Embedded build version does not match the toolchain')
        info = json.dumps({'version': version, 'build': build, 'os': system,
                           'arch': arch, 'go': 'go1.27.3'}, indent=2).encode()
        files = {binary_name: binary.read_bytes(), 'BUILD-INFO.json': info, 'README.txt': readme}
        if system == 'windows':
            with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
                for member, data in files.items():
                    archive.writestr(member, data)
        else:
            with tarfile.open(target, 'x:gz') as archive:
                for member, data in files.items():
                    entry = tarfile.TarInfo(member)
                    entry.size, entry.mode = len(data), 0o755 if member == binary_name else 0o644
                    archive.addfile(entry, io.BytesIO(data))
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        results.append({'name': name, 'size': target.stat().st_size, 'sha256': digest})
        print(json.dumps(results[-1]), flush=True)
    (output / 'SHA256SUMS-gateway.txt').write_text(
        ''.join(f'{row["sha256"]}  {row["name"]}\n' for row in results), 'ascii')
    (output / 'gateway-artifacts.json').write_text(json.dumps(results, indent=2), 'utf8')


if __name__ == '__main__':
    main()
