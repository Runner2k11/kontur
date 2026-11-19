import hashlib
import json
from pathlib import Path
import re
import struct
import unittest
import sys
import subprocess

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'dist'
sys.path.insert(0,str(ROOT/'scripts'))
from build import version_name

class OfflineBundle(unittest.TestCase):
    def test_commander_behavior(self):
        script=ROOT/'tests/commander.test.cjs'
        result=subprocess.run(['node',str(script)],capture_output=True,text=True,encoding='utf-8',timeout=30)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_test_build_number_survives_stable_promotion(self):
        settings={'major':1,'build':30,'testBuild':1}
        self.assertEqual(version_name(settings),'1.030.01')
        settings['testBuild']=2
        self.assertEqual(version_name(settings),'1.030.02')
        self.assertEqual(version_name({'major':1,'build':29}),'1.029')
    def test_complete_verified_release(self):
        worker = (OUT / 'sw.js').read_text(encoding='utf-8')
        files = json.loads(re.search(r'const FILES=(.*);', worker)[1])
        self.assertGreater(len(files), 14)
        for entry in files:
            self.assertEqual(hashlib.sha256((OUT / entry['url']).read_bytes()).hexdigest(), entry['sha256'])
        release = json.loads((OUT / 'release.json').read_text(encoding='utf-8'))
        self.assertEqual(release, json.loads(re.search(r'const RELEASE=(.*);', worker)[1]))

    def test_art_and_scripts_are_local(self):
        html = (OUT / 'index.html').read_text(encoding='utf-8')
        self.assertNotIn('data:image/', html)
        self.assertNotIn('__GAME_VERSION__', html)
        assets = json.loads(re.search(r'<script id="assetData" type="application/json">(.*?)</script>', html, re.S)[1])
        for key, value in assets.items():
            if key == 'sprites':
                continue
            self.assertTrue((OUT / value).is_file())
            self.assertEqual((OUT / value).read_bytes(), (ROOT / 'art' / (key + '.png')).read_bytes())
        self.assertEqual(len(assets['sprites']), len(json.loads((ROOT / 'src/sprites.json').read_text(encoding='utf-8'))))
        for path in re.findall(r'(?:href|src)="(assets/[^"]+)"', html):
            self.assertTrue((OUT / path).is_file(), path)

    def test_manifest_works_beneath_repository_path(self):
        manifest = json.loads((OUT / 'manifest.webmanifest').read_text(encoding='utf-8'))
        self.assertEqual(manifest['start_url'], './')
        self.assertEqual(manifest['scope'], './')
        self.assertEqual(manifest['display'], 'standalone')
        for icon in manifest['icons']:
            data = (OUT / icon['src']).read_bytes()
            self.assertEqual(data[:8], b'\x89PNG\r\n\x1a\n')
            width, height = struct.unpack('>II', data[16:24])
            self.assertEqual(icon['sizes'], f'{width}x{height}')

if __name__ == '__main__':
    unittest.main()
