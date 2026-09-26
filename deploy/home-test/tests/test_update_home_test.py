"""Execute the updater against real Git/files and a controlled Docker boundary.

Docker build/container operations are replaced because they would mutate a host.
The double rejects unknown commands; filesystem changes and Git checks stay real.
"""
import copy
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "update_home_test.sh"
PROJECT = "newscast_navigator_home_test"
OLD = "1" * 40
DB_IMAGE = "sha256:" + "d" * 64

DOCKER_DOUBLE = r'''
import json, os, pathlib, sys
args = sys.argv[1:]
root = pathlib.Path(os.environ['DOUBLE_ROOT'])
with (root/'calls.jsonl').open('a') as f: f.write(json.dumps(args)+'\n')
if args[:2] != ['--host','unix:///var/run/docker.sock']: sys.exit(94)
args = args[2:]
state_path = root/'state.json'
state = json.loads(state_path.read_text()) if state_path.exists() else {}
mode = os.environ.get('DOUBLE_MODE', '')
if args[0] == 'compose':
    files = [i for i,x in enumerate(args) if x=='-f']
    source = pathlib.Path(args[files[0]+1]).parents[2]
    command = args[files[-1]+2:]
    if command == ['config', '--format', 'json']:
        config = json.loads((root/'config.json').read_text())
        for name, rel in [('backend','backend'),('frontend','frontend'),('gateway','deploy/nginx')]:
            config['services'][name]['build']['context'] = str(source/rel)
        config['services']['gateway']['volumes'][0]['source'] = str(source/'deploy/home-test/gateway.conf.template')
        if mode == 'candidate_public' and source.name == 'candidate':
            config['services']['gateway']['ports'][0]['host_ip'] = '0.0.0.0'
        print(json.dumps(config)); sys.exit(0)
    if command == ['ps', '--all', '-q']:
        print('\n'.join(['db-id','backend-id','frontend-id','gateway-id'])); sys.exit(0)
    if command == ['build', 'backend', 'frontend', 'gateway']:
        if mode == 'build_fail': sys.exit(1)
        state['built'] = True
    elif command == ['stop', 'gateway', 'backend']:
        if mode == 'cleanup_fail' and state.get('started'): sys.exit(1)
        state['stopped'] = True
    elif command == ['run', '--rm', '--no-deps', 'backend', 'alembic', 'upgrade', 'head']:
        if mode == 'migration_fail': sys.exit(1)
        state['migrated'] = True
    elif command == ['up', '-d', '--no-build', '--no-deps', '--force-recreate', '--wait', 'backend', 'frontend', 'gateway']:
        state['started'] = True
    else:
        print('Unexpected compose operation', file=sys.stderr); sys.exit(91)
    state_path.write_text(json.dumps(state)); sys.exit(0)
if args[0] == 'inspect':
    objects=[]
    for name in ['db','backend','frontend','gateway']:
        image = 'sha256:' + (('d' if name=='db' else 'b') if not state.get('started') else ('d' if name=='db' else 'c'))*64
        mounts = [{'Type':'volume','Name':PROJECT+'_home_test_pg_data','Destination':'/var/lib/postgresql/data'}] if name=='db' else []
        if mode == 'production_mount' and name=='db': mounts[0]['Name']='newscast_navigator_production_production_pg_data'
        objects.append({'Id':name+'-id','Name':'/'+PROJECT+'-'+name+'-1','Image':image,
          'Config':{'Labels':{'com.docker.compose.project':PROJECT,'com.docker.compose.service':name}},
          'State':{'Running':True,'Health':{'Status':'unhealthy' if mode=='unhealthy' else 'healthy'}},
          'Mounts':mounts,
          'NetworkSettings':{'Ports':{'443/tcp':[{'HostIp':'192.168.2.200','HostPort':'18443'}]} if name=='gateway' else {}}})
    print(json.dumps(objects)); sys.exit(0)
if args[:2] == ['image','inspect']:
    print(json.dumps([{'Id':'sha256:'+'c'*64}])); sys.exit(0)
if args[:2] == ['image','save']:
    sys.stdout.buffer.write(b'SYNTHETIC-DOCKER-IMAGE-ARCHIVE'); sys.exit(0)
if args[:2] == ['exec','db-id'] and args[2:]==['sh','-c','exec pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"']:
    sys.stdout.buffer.write(b'SYNTHETIC-PG-DUMP'); sys.exit(0)
if args[:3] == ['exec','-i','db-id'] and args[3:]==['pg_restore','--list']:
    data=sys.stdin.buffer.read()
    sys.exit(0 if data==b'SYNTHETIC-PG-DUMP' else 92)
print('Unexpected Docker operation', file=sys.stderr); sys.exit(93)
'''.replace("PROJECT", repr(PROJECT))


class UpdateHomeTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.candidate = self.root / "candidate"
        self.runtime = self.root / "newscast-home-test"
        self.tls = self.root / "tls"
        self.bin = self.root / "bin"
        for path in (self.candidate, self.runtime, self.tls, self.bin): path.mkdir(mode=0o700)
        for name in ("ca.pem", "fullchain.pem", "privkey.pem"):
            (self.tls/name).write_text("synthetic certificate")
            (self.tls/name).chmod(0o600)
        for base in (self.candidate, self.runtime):
            (base/"deploy/home-test").mkdir(parents=True)
            (base/"deploy/home-test/compose.yaml").write_text("name: newscast_navigator_home_test\n")
            (base/"deploy/home-test/gateway.conf.template").write_text("synthetic gateway")
            for rel in ("backend", "frontend", "deploy/nginx"): (base/rel).mkdir(parents=True, exist_ok=True)
        (self.runtime/"SOURCE_COMMIT").write_text(OLD+"\n")
        (self.runtime/".env").write_text("SYNTHETIC_SECRET=never-print-this-value\n")
        (self.runtime/".env").chmod(0o600)
        subprocess.run(["git", "init", "-q", str(self.candidate)], check=True)
        self.git("add", ".")
        self.git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "synthetic candidate")
        self.sha = self.git("rev-parse", "HEAD").stdout.strip()
        self.config = {
            "name":PROJECT,
            "volumes":{"home_test_pg_data":{"name":PROJECT+"_home_test_pg_data"}},
            "networks":{"default":{"name":PROJECT+"_default"}},
            "services":{
                "db":{"image":DB_IMAGE,"environment":{"POSTGRES_DB":"newscast_home_test","POSTGRES_USER":"newscast_home_test","POSTGRES_PASSWORD":"synthetic-password"},
                      "volumes":[{"type":"volume","source":"home_test_pg_data","target":"/var/lib/postgresql/data"}]},
                "backend":{"image":"newscast-navigator-backend:home-test","build":{"context":"unused","dockerfile":"Dockerfile.prod"},"environment":{
                    "DATABASE_URL":"postgresql+psycopg://newscast_home_test:synthetic-password@db:5432/newscast_home_test",
                    "ENVIRONMENT":"production","SEED_DEMO_DATA":"false","SESSION_COOKIE_SECURE":"true","ALLOW_NULL_CORS_ORIGIN":"true",
                    "SECRET_KEY":"synthetic-secret-that-is-long-enough","CORS_ORIGINS":"https://192.168.2.200:18443,null"}},
                "frontend":{"image":"newscast-navigator-frontend:home-test","build":{"context":"unused","dockerfile":"Dockerfile.prod","args":{"VITE_API_BASE_URL":""}}},
                "gateway":{"image":"newscast-navigator-gateway:home-test","build":{"context":"unused","dockerfile":"Dockerfile"},
                    "environment":{"HOME_TEST_SERVER_NAME":"192.168.2.200"},
                    "ports":[{"target":443,"published":"18443","host_ip":"192.168.2.200","protocol":"tcp"}],
                    "volumes":[{"type":"bind","source":"unused","target":"/etc/nginx/templates/default.conf.template","read_only":True},
                               {"type":"bind","source":str(self.tls),"target":"/etc/nginx/certs","read_only":True}]}
            }
        }
        self.write_config()
        (self.bin/"docker").write_text("#!"+sys.executable+"\n"+DOCKER_DOUBLE)
        (self.bin/"docker").chmod(0o700)
        (self.bin/"curl").write_text("#!"+sys.executable+"\n"+r'''
import os, pathlib, sys
mode=os.environ.get('DOUBLE_MODE','')
if mode=='journal_fail':
    record=next(pathlib.Path(os.environ['DOUBLE_ROOT']).glob('.newscast-home-test-updates/update-*/update.json'))
    record.unlink(); record.mkdir()
if mode in ('journal_fail','cleanup_fail'): sys.exit(1)
sys.exit(0)
''')
        (self.bin/"curl").chmod(0o700)
        self.env = dict(os.environ, PATH=str(self.bin)+os.pathsep+os.environ["PATH"], DOUBLE_ROOT=str(self.root))

    def git(self, *args):
        return subprocess.run(["git","-C",str(self.candidate),*args], text=True, capture_output=True, check=True)

    def write_config(self): (self.root/"config.json").write_text(json.dumps(self.config))

    def run_update(self, *args, mode=""):
        return subprocess.run(["bash",str(SCRIPT),"--source-dir",str(self.candidate),"--runtime-dir",str(self.runtime),"--ref",self.sha,*args],
                              env=dict(self.env,DOUBLE_MODE=mode), text=True, capture_output=True)

    def calls(self):
        path=self.root/"calls.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def assert_no_mutation(self):
        for call in self.calls():
            self.assertNotIn("build",call); self.assertNotIn("stop",call); self.assertNotIn("run",call); self.assertNotIn("up",call); self.assertNotIn("exec",call)
        self.assertEqual((self.runtime/"SOURCE_COMMIT").read_text(),OLD+"\n")

    def test_default_is_read_only_and_reports_exact_candidate(self):
        result=self.run_update()
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn("HOME_TEST_UPDATE_READY=true",result.stdout)
        self.assertIn(self.sha,result.stdout)
        self.assert_no_mutation()
        self.assertFalse((self.root/".newscast-home-test-updates").exists())
        self.assertNotIn("never-print-this-value",result.stdout+result.stderr)

    def test_rejects_dirty_source_before_docker(self):
        (self.candidate/"untracked.txt").write_text("unapproved")
        self.assertNotEqual(self.run_update("--apply").returncode,0)
        self.assertEqual(self.calls(),[])
        self.assert_no_mutation()

    def test_rejects_wrong_sha_before_docker(self):
        result=self.run_update("--ref", "a"*40, "--apply")
        self.assertNotEqual(result.returncode,0)
        self.assertEqual(self.calls(),[])

    def test_rejects_unsafe_compose_before_mutation(self):
        variants=[]
        for field,value in [("name","newscast_navigator_production")]:
            config=copy.deepcopy(self.config); config[field]=value; variants.append(config)
        config=copy.deepcopy(self.config); config['services']['db']['environment']['POSTGRES_DB']='production'; variants.append(config)
        config=copy.deepcopy(self.config); config['services']['gateway']['ports'][0]['host_ip']='0.0.0.0'; variants.append(config)
        config=copy.deepcopy(self.config); config['volumes']['home_test_pg_data']['external']=True; variants.append(config)
        config=copy.deepcopy(self.config); config['services']['backend']['volumes']=[{'type':'bind','source':'/','target':'/host'}]; variants.append(config)
        config=copy.deepcopy(self.config); config['services']['db']['privileged']=True; variants.append(config)
        for config in variants:
            with self.subTest(config=config):
                self.config=config; self.write_config()
                result=self.run_update("--apply")
                self.assertNotEqual(result.returncode,0)
                self.assert_no_mutation()

    def test_rejects_candidate_public_binding_even_when_runtime_safe(self):
        self.assertNotEqual(self.run_update("--apply",mode="candidate_public").returncode,0)
        self.assert_no_mutation()

    def test_rejects_mounted_production_volume_and_unhealthy_runtime(self):
        for mode in ("production_mount","unhealthy"):
            with self.subTest(mode=mode):
                self.assertNotEqual(self.run_update("--apply",mode=mode).returncode,0)
                self.assert_no_mutation()

    def test_rejects_public_or_symlink_environment_file(self):
        (self.runtime/".env").chmod(0o644)
        self.assertNotEqual(self.run_update("--apply").returncode,0)
        (self.runtime/".env").unlink()
        (self.runtime/".env").symlink_to(self.root/"config.json")
        self.assertNotEqual(self.run_update("--apply").returncode,0)
        self.assert_no_mutation()

    def test_build_failure_does_not_stop_current_app(self):
        result=self.run_update("--apply",mode="build_fail")
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(any("stop" in call for call in self.calls()))
        self.assertEqual((self.runtime/"SOURCE_COMMIT").read_text(),OLD+"\n")

    def test_apply_preserves_recovery_data_before_migration(self):
        result=self.run_update("--apply")
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn("HOME_TEST_UPDATED=true",result.stdout)
        self.assertEqual((self.runtime/"SOURCE_COMMIT").read_text(),self.sha+"\n")
        runs=list((self.root/".newscast-home-test-updates").iterdir())
        self.assertEqual(len(runs),1)
        run=runs[0]
        self.assertEqual((run/"previous/SOURCE_COMMIT").read_text(),OLD+"\n")
        self.assertEqual((run/"database.dump").read_bytes(),b'SYNTHETIC-PG-DUMP')
        record=json.loads((run/"update.json").read_text())
        self.assertEqual(record['status'],'complete')
        self.assertEqual(record['previous_commit'],OLD)
        self.assertEqual(set(record['previous_images']),{'db','backend','frontend','gateway'})
        self.assertEqual((self.runtime/".env").stat().st_mode & 0o777,0o600)
        calls=self.calls()
        dump=next(i for i,c in enumerate(calls) if 'pg_dump' in ' '.join(c))
        migrate=next(i for i,c in enumerate(calls) if 'alembic' in c)
        self.assertLess(dump,migrate)
        for call in calls:
            if 'stop' in call: self.assertEqual(call[-3:],['stop','gateway','backend'])
            self.assertNotIn('down',call)
        self.assertNotIn("never-print-this-value",result.stdout+result.stderr)

    def test_migration_failure_keeps_snapshot_without_automatic_database_restore(self):
        result=self.run_update("--apply",mode="migration_fail")
        self.assertNotEqual(result.returncode,0)
        self.assertTrue((self.root/".newscast-home-test-updates").is_dir(), result.stderr)
        run=next((self.root/".newscast-home-test-updates").iterdir())
        self.assertTrue((run/"database.dump").is_file())
        self.assertTrue((run/"previous").is_dir())
        self.assertEqual(json.loads((run/"update.json").read_text())['status'],'failed')
        self.assertFalse(any('up' in call for call in self.calls()))
        self.assertFalse(any('--clean' in call or 'down' in call for call in self.calls()))

    def test_apply_keeps_previous_images_as_a_loadable_archive(self):
        result=self.run_update('--apply')
        self.assertEqual(result.returncode,0,result.stderr)
        run=next((self.root/'.newscast-home-test-updates').iterdir())
        self.assertTrue((run/'previous-images.tar').is_file())
        self.assertGreater((run/'previous-images.tar').stat().st_size,0)
        self.assertTrue((run/'previous-images.tar.sha256').is_file())

    def test_migration_and_start_use_immutable_image_recipe(self):
        result=self.run_update('--apply')
        self.assertEqual(result.returncode,0,result.stderr)
        for call in self.calls():
            if 'alembic' in call or 'up' in call:
                self.assertEqual(call.count('-f'),2)
                overlay=Path(call[[i for i,x in enumerate(call) if x=='-f'][-1]+1])
                images=json.loads(overlay.read_text())['services']
                self.assertEqual(set(images),{'backend','frontend','gateway'})
                for service in images.values():
                    self.assertEqual(service,{'image':'sha256:'+'c'*64,'pull_policy':'never'})

    def test_journal_failure_cannot_skip_cleanup_after_start(self):
        result=self.run_update('--apply',mode='journal_fail')
        self.assertNotEqual(result.returncode,0)
        calls=self.calls()
        start=next(i for i,c in enumerate(calls) if 'up' in c)
        self.assertTrue(any('stop' in c for c in calls[start+1:]))
        self.assertIn('HOME_TEST_APP_STOP_CONFIRMED=true',result.stderr)

    def test_cleanup_failure_is_reported_without_claiming_app_is_stopped(self):
        result=self.run_update('--apply',mode='cleanup_fail')
        self.assertNotEqual(result.returncode,0)
        self.assertIn('HOME_TEST_APP_STOP_CONFIRMED=false',result.stderr)

    def test_build_does_not_overwrite_existing_home_test_tags(self):
        result=self.run_update('--apply')
        self.assertEqual(result.returncode,0,result.stderr)
        build=next(c for c in self.calls() if 'build' in c)
        self.assertEqual(build.count('-f'),2)
        overlay=Path(build[[i for i,x in enumerate(build) if x=='-f'][-1]+1])
        images=json.loads(overlay.read_text())['services']
        for name in ('backend','frontend','gateway'):
            tag='newscast-navigator-'+name+':home-test-'+self.sha
            self.assertEqual(images[name]['image'],tag)
            self.assertTrue(any(call[-3:]==['image','inspect',tag] for call in self.calls()))


if __name__ == '__main__': unittest.main()
