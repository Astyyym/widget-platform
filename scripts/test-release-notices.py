"""Real locked-dependency notice acceptance; no synthetic network responses."""
import importlib.util
import json
import os
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('notices', ROOT / 'scripts/collect-release-notices.py')
notices = importlib.util.module_from_spec(spec)
spec.loader.exec_module(notices)


class LockedNoticesTest(unittest.TestCase):
    def test_every_locked_windows_dependency_has_full_text_and_mpl_source(self):
        metadata = json.loads((ROOT / 'evidence/G8-B/cargo-metadata.json').read_text(encoding='utf-8-sig'))
        output = ROOT / os.environ['G8B_NOTICE_TEST_OUTPUT']
        try:
            inventory = notices.collect(metadata, output)
        except Exception as error:
            self.fail(f'Real notice collection failed: {type(error).__name__}: {error}')
        expected = {(p['name'], p['version']) for p in metadata['packages'] if p['source']}
        actual = {(p['name'], p['version']) for p in inventory if p['ecosystem'] == 'cargo'}
        self.assertEqual(expected, actual)
        for package in inventory:
            self.assertTrue(package['notices'], package['name'])
            for receipt in package['notices']:
                data = (output / receipt['file']).read_bytes()
                self.assertTrue(data, receipt['file'])
                self.assertEqual(notices.digest(data), receipt['sha256'])
            if 'MPL' in package['license']:
                receipt = package['sourceArchive']
                self.assertIsNotNone(receipt, package['name'])
                self.assertEqual(notices.digest((output / receipt['file']).read_bytes()), receipt['sha256'])
        lucide = next(p for p in inventory if p['ecosystem'] == 'assets')
        self.assertEqual(lucide['notices'][0]['sha256'], notices.LUCIDE_SHA)


if __name__ == '__main__':
    unittest.main(verbosity=2)
