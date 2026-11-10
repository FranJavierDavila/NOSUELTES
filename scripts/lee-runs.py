import json, sys

d = json.load(open('/tmp/runs2.json'))
if 'workflow_runs' not in d:
    print('SIN workflow_runs. Claves:', list(d.keys())[:6])
    print(str(d)[:300])
    sys.exit(0)
for r in d['workflow_runs']:
    print(r['run_number'], '|', r['name'][:30], '|', r['head_sha'][:7], '|', r['status'], '|', r.get('conclusion'))
