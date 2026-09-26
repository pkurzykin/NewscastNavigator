#!/usr/bin/env bash
# Run on the home host. Default is a read-only preflight; no remote operations.
set -euo pipefail
umask 077
exec python3 - "$@" <<'PY'
import argparse
import fcntl
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import sys
import tarfile
import tempfile
from urllib.parse import unquote, urlsplit

PROJECT = 'newscast_navigator_home_test'
VOLUME = PROJECT + '_home_test_pg_data'
SERVICES = {'db', 'backend', 'frontend', 'gateway'}
APPS = ['backend', 'frontend', 'gateway']
SHA = r'[a-f0-9]{40}'
IMAGE = r'sha256:[a-f0-9]{64}'


class Refused(Exception):
    pass


def require(condition, reason):
    if not condition:
        raise Refused(reason)


# Ignore caller-selected Compose files/profiles and Git repositories.
ENV = {k: v for k, v in os.environ.items() if not k.startswith(('COMPOSE_', 'GIT_'))}
ENV['COMPOSE_DISABLE_ENV_FILE'] = 'true'
# Pin every Docker operation to this host's Unix socket.
DOCKER = ['docker', '--host', 'unix:///var/run/docker.sock']


def command(args, *, input_bytes=None, input_file=None, output=None):
    result = subprocess.run(args, env=ENV, input=input_bytes, stdin=input_file,
                            stdout=output if output is not None else subprocess.PIPE,
                            stderr=subprocess.PIPE)
    # Config/errors may contain interpolated secrets. Never echo them.
    require(result.returncode == 0, 'command failed (' + args[0] + ')')
    return result.stdout


def compose(root, env_file, *args, images_file=None):
    return DOCKER + ['compose', '--project-name', PROJECT, '--env-file', str(env_file),
                     '-f', str(root / 'deploy/home-test/compose.yaml')] + (
                         ['-f', str(images_file)] if images_file else []) + list(args)


def checksum(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def private_file(path):
    require(path.is_file() and not path.is_symlink(), 'private file missing or symlink')
    info = path.stat()
    require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o600,
            'private file must be owned by the operator with mode 0600')


def private_dir(path):
    require(path.is_dir() and not path.is_symlink(), 'private directory missing or symlink')
    info = path.stat()
    require(info.st_uid == os.getuid() and stat.S_IMODE(info.st_mode) == 0o700,
            'private directory must be owned by the operator with mode 0700')


def configuration(root, env_file):
    config = json.loads(command(compose(root, env_file, 'config', '--format', 'json')))
    require(config.get('name') == PROJECT, 'wrong Compose project')
    services = config.get('services', {})
    require(set(services) == SERVICES, 'unexpected services')
    volumes = config.get('volumes', {})
    require(set(volumes) == {'home_test_pg_data'}, 'unexpected data volumes')
    volume = volumes['home_test_pg_data']
    require(volume.get('name') == VOLUME and not volume.get('external')
            and not volume.get('driver_opts') and volume.get('driver', 'local') == 'local',
            'database volume is not isolated')
    networks = config.get('networks', {})
    require(set(networks) == {'default'} and networks['default'].get('name') == PROJECT + '_default'
            and not networks['default'].get('external'), 'unexpected networks')
    for name, service in services.items():
        for unsafe in ('privileged', 'pid', 'ipc', 'network_mode', 'devices', 'cap_add',
                       'volumes_from', 'post_start', 'pre_stop', 'container_name', 'entrypoint', 'command'):
            require(not service.get(unsafe), 'unsafe service option')
        require(not service.get('profiles'), 'profile-controlled service')
        require(set(service.get('networks', {'default': None})) == {'default'}, 'unexpected service network')
        if name != 'gateway':
            require(not service.get('ports'), 'non-gateway host port')
        if name in ('backend', 'frontend'):
            require(not service.get('volumes'), 'unexpected application mount')
    db = services['db']
    require(re.fullmatch(IMAGE, db.get('image', '')) and not db.get('build'), 'database image must be immutable')
    mounts = db.get('volumes', [])
    require(len(mounts) == 1 and mounts[0].get('type') == 'volume'
            and mounts[0].get('source') == 'home_test_pg_data'
            and mounts[0].get('target') == '/var/lib/postgresql/data', 'wrong database mount')
    db_env = db.get('environment', {})
    require(db_env.get('POSTGRES_DB') == 'newscast_home_test'
            and db_env.get('POSTGRES_USER') == 'newscast_home_test'
            and bool(db_env.get('POSTGRES_PASSWORD')), 'wrong test database identity')
    backend = services['backend'].get('environment', {})
    url = urlsplit(backend.get('DATABASE_URL', ''))
    require(url.scheme == 'postgresql+psycopg' and url.hostname == 'db' and url.port == 5432
            and url.path == '/newscast_home_test' and unquote(url.username or '') == db_env['POSTGRES_USER']
            and unquote(url.password or '') == db_env['POSTGRES_PASSWORD'], 'backend database mismatch')
    require(backend.get('ENVIRONMENT') == 'production' and str(backend.get('SEED_DEMO_DATA')).lower() == 'false'
            and str(backend.get('SESSION_COOKIE_SECURE')).lower() == 'true'
            and str(backend.get('ALLOW_NULL_CORS_ORIGIN')).lower() == 'true'
            and len(backend.get('SECRET_KEY', '')) >= 24, 'unsafe application environment')
    gateway = services['gateway']
    ports = gateway.get('ports', [])
    require(len(ports) == 1, 'unexpected gateway ports')
    port = ports[0]
    require(port.get('host_ip') == '192.168.2.200' and port.get('target') == 443
            and port.get('protocol', 'tcp') == 'tcp' and 1024 <= int(port['published']) <= 65535,
            'gateway must bind only home LAN HTTPS')
    published = str(port['published'])
    require(gateway.get('environment', {}).get('HOME_TEST_SERVER_NAME') == '192.168.2.200'
            and backend.get('CORS_ORIGINS') == 'https://192.168.2.200:' + published + ',null', 'wrong host or CORS origins')
    mounts = gateway.get('volumes', [])
    require(len(mounts) == 2 and all(m.get('type') == 'bind' and m.get('read_only') for m in mounts),
            'gateway mounts must be read-only binds')
    by_target = {m.get('target'): Path(m['source']) for m in mounts}
    require(set(by_target) == {'/etc/nginx/templates/default.conf.template', '/etc/nginx/certs'}, 'unexpected gateway bind')
    template = root / 'deploy/home-test/gateway.conf.template'
    require(not template.is_symlink() and by_target['/etc/nginx/templates/default.conf.template'].resolve() == template,
            'wrong gateway template')
    tls = by_target['/etc/nginx/certs']
    require(not tls.is_symlink(), 'TLS directory symlink')
    tls = tls.resolve()
    private_dir(tls)
    private_file(tls / 'privkey.pem')
    for certificate in ('ca.pem', 'fullchain.pem'):
        require((tls / certificate).is_file() and not (tls / certificate).is_symlink(), 'TLS certificate missing')
    for name, relative, dockerfile in (('backend', 'backend', 'Dockerfile.prod'),
                                     ('frontend', 'frontend', 'Dockerfile.prod'),
                                     ('gateway', 'deploy/nginx', 'Dockerfile')):
        service = services[name]
        require(service.get('image') == 'newscast-navigator-' + name + ':home-test', 'wrong application image tag')
        build = service.get('build', {})
        require(Path(build.get('context', '/')).resolve() == root / relative
                and build.get('dockerfile') == dockerfile and not build.get('additional_contexts')
                and not build.get('dockerfile_inline'), 'unexpected build source')
    require(services['frontend']['build'].get('args', {}).get('VITE_API_BASE_URL', '') == '', 'external frontend API')
    return {'db_image': db['image'], 'port': published, 'tls': str(tls)}


def running(root, env_file, expected):
    ids = command(compose(root, env_file, 'ps', '--all', '-q')).decode().split()
    require(len(ids) == 4, 'expected four running test containers')
    objects = json.loads(command(DOCKER + ['inspect', *ids]))
    by_service = {}
    for obj in objects:
        labels = obj.get('Config', {}).get('Labels', {})
        name = labels.get('com.docker.compose.service')
        require(labels.get('com.docker.compose.project') == PROJECT and name in SERVICES
                and name not in by_service, 'wrong container project or service')
        require(obj.get('State', {}).get('Running') and obj.get('State', {}).get('Health', {}).get('Status') == 'healthy',
                'test container not healthy')
        require(re.fullmatch(IMAGE, obj.get('Image', '')), 'invalid running image ID')
        bindings = {k: v for k, v in obj.get('NetworkSettings', {}).get('Ports', {}).items() if v}
        wanted = {'443/tcp': [{'HostIp': '192.168.2.200', 'HostPort': expected['port']}]} if name == 'gateway' else {}
        require(bindings == wanted, 'unexpected running host binding')
        if name == 'db':
            mounts = obj.get('Mounts', [])
            require(len(mounts) == 1 and mounts[0].get('Type') == 'volume' and mounts[0].get('Name') == VOLUME
                    and mounts[0].get('Destination') == '/var/lib/postgresql/data', 'running database volume mismatch')
            require(obj['Image'] == expected['db_image'], 'running database image mismatch')
        by_service[name] = obj
    require(set(by_service) == SERVICES, 'missing test container')
    return by_service


def main():
    parser = argparse.ArgumentParser(description='Home test exact-commit updater; read-only unless --apply')
    parser.add_argument('--source-dir', required=True)
    parser.add_argument('--runtime-dir', default='/home/newscast/newscast-home-test')
    parser.add_argument('--ref', required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    require(re.fullmatch(SHA, args.ref), 'exact 40-character commit required')
    require(not any(os.environ.get(k) for k in ('DOCKER_HOST', 'DOCKER_CONTEXT', 'DOCKER_TLS_VERIFY', 'DOCKER_CERT_PATH')),
            'caller-selected Docker connection is forbidden')
    source_arg, runtime_arg = Path(args.source_dir), Path(args.runtime_dir)
    require(not source_arg.is_symlink() and not runtime_arg.is_symlink(), 'source/runtime symlink')
    source, runtime = source_arg.resolve(), runtime_arg.resolve()
    require(source.is_dir() and runtime.is_dir() and runtime.name == 'newscast-home-test', 'invalid runtime/source directory')
    require(source != runtime and source not in runtime.parents and runtime not in source.parents, 'overlapping source and runtime')
    require(runtime.stat().st_uid == os.getuid() and not (runtime / '.git').exists(), 'runtime must be an operator-owned archive')
    env_file = runtime / '.env'
    private_file(env_file)
    marker = runtime / 'SOURCE_COMMIT'
    require(marker.is_file() and not marker.is_symlink(), 'runtime source marker missing')
    old_sha = marker.read_text().strip()
    require(re.fullmatch(SHA, old_sha), 'invalid runtime source marker')
    require(command(['git', '-C', str(source), 'rev-parse', '--show-toplevel']).decode().strip() == str(source), 'source must be a Git root')
    require(command(['git', '-C', str(source), 'rev-parse', 'HEAD']).decode().strip() == args.ref, 'candidate SHA mismatch')
    require(not command(['git', '-C', str(source), 'status', '--porcelain', '--untracked-files=all', '--ignore-submodules=none']).strip(),
            'candidate checkout must be clean')
    require(b'160000 ' not in command(['git', '-C', str(source), 'ls-tree', '-r', args.ref]), 'submodules are unsupported')
    old_config = configuration(runtime, env_file)
    require(configuration(source, env_file) == old_config, 'candidate changes database image, TLS or published port')
    previous = running(runtime, env_file, old_config)
    print('HOME_TEST_UPDATE_READY=true CURRENT_COMMIT=' + old_sha + ' CANDIDATE_COMMIT=' + args.ref, flush=True)
    if not args.apply:
        return
    lock_path = runtime.parent / '.newscast-home-test-update.lock'
    lock_fd = os.open(lock_path, os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    lock_info = os.fstat(lock_fd)
    require(lock_info.st_uid == os.getuid() and stat.S_IMODE(lock_info.st_mode) == 0o600, 'unsafe update lock')
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise Refused('another home test update is running')
    require(marker.read_text().strip() == old_sha and configuration(runtime, env_file) == old_config, 'runtime changed during preflight')
    previous = running(runtime, env_file, old_config)
    updates = runtime.parent / '.newscast-home-test-updates'
    if not updates.exists():
        updates.mkdir(mode=0o700)
    private_dir(updates)
    run_dir = Path(tempfile.mkdtemp(prefix='update-', dir=updates))
    staged = run_dir / 'candidate'
    staged.mkdir(mode=0o700)
    record = {'status': 'preparing', 'phase': 'archive', 'previous_commit': old_sha,
              'candidate_commit': args.ref, 'previous_images': {k: v['Image'] for k, v in previous.items()},
              'database_volume': VOLUME, 'database_snapshot_complete': False}
    record_path = run_dir / 'update.json'

    def save():
        record_path.write_text(json.dumps(record, indent=2) + '\n')
        record_path.chmod(0o600)

    changed = False
    current_root = runtime
    try:
        save()
        archive = command(['git', '-C', str(source), 'archive', '--format=tar', args.ref])
        record['source_archive_sha256'] = hashlib.sha256(archive).hexdigest()
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            for member in tar.getmembers():
                require(not member.name.startswith('/') and '..' not in Path(member.name).parts
                        and (member.isfile() or member.isdir()), 'archive contains unsafe paths or links')
            tar.extractall(staged)
        (staged / 'SOURCE_COMMIT').write_text(args.ref + '\n')
        shutil.copyfile(env_file, staged / '.env')
        (staged / '.env').chmod(0o600)
        require(configuration(staged, staged / '.env') == old_config, 'staged configuration mismatch')
        record['phase'] = 'save_previous_images'; save()
        image_archive = run_dir / 'previous-images.tar'
        with image_archive.open('wb') as output:
            command(DOCKER + ['image', 'save', *dict.fromkeys(record['previous_images'].values())], output=output)
        require(image_archive.stat().st_size > 0, 'empty previous-image archive')
        (run_dir / 'previous-images.tar.sha256').write_text(checksum(image_archive) + '  previous-images.tar\n')
        record['phase'] = 'build'; save()
        build_tags = {name: 'newscast-navigator-' + name + ':home-test-' + args.ref for name in APPS}
        build_file = run_dir / 'build-images.compose.json'
        build_file.write_text(json.dumps({'services': {name: {'image': tag} for name, tag in build_tags.items()}}) + '\n')
        # Existing tags remain untouched even if the new build fails part-way.
        command(compose(staged, staged / '.env', 'build', *APPS, images_file=build_file))
        images = {'db': old_config['db_image']}
        for name in APPS:
            image = json.loads(command(DOCKER + ['image', 'inspect', build_tags[name]]))[0]['Id']
            require(re.fullmatch(IMAGE, image), 'invalid built image')
            images[name] = image
        record['candidate_images'] = images
        images_file = run_dir / 'candidate-images.compose.json'
        images_file.write_text(json.dumps({'services': {name: {'image': images[name], 'pull_policy': 'never'} for name in APPS}}) + '\n')
        record['phase'] = 'snapshot'; save()
        changed = True
        command(compose(runtime, env_file, 'stop', 'gateway', 'backend'))
        dump = run_dir / 'database.dump'
        with dump.open('wb') as output:
            command(DOCKER + ['exec', previous['db']['Id'], 'sh', '-c',
                             'exec pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"'], output=output)
        require(dump.stat().st_size > 0, 'empty database snapshot')
        with dump.open('rb') as input_file:
            command(DOCKER + ['exec', '-i', previous['db']['Id'], 'pg_restore', '--list'], input_file=input_file)
        digest = checksum(dump)
        (run_dir / 'database.dump.sha256').write_text(digest + '  database.dump\n')
        record['database_snapshot_complete'] = True
        record['phase'] = 'switch_source'; save()
        runtime.rename(run_dir / 'previous')
        current_root = run_dir / 'previous'
        staged.rename(runtime)
        current_root = runtime
        record['phase'] = 'migration'; save()
        command(compose(runtime, runtime / '.env', 'run', '--rm', '--no-deps', 'backend', 'alembic', 'upgrade', 'head', images_file=images_file))
        record['phase'] = 'start'; save()
        command(compose(runtime, runtime / '.env', 'up', '-d', '--no-build', '--no-deps', '--force-recreate', '--wait', *APPS, images_file=images_file))
        actual = running(runtime, runtime / '.env', old_config)
        require({k: v['Image'] for k, v in actual.items()} == images, 'started image IDs differ from built candidate')
        command(['curl', '--fail', '--silent', '--show-error', '--max-time', '15', '--cacert',
                 str(Path(old_config['tls']) / 'ca.pem'), 'https://192.168.2.200:' + old_config['port'] + '/api/health'])
        record['status'] = 'complete'; record['phase'] = 'verified'; save()
        print('HOME_TEST_UPDATED=true SOURCE_COMMIT=' + args.ref + ' RECOVERY_DIR=' + str(run_dir))
    except (Exception, KeyboardInterrupt):
        record['status'] = 'failed'
        if changed:
            # A migration can have committed. Never auto-restore or start old code.
            # Cleanup must not depend on writable logs or a functioning filesystem.
            try:
                stopped = subprocess.run(compose(current_root, current_root / '.env', 'stop', 'gateway', 'backend'),
                                         env=ENV, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
            except OSError:
                stopped = False
            record['app_stop_confirmed'] = stopped
            print('HOME_TEST_APP_STOP_CONFIRMED=' + str(stopped).lower(), file=sys.stderr)
        try:
            save()
        except OSError:
            print('HOME_TEST_RECORD_SAVED=false', file=sys.stderr)
        print('HOME_TEST_UPDATE_FAILED=true RECOVERY_DIR=' + str(run_dir), file=sys.stderr)
        raise Refused('update failed during ' + record['phase'] + '; inspect private recovery record')
    finally:
        os.close(lock_fd)


def interrupted(signum, frame):
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, interrupted)
try:
    main()
except Refused as error:
    print('Home test update refused: ' + str(error), file=sys.stderr)
    sys.exit(2)
except (OSError, ValueError, KeyError, TypeError, KeyboardInterrupt):
    # Never expose raw exceptions, environment or subprocess output.
    print('Home test update refused or failed; no automatic database rollback.', file=sys.stderr)
    sys.exit(2)
PY
