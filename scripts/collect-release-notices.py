"""Collect exact dependency notices for the locked Windows build, fail closed."""
import argparse
import hashlib
import json
import re
import shutil
import tomllib
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PREFIXES = ('license', 'licence', 'copying', 'copyright', 'notice')
LUCIDE_COMMIT = '66d8f9fc394b8530377e5f6112f0b8908ba01280'
LUCIDE_SHA = 'b495047bd93a9b06913511076f504daba17d5bbeb3e0650f3bb53a4220329c57'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url):
    request = urllib.request.Request(url, headers={'User-Agent': 'Widget-Platform-notice-builder'})
    with urllib.request.urlopen(request, timeout=40) as response:
        data = response.read(4 * 1024 * 1024 + 1)
    if len(data) > 4 * 1024 * 1024:
        raise ValueError('Notice download exceeds size limit')
    return data


def local_notices(directory):
    return sorted(p for p in directory.rglob('*') if p.is_file() and not p.is_symlink()
                  and len(p.relative_to(directory).parts) <= 3
                  and p.name.lower().startswith(PREFIXES)
                  and p.suffix.lower() not in ('.rs', '.c', '.h', '.js', '.ts'))


def upstream_notices(package, directory):
    repository = (package.get('repository') or '').removesuffix('/').removesuffix('.git')
    if not re.fullmatch(r'https://github\.com/[\w.-]+/[\w.-]+', repository):
        raise ValueError(f'No approved GitHub repository for {package["name"]}')
    vcs = json.loads((directory / '.cargo_vcs_info.json').read_text())
    commit = vcs['git']['sha1']
    if not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Invalid pinned VCS hash')
    repo = repository.removeprefix('https://github.com/')
    index = json.loads(fetch(f'https://api.github.com/repos/{repo}/contents/?ref={commit}'))
    licenses = [item for item in index if item['type'] == 'file' and item['name'].lower().startswith(PREFIXES)]
    if not licenses and package['name'] == 'selectors' and package.get('license') == 'MPL-2.0':
        # The pinned Stylo tree has per-file MPL headers, but no repository-root LICENSE.
        header = (directory / 'lib.rs').read_text()
        if 'License, v. 2.0.' not in header or 'https://mozilla.org/MPL/2.0/' not in header:
            raise ValueError('Selectors MPL header no longer matches')
        url = 'https://www.mozilla.org/media/MPL/2.0/index.f75d2927d3c1.txt'
        data = fetch(url)
        if digest(data) != '3f3d9e0024b1921b067d6f7f88deb4a60cbe7a78e76c64e3f1d7fc3b779b9d04':
            raise ValueError('Official MPL 2.0 text changed')
        return [('LICENSE-MPL-2.0.txt', data, url)]
    if not licenses:
        raise ValueError(f'No root notice at pinned revision for {package["name"]}')
    return [(item['name'], fetch(f'https://raw.githubusercontent.com/{repo}/{commit}/{item["name"]}'),
             f'{repository}/blob/{commit}/{item["name"]}') for item in licenses]


def collect(metadata, output):
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError('Output must be a new empty notice directory')
    inventory = []
    cargo_lock = tomllib.loads((ROOT / 'app/src-tauri/Cargo.lock').read_text())
    checksums = {(p['name'], p['version'], p.get('source')): p.get('checksum')
                 for p in cargo_lock['package']}
    for package in metadata['packages']:
        if not package['source']:
            continue
        directory = Path(package['manifest_path']).parent
        name = f'{package["name"]}-{package["version"]}'
        destination = output / 'rust' / name
        notices = local_notices(directory)
        texts = [(p.relative_to(directory).as_posix(), p.read_bytes(), f'locked crate {name}') for p in notices]
        if package.get('license_file'):
            path = (directory / package['license_file']).resolve()
            if not path.is_relative_to(directory.resolve()):
                raise ValueError('License file escapes crate directory')
            if path.is_file() and path not in notices:
                texts.append((path.name, path.read_bytes(), f'locked crate {name}'))
        if not texts:
            texts = upstream_notices(package, directory)
        receipts = []
        for filename, data, source in texts:
            target = destination / filename
            if not target.resolve().is_relative_to(destination.resolve()) or not data:
                raise ValueError('Empty or unsafe notice')
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            receipts.append({'file': target.relative_to(output).as_posix(), 'sha256': digest(data), 'source': source})
        # Include the exact published source archive for MPL dependencies, not only an SPDX label.
        source_archive = None
        if 'MPL' in (package.get('license') or ''):
            registry = directory.parent.name
            archive = directory.parents[2] / 'cache' / registry / f'{name}.crate'
            if not archive.is_file():
                raise ValueError(f'Missing exact MPL source archive for {name}')
            checksum = checksums.get((package['name'], package['version'], package['source']))
            if not checksum:
                raise ValueError(f'Missing Cargo.lock checksum for {name}')
            if digest(archive.read_bytes()) != checksum:
                raise ValueError(f'MPL source checksum mismatch for {name}')
            target = output / 'sources' / archive.name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(archive, target)
            source_archive = {'file': target.relative_to(output).as_posix(), 'sha256': checksum}
        inventory.append({'ecosystem': 'cargo', 'name': package['name'], 'version': package['version'],
                          'license': package.get('license'), 'repository': package.get('repository'),
                          'notices': receipts, 'sourceArchive': source_archive})
    lock = json.loads((ROOT / 'app/package-lock.json').read_text())
    for key, package in lock['packages'].items():
        if not key or package.get('dev'):
            continue
        directory = ROOT / 'app' / key
        notices = local_notices(directory)
        if not notices:
            raise ValueError(f'Missing npm notice: {key}')
        name = key.removeprefix('node_modules/').replace('/', '__')
        receipts = []
        for path in notices:
            data = path.read_bytes()
            target = output / 'npm' / name / path.relative_to(directory)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            receipts.append({'file': target.relative_to(output).as_posix(), 'sha256': digest(data), 'source': f'locked npm {key}'})
        inventory.append({'ecosystem': 'npm', 'name': key.removeprefix('node_modules/'),
                          'version': package['version'], 'license': package.get('license'), 'notices': receipts})
    url = f'https://raw.githubusercontent.com/lucide-icons/lucide/{LUCIDE_COMMIT}/LICENSE'
    lucide = fetch(url)
    if digest(lucide) != LUCIDE_SHA:
        raise ValueError('Lucide fixed-commit LICENSE hash mismatch')
    (output / 'LUCIDE-LICENSE.txt').write_bytes(lucide)
    inventory.append({'ecosystem': 'assets', 'name': 'Lucide / Feather icons', 'version': LUCIDE_COMMIT,
                      'license': 'ISC and MIT; see full upstream LICENSE',
                      'notices': [{'file': 'LUCIDE-LICENSE.txt', 'sha256': LUCIDE_SHA, 'source': url}]})
    (output / 'dependency-notices.json').write_text(json.dumps(inventory, indent=2), encoding='utf-8')
    (output / 'THIRD-PARTY-NOTICES.txt').write_text(
        'Widget Platform third-party notices\n\n'
        'Full texts are in the adjacent rust/, npm/ and LUCIDE-LICENSE.txt files.\n'
        'This inventory includes build-time Cargo crates conservatively; it does not claim all are linked.\n'
        'Exact unmodified published MPL source archives are included in sources/.\n'
        'The project has not copied the research Codenotch/Pillar/Zebar source into this bundle.\n\n'
        + '\n'.join(f'{p["ecosystem"]}: {p["name"]} {p["version"]} | {p["license"]}' for p in inventory) + '\n',
        encoding='utf-8')
    return inventory


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--metadata', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = collect(json.loads(args.metadata.read_text(encoding='utf-8-sig')), args.output)
    print(json.dumps({'entries': len(result), 'notices': sum(len(p['notices']) for p in result), 'output': str(args.output)}))
