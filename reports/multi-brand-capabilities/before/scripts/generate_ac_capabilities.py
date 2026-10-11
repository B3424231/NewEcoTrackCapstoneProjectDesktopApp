from pathlib import Path
import json,sys,copy
root=Path(__file__).resolve().parent.parent
data=json.loads((root/'config/ac-capabilities.json').read_text(encoding='utf-8'))
data['aliases'].pop('TCL',None)
if 'TEKNOPOINT' not in data['protocols']:
    data['protocols']['TEKNOPOINT']=copy.deepcopy(data['protocols']['TCL112AC'])
    data['protocols']['TEKNOPOINT']['protocol']='TEKNOPOINT'
(root/'config/ac-capabilities.json').write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
resolver=(root/'public/js/ac-capability-registry.source.js').read_text(encoding='utf-8').replace('/* AC_CAPABILITY_DATA */ {}',json.dumps(data,separators=(',',':')))
wrapper=(root/'config/ac-capability-engine.source.js').read_text(encoding='utf-8')
block='  // ===== CAPABILITY ENGINE =====\n'+resolver+'\n'+wrapper+'\n'
path=root/'public/js/aircon-system.js'
source=path.read_text(encoding='utf-8')
start=source.index('  // ===== CAPABILITY ENGINE =====')
end=source.index('  // ===== PROTOCOL ADAPTER & IR SERVICE =====',start)
next_source=source[:start]+block+source[end:]
state=(root/'public/js/aircon-state.js').read_text(encoding='utf-8')
boundary=source.index('})(typeof window',0)
boundary=source.index('\n',boundary)+1
next_boundary=next_source.index('})(typeof window')
next_boundary=next_source.index('\n',next_boundary)+1
next_source=state.rstrip()+'\n'+next_source[next_boundary:]
if '--check' in sys.argv:
    if next_source!=source: raise SystemExit('Generated registry or state helper drift')
else:
    backup=root/'reports/multi-brand-capabilities/before/public/js/aircon-system.js'
    backup.parent.mkdir(parents=True,exist_ok=True)
    if not backup.exists():backup.write_bytes(path.read_bytes())
    path.write_text(next_source,encoding='utf-8',newline='\r\n')
print('Capability registry/state generation OK: '+str(len(data['protocols']))+' exact protocols')
