"""Combine pinned stable and test bundles behind one offline-capable root URL."""
from pathlib import Path
import argparse
import hashlib
import json
import re
import shutil
from build import build

ROOT=Path(__file__).resolve().parent.parent

def sha(data):
    return hashlib.sha256(data).hexdigest()

def assemble(stable_source,test_source,output_parent=None):
    sources={'stable':Path(stable_source).resolve(),'test':Path(test_source).resolve()}
    deployment=json.loads((ROOT/'deployment.json').read_text(encoding='utf-8'))
    stable_settings=json.loads((sources['stable']/'version.json').read_text(encoding='utf-8'))
    from build import version_name
    assert version_name(stable_settings)==deployment['stableVersion'], 'Stable release must be explicitly pinned'
    built={channel:build(source) for channel,source in sources.items()}
    parent=Path(output_parent).resolve() if output_parent else ROOT.resolve()
    out=parent/'site'
    assert parent.is_relative_to(ROOT.parent.resolve()) and out.resolve().parent==parent and not out.is_symlink()
    if out.exists():shutil.rmtree(out)
    (out/'assets').mkdir(parents=True)
    (out/'apps').mkdir()

    def write(name,data):
        if isinstance(data,str):data=data.encode('utf-8')
        path=out/name
        path.parent.mkdir(parents=True,exist_ok=True)
        if path.exists():assert path.read_bytes()==data, 'Content-addressed asset collision'
        else:path.write_bytes(data)
        return {'url':name,'sha256':sha(data)}

    def asset(name,extension,data):
        if isinstance(data,str):data=data.encode('utf-8')
        return write(f'assets/{name}-{sha(data)[:16]}.{extension}',data)

    client=asset('channel-client','js',(ROOT/'hosting/client.js').read_bytes())
    catalog={'schema':2}
    for channel,source in sources.items():
        release,files=built[channel]
        folder=source/'dist'
        # Keep original immutable assets available to tabs still on the legacy SW.
        for file in files:
            if file['url'].startswith('assets/'):write(file['url'],(folder/file['url']).read_bytes())
        html=(folder/'index.html').read_text(encoding='utf-8')
        game_path=re.search(r'<script defer src="(assets/game-[^"]+)"',html)[1]
        game=(folder/game_path).read_text(encoding='utf-8')
        # Storage keys stay byte-for-byte compatible in stable; only the adapter
        # supplies a prefix in the test channel. Game/balance source stays intact.
        game=re.sub(r'\blocalStorage\.', 'window.KONTUR_HOST.storage.', game)
        hosted_game=asset('game-hosted','js',game)
        html=html.replace(game_path,hosted_game['url'])
        html=re.sub(r'<script defer src="assets/pwa-[^"]+"></script>','',html)
        # The adapter belongs to the common shell, not either game release.
        # Updating it must never masquerade as a new stable/test game version.
        entry=write(f'apps/{channel}-{sha(html.encode())[:20]}.html',html)
        inventory=[file for file in files if file['url'].startswith('assets/') and not file['url'].startswith(('assets/game-','assets/pwa-'))]
        inventory += [hosted_game,entry]
        content_id=sha(json.dumps(inventory,sort_keys=True).encode())[:20]
        catalog[channel]={'channel':channel,'version':release['version'],'buildId':content_id,
            'entry':entry['url'],'runFormats':release['runFormats'],'files':inventory,
            'sourceBuildId':release['buildId']}

    boot=asset('host-boot','js',(ROOT/'hosting/boot.js').read_text(encoding='utf-8').replace('__CLIENT__',client['url']))
    manifest=json.loads((sources['stable']/'dist/manifest.webmanifest').read_text(encoding='utf-8'))
    icon=re.search(r'<link rel="icon"[^>]+href="([^"]+)"',(sources['stable']/'dist/index.html').read_text(encoding='utf-8'))[1]
    html=(ROOT/'hosting/index.html').read_text(encoding='utf-8').replace('__BOOT__',boot['url']).replace('__ICON__',icon)
    shell_files=[write('index.html',html),write('manifest.webmanifest',json.dumps(manifest,ensure_ascii=False,indent=2)),boot,client]
    shell_files+=[next(file for file in built['stable'][1] if file['url']==icon)]
    for item in manifest['icons']:
        shell_files+=[next(file for file in built['stable'][1] if file['url']==item['src'])]
    template=(ROOT/'hosting/sw.js').read_text(encoding='utf-8')
    shell_id=sha(template.encode()+json.dumps(shell_files,sort_keys=True).encode())[:20]
    worker=template.replace('__SHELL_ID__',shell_id).replace('__SHELL_FILES__',json.dumps(shell_files))
    write('sw.js',worker)
    write('channels.json',json.dumps(catalog,ensure_ascii=False,indent=2))
    for channel in ['stable','test']:
        write('releases/'+channel+'.json',json.dumps(catalog[channel],ensure_ascii=False,indent=2))
    write('release.json',json.dumps({'version':catalog['stable']['version'],'buildId':shell_id,'runFormats':catalog['stable']['runFormats'],'hostProtocol':2},indent=2))
    (out/'.nojekyll').touch()
    print(f"Site: stable {catalog['stable']['version']}, test {catalog['test']['version']}, shell {shell_id}")
    return catalog

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--stable',type=Path,required=True)
    parser.add_argument('--test',type=Path,required=True)
    parser.add_argument('--output-parent',type=Path)
    args=parser.parse_args()
    assemble(args.stable,args.test,args.output_parent)
