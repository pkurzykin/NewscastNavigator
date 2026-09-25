#!/usr/bin/env bash
# Restore VDS ciphertext with the USB identity into a disposable local stack.
set -euo pipefail
umask 077
base=/home/newscast/private-demo/hostland-backups/restore-checks
age=/home/newscast/private-demo/hostland-backups/tools/extracted/usr/bin/age
project=nn-home-loss-drill-1c
script_dir=$(cd -- "$(dirname -- "$0")" && pwd -P)
workspace=''
db_name=''
full_name=''
trusted_manifest_sha256=''
usage() { echo 'usage: rehearse_home_loss.sh --workspace DIR --db-name DB.age --full-name FULL.age --trusted-manifest-sha256 SHA256' >&2; exit 2; }
while [[ $# -gt 0 ]]; do
  case $1 in
    --workspace) [[ $# -ge 2 ]] || usage; workspace=$2; shift 2 ;;
    --db-name) [[ $# -ge 2 ]] || usage; db_name=$2; shift 2 ;;
    --full-name) [[ $# -ge 2 ]] || usage; full_name=$2; shift 2 ;;
    --trusted-manifest-sha256) [[ $# -ge 2 ]] || usage; trusted_manifest_sha256=$2; shift 2 ;;
    *) usage ;;
  esac
done
[[ $db_name =~ ^db-[0-9]{8}T[0-9]{6}Z-production\.dump\.age$ &&
   $full_name =~ ^full-[0-9]{8}T[0-9]{6}Z-production\.tar\.age$ ]] || {
  echo 'Invalid backup name' >&2; exit 2;
}
[[ $workspace =~ ^${base}/home-loss-[a-z0-9-]+$ &&
   -d $base && ! -L $base && -d $workspace && ! -L $workspace ]] || {
  echo 'Unsafe workspace' >&2; exit 2;
}
[[ $trusted_manifest_sha256 =~ ^[a-f0-9]{64}$ ]] || {
  echo 'Missing trusted live-release manifest digest' >&2; exit 2;
}
[[ $(stat -c %a "$workspace") == 700 && $(stat -c %U "$workspace") == "$(id -un)" ]] || {
  echo 'Workspace must be private and owned by the current user' >&2; exit 2;
}
[[ $(id -un) == newscast && -x $age ]] || { echo 'Wrong host or missing age' >&2; exit 2; }
for file in identity.agekey "$db_name" "$db_name.json" "$full_name" "$full_name.json"; do
  [[ -f $workspace/$file && ! -L $workspace/$file ]] || {
    echo 'Missing or unsafe input file' >&2; exit 2;
  }
done
[[ $(stat -c %a "$workspace/identity.agekey") == 600 ]] || {
  echo 'Identity must have mode 0600' >&2; exit 2;
}
for path in "$workspace/bundle.tar" "$workspace/database.dump" "$workspace/bundle" "$workspace/run"; do
  [[ ! -e $path && ! -L $path ]] || { echo 'Workspace contains old plaintext' >&2; exit 2; }
done
[[ ! -e $workspace/compose-config.json && ! -L $workspace/compose-config.json &&
   ! -e $workspace/restored-fingerprint.json && ! -L $workspace/restored-fingerprint.json ]] || {
  echo 'Workspace contains old result files' >&2; exit 2;
}
created=false
runtime=$workspace/run/runtime
compose() {
  docker compose --project-name "$project" --env-file "$runtime/runtime.env" -f "$runtime/compose.yaml" "$@"
}
cleanup() {
  status=$?
  trap - EXIT
  set +e
  if [[ $created == true && -f $runtime/compose.yaml ]]; then
    compose down --volumes --remove-orphans >/dev/null 2>&1
  fi
  rm -f -- "$workspace/identity.agekey" "$workspace/database.dump" "$workspace/bundle.tar" "$workspace/compose-config.json"
  rm -rf -- "$workspace/bundle" "$workspace/run"
  exit "$status"
}
trap cleanup EXIT
exec 9>"$base/.home-loss-1c.lock"
flock -n 9 || { echo 'Another drill is active' >&2; exit 2; }
docker info >/dev/null
if docker volume inspect "${project}_production_pg_data" >/dev/null 2>&1 ||
   docker network inspect "${project}_default" >/dev/null 2>&1 ||
   docker ps -a --format '{{.Names}}' | grep -q "^${project}-"; then
  echo 'Disposable resource name already exists' >&2; exit 2
fi
[[ -z $(docker ps -aq --filter "label=com.docker.compose.project=$project") &&
   -z $(docker volume ls -q --filter "label=com.docker.compose.project=$project") &&
   -z $(docker network ls -q --filter "label=com.docker.compose.project=$project") ]] || {
  echo 'Disposable Compose project already exists' >&2; exit 2;
}

python3 - "$workspace" "$db_name" "$full_name" <<'PY'
import hashlib,json,re,sys
from pathlib import Path
root=Path(sys.argv[1]); items=[]
for name in sys.argv[2:]:
    item=json.loads((root/(name+".json")).read_text())
    assert item["name"]==name and item["kind"]=="production"
    assert re.fullmatch(r"[a-f0-9]{40}",item["source_commit"])
    assert re.fullmatch(r"[a-f0-9]{64}",item["sha256"])
    assert type(item["bytes"]) is int and item["bytes"]>0
    data=root/name
    assert data.stat().st_size==item["bytes"]
    with data.open("rb") as stream: digest=hashlib.file_digest(stream,"sha256").hexdigest()
    assert digest==item["sha256"],"Ciphertext checksum mismatch"
    items.append(item)
assert items[0]["source_commit"]==items[1]["source_commit"],"DB/full release mismatch"
PY

"$age" --decrypt -i "$workspace/identity.agekey" -o "$workspace/database.dump" "$workspace/$db_name"
"$age" --decrypt -i "$workspace/identity.agekey" -o "$workspace/bundle.tar" "$workspace/$full_name"
python3 - "$workspace" <<'PY'
import tarfile,sys
from pathlib import Path
root=Path(sys.argv[1]); target=root/"bundle"; target.mkdir(mode=0o700); seen=set()
with tarfile.open(root/"bundle.tar") as archive:
    for item in archive.getmembers():
        path=Path(item.name)
        relative=Path(*[part for part in path.parts if part!="."])
        assert not path.is_absolute() and ".." not in path.parts
        if relative==Path():
            assert item.isdir()
            continue
        assert relative not in seen,"Duplicate archive member"
        seen.add(relative)
        if item.issym():
            assert relative==Path("runtime/tls/active") and item.linkname=="versions/initial"
        else:
            assert item.isfile() or item.isdir(),"Unsafe archive member type"
    archive.extractall(target,filter="data")
for name in ("SHA256SUMS","images.tar","database.dump","runtime/runtime.env",
             "runtime/compose.yaml","runtime/image-manifest.json",
             "runtime/db_fingerprint.py","runtime/prod_smoke.py"):
    assert (target/name).is_file(),f"Full bundle missing {name}"
PY
(cd "$workspace/bundle"; sha256sum --quiet --strict -c SHA256SUMS)
[[ $(sha256sum "$workspace/bundle/runtime/image-manifest.json" | cut -d' ' -f1) == "$trusted_manifest_sha256" ]] || {
  echo 'Backup images do not match independently verified live release' >&2; exit 1;
}
mkdir -m 700 "$workspace/run"
cp -a "$workspace/bundle/runtime" "$runtime"
for name in compose.yaml production-gateway.conf.template; do
  trusted_name=$name
  [[ $name == compose.yaml ]] && trusted_name=production.compose.yaml
  [[ -f $script_dir/$trusted_name && ! -L $script_dir/$trusted_name &&
     -f $runtime/$name && ! -L $runtime/$name ]] || {
    echo 'Trusted runtime contract is missing' >&2; exit 1;
  }
  cmp -s "$script_dir/$trusted_name" "$runtime/$name" || {
    echo 'Backup runtime differs from trusted release contract' >&2; exit 1;
  }
done
for name in db_fingerprint.py prod_smoke.py; do
  [[ -f $script_dir/$name && ! -L $script_dir/$name ]] || {
    echo 'Trusted verification script is missing' >&2; exit 1;
  }
done
mkdir -m 755 "$runtime/acme-webroot"
python3 - "$workspace" "$db_name" <<'PY'
import json,sys
from pathlib import Path
root=Path(sys.argv[1]); name=sys.argv[2]; runtime=root/"run/runtime"
manifest=json.loads((runtime/"image-manifest.json").read_text())
meta=json.loads((root/(name+".json")).read_text())
assert manifest["source_commit"]==meta["source_commit"]
assert set(manifest["images"])=={"db","backend","frontend","gateway"}
env=runtime/"runtime.env"; lines=env.read_text().splitlines()
overrides={"HOST_BIND_IP":"127.0.0.1","HTTP_PORT":"18089",
           "HTTPS_PORT":"18444","NGINX_MAINTENANCE":"off"}
lines=[line for line in lines if line.split("=",1)[0] not in overrides]
env.write_text("\n".join(lines+[f"{k}={v}" for k,v in overrides.items()])+"\n")
env.chmod(0o600)
PY
python3 - "$workspace/bundle/images.tar" "$runtime/image-manifest.json" <<'PY'
import hashlib,json,sys,tarfile
from pathlib import PurePosixPath

expected=set(json.load(open(sys.argv[2]))["images"].values())
with tarfile.open(sys.argv[1]) as archive:
    members=archive.getmembers()
    seen_names=set()
    for member in members:
        path=PurePosixPath(member.name)
        assert not path.is_absolute() and ".." not in path.parts
        assert member.isfile() or member.isdir(),"Unsafe Docker archive member"
        normalized=str(path)
        if member.isdir():
            assert member.name in (normalized,normalized+"/"),"Noncanonical Docker directory"
        else:
            assert member.name==normalized,"Noncanonical Docker file"
        assert normalized not in seen_names,"Duplicate Docker archive member"
        seen_names.add(normalized)
    manifest_member=archive.getmember("manifest.json")
    assert manifest_member.isfile()
    if "repositories" in seen_names:
        repositories=archive.getmember("repositories")
        assert repositories.isfile()
        assert json.load(archive.extractfile(repositories))=={},"Docker archive may not change tags"
    records=json.load(archive.extractfile(manifest_member))
    assert isinstance(records,list) and len(records)==len(expected)
    config_ids=set()
    for record in records:
        assert record.get("RepoTags") in (None,[]),"Docker archive may not change tags"
        name=record["Config"]
        path=PurePosixPath(name)
        assert not path.is_absolute() and ".." not in path.parts
        member=archive.getmember(name)
        assert member.isfile()
        for layer_name in record["Layers"]:
            layer_path=PurePosixPath(layer_name)
            assert not layer_path.is_absolute() and ".." not in layer_path.parts
            assert archive.getmember(layer_name).isfile()
        image_id="sha256:"+hashlib.sha256(archive.extractfile(member).read()).hexdigest()
        assert image_id not in config_ids
        config_ids.add(image_id)
    if "index.json" in seen_names:
        assert "oci-layout" in seen_names
        layout=json.load(archive.extractfile("oci-layout"))
        assert layout=={"imageLayoutVersion":"1.0.0"}
        index=json.load(archive.extractfile("index.json"))
        assert index["schemaVersion"]==2 and not index.get("annotations")
        roots=index["manifests"]
        assert len(roots)==len(expected)
        found=set()
        oci_config_ids=set()
        def read_blob(digest):
            assert digest.startswith("sha256:") and len(digest)==71
            blob="blobs/sha256/"+digest.removeprefix("sha256:")
            member=archive.getmember(blob)
            assert member.isfile()
            return json.load(archive.extractfile(member))
        for root in roots:
            annotations=root.get("annotations") or {}
            assert set(annotations)<={"containerd.io/distribution.source.docker.io"}
            assert all(isinstance(value,str) and len(value)<=256 for value in annotations.values())
            assert not root.get("urls")
            image_id=root["digest"]
            assert image_id in expected and image_id not in found
            found.add(image_id)
            image=read_blob(image_id)
            if image.get("mediaType")=="application/vnd.oci.image.index.v1+json":
                candidates=[item for item in image["manifests"]
                            if item.get("mediaType")=="application/vnd.oci.image.manifest.v1+json"
                            and item.get("platform",{}).get("os")=="linux"
                            and item.get("platform",{}).get("architecture")=="amd64"]
                assert len(candidates)==1
                image=read_blob(candidates[0]["digest"])
            assert image.get("mediaType")=="application/vnd.oci.image.manifest.v1+json"
            config_id=image["config"]["digest"]
            assert config_id not in oci_config_ids
            oci_config_ids.add(config_id)
        assert found==expected,"OCI archive does not contain all trusted release images"
        assert oci_config_ids==config_ids,"OCI and Docker manifests disagree about images"
        for member in members:
            if member.isfile() and member.name.startswith("blobs/sha256/"):
                digest=member.name.rsplit("/",1)[-1]
                assert len(digest)==64 and all(c in "0123456789abcdef" for c in digest)
                with archive.extractfile(member) as stream:
                    assert hashlib.file_digest(stream,"sha256").hexdigest()==digest
    else:
        assert "oci-layout" not in seen_names
        assert config_ids==expected,"Docker archive does not contain all trusted release images"
PY
docker load -i "$workspace/bundle/images.tar" >/dev/null
python3 - "$runtime/image-manifest.json" <<'PY'
import json,subprocess,sys
images=json.load(open(sys.argv[1]))["images"]
for image_id in images.values():
    assert image_id.startswith("sha256:")
    subprocess.run(["docker","image","inspect",image_id],
                   stdout=subprocess.DEVNULL,check=True)
PY
compose config --format json > "$workspace/compose-config.json"
python3 - "$workspace/compose-config.json" "$runtime" "$runtime/image-manifest.json" "$project" <<'PY'
import json,sys,urllib.parse
from pathlib import Path
config=json.load(open(sys.argv[1])); runtime=Path(sys.argv[2]).resolve()
manifest=json.load(open(sys.argv[3])); project=sys.argv[4]
services=config["services"]
assert set(services)=={"db","backend","frontend","gateway"}
assert set(config["networks"])=={"default"}
network=config["networks"]["default"]
assert network["name"]==project+"_default" and not network.get("external")
assert set(config["volumes"])=={"production_pg_data"}
volume=config["volumes"]["production_pg_data"]
assert volume["name"]==project+"_production_pg_data" and not volume.get("external")
for name,service in services.items():
    assert service["image"]==manifest["images"][name]
    assert service["pull_policy"]=="never" and "build" not in service
    assert service.get("networks")=={"default":None}
    for unsafe in ("privileged","network_mode","pid","ipc","uts","userns_mode",
                   "devices","cap_add","volumes_from","container_name",
                   "external_links","extra_hosts","secrets","configs"):
        assert not service.get(unsafe),f"Unsafe Compose setting: {unsafe}"
    ports=service.get("ports",[])
    if name=="gateway":
        assert {(p["host_ip"],str(p["published"]),p["target"]) for p in ports}=={
            ("127.0.0.1","18089",80),("127.0.0.1","18444",443)}
    else:
        assert not ports
    mounts=service.get("volumes",[])
    if name=="db":
        assert len(mounts)==1 and mounts[0]["type"]=="volume"
        assert mounts[0]["source"]=="production_pg_data"
        assert mounts[0]["target"]=="/var/lib/postgresql/data"
    elif name in ("backend","frontend"):
        assert not mounts
    for mount in service.get("volumes",[]):
        if mount["type"]=="bind":
            assert Path(mount["source"]).resolve().is_relative_to(runtime)
            assert mount.get("read_only") is True
assert services["backend"]["environment"]["ENVIRONMENT"]=="production"
assert services["backend"]["environment"]["SEED_DEMO_DATA"]=="false"
db=services["db"]["environment"]
url=urllib.parse.urlsplit(services["backend"]["environment"]["DATABASE_URL"])
assert url.scheme in ("postgresql","postgresql+psycopg")
assert url.hostname=="db" and url.port in (None,5432)
assert urllib.parse.unquote(url.username or "")==db["POSTGRES_USER"]
assert urllib.parse.unquote(url.password or "")==db["POSTGRES_PASSWORD"]
assert urllib.parse.unquote(url.path.lstrip("/"))==db["POSTGRES_DB"]
PY
created=true
compose up -d --no-build --pull never --wait db >/dev/null
relations=$(compose exec -T db sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = '\''public'\'';"' </dev/null)
[[ $relations == 0 ]] || { echo 'Disposable DB is not empty' >&2; exit 1; }
compose exec -T db sh -c 'exec pg_restore --exit-on-error --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$workspace/database.dump" >/dev/null
revision=$(compose exec -T db sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT version_num FROM alembic_version;"' </dev/null)
[[ $revision == 20260914_0005 ]] || { echo 'Unexpected restored schema' >&2; exit 1; }
relations=$(compose exec -T db sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema = '\''public'\'';"' </dev/null)
[[ $relations =~ ^[0-9]+$ && $relations -ge 21 ]] || { echo 'Restored DB is incomplete' >&2; exit 1; }
python3 "$script_dir/db_fingerprint.py" "$runtime" "$project" > "$workspace/restored-fingerprint.json"
compose up -d --no-build --pull never --wait backend frontend gateway >/dev/null
python3 "$script_dir/prod_smoke.py" --host ncastnav.ru --connect-ip 127.0.0.1 --port 18444
compose down --volumes --remove-orphans >/dev/null
created=false
[[ -z $(docker volume ls -q --filter "label=com.docker.compose.project=$project") ]] || {
  echo 'Disposable volume still exists' >&2; exit 1;
}
echo "HOME_LOSS_DRILL=ok TABLES=$relations SCHEMA=$revision PROJECT_REMOVED=true"
