#!/usr/bin/env bash
set -euo pipefail
umask 077

runtime_dir=/opt/newscast-production
while [[ $# -gt 0 ]]; do
  case $1 in
    --runtime-dir) runtime_dir=${2:-}; shift 2 ;;
    *) exit 2 ;;
  esac
done
[[ $runtime_dir == /* && -d $runtime_dir && ! -L $runtime_dir ]] || exit 2
for file in compose.yaml production-gateway.conf.template runtime.env image-manifest.json source.tar.gz source.sha256 backup-recipient.txt tls/active/fullchain.pem tls/active/privkey.pem; do
  [[ -f $runtime_dir/$file && ! -L $runtime_dir/$file ]] || { echo "Release prerequisite missing: $file" >&2; exit 2; }
done
[[ -L $runtime_dir/tls/active && $(readlink "$runtime_dir/tls/active") =~ ^versions/[A-Za-z0-9-]+$ ]] || exit 2
[[ -f $runtime_dir/systemd/newscast-production.service && -f $runtime_dir/systemd/backup.timer && -f $runtime_dir/systemd/home-pull.timer ]] || exit 2
python3 - "$runtime_dir/source.sha256" <<'PY'
from pathlib import Path
import re,sys
assert re.fullmatch(r'[a-f0-9]{64}  source\.tar\.gz\n',Path(sys.argv[1]).read_text())
PY
(cd "$runtime_dir"; sha256sum --quiet --strict -c source.sha256)
python3 - "$runtime_dir" <<'PY'
from pathlib import Path
import json,re,subprocess,sys
root=Path(sys.argv[1]); manifest=json.loads((root/'image-manifest.json').read_text())
sha=manifest['source_commit']; images=manifest['images']
assert re.fullmatch(r'[a-f0-9]{40}',sha)
assert set(images)=={'db','backend','frontend','gateway'}
assert all(re.fullmatch(r'sha256:[a-f0-9]{64}',v) for v in images.values())
env=dict(line.split('=',1) for line in (root/'runtime.env').read_text().splitlines() if '=' in line)
for name,image in images.items():
    assert env[name.upper()+'_IMAGE']==image
    result=subprocess.run(['docker','image','inspect','--format={{.Id}}',image],capture_output=True,text=True,check=True)
    assert result.stdout.strip()==image
for name in ('backend','frontend'):
    result=subprocess.run(['docker','image','inspect','--format={{index .Config.Labels "org.opencontainers.image.revision"}}',images[name]],capture_output=True,text=True,check=True)
    assert result.stdout.strip()==sha
assert env.get('SEED_DEMO_DATA','false').lower()=='false'
assert env.get('NGINX_MAINTENANCE','on') in ('on','off')
assert env.get('HOST_BIND_IP','127.0.0.1') in ('127.0.0.1','0.0.0.0')
PY
docker compose --project-name newscast_navigator_production --env-file "$runtime_dir/runtime.env" -f "$runtime_dir/compose.yaml" config --quiet </dev/null
echo 'RELEASE_VERIFIED=true'
