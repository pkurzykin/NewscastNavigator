import json,subprocess,sys
root,project=sys.argv[1:3]
c=['docker','compose','--project-name',project,'--env-file',root+'/runtime.env','-f',root+'/compose.yaml','exec','-T','db','sh','-c','exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At']
def sql(s):
    return subprocess.run(c,input=s,text=True,capture_output=True,check=True).stdout.strip()
tables=sql("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;").splitlines()
result={}
for name in tables:
    ident='"'+name.replace('"','""')+'"'
    count,digest=sql(f"SELECT count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' ORDER BY md5(to_jsonb(t)::text)),'')) FROM public.{ident} t;").split('|')
    result[name]={'rows':int(count),'content_digest':digest}
print(json.dumps(result,indent=2,sort_keys=True))
