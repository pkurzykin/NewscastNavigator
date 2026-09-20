"""Closed synthetic rehearsal only; never prints credentials or payloads."""
import http.client, ssl, socket, json, pathlib, sys, io, zipfile, uuid
root = pathlib.Path(sys.argv[1]); port = int(sys.argv[2])
assert root.name in {'newscast-rehearsal', 'newscast-restore-rehearsal'}
pw = (root / 'smoke.password').read_text().strip()
cookie = ''
def request(method, path, payload=None, extra=None):
    c = http.client.HTTPSConnection('ncastnav.ru', port, context=ssl.create_default_context(), timeout=25)
    c._create_connection = lambda address, timeout, source_address=None: socket.create_connection(('127.0.0.1', port), timeout)
    headers = {'Content-Type': 'application/json'}
    if cookie: headers['Cookie'] = cookie
    if extra: headers.update(extra)
    c.request(method, path, json.dumps(payload) if payload is not None else None, headers)
    r = c.getresponse(); data = r.read(); status=r.status; h=dict(r.getheaders()); c.close()

    if status != 200:
        detail=json.loads(data).get('detail')
        safe=[{'loc':e.get('loc'),'type':e.get('type'),'msg':e.get('msg')} for e in detail] if isinstance(detail,list) else {k:detail.get(k) for k in ('code','message')} if isinstance(detail,dict) else str(detail)[:160]
        raise AssertionError(f'{method} {path}: HTTP {status}; {safe}')
    return data, {k.lower():v for k,v in h.items()}
def j(method, path, payload=None, extra=None):
    data,h=request(method,path,payload,extra); return json.loads(data),h
assert j('GET','/api/health')[0]['status']=='ok'
login,h=j('POST','/api/v1/auth/login',{'username':'astra','password':pw})
assert 'secure' in h['set-cookie'].lower() and 'httponly' in h['set-cookie'].lower()
cookie=h['set-cookie'].split(';')[0]
assert j('GET','/api/v1/auth/me')[0]['username']=='astra'
stories,_=j('GET','/api/v1/stories?scope=active&limit=100')
assert len(stories['items'])==30
chosen=next((s for s in stories['items'] if s['author']['username']=='astra'), stories['items'][0]); sid=chosen['id']
base=f'/api/v1/stories/{sid}/scenario'
state,_=j('GET',base)
# Modify only synthetic story and verify persisted row, including stable UID.
if '--save' in sys.argv:
    lease,_=j('POST',base+'/lease')
    marker='Hostland: синтетическая проверка сохранения и восстановления.'
    rows=state['scenario']['rows']
    rows.append({'segment_uid':'seg_'+str(uuid.uuid4()),'order_index':len(rows)+1,'block_type':'zk','text':marker})
    try:
        saved,_=j('PUT',base,{'base_revision':lease['revision'],'client_save_id':str(uuid.uuid4()),'edit_session_id':lease['edit_session_id'],'lease_token':lease['lease_token'],'rows':rows})
    finally:
        j('DELETE',base+'/lease',{'edit_session_id':lease['edit_session_id'],'lease_token':lease['lease_token']})
    state,_=j('GET',base)
    assert state['scenario']['rows'][-1]['text']==marker and state['scenario']['revision']==saved['revision']
story=state['story']
doc,h=request('POST',base+'/export-docx',{'expected_revision':state['scenario']['revision'],'expected_title':story['title'],'expected_rubric_id':story['rubric']['id'],'expected_duration_text':story['duration_text']})
assert 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' in h['content-type']
assert 'attachment' in h['content-disposition'] and 'no-store' in h['cache-control']
assert 'word/document.xml' in zipfile.ZipFile(io.BytesIO(doc)).namelist()
cp,_=j('POST','/api/v1/auth/login',{'username':'astra','password':pw},{'Origin':'null'})
cookie=''
headers={'Origin':'null','Authorization':'Bearer '+cp['access_token']}
choices,h=j('GET','/api/v1/integrations/captionpanels/stories',extra=headers)
assert len(choices['items'])==30 and h.get('access-control-allow-origin')=='null', {'count':len(choices['items']),'allow_origin':h.get('access-control-allow-origin')}
j('GET',f'/api/v1/integrations/captionpanels/stories/{sid}/import-json',extra=headers)
print(json.dumps({'https_verified':True,'login_secure_httponly':True,'me':True,'active_stories':30,'scenario_save':'--save' in sys.argv,'docx_bytes':len(doc),'captionpanels_origin_null':True,'port':port}))
