"""Exercise prerequisite gates without installing packages or accessing the network."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class NodePrerequisites(unittest.TestCase):
    def run_script(self, script, version):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            bin_dir = root / 'bin'
            bin_dir.mkdir()
            # Restrict PATH so a missing Node cannot resolve to the host installation.
            for name in ('dirname', 'awk', 'cat'):
                (bin_dir / name).symlink_to(shutil.which(name))

            def stub(name, body):
                path = bin_dir / name
                path.write_text('#!/bin/sh\n' + body + '\n')
                path.chmod(0o755)

            stub('python3.12', 'if [ "$1" = "--version" ]; then echo "Python 3.12.0"; else echo REACHED_VENV; exit 73; fi')
            stub('git', 'if [ "$1" = "--version" ]; then echo "git version 2.0"; else echo REACHED_CLONE; exit 73; fi')
            stub('npm', 'echo 10.0.0')
            if version is not None:
                stub('node', 'exit 1' if version == 'broken' else f'echo "{version}"')
            env = {**os.environ, 'PATH': str(bin_dir), 'INSTALL_DIR': str(root / 'install'), 'SKIP_LAUNCH': '1'}
            shutil.copyfile(ROOT / script, root / script)
            result = subprocess.run(['/bin/bash', str(root / script)], env=env, text=True,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=5)
            self.assertFalse((root / 'install').exists())
            return result

    def test_unsupported_node_stops_before_installation(self):
        for script in ('setup.sh', 'install.sh'):
            for version in (None, 'v18.20.8', 'v19.9.0', 'broken', 'not-a-version'):
                with self.subTest(script=script, version=version):
                    result = self.run_script(script, version)
                    self.assertEqual(result.returncode, 1, result.stdout)
                    self.assertIn('Node.js 20+', result.stdout)
                    self.assertNotIn('REACHED_', result.stdout)

    def test_supported_node_reaches_next_step(self):
        for script in ('setup.sh', 'install.sh'):
            for version in ('v20.0.0', 'v22.0.0', 'v24.0.0'):
                with self.subTest(script=script, version=version):
                    result = self.run_script(script, version)
                    self.assertEqual(result.returncode, 73, result.stdout)
                    self.assertIn('REACHED_VENV' if script == 'setup.sh' else 'REACHED_CLONE', result.stdout)


if __name__ == '__main__':
    unittest.main()
