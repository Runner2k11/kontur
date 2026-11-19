import hashlib
import json
from pathlib import Path
import re
import unittest

ROOT=Path(__file__).resolve().parent.parent
SITE=ROOT/'site'

class HostedChannels(unittest.TestCase):
    def setUp(self):
        self.catalog=json.loads((SITE/'channels.json').read_text(encoding='utf-8'))

    def test_complete_content_addressed_channels(self):
        self.assertEqual(self.catalog['schema'],2)
        for channel in ['stable','test']:
            release=self.catalog[channel]
            self.assertEqual(release['channel'],channel)
            self.assertIn(release['entry'],[f['url'] for f in release['files']])
            for file in release['files']:
                self.assertEqual(hashlib.sha256((SITE/file['url']).read_bytes()).hexdigest(),file['sha256'])
            html=(SITE/release['entry']).read_text(encoding='utf-8')
            self.assertNotRegex(html,r'assets/pwa-')
            self.assertIn('channel-client-',html)
            scripts=re.findall(r'<script defer src="([^"]+)"',html)
            game=next(path for path in scripts if 'game-hosted-' in path)
            code=(SITE/game).read_text(encoding='utf-8')
            self.assertIn('window.KONTUR_HOST.storage.getItem',code)
            self.assertIn("const GAME_VERSION='"+release['version']+"'",code)

    def test_pinned_stable_and_test_identity(self):
        settings=json.loads((ROOT/'deployment.json').read_text(encoding='utf-8'))
        self.assertEqual(self.catalog['stable']['version'],settings['stableVersion'])
        self.assertRegex(settings['stableRef'],r'^[0-9a-f]{40}$')
        self.assertRegex(self.catalog['test']['version'],r'^\d+\.\d{3}\.\d{2,}$')
        self.assertNotEqual(self.catalog['stable']['buildId'],self.catalog['test']['buildId'])
        stable={f['url'] for f in self.catalog['stable']['files'] if f['url'].endswith('.png')}
        test={f['url'] for f in self.catalog['test']['files'] if f['url'].endswith('.png')}
        self.assertGreater(len(stable&test),5)

    def test_worker_and_root_shell_integrity(self):
        worker=(SITE/'sw.js').read_text(encoding='utf-8')
        files=json.loads(re.search(r'SHELL_FILES=(.*);',worker)[1])
        for file in files:
            self.assertEqual(hashlib.sha256((SITE/file['url']).read_bytes()).hexdigest(),file['sha256'])
        html=(SITE/'index.html').read_text(encoding='utf-8')
        self.assertIn('host-boot-',html)
        self.assertNotIn('game-hosted-',html)
        self.assertEqual(json.loads((SITE/'manifest.webmanifest').read_text(encoding='utf-8'))['start_url'],'./')

if __name__=='__main__':unittest.main()
