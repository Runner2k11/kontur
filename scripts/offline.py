"""Package the current local build as one HTML inside a ZIP for offline review."""
from pathlib import Path
import base64
import json
import re
import sys
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def package(destination):
    folder = ROOT / 'dist'
    html = (folder / 'index.html').read_text(encoding='utf-8')
    release = json.loads((folder / 'release.json').read_text(encoding='utf-8'))
    metadata_pattern = r'(<script id="assetData" type="application/json">)(.*?)(</script>)'
    metadata = json.loads(re.search(metadata_pattern, html, re.S)[2])

    def data_url(url):
        path = (folder / url).resolve()
        assert path.is_relative_to(folder.resolve()) and path.is_file()
        mime = 'image/x-icon' if path.suffix == '.ico' else 'image/png'
        return f'data:{mime};base64,' + base64.b64encode(path.read_bytes()).decode('ascii')

    if metadata.get('sprites', {}).get('frontierAtlasUrl'):
        metadata['sprites']['frontierAtlasUrl'] = data_url(metadata['sprites']['frontierAtlasUrl'])
    for key, value in metadata.items():
        if key != 'sprites':
            metadata[key] = data_url(value)
    html = re.sub(metadata_pattern, lambda m: m[1] + json.dumps(metadata, ensure_ascii=False, separators=(',', ':')) + m[3], html, flags=re.S)

    def script(match):
        url = match[1]
        # Service Workers require HTTP(S); the offline preview needs no updater.
        if '/pwa-' in url:
            return ''
        source = (folder / url).read_text(encoding='utf-8')
        return '<script>\n' + source.replace('</script', '<\\/script') + '\n</script>'

    html = re.sub(r'<script defer src="(assets/[^\"]+)"></script>', script, html)
    html = re.sub(r'<link rel="stylesheet" href="(assets/[^\"]+)">', lambda m: '<style>\n' + (folder / m[1]).read_text(encoding='utf-8') + '\n</style>', html)
    html = re.sub(r'<link rel="manifest"[^>]*>', '', html)
    html = re.sub(r'((?:href|src)=")(assets/[^\"]+\.(?:png|ico))(\")', lambda m: m[1] + data_url(m[2]) + m[3], html)
    assert not re.search(r'(?:href|src)="assets/', html)
    assert '/* __BATTLE_SYSTEM__ */' not in html
    destination = Path(destination).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('kontur.html', html.encode('utf-8'))
    print(f"Offline preview {release['version']}: {destination.name} ({destination.stat().st_size:,} bytes)")


if __name__ == '__main__':
    package(sys.argv[1] if len(sys.argv) > 1 else ROOT.parent / 'kontur_preview.zip')
