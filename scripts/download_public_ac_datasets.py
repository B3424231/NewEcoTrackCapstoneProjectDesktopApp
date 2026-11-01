"""Download original published HVAC reference data and verify repository checksums.

This does not train a model or change application or production records.
"""
import csv
import hashlib
import io
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parents[1] / 'datasets/public_ac_candidates_20261029'


def get(url):
    response = requests.get(url, timeout=60)
    response.raise_for_status()
    return response.content


def save(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and path.read_bytes() != content:
        raise ValueError('Existing source differs; review before replacing: ' + str(path))
    path.write_bytes(content)


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')


def main():
    metadata = json.loads(get('https://api.figshare.com/v2/articles/20520438/versions/3'))
    folder = ROOT / 'ornl_multizone'
    write_json(folder/'repository_metadata.json', metadata)

    def download(item):
        content = get(item['download_url'])
        if hashlib.md5(content).hexdigest() != item['computed_md5']:
            raise ValueError('Published checksum mismatch: ' + item['name'])
        save(folder/item['name'], content)
        rows = csv.reader(io.StringIO(content.decode('utf-8-sig')))
        header = next(rows)
        first = next(rows, None)
        count = (1 if first else 0) + sum(1 for _ in rows)
        return dict(name=item['name'], url=item['download_url'], bytes=len(content),
                    published_md5_verified=True, md5=item['computed_md5'],
                    sha256=hashlib.sha256(content).hexdigest(),
                    rows_after_first_line=count, header=header, first_row=first)

    records = []
    with ThreadPoolExecutor(max_workers=4) as pool:
        for future in as_completed([pool.submit(download, item) for item in metadata['files']]):
            record = future.result()
            records.append(record)
            print('SAVED ' + record['name'], flush=True)
    write_json(folder/'download_manifest.json', sorted(records, key=lambda item: item['name']))
    folder = ROOT/'minisplit_2019'
    url = 'https://ars.els-cdn.com/content/image/1-s2.0-S2352340919306705-mmc1.xlsx'
    content = get(url)
    if not content.startswith(b'PK'):
        raise ValueError('Publisher supplement is not an XLSX archive.')
    save(folder/'original_supplement_mmc1.xlsx', content)
    article_url = 'https://www.ebi.ac.uk/europepmc/webservices/rest/PMC6698924/fullTextXML'
    save(folder/'article.xml', get(article_url))
    write_json(folder/'download_manifest.json', dict(
        title='Experimental data for an air-conditioning system identification',
        doi='10.1016/j.dib.2019.104316',
        authors=['Hermes Ramirez', 'Javier Jimenez-Cabas', 'Antonio Bula'],
        url=url, bytes=len(content), sha256=hashlib.sha256(content).hexdigest(),
        downloaded_utc=datetime.now(timezone.utc).isoformat(), license='CC BY 4.0 (article)',
        data_basis='Experimental sensor data; power calculated from recorded current times 120 V, not independently metered real power.',
        limitations=['Only low/high fan levels tested', 'No calendar datetime; elapsed time only',
                     'Cooling experiments; no multi-mode coverage', 'Measured inlet temperature is not AC target setpoint']))
    print('SAVED original mini-split Excel supplement; original source values preserved.', flush=True)


if __name__ == '__main__':
    main()
