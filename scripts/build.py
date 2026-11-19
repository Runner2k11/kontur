"""Build a dependency-free, content-addressed PWA for any static HTTPS host."""
from pathlib import Path
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'dist'

def sha(data):
    return hashlib.sha256(data).hexdigest()

def build():
    # Only this generated directory may be cleared, never source or parent paths.
    assert OUT.resolve().parent == ROOT.resolve() and not OUT.is_symlink()
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / 'assets').mkdir(parents=True)
    settings = json.loads((ROOT / 'version.json').read_text(encoding='utf-8'))
    version = f"{settings['major']}.{settings['build']:03d}"
    files = []

    def write(name, data):
        if isinstance(data, str):
            data = data.encode('utf-8')
        (OUT / name).write_bytes(data)
        files.append({'url': name, 'sha256': sha(data)})
        return name

    def asset(stem, extension, data):
        if isinstance(data, str):
            data = data.encode('utf-8')
        return write(f'assets/{stem}-{sha(data)[:16]}.{extension}', data)

    images = {file.stem: asset(file.stem, file.suffix[1:], file.read_bytes())
              for file in sorted((ROOT / 'art').iterdir()) if file.is_file() and file.suffix.lower() in ('.png','.ico')}
    metadata = {key: images[key] for key in ['terrain','atlas','logo','uiAtlas','statusAtlas','airAtlas','planetAtlas','planetTerrainAtlas','campaignBackdrop','startBackdrop','battleBackdrop']}
    metadata['sprites'] = json.loads((ROOT / 'src/sprites.json').read_text(encoding='utf-8'))
    css = (ROOT / 'src/style.css').read_text(encoding='utf-8')
    css += '\n#updateNotice{position:fixed;left:14px;bottom:14px;z-index:45;display:flex;align-items:center;gap:12px;max-width:calc(100vw - 28px);padding:12px 16px;border:1px solid #a4d6e077;border-radius:10px;background:#0d1b27f5;box-shadow:0 6px 30px #0007;color:#deedf1;font:13px system-ui}#updateNotice[hidden]{display:none}#updateNotice button{min-height:36px;padding:7px 12px;background:#d4fa7a;color:#10212b}.pwa-updating #startScreen{pointer-events:none}@media(max-width:500px){#updateNotice{bottom:48px;flex-wrap:wrap;font-size:12px}}\n'
    game = (ROOT / 'src/game.js').read_text(encoding='utf-8').replace('__GAME_VERSION__', version)
    urls = {'__GAME_VERSION__':version, '__STYLE_URL__':asset('style','css',css),
            '__GAME_URL__':asset('game','js',game),
            '__PWA_URL__':asset('pwa','js',(ROOT / 'src/pwa.js').read_bytes()),
            '__FAVICON_URL__':images['favicon'],
            '__ART_METADATA__':json.dumps(metadata, ensure_ascii=False, separators=(',',':'))}
    html = (ROOT / 'src/index.html').read_text(encoding='utf-8')
    for placeholder, value in urls.items():
        html = html.replace(placeholder, value)
    assert '__GAME_' not in html and 'data:image/' not in html
    write('index.html', html)
    manifest = {'id':'./','name':'КОНТУР — оборона планет','short_name':'КОНТУР','lang':'ru',
        'start_url':'./','scope':'./','display':'standalone','orientation':'any',
        'background_color':'#0d1b27','theme_color':'#0d1b27',
        'icons':[{'src':images[f'icon{size}'],'sizes':f'{size}x{size}','type':'image/png','purpose':'any'} for size in [192,512]]}
    write('manifest.webmanifest', json.dumps(manifest, ensure_ascii=False, indent=2))
    worker_template = (ROOT / 'src/sw.template.js').read_text(encoding='utf-8')
    release = {'version':version,'build':settings['build'],'buildId':sha(json.dumps(files,sort_keys=True).encode() + worker_template.encode())[:20],
               'runFormats':settings['runFormats']}
    (OUT / 'release.json').write_text(json.dumps(release, indent=2), encoding='utf-8')
    worker = worker_template
    worker = worker.replace('__RELEASE__', json.dumps(release)).replace('__PRECACHE__', json.dumps(files))
    (OUT / 'sw.js').write_text(worker, encoding='utf-8')
    (OUT / '.nojekyll').touch()
    print(f"Built КОНТУР {version}: {len(files)} cached resources, {sum((OUT / f['url']).stat().st_size for f in files):,} bytes; build {release['buildId']}")
    return release, files

if __name__ == '__main__':
    build()
