"""HTTPS smoke with a dedicated probe account; payloads and secrets stay silent."""
import argparse
import http.client
import io
import json
from pathlib import Path
import socket
import ssl
import uuid
import zipfile

parser = argparse.ArgumentParser()
parser.add_argument('--host', default='ncastnav.ru')
parser.add_argument('--connect-ip', default='127.0.0.1')
parser.add_argument('--port', type=int, default=443)
parser.add_argument('--username')
parser.add_argument('--password-file', type=Path)
parser.add_argument('--write-test', action='store_true')
args = parser.parse_args()
assert (args.username is None) == (args.password_file is None)
assert not args.write_test or args.username, 'Write test requires dedicated probe account'
cookie = ''


def request(method, path, payload=None, extra=None):
    connection = http.client.HTTPSConnection(args.host, args.port, context=ssl.create_default_context(), timeout=30)
    connection._create_connection = lambda address, timeout, source_address=None: socket.create_connection((args.connect_ip, args.port), timeout)
    headers = {'Content-Type': 'application/json'}
    if cookie:
        headers['Cookie'] = cookie
    if extra:
        headers.update(extra)
    connection.request(method, path, json.dumps(payload) if payload is not None else None, headers)
    response = connection.getresponse()
    data, status = response.read(), response.status
    response_headers = {key.lower(): value for key, value in response.getheaders()}
    connection.close()
    assert status == 200, f'{method} {path}: HTTP {status}'
    return data, response_headers


def json_request(method, path, payload=None, extra=None):
    data, headers = request(method, path, payload, extra)
    return json.loads(data), headers


assert json_request('GET', '/api/health')[0]['status'] == 'ok'
_, frontend_headers = request('GET', '/')
assert 'text/html' in frontend_headers['content-type']
if args.username:
    password = args.password_file.read_text().strip()
    _, headers = json_request('POST', '/api/v1/auth/login', {'username': args.username, 'password': password})
    assert 'secure' in headers['set-cookie'].lower() and 'httponly' in headers['set-cookie'].lower()
    cookie = headers['set-cookie'].split(';')[0]
    assert json_request('GET', '/api/v1/auth/me')[0]['username'] == args.username
    if args.write_test:
        options, _ = json_request('GET', '/api/v1/stories/create-options')
        assert options['create_action'] and options['rubrics']
        title = 'Синтетическая проверка переноса ' + str(uuid.uuid4())
        ack, _ = json_request('POST', '/api/v1/stories', {'title': title, 'rubric_id': options['rubrics'][0]['id']})
        story_id = ack['resource']['id']
        base = f'/api/v1/stories/{story_id}/scenario'
        state, _ = json_request('GET', base)
        lease, _ = json_request('POST', base + '/lease')
        rows = state['scenario']['rows']
        marker = 'Проверка сохранения после переноса.'
        rows.append({'segment_uid': 'seg_' + str(uuid.uuid4()), 'order_index': len(rows) + 1, 'block_type': 'zk', 'text': marker})
        try:
            saved, _ = json_request('PUT', base, {'base_revision': lease['revision'], 'client_save_id': str(uuid.uuid4()), 'edit_session_id': lease['edit_session_id'], 'lease_token': lease['lease_token'], 'rows': rows})
        finally:
            json_request('DELETE', base + '/lease', {'edit_session_id': lease['edit_session_id'], 'lease_token': lease['lease_token']})
        state, _ = json_request('GET', base)
        assert state['scenario']['revision'] == saved['revision'] and state['scenario']['rows'][-1]['text'] == marker
        story = state['story']
        doc, headers = request('POST', base + '/export-docx', {'expected_revision': state['scenario']['revision'], 'expected_title': story['title'], 'expected_rubric_id': story['rubric']['id'], 'expected_duration_text': story['duration_text']})
        assert 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' in headers['content-type']
        assert 'word/document.xml' in zipfile.ZipFile(io.BytesIO(doc)).namelist()
        cp, _ = json_request('POST', '/api/v1/auth/login', {'username': args.username, 'password': password}, {'Origin': 'null'})
        cookie = ''
        cp_headers = {'Origin': 'null', 'Authorization': 'Bearer ' + cp['access_token']}
        choices, headers = json_request('GET', '/api/v1/integrations/captionpanels/stories', extra=cp_headers)
        assert headers.get('access-control-allow-origin') == 'null'
        assert any(item['storyId'] == story_id for item in choices['items'])
        json_request('GET', f'/api/v1/integrations/captionpanels/stories/{story_id}/import-json', extra=cp_headers)
print('HTTPS_SMOKE=ok login=' + str(bool(args.username)).lower() + ' write=' + str(args.write_test).lower())
